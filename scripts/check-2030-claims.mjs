#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const primitivesDocPath = "docs/2030_PRIMITIVES.md";

const expectedPrimitives = [
  ["Dark Null x402 Privacy Extension", "prototype"],
  ["Compressed Anonymity / Nullifier State", "research"],
  ["Receipt DAG / Append-Only Private Receipts", "prototype"],
  ["Proof-Carrying Relayer Swarm", "research"],
  ["Recursive Settlement Batches", "prototype"],
  ["Ephemeral Private Payment Sessions", "research"],
  ["Finality-Aware / Alpenglow-Ready Receipts", "research"],
  ["Confidential Token-2022 Linkage Privacy", "blocked"],
  ["MPC Sealed Pricing / Private Auctions", "research"],
  ["MEV-Aware Private Settlement Routes", "research"],
  ["x402 Bazaar Private Reputation Receipts", "research"],
  ["ZK Access Receipts", "prototype"],
  ["Access Pattern Privacy (Piano PIR)", "prototype"],
  ["BDHKE Blind Receipt Tokens", "prototype"],
];

const requiredDocs = [
  "docs/2030_PRIMITIVES.md",
  "docs/COMPRESSED_ANONYMITY_STATE.md",
  "docs/RECURSIVE_BATCHING.md",
  "docs/PROOF_CARRYING_SWARM.md",
];

const frontierScanFiles = [
  "README.md",
  "docs/2030_PRIMITIVES.md",
  "docs/COMPRESSED_ANONYMITY_STATE.md",
  "docs/RECURSIVE_BATCHING.md",
  "docs/PROOF_CARRYING_SWARM.md",
  "docs/PARADOX_STACK.md",
  "docs/CLAIMS_LEDGER.md",
];

const primitiveLineRegexes = [
  /x402/i,
  /AP2/i,
  /compressed/i,
  /anonymity/i,
  /nullifier/i,
  /receipt/i,
  /relayer/i,
  /swarm/i,
  /recursive/i,
  /batch/i,
  /epoch/i,
  /ephemeral/i,
  /session/i,
  /Alpenglow/i,
  /Confidential Token/i,
  /Token-2022/i,
  /MPC/i,
  /sealed/i,
  /auction/i,
  /MEV/i,
  /BAM/i,
  /Bazaar/i,
  /ZK Access/i,
  /BDHKE/i,
  /blind token/i,
  /ecash/i,
  /MagicBlock/i,
  /Arcium/i,
  /Jito/i,
];

const blockedClaimRegexes = [
  /\blive\b/i,
  /\bmainnet\b/i,
  /\bproduction\b/i,
  /\baudited\b/i,
  /\bdecentralized consensus\b/i,
  /\bvalidator network\b/i,
  /\bBFT\b/i,
  /\bbridge\b/i,
  /\bprivate compute network\b/i,
  /\bmerchant gateway\b/i,
  /\bshipped\b/i,
];

const allowedQualifierRegexes = [
  /\bnot\b/i,
  /\bno\b/i,
  /\bblocked\b/i,
  /\bresearch\b/i,
  /\bwatchlist\b/i,
  /\bgated\b/i,
  /\bforbidden\b/i,
  /\brequires\b/i,
  /\buntil\b/i,
  /\bfuture\b/i,
  /\btarget\b/i,
  /\bdesign\b/i,
  /\bdisabled\b/i,
  /\bclaim boundary\b/i,
  /\bactivation blocker/i,
];

const softClaimWord = ["hon", "est"].join("");
const softClaimRegex = new RegExp(`\\b${softClaimWord}(?:y|ly)?\\b`, "i");

