// Constraint-count regression for transact_v2 (PLAN WP-CIRCUIT: 23,166 +- review delta). Reads the r1cs header.
// Baseline: the Phase 0 reference circuit, 23,166 constraints (circom 2.2.3 --O2).
// Review delta (circuits/v2/REVIEW_NOTES.md), measured by compiling each change on its own:
//   R1 nullifiers distinct        +1  (one multiplication with an inverse hint)
//   R2 R8 on the curve            +3  (BabyCheck: x^2, y^2, curve equation)
//   R3 assoc_root == 0            -3  (the 12-input statement Poseidon gets a constant lane; its first S-box folds)
//   total                         +1  -> 23,167
// Usage: node constraint_count.mjs <transact_v2.r1cs> [out.json]
import fs from "node:fs";

const [r1csPath, outPath] = process.argv.slice(2);
const b = fs.readFileSync(r1csPath);
if (b.subarray(0, 4).toString("latin1") !== "r1cs") throw new Error("not an r1cs file");
const nSec = b.readUInt32LE(8);
let o = 12;
let header = null;
for (let i = 0; i < nSec; i++) {
  const type = b.readUInt32LE(o);
  const size = Number(b.readBigUInt64LE(o + 4));
  if (type === 1) header = o + 12;
  o += 12 + size;
}
const n8 = b.readUInt32LE(header);
let p = header + 4 + n8;
const h = {
  wires: b.readUInt32LE(p),
  public_outputs: b.readUInt32LE(p + 4),
  public_inputs: b.readUInt32LE(p + 8),
  private_inputs: b.readUInt32LE(p + 12),
  labels: Number(b.readBigUInt64LE(p + 16)),
  constraints: b.readUInt32LE(p + 24),
};
const expected = { constraints: 23167, public_outputs: 1, public_inputs: 0, baseline: 23166, review_delta: { R1: 1, R2: 3, R3: -3 } };
const pass = h.constraints === expected.constraints && h.public_outputs === 1 && h.public_inputs === 0
  && expected.baseline + Object.values(expected.review_delta).reduce((a, x) => a + x, 0) === expected.constraints;
const out = { r1cs: r1csPath, header: h, expected, pass };
if (outPath) fs.writeFileSync(outPath, JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify(out));
process.exit(pass ? 0 : 1);
