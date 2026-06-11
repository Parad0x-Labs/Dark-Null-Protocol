import { strict as assert } from "node:assert";
import { test } from "node:test";
import { secp256k1 } from "@noble/curves/secp256k1";

import {
  THRESHOLD_MINT_SCHEMA,
  aggregatePartialResponses,
  blindSecret,
  generateFederation,
  partialSign,
  shamirSplit,
  unblind,
  verifyToken,
  verifyTokenStructure,
} from "../swarm/threshold-mint.mjs";

// ─── Shamir's Secret Sharing ──────────────────────────────────────────────────

test("shamirSplit returns exactly n shares with 1-based indices", () => {
  // secp256k1 imported at top-level
  const secret = BigInt("0x" + Buffer.from(secp256k1.utils.randomPrivateKey()).toString("hex"));
  const shares = shamirSplit(secret, 5, 3);
  assert.equal(shares.length, 5);
  for (let i = 0; i < 5; i++) {
    assert.equal(shares[i].index, i + 1);
  }
});

test("shamirSplit rejects threshold > total_signers", () => {
  // secp256k1 imported at top-level
  const secret = BigInt("0x" + Buffer.from(secp256k1.utils.randomPrivateKey()).toString("hex"));
  assert.throws(() => shamirSplit(secret, 3, 4), /threshold/);
});

// ─── Federation setup ─────────────────────────────────────────────────────────

test("generateFederation returns correct count of signers with schema", () => {
  const fed = generateFederation(3, 2);
  assert.equal(fed.schema, THRESHOLD_MINT_SCHEMA);
  assert.equal(fed.total_signers, 3);
  assert.equal(fed.threshold, 2);
  assert.equal(fed.signers.length, 3);
  for (let i = 0; i < 3; i++) {
    assert.equal(fed.signers[i].index, i + 1);
    assert.equal(fed.signers[i].pub_share.length, 66);
  }
});

test("generateFederation rejects total_signers < 2", () => {
  assert.throws(() => generateFederation(1, 1), /at least 2/);
});

// ─── Full k-of-n token issuance ───────────────────────────────────────────────

test("2-of-3 federation: any 2 signers produce a valid token", () => {
  const fed = generateFederation(3, 2);
  // secp256k1 imported at top-level
  const secret = Buffer.from(secp256k1.utils.randomPrivateKey()).toString("hex");

  const blind_req = blindSecret(secret);
  const partial_1 = partialSign(fed.signers[0], blind_req.blinded_point);
  const partial_2 = partialSign(fed.signers[1], blind_req.blinded_point);

  const agg = aggregatePartialResponses([partial_1, partial_2]);
  const token = unblind(blind_req, agg, fed.aggregate_pubkey);

  assert.ok(verifyToken(token, fed.aggregate_privkey), "token must verify against aggregate key");
  assert.ok(verifyTokenStructure(token), "token structure must be valid");
  assert.equal(token.schema, THRESHOLD_MINT_SCHEMA);
});

test("2-of-3 federation: signers {1,3} also produce a valid token", () => {
  const fed = generateFederation(3, 2);
  // secp256k1 imported at top-level
  const secret = Buffer.from(secp256k1.utils.randomPrivateKey()).toString("hex");

  const blind_req = blindSecret(secret);
  const partial_1 = partialSign(fed.signers[0], blind_req.blinded_point);
  const partial_3 = partialSign(fed.signers[2], blind_req.blinded_point);

  const agg = aggregatePartialResponses([partial_1, partial_3]);
  const token = unblind(blind_req, agg, fed.aggregate_pubkey);

  assert.ok(verifyToken(token, fed.aggregate_privkey));
});

test("3-of-5 federation: any 3 signers produce a valid token", () => {
  const fed = generateFederation(5, 3);
  // secp256k1 imported at top-level
  const secret = Buffer.from(secp256k1.utils.randomPrivateKey()).toString("hex");

  const blind_req = blindSecret(secret);
  // Use signers 2, 3, 4 (indices 2, 3, 4 → signers[1], signers[2], signers[3])
  const partials = [
    partialSign(fed.signers[1], blind_req.blinded_point),
    partialSign(fed.signers[2], blind_req.blinded_point),
    partialSign(fed.signers[3], blind_req.blinded_point),
  ];

  const agg = aggregatePartialResponses(partials);
  const token = unblind(blind_req, agg, fed.aggregate_pubkey);

  assert.ok(verifyToken(token, fed.aggregate_privkey));
});

