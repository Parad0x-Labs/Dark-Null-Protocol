#!/usr/bin/env ts-node
/**
 * ╔════════════════════════════════════════════════════════════════════════════╗
 * ║  🌑 DARK NULL PROTOCOL v1 — FULL SHIELD → UNSHIELD TEST                    ║
 * ║                                                                            ║
 * ║  REAL: Shield → Root Update → ZK Proof → UNSHIELD                         ║
 * ║  NO STUBS. NO SIMULATIONS. REAL ON-CHAIN ZK VERIFICATION.                 ║
 * ╚════════════════════════════════════════════════════════════════════════════╝
 */
// @ts-nocheck
import * as anchor from "@coral-xyz/anchor";
import { BN, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import * as os from "os";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import * as fs from "fs";
import * as crypto from "crypto";

const snarkjs = require("snarkjs");
const { buildPoseidon } = require("circomlibjs");

// ════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════

// Use devnet with retries
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      if (i === retries - 1) throw e;
      console.log(`   ⚠️ Retry ${i + 1}/${retries} after error: ${e.message?.slice(0, 50)}`);
      await sleep(delay);
    }
  }
  throw new Error("Retries exhausted");
}
const PROGRAM_ID = new PublicKey("33Uw9kiVRrn6wVmR439gA9QWh4MLv87N97taj2sLrkE4");
const CLUSTER = "devnet";
const TREASURY = new PublicKey("9vDnXsPonRJa7yAmvwRGMAdxt8W13Qbm7HZuvauM3Ya3");

// Circuit artifacts
const WASM_PATH = "./circuits/build/paradox_js/paradox.wasm";
const ZKEY_PATH = "./circuits/build/paradox_final.zkey";

// Denominations
const DENOMINATIONS = [
  { sol: 0.001, lamports: 1_000_000n, id: 0 },
  { sol: 0.01, lamports: 10_000_000n, id: 1 },
  { sol: 0.1, lamports: 100_000_000n, id: 2 },
  { sol: 0.5, lamports: 500_000_000n, id: 3 },
  { sol: 1.0, lamports: 1_000_000_000n, id: 4 },
  { sol: 10.0, lamports: 10_000_000_000n, id: 5 },
];

const TEST_SOL = Number(process.env.DARK_NULL_TEST_SOL ?? "0.01");
const selectedDenom = DENOMINATIONS.reduce((prev, curr) => 
  Math.abs(curr.sol - TEST_SOL) < Math.abs(prev.sol - TEST_SOL) ? curr : prev
);

// BN254 field primes
const FQ = BigInt("21888242871839275222246405745257275088696311157297823662689037894645226208583");
const FR = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

