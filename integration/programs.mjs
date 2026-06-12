/**
 * integration/programs.mjs
 *
 * Typed client helpers for all 6 Dark NULL devnet programs.
 * Each helper builds the instruction bytes + sends the transaction.
 * All functions return the confirmed tx signature.
 *
 * Program IDs are read from programs/<name>/.program-id at import time.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { secp256k1 } from "@noble/curves/secp256k1";

const __dirname = dirname(fileURLToPath(import.meta.url));
const programsDir = resolve(__dirname, "../programs");

function readId(name) {
  return new PublicKey(
    readFileSync(resolve(programsDir, name, ".program-id"), "utf8").trim()
  );
}

// ── Program IDs ───────────────────────────────────────────────────────────────

export const PROGRAM_IDS = {
  silentPay:   readId("silent-pay"),
  stream:      readId("payment-stream"),
  threshold:   readId("threshold-fed"),
  fiatOracle:  readId("fiat-oracle"),
  accumulator: readId("accumulator"),
  inference:   readId("inference"),
};

// ── PDA helpers ───────────────────────────────────────────────────────────────

export function findAccumulatorPda(authority) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("accumulator-v1"), authority.toBuffer()],
    PROGRAM_IDS.accumulator
  );
}

export function findInferenceModelPda(modelHash) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("model-v1"), modelHash],
    PROGRAM_IDS.inference
  );
}

export function findInferenceReceiptPda(inputHash, outputHash) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("inference-v1"), inputHash, outputHash],
    PROGRAM_IDS.inference
  );
}

export function findStreamChannelPda(payer, recipient, nonce) {
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(BigInt(nonce));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stream-v1"), payer.toBuffer(), recipient.toBuffer(), nonceBuf],
    PROGRAM_IDS.stream
  );
}

export function findSilentPayScanKeyPda(walletPubkey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("silent-pay-v1"), walletPubkey.toBuffer()],
    PROGRAM_IDS.silentPay
  );
}

export function findFiatOracleConfigPda(authority) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("fiat-oracle-v1"), authority.toBuffer()],
    PROGRAM_IDS.fiatOracle
  );
}

export function findFiatReceiptPda(paymentId) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("fiat-receipt-v1"), paymentId],
    PROGRAM_IDS.fiatOracle
  );
}

// ── Utility ───────────────────────────────────────────────────────────────────

function u64LE(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

// ── Accumulator program ───────────────────────────────────────────────────────

/**
 * Close the accumulator PDA and return rent to payer.
 * Useful to reset between demo sessions.
 */
export async function closeAccumulator(connection, payer) {
  const [pda] = findAccumulatorPda(payer.publicKey);
  const data = Buffer.from([0x03]); // discriminant 3 = CloseAccumulator
  const ix = new TransactionInstruction({
    programId: PROGRAM_IDS.accumulator,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: pda, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: false, isWritable: true }, // destination = payer
    ],
    data,
  });
  return sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer]);
}

/**
 * Create the accumulator PDA for `authority`.
 * If already finalized, closes it first and re-creates.
 */
export async function initAccumulator(connection, payer) {
  const [pda] = findAccumulatorPda(payer.publicKey);
  const existing = await connection.getAccountInfo(pda);
  if (existing) {
    // Check if finalized — if so, close and re-init
    const isFinalized = existing.data[72] === 1;
    if (!isFinalized) return { pda, alreadyExisted: true };
    // Close stale finalized accumulator
    await closeAccumulator(connection, payer);
  }

  const data = Buffer.from([0x00]); // discriminant 0 = InitAccumulator
  const ix = new TransactionInstruction({
    programId: PROGRAM_IDS.accumulator,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: pda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer]);
  return { pda, sig, alreadyExisted: false };
}

/**
 * Add a receipt hash to the rolling accumulator commitment.
 * receiptHash must be a 32-byte Buffer/Uint8Array.
 */
export async function accumulateReceipt(connection, payer, receiptHash) {
  const [pda] = findAccumulatorPda(payer.publicKey);
  const data = Buffer.alloc(1 + 32);
  data.writeUInt8(0x01, 0); // discriminant 1 = AccumulateReceipt
  Buffer.from(receiptHash).copy(data, 1);
  const ix = new TransactionInstruction({
    programId: PROGRAM_IDS.accumulator,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: pda, isSigner: false, isWritable: true },
    ],
    data,
  });
  return sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer]);
}

