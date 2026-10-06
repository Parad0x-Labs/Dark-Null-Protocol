// transact_v2 witness tests (V2_SPEC 13.2, PLAN WP-CIRCUIT tests 1 and 2). Sandbox only.
//   - the three V-E2E witnesses produce the V-E2E pi and satisfy the R1CS (snarkjs wtns check);
//   - tampered witnesses W1-W17 are rejected by transact_v2;
//   - the same cases run on the Phase 0 reference circuit, so the review delta is shown by a witness:
//     W14 (one note spent twice) and W17 (non-zero assoc_root) pass the reference and fail transact_v2.
// Usage: node check_witness.mjs <v2.wasm> <v2.r1cs> <ref.wasm> <ref.r1cs> <V-E2E.json> <V-ADDR.json> <out.json>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as snarkjs from "snarkjs";
import { readJson, inputsFor, statement, hex } from "./lib.mjs";
import { tamperedCases } from "./cases.mjs";

const [v2Wasm, v2R1cs, refWasm, refR1cs, e2ePath, addrPath, outPath] = process.argv.slice(2);
const E2E = readJson(e2ePath);
const ADDR = readJson(addrPath);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dnw-"));
let seq = 0;

async function run(wasm, r1cs, input) {
  const f = path.join(tmp, `w${seq++}.wtns`);
  const mem = { type: "mem" };
  try {
    await snarkjs.wtns.calculate(input, wasm, mem);
  } catch (e) {
    return { rejected: true, error: String(e.message || e).split("\n")[0].slice(0, 160) };
  }
  fs.writeFileSync(f, mem.data);
  const r1csOk = await snarkjs.wtns.check(r1cs, f);
  const w = await snarkjs.wtns.exportJson(f);
  fs.unlinkSync(f);
  return { rejected: !r1csOk, r1cs_satisfied: r1csOk, pi: hex(w[1]) };
}

const results = { circuit: "circuits/v2/transact_v2.circom", reference: "spikes/p0/circuits/transact_v2_spec.circom", valid: [], tampered: [] };

for (const st of E2E.steps) {
  const inp = inputsFor(E2E, st);
  const js = statement(inp);
  const v2 = await run(v2Wasm, v2R1cs, inp);
  const ref = await run(refWasm, refR1cs, inp);
  results.valid.push({
    step: st.name, expected: st.public.pi, pi: v2.pi, js_pi: hex(js.pi),
    match: v2.pi === st.public.pi && hex(js.pi) === st.public.pi, r1cs_satisfied: v2.r1cs_satisfied === true,
    reference_pi_match: ref.pi === st.public.pi,
  });
}

for (const { id, step: st, what, input: base, reference_expected: refExpect } of tamperedCases(E2E, ADDR)) {
  const v2 = await run(v2Wasm, v2R1cs, JSON.parse(JSON.stringify(base)));
  const ref = await run(refWasm, refR1cs, JSON.parse(JSON.stringify(base)));
  const refOutcome = ref.rejected ? "reject" : "accept";
  results.tampered.push({
    id, step: st, what, rejected: v2.rejected, error: v2.error || null,
    reference: refOutcome, reference_expected: refExpect, reference_r1cs_satisfied: ref.r1cs_satisfied ?? null,
  });
}

results.all_valid_match = results.valid.every((v) => v.match && v.r1cs_satisfied && v.reference_pi_match);
results.all_tampered_rejected = results.tampered.every((t) => t.rejected);
results.reference_as_expected = results.tampered.every((t) => t.reference === t.reference_expected);
results.pass = results.all_valid_match && results.all_tampered_rejected && results.reference_as_expected;
fs.writeFileSync(outPath, JSON.stringify(results, null, 1) + "\n");
console.log(JSON.stringify({ valid: results.valid.map((v) => [v.step, v.match, v.r1cs_satisfied]), tampered: results.tampered.map((t) => [t.id, t.rejected, t.reference]), pass: results.pass }));
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(results.pass ? 0 : 1);
