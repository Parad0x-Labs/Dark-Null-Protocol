#!/usr/bin/env node
/**
 * e2e-fiat-oracle.mjs
 *
 * End-to-end test for the dark-null-fiat-oracle program.
 *
 * Prerequisites:
 *   npm install @solana/web3.js @noble/curves
 *   Deploy the program and write its ID to programs/fiat-oracle/.program-id
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { secp256k1 } from "@noble/curves/secp256k1";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

const PROGRAM_ID_PATH = resolve(
  __dirname,
  "../programs/fiat-oracle/.program-id"
);
const PAYER_PATH = resolve(
  process.env.HOME || process.env.USERPROFILE,
  ".config/solana/id.json"
);

const programId = new PublicKey(
  readFileSync(PROGRAM_ID_PATH, "utf8").trim()
);
const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(PAYER_PATH, "utf8")))
);

const connection = new Connection(
  "https://api.devnet.solana.com",
  "confirmed"
);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Encode a u64 as an 8-byte little-endian Buffer. */
function writeUInt64LE(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

/** Find a PDA; returns [PublicKey, bump]. */
function findPda(seeds) {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

// ── Step 1: Oracle keypair (deterministic for repeatable e2e) ─────────────────

// Fixed test oracle private key — deterministic so the oracle_config PDA can
// be re-used across runs without re-registering.
const oraclePriv = createHash("sha256").update("fiat-oracle-e2e-test-key-v1").digest();
// getPublicKey(priv, false) → 65-byte uncompressed (0x04 || X || Y)
const oraclePubUncompressed = secp256k1.getPublicKey(oraclePriv, false);
// Drop the 0x04 prefix → 64 bytes
const oraclePub64 = oraclePubUncompressed.slice(1); // Uint8Array[64]

// ── Step 2: Derive oracle_config PDA ─────────────────────────────────────────

const [oracleConfigPda] = findPda([
  Buffer.from("fiat-oracle-v1"),
  payer.publicKey.toBuffer(),
]);

// ── Step 3: RegisterOracle instruction ───────────────────────────────────────
// ix_data = [0x00, ...oraclePub64]  (65 bytes total)

const registerData = Buffer.alloc(1 + 64);
registerData.writeUInt8(0, 0);
Buffer.from(oraclePub64).copy(registerData, 1);

const registerIx = new TransactionInstruction({
  programId,
  keys: [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: oracleConfigPda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: registerData,
});

// ── Step 4: Send RegisterOracle (close + re-register if pubkey mismatch) ──────

const existingConfig = await connection.getAccountInfo(oracleConfigPda);
if (existingConfig) {
  const storedPub = existingConfig.data.slice(32, 96); // authority[32..96]
  const keysMatch = Buffer.from(storedPub).equals(Buffer.from(oraclePub64));
  if (keysMatch) {
    console.log("RegisterOracle: already initialized with matching key, skipping");
  } else {
    // Close stale config (stale random key from prior run) then re-register
    console.log("RegisterOracle: stale key on-chain, closing first...");
    const closeData = Buffer.alloc(1);
    closeData.writeUInt8(2, 0); // discriminant 2 = CloseOracle
    const closeIx = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: oracleConfigPda, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: false, isWritable: true }, // destination
      ],
      data: closeData,
    });
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(closeIx),
      [payer]
    );
    console.log("CloseOracle: OK — re-registering with deterministic key...");
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(registerIx),
      [payer]
    );
    console.log("RegisterOracle: OK");
  }
} else {
  console.log("Sending RegisterOracle...");
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(registerIx),
    [payer]
  );
  console.log("RegisterOracle: OK");
}

// ── Step 5: Payment data ──────────────────────────────────────────────────────

// Include process.hrtime for a unique payment ID each run (avoids re-using a
// receipt PDA from a prior e2e run and hitting AccountAlreadyInitialized).
const [sec, ns] = process.hrtime();
const paymentId = createHash("sha256")
  .update("stripe-ch-test-" + sec + "-" + ns)
  .digest(); // Buffer[32]

const amountCents = 4999n; // $49.99
const recipientBytes = payer.publicKey.toBuffer(); // Buffer[32]

