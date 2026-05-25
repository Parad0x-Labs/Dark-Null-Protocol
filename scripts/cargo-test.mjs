#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function commandCandidates(command) {
  if (process.platform === "win32") {
    return [command.endsWith(".exe") ? command : `${command}.exe`, command];
  }
  return [command];
}

function pathEntries() {
  return (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toolchainCargoCandidates() {
  if (process.platform !== "win32" || !process.env.USERPROFILE) {
    return [];
  }

  const toolchainsDir = path.join(process.env.USERPROFILE, ".rustup", "toolchains");
  if (!existsSync(toolchainsDir)) {
    return [];
  }

  return readdirSync(toolchainsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(toolchainsDir, entry.name, "bin", "cargo.exe"));
}

function driveCargoHome() {
  if (process.platform !== "win32") {
    return "";
  }

  const candidate = path.join(path.parse(repoRoot).root, "cargo_home");
  return existsSync(candidate) ? candidate : "";
}

function resolveCargo() {
  const configured = process.env.CARGO;
  if (configured && existsSync(configured)) {
    return configured;
  }

  for (const entry of pathEntries()) {
    for (const command of commandCandidates("cargo")) {
      const candidate = path.join(entry, command);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  const cargoHome = process.env.CARGO_HOME;
  if (cargoHome) {
    const candidate = path.join(cargoHome, "bin", process.platform === "win32" ? "cargo.exe" : "cargo");
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const driveHome = driveCargoHome();
  if (driveHome) {
    const candidate = path.join(driveHome, "bin", "cargo.exe");
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  for (const candidate of toolchainCargoCandidates()) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return "cargo";
}

const cargo = resolveCargo();
const cargoDir = path.dirname(cargo);
const fallbackCargoHome = process.env.CARGO_HOME || driveCargoHome();
const env = {
  ...process.env,
  ...(fallbackCargoHome ? { CARGO_HOME: fallbackCargoHome } : {}),
  PATH: `${cargoDir}${path.delimiter}${process.env.PATH ?? ""}`,
};

const result = spawnSync(cargo, ["test", "--offline"], {
  env,
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
