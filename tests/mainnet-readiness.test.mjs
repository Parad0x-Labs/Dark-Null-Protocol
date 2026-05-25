import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readinessScript = path.join(repoRoot, "scripts", "check-mainnet-readiness.mjs");

test("mainnet readiness gate reports current blockers without pretending readiness", () => {
  const output = execFileSync(
    process.execPath,
    [readinessScript, "--json", "--allow-blockers"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const report = JSON.parse(output);
  const blockerIds = report.blockers.map((blocker) => blocker.id);

  assert.equal(report.status, "BLOCKED");
  assert.ok(blockerIds.includes("withdraw-v2-artifacts"));
  assert.ok(blockerIds.includes("payout-disabled"));
  assert.ok(blockerIds.includes("third-party-audit"));
  assert.ok(blockerIds.includes("mainnet-manifest"));
});
