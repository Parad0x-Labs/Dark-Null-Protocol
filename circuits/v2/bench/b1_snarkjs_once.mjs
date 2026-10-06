// B1 snarkjs run (WASM witness + snarkjs Groth16 prove + verify) in a fresh process; prints one JSON line.
// Usage: node b1_snarkjs_once.mjs <transact_v2.wasm> <zkey> <vk.json> <input.json>
import * as snarkjs from "snarkjs";
import fs from "node:fs";

const [wasm, zkey, vkPath, inputPath] = process.argv.slice(2);
const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const t0 = performance.now();
const wtns = { type: "mem" };
await snarkjs.wtns.calculate(input, wasm, wtns);
const t1 = performance.now();
const { proof, publicSignals } = await snarkjs.groth16.prove(zkey, wtns);
const t2 = performance.now();
const verified = await snarkjs.groth16.verify(JSON.parse(fs.readFileSync(vkPath, "utf8")), publicSignals, proof);
const r = process.resourceUsage();
console.log(JSON.stringify({ impl: "snarkjs 0.7.6 groth16 (node 22, WASM witness)", witness_ms: +(t1 - t0).toFixed(1), prove_ms: +(t2 - t1).toFixed(1), total_ms: +(t2 - t0).toFixed(1), max_rss_mb: +(r.maxRSS / 1024).toFixed(1), verified, pi: "0x" + BigInt(publicSignals[0]).toString(16).padStart(64, "0") }));
process.exit(0);
