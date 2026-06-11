/**
 * Dark Null Private Streaming Micropayments — pay-per-unit without per-tick chain transactions.
 *
 * Opens one payment channel (one on-chain anchor), accumulates private off-chain
 * payment ticks signed by the payer, and closes with a single recipient-countersigned
 * settlement. Observers see open + close; individual tick amounts and count are private.
 *
 * Protocol:
 *   1. openChannel(payer_keys, recipient_pubkey, max_lamports)
 *      → channel_envelope (broadcast as on-chain open anchor)
 *
 *   2. tick(channel, payer_keys, delta_lamports)
 *      → signed tick (sent off-chain to recipient, never on-chain)
 *         tick_hash = H(channel_id || sequence || accumulated_lamports)
 *         payer_sig = sign(tick_hash)
 *
 *   3. close(channel, latest_tick, recipient_keys)
 *      → settlement (broadcast as on-chain close)
 *         recipient_sig = sign(H(channel_id || tick.sequence || tick.accumulated_lamports))
 *
 *   4. verifySettlement(settlement)
 *      → confirms both signatures valid; settlement amount is final
 *
 * Dispute rule: a tick with a higher sequence number supersedes a lower one.
 * The recipient can only close with the highest tick they hold.
 *
 * What is NOT claimed:
 *   - No Solana program deploys this yet; on-chain open/close is a future step.
 *   - Dispute resolution program not implemented.
 *   - Not audited.
 *   - See docs/2030_PRIMITIVES.md for claim boundaries.
 */

import { createHash } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1";

export const PAYMENT_STREAM_SCHEMA = "dark-null-payment-stream-v1";

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

function compressPoint(point) {
  return Buffer.from(point.toRawBytes(true));
}

function sha256(data) {
  return createHash("sha256").update(data).digest();
}

function sha256Hex(...parts) {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest("hex");
}

// Deterministic channel ID from (payer_pubkey, recipient_pubkey, nonce)
function deriveChannelId(payer_pubkey_hex, recipient_pubkey_hex, nonce) {
  const nonce_buf = Buffer.alloc(8);
  nonce_buf.writeBigUInt64BE(BigInt(nonce), 0);
  return sha256Hex(
    Buffer.from(payer_pubkey_hex, "hex"),
    Buffer.from(recipient_pubkey_hex, "hex"),
    nonce_buf,
  );
}

function tickMessage(channel_id, sequence, accumulated_lamports) {
  const seq_buf = Buffer.alloc(8);
  seq_buf.writeBigUInt64BE(BigInt(sequence), 0);
  const amt_buf = Buffer.alloc(8);
  amt_buf.writeBigUInt64BE(BigInt(accumulated_lamports), 0);
  return sha256(
    Buffer.concat([Buffer.from(channel_id, "hex"), seq_buf, amt_buf]),
  );
}

function signMessage(msg_hash, priv_scalar) {
  const sig = secp256k1.sign(msg_hash, bigIntTo32Bytes(priv_scalar), { lowS: true });
  return Buffer.from(sig.toCompactRawBytes()).toString("hex");
}