test("all n signers produce a valid token (not just minimum k)", () => {
  const fed = generateFederation(4, 2);
  // secp256k1 imported at top-level
  const secret = Buffer.from(secp256k1.utils.randomPrivateKey()).toString("hex");

  const blind_req = blindSecret(secret);
  const partials = fed.signers.map((s) => partialSign(s, blind_req.blinded_point));
  const agg = aggregatePartialResponses(partials);
  const token = unblind(blind_req, agg, fed.aggregate_pubkey);

  assert.ok(verifyToken(token, fed.aggregate_privkey));
});

test("1-of-n threshold works (single signer)", () => {
  const fed = generateFederation(3, 1);
  // secp256k1 imported at top-level
  const secret = Buffer.from(secp256k1.utils.randomPrivateKey()).toString("hex");

  const blind_req = blindSecret(secret);
  const partial = partialSign(fed.signers[0], blind_req.blinded_point);
  const agg = aggregatePartialResponses([partial]);
  const token = unblind(blind_req, agg, fed.aggregate_pubkey);

  assert.ok(verifyToken(token, fed.aggregate_privkey));
});

test("token produced by threshold mint is structurally identical to single-signer BDHKE token", () => {
  const fed = generateFederation(2, 2);
  // secp256k1 imported at top-level
  const secret = Buffer.from(secp256k1.utils.randomPrivateKey()).toString("hex");

  const blind_req = blindSecret(secret);
  const partials = fed.signers.map((s) => partialSign(s, blind_req.blinded_point));
  const agg = aggregatePartialResponses(partials);
  const token = unblind(blind_req, agg, fed.aggregate_pubkey);

  // Same fields as blind-token: schema, secret, C, aggregate_pubkey
  assert.ok(token.schema);
  assert.ok(token.secret);
  assert.equal(token.C.length, 66);
});

test("wrong number of signers: k-1 partial responses produce invalid token", () => {
  // With 2-of-3, using only 1 signer should produce wrong C'
  const fed = generateFederation(3, 2);
  // secp256k1 imported at top-level
  const secret = Buffer.from(secp256k1.utils.randomPrivateKey()).toString("hex");

  const blind_req = blindSecret(secret);
  // Aggregate only 1 partial response but use index alone (Lagrange of 1 element = 1.0)
  const partial = partialSign(fed.signers[0], blind_req.blinded_point);
  const agg = aggregatePartialResponses([partial]);
  const token = unblind(blind_req, agg, fed.aggregate_pubkey);

  // With only signer 1, Lagrange weight = 1, so we get k_1 * B' but need k * B'
  // This token should fail verification unless k == k_1 (which it won't for threshold > 1)
  assert.ok(!verifyToken(token, fed.aggregate_privkey), "k-1 signers should not produce valid token");
});

test("verifyTokenStructure rejects token with missing fields", () => {
  assert.ok(!verifyTokenStructure({ schema: THRESHOLD_MINT_SCHEMA, C: "aabb", secret: "" }));
  assert.ok(!verifyTokenStructure({ schema: "wrong", C: "a".repeat(66), secret: "x" }));
});

test("blindSecret blinded_point is a valid 33-byte compressed point", () => {
  // secp256k1 imported at top-level
  const secret = Buffer.from(secp256k1.utils.randomPrivateKey()).toString("hex");
  const blind_req = blindSecret(secret);
  assert.equal(blind_req.blinded_point.length, 66);
  // Must parse as a valid curve point
  assert.doesNotThrow(() => secp256k1.ProjectivePoint.fromHex(blind_req.blinded_point));
});

test("partialSign signer_index matches the signer's index", () => {
  const fed = generateFederation(3, 2);
  // secp256k1 imported at top-level
  const secret = Buffer.from(secp256k1.utils.randomPrivateKey()).toString("hex");
  const blind_req = blindSecret(secret);
  for (const signer of fed.signers) {
    const pr = partialSign(signer, blind_req.blinded_point);
    assert.equal(pr.signer_index, signer.index);
  }
});
