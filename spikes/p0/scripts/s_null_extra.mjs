// S-NULL follow-up: two nullifiers per transaction (the transact shape) for options A and B,
// and the duplicate-nullifier path of option B on a page below its load cap.
// Usage: TEST_PAYER=<path> STORE_PROGRAM=<id> node s_null_extra.mjs <out.json>
import fs from "node:fs";
import crypto from "node:crypto";
import { loadKeypair, ephemeralKeypair, v1Message, signTx, simulate, sendAndConfirm, blockhash, rpc, b58dec, findPda, log64, explorer, SYSTEM } from "./devnet_lib.mjs";

const payer = loadKeypair(process.env.TEST_PAYER);
const ID = process.env.STORE_PROGRAM;
const PROGRAM = b58dec(ID);
const CFG = { computeUnitLimit: 200_000, loadedAccountsDataSizeLimit: 128 * 1024 };
const POOL = Buffer.from("dark-null-p0-spike-pool-00000001", "ascii");
const consumed = (logs) => (logs || []).filter((l) => l.startsWith(`Program ${ID} consumed`)).map((l) => Number(l.split(" ")[3]));
const ix = (data, keys = []) => ({ programId: PROGRAM, keys, data: Buffer.from(data) });
async function send(ixs, label, signers = [payer]) {
  const { raw, signature } = signTx(v1Message(payer.pub, ixs, await blockhash(), CFG), signers);
  const r = await sendAndConfirm(raw, signature);
  const logs = r.tx?.meta?.logMessages || [];
  if (r.status.err) throw new Error(label + JSON.stringify(r.status.err) + logs.join("\n"));
  return { label, signature, explorer: explorer(signature), tx_bytes: raw.length, fee_lamports: r.tx?.meta?.fee, cu_total: r.tx?.meta?.computeUnitsConsumed, cu_per_ix: consumed(logs), log64: log64(logs) };
}
const out = { program: ID, date: new Date().toISOString() };
const nf = (s) => crypto.createHash("sha256").update(`dark-null-p0-extra-${s}-${Date.now()}`).digest();

// A: two PDA inserts in one transaction
const a = [nf("a0"), nf("a1")];
const pa = a.map((n) => findPda([Buffer.from("nf"), POOL, n], PROGRAM));
const aIx = (i) => ix(Buffer.concat([Buffer.from([0x10]), a[i], Buffer.from([pa[i].bump])]), [{ pubkey: payer.pub, isSigner: true, isWritable: true }, { pubkey: pa[i].address, isSigner: false, isWritable: true }, { pubkey: SYSTEM, isSigner: false, isWritable: false }]);
out.a_two_inserts = await send([aIx(0), aIx(1)], "NF-A two inserts in one tx");
out.a_close = await send(pa.map((p) => ix([0x12], [{ pubkey: p.address, isSigner: false, isWritable: true }, { pubkey: payer.pub, isSigner: true, isWritable: true }])), "NF-A close");

// B: small page (cap 64), two nullifiers in one instruction, then a duplicate
const CAP = 64, space = 16 + CAP * 32;
const lamports = await rpc("getMinimumBalanceForRentExemption", [space]);
const page = ephemeralKeypair();
const c = Buffer.alloc(52); c.writeUInt32LE(0, 0); c.writeBigUInt64LE(BigInt(lamports), 4); c.writeBigUInt64LE(BigInt(space), 12); PROGRAM.copy(c, 20);
out.b_create = await send([{ programId: SYSTEM, keys: [{ pubkey: payer.pub, isSigner: true, isWritable: true }, { pubkey: page.pub, isSigner: true, isWritable: true }], data: c }], "NF-B create small page", [payer, page]);
const b = [nf("b0"), nf("b1")];
const pk = [{ pubkey: page.pub, isSigner: false, isWritable: true }];
out.b_two_inserts = await send([ix(Buffer.concat([Buffer.from([0x20]), b[0], b[1]]), pk)], "NF-B two inserts in one ix");
const { raw } = signTx(v1Message(payer.pub, [ix(Buffer.concat([Buffer.from([0x20]), b[0]]), pk)], await blockhash(), CFG), [payer]);
const dup = await simulate(raw);
out.b_duplicate_sim = { err: dup.err, units: dup.unitsConsumed, last_log: (dup.logs || []).slice(-1)[0] };
out.b_close = await send([ix([0x12], [{ pubkey: page.pub, isSigner: false, isWritable: true }, { pubkey: payer.pub, isSigner: true, isWritable: true }])], "NF-B close page");
fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
console.log(JSON.stringify({ a: out.a_two_inserts.cu_per_ix, b: out.b_two_inserts.cu_per_ix, dup: out.b_duplicate_sim }));
