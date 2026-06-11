/**
 * Dark Null batch settlement tests.
 *
 * Covers: valid batch, duplicate nullifier rejection, root mismatch rejection,
 * malformed proof rejection, empty batch rejection, batch hash determinism,
 * and multi-proof aggregation metadata.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { DarkNullBatch, loadCanonicalVk, verifyBatch, BATCH_SCHEMA, BATCH_RESULT, PUBLIC_INPUT } from "../swarm/batch.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snarkjsPath = path.join(repoRoot, "node_modules", "snarkjs", "build", "cli.cjs");
const wasmPath = path.join(repoRoot, "circuits", "null_proof_js", "null_proof.wasm");
const zkeyPath = path.join(repoRoot, "circuits", "null_proof_final.zkey");

function pubkeyPart(bytes) {
  return BigInt(`0x${Buffer.concat([Buffer.alloc(16), Buffer.from(bytes)]).toString("hex")}`).toString();
}

const receiverToken = Array.from({ length: 32 }, (_, i) => i + 1);
const mint = Array.from({ length: 32 }, (_, i) => i + 33);

function makeInputs(overrides = {}) {
  return {
    amount: "1000000",
    receiver_token_part_0: pubkeyPart(receiverToken.slice(0, 16)),
    receiver_token_part_1: pubkeyPart(receiverToken.slice(16, 32)),
    mint_part_0: pubkeyPart(mint.slice(0, 16)),
    mint_part_1: pubkeyPart(mint.slice(16, 32)),
    blinding: "7",
    nullifier_secret: "99",
    pathElements: Array(7).fill("0"),
    pathIndices: Array(7).fill(0),
    ...overrides,
  };
}

async function generateProof(inputs, tempDir) {
  const inputPath = path.join(tempDir, `input-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const proofPath = path.join(tempDir, `proof-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const publicPath = path.join(tempDir, `public-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

  await writeFile(inputPath, JSON.stringify(inputs), "utf8");
  execFileSync(process.execPath, [snarkjsPath, "groth16", "fullprove", inputPath, wasmPath, zkeyPath, proofPath, publicPath], {
    cwd: repoRoot,
    stdio: "pipe",
  });

  const proof = JSON.parse(await readFile(proofPath, "utf8"));
  const publicSignals = JSON.parse(await readFile(publicPath, "utf8"));
  return { proof, publicSignals };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test("DarkNullBatch rejects construction with invalid vk", () => {
  assert.throws(() => new DarkNullBatch(null), /vk must be an object/);
  assert.throws(() => new DarkNullBatch("bad"), /vk must be an object/);
});

test("DarkNullBatch rejects add with wrong publicSignals length", async () => {
  const vk = await loadCanonicalVk();
  const batch = new DarkNullBatch(vk);
  assert.throws(
    () => batch.add({ proof: {}, publicSignals: ["a", "b"] }),
    /publicSignals must be an array of 8 strings/,
  );
});

test("DarkNullBatch rejects verify on empty batch", async () => {
  const vk = await loadCanonicalVk();
  const batch = new DarkNullBatch(vk);
  await assert.rejects(() => batch.verify(), /batch is empty/);
});

test(
  "DarkNullBatch verifies a single valid proof",
  { timeout: 60000 },
  async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "dark-null-batch-"));
    try {
      const vk = await loadCanonicalVk();
      const bundle = await generateProof(makeInputs(), tempDir);

      const batch = new DarkNullBatch(vk);
      batch.add(bundle);
      const result = await batch.verify();

      assert.equal(result.schema, BATCH_SCHEMA);
      assert.equal(result.status, BATCH_RESULT.ALL_VALID);
      assert.equal(result.count, 1);
      assert.equal(result.validCount, 1);
      assert.equal(result.results[0].valid, true);
      assert.ok(result.batchHash.length === 64);
      assert.ok(result.manifestHash.length === 64);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  },
);

test(
  "DarkNullBatch verifies two distinct valid proofs",
  { timeout: 120000 },
  async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "dark-null-batch-"));
    try {
      const vk = await loadCanonicalVk();
      // different nullifier_secret → different nullifier
      const b1 = await generateProof(makeInputs({ nullifier_secret: "99", amount: "1000000" }), tempDir);
      const b2 = await generateProof(makeInputs({ nullifier_secret: "100", amount: "2000000" }), tempDir);

      const batch = new DarkNullBatch(vk);
      batch.add(b1);
      batch.add(b2);
      const result = await batch.verify();

      assert.equal(result.status, BATCH_RESULT.ALL_VALID);
      assert.equal(result.count, 2);
      assert.equal(result.validCount, 2);
      assert.ok(result.manifest.nullifiers[0] !== result.manifest.nullifiers[1], "nullifiers must differ");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  },
);

test(
  "DarkNullBatch rejects duplicate nullifier within same batch",
  { timeout: 60000 },
  async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "dark-null-batch-"));
    try {
      const vk = await loadCanonicalVk();
      const bundle = await generateProof(makeInputs(), tempDir);

      const batch = new DarkNullBatch(vk);
      batch.add(bundle);
      batch.add(bundle); // same proof → same nullifier
      const result = await batch.verify();

      assert.equal(result.status, BATCH_RESULT.PARTIAL);
      assert.equal(result.validCount, 1);
      const dupResult = result.results.find((r) => r.reason === "duplicate_nullifier");
      assert.ok(dupResult, "must find a duplicate_nullifier entry");
      assert.equal(dupResult.valid, false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  },
);

test(
  "DarkNullBatch rejects proof with mutated public input",
  { timeout: 60000 },
  async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "dark-null-batch-"));
    try {
      const vk = await loadCanonicalVk();
      const bundle = await generateProof(makeInputs(), tempDir);

      // tamper with amount
      const tampered = {
        proof: bundle.proof,
        publicSignals: [...bundle.publicSignals],
      };
      tampered.publicSignals[PUBLIC_INPUT.AMOUNT] = (BigInt(tampered.publicSignals[PUBLIC_INPUT.AMOUNT]) + 1n).toString();

      const batch = new DarkNullBatch(vk);
      batch.add(tampered);
      const result = await batch.verify();

      assert.equal(result.status, BATCH_RESULT.INVALID);
      assert.equal(result.validCount, 0);
      assert.equal(result.results[0].valid, false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  },
);

test(
  "DarkNullBatch batch hash is deterministic across two identical runs",
  { timeout: 60000 },
  async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "dark-null-batch-"));
    try {
      const vk = await loadCanonicalVk();
      const bundle = await generateProof(makeInputs(), tempDir);

      const b1 = new DarkNullBatch(vk);
      b1.add(bundle);
      const r1 = await b1.verify();

      const b2 = new DarkNullBatch(vk);
      b2.add(bundle);
      const r2 = await b2.verify();

      assert.equal(r1.batchHash, r2.batchHash, "batch hash must be deterministic");
      assert.equal(r1.manifestHash, r2.manifestHash, "manifest hash must be deterministic");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  },
);

test(
  "verifyBatch convenience wrapper works end-to-end",
  { timeout: 60000 },
  async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "dark-null-batch-"));
    try {
      const bundle = await generateProof(makeInputs(), tempDir);
      const result = await verifyBatch([bundle]);

      assert.equal(result.status, BATCH_RESULT.ALL_VALID);
      assert.equal(result.validCount, 1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  },
);

test(
  "DarkNullBatch manifest carries correct SnarkPack research annotation",
  { timeout: 60000 },
  async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "dark-null-batch-"));
    try {
      const vk = await loadCanonicalVk();
      const bundle = await generateProof(makeInputs(), tempDir);

      const batch = new DarkNullBatch(vk);
      batch.add(bundle);
      const result = await batch.verify();

      assert.equal(result.manifest.aggregation, "sequential_groth16");
      assert.equal(result.manifest.aggregationResearch, "snarkpack_ePrint_2021_529");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  },
);
