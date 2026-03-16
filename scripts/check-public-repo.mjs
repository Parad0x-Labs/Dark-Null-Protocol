#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "README.md",
  "LICENSE",
  "package.json",
  "Anchor.toml",
  "MANIFEST.json",
  "NETWORKS.json",
  ".env.example",
  "PROTOTYPE_STATUS.md",
  "SECURITY_MODEL.md",
  "AUDIT.md",
  "INTERNAL_REVIEW.md",
  "VERIFICATION.md",
  "SECURITY.md",
  "Cargo.toml",
  "src/lib.rs",
  "sdk/index.mjs",
  "sdk/index.d.ts",
  "sdk/README.md",
  "historical/null-mint/README.md",
  "historical/null-mint/MANIFEST.json",
  "historical/null-mint/Anchor.toml",
  "historical/null-mint/programs/paradox/src/lib.rs",
  "historical/null-mint/idl/paradox.json",
  "historical/null-mint/verification_key_latest.json",
  "tests/verification-key-consistency.test.mjs",
  "tests/canonical-manifest.test.mjs",
  "tests/canonical-proof-flow.test.mjs",
  "tests/historical-null-mint-consistency.test.mjs",
  "tests/historical-null-mint-manifest.test.mjs",
  "client/dark_client.py",
  "client/README.md",
  "circuits/null_proof.circom",
  "circuits/null_proof_final.zkey",
  "circuits/null_proof_js/null_proof.wasm",
  "circuits/null_proof.r1cs",
  "circuits/vk.json",
  "circuits/README.md",
  "docs/CONTRIBUTOR_QUICKSTART.md",
  "docs/PROGRAM_IDS.md",
  "scripts/bootstrap.sh",
  "scripts/check-public-repo.mjs",
  "scripts/network-config.mjs",
  "idl/paradox.json",
  "tests/network-config.test.mjs",
];

const textExtensions = new Set([
  ".json",
  ".css",
  ".html",
  ".md",
  ".mjs",
  ".cjs",
  ".py",
  ".rs",
  ".sh",
  ".toml",
  ".ts",
  ".txt",
  ".yml",
  ".yaml",
]);

