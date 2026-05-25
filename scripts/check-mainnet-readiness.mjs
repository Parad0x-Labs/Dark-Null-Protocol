#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const json = args.has("--json");
const allowBlockers = args.has("--allow-blockers");

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

function readText(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function commandExists(command, versionArgs = ["--version"]) {
  const result = spawnSync(command, versionArgs, {
    cwd: repoRoot,
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  return result.status === 0;
}

function add(blockers, id, severity, summary, requiredEvidence) {
  blockers.push({ id, severity, summary, requiredEvidence });
}

function collectBlockers() {
  const blockers = [];
  const manifest = readJson("MANIFEST.json");
  const networks = readJson("NETWORKS.json");
  const packageJson = readJson("package.json");
  const rootSource = readText("src/lib.rs");
  const auditDoc = readText("AUDIT.md");
  const mainnetEvidencePath = path.join(repoRoot, "MAINNET_EVIDENCE.json");

  if (!commandExists("cargo")) {
    add(
      blockers,
      "rust-local-validation",
      "blocker",
      "cargo is not available locally, so Rust tests cannot be treated as locally validated.",
      "Run cargo test --offline locally or in CI on the exact release commit.",
    );
  }

  if (!existsSync(mainnetEvidencePath)) {
    add(
      blockers,
      "mainnet-evidence-file",
      "blocker",
      "MAINNET_EVIDENCE.json is not published.",
      "Create MAINNET_EVIDENCE.json from MAINNET_EVIDENCE.example.json after deployment, v2 artifact promotion, and audit completion.",
    );
  }

  if (manifest.program?.cluster !== "mainnet-beta") {
    add(
      blockers,
      "mainnet-manifest",
      "blocker",
      `MANIFEST.json is still bound to ${manifest.program?.cluster ?? "unknown"}, not mainnet-beta.`,
      "Promote a mainnet manifest with program id, deployment tx, artifact hashes, and upgrade-authority policy.",
    );
  }

  if (networks.defaultNetwork !== "mainnet") {
    add(
      blockers,
      "network-default",
      "blocker",
      `NETWORKS.json defaultNetwork is ${networks.defaultNetwork}, not mainnet.`,
      "Add an explicit mainnet network entry and switch defaults only after deployment evidence is published.",
    );
  }

  if (manifest.groth16?.n_public !== 8 || manifest.label !== "canonical-devnet-root-2") {
    add(
      blockers,
      "withdraw-v2-artifacts",
      "blocker",
      "The promoted circuit is not the payout-bound withdraw v2 artifact set.",
      "Promote circuit, zkey, wasm, vk, Rust verifier, IDL, manifest, SDK, and proof-flow tests together.",
    );
  }

  if (
    rootSource.includes("WithdrawV2CircuitNotPromoted") ||
    rootSource.includes("UnsafePublicWithdrawPath")
  ) {
    add(
      blockers,
      "payout-disabled",
      "blocker",
      "The public payout paths are intentionally fail-closed in source.",
      "Enable payout only after v2 proof artifacts bind amount, receiver token account, and mint.",
    );
  }

  if (/No third-party audit|not (?:a )?third-party audit|does \*\*not\*\* have a completed third-party audit/i.test(auditDoc)) {
    add(
      blockers,
      "third-party-audit",
      "blocker",
      "No completed third-party audit is published.",
      "Publish a real audit report with scope, commit, findings, fixes, residual risk, and auditor identity.",
    );
  }

  for (const [id, script] of [
    ["public-regression", "test"],
    ["proof-regression", "test:proof"],
    ["runtime-audit-gate", "test:security"],
    ["release-integrity", "release:verify"],
  ]) {
    if (!packageJson.scripts?.[script]) {
      add(
        blockers,
        id,
        "blocker",
        `Missing npm script: ${script}.`,
        `Add and run npm run ${script} on the release commit.`,
      );
    }
  }

  for (const [id, workflow] of [
    ["ci-workflow", ".github/workflows/ci.yml"],
    ["codeql-workflow", ".github/workflows/codeql.yml"],
    ["release-workflow", ".github/workflows/release.yml"],
  ]) {
    if (!existsSync(path.join(repoRoot, workflow))) {
      add(
        blockers,
        id,
        "blocker",
        `Missing workflow: ${workflow}.`,
        "Restore the workflow and verify it passes on the release commit.",
      );
    }
  }

  return blockers;
}

function main() {
  const blockers = collectBlockers();
  const report = {
    status: blockers.length === 0 ? "READY" : "BLOCKED",
    checkedAt: new Date().toISOString(),
    blockers,
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (blockers.length === 0) {
    console.log("Mainnet readiness gate passed.");
  } else {
    console.error("Mainnet readiness gate failed:");
    for (const blocker of blockers) {
      console.error(`- [${blocker.severity}] ${blocker.id}: ${blocker.summary}`);
      console.error(`  Required evidence: ${blocker.requiredEvidence}`);
    }
  }

  if (blockers.length > 0 && !allowBlockers) {
    process.exit(1);
  }
}

main();
