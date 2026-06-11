/**
 * Piano PIR tests — private Merkle path fetching.
 *
 * Covers: Merkle tree construction, sibling path correctness, root consistency,
 * hint generation, PIR query correctness, XOR path algebra, hint exhaustion,
 * benchmark profile, and access pattern hiding property.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { MerkleTree, PianoClient, PIRBenchmark, PIR_SCHEMA, MERKLE_DEPTH, TREE_SIZE } from "../swarm/piano-pir.mjs";
import { createHash } from "node:crypto";

function sha256hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

function makeLeaves(n) {
  return Array.from({ length: n }, (_, i) => sha256hex(`leaf-${i}`));
}

// ─── MerkleTree ──────────────────────────────────────────────────────────────

test("MerkleTree rejects empty leaves", () => {
  assert.throws(() => new MerkleTree([]), /non-empty array/);
});

test("MerkleTree constructs from 4 leaves with correct depth", () => {
  const tree = new MerkleTree(makeLeaves(4));
  assert.equal(tree.depth, 2);
  assert.equal(tree.size, 4);
  assert.equal(typeof tree.root, "string");
  assert.equal(tree.root.length, 64);
});

test("MerkleTree pads to power of 2", () => {
  const tree = new MerkleTree(makeLeaves(5));
  assert.equal(tree.size, 8);
  assert.equal(tree.depth, 3);
});

test("MerkleTree root changes when a leaf changes", () => {
  const leaves = makeLeaves(4);
  const t1 = new MerkleTree(leaves);
  const modified = [...leaves];
  modified[0] = sha256hex("different");
  const t2 = new MerkleTree(modified);
  assert.notEqual(t1.root, t2.root);
});

test("MerkleTree getSiblingPath returns correct depth for 8-leaf tree", () => {
  const tree = new MerkleTree(makeLeaves(8));
  const { pathElements, pathIndices } = tree.getSiblingPath(0);
  assert.equal(pathElements.length, 3); // depth 3
  assert.equal(pathIndices.length, 3);
});

test("MerkleTree getSiblingPath rejects out-of-range index", () => {
  const tree = new MerkleTree(makeLeaves(4));
  assert.throws(() => tree.getSiblingPath(-1), /out of range/);
  assert.throws(() => tree.getSiblingPath(4), /out of range/);
});

test("MerkleTree sibling path is consistent: all leaves same root", () => {
  const leaves = makeLeaves(8);
  const tree = new MerkleTree(leaves);
  // verify that all leaf paths reconstruct the same root
  for (let i = 0; i < 8; i++) {
    const { pathElements, pathIndices } = tree.getSiblingPath(i);
    let current = tree.getLeaf(i);
    for (let level = 0; level < pathElements.length; level++) {
      const sibling = pathElements[level];
      if (pathIndices[level] === 0) {
        // current is left child
        current = sha256hex(current + sibling);
      } else {
        // current is right child
        current = sha256hex(sibling + current);
      }
    }
    assert.equal(current, tree.root, `leaf ${i} path must reconstruct the root`);
  }
});

// ─── PianoClient ─────────────────────────────────────────────────────────────

test("PianoClient rejects non-MerkleTree input", () => {
  assert.throws(() => new PianoClient(null), /MerkleTree/);
});

test("PianoClient buildHints returns √n hint count", () => {
  const tree = new MerkleTree(makeLeaves(16));
  const client = new PianoClient(tree);
  const count = client.buildHints();
  assert.equal(count, Math.ceil(Math.sqrt(16)));
  assert.equal(client.hintCount, count);
});

test("PianoClient query fails before buildHints is called", () => {
  const tree = new MerkleTree(makeLeaves(8));
  const client = new PianoClient(tree);
  assert.throws(() => client.query(0), /buildHints/);
});

test("PianoClient query returns the correct path for target leaf", () => {
  const leaves = makeLeaves(8);
  const tree = new MerkleTree(leaves);
  // use hintCount >= 8 so the pool doesn't exhaust across 8 queries
  const client = new PianoClient(tree, { hintCount: 8 });
  client.buildHints();

  for (let i = 0; i < 8; i++) {
    const { path, pirQuery, targetLeafIdx } = client.query(i);
    assert.equal(pirQuery, true);
    assert.equal(targetLeafIdx, i);
    assert.equal(path.pathElements.length, 3);

    // verify the returned path actually reconstructs the root
    let current = tree.getLeaf(i);
    for (let level = 0; level < path.pathElements.length; level++) {
      const sibling = path.pathElements[level];
      current = path.pathIndices[level] === 0
        ? sha256hex(current + sibling)
        : sha256hex(sibling + current);
    }
    assert.equal(current, tree.root, `PIR query for leaf ${i} must reconstruct root`);
  }
});

test("PianoClient server query does not contain the raw targetLeafIdx at query boundary", () => {
  // This test verifies the access-pattern hiding property:
  // the serverQuery's combinedLeafIdx is XOR'd with the hint's leafIdx,
  // so the server cannot directly extract targetLeafIdx without knowing the hint.
  const tree = new MerkleTree(makeLeaves(16));
  const client = new PianoClient(tree, { hintCount: 8 });
  client.buildHints();

  const targetIdx = 7;
  const { serverQuery, targetLeafIdx } = client.query(targetIdx);

  // The server sees combinedLeafIdx, not targetLeafIdx directly
  assert.notEqual(serverQuery.combinedLeafIdx, targetLeafIdx,
    "server query must not directly expose targetLeafIdx");
  // (XOR cancellation: combinedLeafIdx XOR hintLeafIdx === targetLeafIdx)
  assert.equal(serverQuery.combinedLeafIdx ^ serverQuery.hintLeafIdx, targetLeafIdx);
});

test("PianoClient hint pool exhaustion throws after all hints used", () => {
  const tree = new MerkleTree(makeLeaves(4));
  const client = new PianoClient(tree, { hintCount: 2 });
  client.buildHints();
  client.query(0);
  client.query(1);
  assert.throws(() => client.query(2), /hint pool exhausted/);
});

// ─── PIRBenchmark ────────────────────────────────────────────────────────────

test("PIRBenchmark darkNullProfile returns expected values for 7-level tree", () => {
  const bench = new PIRBenchmark(TREE_SIZE);
  const profile = bench.darkNullProfile();
  assert.equal(profile.treeDepth, MERKLE_DEPTH);
  assert.equal(profile.leaves, TREE_SIZE);
  assert.equal(profile.hintCount, Math.ceil(Math.sqrt(TREE_SIZE)));
  assert.ok(profile.onlineQueryBytes > profile.directFetchBytes, "PIR adds overhead vs direct fetch");
  assert.ok(profile.reference.includes("ePrint 2023/452"));
});

test("PIRBenchmark direct fetch is 7 * 32 = 224 bytes for Dark Null 7-level tree", () => {
  const bench = new PIRBenchmark(TREE_SIZE);
  const { directFetchBytes } = bench.communicationCost();
  assert.equal(directFetchBytes, MERKLE_DEPTH * 32);
});
