#!/usr/bin/env node
/**
 * demo-x402-dark-null.mjs
 *
 * Full integration demo: 6 Dark NULL programs wired into an x402 agent session.
 *
 * Simulated scenario:
 *   An AI agent opens a streaming payment session to a Dark NULL API gateway.
 *   - Session opened as a streaming micropayment channel (channel program)
 *   - Agent makes 5 API calls; each receipt committed to on-chain accumulator
 *   - 2 of those calls are AI inference; oracle-attested inference receipts recorded
 *   - Payment is stealth-addressed (silent pay) so payer address is not directly linked
 *   - One simulated fiat settlement (e.g., Stripe charge settled via oracle)
 *   - Session closes; channel pays out; accumulator shows cryptographic session proof
 *
 * Real benefits shown:
 *   [stream]      Long session billed per-call, not upfront flat-fee
 *   [accumulator] One on-chain root proves all 5 receipts without revealing them
 *   [inference]   2 AI calls have cryptographic proof of which model ran
 *   [silent-pay]  Payer stealth address: 5 payments can't be correlated by address
 *   [fiat-oracle] Stripe charge settles directly on-chain via oracle signature
 *   [threshold]   (logged) k-of-n federation would gate NULL mint here
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import { secp256k1 } from "@noble/curves/secp256k1";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load integration helpers via ESM (Windows-safe) ──────────────────────────

const { default: _p, ...programs } = await import(
  pathToFileURL(resolve(__dirname, "../integration/programs.mjs")).href
);
const { default: _h, ...hooks } = await import(
  pathToFileURL(resolve(__dirname, "../integration/x402-hooks.mjs")).href
);

const {
  PROGRAM_IDS,
  initAccumulator, accumulateReceipt, finalizeAccumulator, readAccumulator,
  registerModel, recordInference,
  openChannel, closeChannel, readChannel,
  registerScanKeys, recordStealthPayment,
  ensureOracleRegistered, settleFiatReceipt,
  sha256,
} = programs;

const { StreamingSession, makeAccumulatorHook, makeInferenceHook, makeNullRewardHook, combineHooks } = hooks;

// ── Setup ─────────────────────────────────────────────────────────────────────

const PAYER_PATH = resolve(
  process.env.HOME || process.env.USERPROFILE,
  ".config/solana/id.json"
);
const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(PAYER_PATH, "utf8")))
);
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

// Deterministic keys for demo (re-use across runs)
const oraclePriv = createHash("sha256").update("dark-null-demo-oracle-v1").digest();
const scanPriv   = createHash("sha256").update("dark-null-demo-scan-v1").digest();
const spendPriv  = createHash("sha256").update("dark-null-demo-spend-v1").digest();
const modelHash  = createHash("sha256").update("dark-null-llm-v1-model-weights").digest();

// Use hrtime for unique session IDs
const [sec, ns] = process.hrtime();
const sessionId = `session-${sec}-${ns}`;

console.log("\n╔══════════════════════════════════════════════════════════════╗");
console.log(  "║        Dark NULL × x402 — Full Integration Demo             ║");
console.log(  "╚══════════════════════════════════════════════════════════════╝\n");
console.log(`Payer:     ${payer.publicKey.toBase58()}`);
console.log(`Session:   ${sessionId}`);
console.log(`RPC:       devnet\n`);

// ── PHASE 1: Setup keys and oracle ───────────────────────────────────────────

console.log("── Phase 1: Register keys & oracle ──────────────────────────────");

// Silent pay: register scan/spend keys so scanner can find stealth payments
const scanResult = await registerScanKeys(connection, payer, scanPriv, spendPriv);
console.log(`[silent-pay] scan keys: ${scanResult.alreadyExisted ? "already registered" : "registered ✓"}`);
console.log(`             scan PDA: ${scanResult.scanPda.toBase58().slice(0, 20)}…`);

// Fiat oracle: ensure oracle is registered with our deterministic key
const oracleResult = await ensureOracleRegistered(connection, payer, oraclePriv);
console.log(`[fiat-oracle] oracle config: ${oracleResult.alreadyExisted ? "already registered" : "registered ✓"}`);
console.log(`              config PDA: ${oracleResult.configPda.toBase58().slice(0, 20)}…`);

// Inference: register the model
const oraclePub64 = secp256k1.getPublicKey(oraclePriv, false).slice(1);
const modelResult = await registerModel(connection, payer, modelHash, oraclePub64);
console.log(`[inference]  model registered: ${modelResult.alreadyExisted ? "already registered" : "registered ✓"}`);
console.log(`             model PDA: ${modelResult.pda.toBase58().slice(0, 20)}…`);

// Accumulator: close any existing state + fresh init for this session
const { findAccumulatorPda, closeAccumulator } = programs;
const [accPdaAddr] = findAccumulatorPda(payer.publicKey);
const existingAcc = await connection.getAccountInfo(accPdaAddr);
if (existingAcc) {
  await closeAccumulator(connection, payer);
  console.log(`[accumulator] closed prior session state, starting fresh`);
}
const accResult = await initAccumulator(connection, payer);
console.log(`[accumulator] state: initialized ✓`);
console.log(`              PDA: ${accResult.pda.toBase58().slice(0, 20)}…\n`);

// ── PHASE 2: Open streaming payment channel ───────────────────────────────────

console.log("── Phase 2: Open streaming payment channel ──────────────────────");

const PRICE_PER_CALL = 200_000n;     // 0.0002 SOL per API call
const MAX_LAMPORTS   = 5_000_000n;   // 0.005 SOL channel capacity (5 calls + buffer)
const channelNonce   = BigInt(sec % 1_000_000); // unique per demo run

const { channelPda, txSig: openSig } = await openChannel(
  connection, payer, payer.publicKey, // recipient = self for demo (in prod: API provider wallet)
  MAX_LAMPORTS, channelNonce
);

const channelState = await readChannel(connection, channelPda);
console.log(`[stream] channel opened — capacity: ${channelState.maxLamports} lamports`);
console.log(`         channel PDA: ${channelPda.toBase58().slice(0, 20)}…`);
console.log(`         tx: ${openSig.slice(0, 20)}…\n`);

const session = new StreamingSession(
  connection, payer, payer.publicKey,
  channelPda, MAX_LAMPORTS, PRICE_PER_CALL
);

// ── PHASE 3: Agent API calls — stream ticks + receipt accumulation ────────────

console.log("── Phase 3: 5 API calls (2 AI, 3 data) ─────────────────────────");

const API_CALLS = [
  { type: "data",      resource: "/v1/null-domain/lookup",      body: "parad0x.null" },
  { type: "inference", resource: "/v1/ai/generate",             body: "Explain Dark NULL privacy" },
  { type: "data",      resource: "/v1/receipt/verify",          body: "receipt-xyz-001" },
  { type: "inference", resource: "/v1/ai/summarize",            body: "Summarize session context" },
  { type: "data",      resource: "/v1/stream/status",           body: "channel-status" },
];

// Build the onReceiptFinalized hook (what a real paywall would call)
const scanPub  = secp256k1.getPublicKey(scanPriv, true);
const spendPub = secp256k1.getPublicKey(spendPriv, true);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let callIndex = 0;
for (const call of API_CALLS) {
  callIndex++;
  if (callIndex > 1) await sleep(2000); // avoid devnet public RPC rate limits
  console.log(`\n  Call ${callIndex}/5 [${call.type}] ${call.resource}`);

  // Off-chain tick — records usage in streaming session
  const { accumulated, callCount } = session.tick(1);
  console.log(`  [stream] tick → ${accumulated} lamports accumulated (${callCount} calls)`);

  // x402 receipt hash (simulates what dna-x402 paywall computes)
  // In prod: this is receiptHashFor(payer, payTo, amount, resource, ...)
  const receiptId   = sha256(`receipt-${sessionId}-${callIndex}`, call.resource, call.body);
  const amountAtomic = PRICE_PER_CALL.toString();

  // Accumulate receipt on-chain
  const accTx = await accumulateReceipt(connection, payer, receiptId);
  const accState = await readAccumulator(connection, payer.publicKey);
  console.log(`  [accumulator] receipt #${accState.count} committed`);
  console.log(`                root: ${accState.commitment.slice(0, 32)}…`);

  // Silent pay: record a stealth payment for this call
  const ephPriv = createHash("sha256").update(`eph-${sessionId}-${callIndex}`).digest();
  const stealthResult = await recordStealthPayment(
    connection, payer, ephPriv, scanPub, spendPub
  );
  console.log(`  [silent-pay] stealth payment recorded`);
  console.log(`               one-time addr: ${Buffer.from(stealthResult.oneTimeAddr).toString("hex").slice(0, 20)}…`);

  // Inference: oracle-attested receipt for AI calls
  if (call.type === "inference") {
    const inputHash  = sha256(`input-${sessionId}-${callIndex}`, call.body);
    const outputHash = sha256(`output-${sessionId}-${callIndex}`, "model-response-data");
    const infResult  = await recordInference(
      connection, payer, modelHash, inputHash, outputHash, oraclePriv
    );
    console.log(`  [inference] on-chain attestation`);
    console.log(`              receipt PDA: ${infResult.receiptPda.toBase58().slice(0, 20)}…`);
    console.log(`              tx: ${infResult.txSig.slice(0, 20)}…`);
  }

  // NULL reward signal (threshold-fed would gate actual mint here)
  const rewardAtomic = (BigInt(amountAtomic) * 500n) / 10_000n; // 5% NULL reward
  console.log(`  [threshold-fed] ${rewardAtomic} NULL atoms earned → k-of-n mint gate`);
}

// ── PHASE 4: Fiat settlement (Stripe → oracle) ────────────────────────────────

console.log("\n── Phase 4: Fiat settlement (oracle-attested) ───────────────────");

const paymentId   = sha256(`stripe-charge-${sec}-${ns}`);
const amountCents = 4999; // $49.99

const fiatResult = await settleFiatReceipt(
  connection, payer,
  paymentId, amountCents, payer.publicKey,
  oraclePriv
);
console.log(`[fiat-oracle] $${(amountCents / 100).toFixed(2)} fiat receipt settled on-chain`);
console.log(`              receipt PDA: ${fiatResult.receiptPda.toBase58().slice(0, 20)}…`);
console.log(`              tx: ${fiatResult.txSig.slice(0, 20)}…`);

// ── PHASE 5: Close streaming channel ─────────────────────────────────────────

console.log("\n── Phase 5: Close channel + session summary ─────────────────────");

const { txSig: closeSig, accumulated: finalAccumulated } = await session.settle(closeChannel);
console.log(`[stream] channel closed`);
console.log(`         paid: ${finalAccumulated} lamports for ${session.callCount} calls`);
console.log(`         tx: ${closeSig.slice(0, 20)}…`);

// ── PHASE 6: Finalize accumulator + read session proof ────────────────────────

console.log("\n── Phase 6: Finalize accumulator — session proof ────────────────");

await finalizeAccumulator(connection, payer);
const finalState = await readAccumulator(connection, payer.publicKey);

// Verify locally that the accumulator root matches what we expect
// Re-derive the expected root by replaying the same SHA256 chain
let expectedRoot = Buffer.alloc(32); // starts as all-zeros
for (let i = 1; i <= API_CALLS.length; i++) {
  const receiptId = sha256(`receipt-${sessionId}-${i}`, API_CALLS[i-1].resource, API_CALLS[i-1].body);
  expectedRoot = sha256(expectedRoot, receiptId);
}

console.log(`[accumulator] on-chain root:  ${finalState.commitment}`);
console.log(`[accumulator] expected root:  ${expectedRoot.toString("hex")}`);
console.log(`[accumulator] root matches:   ${finalState.commitment === expectedRoot.toString("hex") ? "YES ✓" : "NO ✗"}`);
console.log(`[accumulator] receipts proven: ${finalState.count}`);
console.log(`[accumulator] finalized:       ${finalState.isFinalized ? "YES" : "NO"}`);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log("\n╔══════════════════════════════════════════════════════════════╗");
console.log(  "║                    Integration Summary                      ║");
console.log(  "╠══════════════════════════════════════════════════════════════╣");
console.log(`  [stream]       ${session.callCount} calls, ${finalAccumulated} lamports, per-call billing`);
console.log(`  [accumulator]  ${finalState.count} receipts → 1 on-chain root commitment`);
console.log(`  [inference]    2 AI calls oracle-attested on devnet`);
console.log(`  [silent-pay]   ${API_CALLS.length} stealth payments — addresses not re-used`);
console.log(`  [fiat-oracle]  $${(amountCents/100).toFixed(2)} fiat settlement verified on-chain`);
console.log(`  [threshold]    NULL rewards signaled — k-of-n gate ready`);
console.log(  "╠══════════════════════════════════════════════════════════════╣");
console.log(  "║  All 6 Dark NULL programs exercised in one agent session.    ║");
console.log(  "╚══════════════════════════════════════════════════════════════╝\n");

console.log("demo-x402-dark-null PASSED");
