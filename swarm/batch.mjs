/**
 * Dark Null batch settlement — off-chain Groth16 proof batch verifier.
 *
 * Verifies N independent Dark Null proofs in a single batch pass with:
 * - cross-batch duplicate nullifier detection (critical: double-spend prevention)
 * - per-proof vk consistency check
 * - deterministic batch hash binding all nullifiers + roots + amounts
 * - batch manifest for receipt chaining
 *
 * Current complexity: O(N) sequential verification.
 * Research target: O(log N) via SnarkPack aggregation (docs/RECURSIVE_BATCHING.md).
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const BATCH_SCHEMA = "dark-null-batch-v1";
export const BATCH_PROOF_VERSION = "groth16-bn254-8signal";

export const PUBLIC_INPUT = Object.freeze({
  COMMITMENT: 0,
  NULLIFIER: 1,
  ROOT: 2,
  AMOUNT: 3,
  RECEIVER_TOKEN_PART_0: 4,
  RECEIVER_TOKEN_PART_1: 5,
  MINT_PART_0: 6,
  MINT_PART_1: 7,
});

export const BATCH_RESULT = Object.freeze({
  ALL_VALID: "all_valid",
  PARTIAL: "partial",
  INVALID: "invalid",
});

function batchHash(entries) {
  const h = createHash("sha256");
  h.update(BATCH_SCHEMA);
  for (const e of entries) {
    h.update(e.nullifier ?? "missing");
    h.update("|");
    h.update(e.root ?? "0");
    h.update("|");
    h.update(e.amount ?? "0");
    h.update(";");
  }
  return h.digest("hex");
}

function metaHash(manifest) {
  const h = createHash("sha256");
  h.update(JSON.stringify(manifest));
  return h.digest("hex");
}

/**
 * Load the canonical vk.json from the repo root circuits directory.
 */
export async function loadCanonicalVk(vkPath) {
  const resolvedPath = vkPath ?? path.join(repoRoot, "circuits", "vk.json");
  const raw = await readFile(resolvedPath, "utf8");
  return JSON.parse(raw);
}

/**
 * DarkNullBatch — collects proof bundles and verifies them as a batch.
 *
 * Usage:
 *   const batch = new DarkNullBatch(vk)
 *   batch.add({ proof, publicSignals })
 *   batch.add({ proof, publicSignals })
 *   const result = await batch.verify()
 */
export class DarkNullBatch {
  constructor(vk, opts = {}) {
    if (!vk || typeof vk !== "object") throw new Error("vk must be an object (parsed vk.json)");
    this._vk = vk;
    this._entries = [];
    this._requireSameRoot = opts.requireSameRoot ?? false;
  }

  /**
   * Add a proof bundle to the batch.
   * @param {object} bundle - { proof: snarkjsProof, publicSignals: string[] }
   */
  add(bundle) {
    if (!bundle || typeof bundle !== "object") throw new Error("bundle must be { proof, publicSignals }");
    if (!Array.isArray(bundle.publicSignals) || bundle.publicSignals.length !== 8) {
      throw new Error("publicSignals must be an array of 8 strings (8-signal NullProofV2)");
    }
    if (!bundle.proof || typeof bundle.proof !== "object") throw new Error("bundle.proof must be a snarkjs groth16 proof object");
    this._entries.push(bundle);
  }

  get size() {
    return this._entries.length;
  }

  /**
   * Verify all proofs in the batch.
   * Returns a BatchVerifyResult with per-proof details and an aggregate batch hash.
   */
  async verify() {
    if (this._entries.length === 0) throw new Error("batch is empty — add at least one proof bundle");

    const { groth16 } = await import("snarkjs");

    const nullifiers = new Set();
    const results = [];
    let validCount = 0;

    const firstRoot = this._entries[0].publicSignals[PUBLIC_INPUT.ROOT];

    for (let i = 0; i < this._entries.length; i++) {
      const { proof, publicSignals } = this._entries[i];

      const nullifier = publicSignals[PUBLIC_INPUT.NULLIFIER];
      const root = publicSignals[PUBLIC_INPUT.ROOT];
      const amount = publicSignals[PUBLIC_INPUT.AMOUNT];
      const commitment = publicSignals[PUBLIC_INPUT.COMMITMENT];

      // duplicate nullifier check — hard fail
      if (nullifiers.has(nullifier)) {
        results.push({ index: i, valid: false, reason: "duplicate_nullifier", nullifier, root, amount, commitment });
        continue;
      }
      nullifiers.add(nullifier);

      // root consistency check (optional)
      if (this._requireSameRoot && root !== firstRoot) {
        results.push({ index: i, valid: false, reason: "root_mismatch", nullifier, root, amount, commitment });
        continue;
      }

      // verify the Groth16 proof
      let valid = false;
      let reason = null;
      try {
        valid = await groth16.verify(this._vk, publicSignals, proof);
        if (!valid) reason = "proof_invalid";
      } catch (err) {
        reason = `verify_error: ${err.message}`;
      }

      if (valid) validCount++;
      results.push({ index: i, valid, reason, nullifier, root, amount, commitment });
    }

    const allValid = validCount === this._entries.length;
    const status = allValid ? BATCH_RESULT.ALL_VALID : validCount > 0 ? BATCH_RESULT.PARTIAL : BATCH_RESULT.INVALID;

    const batchHashValue = batchHash(results);
    const manifest = this._buildManifest(results, status, batchHashValue);
    const manifestHashValue = metaHash(manifest);

    return {
      schema: BATCH_SCHEMA,
      proofVersion: BATCH_PROOF_VERSION,
      status,
      count: this._entries.length,
      validCount,
      batchHash: batchHashValue,
      manifestHash: manifestHashValue,
      manifest,
      results,
    };
  }

  _buildManifest(results, status, batchHashValue) {
    return {
      schema: BATCH_SCHEMA,
      proofVersion: BATCH_PROOF_VERSION,
      status,
      count: this._entries.length,
      batchHash: batchHashValue,
      nullifiers: results.map((r) => r.nullifier),
      roots: results.map((r) => r.root),
      amounts: results.map((r) => r.amount),
      commitments: results.map((r) => r.commitment),
      requireSameRoot: this._requireSameRoot,
      // research target: replace sequential verify with SnarkPack O(log N) aggregate
      // see: docs/RECURSIVE_BATCHING.md, ePrint 2021/529
      aggregation: "sequential_groth16",
      aggregationResearch: "snarkpack_ePrint_2021_529",
    };
  }

  /**
   * Export the batch manifest for receipt chaining or anchoring.
   */
  manifest() {
    return {
      schema: BATCH_SCHEMA,
      count: this._entries.length,
      nullifiers: this._entries.map((e) => e.publicSignals[PUBLIC_INPUT.NULLIFIER]),
      roots: this._entries.map((e) => e.publicSignals[PUBLIC_INPUT.ROOT]),
      amounts: this._entries.map((e) => e.publicSignals[PUBLIC_INPUT.AMOUNT]),
    };
  }
}

/**
 * Convenience: verify a pre-collected array of proof bundles in one call.
 */
export async function verifyBatch(bundles, vk, opts = {}) {
  const resolvedVk = vk ?? (await loadCanonicalVk());
  const batch = new DarkNullBatch(resolvedVk, opts);
  for (const b of bundles) batch.add(b);
  return batch.verify();
}
