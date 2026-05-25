import http from "node:http";

import { roleReadiness, validateSwarmConfig } from "./config.mjs";

function jsonResponse(response, statusCode, body) {
  const payload = `${JSON.stringify(body, null, 2)}\n`;
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(payload);
}

function textResponse(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "text/plain; version=0.0.4; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(body);
}

export function swarmStatus(config, now = new Date()) {
  const validation = validateSwarmConfig(config);
  const roles = roleReadiness(config);
  const requiredReady = ["indexer", "relayer", "prover", "monitor"].every((role) => roles[role]);

  return {
    schema: "dark-null-swarm-status-v1",
    checkedAt: now.toISOString(),
    mode: config.mode,
    network: config.network,
    healthy: true,
    ready: validation.ok && requiredReady,
    validation,
    roles,
  };
}

export function prometheusMetrics(config, status = swarmStatus(config)) {
  const lines = [
    "# HELP dark_null_swarm_config_valid 1 when the loaded swarm config passes validation.",
    "# TYPE dark_null_swarm_config_valid gauge",
    `dark_null_swarm_config_valid ${status.validation.ok ? 1 : 0}`,
    "# HELP dark_null_swarm_ready 1 when the required open-beta roles are ready.",
    "# TYPE dark_null_swarm_ready gauge",
    `dark_null_swarm_ready ${status.ready ? 1 : 0}`,
    "# HELP dark_null_swarm_role_enabled Enabled service role presence.",
    "# TYPE dark_null_swarm_role_enabled gauge",
  ];

  for (const [role, ready] of Object.entries(status.roles)) {
    lines.push(`dark_null_swarm_role_enabled{role="${role}"} ${ready ? 1 : 0}`);
  }

  const caps = config.beta?.caps ?? {};
  for (const [name, value] of Object.entries(caps)) {
    if (/^\d+$/.test(String(value))) {
      lines.push(`dark_null_swarm_beta_cap_lamports{cap="${name}"} ${value}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function createSwarmServer(config, options = {}) {
  const healthPath = config.operations?.healthPath ?? "/health";
  const readyPath = config.operations?.readyPath ?? "/ready";
  const metricsPath = config.operations?.metricsPath ?? "/metrics";
  const now = options.now ?? (() => new Date());

  return http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const status = swarmStatus(config, now());

    if (url.pathname === healthPath) {
      jsonResponse(response, 200, {
        status: "ok",
        checkedAt: status.checkedAt,
        network: status.network,
      });
      return;
    }

    if (url.pathname === readyPath) {
      jsonResponse(response, status.ready ? 200 : 503, status);
      return;
    }

    if (url.pathname === metricsPath) {
      textResponse(response, 200, prometheusMetrics(config, status));
      return;
    }

    jsonResponse(response, 404, { error: "not found" });
  });
}
