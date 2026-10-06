// Proof-level half of the deposit-to-withdrawal linkage reproduction.
// The program-level half (real entrypoint, on-chain Groth16 verifier, SPL Token
// transfers, observer over instruction data/accounts/logs) is tests/privacy_linkage.rs.
//
// This test asserts the CURRENT behaviour of the canonical circuit: the withdrawal
// proof's public signals contain the note commitment, the amount, the receiver token
// account and the mint, so a public observer links the withdrawal to its deposit by
// commitment equality. See docs/PRIVACY_PROPERTIES.md.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { circuitInput, fullProve } from "../scripts/generate-privacy-linkage-fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snarkjsPath = path.join(repoRoot, "node_modules", "snarkjs", "build", "cli.cjs");
const vkPath = path.join(repoRoot, "circuits", "vk.json");
const fixture = JSON.parse(await readFile(path.join(repoRoot, "tests", "fixtures", "privacy-linkage.json"), "utf8"));

const sha256File = async (rel) => crypto.createHash("sha256").update(await readFile(path.join(repoRoot, rel))).digest("hex");
const be32Hex = (dec) => BigInt(dec).toString(16).padStart(64, "0");
const pubkeyHexFromParts = (part0, part1) => be32Hex(part0).slice(32) + be32Hex(part1).slice(32);

// Observer: receives only what is public on-chain (deposit instruction args and the
// withdrawal's public proof inputs). No note openings.
function observe(publicView) {
  const [commitment, nullifier, root, amount, rt0, rt1, m0, m1] = publicView.withdrawal.publicSignals;
  const candidatesByAmount = publicView.deposits.filter((d) => d.amount === amount).map((d) => d.label);
  const candidatesByCommitment = publicView.deposits.filter((d) => d.commitment === commitment).map((d) => d.label);
  return {
    candidatesByAmount,
    candidatesByCommitment,
    exposed: {
      commitment,
      nullifier,
      root,
      amount,
      receiverTokenHex: pubkeyHexFromParts(rt0, rt1),
      mintHex: pubkeyHexFromParts(m0, m1),
    },
  };
}

test("fixture is bound to the canonical circuit artifacts", async () => {
  assert.equal(fixture.circuit.wasm_sha256, await sha256File("circuits/null_proof_js/null_proof.wasm"));
  assert.equal(fixture.circuit.zkey_sha256, await sha256File("circuits/null_proof_final.zkey"));
  assert.equal(fixture.circuit.vk_sha256, await sha256File("circuits/vk.json"));
});

test("fixture withdrawal proof verifies against circuits/vk.json", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dark-null-linkage-verify-"));
  try {
    const proofPath = path.join(dir, "proof.json");
    const publicPath = path.join(dir, "public.json");
    await writeFile(proofPath, JSON.stringify(fixture.withdrawal.snarkjs_proof), "utf8");
    await writeFile(publicPath, JSON.stringify(fixture.withdrawal.public_signals_dec), "utf8");
    execFileSync(process.execPath, [snarkjsPath, "groth16", "verify", vkPath, publicPath, proofPath], { cwd: repoRoot, stdio: "pipe" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  assert.deepEqual(fixture.withdrawal.public_inputs_hex, fixture.withdrawal.public_signals_dec.map(be32Hex));
});

test("deposit commitments re-derive from the circuit and are distinct", { timeout: 120000 }, async () => {
  const zeros = Array(fixture.circuit.levels).fill("0");
  for (const [index, opening] of fixture.test_only_note_openings.entries()) {
    const note = { ...opening, receiver_token: Buffer.from(opening.receiver_token_hex, "hex") };
    const { publicSignals } = await fullProve(circuitInput(note, zeros, zeros));
    assert.equal(publicSignals[0], fixture.deposits[index].commitment_dec);
  }
  assert.notEqual(fixture.deposits[0].commitment_dec, fixture.deposits[1].commitment_dec);
});

test("current construction: a public observer links the withdrawal to its deposit by commitment", () => {
  const publicView = {
    deposits: fixture.deposits.map((d) => ({ label: d.label, amount: d.amount, commitment: d.commitment_dec })),
    withdrawal: { publicSignals: fixture.withdrawal.public_signals_dec },
  };
  const report = observe(publicView);

  assert.deepEqual(report.candidatesByAmount, ["A", "B"], "equal amounts: amount alone is ambiguous");
  assert.deepEqual(report.candidatesByCommitment, ["B"], "commitment equality leaves exactly one candidate");
  assert.equal(report.candidatesByCommitment[0], fixture.withdrawal.spends_label);

  assert.equal(report.exposed.amount, fixture.withdrawal.amount);
  assert.equal(report.exposed.receiverTokenHex, fixture.withdrawal.receiver_token_hex);
  assert.equal(report.exposed.mintHex, fixture.mint_hex);
  assert.equal(be32Hex(report.exposed.root), fixture.root_hex);
  assert.equal(be32Hex(report.exposed.nullifier), fixture.withdrawal.nullifier_hex);
});
