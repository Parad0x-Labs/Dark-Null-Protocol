// Devnet run of the WP-CIRCUIT VK probe (devnet only). Dependency-free; uses spikes/p0/scripts/devnet_lib.mjs.
// Usage: TEST_PAYER=<path> PROBE_PROGRAM=<id> node run_probe.mjs <tests/fixtures/proofs.txt> <out.json>
// Sends Transaction V1 messages: CU calibration, VK_HASH (sol_sha256 of the compiled VK bytes), one VERIFY per fixture
// proof (snarkjs and arkworks proofs of the three V-E2E steps); simulates rejections (changed pi, pi >= r, changed C).
// Key material is never logged.
import fs from "node:fs";
import { loadKeypair, v1Message, signTx, simulate, sendAndConfirm, blockhash, b58dec, log64, explorer } from "../../../spikes/p0/scripts/devnet_lib.mjs";

const [fxPath, outPath] = process.argv.slice(2);
const payer = loadKeypair(process.env.TEST_PAYER);
const ID = process.env.PROBE_PROGRAM;
const PROGRAM = b58dec(ID);
const CFG = { computeUnitLimit: 200_000, loadedAccountsDataSizeLimit: 64 * 1024 };
const consumed = (logs) => (logs || []).filter((l) => l.startsWith(`Program ${ID} consumed`)).map((l) => Number(l.split(" ")[3]));
const marks = (logs) => (logs || []).filter((l) => l.startsWith("Program consumption: ")).map((l) => Number(l.split(" ")[2]));
const ix = (tag, data = Buffer.alloc(0)) => ({ programId: PROGRAM, keys: [], data: Buffer.concat([Buffer.from([tag]), data]) });

async function send(ixs, label) {
  const { raw, signature } = signTx(v1Message(payer.pub, ixs, await blockhash(), CFG), [payer]);
  const r = await sendAndConfirm(raw, signature);
  const logs = r.tx?.meta?.logMessages || [];
  const out = { label, signature, explorer: explorer(signature), tx_bytes: raw.length, version: r.tx?.version, err: r.status.err, fee_lamports: r.tx?.meta?.fee, cu_total: r.tx?.meta?.computeUnitsConsumed, cu_program: consumed(logs)[0], marks: marks(logs), log64: log64(logs) };
  if (out.err) throw new Error(`${label}: ${JSON.stringify(out.err)}\n${logs.join("\n")}`);
  return out;
}
async function sim(ixs, label) {
  const { raw } = signTx(v1Message(payer.pub, ixs, await blockhash(), CFG), [payer]);
  const s = await simulate(raw);
  return { label, err: s.err, units: s.unitsConsumed, rejected: s.err != null };
}

const fx = fs.readFileSync(fxPath, "utf8").split("\n").filter(Boolean).map((l) => {
  const [label, proof, pi] = l.split(/\s+/);
  return { label, proof: Buffer.from(proof, "hex"), pi: Buffer.from(pi, "hex") };
});
const results = { program: ID, date: new Date().toISOString(), cluster: "devnet", runs: {}, reject: [] };
results.runs.calibrate = await send([ix(0x03)], "CU mark calibration");
const mc = results.runs.calibrate.marks[0] - results.runs.calibrate.marks[1];
results.mark_cost_cu = mc;
results.runs.vk_hash = await send([ix(0x02)], "VK_HASH: sol_sha256(VK_BYTES) == VK_HASH");
for (const f of fx) {
  const r = await send([ix(0x01, Buffer.concat([f.proof, f.pi]))], `VERIFY ${f.label}`);
  r.verify_cu = r.marks[0] - r.marks[1] - mc;
  results.runs[f.label] = r;
}
const f0 = fx[0];
const piFlip = Buffer.from(f0.pi); piFlip[31] ^= 1;
const cFlip = Buffer.from(f0.proof); cFlip[200] ^= 1;
results.reject.push(await sim([ix(0x01, Buffer.concat([f0.proof, piFlip]))], "changed pi"));
results.reject.push(await sim([ix(0x01, Buffer.concat([f0.proof, Buffer.alloc(32, 0xff)]))], "pi >= r"));
results.reject.push(await sim([ix(0x01, Buffer.concat([cFlip, f0.pi]))], "changed proof C"));
const verifies = fx.map((f) => results.runs[f.label].verify_cu);
results.summary = {
  proofs_verified: fx.length,
  verify_cu_min: Math.min(...verifies),
  verify_cu_max: Math.max(...verifies),
  program_cu_max: Math.max(...fx.map((f) => results.runs[f.label].cu_program)),
  all_rejections_rejected: results.reject.every((r) => r.rejected),
  fees_lamports: Object.values(results.runs).reduce((a, r) => a + (r.fee_lamports || 0), 0),
};
fs.writeFileSync(outPath, JSON.stringify(results, null, 1) + "\n");
console.log(JSON.stringify(results.summary));
