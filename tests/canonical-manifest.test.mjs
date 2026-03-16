import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(repoRoot, "MANIFEST.json");

test("canonical manifest binds promoted root artifacts and program id", async () => {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const anchorToml = await fs.readFile(path.join(repoRoot, "Anchor.toml"), "utf8");
  const rootLib = await fs.readFile(path.join(repoRoot, "src", "lib.rs"), "utf8");
  const idl = JSON.parse(await fs.readFile(path.join(repoRoot, "idl", "paradox.json"), "utf8"));
  const vk = JSON.parse(await fs.readFile(path.join(repoRoot, "circuits", "vk.json"), "utf8"));
  const networks = JSON.parse(await fs.readFile(path.join(repoRoot, "NETWORKS.json"), "utf8"));

  assert.equal(manifest.program.id, "2stas3cZYnBiWpndcTXQDGLXwfQ7kjEYYrW52DsUAcxF");
  assert.equal(manifest.program.id, idl.address);
  assert.equal(manifest.program.id, networks.canonicalProgramId);
  assert.match(rootLib, /declare_id!\("2stas3cZYnBiWpndcTXQDGLXwfQ7kjEYYrW52DsUAcxF"\);/);
  assert.match(anchorToml, /\[programs\.devnet\][\s\S]*?paradox = "2stas3cZYnBiWpndcTXQDGLXwfQ7kjEYYrW52DsUAcxF"/);
  assert.equal(manifest.groth16.n_public, vk.nPublic);
  assert.equal(manifest.groth16.vk_ic_count, vk.IC.length);
  assert.ok(idl.instructions.some((instruction) => instruction.name === "rotate_root_authority"));
  assert.ok(
    idl.instructions
      .find((instruction) => instruction.name === "update_root")
      ?.accounts.some((account) => account.name === "root_authority"),
  );

  for (const artifact of manifest.artifacts) {
    const fullPath = path.join(repoRoot, artifact.path);
    const bytes = await fs.readFile(fullPath);
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    assert.equal(sha256, artifact.sha256, `Hash mismatch for ${artifact.path}`);
    assert.equal(bytes.length, artifact.size, `Size mismatch for ${artifact.path}`);
  }
});
