/**
 * e2e-silent-pay.mjs
 *
 * End-to-end test for the dark-null-silent-pay Solana program.
 *
 * Prerequisites:
 *   1. Deploy the program: `solana program deploy target/deploy/dark_null_silent_pay.so`
 *      then write the program ID to programs/silent-pay/.program-id
 *   2. Fund your payer wallet on devnet: `solana airdrop 2`
 *
 * Usage:
 *   node scripts/e2e-silent-pay.mjs
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import fs from "fs";
import path from "path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "url";
import { generateSilentPaymentKeys, deriveOneTimeAddress, scanOutputs } from "../swarm/silent-pay.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEVNET_RPC = "https://api.devnet.solana.com";
const PROGRAM_ID_FILE = path.join(__dirname, "../programs/silent-pay/.program-id");
const PAYER_KEYPAIR_FILE = path.join(
  process.env.HOME || process.env.USERPROFILE,
  ".config/solana/id.json"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadProgramId() {
  if (!fs.existsSync(PROGRAM_ID_FILE)) {
    throw new Error(
      `Program ID file not found: ${PROGRAM_ID_FILE}\n` +
      `Deploy the program first and write its ID to that file.`
    );
  }
  const raw = fs.readFileSync(PROGRAM_ID_FILE, "utf8").trim();
  return new PublicKey(raw);
}

function loadPayerKeypair() {
  if (!fs.existsSync(PAYER_KEYPAIR_FILE)) {
    throw new Error(`Payer keypair not found: ${PAYER_KEYPAIR_FILE}`);
  }
  const raw = JSON.parse(fs.readFileSync(PAYER_KEYPAIR_FILE, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

/** Build instruction data for RegisterScanKeys: [0, scan_pubkey(33), spend_pubkey(33)] */
function buildRegisterScanKeysData(scanPubkeyHex, spendPubkeyHex) {
  const scan = Buffer.from(scanPubkeyHex, "hex");
  const spend = Buffer.from(spendPubkeyHex, "hex");
  if (scan.length !== 33) throw new Error(`scan_pubkey must be 33 bytes, got ${scan.length}`);
  if (spend.length !== 33) throw new Error(`spend_pubkey must be 33 bytes, got ${spend.length}`);
  const buf = Buffer.alloc(67);
  buf[0] = 0; // discriminant
  scan.copy(buf, 1);
  spend.copy(buf, 34);
  return buf;
}

/** Build instruction data for RecordPayment: [1, eph_pubkey(33), one_time_address(33)] */
function buildRecordPaymentData(ephPubkeyHex, oneTimeAddressHex) {
  const eph = Buffer.from(ephPubkeyHex, "hex");
  const ota = Buffer.from(oneTimeAddressHex, "hex");
  if (eph.length !== 33) throw new Error(`eph_pubkey must be 33 bytes, got ${eph.length}`);
  if (ota.length !== 33) throw new Error(`one_time_address must be 33 bytes, got ${ota.length}`);
  const buf = Buffer.alloc(67);
  buf[0] = 1; // discriminant
  eph.copy(buf, 1);
  ota.copy(buf, 34);
  return buf;
}

/**
 * Minimal Borsh deserialization for PaymentRecord:
 *   eph_pubkey(33)  + one_time_address(32) + bump(1)  = 66 bytes
 */
