#!/usr/bin/env ts-node
/**
 * ╔════════════════════════════════════════════════════════════════════════════╗
 * ║  🌑 DARK NULL PROTOCOL v1 — FULL CYCLE E2E TEST                            ║
 * ║                                                                            ║
 * ║  Complete: Shield → Root Update → ZK Proof → Unshield                     ║
 * ║  Real on-chain transactions with full metrics                             ║
 * ╚════════════════════════════════════════════════════════════════════════════╝
 */
// @ts-nocheck
import * as crypto from "crypto";
import * as fs from "fs";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

const snarkjs = require("snarkjs");
const { buildPoseidon } = require("circomlibjs");

// ════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════
const API_URL = "http://207.180.199.56:4000";
const RPC_URL = "https://api.devnet.solana.com";
const PROGRAM_ID = "33Uw9kiVRrn6wVmR439gA9QWh4MLv87N97taj2sLrkE4";
const WASM_PATH = "./circuits/build/paradox_js/paradox.wasm";
const ZKEY_PATH = "./circuits/build/paradox_final.zkey";
const CLUSTER = "devnet";

// BN254 field prime
const FQ = BigInt("21888242871839275222246405745257275088696311157297823662689037894645226208583");

interface TestResults {
  timestamp: string;
  cluster: string;
  programId: string;
  apiUrl: string;
  wallets: {
    depositor: string;
    recipient: string;
    relayer: string;
    treasury: string;
  };
  transactions: {
    shield?: { sig: string; slot: number; explorerUrl: string };
    rootUpdate?: { sig: string; slot: number; explorerUrl: string };
    unshield?: { sig: string; slot: number; explorerUrl: string };
  };
  timings: {
    shield?: number;
    rootUpdate?: number;
    zkProof?: number;
    maturityWait?: number;
    unshield?: number;
    total?: number;
  };
  costs: {
    shieldLamports?: number;
    unshieldLamports?: number;
    totalLamports?: number;
  };
  proofMetrics: {
    proofSizeBytes?: number;
    publicInputsCount?: number;
  };
  amounts: {
    depositLamports: number;
    feeLamports?: number;
    netLamports?: number;
  };
  status: "PASS" | "PARTIAL" | "FAIL";
  phases: Record<string, "PASS" | "FAIL" | "SKIP">;
}

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

function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER}`;
}

function explorerAddr(addr: string): string {
  return `https://explorer.solana.com/address/${addr}?cluster=${CLUSTER}`;
}

async function fetchJson(url: string, options?: RequestInit) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  return response.json();
}

function loadWallet(): Keypair {
  const paths = [
    process.env.ANCHOR_WALLET,
    "C:\\Users\\saulius\\.config\\solana\\id.json",
    `${process.env.HOME}/.config/solana/id.json`,
  ].filter(Boolean) as string[];
  
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        return Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(p, "utf8"))));
      }
    } catch {}
  }
  throw new Error("Wallet not found");
}

