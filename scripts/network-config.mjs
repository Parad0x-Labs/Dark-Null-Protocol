#!/usr/bin/env node

import { accessSync, constants } from "node:fs";
import process from "node:process";

import {
  deriveCanonicalPdas,
  getCanonicalArtifacts,
  getCanonicalManifest,
  resolveNetworkConfig,
} from "../sdk/index.mjs";

function parseArgs(argv) {
  const args = {
    network: undefined,
    rpcUrl: undefined,
    walletPath: undefined,
    json: false,
    check: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--json") {
      args.json = true;
      continue;
    }
    if (value === "--check") {
      args.check = true;
      continue;
    }
    if (value === "--network") {
      args.network = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--rpc-url") {
      args.rpcUrl = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--wallet") {
      args.walletPath = argv[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${value}`);
  }

  return args;
}

function assertFileExists(filePath, label) {
  accessSync(filePath, constants.R_OK);
  return { label, filePath };
}

function verifyCanonicalSurface(config) {
  const manifest = getCanonicalManifest();
  const artifacts = getCanonicalArtifacts();

  if (config.programId !== manifest.program.id) {
    throw new Error(`Program ID mismatch: config=${config.programId} manifest=${manifest.program.id}`);
  }

  return [
    assertFileExists(artifacts.anchorTomlPath, "Anchor.toml"),
    assertFileExists(artifacts.manifestPath, "MANIFEST.json"),
    assertFileExists(artifacts.idlPath, "idl/paradox.json"),
    assertFileExists(artifacts.circuitPath, manifest.groth16.circuit),
    assertFileExists(artifacts.zkeyPath, manifest.groth16.zkey),
    assertFileExists(artifacts.wasmPath, manifest.groth16.wasm),
    assertFileExists(artifacts.vkJsonPath, manifest.groth16.vk_json),
  ];
}

function printHuman(config, checks) {
  console.log("Dark Null canonical network config");
  console.log(`network: ${config.network}`);
  console.log(`cluster: ${config.cluster}`);
  console.log(`anchor cluster: ${config.anchorCluster}`);
  console.log(`program id: ${config.programId}`);
  console.log(`vault pda: ${config.vaultPda}`);
  console.log(`root authority pda: ${config.rootAuthorityPda}`);
  console.log(`rpc url: ${config.rpcUrl}`);
  console.log(`wallet path: ${config.walletPath ?? "(not set)"}`);
  if (checks) {
    console.log(`verified files: ${checks.length}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseConfig = resolveNetworkConfig({
    network: args.network,
    rpcUrl: args.rpcUrl,
    walletPath: args.walletPath,
  });
  const pdas = await deriveCanonicalPdas({ programId: baseConfig.programId });
  const config = {
    ...baseConfig,
    vaultPda: pdas.vaultPda,
    rootAuthorityPda: pdas.rootAuthorityPda,
  };

  const checks = args.check ? verifyCanonicalSurface(config) : null;

  if (args.json) {
    console.log(JSON.stringify({ ...config, checks }, null, 2));
    return;
  }

  printHuman(config, checks);
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
