#!/usr/bin/env node

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  EMPTY_BODY_SHA256,
  createPaymentRequiredHeader,
  createPrivateX402Intent,
  createPrivateX402Receipt,
  createPrivateX402RequestBinding,
  sha256Hex,
  verifyPrivateX402Receipt,
  verifyPrivateX402ReceiptOnSolana,
} from "../swarm/x402.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = {
    devnet: false,
    json: false,
    rpcUrl: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--devnet") {
      args.devnet = true;
      continue;
    }
    if (value === "--json") {
      args.json = true;
      continue;
    }
    if (value === "--rpc-url") {
      args.rpcUrl = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${value}`);
  }

  return args;
}

async function stableSha256(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  const bytes = await fs.readFile(filePath);
  const textExtensions = new Set([".json", ".md", ".mjs", ".rs", ".toml", ".yml", ".yaml", ".txt"]);
  const stableBytes = textExtensions.has(path.extname(relativePath))
    ? Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8")
    : bytes;
  return crypto.createHash("sha256").update(stableBytes).digest("hex");
}

function gitCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

async function readFullCycleResult() {
  return JSON.parse(await fs.readFile(path.join(repoRoot, "full_cycle_results.json"), "utf8"));
}

async function buildReceipt({ devnet = false, settlementSlot = null, confirmationStatus = "finalized" } = {}) {
  const manifest = JSON.parse(await fs.readFile(path.join(repoRoot, "MANIFEST.json"), "utf8"));
  const manifestSha256 = await stableSha256("MANIFEST.json");
  const proofEncodingHash = sha256Hex(manifest.proof_encoding);
  const fullCycle = await readFullCycleResult();
  const tx = fullCycle.transactions.shield;
  const programId = devnet ? fullCycle.programId : manifest.program.id;
  const slot = settlementSlot ?? tx.slot;
  const amount = fullCycle.amounts.depositLamports.toString();

  const intent = createPrivateX402Intent({
    method: "POST",
    resource: "dark-null:devnet:machine-payment",
    description: "dark-null-private-machine-payment",
    nonce: "devnet_receipt_20260525",
    expiresAt: "2026-05-25T23:59:59.000Z",
    maxAmountRequired: amount,
    asset: "solana-devnet:lamports",
    network: "solana-devnet",
    payTo: "dark-null-devnet-vault",
    settlement: {
      mode: "dark-null-withdraw-v2",
      cluster: "devnet",
      programId,
      manifestLabel: manifest.label,
      amountLamports: amount,
      receiverTokenAccountHash: sha256Hex("dark-null-devnet-machine-receiver"),
      mintHash: sha256Hex("native-sol-devnet"),
      proofEncodingHash,
    },
  });
  const paymentRequired = createPaymentRequiredHeader(intent);
  const paymentSignatureHeader = Buffer.from(
    JSON.stringify({ scheme: "exact", intentHash: intent.intentHash, holder: "redacted" }),
    "utf8",
  ).toString("base64");
  const paymentResponseHeader = Buffer.from(
    JSON.stringify({ status: "settled", tx: tx.sig, slot }),
    "utf8",
  ).toString("base64");
  const requestBinding = createPrivateX402RequestBinding({
    intent,
    paymentRequiredHeader: paymentRequired.value,
    paymentSignatureHeader,
    bodyHash: EMPTY_BODY_SHA256,
  });

  const receipt = createPrivateX402Receipt({
    requestBinding,
    paymentResponseHeader,
    observedAt: "2026-05-25T23:59:59.000Z",
    settlement: {
      cluster: "devnet",
      programId,
      signature: tx.sig,
      slot,
      confirmationStatus,
    },
    proof: {
      proofBundleHash: sha256Hex("dark-null-private-x402-devnet-proof-bundle"),
      publicInputHash: sha256Hex("dark-null-private-x402-devnet-public-inputs"),
      proofEncodingHash,
    },
    repository: {
      commit: gitCommit(),
      manifestSha256,
    },
  });

  return {
    manifestLabel: manifest.label,
    intentHash: intent.intentHash,
    replayKey: requestBinding.replayKey,
    receipt,
  };
}

async function getDevnetSignatureStatus(connection) {
  const fullCycle = await readFullCycleResult();
  const tx = fullCycle.transactions.shield;
  const response = await connection.getSignatureStatuses([tx.sig], {
    searchTransactionHistory: true,
  });
  const signatureStatus = response?.value?.[0] ?? null;
  if (!signatureStatus) {
    throw new Error(`devnet signature was not found: ${tx.sig}`);
  }
  if (signatureStatus.err !== null) {
    throw new Error(`devnet signature has an error status: ${tx.sig}`);
  }
  return {
    signature: tx.sig,
    recordedSlot: tx.slot,
    chainSlot: signatureStatus.slot,
    confirmationStatus: signatureStatus.confirmationStatus ?? "finalized",
  };
}

async function checkCanonicalDevnetProgram(rpcUrl, programId) {
  const web3 = await import("@solana/web3.js");
  const connection = new web3.Connection(rpcUrl, "confirmed");
  const account = await connection.getAccountInfo(new web3.PublicKey(programId));
  if (!account?.executable) {
    throw new Error(`canonical devnet program is not executable: ${programId}`);
  }
  return {
    executable: account.executable,
    owner: account.owner.toBase58(),
    lamports: account.lamports,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const networks = JSON.parse(await fs.readFile(path.join(repoRoot, "NETWORKS.json"), "utf8"));
  const rpcUrl = args.rpcUrl ?? networks.supportedNetworks.devnet.rpcUrl;
  let devnetStatus = null;
  let connection = null;

  if (args.devnet) {
    const web3 = await import("@solana/web3.js");
    connection = new web3.Connection(rpcUrl, "confirmed");
    devnetStatus = await getDevnetSignatureStatus(connection);
  }

  const built = await buildReceipt({
    devnet: args.devnet,
    settlementSlot: devnetStatus?.chainSlot ?? null,
    confirmationStatus: devnetStatus?.confirmationStatus ?? "finalized",
  });
  const structural = verifyPrivateX402Receipt(built.receipt);

  let devnet = null;
  if (args.devnet) {
    const receiptOnchain = await verifyPrivateX402ReceiptOnSolana(built.receipt, connection, {
      minConfirmationStatus: "finalized",
    });
    const program = await checkCanonicalDevnetProgram(rpcUrl, networks.canonicalProgramId);
    devnet = {
      rpcUrl,
      recordedSlot: devnetStatus.recordedSlot,
      chainSlot: devnetStatus.chainSlot,
      receiptOnchain,
      canonicalProgram: program,
    };
  }

  const report = {
    schema: "dark-null-private-x402-receipt-check-v1",
    mode: args.devnet ? "devnet" : "offline",
    manifestLabel: built.manifestLabel,
    intentHash: built.intentHash,
    replayKey: built.replayKey,
    receiptHash: built.receipt.lock.receiptHash,
    structural,
    devnet,
  };

  const failures = [
    ...(structural.ok ? [] : structural.failures),
    ...(devnet?.receiptOnchain?.ok === false ? devnet.receiptOnchain.failures : []),
  ];

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (failures.length === 0) {
    const suffix = args.devnet
      ? ` Devnet signature ${built.receipt.settlement.signature} confirmed at slot ${built.receipt.settlement.slot}.`
      : "";
    console.log(`Private x402 receipt check passed.${suffix}`);
  } else {
    console.error("Private x402 receipt check failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
  }

  if (failures.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
