// Devnet runs against the spike-store program: V-POS / derivation vectors via sol_poseidon (G0.1 chain leg),
// S-NULL options A (PDA per nullifier) and B (open-addressing hash-set page), S-TXV1 payload limits.
// Usage: TEST_PAYER=<path> STORE_PROGRAM=<id> node s_store.mjs <out.json>
import fs from "node:fs";
import crypto from "node:crypto";
import { loadKeypair, ephemeralKeypair, v1Message, legacyMessage, signTx, simulate, sendAndConfirm, blockhash, rpc, b58dec, b58enc, findPda, log64, explorer, SYSTEM } from "./devnet_lib.mjs";

const payer = loadKeypair(process.env.TEST_PAYER);
const PROGRAM = b58dec(process.env.STORE_PROGRAM);
const V = JSON.parse(fs.readFileSync(new URL("../../../vectors/v2/p0_vectors.json", import.meta.url)));
const results = { program: process.env.STORE_PROGRAM, date: new Date().toISOString(), runs: {} };
const CFG = { computeUnitLimit: 1_400_000, loadedAccountsDataSizeLimit: 256 * 1024 };
const hexb = (h) => Buffer.from(h.replace(/^0x/, "").padStart(64, "0"), "hex");
const POOL = Buffer.from("dark-null-p0-spike-pool-00000001", "ascii");

function consumed(logs) {
  // per top-level instruction: "Program <PROGRAM> consumed N of M compute units"
  const id = process.env.STORE_PROGRAM;
  return (logs || []).filter((l) => l.startsWith(`Program ${id} consumed`)).map((l) => Number(l.split(" ")[3]));
}
function marks(logs) {
  return (logs || []).filter((l) => l.startsWith("Program consumption: ")).map((l) => Number(l.split(" ")[2]));
}
async function send(ixs, { v1 = true, signers = [payer], label } = {}) {
  const m = v1 ? v1Message(payer.pub, ixs, await blockhash(), CFG) : legacyMessage(payer.pub, ixs, await blockhash());
  const { raw, signature } = signTx(m, signers);
  const r = await sendAndConfirm(raw, signature);
  const logs = r.tx?.meta?.logMessages || [];
  const out = { label, signature, explorer: explorer(signature), tx_bytes: raw.length, version: r.tx?.version, err: r.status.err, fee_lamports: r.tx?.meta?.fee, cu_total: r.tx?.meta?.computeUnitsConsumed, cu_per_ix: consumed(logs), marks: marks(logs), log64: log64(logs) };
  if (out.err) throw new Error(`${label} failed: ${JSON.stringify(out.err)} ${logs.join("\n")}`);
  return out;
}
async function sim(ixs, { signers = [payer] } = {}) {
  const m = v1Message(payer.pub, ixs, await blockhash(), CFG);
  const { raw } = signTx(m, signers);
  const s = await simulate(raw);
  return { err: s.err, units: s.unitsConsumed, logs: s.logs, marks: marks(s.logs), log64: log64(s.logs) };
}
const ix = (data, keys = []) => ({ programId: PROGRAM, keys, data: Buffer.from(data) });

// ---------- calibration ----------
results.runs.calibrate = await send([ix([0x03])], { label: "cu-mark calibration" });
const markCost = results.runs.calibrate.marks[0] - results.runs.calibrate.marks[1];
results.mark_cost_cu = markCost;

