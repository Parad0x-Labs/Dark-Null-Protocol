#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientDir = path.join(repoRoot, "client");

const candidates = process.platform === "win32"
  ? [
      ["py", ["-3"]],
      ["python", []],
      ["python3", []],
    ]
  : [
      ["python3", []],
      ["python", []],
    ];

function resolvePython() {
  for (const [command, prefixArgs] of candidates) {
    try {
      execFileSync(command, [...prefixArgs, "--version"], { stdio: "ignore" });
      return [command, prefixArgs];
    } catch {
      continue;
    }
  }

  throw new Error("No Python interpreter found. Expected python3, python, or py -3.");
}

async function main() {
  const pyFiles = (await fs.readdir(clientDir))
    .filter((entry) => entry.endsWith(".py"))
    .map((entry) => path.join(clientDir, entry));

  if (pyFiles.length === 0) {
    throw new Error("No Python files found under client/.");
  }

  const [command, prefixArgs] = resolvePython();
  execFileSync(command, [...prefixArgs, "-m", "py_compile", ...pyFiles], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      PYTHONPYCACHEPREFIX: path.join(os.tmpdir(), "pycache_darknull"),
    },
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
