#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { validateSwarmConfig } from "../swarm/config.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.resolve(repoRoot, process.argv[2] ?? "config/swarm.open-beta.example.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const result = validateSwarmConfig(config);

if (!result.ok) {
  console.error(`Swarm config check failed for ${path.relative(repoRoot, configPath).split(path.sep).join("/")}:`);
  for (const failure of result.failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Swarm config check passed for ${path.relative(repoRoot, configPath).split(path.sep).join("/")}.`);