function deserializePaymentRecord(data) {
  if (data.length < 67) throw new Error(`PaymentRecord too short: ${data.length} bytes`);
  return {
    eph_pubkey: Buffer.from(data.slice(0, 33)).toString("hex"),
    one_time_address: Buffer.from(data.slice(33, 66)).toString("hex"),
    bump: data[66],
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const programId = loadProgramId();
  const payer = loadPayerKeypair();
  const connection = new Connection(DEVNET_RPC, "confirmed");

  console.log("Program ID  :", programId.toBase58());
  console.log("Payer       :", payer.publicKey.toBase58());

  // -------------------------------------------------------------------------
  // Step 1 — Generate recipient keys
  // -------------------------------------------------------------------------
  const recipientKeys = generateSilentPaymentKeys();
  // Use a fresh Keypair as the recipient's wallet (signer for RegisterScanKeys)
  const recipientWallet = Keypair.generate();

  console.log("\n--- Step 1: generate recipient keys ---");
  console.log("scan_pubkey  :", recipientKeys.scan.public);
  console.log("spend_pubkey :", recipientKeys.spend.public);
  console.log("wallet       :", recipientWallet.publicKey.toBase58());

  // Fund recipient wallet enough to sign (needs 0 SOL balance to sign, but payer pays rent)
  // Actually we just need it to sign the tx; payer covers all fees.

  // -------------------------------------------------------------------------
  // Step 2 — RegisterScanKeys
  // -------------------------------------------------------------------------
  const [scanKeyPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("silent-pay-v1"), recipientWallet.publicKey.toBuffer()],
    programId
  );

  const registerData = buildRegisterScanKeysData(
    recipientKeys.scan.public,
    recipientKeys.spend.public
  );

  const registerIx = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer.publicKey,           isSigner: true,  isWritable: true  },
      { pubkey: recipientWallet.publicKey, isSigner: true,  isWritable: false },
      { pubkey: scanKeyPda,                isSigner: false, isWritable: true  },
      { pubkey: SystemProgram.programId,   isSigner: false, isWritable: false },
    ],
    data: registerData,
  });

  console.log("\n--- Step 2: RegisterScanKeys ---");
  console.log("PDA :", scanKeyPda.toBase58());

  const registerTx = new Transaction().add(registerIx);
  const registerSig = await sendAndConfirmTransaction(
    connection,
    registerTx,
    [payer, recipientWallet],
    { commitment: "confirmed" }
  );
  console.log("tx  :", registerSig);
  console.log("RegisterScanKeys: OK");

  // -------------------------------------------------------------------------
  // Step 4 — Derive one-time address (sender side)
  // -------------------------------------------------------------------------
  const paymentNonce = "nonce-0";
  const payment = deriveOneTimeAddress(recipientKeys, paymentNonce);

  console.log("\n--- Step 4: derive one-time address ---");
  console.log("eph_pubkey       :", payment.eph_pubkey);
  console.log("one_time_address :", payment.one_time_address);

  // -------------------------------------------------------------------------
  // Step 5 — RecordPayment
  // -------------------------------------------------------------------------
  const ephPubkeyBytes = Buffer.from(payment.eph_pubkey, "hex");
  // SHA256(eph_pubkey) → 32-byte seed (matches on-chain hashv constraint)
  const ephHash = createHash("sha256").update(ephPubkeyBytes).digest();

  const [paymentPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("silent-payment-v1"), ephHash],
    programId
  );

  const recordData = buildRecordPaymentData(payment.eph_pubkey, payment.one_time_address);

  const recordIx = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer.publicKey,         isSigner: true,  isWritable: true  },
      { pubkey: paymentPda,              isSigner: false, isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: recordData,
  });

  console.log("\n--- Step 5: RecordPayment ---");
  console.log("PDA :", paymentPda.toBase58());

  const recordTx = new Transaction().add(recordIx);
  const recordSig = await sendAndConfirmTransaction(
    connection,
    recordTx,
    [payer],
    { commitment: "confirmed" }
  );
  console.log("tx  :", recordSig);
  console.log("RecordPayment: OK");

  // -------------------------------------------------------------------------
  // Step 7 — Fetch and verify PaymentRecord account
  // -------------------------------------------------------------------------
  console.log("\n--- Step 7: fetch and verify PaymentRecord ---");

  const paymentAccountInfo = await connection.getAccountInfo(paymentPda, "confirmed");
  if (!paymentAccountInfo) {
    throw new Error("PaymentRecord account not found on-chain");
  }

  const fetched = deserializePaymentRecord(paymentAccountInfo.data);
  console.log("on-chain eph_pubkey      :", fetched.eph_pubkey);
  console.log("on-chain one_time_address:", fetched.one_time_address);
  console.log("expected one_time_address:", payment.one_time_address);

  if (fetched.one_time_address !== payment.one_time_address) {
    throw new Error(
      `one_time_address mismatch: got ${fetched.one_time_address}, expected ${payment.one_time_address}`
    );
  }
  console.log("on-chain data verified: OK");

  // -------------------------------------------------------------------------
  // Step 8 — Scan outputs
  // -------------------------------------------------------------------------
  console.log("\n--- Step 8: scan outputs ---");

  const outputs = [
    {
      eph_pubkey: payment.eph_pubkey,
      one_time_address: payment.one_time_address,
      payment_nonce: payment.payment_nonce,
    },
  ];

  const found = scanOutputs(recipientKeys, outputs);

  if (found.length !== 1) {
    throw new Error(`Expected scanner to find 1 output, found ${found.length}`);
  }
  console.log("Scanner found payment: OK");
  console.log("spend_private:", found[0].spend_private);

  // -------------------------------------------------------------------------
  // Done
  // -------------------------------------------------------------------------
  console.log("\ne2e-silent-pay PASSED");
}

main().catch((err) => {
  console.error("e2e-silent-pay FAILED:", err);
  process.exit(1);
});
