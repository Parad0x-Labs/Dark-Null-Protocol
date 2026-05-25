export const SWARM_SCHEMA = "dark-null-swarm-open-beta-v1";
export const MAX_BETA_TVL_LAMPORTS = 100_000_000_000n;

export const REQUIRED_ROLES = [
  "indexer",
  "relayer",
  "prover",
  "monitor",
];

export const ALLOWED_ROLES = [
  ...REQUIRED_ROLES,
  "root_coordinator",
  "x402_adapter",
];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPort(value) {
  return Number.isInteger(value) && value > 0 && value < 65536;
}

function toBigIntOrNull(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }
  return null;
}

function requireBoolean(failures, value, path, expected) {
  if (value !== expected) {
    failures.push(`${path} must be ${expected}`);
  }
}

function validateCaps(config, failures) {
  const caps = config.beta?.caps;
  if (!isObject(caps)) {
    failures.push("beta.caps is required");
    return;
  }

  const tvl = toBigIntOrNull(caps.maxTotalValueLockedLamports);
  const deposit = toBigIntOrNull(caps.maxDepositLamports);
  const dailyWithdraw = toBigIntOrNull(caps.dailyWithdrawLimitLamports);

  if (tvl === null || tvl <= 0n || tvl > MAX_BETA_TVL_LAMPORTS) {
    failures.push("beta.caps.maxTotalValueLockedLamports must be > 0 and <= 100 SOL");
  }
  if (deposit === null || deposit <= 0n || (tvl !== null && deposit > tvl)) {
    failures.push("beta.caps.maxDepositLamports must be > 0 and <= beta TVL cap");
  }
  if (dailyWithdraw === null || dailyWithdraw <= 0n || (tvl !== null && dailyWithdraw > tvl)) {
    failures.push("beta.caps.dailyWithdrawLimitLamports must be > 0 and <= beta TVL cap");
  }
}

function validateService(service, index, failures) {
  const prefix = `services[${index}]`;
  if (!isObject(service)) {
    failures.push(`${prefix} must be an object`);
    return;
  }

  if (!/^[a-z][a-z0-9-]{1,47}$/.test(service.id ?? "")) {
    failures.push(`${prefix}.id must be a stable lowercase id`);
  }
  if (!ALLOWED_ROLES.includes(service.role)) {
    failures.push(`${prefix}.role must be one of ${ALLOWED_ROLES.join(", ")}`);
  }
  if (typeof service.enabled !== "boolean") {
    failures.push(`${prefix}.enabled must be boolean`);
  }
  if (typeof service.bindHost !== "string" || service.bindHost.length === 0) {
    failures.push(`${prefix}.bindHost is required`);
  }
  if (!isPort(service.port)) {
    failures.push(`${prefix}.port must be a valid TCP port`);
  }
  if (service.publicUrl !== undefined && typeof service.publicUrl !== "string") {
    failures.push(`${prefix}.publicUrl must be string when set`);
  }
  if (service.hotKeysAllowed !== false) {
    failures.push(`${prefix}.hotKeysAllowed must be false`);
  }
}

function validateRoles(config, failures) {
  if (!Array.isArray(config.services) || config.services.length === 0) {
    failures.push("services must contain the swarm service declarations");
    return;
  }

  const enabledRoles = new Set();
  config.services.forEach((service, index) => {
    validateService(service, index, failures);
    if (service?.enabled === true && ALLOWED_ROLES.includes(service.role)) {
      enabledRoles.add(service.role);
    }
  });

  for (const role of REQUIRED_ROLES) {
    if (!enabledRoles.has(role)) {
      failures.push(`required role ${role} must have at least one enabled service`);
    }
  }

  const rootCoordinator = config.services.find((service) => service.role === "root_coordinator");
  if (rootCoordinator && rootCoordinator.rootAuthorityOnServer !== false) {
    failures.push("root_coordinator.rootAuthorityOnServer must be false");
  }

  const x402Adapter = config.services.find((service) => service.role === "x402_adapter");
  if (x402Adapter?.enabled === true) {
    failures.push("x402_adapter must stay disabled until the dna-x402 integration evidence exists");
  }
}

