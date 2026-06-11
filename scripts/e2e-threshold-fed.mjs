/**
 * e2e-threshold-fed.mjs
 * End-to-end test for dark-null-threshold-fed Solana program.
 *
 * Usage: node scripts/e2e-threshold-fed.mjs
 *
 * Requires:
 *   - devnet-accessible ~/.config/solana/id.json with SOL balance
 *   - programs/threshold-fed/.program-id containing the deployed program ID
 *   - swarm/threshold-mint.mjs exporting the threshold blind-mint API
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import fs from "fs";
import path from "path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── imports from threshold-mint swarm module ─────────────────────────────────

import {
  generateFederation,
  blindSecret,
  partialSign,
  aggregatePartialResponses,
  unblind,
  verifyToken,
} from "../swarm/threshold-mint.mjs";

// ── helpers ───────────────────────────────────────────────────────────────────

function fail(msg, err) {
  console.error(`FAIL: ${msg}`);
  if (err) console.error(err);
  process.exit(1);
}

function loadProgramId() {
  const idFile = path.join(ROOT, "programs", "threshold-fed", ".program-id");
  if (!fs.existsSync(idFile)) {
    fail(`program-id file not found: ${idFile}`);
  }
  return new PublicKey(fs.readFileSync(idFile, "utf8").trim());
}

function loadPayer() {
  const keyPath = path.join(
    process.env.HOME || process.env.USERPROFILE,
    ".config",
    "solana",
    "id.json"
  );
  if (!fs.existsSync(keyPath)) {
    fail(`Solana keypair not found: ${keyPath}`);
  }
  const raw = JSON.parse(fs.readFileSync(keyPath, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

/** Parse little-endian u64 from an 8-byte Buffer/Uint8Array. */
function readU64LE(buf, offset = 0) {
  let val = BigInt(0);
  for (let i = 0; i < 8; i++) {
    val |= BigInt(buf[offset + i]) << BigInt(8 * i);
  }
  return val;
}

/**
 * Deserialize FederationConfig (76 bytes, Borsh):
 *   authority [32] | threshold [1] | total_signers [1] | aggregate_pubkey [33]
 *   | issuance_count [8] | bump [1]
 */
