import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vkJsonPath = path.join(repoRoot, "circuits", "vk.json");
const rustSnapshotPath = path.join(repoRoot, "src", "verifying_key.rs");

function matchValue(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `Missing ${label} in Rust verifier snapshot`);
  return match[1];
}

test("Rust verifier matches canonical vk.json metadata", async () => {
  const vkRaw = await fs.readFile(vkJsonPath);
  const vk = JSON.parse(vkRaw.toString("utf8"));
  const rust = await fs.readFile(rustSnapshotPath, "utf8");
  const sha256 = crypto.createHash("sha256").update(vkRaw).digest("hex");

  assert.equal(Number(matchValue(rust, /pub const NR_PUBINPUTS: usize = (\d+);/, "NR_PUBINPUTS")), vk.nPublic);
  assert.equal(Number(matchValue(rust, /pub const VK_IC_COUNT: usize = (\d+);/, "VK_IC_COUNT")), vk.IC.length);
  assert.equal(matchValue(rust, /pub const VK_PROTOCOL: &str = "([^"]+)";/, "VK_PROTOCOL"), vk.protocol);
  assert.equal(matchValue(rust, /pub const VK_CURVE: &str = "([^"]+)";/, "VK_CURVE"), vk.curve);
  assert.equal(matchValue(rust, /pub const VK_JSON_SHA256: &str = "([0-9a-f]+)";/, "VK_JSON_SHA256"), sha256);
  assert.match(rust, /pub const VERIFYING_KEY: Groth16Verifyingkey = Groth16Verifyingkey \{/);
  assert.doesNotMatch(rust, /IS_PLACEHOLDER/);
});
