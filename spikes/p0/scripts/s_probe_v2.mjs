// Phase 0 completion: run crates/dark-null-transcript on devnet through the probe program
// (spikes/p0/probe_v2) against the v2 vectors: every Poseidon call of the generator, the three
// V-E2E transacts (ext_data_hash via sol_sha256, pi via sol_poseidon), the tree insertion algorithm,
// and canonical nullifier-PDA derivation. Dependency-free; key material is never logged.
// Usage: TEST_PAYER=<path> PROBE_PROGRAM=<id> node s_probe_v2.mjs <calls.json> <out.json>
import fs from "node:fs";
import { loadKeypair, v1Message, signTx, simulate, sendAndConfirm, blockhash, rpc, b58dec, log64, explorer } from "./devnet_lib.mjs";

const [callsPath, outPath] = process.argv.slice(2);
const payer = loadKeypair(process.env.TEST_PAYER);
const PROGRAM = b58dec(process.env.PROBE_PROGRAM);
const V = (n) => JSON.parse(fs.readFileSync(new URL(`../../../vectors/v2/${n}.json`, import.meta.url)));
const E2E = V("V-E2E");
const CALLS = JSON.parse(fs.readFileSync(callsPath, "utf8"));
const CFG = { computeUnitLimit: 1_400_000, loadedAccountsDataSizeLimit: 128 * 1024 };
const hexb = (h) => Buffer.from(h.replace(/^0x/, "").padStart(64, "0"), "hex");
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const ix = (data) => ({ programId: PROGRAM, keys: [], data: Buffer.from(data) });
const consumed = (logs) => (logs || []).filter((l) => l.startsWith(`Program ${process.env.PROBE_PROGRAM} consumed`)).map((l) => Number(l.split(" ")[3]));
const marks = (logs) => (logs || []).filter((l) => l.startsWith("Program consumption: ")).map((l) => Number(l.split(" ")[2]));
const MARK_COST = 101; // P0 calibration: CU per sol_log_compute_units checkpoint (PHASE0_RESULTS section 2)
const balance = async () => (await rpc("getBalance", [payer.address, { commitment: "confirmed" }])).value;

const results = { program: process.env.PROBE_PROGRAM, date: new Date().toISOString(), payer: payer.address, runs: [], negatives: [] };
results.balance_before = await balance();

async function send(label, data) {
  const m = v1Message(payer.pub, [ix(data)], await blockhash(), CFG);
  const { raw, signature } = signTx(m, [payer]);
  const r = await sendAndConfirm(raw, signature);
  const logs = r.tx?.meta?.logMessages || [];
  const out = { label, signature, explorer: explorer(signature), tx_bytes: raw.length, data_bytes: data.length, version: r.tx?.version, err: r.status.err, fee_lamports: r.tx?.meta?.fee, cu: consumed(logs)[0], marks: marks(logs), log64: log64(logs) };
  results.runs.push(out);
  if (out.err) throw new Error(`${label}: ${JSON.stringify(out.err)}\n${logs.join("\n")}`);
  console.log(`${label}: ok, ${out.cu} CU, ${raw.length} B`);
  return out;
}
async function simErr(label, data, expectCode) {
  const m = v1Message(payer.pub, [ix(data)], await blockhash(), CFG);
  const { raw } = signTx(m, [payer]);
  const s = await simulate(raw);
  const code = s.err?.InstructionError?.[1]?.Custom;
  const row = { label, expected_custom_error: expectCode, err: s.err, rejected_as_expected: code === expectCode };
  results.negatives.push(row);
  console.log(`${label}: ${row.rejected_as_expected ? "rejected as expected" : "UNEXPECTED " + JSON.stringify(s.err)}`);
}

// 1. every Poseidon call of the generator, packed into V1 transactions
const cases = CALLS.map((c) => Buffer.concat([Buffer.from([c.inputs.length]), ...c.inputs.map(hexb), hexb(c.output)]));
let batch = [];
let size = 1;
const batches = [];
for (const c of cases) {
  if (size + c.length > 3700) { batches.push(batch); batch = []; size = 1; }
  batch.push(c); size += c.length;
}
if (batch.length) batches.push(batch);
let k = 0;
for (const b of batches) {
  const r = await send(`POSEIDON_CHECK batch ${k + 1}/${batches.length} (${b.length} calls)`, Buffer.concat([Buffer.from([0x01]), ...b]));
  r.calls = b.length;
  k++;
}
results.poseidon_calls_checked = cases.length;

