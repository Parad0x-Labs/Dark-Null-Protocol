import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snarkjsPath = path.join(repoRoot, "node_modules", "snarkjs", "build", "cli.cjs");
const wasmPath = path.join(repoRoot, "circuits", "null_proof_js", "null_proof.wasm");
const zkeyPath = path.join(repoRoot, "circuits", "null_proof_final.zkey");
const vkPath = path.join(repoRoot, "circuits", "vk.json");

const canonicalInput = {
  amount: "1000000",
  blinding: "7",
  nullifier_secret: "99",
  root: "21400004692153895819275719573511056573585842202260377849491291672960823998665",
  pathElements: Array(7).fill("0"),
  pathIndices: Array(7).fill(0),
};

test("canonical verifier rejects a deterministically malformed proof", { timeout: 120000 }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dark-null-bad-proof-"));
  try {
    const inputPath = path.join(tempDir, "input.json");
    const proofPath = path.join(tempDir, "proof.json");
    const malformedPath = path.join(tempDir, "proof.malformed.json");
    const publicPath = path.join(tempDir, "public.json");

    await writeFile(inputPath, JSON.stringify(canonicalInput), "utf8");
    execFileSync(process.execPath, [snarkjsPath, "groth16", "fullprove", inputPath, wasmPath, zkeyPath, proofPath, publicPath], {
      cwd: repoRoot,
      stdio: "pipe",
    });
    execFileSync(process.execPath, [snarkjsPath, "groth16", "verify", vkPath, publicPath, proofPath], {
      cwd: repoRoot,
      stdio: "pipe",
    });

    const proof = JSON.parse(await readFile(proofPath, "utf8"));
    proof.pi_a[0] = (BigInt(proof.pi_a[0]) + 1n).toString();
    await writeFile(malformedPath, JSON.stringify(proof), "utf8");

    assert.throws(
      () =>
        execFileSync(process.execPath, [snarkjsPath, "groth16", "verify", vkPath, publicPath, malformedPath], {
          cwd: repoRoot,
          stdio: "pipe",
        }),
      /Command failed/,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
