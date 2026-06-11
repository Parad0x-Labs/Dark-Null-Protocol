#!/usr/bin/env node
/**
 * e2e-payment-stream.mjs
 * End-to-end test for the dark-null-payment-stream native Solana program.
 *
 * Prerequisites:
 *   - Program deployed to devnet; program ID written to
 *     ../programs/payment-stream/.program-id
 *   - Funded devnet keypair at ~/.config/solana/id.json
 *   - npm package @solana/web3.js available in the repo node_modules
 *
 * Run:
 *   node scripts/e2e-payment-stream.mjs
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
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Helper: write a BigInt as an 8-byte little-endian Buffer
// ---------------------------------------------------------------------------
function writeUInt64LE(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

// ---------------------------------------------------------------------------
// Load config
// ---------------------------------------------------------------------------
const programIdPath = path.resolve(
  __dirname,
  "../programs/payment-stream/.program-id"
);
if (!fs.existsSync(programIdPath)) {
  console.error(`ERROR: program ID file not found at ${programIdPath}`);
  console.error(
    "Deploy the program first and write its ID to that file (one line, base58)."
  );
  process.exit(1);
}
const programId = new PublicKey(fs.readFileSync(programIdPath, "utf8").trim());
console.log("Program ID:", programId.toBase58());

const solanaKeyPath = path.join(
  process.env.HOME || process.env.USERPROFILE,
  ".config",
  "solana",
  "id.json"
);
if (!fs.existsSync(solanaKeyPath)) {
  console.error(`ERROR: payer keypair not found at ${solanaKeyPath}`);
  process.exit(1);
}
const payerSecret = Uint8Array.from(
  JSON.parse(fs.readFileSync(solanaKeyPath, "utf8"))
);
const payer = Keypair.fromSecretKey(payerSecret);
console.log("Payer:", payer.publicKey.toBase58());

// ---------------------------------------------------------------------------
// Optional: import JS swarm helpers if they exist
// (gracefully skip if the module is absent — the on-chain part still runs)
// ---------------------------------------------------------------------------
let swarmHelpers = null;
const swarmPath = path.resolve(
  __dirname,
  "../swarm/payment-stream.mjs"
);
if (fs.existsSync(swarmPath)) {
  try {
    swarmHelpers = await import(pathToFileURL(swarmPath).href);
    console.log("Loaded swarm/payment-stream.mjs helpers.");
  } catch (err) {
    console.warn("Warning: could not import swarm/payment-stream.mjs:", err.message);
  }
} else {
  console.log(
    "swarm/payment-stream.mjs not found — skipping JS-layer tick simulation."
  );
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------
const connection = new Connection(
  "https://api.devnet.solana.com",
  "confirmed"
);

// ---------------------------------------------------------------------------
// Test parameters
// ---------------------------------------------------------------------------
const recipient = Keypair.generate();
console.log("Recipient (ephemeral):", recipient.publicKey.toBase58());

const MAX_LAMPORTS = 5_000_000n;      // 0.005 SOL — channel capacity
const NONCE_BYTES  = Buffer.alloc(8); // 8 zero bytes
const ACCUMULATED  = 2_000_000n;      // amount settled to recipient (above rent-exempt min ~890k)
const SEQ          = 3n;

// ---------------------------------------------------------------------------
// Derive channel PDA
// ---------------------------------------------------------------------------
const [channelPda, channelBump] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("stream-v1"),
    payer.publicKey.toBuffer(),
    recipient.publicKey.toBuffer(),
    NONCE_BYTES,
  ],
  programId
);
console.log("Channel PDA:", channelPda.toBase58(), "bump:", channelBump);

// ---------------------------------------------------------------------------
// Step 1 — OpenChannel
// ---------------------------------------------------------------------------
async function stepOpenChannel() {
  // Instruction layout: [0 (discriminant, 1B)] [max_lamports u64 le (8B)] [nonce 8B]
  const ixData = Buffer.concat([
    Buffer.from([0]),
    writeUInt64LE(MAX_LAMPORTS),
    NONCE_BYTES,
  ]);
  // Total: 17 bytes

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer.publicKey,        isSigner: true,  isWritable: true  },
      { pubkey: recipient.publicKey,    isSigner: false, isWritable: false },
      { pubkey: channelPda,             isSigner: false, isWritable: true  },
      { pubkey: new PublicKey("11111111111111111111111111111111"), isSigner: false, isWritable: false },
    ],
    data: ixData,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: "confirmed",
  });
  console.log("OpenChannel tx:", sig);
  console.log("OpenChannel: OK");
}

// ---------------------------------------------------------------------------
// Step 2 — Verify PDA was created with correct size
// ---------------------------------------------------------------------------
async function stepVerifyOpen() {
  const info = await connection.getAccountInfo(channelPda);
  if (!info) {
    throw new Error("channel PDA account does not exist after OpenChannel");
  }
  if (info.data.length !== 82) {
    throw new Error(
      `channel PDA data length expected 82, got ${info.data.length}`
    );
  }
  console.log(
    "Channel PDA exists, data length =",
    info.data.length,
    "lamports =",
    info.lamports
  );
}

// ---------------------------------------------------------------------------
// Step 3 — JS-layer tick simulation (if swarm helpers present)
// ---------------------------------------------------------------------------
async function stepSwarmTicks() {
  if (!swarmHelpers) {
    console.log("(Skipping swarm tick simulation — module not loaded)");
    return;
  }

  const { openChannel, tick, closeChannel, verifyTick, generateStreamKeys } = swarmHelpers;

  // Use swarm-layer keys (independent from on-chain Solana keys)
  const swarmPayer = generateStreamKeys();
  const swarmRecipient = generateStreamKeys();

  let channel = openChannel(swarmPayer, swarmRecipient.public, 100_000, 42);
  let lastTick;

  for (let i = 1; i <= 3; i++) {
    const result = tick(channel, swarmPayer, 20_000);
    channel = result.channel;
    lastTick = result.tick;
    const valid = verifyTick(channel.channel_id, lastTick, channel.payer_pubkey);
    if (!valid) throw new Error(`tick ${i} verification failed`);
    console.log(`JS tick ${i}: seq=${lastTick.sequence} accumulated=${lastTick.accumulated_lamports}`);
  }

  const settlement = closeChannel(channel, lastTick, swarmRecipient);
  if (settlement.settlement_lamports !== 60_000) {
    throw new Error(`Unexpected settlement_lamports: ${settlement.settlement_lamports}`);
  }
  console.log("Swarm tick simulation: OK — 3 ticks, 60000 lamports settled");
}

// ---------------------------------------------------------------------------
// Step 4 — CloseChannel
// ---------------------------------------------------------------------------
async function stepCloseChannel() {
  // Instruction layout: [1 (discriminant, 1B)] [seq u64 le (8B)] [accumulated u64 le (8B)]
  const ixData = Buffer.concat([
    Buffer.from([1]),
    writeUInt64LE(SEQ),
    writeUInt64LE(ACCUMULATED),
  ]);
  // Total: 17 bytes

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer.publicKey,     isSigner: false, isWritable: true  },
      { pubkey: recipient.publicKey, isSigner: false, isWritable: true  },
      { pubkey: channelPda,          isSigner: false, isWritable: true  },
      { pubkey: new PublicKey("11111111111111111111111111111111"), isSigner: false, isWritable: false },
    ],
    data: ixData,
  });

  // payer must sign the tx for the runtime to accept fee payer; the program
  // itself does not require payer to be a signer for CloseChannel.
  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: "confirmed",
  });
  console.log("CloseChannel tx:", sig);
  console.log("CloseChannel: OK");
}

// ---------------------------------------------------------------------------
// Step 5 — Verify PDA is drained
// ---------------------------------------------------------------------------
async function stepVerifyClose() {
  const info = await connection.getAccountInfo(channelPda);
  if (info && info.lamports > 0) {
    throw new Error(
      `channel PDA should be drained but still has ${info.lamports} lamports`
    );
  }
  console.log("Channel PDA drained (lamports == 0 or account gone): OK");
}

// ---------------------------------------------------------------------------
// Step 6 — Verify recipient balance gain
// ---------------------------------------------------------------------------
async function stepVerifyRecipient() {
  const bal = await connection.getBalance(recipient.publicKey);
  console.log(
    `Recipient balance: ${bal} lamports (expected ~${Number(ACCUMULATED)})`
  );
  if (bal < Number(ACCUMULATED) - 10_000) {
    throw new Error(
      `Recipient balance ${bal} is lower than expected ${Number(ACCUMULATED) - 10_000}`
    );
  }
  console.log("Recipient received funds: OK");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("\n=== e2e-payment-stream ===\n");

  await stepOpenChannel();
  await stepVerifyOpen();
  await stepSwarmTicks();
  await stepCloseChannel();
  await stepVerifyClose();
  await stepVerifyRecipient();

  console.log("\ne2e-payment-stream PASSED");
}

main().catch((err) => {
  console.error("\ne2e-payment-stream FAILED:", err);
  process.exit(1);
});
