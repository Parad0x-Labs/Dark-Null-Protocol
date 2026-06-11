/**
 * Dark Null Silent Payment Rails — permanently unlinkable one-time addresses.
 *
 * Implements BIP352-style stealth address derivation on secp256k1.
 * Each payment lands at a fresh one-time address derived from the recipient's
 * scan key and the sender's ephemeral key. No two payments share an address.
 * The recipient scans by trying each transaction's ephemeral pubkey against
 * their scan private key to discover funds.
 *
 * Protocol:
 *   Setup (recipient):
 *     scan_privkey  = random scalar
 *     spend_privkey = random scalar
 *     scan_pubkey   = scan_privkey  * G
 *     spend_pubkey  = spend_privkey * G
 *
 *   Send (sender, given scan_pubkey + spend_pubkey):
 *     eph_privkey   = random scalar
 *     eph_pubkey    = eph_privkey * G
 *     shared        = eph_privkey * scan_pubkey          (ECDH)
 *     tweak         = H(compressed(shared) || payment_nonce)
 *     one_time_addr = spend_pubkey + tweak * G
 *     broadcast: (eph_pubkey, one_time_addr, amount)
 *
 *   Scan (recipient, given eph_pubkey from a transaction):
 *     shared        = scan_privkey * eph_pubkey          (same ECDH)
 *     tweak         = H(compressed(shared) || payment_nonce)
 *     candidate     = spend_pubkey + tweak * G
 *     if candidate == one_time_addr → payment is mine
 *     spend_key     = spend_privkey + tweak              (to spend)
 *
 * What is NOT claimed:
 *   - No on-chain integration yet; this is a pure-crypto prototype.
 *   - Full BIP352 uses tagged hashes and input tweaking — this follows the
 *     core ECDH + H(shared || nonce) structure.
 *   - Not audited.
 *   - See docs/2030_PRIMITIVES.md for claim boundaries.
 */

import { createHash } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1";

export const SILENT_PAY_SCHEMA = "dark-null-silent-pay-v1";

const G = secp256k1.ProjectivePoint.BASE;
const CURVE_N = secp256k1.CURVE.n;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bytesToBigInt(bytes) {
  let result = 0n;
  for (const b of bytes) result = (result << 8n) | BigInt(b);
  return result;
}

function bigIntTo32Bytes(n) {
  return Buffer.from(n.toString(16).padStart(64, "0"), "hex");
}

function randomScalar() {
  return bytesToBigInt(secp256k1.utils.randomPrivateKey());
}

function hashToScalar(compressed_shared_point, payment_nonce) {
  const nonce_bytes = Buffer.alloc(4);
  nonce_bytes.writeUInt32BE(payment_nonce >>> 0, 0);
  const digest = createHash("sha256")
    .update(compressed_shared_point)
    .update(nonce_bytes)
    .digest();
  const scalar = bytesToBigInt(digest) % CURVE_N;
  if (scalar === 0n) throw new Error("hash_to_scalar returned zero — retry with different nonce");
  return scalar;
}

function compressPoint(point) {
  return Buffer.from(point.toRawBytes(true));
}

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

/**
 * Generate a fresh (scan_key, spend_key) pair for a recipient.
 */
export function generateSilentPaymentKeys() {
  const scan_priv = randomScalar();
  const spend_priv = randomScalar();
  const scan_pub = G.multiply(scan_priv);
  const spend_pub = G.multiply(spend_priv);
  return {
    schema: SILENT_PAY_SCHEMA,
    scan: {
      private: bigIntTo32Bytes(scan_priv).toString("hex"),
      public: compressPoint(scan_pub).toString("hex"),
    },
    spend: {
      private: bigIntTo32Bytes(spend_priv).toString("hex"),
      public: compressPoint(spend_pub).toString("hex"),
    },
  };
}

// ---------------------------------------------------------------------------
// Sender
// ---------------------------------------------------------------------------

/**
 * Derive a one-time address for a payment.
 * @param {object} recipient_keys  — { scan: { public }, spend: { public } }
 * @param {number} payment_nonce   — 0-based index, incremented per payment to same recipient
 * @returns {{ one_time_address, eph_pubkey, payment_nonce, schema }}
 */
export function deriveOneTimeAddress(recipient_keys, payment_nonce = 0) {
  const scan_pub = secp256k1.ProjectivePoint.fromHex(recipient_keys.scan.public);
  const spend_pub = secp256k1.ProjectivePoint.fromHex(recipient_keys.spend.public);

  const eph_priv = randomScalar();
  const eph_pub = G.multiply(eph_priv);

  const shared = scan_pub.multiply(eph_priv);
  const tweak = hashToScalar(compressPoint(shared), payment_nonce);

  const one_time = spend_pub.add(G.multiply(tweak));

  return {
    schema: SILENT_PAY_SCHEMA,
    one_time_address: compressPoint(one_time).toString("hex"),
    eph_pubkey: compressPoint(eph_pub).toString("hex"),
    payment_nonce,
  };
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

/**
 * Check whether a transaction output belongs to this recipient.
 * @param {object} recipient_keys  — full keys with private fields
 * @param {string} eph_pubkey_hex  — eph_pubkey from the transaction
 * @param {string} one_time_address_hex — the on-chain address to check
 * @param {number} payment_nonce   — nonce to try (caller iterates 0..N)
 * @returns {{ owned: boolean, spend_private?: string }}
 */
export function scanOutput(recipient_keys, eph_pubkey_hex, one_time_address_hex, payment_nonce = 0) {
  const scan_priv = bytesToBigInt(Buffer.from(recipient_keys.scan.private, "hex"));
  const spend_priv = bytesToBigInt(Buffer.from(recipient_keys.spend.private, "hex"));
  const spend_pub = secp256k1.ProjectivePoint.fromHex(recipient_keys.spend.public);

  const eph_pub = secp256k1.ProjectivePoint.fromHex(eph_pubkey_hex);
  const shared = eph_pub.multiply(scan_priv);
  const tweak = hashToScalar(compressPoint(shared), payment_nonce);

  const candidate = spend_pub.add(G.multiply(tweak));
  const candidate_hex = compressPoint(candidate).toString("hex");

  if (candidate_hex !== one_time_address_hex) {
    return { owned: false };
  }

  const spend_key_scalar = ((spend_priv + tweak) % CURVE_N + CURVE_N) % CURVE_N;
  return {
    owned: true,
    spend_private: bigIntTo32Bytes(spend_key_scalar).toString("hex"),
    payment_nonce,
  };
}

/**
 * Scan a list of transaction outputs and return all owned ones.
 * @param {object} recipient_keys
 * @param {Array<{eph_pubkey, one_time_address, payment_nonce}>} outputs
 * @returns {Array<{output, spend_private, payment_nonce}>}
 */
export function scanOutputs(recipient_keys, outputs) {
  const owned = [];
  for (const output of outputs) {
    const result = scanOutput(
      recipient_keys,
      output.eph_pubkey,
      output.one_time_address,
      output.payment_nonce,
    );
    if (result.owned) {
      owned.push({ output, spend_private: result.spend_private, payment_nonce: result.payment_nonce });
    }
  }
  return owned;
}

/**
 * Verify that a spend_private key correctly controls the one_time_address.
 */
export function verifySpendKey(one_time_address_hex, spend_private_hex) {
  const priv = bytesToBigInt(Buffer.from(spend_private_hex, "hex"));
  const derived_pub = G.multiply(priv);
  return compressPoint(derived_pub).toString("hex") === one_time_address_hex;
}
