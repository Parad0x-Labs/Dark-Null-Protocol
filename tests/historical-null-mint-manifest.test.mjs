import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const historicalRoot = path.join(repoRoot, "historical", "null-mint");
const manifestPath = path.join(historicalRoot, "MANIFEST.json");
const textExtensions = new Set([".circom", ".json", ".md", ".mjs", ".rs", ".toml", ".ts"]);

async function canonicalArtifactBytes(fullPath) {
  const bytes = await fs.readFile(fullPath);
  if (!textExtensions.has(path.extname(fullPath))) {
    return bytes;
  }

  return Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
}

test("historical null-mint manifest binds program ids and artifact hashes", async () => {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const libRs = await fs.readFile(path.join(historicalRoot, "programs", "paradox", "src", "lib.rs"), "utf8");
  const idl = JSON.parse(await fs.readFile(path.join(historicalRoot, "idl", "paradox.json"), "utf8"));
  const vk = JSON.parse(await fs.readFile(path.join(historicalRoot, "verification_key_latest.json"), "utf8"));

  assert.equal(manifest.label, "recovered-null-mint-prototype-1");
  assert.equal(manifest.status, "historical-recovered-devnet-branch");
  assert.equal(manifest.programs.paradox, idl.address);
  assert.match(libRs, new RegExp(`declare_id!\\("${manifest.programs.paradox}"\\);`));
  assert.equal(manifest.groth16.protocol, vk.protocol);
  assert.equal(manifest.groth16.curve, vk.curve);
  assert.equal(manifest.groth16.n_public, vk.nPublic);
  assert.equal(manifest.groth16.vk_ic_count, vk.IC.length);

  for (const artifact of manifest.artifacts) {
    const fullPath = path.join(historicalRoot, artifact.path);
    const bytes = await canonicalArtifactBytes(fullPath);
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    assert.equal(sha256, artifact.sha256, `Hash mismatch for ${artifact.path}`);
    assert.equal(bytes.length, artifact.size, `Size mismatch for ${artifact.path}`);
  }
});