// 2. the three V-E2E transacts: decode, pool binding, ext_data_hash (sol_sha256), deposit label and pi (sol_poseidon)
const poolId = Buffer.from(E2E.pool.pool_id, "hex");
const asset = hexb(E2E.pool.asset);
let depositsBefore = 0;
for (const st of E2E.steps) {
  const ixData = Buffer.from(st.instruction.data_with_zero_proof, "hex");
  const payload = Buffer.concat([Buffer.from([0x02]), ixData, poolId, asset, u64(depositsBefore), hexb(st.public.pi), hexb(st.public.ext_data_hash)]);
  const r = await send(`TRANSACT_CHECK ${st.name}`, payload);
  const mk = r.marks;
  r.cu_ext_data_hash = mk[1] - mk[2] - MARK_COST;
  r.cu_label_and_pi = mk[2] - mk[3] - MARK_COST;
  if (st.public.deposit_amount !== "0") depositsBefore++;
  if (st.name === "transfer") {
    const bad = Buffer.from(payload); bad[1 + 482 + 300] ^= 1; // ciphertext0 byte
    await simErr("TRANSACT_CHECK transfer, ext_data byte flipped", bad, 0x205);
    const badPi = Buffer.from(payload); badPi[badPi.length - 33] ^= 1;
    await simErr("TRANSACT_CHECK transfer, pi off by one bit", badPi, 0x208);
    const badPool = Buffer.from(payload); badPool[1 + 1131] ^= 1;
    await simErr("TRANSACT_CHECK transfer, foreign pool id", badPool, 0x203);
  }
}

// 3. tree insertion algorithm from the empty tree (3 pairs, 96 sol_poseidon calls)
{
  const pairs = E2E.steps.map((s) => Buffer.concat([hexb(s.public.cm[0]), hexb(s.public.cm[1]), hexb(s.after.new_root)]));
  const r = await send("TREE_CHECK 3 pair insertions", Buffer.concat([Buffer.from([0x03, pairs.length]), ...pairs]));
  r.cu_per_insert = [0, 1, 2].map((i) => r.marks[2 * i] - r.marks[2 * i + 1] - MARK_COST);
  const bad = Buffer.concat([Buffer.from([0x03, 1]), hexb(E2E.steps[0].public.cm[1]), hexb(E2E.steps[0].public.cm[0]), hexb(E2E.steps[0].after.new_root)]);
  await simErr("TREE_CHECK swapped pair order", bad, 0x310);
}

// 4. canonical nullifier PDA derivation (sol_try_find_program_address) for the six V-E2E nullifiers
{
  const prog = b58dec(E2E.pool.program_id);
  const cfg = b58dec(E2E.pool.pool_config.address);
  const items = E2E.steps.flatMap((s) => s.public.nf.map((nf, i) => Buffer.concat([hexb(nf), b58dec(s.nullifier_pdas[i].address), Buffer.from([s.nullifier_pdas[i].bump])])));
  const r = await send("NF_PDA_CHECK 6 nullifiers", Buffer.concat([Buffer.from([0x04]), prog, cfg, ...items]));
  r.bumps = E2E.steps.flatMap((s) => s.nullifier_pdas.map((p) => p.bump));
  r.cu_per_derivation = r.bumps.map((_, i) => r.marks[2 * i] - r.marks[2 * i + 1] - MARK_COST);
}

results.balance_after = await balance();
results.fees_lamports = results.runs.reduce((a, r) => a + (r.fee_lamports || 0), 0);
results.all_negatives_rejected = results.negatives.every((n) => n.rejected_as_expected);
fs.writeFileSync(outPath, JSON.stringify(results, null, 1));
console.log(JSON.stringify({ runs: results.runs.length, poseidon_calls: results.poseidon_calls_checked, fees: results.fees_lamports, negatives_ok: results.all_negatives_rejected }));
