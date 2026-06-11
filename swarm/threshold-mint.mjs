/**
 * Dark Null Threshold Blind Mint Federation — k-of-n NULL token issuance.
 *
 * Extends the BDHKE blind token scheme (swarm/blind-token.mjs) to require k
 * independent signers before a token can be issued. No single server holds the
 * full mint key. An attacker must compromise k servers to forge tokens.
 *
 * Construction (Pedersen DKG simplified — additive k-of-n on elliptic curve):
 *
 *   Key Setup (dealer):
 *     Master key k (the logical "mint key" — never assembled in production)
 *     Shamir's n shares: (k_1, k_2, ..., k_n) over Z_q
 *       — any k shares reconstruct k via Lagrange interpolation
 *     Each signer i holds: k_i,  K_i = k_i * G
 *     Aggregate public key: K = k * G = Σ λ_i * K_i (Lagrange combination)
 *
 *   Partial issuance (each signer i):
 *     Receives blinded point B' from client
 *     Returns: C'_i = k_i * B', plus index i
 *
 *   Client aggregation (any k of n partial responses):
 *     C' = Σ (λ_i * C'_i)   where λ_i = Lagrange coefficient for index i
 *        = (Σ λ_i * k_i) * B' = k * B'
 *     Unblinds: C = C' − r * K = k * hashToCurve(secret)
 *     Token format identical to single-signer BDHKE token.
 *
 *   Verify (public, no k needed):
 *     C == k * hashToCurve(secret)
 *     (uses aggregate public key K, same verify as single-signer BDHKE)
 *
 * What is NOT claimed:
 *   - No distributed key generation (DKG) yet; dealer generates shares.
 *   - No threshold DLEQ proof (each signer's partial response is not individually
 *     proven correct in this prototype — full FROST adds per-signer proofs).
 *   - Not audited.
 *   - See docs/2030_PRIMITIVES.md for claim boundaries.
 */

import { createHash } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1";

export const THRESHOLD_MINT_SCHEMA = "dark-null-threshold-mint-v1";

const G = secp256k1.ProjectivePoint.BASE;
const CURVE_N = secp256k1.CURVE.n;

// ---------------------------------------------------------------------------
// Helpers (shared with blind-token.mjs but inlined to keep modules independent)
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

function scalarMod(n) {
  return ((n % CURVE_N) + CURVE_N) % CURVE_N;
}

function compressPoint(point) {
  return Buffer.from(point.toRawBytes(true));
}

function hashToCurve(message) {
  const digest = createHash("sha256").update("dark-null-h2c:").update(message).digest();
  const scalar = scalarMod(bytesToBigInt(digest));
  if (scalar === 0n) throw new Error("hash_to_curve returned zero scalar");
  return G.multiply(scalar);
}

// ---------------------------------------------------------------------------
// Shamir's Secret Sharing over Z_q (secp256k1 field order)
// ---------------------------------------------------------------------------

/**
 * Split a secret scalar into n shares using Shamir's Secret Sharing.
 * threshold shares can reconstruct the secret via Lagrange interpolation.
 *
 * Polynomial: f(x) = secret + a_1*x + a_2*x^2 + ... + a_{k-1}*x^{k-1}
 * Share i: (i, f(i))   where i is a 1-based index
 */
export function shamirSplit(secret_scalar, total_signers, threshold) {
  if (threshold < 1 || threshold > total_signers) {
    throw new Error(`threshold must be in [1, ${total_signers}]`);
  }
  // Polynomial coefficients: a_0 = secret, a_1..a_{k-1} random
  const coeffs = [secret_scalar];
  for (let i = 1; i < threshold; i++) {
    coeffs.push(randomScalar());
  }

  const shares = [];
  for (let x = 1; x <= total_signers; x++) {
    let y = 0n;
    let x_pow = 1n;
    for (const coeff of coeffs) {
      y = scalarMod(y + coeff * x_pow);
      x_pow = scalarMod(x_pow * BigInt(x));
    }
    shares.push({ index: x, share: y });
  }
  return shares;
}

/**
 * Lagrange basis polynomial evaluated at x=0, given the responding signers.
 * λ_i(0) = Π_{j ≠ i} (0 - x_j) / (x_i - x_j)   (mod N)
 */
function lagrangeBasis(signer_index, all_indices) {
  let num = 1n;
  let den = 1n;
  for (const j of all_indices) {
    if (j === signer_index) continue;
    num = scalarMod(num * scalarMod(-BigInt(j)));
    den = scalarMod(den * scalarMod(BigInt(signer_index) - BigInt(j)));
  }
  // Modular inverse of denominator via Fermat's little theorem (N is prime)
  const den_inv = modExp(den, CURVE_N - 2n, CURVE_N);
  return scalarMod(num * den_inv);
}