// ── Step 6: Message hash (must match on-chain hashv) ─────────────────────────
// SHA256(payment_id || amount_le || recipient)
// solana_program::hash::hashv uses SHA256 over concatenated slices.

const msgHash = createHash("sha256")
  .update(paymentId)
  .update(writeUInt64LE(amountCents))
  .update(recipientBytes)
  .digest(); // Buffer[32] — raw bytes, not hex

// ── Step 7: Oracle signature ──────────────────────────────────────────────────

const sig = secp256k1.sign(msgHash, oraclePriv, { lowS: true });
const recoveryId = sig.recovery; // 0 or 1

const compact = sig.toCompactRawBytes(); // Uint8Array[64]
const sigR = Buffer.from(compact.slice(0, 32));
const sigS = Buffer.from(compact.slice(32, 64));

// ── Step 8: Derive receipt PDA ────────────────────────────────────────────────

const [receiptPda] = findPda([
  Buffer.from("fiat-receipt-v1"),
  paymentId,
]);

// ── Step 9: SettleReceipt instruction ─────────────────────────────────────────
// ix.data layout (138 bytes total):
//   [0]        instruction tag = 0x01
//   [1..33]    payment_id        (32 bytes)
//   [33..41]   amount_usd_cents  (8 bytes, little-endian u64)
//   [41..73]   recipient         (32 bytes)
//   [73..105]  oracle_sig_r      (32 bytes)
//   [105..137] oracle_sig_s      (32 bytes)
//   [137]      recovery_id       (1 byte)
//
// Dispatcher strips the tag; lib.rs settle_receipt receives 137 bytes and
// parses: [0..32]=payment_id, [32..40]=amount, [40..72]=recipient,
//         [72..104]=r, [104..136]=s, [136]=recovery_id.

const settleData = Buffer.alloc(1 + 137);
let off = 0;
settleData.writeUInt8(1, off); off += 1;
paymentId.copy(settleData, off); off += 32;
writeUInt64LE(amountCents).copy(settleData, off); off += 8;
recipientBytes.copy(settleData, off); off += 32;
sigR.copy(settleData, off); off += 32;
sigS.copy(settleData, off); off += 32;
settleData.writeUInt8(recoveryId, off);

const settleIx = new TransactionInstruction({
  programId,
  keys: [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: oracleConfigPda, isSigner: false, isWritable: false },
    { pubkey: receiptPda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: settleData,
});

// ── Step 10: Send SettleReceipt ───────────────────────────────────────────────

console.log("Sending SettleReceipt...");
await sendAndConfirmTransaction(
  connection,
  new Transaction().add(settleIx),
  [payer]
);
console.log("SettleReceipt: OK");

// ── Step 11: Fetch and verify receipt PDA ────────────────────────────────────
// ReceiptRecord layout (Borsh):
//   payment_id:      [u8;32]  @ 0..32
//   amount_usd_cents: u64 LE  @ 32..40
//   recipient:       [u8;32]  @ 40..72
//   bump:            u8       @ 72

const receiptAcct = await connection.getAccountInfo(receiptPda);
if (!receiptAcct) throw new Error("Receipt PDA not found after SettleReceipt");

// Borsh-encoded struct starts at byte 0 (no discriminator in native program).
const storedAmount = receiptAcct.data.readBigUInt64LE(32);
if (storedAmount !== amountCents) {
  throw new Error(
    `amount_usd_cents mismatch: expected ${amountCents}, got ${storedAmount}`
  );
}
console.log(`Receipt verified: amount_usd_cents = ${storedAmount} ✓`);

// ── Step 12: Replay protection ────────────────────────────────────────────────

console.log("Testing replay protection...");
let replayFailed = false;
try {
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(settleIx),
    [payer]
  );
} catch (_e) {
  replayFailed = true;
}
if (!replayFailed) {
  throw new Error("Replay protection FAILED — duplicate receipt accepted");
}
console.log("Replay protection: OK");

// ── Done ──────────────────────────────────────────────────────────────────────

console.log("e2e-fiat-oracle PASSED");