// ---------- V-POS on chain ----------
function poseidonCase(inputs, expected) {
  return Buffer.concat([Buffer.from([inputs.length]), ...inputs.map(hexb), hexb(expected)]);
}
for (const set of ["seq", "edge"]) {
  const cases = V["V-POS"].cases.filter((c) => c.set === set);
  const data = Buffer.concat([Buffer.from([0x01]), ...cases.map((c) => poseidonCase(c.inputs, c.output))]);
  const r = await send([ix(data)], { label: `V-POS ${set} n=1..12` });
  const mk = r.marks;
  r.per_n = cases.map((c, i) => ({ n: c.n, cu_syscall: mk[2 * i] - mk[2 * i + 1] - markCost, formula_61n2_542: 61 * (c.n + 0) ** 2 + 542, formula_note: "agave cost = 61*n^2+542 with n = number of inputs" }));
  results.runs[`vpos_${set}`] = r;
}
// derivation vectors on chain
{
  const K = V["V-KEYS"], A = V["V-ASSET"], N = V["V-NOTE"], F = V["V-NF"], S = V["V-SIGHASH"], PI = V["V-PI"], DS = V["V-DS"].tags;
  const notes = N.cases.map((c) => poseidonCase([DS.DS_NOTE.value, "0x" + BigInt(c.value).toString(16), A.asset, c.owner, c.salt, c.label], c.cm));
  const nfs = F.cases.map((c) => poseidonCase([DS.DS_NF.value, c.nk, c.cm, "0x" + BigInt(c.leaf_index).toString(16)], c.nf));
  const cms = N.cases.slice(2).map((c) => c.cm);
  const sigh = poseidonCase([DS.DS_SIGHASH.value, F.cases[0].nf, F.cases[1].nf, cms[0], cms[1], S.public_amount_field, A.asset, S.ext_data_hash, "0x" + BigInt(S.now_epoch).toString(16)], S.sighash);
  const pi = poseidonCase([DS.DS_PI.value, V["V-TREE"].root, F.cases[0].nf, F.cases[1].nf, cms[0], cms[1], S.public_amount_field, A.asset, S.ext_data_hash, "0x" + BigInt(S.now_epoch).toString(16), "0x0", "0x0"], PI.skeleton_pi);
  const asset = poseidonCase([DS.DS_ASSET.value, A.mint_hi, A.mint_lo], A.asset);
  const owner = poseidonCase([DS.DS_PK.value, K.ak[0], K.ak[1], K.nk], K.owner);
  const data = Buffer.concat([Buffer.from([0x01]), asset, owner, ...notes, ...nfs, sigh, pi]);
  results.runs.derivations = await send([ix(data)], { label: "V-ASSET, owner, V-NOTE x4, V-NF x2, V-SIGHASH, V-PI on sol_poseidon" });
}

// ---------- S-TXV1 payload limits (noop instruction) ----------
{
  const bh = await blockhash();
  // grow the noop payload until the signed transaction is exactly `total` bytes
  const fit = (total, v1) => {
    let n = 1;
    for (;;) {
      const d = Buffer.alloc(n, 0xab); d[0] = 0x02;
      const m = v1 ? v1Message(payer.pub, [ix(d)], bh, CFG) : legacyMessage(payer.pub, [ix(d)], bh);
      const len = signTx(m, [payer]).raw.length;
      if (len === total) return d;
      if (len > total) { n -= 1; const d2 = Buffer.alloc(n, 0xab); d2[0] = 0x02; return d2; }
      n += Math.max(1, total - len);
    }
  };
  const at4096 = await send([ix(fit(4096, true))], { label: "V1 tx at 4096 bytes" });
  const overD = Buffer.concat([fit(4096, true), Buffer.from([0xab])]);
  const overRaw = signTx(v1Message(payer.pub, [ix(overD)], await blockhash(), CFG), [payer]);
  const overRes = await rpc("sendTransaction", [overRaw.raw.toString("base64"), { encoding: "base64" }]).then(() => "accepted").catch((e) => e.message);
  const legAt = await send([ix(fit(1232, false))], { v1: false, label: "legacy tx at 1232 bytes" });
  const legOverD = Buffer.concat([fit(1232, false), Buffer.from([0xab])]);
  const legOverRaw = signTx(legacyMessage(payer.pub, [ix(legOverD)], await blockhash()), [payer]);
  const legOverRes = await rpc("sendTransaction", [legOverRaw.raw.toString("base64"), { encoding: "base64" }]).then(() => "accepted").catch((e) => e.message);
  results.runs.txv1_payload = { v1_at_4096: at4096, v1_over_bytes: overRaw.raw.length, v1_over_result: overRes, legacy_at_1232: legAt, legacy_over_bytes: legOverRaw.raw.length, legacy_over_result: legOverRes };
}

