import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  PAYMENT_STREAM_SCHEMA,
  closeChannel,
  generateStreamKeys,
  getSettlementAmount,
  openChannel,
  tick,
  tickSupersedes,
  verifySettlement,
  verifyTick,
} from "../swarm/payment-stream.mjs";

// ─── Key generation ──────────────────────────────────────────────────────────

test("generateStreamKeys returns schema, private, public", () => {
  const keys = generateStreamKeys();
  assert.equal(keys.schema, PAYMENT_STREAM_SCHEMA);
  assert.ok(keys.private, "private key missing");
  assert.equal(keys.public.length, 66, "public key must be 33-byte compressed (66 hex chars)");
});

// ─── Channel open ─────────────────────────────────────────────────────────────

test("openChannel returns an open channel with correct fields", () => {
  const payer = generateStreamKeys();
  const recipient = generateStreamKeys();
  const ch = openChannel(payer, recipient.public, 1_000_000, 0);
  assert.equal(ch.schema, PAYMENT_STREAM_SCHEMA);
  assert.equal(ch.state, "open");
  assert.equal(ch.max_lamports, 1_000_000);
  assert.equal(ch.sequence, 0);
  assert.equal(ch.accumulated_lamports, 0);
  assert.ok(ch.channel_id, "channel_id missing");
});

test("openChannel with same keys and different nonce produces different channel_id", () => {
  const payer = generateStreamKeys();
  const recipient = generateStreamKeys();
  const ch0 = openChannel(payer, recipient.public, 1_000, 0);
  const ch1 = openChannel(payer, recipient.public, 1_000, 1);
  assert.notEqual(ch0.channel_id, ch1.channel_id);
});

test("openChannel rejects max_lamports <= 0", () => {
  const payer = generateStreamKeys();
  const recipient = generateStreamKeys();
  assert.throws(() => openChannel(payer, recipient.public, 0), /positive/);
});

// ─── Ticks ────────────────────────────────────────────────────────────────────

test("tick increments sequence and accumulated_lamports", () => {
  const payer = generateStreamKeys();
  const recipient = generateStreamKeys();
  const ch = openChannel(payer, recipient.public, 1_000, 0);
  const { tick: t, channel: ch2 } = tick(ch, payer, 100);
  assert.equal(t.sequence, 1);
  assert.equal(t.accumulated_lamports, 100);
  assert.equal(ch2.accumulated_lamports, 100);
  assert.equal(ch2.sequence, 1);
});

test("multiple ticks accumulate correctly", () => {
  const payer = generateStreamKeys();
  const recipient = generateStreamKeys();
  let ch = openChannel(payer, recipient.public, 1_000, 0);
  let t;
  ({ tick: t, channel: ch } = tick(ch, payer, 100));
  ({ tick: t, channel: ch } = tick(ch, payer, 200));
  ({ tick: t, channel: ch } = tick(ch, payer, 300));
  assert.equal(t.accumulated_lamports, 600);
  assert.equal(t.sequence, 3);
  assert.equal(ch.accumulated_lamports, 600);
});

test("tick rejects delta_lamports <= 0", () => {
  const payer = generateStreamKeys();
  const recipient = generateStreamKeys();
  const ch = openChannel(payer, recipient.public, 1_000, 0);
  assert.throws(() => tick(ch, payer, 0), /positive/);
});

test("tick rejects amount exceeding max_lamports", () => {
  const payer = generateStreamKeys();
  const recipient = generateStreamKeys();
  const ch = openChannel(payer, recipient.public, 100, 0);
  assert.throws(() => tick(ch, payer, 101), /max_lamports/);
});

test("verifyTick: recipient verifies payer signature on tick", () => {
  const payer = generateStreamKeys();
  const recipient = generateStreamKeys();
  const ch = openChannel(payer, recipient.public, 1_000, 0);
  const { tick: t } = tick(ch, payer, 100);
  const valid = verifyTick(ch.channel_id, t, payer.public);
  assert.ok(valid, "tick signature must verify");
});

test("verifyTick: tampered tick_hash fails verification", () => {
  const payer = generateStreamKeys();
  const recipient = generateStreamKeys();
  const ch = openChannel(payer, recipient.public, 1_000, 0);
  const { tick: t } = tick(ch, payer, 100);
  const tampered = { ...t, tick_hash: t.tick_hash.replace(/a/, "b") };
  const valid = verifyTick(ch.channel_id, tampered, payer.public);
  assert.ok(!valid, "tampered tick should not verify");
});

// ─── Close + settlement ───────────────────────────────────────────────────────

test("closeChannel produces a valid settlement", () => {
  const payer = generateStreamKeys();
  const recipient = generateStreamKeys();
  let ch = openChannel(payer, recipient.public, 1_000, 0);
  let t;
  ({ tick: t, channel: ch } = tick(ch, payer, 250));
  const settlement = closeChannel(ch, t, recipient);
  assert.equal(settlement.schema, PAYMENT_STREAM_SCHEMA);
  assert.equal(settlement.state, "settled");
  assert.equal(settlement.settlement_lamports, 250);
});

test("verifySettlement: both signatures valid after close", () => {
  const payer = generateStreamKeys();
  const recipient = generateStreamKeys();
  let ch = openChannel(payer, recipient.public, 1_000, 0);
  let t;
  ({ tick: t, channel: ch } = tick(ch, payer, 500));
  const settlement = closeChannel(ch, t, recipient);
  const result = verifySettlement(settlement, 1_000);
  assert.ok(result.ok, `settlement must verify: ${result.failures.join(", ")}`);
  assert.equal(result.failures.length, 0);
});

test("verifySettlement rejects settlement exceeding max_lamports", () => {
  const payer = generateStreamKeys();
  const recipient = generateStreamKeys();
  let ch = openChannel(payer, recipient.public, 1_000, 0);
  let t;
  ({ tick: t, channel: ch } = tick(ch, payer, 500));
  const settlement = closeChannel(ch, t, recipient);
  const result = verifySettlement(settlement, 400);
  assert.ok(!result.ok, "should reject amount exceeding max");
});

test("getSettlementAmount returns final accumulated value", () => {
  const payer = generateStreamKeys();
  const recipient = generateStreamKeys();
  let ch = openChannel(payer, recipient.public, 1_000, 0);
  let t;
  ({ tick: t, channel: ch } = tick(ch, payer, 300));
  ({ tick: t, channel: ch } = tick(ch, payer, 150));
  assert.equal(getSettlementAmount(t), 450);
});

// ─── Dispute ──────────────────────────────────────────────────────────────────

test("tickSupersedes: higher sequence supersedes lower", () => {
  const payer = generateStreamKeys();
  const recipient = generateStreamKeys();
  let ch = openChannel(payer, recipient.public, 1_000, 0);
  let t1, t2;
  ({ tick: t1, channel: ch } = tick(ch, payer, 100));
  ({ tick: t2, channel: ch } = tick(ch, payer, 100));
  assert.ok(tickSupersedes(t2, t1), "t2 (seq 2) should supersede t1 (seq 1)");
  assert.ok(!tickSupersedes(t1, t2), "t1 (seq 1) should not supersede t2 (seq 2)");
});
