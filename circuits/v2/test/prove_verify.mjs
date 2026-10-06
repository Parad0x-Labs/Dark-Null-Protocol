// snarkjs Groth16 proof for each V-E2E step with the dev-setup key; verify with vk.json; negative checks.
// Also writes each proof in the program wire format (V2_SPEC 2.6: A negated, 256 bytes) for the devnet probe.
// Usage: node prove_verify.mjs <v2.wasm> <transact_v2_dev.zkey> <vk.json> <V-E2E.json> <out.json>
import fs from "node:fs";
import * as snarkjs from "snarkjs";
import { R, readJson, hex } from "./lib.mjs";
import { validCases } from "./cases.mjs";

const [wasm, zkey, vkPath, e2ePath, outPath] = process.argv.slice(2);
const E2E = readJson(e2ePath);
const vk = readJson(vkPath);
const Q = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
const be = (x) => BigInt(x).toString(16).padStart(64, "0");

// V2_SPEC 2.6: A negated by the client, B as x.c1 || x.c0 || y.c1 || y.c0, C as x || y; big-endian.
export function encodeProof(p) {
  const a = be(p.pi_a[0]) + be((Q - BigInt(p.pi_a[1])) % Q);
  const b = be(p.pi_b[0][1]) + be(p.pi_b[0][0]) + be(p.pi_b[1][1]) + be(p.pi_b[1][0]);
  const c = be(p.pi_c[0]) + be(p.pi_c[1]);
  return a + b + c;
}

const out = { zkey, vk: vkPath, steps: [] };
for (const v of validCases(E2E)) {
  const wtns = { type: "mem" };
  const t0 = performance.now();
  await snarkjs.wtns.calculate(v.input, wasm, wtns);
  const t1 = performance.now();
  const { proof, publicSignals } = await snarkjs.groth16.prove(zkey, wtns);
  const t2 = performance.now();
  const ok = await snarkjs.groth16.verify(vk, publicSignals, proof);
  const badPi = await snarkjs.groth16.verify(vk, [((BigInt(publicSignals[0]) + 1n) % R).toString()], proof);
  const badProof = await snarkjs.groth16.verify(vk, publicSignals, { ...proof, pi_c: proof.pi_a });
  out.steps.push({
    step: v.step,
    pi: hex(publicSignals[0]),
    expected_pi: v.pi,
    n_public: publicSignals.length,
    verified: ok,
    rejects_pi_plus_1: !badPi,
    rejects_swapped_c: !badProof,
    witness_ms: +(t1 - t0).toFixed(1),
    prove_ms: +(t2 - t1).toFixed(1),
    proof,
    proof_bytes: encodeProof(proof),
    pi_bytes: be(publicSignals[0]),
  });
}
out.pass = out.steps.every((s) => s.verified && s.n_public === 1 && s.pi === s.expected_pi && s.rejects_pi_plus_1 && s.rejects_swapped_c);
fs.writeFileSync(outPath, JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify(out.steps.map(({ step, pi, verified, rejects_pi_plus_1, rejects_swapped_c, prove_ms }) => ({ step, pi, verified, rejects_pi_plus_1, rejects_swapped_c, prove_ms })).concat([{ pass: out.pass }])));
process.exit(out.pass ? 0 : 1);
