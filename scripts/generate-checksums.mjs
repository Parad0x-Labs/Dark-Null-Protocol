#!/usr/bin/env node

import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  checksumsPath,
  optionalReleaseOutputs,
  readStableBytes,
  releaseDir,
  releaseFiles,
  repoRoot,
} from "./release-artifacts.mjs";

async function sha256(file) {
  const bytes = await readStableBytes(path.join(repoRoot, file));
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function main() {
  await fs.mkdir(releaseDir, { recursive: true });
  const files = [...releaseFiles, ...(await optionalReleaseOutputs())];
  const uniqueFiles = [...new Set(files)].filter((file) => file !== "dist/release/SHA256SUMS").sort();
  const lines = [];

  for (const file of uniqueFiles) {
    await fs.access(path.join(repoRoot, file));
    lines.push(`${await sha256(file)}  *${file}`);
  }

  await fs.writeFile(checksumsPath, `${lines.join("\n")}\n`, "utf8");
  console.log(`Wrote ${path.relative(repoRoot, checksumsPath).split(path.sep).join("/")} with ${lines.length} entries.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