/**
 * Finalize the accumulator — locks it against further accumulation.
 */
export async function finalizeAccumulator(connection, payer) {
  const [pda] = findAccumulatorPda(payer.publicKey);
  const data = Buffer.from([0x02]); // discriminant 2 = FinalizeAccumulator
  const ix = new TransactionInstruction({
    programId: PROGRAM_IDS.accumulator,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: pda, isSigner: false, isWritable: true },
    ],
    data,
  });
  return sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer]);
}

/**
 * Read the current accumulator state.
 * Returns { authority, commitment, count, isFinalized }.
 */
export async function readAccumulator(connection, authority) {
  const [pda] = findAccumulatorPda(authority);
  const acct = await connection.getAccountInfo(pda);
  if (!acct) return null;
  const d = acct.data;
  return {
    authority: new PublicKey(d.slice(0, 32)).toBase58(),
    commitment: d.slice(32, 64).toString("hex"),
    count:      Number(d.readBigUInt64LE(64)),
    isFinalized: d[72] === 1,
    bump: d[73],
  };
}

// ── Inference program ─────────────────────────────────────────────────────────

/**
 * Register a model with its oracle.
 * modelHash, oraclePub64 are Buffer/Uint8Array.
 * Idempotent — no-ops if model already registered.
 */
export async function registerModel(connection, payer, modelHash, oraclePub64) {
  const [pda] = findInferenceModelPda(modelHash);
  const existing = await connection.getAccountInfo(pda);
  if (existing) return { pda, alreadyExisted: true };

  const data = Buffer.alloc(1 + 32 + 64);
  data.writeUInt8(0x00, 0);
  Buffer.from(modelHash).copy(data, 1);
  Buffer.from(oraclePub64).copy(data, 33);
  const ix = new TransactionInstruction({
    programId: PROGRAM_IDS.inference,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: pda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer]);
  return { pda, sig, alreadyExisted: false };
}

/**
 * Record an oracle-attested inference receipt on-chain.
 *
 * @param oraclePrivKey - 32-byte secp256k1 private key (Buffer)
 */
export async function recordInference(connection, payer, modelHash, inputHash, outputHash, oraclePrivKey) {
  const [receiptPda] = findInferenceReceiptPda(inputHash, outputHash);
  const existing = await connection.getAccountInfo(receiptPda);
  if (existing) return { receiptPda, alreadyExisted: true };

  // Sign: msg_hash = SHA256(model_hash || input_hash || output_hash)
  const msgHash = createHash("sha256")
    .update(modelHash)
    .update(inputHash)
    .update(outputHash)
    .digest();

  const sig = secp256k1.sign(msgHash, oraclePrivKey, { lowS: true });
  const compact = sig.toCompactRawBytes();
  const recoveryId = sig.recovery;

  // Payload (1 + 32 + 32 + 32 + 32 + 32 + 1 = 162 bytes total):
  //   [0]       discriminant = 0x01
  //   [1..33]   model_hash
  //   [33..65]  input_hash
  //   [65..97]  output_hash
  //   [97..129] sig_r
  //   [129..161] sig_s
  //   [161]     recovery_id
  const data = Buffer.alloc(162);
  data.writeUInt8(0x01, 0);
  Buffer.from(modelHash).copy(data, 1);
  Buffer.from(inputHash).copy(data, 33);
  Buffer.from(outputHash).copy(data, 65);
  compact.slice(0, 32).forEach((b, i) => data.writeUInt8(b, 97 + i));
  compact.slice(32, 64).forEach((b, i) => data.writeUInt8(b, 129 + i));
  data.writeUInt8(recoveryId, 161);

  const [modelPda] = findInferenceModelPda(modelHash);
  const ix = new TransactionInstruction({
    programId: PROGRAM_IDS.inference,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: modelPda, isSigner: false, isWritable: false },
      { pubkey: receiptPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  const txSig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer]);
  return { receiptPda, txSig, alreadyExisted: false };
}

// ── Streaming micropayments program ───────────────────────────────────────────

/**
 * Open a streaming payment channel.
 * Returns { channelPda, nonce, txSig }.
 *
 * Accounts: payer (signer+writable), recipient (read-only),
 *           channel_pda (writable), system_program
 * Payload (16 bytes after discriminant):
 *   max_lamports u64LE (8) | nonce [u8;8] (8)
 */
