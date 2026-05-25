#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
      execFileSync(command, [...prefixArgs, "-m", "pytest", "--version"], { stdio: "ignore" });
      return [command, prefixArgs];
    } catch {
      continue;
    }
  }

  throw new Error("No Python interpreter with pytest found. Install pytest or run the suite with the interpreter that has it.");
}

function main() {
  const [command, prefixArgs] = resolvePython();
  execFileSync(command, [...prefixArgs, "-m", "pytest", "client/test_dark_protocol.py"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
