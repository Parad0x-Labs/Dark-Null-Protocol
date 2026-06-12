/**
 * integration/x402-hooks.mjs
 *
 * Drop-in `onReceiptFinalized` callbacks that wire Dark NULL programs into
 * any dna-x402 paywall. Usage:
 *
 *   import { makeAccumulatorHook, makeInferenceHook } from "./x402-hooks.mjs";
 *
 *   dnaPaywall({
 *     ...opts,
 *     onReceiptFinalized: combineHooks(
 *       makeAccumulatorHook(connection, payer),
 *       makeInferenceHook(connection, payer, oraclePriv, modelHash),
 *     ),
 *   });
 */

import { createHash } from "node:crypto";
import {
  accumulateReceipt,
  initAccumulator,
  readAccumulator,
  recordInference,
  sha256,
} from "./programs.mjs";

// ── Utility ───────────────────────────────────────────────────────────────────

/**
 * Combine multiple onReceiptFinalized handlers into one.
 * All run in parallel; errors are logged but do not fail the payment.
 */
export function combineHooks(...hooks) {
  return async (info) => {
    await Promise.allSettled(hooks.map((h) => h(info)));
  };
}

// ── Hook 1: Receipt Commitment Accumulator ────────────────────────────────────
//
// Adds every x402 receipt hash to the rolling SHA256 accumulator on-chain.
// The accumulator builds a verifiable commitment over all receipts in a session,
// letting anyone prove "this receipt was part of this session" without
// revealing individual receipt contents.
//
// Real benefit: session-level auditability without per-call on-chain cost;
// one accumulator root proves the full session history.

/**
 * @param connection - Solana connection
 * @param payer     - Keypair that owns the accumulator PDA
 * @returns onReceiptFinalized handler
 */
export function makeAccumulatorHook(connection, payer) {
  let initialized = false;

  return async function accumulatorHook(info) {
    if (!initialized) {
      await initAccumulator(connection, payer);
      initialized = true;
    }

    // Hash the x402 receipt ID to 32 bytes for the accumulator
    const receiptHash = sha256(info.receiptId, info.amountAtomic, info.mint);
    const txSig = await accumulateReceipt(connection, payer, receiptHash);

    const state = await readAccumulator(connection, payer.publicKey);
    console.log(
      `[dark-null/accumulator] receipt #${state.count} committed` +
      ` — rolling root: ${state.commitment.slice(0, 16)}…` +
      ` tx: ${txSig.slice(0, 16)}…`
    );
    return { commitment: state.commitment, count: state.count };
  };
}

// ── Hook 2: Oracle-Attested Inference Receipt ──────────────────────────────────
//
// When an AI API call is settled via x402, records an oracle-attested receipt
// on-chain binding (model, input, output) to the payment receipt.
//
// Real benefit: provable that a specific model ran for this payment —
// builds the foundation for "verifiable compute" billing where providers
// can't claim they ran GPT-4 and charge for it but actually ran GPT-3.5.

/**
 * @param connection     - Solana connection
 * @param payer          - Keypair that pays for PDA creation
 * @param oraclePrivKey  - 32-byte secp256k1 private key for oracle signing
 * @param modelHash      - 32-byte Buffer identifying the model
 * @param getIOHashes    - async fn(info) → { inputHash, outputHash } or null
 *                         Return null to skip inference recording for non-AI receipts.
 * @returns onReceiptFinalized handler
 */
export function makeInferenceHook(connection, payer, oraclePrivKey, modelHash, getIOHashes) {
  return async function inferenceHook(info) {
    const io = await getIOHashes(info);
    if (!io) return; // not an AI call, skip

    const { inputHash, outputHash } = io;
    const result = await recordInference(
      connection,
      payer,
      modelHash,
      inputHash,
      outputHash,
      oraclePrivKey
    );

    if (result.alreadyExisted) {
      console.log(`[dark-null/inference] receipt already on-chain for this input/output`);
      return;
    }

    console.log(
      `[dark-null/inference] on-chain attestation` +
      ` — model: ${Buffer.from(modelHash).toString("hex").slice(0, 16)}…` +
      ` receipt PDA: ${result.receiptPda.toBase58().slice(0, 16)}…` +
      ` tx: ${result.txSig.slice(0, 16)}…`
    );
    return result;
  };
}

// ── Hook 3: NULL Token Reward (post-payment) ──────────────────────────────────
//
// After a payment is finalized, emits a console event (and optionally mints NULL)
// based on the payment amount. This is the lightweight version — the full
// threshold-fed minting requires k-of-n federation keys.
//
// Real benefit: NULL rewards for API consumption create a flywheel — payers
// earn NULL, NULL gates premium features, premium features generate more payments.

/**
 * @param rewardRateBps - Basis points of payment amount to reward in NULL
 *                        (e.g. 500 = 5% of payment amount)
 * @param onReward     - async fn({ receiptId, rewardAtomic }) — caller implements
 *                       the actual NULL mint; this hook just calculates + signals
 * @returns onReceiptFinalized handler
 */
export function makeNullRewardHook(rewardRateBps, onReward) {
  return async function nullRewardHook(info) {
    const rewardAtomic = (BigInt(info.amountAtomic) * BigInt(rewardRateBps)) / 10_000n;
    if (rewardAtomic === 0n) return;

    console.log(
      `[dark-null/null-reward] ${rewardAtomic} NULL atoms earned` +
      ` for receipt ${info.receiptId.slice(0, 16)}…`
    );
    if (onReward) await onReward({ receiptId: info.receiptId, rewardAtomic });
  };
}

// ── Streaming session helpers ──────────────────────────────────────────────────
//
// These wrap the streaming micropayment channel into a session-aware payment
// pattern compatible with dna-x402 sessions.
//
// Real benefit: long agent sessions pay per-tick (per API call) instead of
// one upfront flat fee. The channel is opened once, ticked per call, and
// settled at session end — matching actual consumption to actual payment.

/**
 * Session state tracking for streaming payments.
 * The server opens a channel when the session starts, then ticks per API call.
 */
export class StreamingSession {
  constructor(connection, payer, recipient, channelPda, maxLamports, pricePerCall) {
    this.connection = connection;
    this.payer = payer;
    this.recipient = recipient;
    this.channelPda = channelPda;
    this.maxLamports = BigInt(maxLamports);
    this.pricePerCall = BigInt(pricePerCall);
    this.accumulated = 0n;
    this.callCount = 0;
  }

  /** Record a call against the channel (off-chain tick). */
  tick(units = 1) {
    const delta = this.pricePerCall * BigInt(units);
    if (this.accumulated + delta > this.maxLamports) {
      throw new Error(
        `Channel exhausted: ${this.accumulated + delta} > ${this.maxLamports}`
      );
    }
    this.accumulated += delta;
    this.callCount += units;
    return { accumulated: this.accumulated, callCount: this.callCount };
  }

  /** Close channel and settle accumulated lamports to recipient. */
  async settle(closeChannel) {
    const txSig = await closeChannel(
      this.connection,
      this.payer,
      this.recipient,
      this.channelPda,
      this.accumulated
    );
    console.log(
      `[dark-null/stream] session settled` +
      ` — ${this.callCount} calls, ${this.accumulated} lamports` +
      ` tx: ${txSig.slice(0, 16)}…`
    );
    return { txSig, accumulated: this.accumulated, callCount: this.callCount };
  }
}
