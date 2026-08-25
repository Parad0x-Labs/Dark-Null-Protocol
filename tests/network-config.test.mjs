import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";

import {
  createConnectionForNetwork,
  getCanonicalArtifacts,
  getCanonicalManifest,
  getNetworkDefinition,
  listSupportedNetworks,
  resolveNetworkConfig,
} from "../sdk/index.mjs";

test("network helpers expose the canonical devnet and localnet config", () => {
  const networks = listSupportedNetworks();
  assert.deepEqual(
    networks.map((entry) => entry.key),
    ["devnet", "localnet"],
  );

  const devnet = resolveNetworkConfig("devnet");
  const localnet = resolveNetworkConfig("localnet");
  assert.equal(devnet.programId, localnet.programId);
  assert.equal(devnet.cluster, "devnet");
  assert.equal(localnet.rpcUrl, "http://127.0.0.1:8899");
  assert.equal(getNetworkDefinition("devnet")?.anchorCluster, "devnet");
  assert.equal(getNetworkDefinition("missing"), null);
  assert.throws(() => resolveNetworkConfig("mainnet"), /Unknown network/);
});

test("canonical artifacts and manifest stay aligned", () => {
  const manifest = getCanonicalManifest();
  const artifacts = getCanonicalArtifacts();

  assert.equal(manifest.program.id, "35GMe13ExGB1JGp1wZGrEvHfQnENKADroDQApeziKuwV");
  assert.ok(path.normalize(artifacts.manifestPath).endsWith("MANIFEST.json"));
  assert.ok(path.normalize(artifacts.zkeyPath).endsWith(path.normalize(manifest.groth16.zkey)));
  assert.ok(path.normalize(artifacts.wasmPath).endsWith(path.normalize(manifest.groth16.wasm)));
});

test("network-aware connection helper uses the selected rpc url", async () => {
  class MockConnection {
    constructor(url) {
      this.url = url;
    }
  }

  const connection = await createConnectionForNetwork("localnet", {
    Connection: MockConnection,
  });

  assert.equal(connection.url, "http://127.0.0.1:8899");
});

test("network-config CLI prints verifiable canonical config", () => {
  const output = execFileSync(
    process.execPath,
    ["./scripts/network-config.mjs", "--network", "devnet", "--json", "--check"],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
    },
  );

  const parsed = JSON.parse(output);
  assert.equal(parsed.network, "devnet");
  assert.equal(parsed.programId, "35GMe13ExGB1JGp1wZGrEvHfQnENKADroDQApeziKuwV");
  assert.ok(typeof parsed.vaultPda === "string");
  assert.ok(typeof parsed.rootAuthorityPda === "string");
  assert.equal(parsed.checks.length, 7);
});
