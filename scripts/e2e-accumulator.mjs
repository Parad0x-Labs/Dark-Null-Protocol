#!/usr/bin/env node
/**
 * e2e-accumulator.mjs
 *
 * End-to-end test for dark-null-accumulator.
 * Requires:
 *   - Program deployed; program ID in ../programs/accumulator/.program-id
 *   - ~/.config/solana/id.json funded on devnet
 *   - SOLANA_KEYPAIR env var overrides the default keypair path
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const PROGRAM_ID_PATH = resolve(
  __dirname,
  "../programs/accumulator/.program-id"
);
const KEYPAIR_PATH =
  process.env.SOLANA_KEYPAIR ||
  `${process.env.HOME || process.env.USERPROFILE}/.config/solana/id.json`;
const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const PDA_SEED = Buffer.from("accumulator-v1");

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function loadKeypair(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function readProgramId(path) {
  return new PublicKey(readFileSync(path, "utf8").trim());
}

async function sendIx(connection, payer, ix, label) {
  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  console.log(`  ${label}: ${sig}`);
  return sig;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  // Setup
  const programId = readProgramId(PROGRAM_ID_PATH);
  const payer = loadKeypair(KEYPAIR_PATH);
  const connection = new Connection(RPC_URL, "confirmed");

  console.log("Program ID  :", programId.toBase58());
  console.log("Payer       :", payer.publicKey.toBase58());
  console.log("RPC         :", RPC_URL);
  console.log("");

  // ── 1. Derive accumulator PDA ─────────────────────────────────────────────
  const [accumulatorPda] = await PublicKey.findProgramAddress(
    [PDA_SEED, payer.publicKey.toBuffer()],
    programId
  );
  console.log("Accumulator PDA:", accumulatorPda.toBase58());

  // ── 2. InitAccumulator ────────────────────────────────────────────────────
  const initIx = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: accumulatorPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([0]), // discriminant = 0
  });

  await sendIx(connection, payer, initIx, "InitAccumulator tx");
  console.log("InitAccumulator: OK\n");

  // ── 3. Generate 5 fake receipt hashes ─────────────────────────────────────
  const receiptHashes = Array.from({ length: 5 }, (_, i) =>
    createHash("sha256").update(`receipt-${i}`).digest()
  );

  // ── 4. AccumulateReceipt × 5 ─────────────────────────────────────────────
  for (let i = 0; i < receiptHashes.length; i++) {
    const hash = receiptHashes[i];
    const data = Buffer.concat([Buffer.from([1]), hash]); // discriminant=1 + 32-byte hash
    const accIx = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
        { pubkey: accumulatorPda, isSigner: false, isWritable: true },
      ],
      data,
    });
    await sendIx(connection, payer, accIx, `  AccumulateReceipt #${i + 1} tx`);
  }
  console.log("Accumulated 5 receipts: OK\n");

  // ── 5. Compute expected final commitment locally ───────────────────────────
  let expectedCommitment = Buffer.alloc(32); // zero hash
  for (const hash of receiptHashes) {
    expectedCommitment = createHash("sha256")
      .update(Buffer.concat([expectedCommitment, hash]))
      .digest();
  }
  console.log("Expected commitment:", expectedCommitment.toString("hex"));

  // ── 6. FinalizeAccumulator ────────────────────────────────────────────────
  const finalizeIx = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      { pubkey: accumulatorPda, isSigner: false, isWritable: true },
    ],
    data: Buffer.from([2]), // discriminant = 2
  });

  await sendIx(connection, payer, finalizeIx, "FinalizeAccumulator tx");
  console.log("FinalizeAccumulator: OK\n");

  // ── 7. Fetch and deserialize on-chain state ───────────────────────────────
  const accountInfo = await connection.getAccountInfo(accumulatorPda, "confirmed");
  if (!accountInfo) {
    throw new Error("Accumulator PDA account not found after finalize");
  }

  const raw = Buffer.from(accountInfo.data);
  if (raw.length < 74) {
    throw new Error(`Account data too short: ${raw.length} bytes (expected 74)`);
  }

  // Layout: authority(32) | commitment(32) | count(8 LE) | is_finalized(1) | bump(1)
  const onChainAuthority = new PublicKey(raw.slice(0, 32));
  const onChainCommitment = raw.slice(32, 64);
  const onChainCount = raw.readBigUInt64LE(64);
  const onChainIsFinalized = raw[72];
  const onChainBump = raw[73];

  console.log("On-chain state:");
  console.log("  authority    :", onChainAuthority.toBase58());
  console.log("  commitment   :", onChainCommitment.toString("hex"));
  console.log("  count        :", onChainCount.toString());
  console.log("  is_finalized :", onChainIsFinalized);
  console.log("  bump         :", onChainBump);
  console.log("");

  // ── 8. Verify commitment ──────────────────────────────────────────────────
  const commitmentHex = onChainCommitment.toString("hex");
  const expectedHex = expectedCommitment.toString("hex");
  if (commitmentHex !== expectedHex) {
    throw new Error(
      `Commitment mismatch!\n  on-chain : ${commitmentHex}\n  expected : ${expectedHex}`
    );
  }
  console.log("Commitment match: OK");

  // ── 9. Verify count ───────────────────────────────────────────────────────
  if (onChainCount !== 5n) {
    throw new Error(`Count mismatch: expected 5, got ${onChainCount}`);
  }
  console.log("Count == 5: OK");

  // ── 10. Verify is_finalized ───────────────────────────────────────────────
  if (onChainIsFinalized !== 1) {
    throw new Error(`is_finalized expected 1, got ${onChainIsFinalized}`);
  }
  console.log("is_finalized == 1: OK\n");

  // ── 11. Finalization guard — must reject AccumulateReceipt after finalize ──
  console.log("Testing finalization guard...");
  const guardHash = createHash("sha256").update("should-be-rejected").digest();
  const guardIx = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      { pubkey: accumulatorPda, isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([Buffer.from([1]), guardHash]),
  });

  let guardFailed = false;
  try {
    await sendIx(connection, payer, guardIx, "  GuardTest AccumulateReceipt tx");
  } catch (err) {
    // Any send/confirmation failure is the expected outcome
    guardFailed = true;
    console.log("  Guard rejected (expected):", err.message?.split("\n")[0]);
  }

  if (!guardFailed) {
    throw new Error(
      "Finalization guard FAILED: AccumulateReceipt succeeded on a finalized accumulator"
    );
  }
  console.log("Finalization guard: OK\n");

  console.log("e2e-accumulator PASSED");
}

main().catch((err) => {
  console.error("\ne2e-accumulator FAILED:", err);
  process.exit(1);
});