const disallowedPatterns = [
  { label: "stale proprietary badge", regex: /License-Proprietary/ },
  { label: "stale docs-shell disclaimer", regex: /public interface and documentation shell/i },
  { label: "stale audit hash placeholder", regex: /\[(?:HASH PUBLISHED AFTER AUDIT|TO BE PUBLISHED AFTER AUDIT)\]/ },
  { label: "stale npm package reference", regex: /@dark-null\/sdk|@dark-null\/x402-middleware|@dark-null\/jupiter-hook|@dark-null\/mcp-tools/ },
  { label: "placeholder pgp key", regex: /\[PGP KEY WILL BE ADDED\]/ },
  { label: "local user path", regex: /\/Users\/[^/\n]+/ },
  { label: "local windows user path", regex: /[A-Z]:\/Users\/[^/\n]+/i },
  { label: "local windows user path", regex: /[A-Z]:\\Users\\[^\\\n]+/i },
  { label: "local mac temp path", regex: /\/private\/var\/folders\// },
  { label: "embedded rpc api key", regex: /helius-rpc\.com\/\?api-key=/i },
  { label: "stale auditor recruitment copy", regex: /We're seeking auditors/ },
  { label: "stale public release badge", regex: /Status-Public_Release/ },
  { label: "stale production-ready devnet claim", regex: /production-ready release on solana devnet/i },
];

async function assertRequiredFiles() {
  const missing = [];
  for (const file of requiredFiles) {
    try {
      await fs.access(path.join(repoRoot, file));
    } catch {
      missing.push(file);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required files:\n- ${missing.join("\n- ")}`);
  }
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "target" || entry.name === "dist" || entry.name === "build") {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
      continue;
    }

    if (textExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

async function checkPackageMetadata() {
  const packagePath = path.join(repoRoot, "package.json");
  const packageJson = JSON.parse(await fs.readFile(packagePath, "utf8"));
  const failures = [];

  if (packageJson.license !== "MIT") {
    failures.push(`package.json license must be MIT, got ${packageJson.license}`);
  }

  if (!packageJson.scripts || packageJson.scripts["check:public"] !== "node ./scripts/check-public-repo.mjs") {
    failures.push("package.json must expose scripts.check:public");
  }

  if (!packageJson.scripts || packageJson.scripts.bootstrap !== "sh ./scripts/bootstrap.sh") {
    failures.push("package.json must expose scripts.bootstrap");
  }
  if (!packageJson.exports || packageJson.exports["./networks"] !== "./NETWORKS.json") {
    failures.push("package.json must export ./networks -> ./NETWORKS.json");
  }
  if (!packageJson.scripts || packageJson.scripts["test:artifacts"] !== "node --test ./tests/verification-key-consistency.test.mjs ./tests/canonical-manifest.test.mjs ./tests/canonical-proof-flow.test.mjs ./tests/historical-null-mint-consistency.test.mjs ./tests/historical-null-mint-manifest.test.mjs") {
    failures.push("package.json must expose scripts.test:artifacts");
  }
  if (!packageJson.scripts || packageJson.scripts["test:config"] !== "node --test ./tests/network-config.test.mjs") {
    failures.push("package.json must expose scripts.test:config");
  }
  if (!packageJson.scripts || packageJson.scripts["config:devnet"] !== "node ./scripts/network-config.mjs --network devnet --check") {
    failures.push("package.json must expose scripts.config:devnet");
  }
  if (!packageJson.scripts || packageJson.scripts["config:localnet"] !== "node ./scripts/network-config.mjs --network localnet --check") {
    failures.push("package.json must expose scripts.config:localnet");
  }
  if (!packageJson.scripts || !packageJson.scripts.test.includes("npm run test:config")) {
    failures.push("package.json test script must include npm run test:config");
  }

  return failures;
}

async function checkCanonicalNetworkMetadata() {
  const networksPath = path.join(repoRoot, "NETWORKS.json");
  const manifestPath = path.join(repoRoot, "MANIFEST.json");
  const networks = JSON.parse(await fs.readFile(networksPath, "utf8"));
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const failures = [];

  if (networks.defaultNetwork !== "devnet") {
    failures.push(`NETWORKS.json defaultNetwork must be devnet, got ${networks.defaultNetwork}`);
  }
  if (networks.canonicalProgramId !== manifest.program.id) {
    failures.push("NETWORKS.json canonicalProgramId must match MANIFEST.json program.id");
  }

  for (const network of ["devnet", "localnet"]) {
    if (!networks.supportedNetworks?.[network]) {
      failures.push(`NETWORKS.json missing supported network: ${network}`);
      continue;
    }

    if (networks.supportedNetworks[network].manifestKey !== "canonicalDevnet") {
      failures.push(`NETWORKS.json ${network} manifestKey must be canonicalDevnet`);
    }
  }

  return failures;
}

async function checkDocs() {
  const files = await walk(repoRoot);
  const failures = [];

  for (const file of files) {
    const content = await fs.readFile(file, "utf8");
    const relativePath = path.relative(repoRoot, file);

    if (relativePath === "scripts/check-public-repo.mjs") {
      continue;
    }

    for (const pattern of disallowedPatterns) {
      if (pattern.regex.test(content)) {
        failures.push(`${relativePath}: ${pattern.label}`);
      }
    }
  }

  const readme = await fs.readFile(path.join(repoRoot, "README.md"), "utf8");
  if (!readme.includes("sh scripts/bootstrap.sh")) {
    failures.push("README.md: missing bootstrap command");
  }
  if (!readme.includes("npm install @dark-null/protocol")) {
    failures.push("README.md: missing published npm install command");
  }
  if (!readme.includes("npm run config:devnet")) {
    failures.push("README.md: missing canonical devnet config command");
  }
  if (!readme.includes("npm run config:localnet")) {
    failures.push("README.md: missing canonical localnet config command");
  }

  const auditDoc = await fs.readFile(path.join(repoRoot, "AUDIT.md"), "utf8");
  if (
    !/No third-party audit has been completed yet\./i.test(auditDoc) &&
    !/completed third-party audit/i.test(auditDoc)
  ) {
    failures.push("AUDIT.md: missing explicit no-third-party-audit statement");
  }

  const archivedAudit = await fs.readFile(path.join(repoRoot, "Auditreport.md"), "utf8");
  if (!archivedAudit.includes("not a third-party audit report")) {
    failures.push("Auditreport.md: missing archived audit warning");
  }

  const envExample = await fs.readFile(path.join(repoRoot, ".env.example"), "utf8");
  if (!envExample.includes("DARK_NULL_NETWORK=devnet")) {
    failures.push(".env.example: missing DARK_NULL_NETWORK default");
  }

  const securityDoc = await fs.readFile(path.join(repoRoot, "SECURITY.md"), "utf8");
  if (!securityDoc.includes("SECURITY_MODEL.md")) {
    failures.push("SECURITY.md: missing SECURITY_MODEL.md reference");
  }

  return failures;
}

async function main() {
  await assertRequiredFiles();

  const failures = [
    ...(await checkPackageMetadata()),
    ...(await checkCanonicalNetworkMetadata()),
    ...(await checkDocs()),
  ];

  if (failures.length > 0) {
    console.error("Dark Null public repo check failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Dark Null public repo check passed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