function mod(a: bigint, m: bigint = FQ): bigint {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

function bigIntToBytes32(bn: bigint): Buffer {
  let hex = bn.toString(16).padStart(64, "0");
  return Buffer.from(hex, "hex");
}

function negFq(y: bigint): bigint {
  const yMod = mod(y, FQ);
  return yMod === 0n ? 0n : (FQ - yMod);
}

function findWalletPath(): string {
  const paths = [
    process.env.ANCHOR_WALLET,
    `${os.homedir()}/.config/solana/id.json`,
    process.env.HOME ? `${process.env.HOME}/.config/solana/id.json` : undefined,
    process.env.USERPROFILE ? `${process.env.USERPROFILE}\\.config\\solana\\id.json` : undefined,
  ].filter(Boolean) as string[];
  
  for (const p of paths) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  throw new Error("Wallet not found");
}

function loadWallet(walletPath: string): Keypair {
  const raw = fs.readFileSync(walletPath, "utf8");
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
}

function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER}`;
}

// ════════════════════════════════════════════════════════════════════════════
// MERKLE TREE
// ════════════════════════════════════════════════════════════════════════════

class MerkleTree {
  depth: number;
  poseidon: any;
  leaves: bigint[];
  zeros: bigint[];

  constructor(depth: number, poseidon: any, leaves: bigint[] = []) {
    this.depth = depth;
    this.poseidon = poseidon;
    this.leaves = leaves;
    this.zeros = this.computeZeros();
  }

  computeZeros(): bigint[] {
    const zeros: bigint[] = [];
    let current = 0n;
    for (let i = 0; i < this.depth; i++) {
      zeros.push(current);
      current = this.poseidon.F.toObject(this.poseidon([current, current]));
    }
    return zeros;
  }

  root(): bigint {
    if (this.leaves.length === 0) return this.zeros[this.depth - 1];
    let layer = [...this.leaves];
    while (layer.length < 2 ** this.depth) layer.push(0n);
    for (let d = 0; d < this.depth; d++) {
      const nextLayer: bigint[] = [];
      for (let i = 0; i < layer.length; i += 2) {
        const l = layer[i];
        const r = layer[i + 1] ?? this.zeros[d];
        nextLayer.push(this.poseidon.F.toObject(this.poseidon([l, r])));
      }
      layer = nextLayer;
    }
    return layer[0];
  }

  getPath(index: number): { pathElements: bigint[]; pathIndices: number[] } {
    let layer = [...this.leaves];
    while (layer.length < 2 ** this.depth) layer.push(0n);
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let idx = index;
    for (let d = 0; d < this.depth; d++) {
      const sibIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
      pathElements.push(layer[sibIdx] ?? this.zeros[d]);
      pathIndices.push(idx % 2);
      const nextLayer: bigint[] = [];
      for (let i = 0; i < layer.length; i += 2) {
        const l = layer[i];
        const r = layer[i + 1] ?? this.zeros[d];
        nextLayer.push(this.poseidon.F.toObject(this.poseidon([l, r])));
      }
      layer = nextLayer;
      idx = Math.floor(idx / 2);
    }
    return { pathElements, pathIndices };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN TEST
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  🌑 DARK NULL PROTOCOL v1 — FULL E2E TEST                       ║");
  console.log("║  REAL SHIELD → ROOT → ZK PROOF → UNSHIELD                      ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log("");

  const timings: Record<string, number> = {};
  const startTotal = Date.now();

  // Setup
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = loadWallet(findWalletPath());
  const poseidon = await buildPoseidon();

  const provider = new AnchorProvider(connection, new Wallet(wallet), { commitment: "confirmed" });
  anchor.setProvider(provider);

  console.log(`📋 Configuration:`);
  console.log(`   Program: ${PROGRAM_ID.toBase58()}`);
  console.log(`   Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`   Amount: ${selectedDenom.sol} SOL (denom ${selectedDenom.id})`);
  
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`   Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  // Load IDL
  const idl = JSON.parse(fs.readFileSync("./target/idl/dark_null_v1.json", "utf8"));
  const program = new anchor.Program(idl, PROGRAM_ID, provider);

  // PDAs
  const [globalStatePDA] = PublicKey.findProgramAddressSync([Buffer.from("state_v18")], PROGRAM_ID);
  const [vaultPDA] = PublicKey.findProgramAddressSync([Buffer.from("vault_v18")], PROGRAM_ID);

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 1: Generate Secrets
  // ════════════════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("PHASE 1: Generate Secrets & Commitment");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const amount = selectedDenom.lamports;
  const secret = BigInt("0x" + crypto.randomBytes(31).toString("hex"));
  const salt1 = BigInt("0x" + crypto.randomBytes(31).toString("hex"));
  const salt2 = BigInt("0x" + crypto.randomBytes(31).toString("hex"));
  const salt3 = BigInt("0x" + crypto.randomBytes(31).toString("hex"));
  const blindedRecipient = BigInt("0x" + crypto.randomBytes(31).toString("hex"));

  const nullifierHash = poseidon.F.toObject(poseidon([secret, 0n]));
  const randomnessHash = poseidon.F.toObject(poseidon([salt1, salt2, salt3]));
  const commitment = poseidon.F.toObject(poseidon([secret, amount, blindedRecipient, randomnessHash]));

  console.log(`🔐 Secrets Generated:`);
  console.log(`   Secret: ${secret.toString(16).slice(0, 16)}...`);
  console.log(`   Nullifier: ${nullifierHash.toString(16).slice(0, 16)}...`);
  console.log(`   Commitment: ${commitment.toString(16).slice(0, 16)}...`);

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 2: Shield (Deposit)
  // ════════════════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("PHASE 2: Shield (Deposit)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const commitmentBytes = Array.from(bigIntToBytes32(commitment));
  const blindedRecipientBytes = Array.from(bigIntToBytes32(blindedRecipient));
  const [depositMetaPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("deposit"), Buffer.from(commitmentBytes)],
    PROGRAM_ID
  );

  const startShield = Date.now();
  
  // Build shield instruction manually for compatibility
  const shieldIx = await program.methods
    .shieldV18(new BN(amount.toString()), commitmentBytes, blindedRecipientBytes)
    .accounts({
      globalState: globalStatePDA,
      vault: vaultPDA,
      depositMeta: depositMetaPDA,
      depositor: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const shieldTxn = new anchor.web3.Transaction().add(shieldIx);
  const shieldTx = await provider.sendAndConfirm(shieldTxn);

  await connection.confirmTransaction(shieldTx, "confirmed");
  timings.shield = Date.now() - startShield;

  console.log(`✅ Shield TX: ${shieldTx}`);
  console.log(`   Time: ${timings.shield}ms`);
  console.log(`   Explorer: ${explorerTx(shieldTx)}`);

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 3: Update Merkle Root
  // ════════════════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("PHASE 3: Update Merkle Root");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const tree = new MerkleTree(20, poseidon, [commitment]);
  const merkleRoot = tree.root();
  const { pathElements, pathIndices } = tree.getPath(0);

  await sleep(1000); // Brief pause between transactions
  
  const startRoot = Date.now();
  const rootTx = await withRetry(async () => {
    const rootIx = await program.methods
      .updateRoot(Array.from(bigIntToBytes32(merkleRoot)), new BN(10))
      .accounts({
        globalState: globalStatePDA,
        indexer: wallet.publicKey,
      })
      .instruction();
    const rootTxn = new anchor.web3.Transaction().add(rootIx);
    const tx = await provider.sendAndConfirm(rootTxn);
    return tx;
  });
  timings.rootUpdate = Date.now() - startRoot;

  // Get root_head
  const stateData = await program.account.globalStateV18.fetch(globalStatePDA);
  const rootHead = stateData.rootHead.toNumber();
  const rootRef = (rootHead - 1 + 128) % 128;

  console.log(`✅ Root TX: ${rootTx}`);
  console.log(`   Time: ${timings.rootUpdate}ms`);
  console.log(`   Root: ${merkleRoot.toString(16).slice(0, 16)}...`);
  console.log(`   root_ref: ${rootRef}`);

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 4: Generate ZK Proof
  // ════════════════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("PHASE 4: Generate ZK Proof (Groth16)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const startProof = Date.now();
  console.log("🔄 Generating proof...");

  const circuitInput = {
    root: merkleRoot.toString(),
    nullifierHash: nullifierHash.toString(),
    amount: amount.toString(),
    blinded_recipient: blindedRecipient.toString(),
    salt1: salt1.toString(),
    salt2: salt2.toString(),
    salt3: salt3.toString(),
    secret: secret.toString(),
    pathElements: pathElements.map(e => e.toString()),
    pathIndices: pathIndices.map(i => i.toString()),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(circuitInput, WASM_PATH, ZKEY_PATH);
  timings.zkProof = Date.now() - startProof;

  console.log(`✅ Proof Generated!`);
  console.log(`   Time: ${timings.zkProof}ms`);

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 5: Encode Proof
  // ════════════════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("PHASE 5: Encode Proof (Uncompressed)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // Proof A (with negation)
  const proofA_x = bigIntToBytes32(BigInt(proof.pi_a[0]));
  const proofA_y_neg = bigIntToBytes32(negFq(BigInt(proof.pi_a[1])));
  const proof_a = Buffer.concat([proofA_x, proofA_y_neg]);

  // Proof B (G2 swapped: [x.c1, x.c0, y.c1, y.c0])
  const proofB_x_c0 = bigIntToBytes32(BigInt(proof.pi_b[0][0]));
  const proofB_x_c1 = bigIntToBytes32(BigInt(proof.pi_b[0][1]));
  const proofB_y_c0 = bigIntToBytes32(BigInt(proof.pi_b[1][0]));
  const proofB_y_c1 = bigIntToBytes32(BigInt(proof.pi_b[1][1]));
  const proof_b = Buffer.concat([proofB_x_c1, proofB_x_c0, proofB_y_c1, proofB_y_c0]);

  // Proof C
  const proof_c = Buffer.concat([
    bigIntToBytes32(BigInt(proof.pi_c[0])),
    bigIntToBytes32(BigInt(proof.pi_c[1])),
  ]);

  // Public inputs
  const rootBytes = bigIntToBytes32(BigInt(publicSignals[0]));
  const nullifierHashBytes = bigIntToBytes32(BigInt(publicSignals[1]));
  const amountBytes = bigIntToBytes32(BigInt(publicSignals[2]));
  const blindedRecipientProofBytes = bigIntToBytes32(BigInt(publicSignals[3]));
  const salt1Bytes = bigIntToBytes32(BigInt(publicSignals[4]));
  const salt2Bytes = bigIntToBytes32(BigInt(publicSignals[5]));
  const salt3Bytes = bigIntToBytes32(BigInt(publicSignals[6]));

  const seed = crypto.randomBytes(16);

  console.log(`📦 Payload: ${proof_a.length + proof_b.length + proof_c.length + seed.length} bytes`);

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 6: Unshield
  // ════════════════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("PHASE 6: UNSHIELD (Real ZK Verification On-Chain)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const recipient = Keypair.generate();
  console.log(`🎯 Recipient: ${recipient.publicKey.toBase58()}`);

  // Nullifier page PDA
  const [nullifierPagePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("nullifier_v18"), Buffer.from([seed[0]]), Buffer.from([seed[1]])],
    PROGRAM_ID
  );

  // Initialize nullifier page
  try {
    const initPageIx = await program.methods
      .initNullifierPage(Array.from(seed))
      .accounts({
        nullifierPage: nullifierPagePDA,
        payer: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    const initPageTxn = new anchor.web3.Transaction().add(initPageIx);
    const initPageTx = await provider.sendAndConfirm(initPageTxn);
    console.log(`   ✅ Nullifier page initialized: ${initPageTx}`);
  } catch (e: any) {
    if (!e.message?.includes("already in use")) {
      console.log(`   ℹ️ Page exists or: ${e.message?.slice(0, 50)}`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 5.5: Wait for Maturity
  // ════════════════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("PHASE 5.5: Wait for Maturity (Anti-Correlation)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const depositMeta = await program.account.depositMeta.fetch(depositMetaPDA);
  const depositSlot = depositMeta.depositSlot;
  const minDelaySlots = stateData.minDelaySlots.toNumber();
  const matureSlot = depositSlot.toNumber() + minDelaySlots;

  console.log(`   Deposit Slot: ${depositSlot.toString()}`);
  console.log(`   Min Delay: ${minDelaySlots} slots`);
  console.log(`   Mature Slot: ${matureSlot}`);

  const startMaturity = Date.now();
  let currentSlot = await connection.getSlot();
  
  while (currentSlot < matureSlot) {
    const remaining = matureSlot - currentSlot;
    const estSeconds = Math.ceil(remaining * 0.4); // ~400ms per slot
    process.stdout.write(`\r   ⏳ Waiting... ${remaining} slots remaining (~${estSeconds}s)   `);
    await sleep(500);
    currentSlot = await connection.getSlot();
  }
  
  timings.maturityWait = Date.now() - startMaturity;
  console.log(`\n   ✅ Maturity reached! Waited ${timings.maturityWait}ms`);

  const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

  const startUnshield = Date.now();
  try {
    const unshieldIx = await program.methods
      .unshieldV18(
        rootRef,
        selectedDenom.id,
        Array.from(seed),
        Array.from(proof_a),
        Array.from(proof_b),
        Array.from(proof_c),
        Array.from(nullifierHashBytes),
        Array.from(blindedRecipientProofBytes),
        Array.from(salt1Bytes),
        Array.from(salt2Bytes),
        Array.from(salt3Bytes),
        depositSlot  // kept for ABI compat, but ignored on-chain
      )
      .accounts({
        globalState: globalStatePDA,
        vault: vaultPDA,
        nullifierPage: nullifierPagePDA,
        depositMeta: depositMetaPDA,  // SECURITY FIX [H-01]: required for maturity check
        recipient: recipient.publicKey,
        treasury: TREASURY,
        payer: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const unshieldTxn = new anchor.web3.Transaction()
      .add(modifyComputeUnits)
      .add(unshieldIx);
    const unshieldTx = await provider.sendAndConfirm(unshieldTxn);

    await connection.confirmTransaction(unshieldTx, "confirmed");
    timings.unshield = Date.now() - startUnshield;

    console.log(`\n🎉 UNSHIELD SUCCESS!`);
    console.log(`   TX: ${unshieldTx}`);
    console.log(`   Time: ${timings.unshield}ms`);
    console.log(`   Explorer: ${explorerTx(unshieldTx)}`);

    // Check recipient balance
    const recipientBalance = await connection.getBalance(recipient.publicKey);
    const fee = Number(amount) * 20 / 10000; // 0.2%
    const expectedNet = Number(amount) - fee;
    console.log(`\n💰 Recipient Balance: ${recipientBalance} lamports (expected: ${expectedNet})`);

  } catch (e: any) {
    timings.unshield = Date.now() - startUnshield;
    console.log(`\n❌ Unshield Failed (${timings.unshield}ms):`);
    console.log(`   ${e.message}`);
    if (e.logs) {
      console.log("\nProgram Logs:");
      e.logs.forEach((log: string) => console.log("  ", log));
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════════
  const totalTime = Date.now() - startTotal;
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("TEST SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const operationalTime = (timings.shield || 0) + (timings.rootUpdate || 0) + 
                          (timings.zkProof || 0) + (timings.unshield || 0);

  console.log(`✅ Shield: ${timings.shield}ms`);
  console.log(`✅ Root Update: ${timings.rootUpdate}ms`);
  console.log(`✅ ZK Proof: ${timings.zkProof}ms`);
  console.log(`⏳ Maturity Wait: ${timings.maturityWait || 0}ms`);
  console.log(`${timings.unshield ? '✅' : '❌'} Unshield: ${timings.unshield || 'FAILED'}ms`);
  console.log(`─────────────────────`);
  console.log(`⏱️ Operations: ${operationalTime}ms`);
  console.log(`⏱️ Total (incl. wait): ${totalTime}ms`);
  console.log("");
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  🌑 DARK NULL v1 — TEST COMPLETE                                ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
}

main().catch(console.error);
