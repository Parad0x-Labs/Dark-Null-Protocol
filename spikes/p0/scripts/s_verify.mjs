// Devnet runs against spike-verify (Groth16 via groth16-solana, PLONK) or spike-fflonk.
// Usage: TEST_PAYER=<path> VERIFY_PROGRAM=<id> MODE=<verify|fflonk> node s_verify.mjs <out.json>
import fs from "node:fs";
import { loadKeypair, v1Message, legacyMessage, signTx, simulate, sendAndConfirm, blockhash, b58dec, log64, explorer } from "./devnet_lib.mjs";

const payer = loadKeypair(process.env.TEST_PAYER);
const ID = process.env.VERIFY_PROGRAM;
const PROGRAM = b58dec(ID);
const MODE = process.env.MODE || "verify";
const FX = JSON.parse(fs.readFileSync(new URL("../program/tests/fixtures/ix_fixtures.json", import.meta.url)));
const CFG = { computeUnitLimit: 1_400_000, loadedAccountsDataSizeLimit: 256 * 1024 };
const results = { program: ID, mode: MODE, date: new Date().toISOString(), runs: {} };
const consumed = (logs) => (logs || []).filter((l) => l.startsWith(`Program ${ID} consumed`)).map((l) => Number(l.split(" ")[3]));
const marks = (logs) => (logs || []).filter((l) => l.startsWith("Program consumption: ")).map((l) => Number(l.split(" ")[2]));
const ix = (tag, hex) => ({ programId: PROGRAM, keys: [], data: Buffer.concat([Buffer.from([tag]), Buffer.from(hex, "hex")]) });
const CB = Buffer.alloc(32); CB.set(b58dec("ComputeBudget111111111111111111111111111111"));
const cuLimitIx = (n) => { const d = Buffer.alloc(5); d[0] = 2; d.writeUInt32LE(n, 1); return { programId: CB, keys: [], data: d }; };

async function send(ixs, label, { v1 = true } = {}) {
  const m = v1 ? v1Message(payer.pub, ixs, await blockhash(), CFG) : legacyMessage(payer.pub, ixs, await blockhash());
  const { raw, signature } = signTx(m, [payer]);
  const r = await sendAndConfirm(raw, signature);
  const logs = r.tx?.meta?.logMessages || [];
  const out = { label, signature, explorer: explorer(signature), tx_bytes: raw.length, version: r.tx?.version, err: r.status.err, fee_lamports: r.tx?.meta?.fee, cu_total: r.tx?.meta?.computeUnitsConsumed, cu_per_ix: consumed(logs), marks: marks(logs), log64: log64(logs) };
  if (out.err) throw new Error(`${label}: ${JSON.stringify(out.err)}\n${logs.join("\n")}`);
  return out;
}
async function sim(ixs) {
  const { raw } = signTx(v1Message(payer.pub, ixs, await blockhash(), CFG), [payer]);
  const s = await simulate(raw);
  return { err: s.err, units: s.unitsConsumed, last_log: (s.logs || []).slice(-1)[0] };
}
const phases = (mk, mc) => ({ transcript: mk[0] - mk[1] - mc, field: mk[1] - mk[2] - mc, g1: mk[2] - mk[3] - mc, pairing: mk[3] - mk[4] - mc });

results.runs.calibrate = await send([ix(0x03, "")], "cu-mark calibration");
const mc = results.runs.calibrate.marks[0] - results.runs.calibrate.marks[1];
results.mark_cost_cu = mc;

if (MODE === "verify") {
  for (const [tag, key, label] of [[0x30, "g16_skeleton", "Groth16 transact_v2_skeleton (1 public input)"], [0x31, "g16_pi_hash", "Groth16 pi_hash circuit"], [0x32, "g16_fullsize", "Groth16 transact_v2_fullsize"]]) {
    const r = await send([ix(tag, FX[key])], label);
    r.verify_cu = r.marks[0] - r.marks[1] - mc;
    results.runs[key] = r;
  }
  results.runs.g16_skeleton_legacy = await send([ix(0x30, FX.g16_skeleton)], "Groth16 skeleton in a legacy tx", { v1: false });
  for (const [tag, data, key, label] of [[0x40, FX.plonk_pi_hash.data_hint, "plonk_pi_hash_hint", "PLONK pi_hash (2^15), inverse hint"], [0x41, FX.plonk_pi_hash.data_nohint, "plonk_pi_hash_eea", "PLONK pi_hash (2^15), on-chain binary-EEA inverse"], [0x42, FX.plonk_skeleton.data_hint, "plonk_skeleton_hint", "PLONK transact_v2_skeleton (2^18), inverse hint"]]) {
    const r = await send([ix(tag, data)], label);
    r.phases = phases(r.marks, mc);
    results.runs[key] = r;
  }
  results.runs.plonk_pi_hash_legacy = await send([cuLimitIx(400000), ix(0x40, FX.plonk_pi_hash.data_hint)], "PLONK pi_hash in a legacy tx with SetComputeUnitLimit", { v1: false });
  results.runs.reject = {
    g16_bad_pub: await sim([ix(0x30, FX.bad.g16_skeleton_pub)]),
    plonk_bad_eval: await sim([ix(0x40, FX.bad.plonk_pi_hash_eval)]),
    plonk_bad_pub: await sim([ix(0x40, FX.bad.plonk_pi_hash_pub)]),
  };
} else {
  const r = await send([ix(0x50, FX.fflonk_pi_hash)], "fflonk pi_hash (2^15)");
  r.phases = phases(r.marks, mc);
  results.runs.fflonk_pi_hash = r;
  results.runs.reject = { fflonk_bad_eval: await sim([ix(0x50, FX.bad.fflonk_pi_hash_eval)]) };
}
fs.writeFileSync(process.argv[2], JSON.stringify(results, null, 1));
console.log("done");
