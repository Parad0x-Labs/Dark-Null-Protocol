#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const scanRoots = [
  "README.md",
  "AUDIT.md",
  "CEREMONY.md",
  "PROTOTYPE_STATUS.md",
  "SECURITY.md",
  "SECURITY_MODEL.md",
  "VERIFICATION.md",
  "docs",
  "idl",
  "interfaces",
  "sdk",
];

const excludedPaths = new Set([
  "docs/CLAIMS_LEDGER.md",
  "docs/COMPETITIVE_POSITIONING.md",
  "scripts/check-claims-evidence.mjs",
]);

const textExtensions = new Set([
  ".d.ts",
  ".json",
  ".md",
  ".mjs",
  ".rs",
  ".ts",
  ".txt",
  ".yml",
  ".yaml",
]);

const allowedQualifiers = [
  /\bnot\b/i,
  /\bno\b/i,
  /\bwithout\b/i,
  /\bblocked\b/i,
  /\bblocker\b/i,
  /\broadmap\b/i,
  /\bfuture\b/i,
  /\brequired evidence\b/i,
  /\bexpected to fail\b/i,
  /\bawaiting\b/i,
  /\buntil\b/i,
  /\bif\b/i,
  /\bmay\b/i,
  /\bcan\b/i,
  /\bevaluate/i,
  /\bout of scope\b/i,
];

const sensitiveClaims = [
  { label: "mainnet-ready claim", regex: /\bmainnet[- ]ready\b/i },
  { label: "production-ready claim", regex: /\bproduction[- ]ready\b/i },
  { label: "completed audit claim", regex: /\bcompleted (?:third[- ]party|external) audit\b/i },
  { label: "third-party audited claim", regex: /\bthird[- ]party[- ]audited\b/i },
  { label: "generic layer-two claim", regex: /\b(?:privacy[- ]focused\s+)?(?:layer 2|l2) on solana\b/i },
  { label: "validator network claim", regex: /\b(?:validator-run|validator network|permissionless validator-run infrastructure)\b/i },
  { label: "BFT claim", regex: /\b(?:byzantine consensus|bft threshold|quorum-approved withdrawals|7-of-10)\b/i },
  { label: "private compute claim", regex: /\bprivate compute\b/i },
  { label: "bridge product claim", regex: /\bsolana bridge\b/i },
  { label: "Sigstore release claim", regex: /\bsigstore[- ]signed\b/i },
];

async function pathExists(relativePath) {
  try {
    await fs.access(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  const stat = await fs.stat(fullPath);
  if (stat.isFile()) {
    return textExtensions.has(path.extname(relativePath)) ? [relativePath] : [];
  }

  const files = [];
  for (const entry of await fs.readdir(fullPath, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "target" || entry.name === "dist") {
      continue;
    }

    const child = path.join(relativePath, entry.name).split(path.sep).join("/");
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(child)));
    } else if (textExtensions.has(path.extname(entry.name))) {
      files.push(child);
    }
  }
  return files;
}

async function collectScanFiles() {
  const files = [];
  for (const root of scanRoots) {
    if (await pathExists(root)) {
      files.push(...(await collectFiles(root)));
    }
  }
  return [...new Set(files)].filter((file) => !excludedPaths.has(file)).sort();
}

function lineIsQualified(line) {
  return allowedQualifiers.some((regex) => regex.test(line));
}

async function checkClaimsLedger() {
  const failures = [];
  const ledgerPath = "docs/CLAIMS_LEDGER.md";
  const ledger = await fs.readFile(path.join(repoRoot, ledgerPath), "utf8");

  for (const required of [
    "| Current verifier ABI is 256 bytes | Delivered |",
    "| Compressed proof target is 128 bytes | Delivered |",
    "| Canonical public-input shape has eight signals | Delivered |",
    "| Mainnet ready | Blocked |",
    "| Mainnet open beta | Blocked |",
    "| Completed third-party audit | Blocked |",
    "| Validator network | Not a current claim |",
    "| BFT consensus layer | Not a current claim |",
    "| Private compute | Not a current claim |",
  ]) {
    if (!ledger.includes(required)) {
      failures.push(`${ledgerPath}: missing claims-ledger row: ${required}`);
    }
  }

  return failures;
}

async function checkPackageHooks() {
  const failures = [];
  const packageJson = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));

  if (packageJson.scripts?.["check:claims"] !== "node ./scripts/check-claims-evidence.mjs") {
    failures.push("package.json: missing scripts.check:claims");
  }

  if (!packageJson.scripts?.test?.includes("npm run check:claims")) {
    failures.push("package.json: npm test must include npm run check:claims");
  }

  return failures;
}

async function checkReadmeLinks() {
  const failures = [];
  const readme = await fs.readFile(path.join(repoRoot, "README.md"), "utf8");
  if (!readme.includes("docs/CLAIMS_LEDGER.md")) {
    failures.push("README.md: missing claims ledger link");
  }
  return failures;
}

async function scanSensitiveClaims() {
  const failures = [];
  for (const file of await collectScanFiles()) {
    const content = await fs.readFile(path.join(repoRoot, file), "utf8");
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      for (const claim of sensitiveClaims) {
        if (!claim.regex.test(line)) {
          continue;
        }
        if (lineIsQualified(line)) {
          continue;
        }
        failures.push(`${file}:${index + 1}: unsupported ${claim.label}: ${line.trim()}`);
      }
    });
  }
  return failures;
}

async function main() {
  const failures = [
    ...(await checkClaimsLedger()),
    ...(await checkPackageHooks()),
    ...(await checkReadmeLinks()),
    ...(await scanSensitiveClaims()),
  ];

  if (failures.length > 0) {
    console.error("Claims evidence check failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Claims evidence check passed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
