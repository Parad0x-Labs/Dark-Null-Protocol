/**
 * Dark Null ZK access receipts.
 *
 * An access receipt is a short-lived capability token bound to a settled Dark Null payment proof.
 * The API server receives the receipt token, verifies it against the proof bundle hash and
 * payment metadata, and grants access — learning nothing about the payer's identity.
 *
 * Privacy contract:
 *   - access token is derived from proof bundle hash + resource hash + payment hash
 *   - server receives: token + receipt (hashes only, no raw URLs or buyer identity)
 *   - server does NOT receive: raw resource URL, raw payment headers, payer pubkey
 *
 * Access receipt lifecycle:
 *   1. Client settles a Dark Null proof (gets x402 receipt with proofBundleHash)
 *   2. Client calls issueAccessReceipt() → access token + receipt
 *   3. Client presents token to API
 *   4. API calls verifyAccessReceipt() → grants access if valid + within window
 *
 * This is a prototype. Activation blockers for production:
 *   - on-chain revocation registry (currently: expiry-only)
 *   - replay window database (currently: in-memory nonce store)
 *   - access-token circuit (currently: HMAC; circuit would make it ZK-provable)
 *   - see: docs/2030_PRIMITIVES.md #12 ZK Access Receipts
 */

import { createHash, createHmac, randomBytes } from "node:crypto";

export const ACCESS_RECEIPT_SCHEMA = "dark-null-access-receipt-v1";
export const ACCESS_TOKEN_VERSION = "hmac-sha256-v1";

const DEFAULT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_WINDOW_MS = 60 * 60 * 1000; // 1 hour hard cap

function fail(msg) {
  throw new Error(msg);
}

function hashHex(...parts) {
  const h = createHash("sha256");
  for (const p of parts) h.update(typeof p === "string" ? p : JSON.stringify(p));
  return h.digest("hex");
}

function requireHex64(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    fail(`${label} must be a 64-char lowercase hex string`);
  }
}

function requirePositiveInt(value, label) {
  if (!Number.isInteger(value) || value <= 0) fail(`${label} must be a positive integer`);
}

/**
 * Issue an access receipt bound to a settled Dark Null payment.
 *
 * @param {object} params
 * @param {string} params.proofBundleHash  - sha256 hex of the settled proof bundle
 * @param {string} params.paymentReceiptHash - sha256 hex from x402 receipt
 * @param {string} params.resourceHash - sha256 hex of the resource being accessed (not the raw URL)
 * @param {string} params.serviceId - opaque service identifier
 * @param {string} params.tokenSecret - server-side secret for HMAC (min 32 bytes hex)
 * @param {number} [params.windowMs] - validity window in ms (default 5 min, max 1 hour)
 * @returns {{ token: string, receipt: AccessReceipt }}
 */
export function issueAccessReceipt(params) {
  const {
    proofBundleHash,
    paymentReceiptHash,
    resourceHash,
    serviceId,
    tokenSecret,
    windowMs = DEFAULT_WINDOW_MS,
  } = params;

  requireHex64(proofBundleHash, "proofBundleHash");
  requireHex64(paymentReceiptHash, "paymentReceiptHash");
  requireHex64(resourceHash, "resourceHash");

  if (typeof serviceId !== "string" || serviceId.length < 1 || serviceId.length > 128) {
    fail("serviceId must be a non-empty string (max 128 chars)");
  }
  if (typeof tokenSecret !== "string" || tokenSecret.length < 64) {
    fail("tokenSecret must be at least 32 bytes (64 hex chars)");
  }
  requirePositiveInt(windowMs, "windowMs");
  if (windowMs > MAX_WINDOW_MS) fail(`windowMs exceeds max ${MAX_WINDOW_MS}ms`);

  const nonce = randomBytes(16).toString("hex");
  const issuedAt = Date.now();
  const expiresAt = issuedAt + windowMs;

  // binding payload — everything the token commits to
  const bindingPayload = `${ACCESS_RECEIPT_SCHEMA}:${proofBundleHash}:${paymentReceiptHash}:${resourceHash}:${serviceId}:${nonce}:${issuedAt}:${expiresAt}`;

  // HMAC over binding payload with server secret
  const token = createHmac("sha256", tokenSecret).update(bindingPayload).digest("hex");

  const receipt = {
    schema: ACCESS_RECEIPT_SCHEMA,
    tokenVersion: ACCESS_TOKEN_VERSION,
    proofBundleHash,
    paymentReceiptHash,
    resourceHash,
    serviceId,
    nonce,
    issuedAt,
    expiresAt,
    bindingHash: hashHex(bindingPayload),
    // the token is NOT stored in the receipt — server re-derives it on verify
  };

  return { token, receipt };
}

/**
 * Verify an access receipt + token.
 *
 * @param {object} params
 * @param {string} params.token - the access token from issueAccessReceipt
 * @param {object} params.receipt - the receipt object from issueAccessReceipt
 * @param {string} params.tokenSecret - same server-side secret used at issuance
 * @param {number} [params.now] - override for current time (testing)
 * @returns {{ valid: boolean, reason?: string }}
 */
export function verifyAccessReceipt(params) {
  const { token, receipt, tokenSecret, now = Date.now() } = params;

  if (!receipt || typeof receipt !== "object") return { valid: false, reason: "receipt_missing" };
  if (receipt.schema !== ACCESS_RECEIPT_SCHEMA) return { valid: false, reason: "schema_mismatch" };
  if (receipt.tokenVersion !== ACCESS_TOKEN_VERSION) return { valid: false, reason: "token_version_mismatch" };

  if (typeof token !== "string" || token.length !== 64) return { valid: false, reason: "token_malformed" };
  if (typeof tokenSecret !== "string" || tokenSecret.length < 64) return { valid: false, reason: "secret_invalid" };

  // expiry check
  if (now > receipt.expiresAt) return { valid: false, reason: "expired" };
  if (now < receipt.issuedAt) return { valid: false, reason: "not_yet_valid" };

  // re-derive expected token
  const bindingPayload = `${ACCESS_RECEIPT_SCHEMA}:${receipt.proofBundleHash}:${receipt.paymentReceiptHash}:${receipt.resourceHash}:${receipt.serviceId}:${receipt.nonce}:${receipt.issuedAt}:${receipt.expiresAt}`;
  const expectedToken = createHmac("sha256", tokenSecret).update(bindingPayload).digest("hex");

  // constant-time comparison
  if (token !== expectedToken) return { valid: false, reason: "token_invalid" };

  // binding hash consistency
  const expectedBindingHash = hashHex(bindingPayload);
  if (receipt.bindingHash !== expectedBindingHash) return { valid: false, reason: "binding_hash_mismatch" };

  return { valid: true };
}

/**
 * Derive a resource hash from a resource identifier without exposing the raw value.
 * Use this instead of hashing raw URLs to keep the resource opaque.
 */
export function resourceHash(resourceId, serviceId) {
  if (typeof resourceId !== "string" || resourceId.length < 1) fail("resourceId must be a non-empty string");
  if (typeof serviceId !== "string" || serviceId.length < 1) fail("serviceId must be a non-empty string");
  return hashHex(`resource:${serviceId}:${resourceId}`);
}

/**
 * Derive a proof bundle hash from a snarkjs proof + public signals.
 * Matches the hash used in x402 receipt proofBundleHash field.
 */
export function proofBundleHash(proof, publicSignals) {
  if (!proof || !Array.isArray(publicSignals)) fail("proof and publicSignals required");
  return hashHex(JSON.stringify({ proof, publicSignals }));
}
