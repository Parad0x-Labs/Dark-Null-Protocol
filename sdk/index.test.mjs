import test from "node:test";
import assert from "node:assert/strict";

import {
  bytes32ToHex,
  createAnchorProgram,
  createConnection,
  deriveCanonicalPdas,
  getCanonicalArtifacts,
  getCanonicalManifest,
  findProgramIdEntry,
  getIdl,
  getInstructionDefinition,
  getProgramIdManifest,
  getNetworkDefinition,
  hexToBytes32,
  listInstructionNames,
  listSupportedNetworks,
  normalizeBytes32,
  resolveNetworkConfig,
  resolveProgramId,
} from "./index.mjs";

test("IDL helpers expose published instruction metadata", () => {
  const idl = getIdl();
  assert.equal(idl.metadata.name, "paradox");
  assert.ok(listInstructionNames().includes("prepare_phantom_withdraw"));
  assert.ok(listInstructionNames().includes("rotate_root_authority"));

  const instruction = getInstructionDefinition("prepare_phantom_withdraw");
  assert.equal(instruction.name, "prepare_phantom_withdraw");
  assert.ok(Array.isArray(instruction.accounts));

  const initialize = getInstructionDefinition("initialize");
  const updateRoot = getInstructionDefinition("update_root");
  assert.ok(initialize.accounts.some((account) => account.name === "root_authority"));
  assert.ok(updateRoot.accounts.some((account) => account.name === "root_authority"));
  assert.ok(updateRoot.accounts.some((account) => account.name === "authority"));
});

test("program manifest resolves known keys and preserves historical references", () => {
  const manifest = getProgramIdManifest();
  assert.ok(manifest.length >= 5);

  assert.equal(
    resolveProgramId("canonicalDevnet"),
    "2stas3cZYnBiWpndcTXQDGLXwfQ7kjEYYrW52DsUAcxF",
  );

  const entry = findProgramIdEntry("3hYWUSYmNCzrHNgsE6xo3jKT9GjCFxCpPWXj4Q4imToz");
  assert.equal(entry?.key, "pythonClientSnapshot");
});

test("canonical manifest and network helpers expose one coherent root", () => {
  const manifest = getCanonicalManifest();
  const artifacts = getCanonicalArtifacts();
  const networks = listSupportedNetworks();

  assert.equal(manifest.program.id, "2stas3cZYnBiWpndcTXQDGLXwfQ7kjEYYrW52DsUAcxF");
  assert.equal(networks.length, 2);
  assert.equal(getNetworkDefinition("devnet")?.rpcUrl, "https://api.devnet.solana.com");
  assert.equal(resolveNetworkConfig("localnet").rpcUrl, "http://127.0.0.1:8899");
  assert.ok(artifacts.circuitPath.endsWith("/circuits/null_proof.circom"));
});

test("bytes32 helpers normalize arrays and hex strings", () => {
  const bytes = Array.from({ length: 32 }, (_, index) => index);
  const hex = bytes32ToHex(bytes);
  assert.equal(hex.length, 66);
  assert.deepEqual(hexToBytes32(hex), bytes);
  assert.deepEqual(normalizeBytes32(Uint8Array.from(bytes)), bytes);
});

test("anchor helper works with injected modules", async () => {
  class MockPublicKey {
    constructor(value) {
      this.value = value;
    }

    toBase58() {
      return this.value;
    }
  }

  class MockProgram {
    constructor(idl, programId, provider) {
      this.idl = idl;
      this.programId = programId;
      this.provider = provider;
    }
  }

  const provider = { label: "mock-provider" };
  const program = await createAnchorProgram({
    provider,
    manifestKey: "canonicalDevnet",
    anchor: {
      Program: MockProgram,
      web3: { PublicKey: MockPublicKey },
    },
  });

  assert.equal(program.provider, provider);
  assert.equal(program.programId.toBase58(), "2stas3cZYnBiWpndcTXQDGLXwfQ7kjEYYrW52DsUAcxF");
});

test("connection helper works with injected web3 module", async () => {
  class MockConnection {
    constructor(url) {
      this.url = url;
    }
  }

  const connection = await createConnection("https://api.devnet.solana.com", {
    Connection: MockConnection,
  });

  assert.equal(connection.url, "https://api.devnet.solana.com");
});

test("canonical PDA helper derives the vault and root-authority addresses", async () => {
  class MockPublicKey {
    constructor(value) {
      this.value = value;
    }

    toBase58() {
      return this.value;
    }

    static findProgramAddressSync(seeds, programKey) {
      const tag = Buffer.concat(seeds).toString("utf8");
      return [new MockPublicKey(`${programKey.toBase58()}:${tag}`), 255];
    }
  }

  const pdas = await deriveCanonicalPdas({
    manifestKey: "canonicalDevnet",
    web3: { PublicKey: MockPublicKey },
  });

  assert.equal(pdas.programId, "2stas3cZYnBiWpndcTXQDGLXwfQ7kjEYYrW52DsUAcxF");
  assert.equal(pdas.vaultPda, "2stas3cZYnBiWpndcTXQDGLXwfQ7kjEYYrW52DsUAcxF:merkle_vault");
  assert.equal(pdas.rootAuthorityPda, "2stas3cZYnBiWpndcTXQDGLXwfQ7kjEYYrW52DsUAcxF:root_authority");
});
