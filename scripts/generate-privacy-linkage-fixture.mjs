#!/usr/bin/env node
// Generates tests/fixtures/privacy-linkage.json: two distinct deposit notes and one
// real Groth16 withdrawal proof (canonical circuit wasm + zkey) that spends note B.
//
// The fixture feeds two tests:
//   - tests/privacy_linkage.rs        runs the real program entrypoint (deposit x2,
//                                     update_root, prepare_phantom_withdraw_v2 with
//                                     the on-chain Groth16 verifier) and an observer
//                                     that sees only public instruction data,
//                                     account metas and logs.
//   - tests/privacy-linkage.test.mjs  re-verifies the proof against circuits/vk.json
//                                     and re-derives the commitments from the circuit.
//
// Tree convention used here: depth 7, leaf 0 = note A, leaf 1 = note B, every empty
// node is the constant 0. The program does not recompute roots on-chain; the root
// authority posts the root, so any consistent convention exercises the same path.

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { proofToGroth16Solana, toHex } from "./g16_bytes.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snarkjsPath = path.join(repoRoot, "node_modules", "snarkjs", "build", "cli.cjs");
const wasmPath = path.join(repoRoot, "circuits", "null_proof_js", "null_proof.wasm");
const zkeyPath = path.join(repoRoot, "circuits", "null_proof_final.zkey");
const vkPath = path.join(repoRoot, "circuits", "vk.json");
const fixturePath = path.join(repoRoot, "tests", "fixtures", "privacy-linkage.json");

const LEVELS = 7;
const AMOUNT = "1000000"; // both deposits use the same amount, so amount alone cannot separate them
const fill = (byte) => Buffer.alloc(32, byte);
const MINT = fill(0x33);

// Test-only note openings. They exist so the fixture can be regenerated and
// re-derived; the observer in tests/privacy_linkage.rs never reads them.
export const NOTES = [
  { label: "A", receiver_token: fill(0xa1), receiver: fill(0xa2), blinding: "1111111111", nullifier_secret: "2222222222" },
  { label: "B", receiver_token: fill(0xb1), receiver: fill(0xb2), blinding: "3333333333", nullifier_secret: "4444444444" },
];

export function pubkeyPart(bytes16) {
  return BigInt(`0x${Buffer.concat([Buffer.alloc(16), Buffer.from(bytes16)]).toString("hex")}`).toString();
}

export function circuitInput(note, pathElements, pathIndices) {
  return {
    amount: AMOUNT,
    receiver_token_part_0: pubkeyPart(note.receiver_token.subarray(0, 16)),
    receiver_token_part_1: pubkeyPart(note.receiver_token.subarray(16, 32)),
    mint_part_0: pubkeyPart(MINT.subarray(0, 16)),
    mint_part_1: pubkeyPart(MINT.subarray(16, 32)),
    blinding: note.blinding,
    nullifier_secret: note.nullifier_secret,
    pathElements,
    pathIndices,
  };
}

export async function fullProve(input) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dark-null-linkage-"));
  try {
    const inputPath = path.join(dir, "input.json");
    const proofPath = path.join(dir, "proof.json");
    const publicPath = path.join(dir, "public.json");
    await writeFile(inputPath, JSON.stringify(input), "utf8");
    execFileSync(process.execPath, [snarkjsPath, "groth16", "fullprove", inputPath, wasmPath, zkeyPath, proofPath, publicPath], {
      cwd: repoRoot,
      stdio: "pipe",
    });
    execFileSync(process.execPath, [snarkjsPath, "groth16", "verify", vkPath, publicPath, proofPath], {
      cwd: repoRoot,
      stdio: "pipe",
    });
    return {
      proof: JSON.parse(await readFile(proofPath, "utf8")),
      publicSignals: JSON.parse(await readFile(publicPath, "utf8")),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const zeros = () => Array(LEVELS).fill("0");
const be32Hex = (dec) => BigInt(dec).toString(16).padStart(64, "0");
const sha256File = async (file) => crypto.createHash("sha256").update(await readFile(file)).digest("hex");

async function main() {
  // 1. Commitments do not depend on the Merkle path, so derive them first.
  const commitments = [];
  for (const note of NOTES) {
    const { publicSignals } = await fullProve(circuitInput(note, zeros(), zeros()));
    commitments.push(publicSignals[0]);
  }
  const [commitmentA, commitmentB] = commitments;
  if (commitmentA === commitmentB) throw new Error("notes must produce distinct commitments");

  // 2. Spend note B at leaf index 1 (sibling = leaf 0 = note A).
  const spendB = await fullProve(
    circuitInput(NOTES[1], [commitmentA, ...Array(LEVELS - 1).fill("0")], [1, ...Array(LEVELS - 1).fill(0)]),
  );
  // 3. Cross-check: note A at leaf index 0 yields the same root.
  const rootFromA = await fullProve(
    circuitInput(NOTES[0], [commitmentB, ...Array(LEVELS - 1).fill("0")], zeros()),
  );
  const root = spendB.publicSignals[2];
  if (rootFromA.publicSignals[2] !== root) throw new Error("both leaves must resolve to one root");
  if (spendB.publicSignals[0] !== commitmentB) throw new Error("withdrawal commitment output must equal note B");

  const g16 = proofToGroth16Solana(spendB.proof, spendB.publicSignals);
  const fixture = {
    description:
      "Two deposits with distinct notes and one real Groth16 withdrawal proof spending note B. Generated by scripts/generate-privacy-linkage-fixture.mjs; consumed by tests/privacy_linkage.rs and tests/privacy-linkage.test.mjs.",
    circuit: {
      wasm_sha256: await sha256File(wasmPath),
      zkey_sha256: await sha256File(zkeyPath),
      vk_sha256: await sha256File(vkPath),
      levels: LEVELS,
      tree_convention: "leaf0 = note A, leaf1 = note B, empty nodes = 0",
    },
    mint_hex: MINT.toString("hex"),
    root_hex: be32Hex(root),
    deposits: NOTES.map((note, index) => ({
      label: note.label,
      amount: AMOUNT,
      commitment_dec: commitments[index],
      commitment_hex: be32Hex(commitments[index]),
    })),
    withdrawal: {
      spends_label: "B",
      receiver_hex: NOTES[1].receiver.toString("hex"),
      receiver_token_hex: NOTES[1].receiver_token.toString("hex"),
      amount: AMOUNT,
      nullifier_hex: be32Hex(spendB.publicSignals[1]),
      proof_a_hex: toHex(g16.proof_a),
      proof_b_hex: toHex(g16.proof_b),
      proof_c_hex: toHex(g16.proof_c),
      public_inputs_hex: g16.public_inputs.map(toHex),
      public_signals_dec: spendB.publicSignals,
      snarkjs_proof: spendB.proof,
    },
    test_only_note_openings: NOTES.map((note) => ({
      label: note.label,
      receiver_token_hex: note.receiver_token.toString("hex"),
      receiver_hex: note.receiver.toString("hex"),
      blinding: note.blinding,
      nullifier_secret: note.nullifier_secret,
    })),
  };

  await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  console.log(`wrote ${path.relative(repoRoot, fixturePath)}`);
  console.log(`commitment A ${fixture.deposits[0].commitment_hex}`);
  console.log(`commitment B ${fixture.deposits[1].commitment_hex}`);
  console.log(`root         ${fixture.root_hex}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
