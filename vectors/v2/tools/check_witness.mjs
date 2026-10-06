// Dark NULL v2: run the reference circuit (spikes/p0/circuits/transact_v2_spec.circom) on the V-E2E witnesses.
// Usage: node check_witness.mjs <build_dir> <circuit_input_dir> <V-E2E.json>
// Expects <build_dir>/transact_v2_spec_js/ from: circom2 transact_v2_spec.circom --O2 --r1cs --wasm -l node_modules -o <build_dir>
// Valid witnesses must satisfy every constraint and output the V-E2E pi; each tampered witness must fail.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const [buildDir, inDir, e2ePath] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const wcJs = path.resolve(buildDir, "transact_v2_spec_js/witness_calculator.js");
fs.copyFileSync(wcJs, wcJs.replace(/\.js$/, ".cjs")); // circom emits CommonJS; this package is "type": "module"
const builder = require(wcJs.replace(/\.js$/, ".cjs"));
const wc = await builder(fs.readFileSync(path.resolve(buildDir, "transact_v2_spec_js/transact_v2_spec.wasm")));
const E2E = JSON.parse(fs.readFileSync(e2ePath, "utf8"));
const load = (n) => JSON.parse(fs.readFileSync(path.join(inDir, `e2e_${n}.input.json`), "utf8"));
const results = { circuit: "spikes/p0/circuits/transact_v2_spec.circom", valid: [], tampered: [] };

for (const st of E2E.steps) {
  const w = await wc.calculateWitness(load(st.name), true);
  const pi = "0x" + w[1].toString(16).padStart(64, "0");
  results.valid.push({ step: st.name, pi, expected: st.public.pi, match: pi === st.public.pi });
}

const R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const add1 = (x) => ((BigInt(x) + 1n) % R).toString();
const cases = [
  ["transfer", "dummy input label differs from input 0 label (C6)", (i) => { i.in_label[1] = add1(i.in_label[1]); }],
  ["deposit", "deposit output without the deposit label (C6)", (i) => { i.out_label[0] = "0"; }],
  ["deposit", "deposit with a non-zero input value (C6)", (i) => { i.in_value[0] = "1"; i.out_value[1] = "1"; }],
  ["transfer", "output label differs from input label (C6)", (i) => { i.out_label[1] = add1(i.out_label[1]); }],
  ["transfer", "signature scalar S + 1 (C7)", (i) => { i.sig_S = add1(i.sig_S); }],
  ["transfer", "ext_data_hash changed after signing (C7)", (i) => { i.ext_data_hash = add1(i.ext_data_hash); }],
  ["transfer", "output value + 1 (C4 conservation)", (i) => { i.out_value[0] = add1(i.out_value[0]); }],
  ["withdraw", "public_asset = 0 on a withdraw (C5)", (i) => { i.public_asset = "0"; }],
  ["transfer", "membership sibling tampered (C2)", (i) => { i.in_path[0][3] = add1(i.in_path[0][3]); }],
  ["withdraw", "wrong leaf index for a real input (C2)", (i) => { i.in_leaf_index[0] = add1(i.in_leaf_index[0]); }],
  ["withdraw", "nk not bound in owner pk: second nk (C1, F-NK)", (i) => { i.nk = add1(i.nk); }],
  ["transfer", "ak off the curve (C1)", (i) => { i.ak[0] = add1(i.ak[0]); }],
  ["transfer", "output value 2^64 (C3 range)", (i) => { i.out_value[0] = (2n ** 64n).toString(); i.out_value[1] = ((BigInt(i.out_value[1]) - 2n ** 64n + 600n) % R + R) % R + ""; }],
];
for (const [step, what, mutate] of cases) {
  const inp = load(step);
  mutate(inp);
  let failed = false, msg = "";
  try { await wc.calculateWitness(inp, true); } catch (e) { failed = true; msg = String(e.message || e).split("\n")[0].slice(0, 120); }
  results.tampered.push({ step, what, rejected: failed, error: msg });
}
results.all_valid_match = results.valid.every((h) => h.match);
results.all_tampered_rejected = results.tampered.every((t) => t.rejected);
console.log(JSON.stringify(results, null, 1));
if (!results.all_valid_match || !results.all_tampered_rejected) process.exit(1);
