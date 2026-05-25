#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const json = args.has("--json");
const allowBlockers = args.has("--allow-blockers");

function argValue(flag, fallback) {
  const index = rawArgs.indexOf(flag);
  if (index === -1 || index + 1 >= rawArgs.length) {
    return fallback;
  }
  return rawArgs[index + 1];
}

const evidencePath = path.resolve(repoRoot, argValue("--file", "MAINNET_EVIDENCE.json"));

function readJson(fullPath) {
  return JSON.parse(readFileSync(fullPath, "utf8"));
}

function add(blockers, id, summary, requiredEvidence) {
  blockers.push({ id, severity: "blocker", summary, requiredEvidence });
}

function isPlaceholder(value) {
  return (
    typeof value !== "string" ||
    value.trim() === "" ||
    /^REPLACE_WITH_/i.test(value) ||
    /^YYYY-MM-DD$/i.test(value) ||
    /PENDING|TODO|PLACEHOLDER/i.test(value)
  );
}

function currentGitCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    shell: process.platform === "win32",
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(readFileSync(fullPath)).digest("hex");
}

function checkBase58ish(value) {
  return typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,100}$/.test(value);
}

function collectBlockers() {
  const blockers = [];

  if (!existsSync(evidencePath)) {
    add(
      blockers,
      "mainnet-evidence-file",
      `Missing ${path.relative(repoRoot, evidencePath).split(path.sep).join("/")}.`,
      "Create MAINNET_EVIDENCE.json from MAINNET_EVIDENCE.example.json after deployment, v2 artifact promotion, and audit completion.",
    );
    return blockers;
  }

  const evidence = readJson(evidencePath);
  const manifest = readJson(path.join(repoRoot, "MANIFEST.json"));
  const networks = readJson(path.join(repoRoot, "NETWORKS.json"));
  const source = readFileSync(path.join(repoRoot, "src", "lib.rs"), "utf8");
  const head = currentGitCommit();

  if (evidence.schema !== "dark-null-mainnet-evidence-v1") {
    add(blockers, "evidence-schema", "MAINNET_EVIDENCE.json has an unknown schema.", "Use schema dark-null-mainnet-evidence-v1.");
  }

  if (!/^[0-9a-f]{40}$/i.test(evidence.release_commit ?? "")) {
    add(blockers, "release-commit", "release_commit is missing or is not a 40-character git commit hash.", "Set release_commit to the audited release commit.");
  } else if (head && evidence.release_commit !== head) {
    add(blockers, "release-commit-current", "release_commit does not match the current HEAD.", "Check out the audited release commit before running the readiness gate.");
  }

  if (evidence.program?.cluster !== "mainnet-beta") {
    add(blockers, "program-cluster", "Program evidence is not bound to mainnet-beta.", "Set program.cluster to mainnet-beta.");
  }
  if (!checkBase58ish(evidence.program?.id)) {
    add(blockers, "program-id", "Mainnet program id is missing or malformed.", "Publish the deployed mainnet program id.");
  }
  if (!checkBase58ish(evidence.program?.deployment_tx)) {
    add(blockers, "deployment-tx", "Mainnet deployment transaction is missing or malformed.", "Publish the mainnet deployment transaction signature.");
  }
  if (!["locked", "multisig", "timelock-multisig"].includes(evidence.program?.upgrade_authority_policy)) {
    add(
      blockers,
      "upgrade-authority-policy",
      "Upgrade-authority policy is missing or unsafe.",
      "Use locked, multisig, or timelock-multisig and document the authority.",
    );
  }
  if (isPlaceholder(evidence.program?.upgrade_authority)) {
    add(blockers, "upgrade-authority", "Upgrade authority evidence is missing.", "Document the upgrade authority or set it to none when locked.");
  }

  if (manifest.program?.cluster !== "mainnet-beta" || manifest.program?.id !== evidence.program?.id) {
    add(
      blockers,
      "manifest-mainnet-binding",
      "MANIFEST.json is not bound to the evidenced mainnet deployment.",
      "Promote MANIFEST.json to mainnet-beta with the evidenced program id.",
    );
  }
  if (networks.defaultNetwork !== "mainnet" || networks.canonicalProgramId !== evidence.program?.id) {
    add(
      blockers,
      "network-mainnet-binding",
      "NETWORKS.json is not bound to the evidenced mainnet deployment.",
      "Add supportedNetworks.mainnet and switch the default only after evidence is published.",
    );
  }

  if (evidence.proof_artifacts?.n_public !== 8 || manifest.groth16?.n_public !== 8) {
    add(
      blockers,
      "withdraw-v2-proof-artifacts",
      "Payout-bound v2 proof artifacts are not the promoted artifact set.",
      "Promote circuit, zkey, wasm, vk, Rust verifier, IDL, manifest, SDK, and tests with eight public inputs.",
    );
  }
  if (isPlaceholder(evidence.proof_artifacts?.label) || /devnet/i.test(evidence.proof_artifacts?.label ?? "")) {
    add(blockers, "artifact-label", "Mainnet v2 artifact label is missing or still devnet-oriented.", "Publish a mainnet v2 artifact label.");
  }
  if (!evidence.payout?.enabled || source.includes("WithdrawV2CircuitNotPromoted") || source.includes("UnsafePublicWithdrawPath")) {
    add(
      blockers,
      "payout-enabled",
      "Payout is not enabled by the promoted source and evidence.",
      "Enable payout only after the v2 proof verifies amount, receiver token account, and mint.",
    );
  }

  if (isPlaceholder(evidence.audit?.auditor)) {
    add(blockers, "audit-auditor", "Audit auditor name is missing.", "Publish the auditor identity.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(evidence.audit?.completed_on ?? "")) {
    add(blockers, "audit-date", "Audit completion date is missing or malformed.", "Use YYYY-MM-DD for the audit completion date.");
  }
  if (evidence.audit?.scope_commit !== evidence.release_commit) {
    add(blockers, "audit-scope-commit", "Audit scope commit does not match the release commit.", "Audit and release the same commit.");
  }
  if (isPlaceholder(evidence.audit?.residual_risk)) {
    add(blockers, "audit-residual-risk", "Residual risk summary is missing.", "Publish accepted residual risk from the final audit.");
  }

  const auditPath = path.resolve(repoRoot, evidence.audit?.report_path ?? "");
  if (isPlaceholder(evidence.audit?.report_path) || !existsSync(auditPath)) {
    add(blockers, "audit-report", "Final third-party audit report is missing.", "Commit the final third-party audit report or publish it with a verifiable path.");
  } else if (!/^[0-9a-f]{64}$/i.test(evidence.audit?.sha256 ?? "")) {
    add(blockers, "audit-report-hash", "Audit report hash is missing or malformed.", "Publish the SHA-256 hash of the final audit report.");
  } else {
    const actual = sha256File(auditPath);
    if (actual !== evidence.audit.sha256) {
      add(blockers, "audit-report-hash", "Audit report hash does not match the report file.", "Update the evidence hash or use the audited report file.");
    }
  }

  return blockers;
}

function main() {
  const blockers = collectBlockers();
  const report = {
    status: blockers.length === 0 ? "READY" : "BLOCKED",
    evidenceFile: path.relative(repoRoot, evidencePath).split(path.sep).join("/"),
    checkedAt: new Date().toISOString(),
    blockers,
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (blockers.length === 0) {
    console.log("Mainnet evidence check passed.");
  } else {
    console.error("Mainnet evidence check failed:");
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
