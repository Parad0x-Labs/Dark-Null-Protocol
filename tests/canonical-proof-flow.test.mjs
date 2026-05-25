import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snarkjsPath = path.join(repoRoot, "node_modules", "snarkjs", "build", "cli.cjs");
const wasmPath = path.join(repoRoot, "circuits", "null_proof_js", "null_proof.wasm");
const zkeyPath = path.join(repoRoot, "circuits", "null_proof_final.zkey");
const vkPath = path.join(repoRoot, "circuits", "vk.json");

const receiverToken = Array.from({ length: 32 }, (_, index) => index + 1);
const mint = Array.from({ length: 32 }, (_, index) => index + 33);

function pubkeyPart(bytes) {
  return BigInt(`0x${Buffer.concat([Buffer.alloc(16), Buffer.from(bytes)]).toString("hex")}`).toString();
}

const canonicalInputs = {
  amount: "1000000",
  receiver_token_part_0: pubkeyPart(receiverToken.slice(0, 16)),
  receiver_token_part_1: pubkeyPart(receiverToken.slice(16, 32)),
  mint_part_0: pubkeyPart(mint.slice(0, 16)),
  mint_part_1: pubkeyPart(mint.slice(16, 32)),
  blinding: "7",
  nullifier_secret: "99",
  pathElements: Array(7).fill("0"),
  pathIndices: Array(7).fill(0),
};

test("canonical root circuit artifacts generate and verify a Groth16 proof", { timeout: 120000 }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dark-null-proof-"));
  const inputPath = path.join(tempDir, "input.json");
  const proofPath = path.join(tempDir, "proof.json");
  const publicPath = path.join(tempDir, "public.json");
  const mutatedPublicPath = path.join(tempDir, "public-mutated-amount.json");

  try {
    await writeFile(inputPath, JSON.stringify(canonicalInputs), "utf8");

    execFileSync(process.execPath, [snarkjsPath, "groth16", "fullprove", inputPath, wasmPath, zkeyPath, proofPath, publicPath], {
      cwd: repoRoot,
      stdio: "pipe",
    });

    const publicSignals = JSON.parse(await readFile(publicPath, "utf8"));
    assert.equal(publicSignals.length, 8);
    assert.equal(publicSignals[0], "21260859212802281091863686367661377984066769844065718321274175068829072532590");
    assert.equal(publicSignals[1], "20771749344370779171742970368265706730294924718458058226975588733415774772728");
    assert.equal(publicSignals[2], "16592576418919036804106147633901944981094649374524182982969277443114172065406");
    assert.equal(publicSignals[3], canonicalInputs.amount);
    assert.equal(publicSignals[4], canonicalInputs.receiver_token_part_0);
    assert.equal(publicSignals[5], canonicalInputs.receiver_token_part_1);
    assert.equal(publicSignals[6], canonicalInputs.mint_part_0);
    assert.equal(publicSignals[7], canonicalInputs.mint_part_1);

    execFileSync(process.execPath, [snarkjsPath, "groth16", "verify", vkPath, publicPath, proofPath], {
      cwd: repoRoot,
      stdio: "pipe",
    });

    const mutatedPublicSignals = [...publicSignals];
    mutatedPublicSignals[3] = (BigInt(mutatedPublicSignals[3]) + 1n).toString();
    await writeFile(mutatedPublicPath, JSON.stringify(mutatedPublicSignals), "utf8");

    assert.throws(
      () =>
        execFileSync(process.execPath, [snarkjsPath, "groth16", "verify", vkPath, mutatedPublicPath, proofPath], {
          cwd: repoRoot,
          stdio: "pipe",
        }),
      /Command failed/,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
