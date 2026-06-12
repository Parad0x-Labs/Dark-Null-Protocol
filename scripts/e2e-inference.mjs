/**
 * e2e-inference.mjs
 *
 * End-to-end test for the dark-null-inference Solana program.
 *
 * Tests:
 *   1. RegisterModel   — register a model hash + oracle pubkey on-chain
 *   2. RecordInference — verify oracle sig on-chain and store receipt
 *   3. Replay protection — same (input, output) pair rejected
 *   4. Wrong oracle sig — different oracle key rejected
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
import { secp256k1 } from "@noble/curves/secp256k1";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Derive a PDA; returns [PublicKey, bump]. */
function findPDA(programId, seeds) {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

/** SHA256 of a Buffer. */
function sha256(buf) {
  return createHash("sha256").update(buf).digest();
}

/**
 * Compute the oracle message hash that the on-chain program verifies.
 * Must match: hashv(&[&model_hash, &input_hash, &output_hash])
 * Solana's hashv = SHA256(concat(slices)), so:
 */
function oracleMsgHash(modelHash, inputHash, outputHash) {
  return sha256(Buffer.concat([modelHash, inputHash, outputHash]));
}

/**
 * Sign msgHash with a secp256k1 private key.
 * Returns { r: Buffer(32), s: Buffer(32), recoveryId: 0|1 }.
 */
function oracleSign(msgHash, privKey) {
  const sig = secp256k1.sign(msgHash, privKey, { lowS: true });
  const compact = Buffer.from(sig.toCompactRawBytes());
  return {
    r: compact.slice(0, 32),
    s: compact.slice(32, 64),
    recoveryId: sig.recovery,
  };
}

/**
 * Build the RegisterModel instruction data.
 * Layout: [disc(1), model_hash(32), oracle_pubkey(64)] = 97 bytes total
 */
function buildRegisterModelIx(programId, authority, modelConfigPda, modelHash, oraclePubkey64) {
  const data = Buffer.alloc(1 + 32 + 64);
  data[0] = 0; // discriminant
  modelHash.copy(data, 1);
  oraclePubkey64.copy(data, 33);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: authority,       isSigner: true,  isWritable: true  },
      { pubkey: modelConfigPda,  isSigner: false, isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Build the RecordInference instruction data.
 * Layout: [disc(1), model_hash(32), input_hash(32), output_hash(32),
 *          sig_r(32), sig_s(32), recovery_id(1)] = 162 bytes total
 */
function buildRecordInferenceIx(
  programId,
  payer,
  modelConfigPda,
  receiptPda,
  modelHash,
  inputHash,
  outputHash,
  r,
  s,
  recoveryId,
) {
  const data = Buffer.alloc(1 + 32 + 32 + 32 + 32 + 32 + 1);
  let offset = 0;
  data[offset++] = 1; // discriminant
  modelHash.copy(data, offset);  offset += 32;
  inputHash.copy(data, offset);  offset += 32;
  outputHash.copy(data, offset); offset += 32;
  r.copy(data, offset);          offset += 32;
  s.copy(data, offset);          offset += 32;
  data[offset] = recoveryId;

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer,         isSigner: true,  isWritable: true  },
      { pubkey: modelConfigPda, isSigner: false, isWritable: false },
      { pubkey: receiptPda,    isSigner: false, isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // -------------------------------------------------------------------------
  // Setup: program ID, connection, payer
  // -------------------------------------------------------------------------
  const programIdFile = resolve(__dirname, "../programs/inference/.program-id");
  let programIdStr;
  try {
    programIdStr = readFileSync(programIdFile, "utf8").trim();
  } catch {
    throw new Error(
      `Could not read program ID from ${programIdFile}. ` +
      `Deploy the program first and write its address to that file.`
    );
  }
  const PROGRAM_ID = new PublicKey(programIdStr);

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  // Load payer from default Solana CLI keypair location.
  const payerPath =
    process.env.SOLANA_KEYPAIR_PATH ||
    resolve(process.env.HOME || process.env.USERPROFILE || "~", ".config/solana/id.json");
  const payerKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(readFileSync(payerPath, "utf8")))
  );
  console.log("Payer:", payerKeypair.publicKey.toBase58());

  // -------------------------------------------------------------------------
  // Step 1: Generate oracle keypair
  //   oraclePriv  — 32-byte secp256k1 private key
  //   oraclePub64 — 64-byte uncompressed pubkey without the 0x04 prefix
  // -------------------------------------------------------------------------
  const oraclePriv = secp256k1.utils.randomPrivateKey();
  // getPublicKey returns 65 bytes (0x04 ‖ x ‖ y); drop the prefix byte.
  const oraclePub64 = Buffer.from(secp256k1.getPublicKey(oraclePriv, false)).slice(1);
  console.log("Oracle pubkey (64 bytes, hex):", oraclePub64.toString("hex").slice(0, 16) + "…");

  // -------------------------------------------------------------------------
  // Step 2: Derive model hash and model_config PDA
  // -------------------------------------------------------------------------
  const modelHash = sha256(Buffer.from("gpt4-weights-v1"));

  const [modelConfigPda] = findPDA(PROGRAM_ID, [
    Buffer.from("model-v1"),
    modelHash,
  ]);
  console.log("model_config PDA:", modelConfigPda.toBase58());

  // -------------------------------------------------------------------------
  // Step 3: RegisterModel
  // -------------------------------------------------------------------------
  {
    const ix = buildRegisterModelIx(
      PROGRAM_ID,
      payerKeypair.publicKey,
      modelConfigPda,
      modelHash,
      oraclePub64,
    );
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [payerKeypair]);
    console.log("RegisterModel: OK  (tx:", sig, ")");
  }

  // -------------------------------------------------------------------------
  // Step 4: Prepare inference data
  // -------------------------------------------------------------------------
  const inputHash  = sha256(Buffer.from("what is 2+2?"));
  const outputHash = sha256(Buffer.from("4"));

  const msgHash = oracleMsgHash(modelHash, inputHash, outputHash);
  const { r, s, recoveryId } = oracleSign(msgHash, oraclePriv);

  const [receiptPda] = findPDA(PROGRAM_ID, [
    Buffer.from("inference-v1"),
    inputHash,
    outputHash,
  ]);
  console.log("inference_receipt PDA:", receiptPda.toBase58());

  // -------------------------------------------------------------------------
  // Step 5: RecordInference — happy path
  // -------------------------------------------------------------------------
  {
    const ix = buildRecordInferenceIx(
      PROGRAM_ID,
      payerKeypair.publicKey,
      modelConfigPda,
      receiptPda,
      modelHash,
      inputHash,
      outputHash,
      r,
      s,
      recoveryId,
    );
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [payerKeypair]);
    console.log("RecordInference: OK  (tx:", sig, ")");
  }

  // -------------------------------------------------------------------------
  // Step 6: Verify on-chain receipt data
  // -------------------------------------------------------------------------
  {
    const account = await connection.getAccountInfo(receiptPda);
    if (!account) throw new Error("Receipt PDA not found after RecordInference");

    const data = account.data;
    // InferenceReceipt Borsh: model_hash[32] + input_hash[32] + output_hash[32] + bump[1]
    const storedModel  = data.slice(0, 32);
    const storedInput  = data.slice(32, 64);
    const storedOutput = data.slice(64, 96);

    const eq = (a, b) => Buffer.from(a).equals(Buffer.from(b));
    if (!eq(storedModel, modelHash))   throw new Error("Receipt model_hash mismatch");
    if (!eq(storedInput, inputHash))   throw new Error("Receipt input_hash mismatch");
    if (!eq(storedOutput, outputHash)) throw new Error("Receipt output_hash mismatch");

    console.log("Receipt data verified: model_hash ✓  input_hash ✓  output_hash ✓");
  }

  // -------------------------------------------------------------------------
  // Step 7: Replay protection — same (input, output) must be rejected
  // -------------------------------------------------------------------------
  {
    const ix = buildRecordInferenceIx(
      PROGRAM_ID,
      payerKeypair.publicKey,
      modelConfigPda,
      receiptPda,   // same PDA → already initialised
      modelHash,
      inputHash,
      outputHash,
      r,
      s,
      recoveryId,
    );
    const tx = new Transaction().add(ix);
    try {
      await sendAndConfirmTransaction(connection, tx, [payerKeypair]);
      throw new Error("REPLAY: expected failure but transaction succeeded");
    } catch (err) {
      if (err.message.startsWith("REPLAY:")) throw err;
      // Any program error means the replay was correctly rejected.
      console.log("Replay protection: OK  (rejected as expected)");
    }
  }

  // -------------------------------------------------------------------------
  // Step 8: Wrong oracle sig — different oracle key must be rejected
  // -------------------------------------------------------------------------
  {
    // Generate a completely different oracle key.
    const wrongPriv = secp256k1.utils.randomPrivateKey();
    const wrongSign = oracleSign(msgHash, wrongPriv);

    // Use different input/output so we get a fresh receipt PDA that doesn't
    // already exist — the sig check fires before the PDA creation.
    const inputHash2  = sha256(Buffer.from("what is 3+3?"));
    const outputHash2 = sha256(Buffer.from("6"));
    const msgHash2 = oracleMsgHash(modelHash, inputHash2, outputHash2);
    const wrongSign2 = oracleSign(msgHash2, wrongPriv); // signed by wrong oracle

    const [receiptPda2] = findPDA(PROGRAM_ID, [
      Buffer.from("inference-v1"),
      inputHash2,
      outputHash2,
    ]);

    const ix = buildRecordInferenceIx(
      PROGRAM_ID,
      payerKeypair.publicKey,
      modelConfigPda,
      receiptPda2,
      modelHash,
      inputHash2,
      outputHash2,
      wrongSign2.r,
      wrongSign2.s,
      wrongSign2.recoveryId,
    );
    const tx = new Transaction().add(ix);
    try {
      await sendAndConfirmTransaction(connection, tx, [payerKeypair]);
      throw new Error("WRONG_SIG: expected failure but transaction succeeded");
    } catch (err) {
      if (err.message.startsWith("WRONG_SIG:")) throw err;
      console.log("Oracle sig verification: OK  (wrong oracle key rejected)");
    }
  }

  // -------------------------------------------------------------------------
  // All checks passed
  // -------------------------------------------------------------------------
  console.log("e2e-inference PASSED");
}

main().catch((err) => {
  console.error("e2e-inference FAILED:", err.message);
  process.exit(1);
});
