import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const releaseDir = path.join(repoRoot, "dist", "release");
export const checksumsPath = path.join(releaseDir, "SHA256SUMS");
export const sbomPath = path.join(releaseDir, "sbom.cdx.json");

export const releaseFiles = [
  "CEREMONY.md",
  "MAINNET_EVIDENCE.example.json",
  "MANIFEST.json",
  "NETWORKS.json",
  "package.json",
  "package-lock.json",
  "Anchor.toml",
  "Cargo.toml",
  "src/lib.rs",
  "src/verifying_key.rs",
  "scripts/cargo-test.mjs",
  "scripts/check-ceremony-evidence.mjs",
  "scripts/check-claims-evidence.mjs",
  "scripts/check-mainnet-evidence.mjs",
  "scripts/check-mainnet-readiness.mjs",
  "scripts/generate-verifying-key.mjs",
  "idl/paradox.json",
  "docs/CLAIMS_LEDGER.md",
  "circuits/null_proof.circom",
  "circuits/null_proof.r1cs",
  "circuits/null_proof.sym",
  "circuits/null_proof_final.zkey",
  "circuits/null_proof_js/generate_witness.js",
  "circuits/null_proof_js/null_proof.wasm",
  "circuits/null_proof_js/witness_calculator.js",
  "circuits/vk.json",
];

const textExtensions = new Set([
  ".circom",
  ".json",
  ".md",
  ".mjs",
  ".cjs",
  ".py",
  ".rs",
  ".sh",
  ".toml",
  ".ts",
  ".txt",
  ".yml",
  ".yaml",
]);

export function toRepoPath(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

export async function readStableBytes(filePath) {
  const bytes = await fs.readFile(filePath);
  if (!textExtensions.has(path.extname(filePath))) {
    return bytes;
  }

  return Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
}

export async function optionalReleaseOutputs() {
  const entries = [];
  for (const dir of [repoRoot, releaseDir]) {
    try {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isFile() && (entry.name.endsWith(".tgz") || entry.name === "sbom.cdx.json")) {
          entries.push(toRepoPath(fullPath));
        }
      }
    } catch {
      continue;
    }
  }
  return entries;
}
