import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const betaEvidenceScript = path.join(repoRoot, "scripts", "check-mainnet-beta-evidence.mjs");

test("mainnet beta evidence gate blocks missing beta evidence", () => {
  const output = execFileSync(
    process.execPath,
    [betaEvidenceScript, "--json", "--allow-blockers"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const report = JSON.parse(output);
  const blockerIds = report.blockers.map((blocker) => blocker.id);

  assert.equal(report.status, "BLOCKED");
  assert.equal(report.mode, "mainnet-open-beta");
  assert.ok(blockerIds.includes("beta-evidence-file"));
});

test("example mainnet beta evidence file is intentionally non-promotable", () => {
  const output = execFileSync(
    process.execPath,
    [betaEvidenceScript, "--file", "MAINNET_BETA_EVIDENCE.example.json", "--json", "--allow-blockers"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const report = JSON.parse(output);
  const blockerIds = report.blockers.map((blocker) => blocker.id);

  assert.equal(report.status, "BLOCKED");
  assert.equal(report.mode, "mainnet-open-beta");
  assert.ok(blockerIds.includes("release-commit"));
  assert.ok(blockerIds.includes("program-id"));
  assert.ok(blockerIds.includes("deployment-tx"));
  assert.ok(blockerIds.includes("manifest-mainnet-beta-binding"));
  assert.ok(blockerIds.includes("network-mainnet-beta-binding"));
  assert.ok(blockerIds.includes("audit-status") === false);
});
