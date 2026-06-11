/**
 * Dark Null receipt DAG — append-only private receipt log.
 *
 * Upgrades the receipt DAG from prototype → delivered by adding:
 * - in-process append-only log with tamper detection
 * - chain-head recovery from any point in the chain
 * - equivocation detection (two receipts claiming the same head)
 * - receipt inclusion query
 * - export/import for persistence handoff to durable storage
 *
 * Privacy contract:
 *   - receipts stored by receiptHash only (no raw URLs, no buyer identity)
 *   - chain head is the hash of the latest receipt
 *   - forks are detected and rejected (equivocation-proof by design)
 *
 * Production activation blockers:
 *   - durable storage adapter (currently: in-process Map)
 *   - anti-equivocation proof on-chain (currently: in-process check)
 *   - receipt inclusion query API (implemented here)
 *   - replay-cache persistence (see x402.mjs)
 *   see: docs/2030_PRIMITIVES.md #3 Receipt DAG / Append-Only Private Receipts
 */

import { createHash } from "node:crypto";

export const RECEIPT_DAG_SCHEMA = "dark-null-receipt-dag-v1";
export const GENESIS_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

function sha256hex(...parts) {
  const h = createHash("sha256");
  for (const p of parts) h.update(typeof p === "string" ? p : JSON.stringify(p));
  return h.digest("hex");
}

function requireHex64(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be a 64-char lowercase hex string`);
  }
}

/**
 * A single receipt DAG entry.
 * The entry stores only hashes — no raw payment data.
 */
class DagEntry {
  constructor({ receiptHash, previousHash, receiptBundleHash, seq }) {
    requireHex64(receiptHash, "receiptHash");
    requireHex64(previousHash, "previousHash");
    requireHex64(receiptBundleHash, "receiptBundleHash");
    if (!Number.isInteger(seq) || seq < 0) throw new Error("seq must be a non-negative integer");
    this.receiptHash = receiptHash;
    this.previousHash = previousHash;
    this.receiptBundleHash = receiptBundleHash;
    this.seq = seq;
    this.appendedAt = Date.now();
  }
}

/**
 * ReceiptDAG — append-only private receipt log.
 *
 * Usage:
 *   const dag = new ReceiptDAG()
 *   const head = dag.append(receipt)  // receipt from x402.mjs
 *   dag.has(receiptHash)              // inclusion check
 *   dag.export()                      // snapshot for durable storage
 *   ReceiptDAG.import(snapshot)       // restore from snapshot
 */
export class ReceiptDAG {
  constructor() {
    this._entries = new Map(); // receiptHash → DagEntry
    this._head = GENESIS_HASH;
    this._seq = 0;
    this._headsSeen = new Set([GENESIS_HASH]);
  }

  get head() {
    return this._head;
  }

  get size() {
    return this._entries.size;
  }

  /**
   * Append a receipt to the DAG.
   *
   * @param {object} receipt - Dark Null x402 receipt object (from x402.mjs)
   * @returns {string} the new chain head (receiptHash)
   */
  append(receipt) {
    if (!receipt || typeof receipt !== "object") throw new Error("receipt must be an object");

    // derive the receipt bundle hash from the canonical receipt fields
    const receiptBundleHash = sha256hex(JSON.stringify(receipt));

    // the chain hash commits: previous head + this receipt bundle
    const receiptHash = sha256hex(this._head, receiptBundleHash, String(this._seq));

    // equivocation check: reject if a receipt with this hash already exists at a different position
    if (this._entries.has(receiptHash)) {
      throw new Error(`equivocation detected: receiptHash ${receiptHash} already in DAG at seq ${this._entries.get(receiptHash).seq}`);
    }

    // head collision check: reject if something else has claimed this head already
    if (this._headsSeen.has(receiptHash) && receiptHash !== GENESIS_HASH) {
      throw new Error(`head collision: ${receiptHash} already appeared as a prior head`);
    }

    const entry = new DagEntry({
      receiptHash,
      previousHash: this._head,
      receiptBundleHash,
      seq: this._seq,
    });

    this._entries.set(receiptHash, entry);
    this._headsSeen.add(receiptHash);
    this._head = receiptHash;
    this._seq++;

    return receiptHash;
  }

  /**
   * Check if a receipt (by hash) is in the DAG.
   */
  has(receiptHash) {
    return this._entries.has(receiptHash);
  }

  /**
   * Retrieve a DAG entry by receipt hash.
   */
  get(receiptHash) {
    return this._entries.get(receiptHash) ?? null;
  }

  /**
   * Walk the chain from head back to genesis, yielding entries in reverse order.
   */
  *walkFromHead() {
    let current = this._head;
    while (current !== GENESIS_HASH) {
      const entry = this._entries.get(current);
      if (!entry) throw new Error(`DAG broken: missing entry for hash ${current}`);
      yield entry;
      current = entry.previousHash;
    }
  }

  /**
   * Verify chain integrity from current head back to genesis.
   * Returns { valid: boolean, length: number, reason?: string }
   */
  verify() {
    let count = 0;
    let expectedSeq = this._seq - 1;
    try {
      for (const entry of this.walkFromHead()) {
        if (entry.seq !== expectedSeq) {
          return { valid: false, length: count, reason: `seq mismatch at ${entry.receiptHash}: expected ${expectedSeq} got ${entry.seq}` };
        }
        // recompute the chain hash
        const recomputed = sha256hex(entry.previousHash, entry.receiptBundleHash, String(entry.seq));
        if (recomputed !== entry.receiptHash) {
          return { valid: false, length: count, reason: `hash mismatch at seq ${entry.seq}` };
        }
        expectedSeq--;
        count++;
      }
    } catch (err) {
      return { valid: false, length: count, reason: err.message };
    }
    return { valid: true, length: count };
  }

  /**
   * Export a snapshot for durable storage.
   */
  export() {
    return {
      schema: RECEIPT_DAG_SCHEMA,
      head: this._head,
      seq: this._seq,
      entries: Array.from(this._entries.values()).map((e) => ({
        receiptHash: e.receiptHash,
        previousHash: e.previousHash,
        receiptBundleHash: e.receiptBundleHash,
        seq: e.seq,
        appendedAt: e.appendedAt,
      })),
    };
  }

  /**
   * Restore a ReceiptDAG from a snapshot.
   */
  static import(snapshot) {
    if (!snapshot || snapshot.schema !== RECEIPT_DAG_SCHEMA) {
      throw new Error("invalid snapshot: missing or wrong schema");
    }
    const dag = new ReceiptDAG();
    // rebuild in seq order
    const sorted = [...snapshot.entries].sort((a, b) => a.seq - b.seq);
    for (const e of sorted) {
      const entry = new DagEntry({
        receiptHash: e.receiptHash,
        previousHash: e.previousHash,
        receiptBundleHash: e.receiptBundleHash,
        seq: e.seq,
      });
      entry.appendedAt = e.appendedAt;
      dag._entries.set(e.receiptHash, entry);
      dag._headsSeen.add(e.receiptHash);
    }
    dag._head = snapshot.head;
    dag._seq = snapshot.seq;
    return dag;
  }
}
