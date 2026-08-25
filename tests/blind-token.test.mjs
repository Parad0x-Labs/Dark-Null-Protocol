import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  BlindMint,
  BlindClient,
  BlindTokenRegistry,
  BLIND_TOKEN_SCHEMA,
  verifyDleq,
  verifyTokenPublic,
} from "../swarm/blind-token.mjs";

const require = createRequire(import.meta.url);
const { secp256k1 } = require("@noble/curves/secp256k1");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fullFlow(mint, secret) {
  const { blindedPointHex, blindingFactorHex } = BlindClient.blind(secret);
  const mintResponse = mint.blindSign(blindedPointHex);
  const token = BlindClient.unblind({
    ...mintResponse,
    blindingFactorHex,
    secret,
  });
  return { blindedPointHex, blindingFactorHex, mintResponse, token };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("BlindMint generates a valid keypair", () => {
  const mint = new BlindMint();
  const pk = mint.publicKeyHex;
  assert.ok(typeof pk === "string", "public key should be a string");
  assert.strictEqual(pk.length, 66, "compressed secp256k1 public key is 33 bytes = 66 hex chars");
  assert.ok(pk.startsWith("02") || pk.startsWith("03"), "compressed point prefix");
});

test("BlindMint can be restored from an exported secret key", () => {
  const mint1 = new BlindMint();
  const exported = mint1.exportSecretKeyHex();
  const mint2 = new BlindMint(exported);
  assert.strictEqual(mint1.publicKeyHex, mint2.publicKeyHex, "restored mint should have same public key");
});

test("BlindClient.blind returns a blinded point and blinding factor", () => {
  const { blindedPointHex, blindingFactorHex } = BlindClient.blind("test-secret-001");
  assert.ok(typeof blindedPointHex === "string");
  assert.ok(typeof blindingFactorHex === "string");
  assert.strictEqual(blindedPointHex.length, 66, "compressed point");
  assert.strictEqual(blindingFactorHex.length, 64, "32-byte scalar");
});

test("BlindClient.blind is non-deterministic (different r each call)", () => {
  const a = BlindClient.blind("same-secret");
  const b = BlindClient.blind("same-secret");
  assert.notStrictEqual(a.blindedPointHex, b.blindedPointHex, "blinded points differ each call");
  assert.notStrictEqual(a.blindingFactorHex, b.blindingFactorHex, "blinding factors differ each call");
});

test("full blind issuance flow: blind → sign → unblind → verify", () => {
  const mint = new BlindMint();
  const { token } = fullFlow(mint, "my-payment-secret");

  assert.strictEqual(token.schema, BLIND_TOKEN_SCHEMA);
  assert.ok(typeof token.tokenPointHex === "string");
  assert.ok(mint.verifyToken(token), "mint should accept unblinded token");
});

test("different secrets produce different tokens for the same mint", () => {
  const mint = new BlindMint();
  const { token: t1 } = fullFlow(mint, "secret-a");
  const { token: t2 } = fullFlow(mint, "secret-b");
  assert.notStrictEqual(t1.tokenPointHex, t2.tokenPointHex);
});

test("tampered token point fails verification", () => {
  const mint = new BlindMint();
  const { token } = fullFlow(mint, "tamper-test");

  // Flip a byte in the token point
  const tamperedHex = token.tokenPointHex.slice(0, -2) + "ff";
  const tamperedToken = { ...token, tokenPointHex: tamperedHex };

  assert.ok(!mint.verifyToken(tamperedToken), "tampered token should fail verification");
});

test("tampered secret fails verification", () => {
  const mint = new BlindMint();
  const { token } = fullFlow(mint, "real-secret");

  const tamperedToken = { ...token, secret: "wrong-secret" };
  assert.ok(!mint.verifyToken(tamperedToken), "wrong secret should fail verification");
});

test("token from different mint fails verification", () => {
  const mint1 = new BlindMint();
  const mint2 = new BlindMint();
  const { token } = fullFlow(mint1, "secret");

  assert.ok(mint1.verifyToken(token), "original mint accepts token");
  assert.ok(!mint2.verifyToken(token), "different mint rejects token");
});

test("DLEQ proof is structurally valid", () => {
  const mint = new BlindMint();
  const { blindedPointHex, mintResponse } = fullFlow(mint, "dleq-test");

  const { dleq } = mintResponse;
  assert.ok(typeof dleq.eHex === "string");
  assert.ok(typeof dleq.sHex === "string");
  assert.strictEqual(dleq.eHex.length, 64);
  assert.strictEqual(dleq.sHex.length, 64);
});

test("DLEQ proof verifies (public verifier does not need mint secret key)", () => {
  const mint = new BlindMint();
  const { blindedPointHex, mintResponse } = fullFlow(mint, "dleq-verify-test");

  const isValid = verifyDleq({
    blindedPointHex,
    blindSignatureHex: mintResponse.blindSignatureHex,
    mintPublicKeyHex: mintResponse.mintPublicKeyHex,
    dleq: mintResponse.dleq,
  });

  assert.ok(isValid, "DLEQ proof should verify");
});

test("corrupted DLEQ e scalar fails verification", () => {
  const mint = new BlindMint();
  const { blindedPointHex, mintResponse } = fullFlow(mint, "dleq-corrupt");

  const corruptedDleq = {
    ...mintResponse.dleq,
    eHex: "ff".repeat(32), // wrong challenge
  };

  const isValid = verifyDleq({
    blindedPointHex,
    blindSignatureHex: mintResponse.blindSignatureHex,
    mintPublicKeyHex: mintResponse.mintPublicKeyHex,
    dleq: corruptedDleq,
  });

  assert.ok(!isValid, "corrupted DLEQ e should fail");
});

test("corrupted DLEQ s scalar fails verification", () => {
  const mint = new BlindMint();
  const { blindedPointHex, mintResponse } = fullFlow(mint, "dleq-corrupt-s");

  const corruptedDleq = {
    ...mintResponse.dleq,
    sHex: "aa".repeat(32), // wrong response
  };

  const isValid = verifyDleq({
    blindedPointHex,
    blindSignatureHex: mintResponse.blindSignatureHex,
    mintPublicKeyHex: mintResponse.mintPublicKeyHex,
    dleq: corruptedDleq,
  });

  assert.ok(!isValid, "corrupted DLEQ s should fail");
});

test("verifyTokenPublic rejects token without DLEQ proof", () => {
  const mint = new BlindMint();
  const { mintResponse, token } = fullFlow(mint, "no-proof");
  assert.ok(!verifyTokenPublic(token, mintResponse.mintPublicKeyHex));
});

test("verifyTokenPublic accepts token with valid public DLEQ proof", () => {
  const mint = new BlindMint();
  const { mintResponse, token } = fullFlow(mint, "public-verify");
  const proof = mint.proveTokenPublic(token);
  assert.ok(verifyTokenPublic(token, mintResponse.mintPublicKeyHex, proof));
});

test("verifyTokenPublic rejects forged token even with a proof for another token", () => {
  const mint = new BlindMint();
  const { mintResponse, token } = fullFlow(mint, "forgery-a");
  const proof = mint.proveTokenPublic(token);

  // Forge: same shape, different secret — no valid proof exists for it.
  const forged = { ...token, secret: "forged-secret" };
  assert.ok(!verifyTokenPublic(forged, mintResponse.mintPublicKeyHex, proof));

  // Tampered point with the original secret must also fail.
  const tampered = {
    ...token,
    tokenPointHex: secp256k1.ProjectivePoint.BASE.toHex(true),
  };
  assert.ok(!verifyTokenPublic(tampered, mintResponse.mintPublicKeyHex, proof));
});

test("verifyTokenPublic rejects token with wrong mint public key", () => {
  const mint = new BlindMint();
  const otherMint = new BlindMint();
  const { token } = fullFlow(mint, "wrong-mint-key-test");
  const proof = mint.proveTokenPublic(token);

  assert.ok(!verifyTokenPublic(token, otherMint.publicKeyHex, proof));
});

test("BlindTokenRegistry: first redeem returns true, second returns false", () => {
  const mint = new BlindMint();
  const { token } = fullFlow(mint, "double-spend-test");
  const registry = new BlindTokenRegistry();

  assert.ok(registry.redeem(token), "first redeem should succeed");
  assert.ok(!registry.redeem(token), "second redeem should fail (double spend)");
});

test("BlindTokenRegistry: different tokens can both be redeemed once", () => {
  const mint = new BlindMint();
  const { token: t1 } = fullFlow(mint, "token-1");
  const { token: t2 } = fullFlow(mint, "token-2");
  const registry = new BlindTokenRegistry();

  assert.ok(registry.redeem(t1));
  assert.ok(registry.redeem(t2));
  assert.strictEqual(registry.size(), 2);
});

test("unlinkability: mint cannot link blind request to unblinded token", () => {
  // This test documents the unlinkability property.
  // The mint sees blindedPointHex (B') and its own C'.
  // The client's unblinded token C = C' - r*K.
  // Without r, there is no way to compute C from C' (discrete log hardness).
  // We verify that the blind and unblind points are always different.
  const mint = new BlindMint();
  const { blindedPointHex, mintResponse, token } = fullFlow(mint, "unlinkability-test");

  assert.notStrictEqual(
    blindedPointHex,
    token.tokenPointHex,
    "blinded request != unblinded token (mint cannot link them)"
  );
  assert.notStrictEqual(
    mintResponse.blindSignatureHex,
    token.tokenPointHex,
    "blind signature != unblinded token"
  );
});

test("hashToCurve is deterministic: same secret yields same token point", () => {
  // Two mints with the same key, same secret, should produce the same token.
  const mint1 = new BlindMint();
  const skHex = mint1.exportSecretKeyHex();
  const mint2 = new BlindMint(skHex);

  const { token: t1 } = fullFlow(mint1, "deterministic-secret");
  const { token: t2 } = fullFlow(mint2, "deterministic-secret");

  assert.strictEqual(t1.tokenPointHex, t2.tokenPointHex, "same key + same secret = same token point");
});