// ---------- S-NULL option A: PDA per nullifier ----------
{
  const nfs = [1, 2, 3].map((i) => crypto.createHash("sha256").update(`dark-null-p0-nf-a-${i}-${Date.now()}`).digest());
  const pdas = nfs.map((nf) => findPda([Buffer.from("nf"), POOL, nf], PROGRAM));
  const ins = [];
  for (let i = 0; i < 3; i++) {
    const r = await send([ix(Buffer.concat([Buffer.from([0x10]), nfs[i], Buffer.from([pdas[i].bump])]), [
      { pubkey: payer.pub, isSigner: true, isWritable: true }, { pubkey: pdas[i].address, isSigner: false, isWritable: true }, { pubkey: SYSTEM, isSigner: false, isWritable: false }])], { label: `NF-A insert ${i}` });
    const acct = (await rpc("getAccountInfo", [b58enc(pdas[i].address), { encoding: "base64", commitment: "confirmed" }])).value;
    r.pda_lamports = acct?.lamports; r.pda_data_len = acct ? Buffer.from(acct.data[0], "base64").length : null;
    r.cpi_cu = r.marks[0] - r.marks[1] - markCost;
    ins.push(r);
  }
  // check: spent and unspent (two checks in one tx)
  const unspent = crypto.createHash("sha256").update("dark-null-p0-nf-a-unspent").digest();
  const up = findPda([Buffer.from("nf"), POOL, unspent], PROGRAM);
  const chk = await send([
    ix(Buffer.concat([Buffer.from([0x11]), nfs[0], Buffer.from([pdas[0].bump])]), [{ pubkey: pdas[0].address, isSigner: false, isWritable: false }]),
    ix(Buffer.concat([Buffer.from([0x11]), unspent, Buffer.from([up.bump])]), [{ pubkey: up.address, isSigner: false, isWritable: false }]),
  ], { label: "NF-A check spent + unspent" });
  // double insert must fail (simulated: no fee, CU reported)
  const dbl = await sim([ix(Buffer.concat([Buffer.from([0x10]), nfs[0], Buffer.from([pdas[0].bump])]), [
    { pubkey: payer.pub, isSigner: true, isWritable: true }, { pubkey: pdas[0].address, isSigner: false, isWritable: true }, { pubkey: SYSTEM, isSigner: false, isWritable: false }])]);
  const rentMin = await rpc("getMinimumBalanceForRentExemption", [0]);
  // close (rent recovery for the spike only; v2 never closes nullifiers)
  const close = await send(pdas.map((p) => ix([0x12], [{ pubkey: p.address, isSigner: false, isWritable: true }, { pubkey: payer.pub, isSigner: true, isWritable: true }])), { label: "NF-A close (spike rent recovery)" });
  results.runs.null_a = { inserts: ins, check: chk, double_insert_sim: { err: dbl.err, units: dbl.units }, rent_min_0_bytes: rentMin, close };
}

// ---------- S-NULL option B: open-addressing hash-set page ----------
{
  const CAP = 320;
  const space = 16 + CAP * 32;
  const lamports = await rpc("getMinimumBalanceForRentExemption", [space]);
  const page = ephemeralKeypair();
  const create = Buffer.alloc(52); create.writeUInt32LE(0, 0); create.writeBigUInt64LE(BigInt(lamports), 4); create.writeBigUInt64LE(BigInt(space), 12); PROGRAM.copy(create, 20);
  const created = await send([{ programId: SYSTEM, keys: [{ pubkey: payer.pub, isSigner: true, isWritable: true }, { pubkey: page.pub, isSigner: true, isWritable: true }], data: create }], { signers: [payer, page], label: "NF-B create page" });
  const pageKey = [{ pubkey: page.pub, isSigner: false, isWritable: true }];
  const all = Array.from({ length: 288 }, (_, i) => crypto.createHash("sha256").update(`dark-null-p0-nf-b-${i}`).digest());
  const batches = [];
  for (let off = 0; off < all.length; off += 96) {
    const r = await send([ix(Buffer.concat([Buffer.from([0x20]), ...all.slice(off, off + 96)]), pageKey)], { label: `NF-B insert ${off}..${off + 95}` });
    const mk = r.marks;
    r.per_insert = r.log64.filter((l) => l[0] === 0x20).map((l, i) => ({ count: l[2], probes: l[1], cu: mk[2 * i] - mk[2 * i + 1] - markCost }));
    delete r.marks;
    batches.push(r);
  }
  const absent = crypto.createHash("sha256").update("dark-null-p0-nf-b-absent").digest();
  const chk = await send([ix(Buffer.concat([Buffer.from([0x21]), all[5]]), [{ pubkey: page.pub, isSigner: false, isWritable: false }]), ix(Buffer.concat([Buffer.from([0x21]), absent]), [{ pubkey: page.pub, isSigner: false, isWritable: false }])], { label: "NF-B check present + absent at 90% load" });
  chk.per_check = chk.log64.filter((l) => l[0] === 0x21).map((l, i) => ({ found: l[2], probes: l[1], cu: chk.marks[2 * i] - chk.marks[2 * i + 1] - markCost }));
  const dbl = await sim([ix(Buffer.concat([Buffer.from([0x20]), all[7]]), pageKey)]);
  const close = await send([ix([0x12], [{ pubkey: page.pub, isSigner: false, isWritable: true }, { pubkey: payer.pub, isSigner: true, isWritable: true }])], { label: "NF-B close page (spike rent recovery)" });
  results.runs.null_b = { capacity: CAP, page_bytes: space, page_rent_lamports: lamports, created, batches, check: chk, double_insert_sim: { err: dbl.err, units: dbl.units }, close };
}
fs.writeFileSync(process.argv[2], JSON.stringify(results, null, 1));
console.log("done", process.argv[2]);
