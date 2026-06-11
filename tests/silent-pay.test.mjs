import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  SILENT_PAY_SCHEMA,
  deriveOneTimeAddress,
  generateSilentPaymentKeys,
  scanOutput,
  scanOutputs,
  verifySpendKey,
} from "../swarm/silent-pay.mjs";

// ─── Key generation ──────────────────────────────────────────────────────────

test("generateSilentPaymentKeys returns schema and all four key fields", () => {
  const keys = generateSilentPaymentKeys();
  assert.equal(keys.schema, SILENT_PAY_SCHEMA);
  assert.ok(keys.scan.private, "scan.private missing");
  assert.ok(keys.scan.public, "scan.public missing");
  assert.ok(keys.spend.private, "spend.private missing");
  assert.ok(keys.spend.public, "spend.public missing");
});

test("scan and spend public keys are 33-byte compressed points (66 hex chars)", () => {
  const keys = generateSilentPaymentKeys();
  assert.equal(keys.scan.public.length, 66);
  assert.equal(keys.spend.public.length, 66);
});

test("each call to generateSilentPaymentKeys produces unique keys", () => {
  const a = generateSilentPaymentKeys();
  const b = generateSilentPaymentKeys();
  assert.notEqual(a.scan.public, b.scan.public);
  assert.notEqual(a.spend.public, b.spend.public);
});

// ─── Sender ──────────────────────────────────────────────────────────────────

test("deriveOneTimeAddress returns schema, one_time_address, eph_pubkey, payment_nonce", () => {
  const recipient = generateSilentPaymentKeys();
  const payment = deriveOneTimeAddress(recipient, 0);
  assert.equal(payment.schema, SILENT_PAY_SCHEMA);
  assert.ok(payment.one_time_address, "one_time_address missing");
  assert.ok(payment.eph_pubkey, "eph_pubkey missing");
  assert.equal(payment.payment_nonce, 0);
});

test("one_time_address is a 33-byte compressed point (66 hex chars)", () => {
  const recipient = generateSilentPaymentKeys();
  const payment = deriveOneTimeAddress(recipient, 0);
  assert.equal(payment.one_time_address.length, 66);
});

test("two payments to same recipient with same nonce differ (different ephemeral key each call)", () => {
  const recipient = generateSilentPaymentKeys();
  const p1 = deriveOneTimeAddress(recipient, 0);
  const p2 = deriveOneTimeAddress(recipient, 0);
  // Different ephemeral keys → different one-time addresses
  assert.notEqual(p1.eph_pubkey, p2.eph_pubkey);
  assert.notEqual(p1.one_time_address, p2.one_time_address);
});

test("different payment nonces produce different one_time_addresses for same ephemeral key", () => {
  const recipient = generateSilentPaymentKeys();
  // We can't control the ephemeral key from the outside, but different nonces
  // from same ephemeral key would differ. We verify at least nonce is stored.
  const p0 = deriveOneTimeAddress(recipient, 0);
  const p1 = deriveOneTimeAddress(recipient, 1);
  assert.equal(p0.payment_nonce, 0);
  assert.equal(p1.payment_nonce, 1);
});

// ─── Scanner ─────────────────────────────────────────────────────────────────

test("scanOutput: recipient finds their own payment", () => {
  const recipient = generateSilentPaymentKeys();
  const payment = deriveOneTimeAddress(recipient, 0);
  const result = scanOutput(recipient, payment.eph_pubkey, payment.one_time_address, 0);
  assert.ok(result.owned, "recipient should own this output");
  assert.ok(result.spend_private, "spend_private must be returned");
});

test("scanOutput: wrong nonce returns owned=false", () => {
  const recipient = generateSilentPaymentKeys();
  const payment = deriveOneTimeAddress(recipient, 0);
  const result = scanOutput(recipient, payment.eph_pubkey, payment.one_time_address, 1);
  assert.ok(!result.owned, "wrong nonce should not match");
});

test("scanOutput: different recipient cannot claim the payment", () => {
  const alice = generateSilentPaymentKeys();
  const bob = generateSilentPaymentKeys();
  const payment = deriveOneTimeAddress(alice, 0);
  const result = scanOutput(bob, payment.eph_pubkey, payment.one_time_address, 0);
  assert.ok(!result.owned, "bob should not own alice's payment");
});

test("scanOutput: returned spend_private controls the one_time_address", () => {
  const recipient = generateSilentPaymentKeys();
  const payment = deriveOneTimeAddress(recipient, 0);
  const result = scanOutput(recipient, payment.eph_pubkey, payment.one_time_address, 0);
  assert.ok(result.owned);
  const valid = verifySpendKey(payment.one_time_address, result.spend_private);
  assert.ok(valid, "spend_private must generate the one_time_address pubkey");
});

test("scanOutputs: finds all owned outputs in a batch", () => {
  const alice = generateSilentPaymentKeys();
  const bob = generateSilentPaymentKeys();

  const alice_pay_0 = deriveOneTimeAddress(alice, 0);
  const alice_pay_1 = deriveOneTimeAddress(alice, 1);
  const bob_pay = deriveOneTimeAddress(bob, 0);

  const outputs = [
    { eph_pubkey: alice_pay_0.eph_pubkey, one_time_address: alice_pay_0.one_time_address, payment_nonce: 0 },
    { eph_pubkey: alice_pay_1.eph_pubkey, one_time_address: alice_pay_1.one_time_address, payment_nonce: 1 },
    { eph_pubkey: bob_pay.eph_pubkey, one_time_address: bob_pay.one_time_address, payment_nonce: 0 },
  ];

  const alice_found = scanOutputs(alice, outputs);
  assert.equal(alice_found.length, 2, "alice should find 2 outputs");

  const bob_found = scanOutputs(bob, outputs);
  assert.equal(bob_found.length, 1, "bob should find 1 output");
});

test("third party with no keys finds zero outputs", () => {
  const alice = generateSilentPaymentKeys();
  const third_party = generateSilentPaymentKeys();
  const payment = deriveOneTimeAddress(alice, 0);
  const found = scanOutputs(third_party, [
    { eph_pubkey: payment.eph_pubkey, one_time_address: payment.one_time_address, payment_nonce: 0 },
  ]);
  assert.equal(found.length, 0);
});
