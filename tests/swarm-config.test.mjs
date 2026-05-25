import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateSwarmConfig } from "../swarm/config.mjs";
import { createSwarmServer, prometheusMetrics, swarmStatus } from "../swarm/server.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const examplePath = path.join(repoRoot, "config", "swarm.open-beta.example.json");
const checkScript = path.join(repoRoot, "scripts", "check-swarm-config.mjs");

async function readExampleConfig() {
  return JSON.parse(await fs.readFile(examplePath, "utf8"));
}

function requestJson(port, pathName) {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: "127.0.0.1", port, path: pathName }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        resolve({ statusCode: response.statusCode, body });
      });
    });
    request.on("error", reject);
  });
}

test("open-beta swarm config is valid and keeps x402 disabled", async () => {
  const config = await readExampleConfig();
  const result = validateSwarmConfig(config);

  assert.deepEqual(result.failures, []);
  assert.equal(result.ok, true);
  assert.equal(config.integrations.x402.enabled, false);
  assert.equal(config.productionClaimsAllowed, false);
});

test("swarm config rejects hot keys and missing required roles", async () => {
  const config = await readExampleConfig();
  config.services = config.services.filter((service) => service.role !== "monitor");
  config.services[0].hotKeysAllowed = true;

  const result = validateSwarmConfig(config);
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes("required role monitor must have at least one enabled service"));
  assert.ok(result.failures.some((failure) => failure.includes("hotKeysAllowed must be false")));
});

test("swarm config rejects enabled x402 adapter until external evidence exists", async () => {
  const config = await readExampleConfig();
  const x402 = config.services.find((service) => service.role === "x402_adapter");
  x402.enabled = true;
  config.integrations.x402.enabled = true;

  const result = validateSwarmConfig(config);
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes("x402_adapter must stay disabled until the dna-x402 integration evidence exists"));
  assert.ok(result.failures.includes("integrations.x402.enabled must be false until external evidence exists"));
});

test("swarm health, readiness, and metrics endpoints expose operational state", async () => {
  const config = await readExampleConfig();
  const server = createSwarmServer(config, { now: () => new Date("2026-05-25T00:00:00.000Z") });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const { port } = server.address();
    const health = await requestJson(port, "/health");
    const ready = await requestJson(port, "/ready");
    const metrics = await requestJson(port, "/metrics");

    assert.equal(health.statusCode, 200);
    assert.equal(JSON.parse(health.body).status, "ok");
    assert.equal(ready.statusCode, 200);
    assert.equal(JSON.parse(ready.body).ready, true);
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.body, /dark_null_swarm_config_valid 1/);
    assert.match(metrics.body, /dark_null_swarm_role_enabled\{role="relayer"\} 1/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("swarm status and metrics fail closed for invalid config", async () => {
  const config = await readExampleConfig();
  config.productionClaimsAllowed = true;

  const status = swarmStatus(config, new Date("2026-05-25T00:00:00.000Z"));
  const metrics = prometheusMetrics(config, status);

  assert.equal(status.ready, false);
  assert.equal(status.validation.ok, false);
  assert.match(metrics, /dark_null_swarm_config_valid 0/);
});

test("swarm config CLI validates the example config", () => {
  const output = execFileSync(process.execPath, [checkScript], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.match(output, /Swarm config check passed/);
});
