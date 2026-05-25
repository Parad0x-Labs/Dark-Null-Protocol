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

const evidencePath = path.resolve(repoRoot, argValue("--file", "MAINNET_BETA_EVIDENCE.json"));
const maxAllowedBetaTvlLamports = 100_000_000_000n;

function readJson(fullPath) {
  return JSON.parse(readFileSync(fullPath, "utf8"));
}

function readText(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function add(blockers, id, summary, requiredEvidence) {
  blockers.push({ id, severity: "blocker", summary, requiredEvidence });
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

function functionBody(source, name) {
  const start = source.indexOf(`pub fn ${name}`);
  if (start === -1) {
    return "";
  }

  const next = source.indexOf("\n    pub fn ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
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

function checkBase58ish(value) {
  return typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,100}$/.test(value);
}

function toBigInt(value) {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }
  return null;
}

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(readFileSync(fullPath)).digest("hex");
}

function repoRelative(fullPath) {
  return path.relative(repoRoot, fullPath).split(path.sep).join("/");
}

function checkFileHash(blockers, id, label, relativePath, expectedHash) {
  if (isPlaceholder(relativePath)) {
    add(blockers, `${id}-path`, `${label} path is missing.`, `Publish ${label} path in the beta evidence file.`);
    return;
  }

  const fullPath = path.resolve(repoRoot, relativePath);
  if (!existsSync(fullPath)) {
    add(blockers, `${id}-path`, `${label} file is missing: ${repoRelative(fullPath)}.`, `Commit or publish ${label}.`);
    return;
  }

  if (!/^[0-9a-f]{64}$/i.test(expectedHash ?? "")) {
    add(blockers, `${id}-hash`, `${label} SHA-256 is missing or malformed.`, `Publish the SHA-256 hash for ${label}.`);
    return;
  }

  const actual = sha256File(fullPath);
  if (actual !== expectedHash) {
    add(blockers, `${id}-hash`, `${label} SHA-256 does not match.`, `Update the beta evidence hash or use the evidenced ${label}.`);
  }
}

function collectBlockers() {
  const blockers = [];

  if (!existsSync(evidencePath)) {
    add(
      blockers,
      "beta-evidence-file",
      `Missing ${repoRelative(evidencePath)}.`,
      "Create MAINNET_BETA_EVIDENCE.json from MAINNET_BETA_EVIDENCE.example.json after a capped mainnet-beta deployment is real.",
    );
    return blockers;
  }

  const evidence = readJson(evidencePath);
  const manifest = readJson(path.join(repoRoot, "MANIFEST.json"));
  const networks = readJson(path.join(repoRoot, "NETWORKS.json"));
  const source = readText("src/lib.rs");
  const head = currentGitCommit();

  if (evidence.schema !== "dark-null-mainnet-open-beta-evidence-v1") {
    add(blockers, "evidence-schema", "MAINNET_BETA_EVIDENCE.json has an unknown schema.", "Use schema dark-null-mainnet-open-beta-evidence-v1.");
  }

  if (!/^[0-9a-f]{40}$/i.test(evidence.release_commit ?? "")) {
    add(blockers, "release-commit", "release_commit is missing or malformed.", "Set release_commit to the beta release commit.");
  } else if (head && evidence.release_commit !== head) {
    add(blockers, "release-commit-current", "release_commit does not match the current HEAD.", "Check out the evidenced beta release commit.");
  }

  if (evidence.beta?.status !== "open-beta") {
    add(blockers, "beta-status", "Beta status is not open-beta.", "Set beta.status to open-beta.");
  }
  if (evidence.beta?.risk_disclosure !== "unaudited-open-beta") {
    add(blockers, "risk-disclosure", "Risk disclosure is not explicitly unaudited-open-beta.", "Make the beta risk disclosure explicit.");
  }
  if (evidence.beta?.production_claims_allowed !== false) {
    add(blockers, "production-claims", "Production claims are not explicitly disabled.", "Set beta.production_claims_allowed to false.");
  }
  if (evidence.beta?.kill_switch_enabled !== true) {
    add(blockers, "kill-switch", "Kill switch / pause path is not evidenced.", "Set beta.kill_switch_enabled to true and document the authority.");
  }
  if (evidence.beta?.direct_submission_supported !== true) {
    add(blockers, "direct-submission", "Direct user submission is not evidenced.", "Set beta.direct_submission_supported to true.");
  }
  if (evidence.beta?.relayer_optional !== true) {
    add(blockers, "relayer-optional", "Relayer optionality is not evidenced.", "Set beta.relayer_optional to true.");
  }

  const tvl = toBigInt(evidence.beta?.max_total_value_locked_lamports);
  const deposit = toBigInt(evidence.beta?.max_deposit_lamports);
  const dailyWithdraw = toBigInt(evidence.beta?.daily_withdraw_limit_lamports);
  if (tvl === null || tvl <= 0n || tvl > maxAllowedBetaTvlLamports) {
    add(
      blockers,
      "beta-tvl-cap",
      "Beta TVL cap is missing, invalid, or too high.",
      "Set beta.max_total_value_locked_lamports to a positive value no higher than 100 SOL.",
    );
  }
  if (deposit === null || deposit <= 0n || (tvl !== null && deposit > tvl)) {
    add(blockers, "beta-deposit-cap", "Beta per-deposit cap is missing or invalid.", "Set beta.max_deposit_lamports to a positive value no higher than the TVL cap.");
  }
  if (dailyWithdraw === null || dailyWithdraw <= 0n || (tvl !== null && dailyWithdraw > tvl)) {
    add(
      blockers,
      "beta-withdraw-cap",
      "Beta daily withdraw cap is missing or invalid.",
      "Set beta.daily_withdraw_limit_lamports to a positive value no higher than the TVL cap.",
    );
  }

  if (evidence.program?.cluster !== "mainnet-beta") {
    add(blockers, "program-cluster", "Program evidence is not bound to mainnet-beta.", "Set program.cluster to mainnet-beta.");
  }
  if (!checkBase58ish(evidence.program?.id)) {
    add(blockers, "program-id", "Mainnet beta program id is missing or malformed.", "Publish the deployed beta program id.");
  }
  if (!checkBase58ish(evidence.program?.deployment_tx)) {
    add(blockers, "deployment-tx", "Mainnet beta deployment transaction is missing or malformed.", "Publish the deployment transaction signature.");
  }
  if (!["locked", "multisig", "timelock-multisig"].includes(evidence.program?.upgrade_authority_policy)) {
    add(blockers, "upgrade-authority-policy", "Upgrade-authority policy is missing or unsafe.", "Use locked, multisig, or timelock-multisig.");
  }
  if (isPlaceholder(evidence.program?.upgrade_authority)) {
    add(blockers, "upgrade-authority", "Upgrade authority evidence is missing.", "Document the upgrade authority or set it to none when locked.");
  }
  if (!checkBase58ish(evidence.program?.pause_authority)) {
    add(blockers, "pause-authority", "Pause authority is missing or malformed.", "Publish the pause authority for the beta deployment.");
  }

  if (manifest.program?.cluster !== "mainnet-beta" || manifest.program?.id !== evidence.program?.id) {
    add(
      blockers,
      "manifest-mainnet-beta-binding",
      "MANIFEST.json is not bound to the evidenced mainnet-beta deployment.",
      "Promote MANIFEST.json to the evidenced mainnet-beta program id for beta.",
    );
  }

  const mainnetNetwork = networks.supportedNetworks?.mainnet;
  if (
    !mainnetNetwork ||
    mainnetNetwork.cluster !== "mainnet-beta" ||
    networks.canonicalProgramId !== evidence.program?.id ||
    mainnetNetwork.manifestKey !== "canonicalMainnetBeta"
  ) {
    add(
      blockers,
      "network-mainnet-beta-binding",
      "NETWORKS.json does not expose an explicit mainnet beta network bound to the evidenced program.",
      "Add supportedNetworks.mainnet with manifestKey canonicalMainnetBeta and keep defaultNetwork conservative until launch evidence exists.",
    );
  }

  if (evidence.proof_artifacts?.n_public !== 8 || manifest.groth16?.n_public !== 8) {
    add(blockers, "withdraw-v2-proof-artifacts", "Payout-bound v2 proof artifacts are not promoted.", "Use the eight-input payout-bound v2 artifact set.");
  }
  if (isPlaceholder(evidence.proof_artifacts?.label) || /devnet/i.test(evidence.proof_artifacts?.label ?? "")) {
    add(blockers, "artifact-label", "Beta artifact label is missing or still devnet-oriented.", "Publish a mainnet beta v2 artifact label.");
  }
  if (evidence.proof_artifacts?.trusted_setup_status !== "development-evidence-accepted-for-open-beta-only") {
    add(
      blockers,
      "trusted-setup-beta-status",
      "Trusted setup status is not explicitly limited to open beta.",
      "Set trusted_setup_status to development-evidence-accepted-for-open-beta-only.",
    );
  }

  const withdrawV2 = functionBody(source, "prepare_phantom_withdraw_v2");
  if (
    !evidence.payout?.enabled ||
    withdrawV2.includes("WithdrawV2CircuitNotPromoted") ||
    !withdrawV2.includes("verify_withdraw_v2_public_inputs") ||
    !withdrawV2.includes("token::transfer")
  ) {
    add(blockers, "payout-enabled", "Payout v2 is not enabled by the promoted source and evidence.", "Use the proof-bound v2 payout path.");
  }

  if (evidence.audit?.status !== "pending") {
    add(blockers, "audit-status", "Beta audit status must be pending, not implied complete.", "Set audit.status to pending.");
  }
  if (evidence.audit?.external_audit_required_before_production !== true) {
    add(
      blockers,
      "audit-required-before-production",
      "External audit is not required before production in the evidence.",
      "Set audit.external_audit_required_before_production to true.",
    );
  }

  checkFileHash(blockers, "trusted-setup-report", "trusted setup report", evidence.proof_artifacts?.trusted_setup_report_path, evidence.proof_artifacts?.trusted_setup_report_sha256);
  checkFileHash(blockers, "checksums", "release checksums", evidence.proof_artifacts?.checksums_path, evidence.proof_artifacts?.checksums_sha256);
  checkFileHash(blockers, "sbom", "release SBOM", evidence.proof_artifacts?.sbom_path, evidence.proof_artifacts?.sbom_sha256);
  checkFileHash(blockers, "disclosure", "beta disclosure", evidence.operations?.disclosure_path, evidence.operations?.disclosure_sha256);
  checkFileHash(blockers, "incident-response", "incident response runbook", evidence.operations?.incident_response_path, evidence.operations?.incident_response_sha256);
  checkFileHash(blockers, "rollback-runbook", "rollback runbook", evidence.operations?.rollback_runbook_path, evidence.operations?.rollback_runbook_sha256);

  return blockers;
}

function main() {
  const blockers = collectBlockers();
  const report = {
    status: blockers.length === 0 ? "BETA_READY" : "BLOCKED",
    mode: "mainnet-open-beta",
    evidenceFile: repoRelative(evidencePath),
    checkedAt: new Date().toISOString(),
    blockers,
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (blockers.length === 0) {
    console.log("Mainnet open beta evidence check passed.");
  } else {
    console.error("Mainnet open beta evidence check failed:");
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