function validateOperations(config, failures) {
  const operations = config.operations;
  if (!isObject(operations)) {
    failures.push("operations is required");
    return;
  }

  requireBoolean(failures, operations.directSubmissionSupported, "operations.directSubmissionSupported", true);
  requireBoolean(failures, operations.relayerOptional, "operations.relayerOptional", true);
  requireBoolean(failures, operations.killSwitchDocumented, "operations.killSwitchDocumented", true);

  for (const [field, expected] of [
    ["healthPath", "/health"],
    ["readyPath", "/ready"],
    ["metricsPath", "/metrics"],
  ]) {
    if (operations[field] !== expected) {
      failures.push(`operations.${field} must be ${expected}`);
    }
  }
}

function validateX402(config, failures) {
  const x402 = config.integrations?.x402;
  if (!isObject(x402)) {
    failures.push("integrations.x402 is required as an explicit future slot");
    return;
  }

  if (x402.status !== "planned-disabled") {
    failures.push("integrations.x402.status must be planned-disabled");
  }
  if (x402.enabled !== false) {
    failures.push("integrations.x402.enabled must be false until external evidence exists");
  }
  if (x402.requiresExternalRepo !== "dna-x402") {
    failures.push("integrations.x402.requiresExternalRepo must be dna-x402");
  }

  const receipts = x402.privateReceipts;
  if (!isObject(receipts)) {
    failures.push("integrations.x402.privateReceipts is required");
    return;
  }

  for (const [field, expected] of [
    ["adapterModule", "swarm/x402.mjs"],
    ["protocol", "x402-v2"],
    ["receiptSchema", "dark-null-private-x402-receipt-v1"],
  ]) {
    if (receipts[field] !== expected) {
      failures.push(`integrations.x402.privateReceipts.${field} must be ${expected}`);
    }
  }

  for (const [field, expected] of [
    ["rawBuyerMetadataAllowed", false],
    ["rawPaymentHeadersStored", false],
    ["replayProtectionRequired", true],
    ["settlementTxRequired", true],
    ["receiptHashChainRequired", true],
  ]) {
    requireBoolean(failures, receipts[field], `integrations.x402.privateReceipts.${field}`, expected);
  }

  const headers = receipts.requiredHeaders;
  const expectedHeaders = ["PAYMENT-REQUIRED", "PAYMENT-SIGNATURE", "PAYMENT-RESPONSE"];
  if (
    !Array.isArray(headers) ||
    headers.length !== expectedHeaders.length ||
    !expectedHeaders.every((header, index) => headers[index] === header)
  ) {
    failures.push("integrations.x402.privateReceipts.requiredHeaders must list the x402 V2 payment headers in order");
  }
}

export function validateSwarmConfig(config) {
  const failures = [];

  if (!isObject(config)) {
    return { ok: false, failures: ["config must be an object"] };
  }
  if (config.schema !== SWARM_SCHEMA) {
    failures.push(`schema must be ${SWARM_SCHEMA}`);
  }
  if (config.mode !== "open-beta") {
    failures.push("mode must be open-beta");
  }
  if (!["devnet", "mainnet-beta"].includes(config.network)) {
    failures.push("network must be devnet or mainnet-beta");
  }
  requireBoolean(failures, config.productionClaimsAllowed, "productionClaimsAllowed", false);

  validateCaps(config, failures);
  validateRoles(config, failures);
  validateOperations(config, failures);
  validateX402(config, failures);

  return {
    ok: failures.length === 0,
    failures,
  };
}

export function roleReadiness(config) {
  const roles = {};
  for (const role of ALLOWED_ROLES) {
    roles[role] = false;
  }

  for (const service of config.services ?? []) {
    if (service.enabled === true && ALLOWED_ROLES.includes(service.role)) {
      roles[service.role] = true;
    }
  }

  return roles;
}
