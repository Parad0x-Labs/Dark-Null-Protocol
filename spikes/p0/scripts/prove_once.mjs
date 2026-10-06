// One proving run in a fresh process; prints JSON {witness_ms, prove_ms, total_ms, max_rss_mb, verified}.
// Usage: node prove_once.mjs <groth16|plonk|fflonk> <wasm> <zkey> <input.json> <vk.json> [proof_out.json]
import * as snarkjs from "snarkjs";
import fs from "node:fs";

const [proto, wasm, zkey, inputPath, vkPath, proofOut] = process.argv.slice(2);
const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const t0 = performance.now();
const wtns = { type: "mem" };
await snarkjs.wtns.calculate(input, wasm, wtns);
const t1 = performance.now();
const { proof, publicSignals } = await snarkjs[proto].prove(zkey, wtns);
const t2 = performance.now();
const vk = JSON.parse(fs.readFileSync(vkPath, "utf8"));
const verified = await snarkjs[proto].verify(vk, publicSignals, proof);
if (proofOut) fs.writeFileSync(proofOut, JSON.stringify({ proof, publicSignals }, null, 1));
const r = process.resourceUsage();
console.log(JSON.stringify({ proto, witness_ms: +(t1 - t0).toFixed(1), prove_ms: +(t2 - t1).toFixed(1), total_ms: +(t2 - t0).toFixed(1), max_rss_mb: +(r.maxRSS / 1024).toFixed(1), verified }));
process.exit(0);
