#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ceremonyPath = path.join(repoRoot, "CEREMONY.md");
const manifestPath = path.join(repoRoot, "MANIFEST.json");
const snarkjsPath = path.join(repoRoot, "node_modules", "snarkjs", "build", "cli.cjs");

const requiredFiles = [
  "circuits/null_proof.circom",
  "circuits/null_proof.r1cs",
  "circuits/null_proof_final.zkey",
  "circuits/vk.json",
  "src/verifying_key.rs",
  "MANIFEST.json",
];

const requiredText = [
  "not a public multi-party ceremony",
  "not enough by itself for mainnet trust",
  "15a49437 3e8e5577 bd946a51 e85cb0b2 f0eb6610 b5522077 428e1a5b 9ea90f1a 544aa9a6 4ce56ceb 41c7d229 96ebc03c 3cbb31fa a7994ba0 d0950e53 c4c46472",
  "sls_0x",
  "5dad2bc5 4534f335 ce8c4852 3f69b34c b517f1e8 b148bc24 211eb99f 15bef63c 7153d694 227a110c 7b2dc64c 41a29fe1 a45bbfe7 fdaab594 2df11cb1 972a3172",
  "DARK_NULL_PTAU_PATH",
];

function toRepoPath(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function assertReportText() {
  if (!existsSync(ceremonyPath)) {
    fail("CEREMONY.md is missing.");
  }

  const report = readFileSync(ceremonyPath, "utf8");
  const missing = requiredText.filter((text) => !report.includes(text));
  if (missing.length > 0) {
    fail(`CEREMONY.md is missing required setup evidence text:\n- ${missing.join("\n- ")}`);
  }
}

function assertManifestBinding() {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const failures = [];

  if (manifest.label !== "canonical-devnet-root-2") {
    failures.push(`Expected MANIFEST.json label canonical-devnet-root-2, got ${manifest.label}`);
  }

  if (manifest.groth16?.n_public !== 8 || manifest.groth16?.vk_ic_count !== 9) {
    failures.push("MANIFEST.json must bind the eight-public-input v2 verifier shape.");
  }

  for (const file of requiredFiles) {
    if (!existsSync(path.join(repoRoot, file))) {
      failures.push(`Missing setup artifact: ${file}`);
    }
  }

  const manifestArtifacts = new Set((manifest.artifacts ?? []).map((entry) => entry.path));
  for (const file of requiredFiles.filter((entry) => entry !== "MANIFEST.json")) {
    if (!manifestArtifacts.has(file)) {
      failures.push(`MANIFEST.json artifacts missing ${file}`);
    }
  }

  if (failures.length > 0) {
    fail(`Trusted setup evidence check failed:\n- ${failures.join("\n- ")}`);
  }
}

function verifyZkeyIfPtauAvailable() {
  const ptauPath = process.env.DARK_NULL_PTAU_PATH;
  if (!ptauPath) {
    console.log("DARK_NULL_PTAU_PATH not set; skipped snarkjs zkey verify.");
    return;
  }

  const resolvedPtauPath = path.resolve(ptauPath);
  if (!existsSync(resolvedPtauPath)) {
    fail(`DARK_NULL_PTAU_PATH does not exist: ${resolvedPtauPath}`);
  }

  if (!existsSync(snarkjsPath)) {
    fail("snarkjs CLI is missing. Run npm ci before check:ceremony.");
  }

  const result = spawnSync(
    process.execPath,
    [
      snarkjsPath,
      "zkey",
      "verify",
      path.join(repoRoot, "circuits", "null_proof.r1cs"),
      resolvedPtauPath,
      path.join(repoRoot, "circuits", "null_proof_final.zkey"),
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.stdout.write(result.stdout);
    fail("snarkjs zkey verify failed.");
  }

  console.log(`snarkjs zkey verify passed with ${toRepoPath(resolvedPtauPath)}.`);
}

assertReportText();
assertManifestBinding();
verifyZkeyIfPtauAvailable();
console.log("Trusted setup evidence check passed.");