async function read(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

async function pathExists(relativePath) {
  try {
    await fs.access(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function walkDocs(dir) {
  const entries = await fs.readdir(path.join(repoRoot, dir), { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(dir, entry.name).split(path.sep).join("/");
    if (entry.isDirectory()) {
      files.push(...(await walkDocs(relativePath)));
    } else if ([".md", ".html", ".txt"].includes(path.extname(entry.name))) {
      files.push(relativePath);
    }
  }

  return files;
}

function hasPrimitiveReference(line) {
  return primitiveLineRegexes.some((regex) => regex.test(line));
}

function hasBlockedClaim(line) {
  return blockedClaimRegexes.some((regex) => regex.test(line));
}

function hasAllowedQualifier(line) {
  return allowedQualifierRegexes.some((regex) => regex.test(line));
}

async function checkRequiredDocs() {
  const failures = [];
  for (const file of requiredDocs) {
    if (!(await pathExists(file))) {
      failures.push(`${file}: missing required frontier document`);
    }
  }
  return failures;
}

async function checkNoSoftForbiddenWord() {
  const failures = [];
  const docs = ["README.md", ...(await walkDocs("docs"))];
  for (const file of docs) {
    const content = await read(file);
    if (softClaimRegex.test(content)) {
      failures.push(`${file}: remove banned soft-claim wording`);
    }
  }
  return failures;
}

async function checkPrimitiveMatrix() {
  const failures = [];
  const content = await read(primitivesDocPath);

  for (const [name, status] of expectedPrimitives) {
    if (!content.includes(`| ${name} | \`${status}\` |`)) {
      failures.push(`${primitivesDocPath}: missing primitive matrix row for ${name} with status ${status}`);
    }
    if (!content.includes(`status: ${status}`)) {
      failures.push(`${primitivesDocPath}: missing status block for ${name}`);
    }
  }

  for (const field of [
    "What is already evidenced:",
    "What is not claimed:",
    "Activation blockers:",
    "Files/tests required before public claim:",
    "Exact forbidden marketing language:",
  ]) {
    const count = content.split(field).length - 1;
    if (count !== expectedPrimitives.length) {
      failures.push(`${primitivesDocPath}: expected ${expectedPrimitives.length} "${field}" sections, got ${count}`);
    }
  }

  return failures;
}

async function checkClaimsLedgerAndReadme() {
  const failures = [];
  const ledger = await read("docs/CLAIMS_LEDGER.md");
  const readme = await read("README.md");
  const paradoxStack = await read("docs/PARADOX_STACK.md");

  if (!ledger.includes("## Gated Research Primitives")) {
    failures.push("docs/CLAIMS_LEDGER.md: missing Gated Research Primitives section");
  }
  for (const [name] of expectedPrimitives) {
    if (!ledger.includes(`| ${name} |`)) {
      failures.push(`docs/CLAIMS_LEDGER.md: missing gated primitive row for ${name}`);
    }
  }
  if (!readme.includes("docs/2030_PRIMITIVES.md")) {
    failures.push("README.md: missing 2030 primitives link");
  }
  if (!readme.includes("gated research primitives, not launch claims")) {
    failures.push("README.md: missing gated research boundary");
  }
  if (!paradoxStack.includes("frontier:")) {
    failures.push("docs/PARADOX_STACK.md: missing frontier quick-parse key");
  }

  return failures;
}

async function checkSpecificBoundaries() {
  const failures = [];
  const primitives = await read(primitivesDocPath);

  for (const required of [
    "private receipt primitives until integration evidence exists",
    "| Recursive Settlement Batches | `prototype` |",
    "| Compressed Anonymity / Nullifier State | `research` |",
    "| ZK Access Receipts | `prototype` |",
    "| Access Pattern Privacy (Piano PIR) | `prototype` |",
    "| BDHKE Blind Receipt Tokens | `prototype` |",
    "| Confidential Token-2022 Linkage Privacy | `blocked` |",
    "blocked while Solana confidential transfer availability is audit-gated",
    "no MagicBlock integration",
    "no Arcium integration",
    "no Jito BAM integration",
    "no Alpenglow-specific runtime path",
    "no x402 Bazaar indexing integration",
  ]) {
    if (!primitives.includes(required)) {
      failures.push(`${primitivesDocPath}: missing required boundary phrase: ${required}`);
    }
  }

  return failures;
}

async function scanFrontierClaims() {
  const failures = [];

  for (const file of frontierScanFiles) {
    const content = await read(file);
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      if (!hasPrimitiveReference(line) || !hasBlockedClaim(line)) {
        return;
      }
      if (hasAllowedQualifier(line)) {
        return;
      }
      failures.push(`${file}:${index + 1}: frontier primitive claim is not gated: ${line.trim()}`);
    });
  }

  return failures;
}

async function main() {
  const failures = [
    ...(await checkRequiredDocs()),
    ...(await checkNoSoftForbiddenWord()),
    ...(await checkPrimitiveMatrix()),
    ...(await checkClaimsLedgerAndReadme()),
    ...(await checkSpecificBoundaries()),
    ...(await scanFrontierClaims()),
  ];

  if (failures.length > 0) {
    console.error("2030 claims check failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("2030 claims check passed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