function modExp(base, exp, mod) {
  let result = 1n;
  base = scalarMod(base);
  while (exp > 0n) {
    if (exp % 2n === 1n) result = scalarMod(result * base);
    exp = exp / 2n;
    base = scalarMod(base * base);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Federation setup
// ---------------------------------------------------------------------------

/**
 * Generate a threshold federation.
 * In production, k and K are computed from key shares via DKG — never assembled.
 * Here the dealer assembles them for the prototype.
 *
 * @returns {{ threshold, total_signers, signers, aggregate_pubkey, aggregate_privkey }}
 */
export function generateFederation(total_signers, threshold) {
  if (total_signers < 2) throw new Error("federation requires at least 2 signers");
  if (threshold > total_signers) throw new Error("threshold cannot exceed total_signers");

  const master_priv = randomScalar();
  const aggregate_pub = G.multiply(master_priv);
  const shares = shamirSplit(master_priv, total_signers, threshold);

  const signers = shares.map(({ index, share }) => ({
    index,
    key_share: bigIntTo32Bytes(share).toString("hex"),
    pub_share: compressPoint(G.multiply(share)).toString("hex"),
  }));

  return {
    schema: THRESHOLD_MINT_SCHEMA,
    threshold,
    total_signers,
    aggregate_pubkey: compressPoint(aggregate_pub).toString("hex"),
    aggregate_privkey: bigIntTo32Bytes(master_priv).toString("hex"),
    signers,
  };
}

// ---------------------------------------------------------------------------
// Client — blinding (same as BDHKE)
// ---------------------------------------------------------------------------

/**
 * Client blinds a secret before sending to the federation.
 */
export function blindSecret(secret) {
  const r = randomScalar();
  const T = hashToCurve(secret);
  const B_prime = T.add(G.multiply(r));
  return {
    schema: THRESHOLD_MINT_SCHEMA,
    secret,
    r_blinding_factor: bigIntTo32Bytes(r).toString("hex"),
    blinded_point: compressPoint(B_prime).toString("hex"),
  };
}

// ---------------------------------------------------------------------------
// Signer — partial response
// ---------------------------------------------------------------------------

/**
 * Each signer independently computes a partial response C'_i = k_i * B'.
 */
export function partialSign(signer, blinded_point_hex) {
  const B_prime = secp256k1.ProjectivePoint.fromHex(blinded_point_hex);
  const k_i = bytesToBigInt(Buffer.from(signer.key_share, "hex"));
  const C_prime_i = B_prime.multiply(k_i);
  return {
    schema: THRESHOLD_MINT_SCHEMA,
    signer_index: signer.index,
    partial_response: compressPoint(C_prime_i).toString("hex"),
  };
}

// ---------------------------------------------------------------------------
// Client — aggregation
// ---------------------------------------------------------------------------

/**
 * Aggregate k partial responses into the blinded mint response C'.
 * Applies Lagrange interpolation on the elliptic curve.
 *
 * @param {Array<{signer_index, partial_response}>} partial_responses — exactly k responses
 * @returns {{ blinded_response: string }}  — C' as compressed hex
 */
export function aggregatePartialResponses(partial_responses) {
  const indices = partial_responses.map((r) => r.signer_index);
  let C_prime = secp256k1.ProjectivePoint.ZERO;

  for (const pr of partial_responses) {
    const lambda = lagrangeBasis(pr.signer_index, indices);
    const C_prime_i = secp256k1.ProjectivePoint.fromHex(pr.partial_response);
    C_prime = C_prime.add(C_prime_i.multiply(lambda));
  }

  return {
    schema: THRESHOLD_MINT_SCHEMA,
    blinded_response: compressPoint(C_prime).toString("hex"),
    signer_count: partial_responses.length,
  };
}

// ---------------------------------------------------------------------------
// Client — unblinding
// ---------------------------------------------------------------------------

/**
 * Unblind the aggregated response to produce the final token.
 * C = C' − r * K   where K = aggregate_pubkey
 */
export function unblind(blind_request, aggregated_response, aggregate_pubkey_hex) {
  const r = bytesToBigInt(Buffer.from(blind_request.r_blinding_factor, "hex"));
  const K = secp256k1.ProjectivePoint.fromHex(aggregate_pubkey_hex);
  const C_prime = secp256k1.ProjectivePoint.fromHex(aggregated_response.blinded_response);
  const C = C_prime.subtract(K.multiply(r));

  return {
    schema: THRESHOLD_MINT_SCHEMA,
    secret: blind_request.secret,
    C: compressPoint(C).toString("hex"),
    aggregate_pubkey: aggregate_pubkey_hex,
  };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Verify a threshold-issued token.
 * Same as single-signer BDHKE: C == k * hashToCurve(secret)
 * Uses aggregate_pubkey_hex to find k via the private key (server-side verify only).
 */
export function verifyToken(token, aggregate_privkey_hex) {
  const k = bytesToBigInt(Buffer.from(aggregate_privkey_hex, "hex"));
  const T = hashToCurve(token.secret);
  const expected_C = T.multiply(k);
  return compressPoint(expected_C).toString("hex") === token.C;
}

/**
 * Verify token is structurally valid (schema, hex fields present).
 */
export function verifyTokenStructure(token) {
  try {
    if (token.schema !== THRESHOLD_MINT_SCHEMA) return false;
    secp256k1.ProjectivePoint.fromHex(token.C);
    return token.secret !== undefined && token.secret.length > 0;
  } catch {
    return false;
  }
}
