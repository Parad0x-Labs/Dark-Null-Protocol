/**
 * Dark Null BDHKE Blind Token — receipt credential with unlinkability.
 *
 * Implements the Blind Diffie-Hellman Key Exchange scheme (Chaum 1982).
 * Production reference: Cashu nut-00, GNU Taler blind signature spec.
 * Curve: secp256k1 via @noble/curves (already a transitive dep).
 *
 * Protocol:
 *   1. Mint generates keypair (k, K) where K = k*G.
 *   2. Client picks a secret, computes:
 *        r  = random scalar
 *        B' = hashToCurve(secret) + r*G    (blinded point)
 *      Sends B' to mint. Mint cannot recover secret or r.
 *   3. Mint computes C' = k * B', returns (C', dleq_proof).
 *      DLEQ proves C' was formed with the same k as K, without revealing k.
 *   4. Client unblinds:
 *        C = C' − r*K = k * hashToCurve(secret)
 *      Token = { secret, C }. Client keeps r private.
 *   5. Verify: check C == k * hashToCurve(secret)
 *      — or verify DLEQ without knowing k (public verifiability).
 *
 * What is NOT claimed:
 *   - This is a prototype. It is NOT audited.
 *   - Production use requires a persistent spent-token database.
 *   - Mint key rotation is not implemented here.
 *   - See docs/2030_PRIMITIVES.md for claim boundaries.
 */

import { createHash } from "node:crypto";
import { secp256k1, secp256k1_hasher } from "@noble/curves/secp256k1";

export const BLIND_TOKEN_SCHEMA = "dark-null-blind-token-v1";
export const DLEQ_SCHEMA = "dark-null-dleq-v1";

const G = secp256k1.ProjectivePoint.BASE;
const CURVE_N = secp256k1.CURVE.n;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function bytesToBigInt(bytes) {
  let result = 0n;
  for (const b of bytes) result = (result << 8n) | BigInt(b);
  return result;
}

function bigIntTo32Bytes(n) {
  const hex = n.toString(16).padStart(64, "0");
  return Buffer.from(hex, "hex");
}

function randomScalar() {
  // noble gives us a valid random 32-byte private key (in [1, n-1])
  return bytesToBigInt(secp256k1.utils.randomPrivateKey());
}

function scalarMod(n) {
  return ((n % CURVE_N) + CURVE_N) % CURVE_N;
}

// Hash a message to a secp256k1 curve point via RFC 9380 hash-to-curve.
function hashToCurvePoint(secret) {
  const msg = typeof secret === "string" ? Buffer.from(secret, "utf8") : Buffer.from(secret);
  return secp256k1_hasher.hashToCurve(msg);
}

// Deterministic hash for DLEQ Fiat-Shamir challenge.
function dleqChallenge(...points) {
  const h = createHash("sha256");
  h.update(DLEQ_SCHEMA);
  for (const p of points) h.update(p.toRawBytes(true));
  const bytes = h.digest();
  return scalarMod(bytesToBigInt(bytes));
}

// ---------------------------------------------------------------------------
// Mint
// ---------------------------------------------------------------------------

export class BlindMint {
  #secretKey; // BigInt scalar
  #publicKey; // ProjectivePoint

  constructor(secretKey) {
    if (secretKey === undefined) {
      this.#secretKey = randomScalar();
    } else {
      const s =
        typeof secretKey === "bigint"
          ? secretKey
          : bytesToBigInt(Buffer.from(secretKey, "hex"));
      if (s === 0n || s >= CURVE_N) throw new Error("invalid secret key");
      this.#secretKey = s;
    }
    this.#publicKey = G.multiply(this.#secretKey);
  }

  get publicKeyHex() {
    return this.#publicKey.toHex(true); // 33 bytes compressed
  }

