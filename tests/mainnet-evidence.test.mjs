import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceScript = path.join(repoRoot, "scripts", "check-mainnet-evidence.mjs");

test("mainnet evidence gate blocks missing production evidence", () => {
  const output = execFileSync(
    process.execPath,
    [evidenceScript, "--json", "--allow-blockers"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const report = JSON.parse(output);
  const blockerIds = report.blockers.map((blocker) => blocker.id);

  assert.equal(report.status, "BLOCKED");
  assert.ok(blockerIds.includes("mainnet-evidence-file"));
});

test("example mainnet evidence file is intentionally non-promotable", () => {
  const output = execFileSync(
    process.execPath,
    [evidenceScript, "--file", "MAINNET_EVIDENCE.example.json", "--json", "--allow-blockers"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const report = JSON.parse(output);
  const blockerIds = report.blockers.map((blocker) => blocker.id);

  assert.equal(report.status, "BLOCKED");
  assert.ok(blockerIds.includes("release-commit"));
  assert.ok(blockerIds.includes("program-id"));
  assert.ok(blockerIds.includes("deployment-tx"));
  assert.ok(blockerIds.includes("audit-report"));
});