export async function openChannel(connection, payer, recipientPubkey, maxLamports, nonce) {
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(BigInt(nonce));

  const [channelPda] = findStreamChannelPda(payer.publicKey, recipientPubkey, nonce);

  const data = Buffer.alloc(17); // 1 discriminant + 16 payload
  data.writeUInt8(0x00, 0);
  u64LE(maxLamports).copy(data, 1);
  nonceBuf.copy(data, 9);

  const ix = new TransactionInstruction({
    programId: PROGRAM_IDS.stream,
    keys: [
      { pubkey: payer.publicKey,            isSigner: true,  isWritable: true  },
      { pubkey: recipientPubkey,            isSigner: false, isWritable: false },
      { pubkey: channelPda,                 isSigner: false, isWritable: true  },
      { pubkey: SystemProgram.programId,    isSigner: false, isWritable: false },
    ],
    data,
  });
  const txSig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer]);
  return { channelPda, nonce, txSig };
}

/**
 * Close a channel and pay `accumulated` lamports to the recipient.
 *
 * Accounts: payer (signer+writable), recipient (writable),
 *           channel_pda (writable), system_program
 * Payload (16 bytes after discriminant):
 *   seq u64LE (8) | accumulated u64LE (8)
 */
export async function closeChannel(connection, payer, recipientPubkey, channelPda, accumulated) {
  const data = Buffer.alloc(17); // 1 discriminant + 16 payload
  data.writeUInt8(0x01, 0);
  u64LE(0).copy(data, 1);             // seq = 0 (unused, _ in Rust)
  u64LE(accumulated).copy(data, 9);

  const ix = new TransactionInstruction({
    programId: PROGRAM_IDS.stream,
    keys: [
      { pubkey: payer.publicKey,         isSigner: true,  isWritable: true  },
      { pubkey: recipientPubkey,         isSigner: false, isWritable: true  },
      { pubkey: channelPda,              isSigner: false, isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  return sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer]);
}

/**
 * Read channel state. Returns { payer, recipient, maxLamports, nonce, isOpen }.
 */
export async function readChannel(connection, channelPda) {
  const acct = await connection.getAccountInfo(channelPda);
  if (!acct) return null;
  const d = acct.data;
  return {
    payer:       new PublicKey(d.slice(0, 32)).toBase58(),
    recipient:   new PublicKey(d.slice(32, 64)).toBase58(),
    maxLamports: d.readBigUInt64LE(64),
    nonce:       d.readBigUInt64LE(72),
    isOpen:      d[80] === 1,
    bump:        d[81],
  };
}

// ── Silent pay program ────────────────────────────────────────────────────────

/**
 * Register scan + spend keys for the stealth-pay scanner.
 * scanPriv and spendPriv are 32-byte secp256k1 private keys.
 * wallet is the Keypair that owns the scan key record (may equal payer).
 */
export async function registerScanKeys(connection, payer, scanPriv, spendPriv, wallet) {
  // wallet defaults to payer if not provided
  const walletKp = wallet || payer;
  const scanPub  = secp256k1.getPublicKey(scanPriv, true);   // 33 bytes compressed
  const spendPub = secp256k1.getPublicKey(spendPriv, true);  // 33 bytes compressed
  const [scanPda] = findSilentPayScanKeyPda(walletKp.publicKey);

  const existing = await connection.getAccountInfo(scanPda);
  if (existing) return { scanPda, alreadyExisted: true };

  // RegisterScanKeys payload: scan_pubkey(33) + spend_pubkey(33) = 66 bytes
  // Full instruction data: discriminant(1) + payload(66) = 67 bytes
  const data = Buffer.alloc(67);
  data.writeUInt8(0x00, 0);
  Buffer.from(scanPub).copy(data, 1);
  Buffer.from(spendPub).copy(data, 34);

  const ix = new TransactionInstruction({
    programId: PROGRAM_IDS.silentPay,
    keys: [
      { pubkey: payer.publicKey,      isSigner: true,  isWritable: true  },
      { pubkey: walletKp.publicKey,   isSigner: true,  isWritable: false },
      { pubkey: scanPda,              isSigner: false, isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  const signers = payer.publicKey.equals(walletKp.publicKey) ? [payer] : [payer, walletKp];
  const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), signers);
  return { scanPda, sig, alreadyExisted: false };
}

/**
 * Record a stealth payment to a recipient.
 * ephPriv is a 32-byte ephemeral secp256k1 private key.
 * recipientScanPub is the recipient's 33-byte compressed scan pubkey.
 * recipientSpendPub is the recipient's 33-byte compressed spend pubkey.
 */
export async function recordStealthPayment(connection, payer, ephPriv, recipientScanPub, recipientSpendPub) {
  const ephPub = secp256k1.getPublicKey(ephPriv, true); // 33 bytes compressed

  // BIP352-style: shared_secret = ECDH(ephPriv, scanPub); one_time_addr = SHA256(shared_secret) ⊕ spendPub
  const sharedPoint = secp256k1.getSharedSecret(ephPriv, recipientScanPub);
  const sharedHash  = createHash("sha256").update(sharedPoint).digest();
  const oneTimeAddr = Buffer.alloc(33);
  for (let i = 0; i < 33; i++) oneTimeAddr[i] = sharedHash[i % 32] ^ recipientSpendPub[i];

  // PDA seed = SHA256(ephPub) to stay ≤ 32 bytes
  const ephPubHash = createHash("sha256").update(ephPub).digest();

  const [paymentPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("silent-payment-v1"), ephPubHash],
    PROGRAM_IDS.silentPay
  );

  const data = Buffer.alloc(1 + 33 + 33);
  data.writeUInt8(0x01, 0);
  Buffer.from(ephPub).copy(data, 1);
  oneTimeAddr.copy(data, 34);

  const ix = new TransactionInstruction({
    programId: PROGRAM_IDS.silentPay,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: paymentPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer]);
  return { paymentPda, ephPub, oneTimeAddr, sig };
}

// ── Fiat oracle program ───────────────────────────────────────────────────────

/**
 * Register oracle with a deterministic key derived from `seed`.
 * Closes + re-registers if a stale key is on-chain.
 */
export async function ensureOracleRegistered(connection, payer, oraclePriv) {
  const oraclePub64 = secp256k1.getPublicKey(oraclePriv, false).slice(1);
  const [configPda] = findFiatOracleConfigPda(payer.publicKey);

  const existing = await connection.getAccountInfo(configPda);
  if (existing) {
    const storedPub = existing.data.slice(32, 96);
    if (Buffer.from(storedPub).equals(Buffer.from(oraclePub64))) {
      return { configPda, alreadyExisted: true };
    }
    // Close stale
    const closeIx = new TransactionInstruction({
      programId: PROGRAM_IDS.fiatOracle,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: false, isWritable: true },
      ],
      data: Buffer.from([0x02]),
    });
    await sendAndConfirmTransaction(connection, new Transaction().add(closeIx), [payer]);
  }

  const data = Buffer.alloc(1 + 64);
  data.writeUInt8(0x00, 0);
  Buffer.from(oraclePub64).copy(data, 1);
  const registerIx = new TransactionInstruction({
    programId: PROGRAM_IDS.fiatOracle,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  const sig = await sendAndConfirmTransaction(connection, new Transaction().add(registerIx), [payer]);
  return { configPda, sig, alreadyExisted: false };
}

/**
 * Settle a fiat receipt on-chain (oracle signs the settlement).
 */
export async function settleFiatReceipt(connection, payer, paymentId, amountCents, recipientPubkey, oraclePriv) {
  const [configPda] = findFiatOracleConfigPda(payer.publicKey);
  const [receiptPda] = findFiatReceiptPda(paymentId);

  const amountLE = Buffer.alloc(8);
  amountLE.writeBigUInt64LE(BigInt(amountCents));
  const recipientBytes = recipientPubkey.toBuffer();

  const msgHash = createHash("sha256")
    .update(paymentId)
    .update(amountLE)
    .update(recipientBytes)
    .digest();

  const sig = secp256k1.sign(msgHash, oraclePriv, { lowS: true });
  const compact = sig.toCompactRawBytes();

  const data = Buffer.alloc(1 + 137);
  data.writeUInt8(0x01, 0);
  Buffer.from(paymentId).copy(data, 1);
  amountLE.copy(data, 33);
  recipientBytes.copy(data, 41);
  compact.slice(0, 32).forEach((b, i) => data.writeUInt8(b, 73 + i));
  compact.slice(32, 64).forEach((b, i) => data.writeUInt8(b, 105 + i));
  data.writeUInt8(sig.recovery, 137);

  const ix = new TransactionInstruction({
    programId: PROGRAM_IDS.fiatOracle,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: receiptPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  const txSig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer]);
  return { receiptPda, txSig };
}

// ── Hash helpers (re-exported for convenience) ────────────────────────────────

export function sha256(...parts) {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
}
