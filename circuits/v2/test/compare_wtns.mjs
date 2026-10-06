// Native witness path check: for each V-E2E step the native (C++) witness equals the WASM witness value for value,
// satisfies the R1CS, and carries the V-E2E pi. Sandbox only.
// Usage: node compare_wtns.mjs <v2.wasm> <v2.r1cs> <native_wtns_dir> <V-E2E.json> <out.json>
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as snarkjs from "snarkjs";
import { readJson, hex } from "./lib.mjs";
import { validCases } from "./cases.mjs";

const [wasm, r1cs, nativeDir, e2ePath, outPath] = process.argv.slice(2);
const E2E = readJson(e2ePath);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dnc-"));
const out = { native: "circom 2.2.3 --c --no_asm, g++ -O3", steps: [] };

for (const v of validCases(E2E)) {
  const mem = { type: "mem" };
  await snarkjs.wtns.calculate(v.input, wasm, mem);
  const wf = path.join(tmp, `${v.step}.wasm.wtns`);
  fs.writeFileSync(wf, mem.data);
  const nf = path.join(nativeDir, `e2e_${v.step}.wtns`);
  const a = await snarkjs.wtns.exportJson(wf);
  const b = await snarkjs.wtns.exportJson(nf);
  let diff = a.length === b.length ? 0 : -1;
  if (diff === 0) for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  const r1csOk = await snarkjs.wtns.check(r1cs, nf);
  out.steps.push({ step: v.step, wires: b.length, differing_wires: diff, native_r1cs_satisfied: r1csOk, pi: hex(b[1]), pi_match: hex(b[1]) === v.pi });
}
out.pass = out.steps.every((s) => s.differing_wires === 0 && s.native_r1cs_satisfied && s.pi_match);
fs.writeFileSync(outPath, JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify(out));
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(out.pass ? 0 : 1);
