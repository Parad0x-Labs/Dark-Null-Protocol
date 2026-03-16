import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snarkjsPath = path.join(repoRoot, "node_modules", ".bin", "snarkjs");
const wasmPath = path.join(repoRoot, "circuits", "null_proof_js", "null_proof.wasm");
const zkeyPath = path.join(repoRoot, "circuits", "null_proof_final.zkey");
const vkPath = path.join(repoRoot, "circuits", "vk.json");

const canonicalInputs = {
  amount: "1000000",
  blinding: "7",
  nullifier_secret: "99",
  root: "21400004692153895819275719573511056573585842202260377849491291672960823998665",
  pathElements: Array(7).fill("0"),
  pathIndices: Array(7).fill(0),
};

test("canonical root circuit artifacts generate and verify a Groth16 proof", { timeout: 120000 }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dark-null-proof-"));
  const inputPath = path.join(tempDir, "input.json");
  const proofPath = path.join(tempDir, "proof.json");
  const publicPath = path.join(tempDir, "public.json");

  try {
    await writeFile(inputPath, JSON.stringify(canonicalInputs), "utf8");

    execFileSync(snarkjsPath, ["groth16", "fullprove", inputPath, wasmPath, zkeyPath, proofPath, publicPath], {
      cwd: repoRoot,
      stdio: "pipe",
    });

    const publicSignals = JSON.parse(await readFile(publicPath, "utf8"));
    assert.equal(publicSignals.length, 3);
    assert.equal(publicSignals[0], "4883420918941545271209898763027081868674067317782929581070619755169613001115");
    assert.equal(publicSignals[1], "20771749344370779171742970368265706730294924718458058226975588733415774772728");
    assert.equal(publicSignals[2], canonicalInputs.root);

    execFileSync(snarkjsPath, ["groth16", "verify", vkPath, publicPath, proofPath], {
      cwd: repoRoot,
      stdio: "pipe",
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