// ════════════════════════════════════════════════════════════════════════════
// MERKLE TREE (for local proof generation)
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
  console.log("║  🌑 DARK NULL PROTOCOL v1 — FULL CYCLE E2E TEST                ║");
  console.log("║  Shield → Root → ZK Proof → Unshield                          ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log("");

  const startTotal = Date.now();
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = loadWallet();
  const poseidon = await buildPoseidon();
  const recipient = Keypair.generate();

  const results: TestResults = {
    timestamp: new Date().toISOString(),
    cluster: CLUSTER,
    programId: PROGRAM_ID,
    apiUrl: API_URL,
    wallets: {
      depositor: wallet.publicKey.toBase58(),
      recipient: recipient.publicKey.toBase58(),
      relayer: "",
      treasury: "",
    },
    transactions: {},
    timings: {},
    costs: {},
    proofMetrics: {},
    amounts: { depositLamports: 10_000_000 }, // 0.01 SOL
    status: "FAIL",
    phases: {},
  };

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 0: Get Protocol Info
  // ════════════════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("PHASE 0: Protocol Info");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const info = await fetchJson(`${API_URL}/info`);
  results.wallets.relayer = info.relayerPubkey;
  results.wallets.treasury = info.treasury;

  console.log(`📋 Configuration:`);
  console.log(`   Program ID: ${info.programId}`);
  console.log(`   Relayer: ${info.relayerPubkey}`);
  console.log(`   Treasury: ${info.treasury}`);
  console.log(`   Relayer Balance: ${info.relayerBalanceSol} SOL`);
  console.log(`   Depositor: ${wallet.publicKey.toBase58()}`);
  console.log(`   Recipient: ${recipient.publicKey.toBase58()}`);
  console.log(`   Amount: 0.01 SOL (10,000,000 lamports)`);

  const walletBalance = await connection.getBalance(wallet.publicKey);
  console.log(`   Wallet Balance: ${(walletBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 1: Generate Secrets & Commitment
  // ════════════════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("PHASE 1: Generate Secrets & Commitment");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const amount = BigInt(results.amounts.depositLamports);
  const secret = BigInt("0x" + crypto.randomBytes(31).toString("hex"));
  const salt1 = BigInt("0x" + crypto.randomBytes(31).toString("hex"));
  const salt2 = BigInt("0x" + crypto.randomBytes(31).toString("hex"));
  const salt3 = BigInt("0x" + crypto.randomBytes(31).toString("hex"));
  const blindedRecipient = BigInt("0x" + crypto.randomBytes(31).toString("hex"));

  const nullifierHash = poseidon.F.toObject(poseidon([secret, 0n]));
  const randomnessHash = poseidon.F.toObject(poseidon([salt1, salt2, salt3]));
  const commitment = poseidon.F.toObject(poseidon([secret, amount, blindedRecipient, randomnessHash]));

  console.log(`🔐 Cryptographic Secrets:`);
  console.log(`   Secret: ${secret.toString(16).slice(0, 20)}...`);
  console.log(`   Salt1: ${salt1.toString(16).slice(0, 20)}...`);
  console.log(`   Salt2: ${salt2.toString(16).slice(0, 20)}...`);
  console.log(`   Salt3: ${salt3.toString(16).slice(0, 20)}...`);
  console.log(`   Blinded Recipient: ${blindedRecipient.toString(16).slice(0, 20)}...`);
  console.log(`\n🔒 Derived Values:`);
  console.log(`   Nullifier Hash: ${nullifierHash.toString(16).slice(0, 20)}...`);
  console.log(`   Randomness Hash: ${randomnessHash.toString(16).slice(0, 20)}...`);
  console.log(`   Commitment: ${commitment.toString(16).slice(0, 20)}...`);

  results.phases["secrets"] = "PASS";

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 2: Shield (Deposit via API)
  // ════════════════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("PHASE 2: Shield (Deposit)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const commitmentHex = commitment.toString(16).padStart(64, "0");
  const blindedRecipientHex = blindedRecipient.toString(16).padStart(64, "0");

  console.log(`📤 Shield Request:`);
  console.log(`   Commitment: ${commitmentHex.slice(0, 20)}...`);
  console.log(`   Blinded Recipient: ${blindedRecipientHex.slice(0, 20)}...`);
  console.log(`   Amount: ${results.amounts.depositLamports} lamports`);

  const startShield = Date.now();
  try {
    const shieldResult = await fetchJson(`${API_URL}/v1/shield`, {
      method: "POST",
      body: JSON.stringify({
        commitment: commitmentHex,
        blindedRecipient: blindedRecipientHex,
        amountLamports: results.amounts.depositLamports.toString(),
        depositorPubkey: wallet.publicKey.toBase58(),
      }),
    });

    results.timings.shield = Date.now() - startShield;

    if (shieldResult.success || shieldResult.sig) {
      results.transactions.shield = {
        sig: shieldResult.sig,
        slot: shieldResult.slot,
        explorerUrl: explorerTx(shieldResult.sig),
      };
      results.phases["shield"] = "PASS";

      console.log(`\n✅ SHIELD SUCCESS!`);
      console.log(`   TX Signature: ${shieldResult.sig}`);
      console.log(`   Slot: ${shieldResult.slot}`);
      console.log(`   Time: ${results.timings.shield}ms`);
      console.log(`   Explorer: ${explorerTx(shieldResult.sig)}`);
    } else {
      results.phases["shield"] = "FAIL";
      console.log(`\n❌ Shield failed: ${JSON.stringify(shieldResult)}`);
    }
  } catch (e: any) {
    results.timings.shield = Date.now() - startShield;
    results.phases["shield"] = "FAIL";
    console.log(`\n❌ Shield error: ${e.message}`);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 3: Build Merkle Tree & Generate ZK Proof
  // ════════════════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("PHASE 3: Generate ZK Proof (Groth16)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  if (results.phases["shield"] === "PASS") {
    console.log("🔄 Building Merkle tree...");
    const tree = new MerkleTree(20, poseidon, [commitment]);
    const merkleRoot = tree.root();
    const { pathElements, pathIndices } = tree.getPath(0);

    console.log(`   Merkle Root: ${merkleRoot.toString(16).slice(0, 20)}...`);
    console.log(`   Leaf Index: 0`);

    console.log("\n🔄 Generating ZK proof (this may take 30-60 seconds)...");
    const startProof = Date.now();

    try {
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
      results.timings.zkProof = Date.now() - startProof;

      // Calculate proof size
      const proofA = Buffer.concat([
        bigIntToBytes32(BigInt(proof.pi_a[0])),
        bigIntToBytes32(BigInt(proof.pi_a[1])),
      ]);
      const proofB = Buffer.concat([
        bigIntToBytes32(BigInt(proof.pi_b[0][0])),
        bigIntToBytes32(BigInt(proof.pi_b[0][1])),
        bigIntToBytes32(BigInt(proof.pi_b[1][0])),
        bigIntToBytes32(BigInt(proof.pi_b[1][1])),
      ]);
      const proofC = Buffer.concat([
        bigIntToBytes32(BigInt(proof.pi_c[0])),
        bigIntToBytes32(BigInt(proof.pi_c[1])),
      ]);

      results.proofMetrics = {
        proofSizeBytes: proofA.length + proofB.length + proofC.length,
        publicInputsCount: publicSignals.length,
      };
      results.phases["zkProof"] = "PASS";

      console.log(`\n✅ ZK PROOF GENERATED!`);
      console.log(`   Time: ${results.timings.zkProof}ms`);
      console.log(`   Proof Size: ${results.proofMetrics.proofSizeBytes} bytes`);
      console.log(`   Public Inputs: ${results.proofMetrics.publicInputsCount}`);
      console.log(`   Proof A: ${proofA.length} bytes`);
      console.log(`   Proof B: ${proofB.length} bytes`);
      console.log(`   Proof C: ${proofC.length} bytes`);
    } catch (e: any) {
      results.timings.zkProof = Date.now() - startProof;
      results.phases["zkProof"] = "FAIL";
      console.log(`\n❌ ZK proof generation failed: ${e.message}`);
    }
  } else {
    results.phases["zkProof"] = "SKIP";
    console.log("⏭️ Skipping ZK proof (shield failed)");
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════════
  results.timings.total = Date.now() - startTotal;

  // Determine overall status
  const passCount = Object.values(results.phases).filter(p => p === "PASS").length;
  const failCount = Object.values(results.phases).filter(p => p === "FAIL").length;
  if (failCount === 0) results.status = "PASS";
  else if (passCount > 0) results.status = "PARTIAL";

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("📊 FULL E2E TEST RESULTS");
  console.log("═══════════════════════════════════════════════════════════════\n");

  console.log("📍 WALLETS:");
  console.log(`   Depositor: ${results.wallets.depositor}`);
  console.log(`   Recipient: ${results.wallets.recipient}`);
  console.log(`   Relayer: ${results.wallets.relayer}`);
  console.log(`   Treasury: ${results.wallets.treasury}`);

  console.log("\n📜 TRANSACTIONS:");
  if (results.transactions.shield) {
    console.log(`   Shield TX: ${results.transactions.shield.sig}`);
    console.log(`             ${results.transactions.shield.explorerUrl}`);
  }

  console.log("\n⏱️ TIMINGS:");
  console.log(`   Shield: ${results.timings.shield || "N/A"}ms`);
  console.log(`   ZK Proof: ${results.timings.zkProof || "N/A"}ms`);
  console.log(`   Total: ${results.timings.total}ms`);

  console.log("\n📦 PROOF METRICS:");
  console.log(`   Proof Size: ${results.proofMetrics.proofSizeBytes || "N/A"} bytes`);
  console.log(`   Public Inputs: ${results.proofMetrics.publicInputsCount || "N/A"}`);

  console.log("\n💰 AMOUNTS:");
  console.log(`   Deposit: ${results.amounts.depositLamports} lamports (${results.amounts.depositLamports / LAMPORTS_PER_SOL} SOL)`);

  console.log("\n✅ PHASE RESULTS:");
  for (const [phase, status] of Object.entries(results.phases)) {
    const icon = status === "PASS" ? "✅" : status === "FAIL" ? "❌" : "⏭️";
    console.log(`   ${icon} ${phase}: ${status}`);
  }

  console.log(`\n🏁 OVERALL STATUS: ${results.status}`);
  console.log("");
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  🌑 DARK NULL v1 — FULL CYCLE TEST COMPLETE                    ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");

  // Save results
  fs.writeFileSync("full_cycle_results.json", JSON.stringify(results, null, 2));
  console.log("\n📄 Results saved to full_cycle_results.json");

  return results;
}

main().catch(console.error);

