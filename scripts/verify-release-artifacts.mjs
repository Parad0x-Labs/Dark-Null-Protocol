#!/usr/bin/env node

import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  checksumsPath,
  readStableBytes,
  releaseFiles,
  repoRoot,
} from "./release-artifacts.mjs";

async function sha256(file) {
  const bytes = await readStableBytes(path.join(repoRoot, file));
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function verifyManifest() {
  const manifest = JSON.parse(await fs.readFile(path.join(repoRoot, "MANIFEST.json"), "utf8"));
  const failures = [];

  for (const artifact of manifest.artifacts ?? []) {
    const fullPath = path.join(repoRoot, artifact.path);
    const stableBytes = await readStableBytes(fullPath);
    const digest = crypto.createHash("sha256").update(stableBytes).digest("hex");

    if (digest !== artifact.sha256) {
      failures.push(`${artifact.path}: expected sha256 ${artifact.sha256}, got ${digest}`);
    }
    if (stableBytes.length !== artifact.size) {
      failures.push(`${artifact.path}: expected size ${artifact.size}, got ${stableBytes.length}`);
    }
  }

  return failures;
}

async function verifyRequiredReleaseFiles() {
  const failures = [];
  for (const file of releaseFiles) {
    try {
      await fs.access(path.join(repoRoot, file));
    } catch {
      failures.push(`${file}: missing release input`);
    }
  }
  return failures;
}

async function verifyChecksumsFileIfPresent() {
  try {
    await fs.access(checksumsPath);
  } catch {
    return [];
  }

  const failures = [];
  const content = await fs.readFile(checksumsPath, "utf8");
  for (const line of content.split(/\r?\n/).filter(Boolean)) {
    const match = /^([a-f0-9]{64})  \*(.+)$/.exec(line);
    if (!match) {
      failures.push(`SHA256SUMS: malformed line "${line}"`);
      continue;
    }

    const [, expected, file] = match;
    const fullPath = path.join(repoRoot, file);
    try {
      await fs.access(fullPath);
    } catch {
      failures.push(`${file}: checksum target missing`);
      continue;
    }

    const actual = await sha256(file);
    if (actual !== expected) {
      failures.push(`${file}: checksum file expected ${expected}, got ${actual}`);
    }
  }
  return failures;
}

async function main() {
  const failures = [
    ...(await verifyRequiredReleaseFiles()),
    ...(await verifyManifest()),
    ...(await verifyChecksumsFileIfPresent()),
  ];

  if (failures.length > 0) {
    console.error("Release artifact verification failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Release artifact verification passed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