function verifySignature(msg_hash, sig_hex, pubkey_hex) {
  try {
    const pub = secp256k1.ProjectivePoint.fromHex(pubkey_hex);
    const sig = secp256k1.Signature.fromCompact(sig_hex);
    return secp256k1.verify(sig, msg_hash, pub.toRawBytes(true));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

export function generateStreamKeys() {
  const priv = randomScalar();
  const pub = G.multiply(priv);
  return {
    schema: PAYMENT_STREAM_SCHEMA,
    private: bigIntTo32Bytes(priv).toString("hex"),
    public: compressPoint(pub).toString("hex"),
  };
}

// ---------------------------------------------------------------------------
// Channel lifecycle
// ---------------------------------------------------------------------------

/**
 * Open a payment channel.
 * @param {object} payer_keys       — { private, public }
 * @param {string} recipient_pubkey — recipient's public key hex
 * @param {number} max_lamports     — maximum total payout
 * @param {number} nonce            — unique per channel (use a counter or timestamp)
 * @returns {object} channel envelope (post as on-chain open anchor)
 */
export function openChannel(payer_keys, recipient_pubkey, max_lamports, nonce = 0) {
  if (max_lamports <= 0) throw new Error("max_lamports must be positive");
  const channel_id = deriveChannelId(payer_keys.public, recipient_pubkey, nonce);
  return {
    schema: PAYMENT_STREAM_SCHEMA,
    channel_id,
    payer_pubkey: payer_keys.public,
    recipient_pubkey,
    max_lamports,
    nonce,
    sequence: 0,
    accumulated_lamports: 0,
    state: "open",
  };
}

/**
 * Issue a payment tick — increment the channel by delta_lamports.
 * Ticks are sent off-chain to the recipient; not posted on-chain individually.
 * @param {object} channel    — current channel state (returned by openChannel or prior tick)
 * @param {object} payer_keys — payer's key pair
 * @param {number} delta_lamports — amount to add this tick (must be > 0)
 * @returns {object} signed tick
 */
export function tick(channel, payer_keys, delta_lamports) {
  if (channel.state !== "open") throw new Error("channel is not open");
  if (delta_lamports <= 0) throw new Error("tick delta_lamports must be positive");
  const new_accumulated = channel.accumulated_lamports + delta_lamports;
  if (new_accumulated > channel.max_lamports) {
    throw new Error(
      `tick would exceed max_lamports (${new_accumulated} > ${channel.max_lamports})`,
    );
  }
  const sequence = channel.sequence + 1;
  const msg = tickMessage(channel.channel_id, sequence, new_accumulated);
  const priv = bytesToBigInt(Buffer.from(payer_keys.private, "hex"));
  const payer_sig = signMessage(msg, priv);
  const tick_hash = msg.toString("hex");

  const updated_channel = {
    ...channel,
    sequence,
    accumulated_lamports: new_accumulated,
  };

  const tick_obj = {
    schema: PAYMENT_STREAM_SCHEMA,
    channel_id: channel.channel_id,
    sequence,
    accumulated_lamports: new_accumulated,
    delta_lamports,
    tick_hash,
    payer_sig,
  };

  return { tick: tick_obj, channel: updated_channel };
}

/**
 * Verify a tick received from the payer (called by recipient).
 */
export function verifyTick(channel_id, tick_obj, payer_pubkey) {
  const msg = tickMessage(channel_id, tick_obj.sequence, tick_obj.accumulated_lamports);
  if (msg.toString("hex") !== tick_obj.tick_hash) return false;
  return verifySignature(msg, tick_obj.payer_sig, payer_pubkey);
}

/**
 * Close the channel — recipient countersigns the final tick to produce settlement.
 * @param {object} channel        — open channel envelope
 * @param {object} latest_tick    — highest sequence tick recipient holds
 * @param {object} recipient_keys — recipient's key pair
 * @returns {object} settlement (post as on-chain close)
 */
export function closeChannel(channel, latest_tick, recipient_keys) {
  if (channel.state !== "open") throw new Error("channel is not open");
  if (!verifyTick(channel.channel_id, latest_tick, channel.payer_pubkey)) {
    throw new Error("latest_tick payer signature is invalid");
  }
  const msg = tickMessage(
    channel.channel_id,
    latest_tick.sequence,
    latest_tick.accumulated_lamports,
  );
  const priv = bytesToBigInt(Buffer.from(recipient_keys.private, "hex"));
  const recipient_sig = signMessage(msg, priv);

  return {
    schema: PAYMENT_STREAM_SCHEMA,
    channel_id: channel.channel_id,
    payer_pubkey: channel.payer_pubkey,
    recipient_pubkey: channel.recipient_pubkey,
    final_sequence: latest_tick.sequence,
    settlement_lamports: latest_tick.accumulated_lamports,
    payer_sig: latest_tick.payer_sig,
    recipient_sig,
    state: "settled",
  };
}

/**
 * Verify a settlement — both signatures valid, amount within max.
 * Called by on-chain program or verifier.
 */
export function verifySettlement(settlement, max_lamports) {
  const failures = [];
  const msg = tickMessage(
    settlement.channel_id,
    settlement.final_sequence,
    settlement.settlement_lamports,
  );
  if (!verifySignature(msg, settlement.payer_sig, settlement.payer_pubkey)) {
    failures.push("payer_sig invalid");
  }
  if (!verifySignature(msg, settlement.recipient_sig, settlement.recipient_pubkey)) {
    failures.push("recipient_sig invalid");
  }
  if (max_lamports !== undefined && settlement.settlement_lamports > max_lamports) {
    failures.push(`settlement_lamports ${settlement.settlement_lamports} exceeds max ${max_lamports}`);
  }
  if (settlement.settlement_lamports < 0) {
    failures.push("settlement_lamports cannot be negative");
  }
  return { ok: failures.length === 0, failures };
}

/**
 * Dispute: returns true if tick_a supersedes tick_b (higher sequence wins).
 */
export function tickSupersedes(tick_a, tick_b) {
  return tick_a.channel_id === tick_b.channel_id && tick_a.sequence > tick_b.sequence;
}

/**
 * Get the current settlement amount from the latest tick.
 */
export function getSettlementAmount(tick_obj) {
  return tick_obj.accumulated_lamports;
}