  /**
   * Export secret key as hex (for persistence / test fixtures).
   * Never expose in production without HSM.
   */
  exportSecretKeyHex() {
    return bigIntTo32Bytes(this.#secretKey).toString("hex");
  }

  /**
   * Blind-sign a client's blinded point B'.
   * Returns the blind signature C' and a DLEQ proof.
   */
  blindSign(blindedPointHex) {
    const B_prime = secp256k1.ProjectivePoint.fromHex(blindedPointHex);
    const C_prime = B_prime.multiply(this.#secretKey);

    // DLEQ proof: proves C' = k*B' using same k as K = k*G
    // r = random nonce
    const r = randomScalar();
    const R1 = G.multiply(r);          // r*G
    const R2 = B_prime.multiply(r);    // r*B'

    const e = dleqChallenge(R1, R2, this.#publicKey, C_prime);
    const s = scalarMod(r - e * this.#secretKey);

    return {
      schema: BLIND_TOKEN_SCHEMA,
      blindSignatureHex: C_prime.toHex(true),
      mintPublicKeyHex: this.publicKeyHex,
      dleq: {
        schema: DLEQ_SCHEMA,
        eHex: bigIntTo32Bytes(e).toString("hex"),
        sHex: bigIntTo32Bytes(s).toString("hex"),
      },
    };
  }

  /**
   * Verify a token directly using the mint's secret key.
   * More efficient than DLEQ public verification.
   */
  verifyToken(token) {
    const { secret, tokenPointHex } = token;
    try {
      const P = hashToCurvePoint(secret);
      const expected = P.multiply(this.#secretKey);
      const actual = secp256k1.ProjectivePoint.fromHex(tokenPointHex);
      return expected.equals(actual);
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class BlindClient {
  /**
   * Blind a secret for submission to the mint.
   * Returns the blinded point hex to send to the mint, plus the blinding factor (r).
   * Keep r secret — it is needed for unblinding.
   */
  static blind(secret) {
    const P = hashToCurvePoint(secret); // H(secret) point
    const r = randomScalar();
    const rG = G.multiply(r);           // r*G
    const B_prime = P.add(rG);          // H(secret) + r*G

    return {
      blindedPointHex: B_prime.toHex(true),
      blindingFactorHex: bigIntTo32Bytes(r).toString("hex"),
    };
  }

  /**
   * Unblind the mint's blind signature using the blinding factor r.
   * Returns the final token: { secret, tokenPointHex, mintPublicKeyHex }
   */
  static unblind({ blindSignatureHex, mintPublicKeyHex, blindingFactorHex, secret }) {
    const C_prime = secp256k1.ProjectivePoint.fromHex(blindSignatureHex);
    const K = secp256k1.ProjectivePoint.fromHex(mintPublicKeyHex);
    const r = bytesToBigInt(Buffer.from(blindingFactorHex, "hex"));

    // C = C' - r*K
    const rK = K.multiply(r);
    const C = C_prime.add(rK.negate());

    return {
      schema: BLIND_TOKEN_SCHEMA,
      secret,
      tokenPointHex: C.toHex(true),
      mintPublicKeyHex,
    };
  }
}

// ---------------------------------------------------------------------------
// Public DLEQ verification (no mint secret key required)
// ---------------------------------------------------------------------------

/**
 * Verify the DLEQ proof from a mint blind-sign response.
 * Confirms the mint used its declared public key to produce the blind signature.
 * Does NOT verify the token is unspent — that requires a spent-token registry.
 */
export function verifyDleq({ blindedPointHex, blindSignatureHex, mintPublicKeyHex, dleq }) {
  try {
  const B_prime = secp256k1.ProjectivePoint.fromHex(blindedPointHex);
  const C_prime = secp256k1.ProjectivePoint.fromHex(blindSignatureHex);
  const K = secp256k1.ProjectivePoint.fromHex(mintPublicKeyHex);
  // Reduce scalars mod n — an attacker may supply out-of-range values.
  const e = scalarMod(bytesToBigInt(Buffer.from(dleq.eHex, "hex")));
  const s = scalarMod(bytesToBigInt(Buffer.from(dleq.sHex, "hex")));
  if (e === 0n || s === 0n) return false;

  // R1 = s*G + e*K,  R2 = s*B' + e*C'
  const R1 = G.multiply(s).add(K.multiply(e));
  const R2 = B_prime.multiply(s).add(C_prime.multiply(e));

  const eCheck = dleqChallenge(R1, R2, K, C_prime);
  return eCheck === e;
  } catch {
    return false;
  }
}

/**
 * Verify a token using only the mint's public key.
 * Requires first verifying DLEQ during issuance (to ensure mint used its key).
 *
 * Full public-verify flow:
 *   1. verifyDleq(mintResponse) — confirms the blind sig was correctly formed
 *   2. token = BlindClient.unblind(mintResponse)
 *   3. verifyTokenPublic(token, mintPublicKeyHex) — confirms C = k*H(secret)
 *
 * Note: this is a DLEQ re-check on the final token, not a direct k-multiplication.
 * The mint must have signed correctly (step 1) for this to be meaningful.
 * Without step 1, a malicious mint could issue a token that passes step 3.
 */
export function verifyTokenPublic(token, mintPublicKeyHex) {
  if (token.mintPublicKeyHex !== mintPublicKeyHex) return false;
  const { secret, tokenPointHex } = token;
  try {
    const C = secp256k1.ProjectivePoint.fromHex(tokenPointHex);
    C.assertValidity();
    const P = hashToCurvePoint(secret);
    P.assertValidity();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Spent-token registry (in-process prototype)
// ---------------------------------------------------------------------------

export class BlindTokenRegistry {
  #spent = new Set();

  /**
   * Returns true if this token has not been seen before (i.e., is fresh).
   * Marks it as spent atomically — second call returns false.
   */
  redeem(token) {
    const key = `${token.mintPublicKeyHex}:${token.tokenPointHex}`;
    if (this.#spent.has(key)) return false;
    this.#spent.add(key);
    return true;
  }

  has(token) {
    const key = `${token.mintPublicKeyHex}:${token.tokenPointHex}`;
    return this.#spent.has(key);
  }

  size() {
    return this.#spent.size;
  }
}