function deserializeFederationConfig(data) {
  if (data.length < 76) {
    throw new Error(`FederationConfig too short: ${data.length}`);
  }
  return {
    authority: new PublicKey(data.slice(0, 32)),
    threshold: data[32],
    total_signers: data[33],
    aggregate_pubkey: Buffer.from(data.slice(34, 67)).toString("hex"),
    issuance_count: readU64LE(data, 67),
    bump: data[75],
  };
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const programId = loadProgramId();
  const payer = loadPayer();
  const connection = new Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );

  console.log("Program ID  :", programId.toBase58());
  console.log("Payer       :", payer.publicKey.toBase58());

  // ── 1. Generate a 2-of-3 federation ─────────────────────────────────────

  const fed = generateFederation(3, 2);
  console.log(
    `Federation  : ${fed.threshold}-of-${fed.total_signers}, aggpub=${fed.aggregate_pubkey}`
  );

  // ── 2. Derive fed_config PDA ─────────────────────────────────────────────

  const [fedConfigPda, _fedBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("threshold-fed-v1"), payer.publicKey.toBuffer()],
    programId
  );
  console.log("fed_config PDA:", fedConfigPda.toBase58());

  // ── 3. Build InitFederation instruction (discriminant 0, 35-byte payload) ─

  const aggPubkeyBuf = Buffer.from(fed.aggregate_pubkey, "hex");
  if (aggPubkeyBuf.length !== 33) {
    fail(
      `aggregate_pubkey must be 33 bytes, got ${aggPubkeyBuf.length}`
    );
  }
  const initData = Buffer.alloc(1 + 35);
  initData[0] = 0; // discriminant
  initData[1] = fed.threshold;
  initData[2] = fed.total_signers;
  aggPubkeyBuf.copy(initData, 3);

  const initIx = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: fedConfigPda, isSigner: false, isWritable: true },
      {
        pubkey: new PublicKey("11111111111111111111111111111111"),
        isSigner: false,
        isWritable: false,
      },
    ],
    data: initData,
  });

  // ── 4. Send InitFederation tx ─────────────────────────────────────────────

  try {
    const initTx = new Transaction().add(initIx);
    const initSig = await sendAndConfirmTransaction(connection, initTx, [
      payer,
    ]);
    console.log("InitFederation: OK  (sig:", initSig, ")");
  } catch (err) {
    fail("InitFederation tx failed", err);
  }

  // ── 5. Fetch and verify fed_config account ────────────────────────────────

  try {
    const acctInfo = await connection.getAccountInfo(fedConfigPda);
    if (!acctInfo) fail("fed_config PDA account not found after init");

    const cfg = deserializeFederationConfig(acctInfo.data);
    if (cfg.threshold !== 2) {
      fail(`Expected threshold=2, got ${cfg.threshold}`);
    }
    if (cfg.total_signers !== 3) {
      fail(`Expected total_signers=3, got ${cfg.total_signers}`);
    }
    console.log(
      `fed_config verified: threshold=${cfg.threshold}, total_signers=${cfg.total_signers}, issuance_count=${cfg.issuance_count}`
    );
  } catch (err) {
    fail("fed_config deserialization/verification failed", err);
  }

  // ── 6. Simulate threshold minting ────────────────────────────────────────
  //   blind → 2 partial signs (signers 0 + 1) → aggregate → unblind → verify

  let token;
  try {
    const blind_req = blindSecret("test-secret-42");

    const partial0 = partialSign(fed.signers[0], blind_req.blinded_point);
    const partial1 = partialSign(fed.signers[1], blind_req.blinded_point);

    const aggregated = aggregatePartialResponses([partial0, partial1]);
    token = unblind(blind_req, aggregated, fed.aggregate_pubkey);

    const valid = verifyToken(token, fed.aggregate_privkey);
    if (!valid) fail("verifyToken returned false — threshold mint invalid");
    console.log("Threshold mint verified: OK");
  } catch (err) {
    fail("Threshold mint simulation failed", err);
  }

  // ── 7. Compute token_hash ─────────────────────────────────────────────────

  const tokenHashBuf = createHash("sha256")
    .update(token.C + token.secret)
    .digest(); // 32-byte Buffer

  // ── 8. Derive issuance_record PDA ─────────────────────────────────────────

  const [issuancePda, _issBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("issuance-v1"), tokenHashBuf],
    programId
  );
  console.log("issuance_record PDA:", issuancePda.toBase58());

  // ── 9. Build RecordIssuance instruction (discriminant 1, 32-byte payload) ─

  const recordData = Buffer.alloc(1 + 32);
  recordData[0] = 1; // discriminant
  tokenHashBuf.copy(recordData, 1);

  const recordIx = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: fedConfigPda, isSigner: false, isWritable: true },
      { pubkey: issuancePda, isSigner: false, isWritable: true },
      {
        pubkey: new PublicKey("11111111111111111111111111111111"),
        isSigner: false,
        isWritable: false,
      },
    ],
    data: recordData,
  });

  // ── 10. Send RecordIssuance tx ────────────────────────────────────────────

  try {
    const recTx = new Transaction().add(recordIx);
    const recSig = await sendAndConfirmTransaction(connection, recTx, [payer]);
    console.log("RecordIssuance: OK  (sig:", recSig, ")");
  } catch (err) {
    fail("RecordIssuance tx failed", err);
  }

  // ── 11. Replay protection: second RecordIssuance must fail ────────────────

  let replayFailed = false;
  try {
    const replayTx = new Transaction().add(
      new TransactionInstruction({
        programId,
        keys: [
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: fedConfigPda, isSigner: false, isWritable: true },
          { pubkey: issuancePda, isSigner: false, isWritable: true },
          {
            pubkey: new PublicKey("11111111111111111111111111111111"),
            isSigner: false,
            isWritable: false,
          },
        ],
        data: recordData,
      })
    );
    await sendAndConfirmTransaction(connection, replayTx, [payer]);
    // If we reach here, replay was NOT rejected — that is a failure.
    fail("Replay protection FAILED: second RecordIssuance was accepted");
  } catch (err) {
    // Expected path: the program returns AccountAlreadyInitialized (or the
    // runtime rejects the create_account CPI because the account already exists).
    const msg = err?.message ?? String(err);
    if (
      msg.includes("AccountAlreadyInitialized") ||
      msg.includes("already in use") ||
      msg.includes("custom program error") ||
      msg.includes("Error")
    ) {
      replayFailed = true;
    } else {
      fail("Replay protection check received unexpected error", err);
    }
  }

  if (!replayFailed) {
    fail("Replay protection: second tx did not throw at all");
  }

  // ── 12. Final verification of issuance_count ──────────────────────────────

  try {
    const acctInfo = await connection.getAccountInfo(fedConfigPda);
    const cfg = deserializeFederationConfig(acctInfo.data);
    if (cfg.issuance_count !== BigInt(1)) {
      fail(`Expected issuance_count=1, got ${cfg.issuance_count}`);
    }
    console.log(`issuance_count verified: ${cfg.issuance_count}`);
  } catch (err) {
    fail("Final issuance_count verification failed", err);
  }

  // ── 13. Done ──────────────────────────────────────────────────────────────

  console.log("Replay protection: OK");
  console.log("e2e-threshold-fed PASSED");
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
