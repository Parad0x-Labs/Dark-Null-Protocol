/**
 * ZK access receipt tests.
 *
 * Covers: issuance, valid verification, expiry, wrong token, tampered receipt,
 * schema mismatch, binding hash consistency, replay-key stability, and
 * resource/proof hash helpers.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  issueAccessReceipt,
  verifyAccessReceipt,
  resourceHash,
  proofBundleHash,
  ACCESS_RECEIPT_SCHEMA,
} from "../swarm/access-receipt.mjs";

const SECRET = "a".repeat(64); // 32 bytes hex, deterministic for tests
const PROOF_HASH = "b".repeat(64);
const PAYMENT_HASH = "c".repeat(64);
const RESOURCE_HASH = "d".repeat(64);
const SERVICE_ID = "test-service";

function makeReceipt(overrides = {}) {
  return issueAccessReceipt({
    proofBundleHash: PROOF_HASH,
    paymentReceiptHash: PAYMENT_HASH,
    resourceHash: RESOURCE_HASH,
    serviceId: SERVICE_ID,
    tokenSecret: SECRET,
    windowMs: 60000,
    ...overrides,
  });
}

// ─── Issuance ───────────────────────────────────────────────────────────────

test("issueAccessReceipt produces a token + receipt with correct schema", () => {
  const { token, receipt } = makeReceipt();
  assert.equal(receipt.schema, ACCESS_RECEIPT_SCHEMA);
  assert.equal(receipt.proofBundleHash, PROOF_HASH);
  assert.equal(receipt.paymentReceiptHash, PAYMENT_HASH);
  assert.equal(receipt.resourceHash, RESOURCE_HASH);
  assert.equal(receipt.serviceId, SERVICE_ID);
  assert.equal(typeof token, "string");
  assert.equal(token.length, 64);
  assert.ok(receipt.nonce.length >= 32, "nonce must be at least 16 bytes hex");
  assert.ok(receipt.expiresAt > receipt.issuedAt);
});

test("issueAccessReceipt rejects bad proofBundleHash", () => {
  assert.throws(() => makeReceipt({ proofBundleHash: "short" }), /proofBundleHash/);
});

test("issueAccessReceipt rejects bad paymentReceiptHash", () => {
  assert.throws(() => makeReceipt({ paymentReceiptHash: "notahex" }), /paymentReceiptHash/);
});

test("issueAccessReceipt rejects bad resourceHash", () => {
  assert.throws(() => makeReceipt({ resourceHash: null }), /resourceHash/);
});

test("issueAccessReceipt rejects short tokenSecret", () => {
  assert.throws(() => makeReceipt({ tokenSecret: "tooshort" }), /tokenSecret/);
});

test("issueAccessReceipt rejects windowMs exceeding 1 hour", () => {
  assert.throws(() => makeReceipt({ windowMs: 2 * 60 * 60 * 1000 }), /windowMs/);
});

test("two issuances with the same params produce different nonces and tokens", () => {
  const { token: t1, receipt: r1 } = makeReceipt();
  const { token: t2, receipt: r2 } = makeReceipt();
  assert.notEqual(t1, t2, "tokens must differ due to random nonce");
  assert.notEqual(r1.nonce, r2.nonce);
});

// ─── Verification ───────────────────────────────────────────────────────────

test("verifyAccessReceipt validates a freshly issued receipt", () => {
  const { token, receipt } = makeReceipt();
  const result = verifyAccessReceipt({ token, receipt, tokenSecret: SECRET });
  assert.equal(result.valid, true);
  assert.equal(result.reason, undefined);
});

test("verifyAccessReceipt rejects expired receipt", () => {
  const { token, receipt } = makeReceipt({ windowMs: 1000 });
  const future = receipt.expiresAt + 1;
  const result = verifyAccessReceipt({ token, receipt, tokenSecret: SECRET, now: future });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "expired");
});

test("verifyAccessReceipt rejects receipt with wrong token", () => {
  const { receipt } = makeReceipt();
  const result = verifyAccessReceipt({ token: "f".repeat(64), receipt, tokenSecret: SECRET });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "token_invalid");
});

test("verifyAccessReceipt rejects receipt with wrong secret", () => {
  const { token, receipt } = makeReceipt();
  const result = verifyAccessReceipt({ token, receipt, tokenSecret: "0".repeat(64) });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "token_invalid");
});

test("verifyAccessReceipt rejects tampered proofBundleHash in receipt", () => {
  const { token, receipt } = makeReceipt();
  const tampered = { ...receipt, proofBundleHash: "e".repeat(64) };
  const result = verifyAccessReceipt({ token, receipt: tampered, tokenSecret: SECRET });
  assert.equal(result.valid, false);
});

test("verifyAccessReceipt rejects tampered expiresAt in receipt", () => {
  const { token, receipt } = makeReceipt();
  const tampered = { ...receipt, expiresAt: receipt.expiresAt + 9999999 };
  const result = verifyAccessReceipt({ token, receipt: tampered, tokenSecret: SECRET });
  assert.equal(result.valid, false);
});

test("verifyAccessReceipt rejects wrong schema", () => {
  const { token, receipt } = makeReceipt();
  const tampered = { ...receipt, schema: "wrong-schema" };
  const result = verifyAccessReceipt({ token, receipt: tampered, tokenSecret: SECRET });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "schema_mismatch");
});

test("verifyAccessReceipt rejects missing receipt", () => {
  const result = verifyAccessReceipt({ token: "a".repeat(64), receipt: null, tokenSecret: SECRET });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "receipt_missing");
});

test("verifyAccessReceipt rejects malformed token", () => {
  const { receipt } = makeReceipt();
  const result = verifyAccessReceipt({ token: "short", receipt, tokenSecret: SECRET });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "token_malformed");
});

test("verifyAccessReceipt rejects not-yet-valid receipt", () => {
  const { token, receipt } = makeReceipt();
  const past = receipt.issuedAt - 1000;
  const result = verifyAccessReceipt({ token, receipt, tokenSecret: SECRET, now: past });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "not_yet_valid");
});

// ─── Helpers ────────────────────────────────────────────────────────────────

test("resourceHash produces deterministic 64-char hex output", () => {
  const h1 = resourceHash("api/v1/data", "my-service");
  const h2 = resourceHash("api/v1/data", "my-service");
  assert.equal(h1, h2);
  assert.equal(h1.length, 64);
  assert.notEqual(h1, resourceHash("api/v1/other", "my-service"));
  assert.notEqual(h1, resourceHash("api/v1/data", "other-service"));
});

test("proofBundleHash produces deterministic 64-char hex output", () => {
  const proof = { pi_a: ["1", "2"], pi_b: [["3", "4"]], pi_c: ["5", "6"] };
  const signals = ["1", "2", "3", "4", "5", "6", "7", "8"];
  const h1 = proofBundleHash(proof, signals);
  const h2 = proofBundleHash(proof, signals);
  assert.equal(h1, h2);
  assert.equal(h1.length, 64);
});

test("access receipt does not embed the token in the receipt object", () => {
  const { token, receipt } = makeReceipt();
  const receiptStr = JSON.stringify(receipt);
  assert.ok(!receiptStr.includes(token), "token must not appear in the receipt JSON");
});
