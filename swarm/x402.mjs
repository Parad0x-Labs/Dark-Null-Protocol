import crypto from "node:crypto";

export const X402_PROTOCOL = "x402-v2";
export const X402_HEADERS = Object.freeze({
  paymentRequired: "PAYMENT-REQUIRED",
  paymentSignature: "PAYMENT-SIGNATURE",
  paymentResponse: "PAYMENT-RESPONSE",
});

export const PRIVATE_X402_INTENT_SCHEMA = "dark-null-private-x402-intent-v1";
export const PRIVATE_X402_REQUEST_BINDING_SCHEMA = "dark-null-private-x402-request-binding-v1";
export const PRIVATE_X402_RECEIPT_SCHEMA = "dark-null-private-x402-receipt-v1";
export const EMPTY_BODY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const HASH_RE = /^[0-9a-f]{64}$/;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,96}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const SAFE_NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/;
const SAFE_RESOURCE_RE = /^[a-z0-9][a-z0-9:._/-]{1,127}$/;
const SAFE_IDENTIFIER_RE = /^[A-Za-z0-9:._+/@-]{1,160}$/;
const SUPPORTED_STATUS = new Set(["settled", "rejected"]);
const SUPPORTED_CONFIRMATION = new Set(["processed", "confirmed", "finalized"]);
const SUPPORTED_CLUSTER = new Set(["devnet", "localnet", "mainnet-beta"]);
const SENSITIVE_PATTERNS = [
  { label: "email address", regex: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i },
  { label: "phone number", regex: /\b(?:\+?\d[\d\s().-]{7,}\d)\b/ },
  { label: "query string", regex: /[?#][A-Za-z0-9_.~=&%+-]+/ },
  { label: "bearer token", regex: /\bbearer\s+[A-Za-z0-9._~+/=-]{16,}/i },
  { label: "api key", regex: /\b(?:api[_-]?key|secret|token)[=:][A-Za-z0-9._~+/=-]{8,}/i },
  { label: "private key", regex: /BEGIN [A-Z ]*PRIVATE KEY/ },
];

function fail(message) {
  throw new Error(message);
}

function assertObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
}

function canonicalValue(value) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalValue(entry)]),
    );
  }

  fail("canonical JSON cannot encode undefined, functions, or symbols");
}

export function canonicalJsonString(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256Hex(value) {
  const bytes = Buffer.isBuffer(value)
    ? value
    : typeof value === "string"
      ? Buffer.from(value, "utf8")
      : Buffer.from(canonicalJsonString(value), "utf8");
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function encodeBase64Json(value) {
  return Buffer.from(canonicalJsonString(value), "utf8").toString("base64");
}

export function decodeBase64Json(value) {
  if (typeof value !== "string" || value.length === 0 || value.length % 4 !== 0 || !BASE64_RE.test(value)) {
    fail("x402 header must be a non-empty Base64 JSON string");
  }

  const decoded = Buffer.from(value, "base64").toString("utf8");
  try {
    return JSON.parse(decoded);
  } catch {
    fail("x402 header does not contain valid JSON");
  }
}

function normalizeHash(value, label) {
  if (typeof value !== "string" || !HASH_RE.test(value)) {
    fail(`${label} must be a lowercase sha256 hex digest`);
  }
  return value;
}

function normalizeCommit(value) {
  if (typeof value !== "string" || !COMMIT_RE.test(value)) {
    fail("repository.commit must be a full 40-character lowercase git commit hash");
  }
  return value;
}

function normalizeAtomicAmount(value, label = "amount") {
  const parsed =
    typeof value === "bigint"
      ? value
      : typeof value === "number" && Number.isSafeInteger(value)
        ? BigInt(value)
        : typeof value === "string" && /^\d+$/.test(value)
          ? BigInt(value)
          : null;

  if (parsed === null || parsed <= 0n) {
    fail(`${label} must be a positive atomic-unit integer`);
  }
  return parsed.toString();
}

function normalizeMethod(value) {
  const method = String(value ?? "GET").toUpperCase();
  if (!/^[A-Z]{3,12}$/.test(method)) {
    fail("method must be an uppercase HTTP method");
  }
  return method;
}

function assertNoSensitiveMetadata(value, label) {
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.regex.test(value)) {
      fail(`${label} contains ${pattern.label}; use an opaque alias and hash the raw value outside the receipt`);
    }
  }
}

function normalizeResourceAlias(value) {
  if (typeof value !== "string" || !SAFE_RESOURCE_RE.test(value)) {
    fail("resource must be an opaque lowercase alias, not a raw URL or user-specific string");
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    fail("resource must not be a raw URL");
  }
  assertNoSensitiveMetadata(value, "resource");
  return value;
}

function normalizeDescription(value) {
  const description = String(value ?? "dark-null-private-x402-payment");
  if (description.length < 3 || description.length > 120) {
    fail("description must be 3-120 characters");
  }
  assertNoSensitiveMetadata(description, "description");
  return description;
}

function normalizeIdentifier(value, label) {
  if (typeof value !== "string" || !SAFE_IDENTIFIER_RE.test(value)) {
    fail(`${label} must be a stable protocol identifier`);
  }
  return value;
}

function normalizeNonce(value) {
  if (typeof value !== "string" || !SAFE_NONCE_RE.test(value)) {
    fail("nonce must be a 16-128 character URL-safe nonce");
  }
  return value;
}

function normalizeIsoDate(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail(`${label} must be an ISO-8601 UTC timestamp`);
  }
  return value;
}

function normalizeSettlementProfile(settlement) {
  assertObject(settlement, "settlement");
  const cluster = normalizeIdentifier(settlement.cluster, "settlement.cluster");
  if (!SUPPORTED_CLUSTER.has(cluster)) {
    fail("settlement.cluster must be devnet, localnet, or mainnet-beta");
  }

  const normalized = {
    mode: normalizeIdentifier(settlement.mode ?? "dark-null-withdraw-v2", "settlement.mode"),
    cluster,
    programId: normalizeIdentifier(settlement.programId, "settlement.programId"),
    manifestLabel: normalizeIdentifier(settlement.manifestLabel, "settlement.manifestLabel"),
  };

  if (settlement.amountLamports !== undefined) {
    normalized.amountLamports = normalizeAtomicAmount(settlement.amountLamports, "settlement.amountLamports");
  }
  for (const field of ["receiverTokenAccountHash", "mintHash", "proofEncodingHash"]) {
    if (settlement[field] !== undefined) {
      normalized[field] = normalizeHash(settlement[field], `settlement.${field}`);
    }
  }

  return normalized;
}

export function createPrivateX402Intent(input) {
  assertObject(input, "input");
  const resource = normalizeResourceAlias(input.resource);
  const settlement = normalizeSettlementProfile(input.settlement);
  const base = {
    schema: PRIVATE_X402_INTENT_SCHEMA,
    protocol: X402_PROTOCOL,
    scheme: "exact",
    method: normalizeMethod(input.method),
    resource,
    resourceHash: sha256Hex(resource),
    description: normalizeDescription(input.description),
    nonce: normalizeNonce(input.nonce),
    expiresAt: normalizeIsoDate(input.expiresAt, "expiresAt"),
    payment: {
      maxAmountRequired: normalizeAtomicAmount(input.maxAmountRequired, "maxAmountRequired"),
      asset: normalizeIdentifier(input.asset, "asset"),
      network: normalizeIdentifier(input.network, "network"),
      payTo: normalizeIdentifier(input.payTo, "payTo"),
    },
    settlement,
    privacy: {
      rawBuyerMetadataAllowed: false,
      rawBuyerMetadataStored: false,
      resourceIsOpaqueAlias: true,
      paymentHeadersStored: false,
    },
  };

  return {
    ...base,
    intentHash: sha256Hex(base),
  };
}

export function createPaymentRequiredHeader(intent) {
  assertObject(intent, "intent");
  if (intent.schema !== PRIVATE_X402_INTENT_SCHEMA || !intent.intentHash) {
    fail("intent must be created by createPrivateX402Intent");
  }

  const payload = {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: intent.payment.network,
        maxAmountRequired: intent.payment.maxAmountRequired,
        resource: intent.resource,
        description: intent.description,
        payTo: intent.payment.payTo,
        asset: intent.payment.asset,
        extra: {
          darkNull: {
            schema: PRIVATE_X402_INTENT_SCHEMA,
            protocol: X402_PROTOCOL,
            intentHash: intent.intentHash,
            resourceHash: intent.resourceHash,
            receiptSchema: PRIVATE_X402_RECEIPT_SCHEMA,
            cluster: intent.settlement.cluster,
            programId: intent.settlement.programId,
            manifestLabel: intent.settlement.manifestLabel,
            rawBuyerMetadataAllowed: false,
          },
        },
      },
    ],
  };

  return {
    name: X402_HEADERS.paymentRequired,
    value: encodeBase64Json(payload),
    payload,
  };
}

function hashHeader(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${label} must be a non-empty header value`);
  }
  return sha256Hex(value);
}

export function createPrivateX402RequestBinding(input) {
  assertObject(input, "input");
  const intentHash = normalizeHash(input.intentHash ?? input.intent?.intentHash, "intentHash");
  const paymentRequiredHash = hashHeader(input.paymentRequiredHeader, X402_HEADERS.paymentRequired);
  const paymentSignatureHash = hashHeader(input.paymentSignatureHeader, X402_HEADERS.paymentSignature);
  const bodyHash = normalizeHash(input.bodyHash ?? EMPTY_BODY_SHA256, "bodyHash");
  const resource = normalizeResourceAlias(input.resource ?? input.intent?.resource);
  const base = {
    schema: PRIVATE_X402_REQUEST_BINDING_SCHEMA,
    protocol: X402_PROTOCOL,
    intentHash,
    method: normalizeMethod(input.method ?? input.intent?.method),
    resourceHash: sha256Hex(resource),
    bodyHash,
    paymentRequiredHash,
    paymentSignatureHash,
  };

  return {
    ...base,
    replayKey: sha256Hex(base),
  };
}

function normalizeReceiptSettlement(settlement, status) {
  assertObject(settlement, "settlement");
  const normalized = {
    cluster: normalizeIdentifier(settlement.cluster, "settlement.cluster"),
    programId: normalizeIdentifier(settlement.programId, "settlement.programId"),
  };

  if (!SUPPORTED_CLUSTER.has(normalized.cluster)) {
    fail("settlement.cluster must be devnet, localnet, or mainnet-beta");
  }

  if (status === "settled") {
    if (typeof settlement.signature !== "string" || !BASE58_RE.test(settlement.signature)) {
      fail("settled receipt requires a Solana transaction signature");
    }
    if (!Number.isSafeInteger(settlement.slot) || settlement.slot <= 0) {
      fail("settled receipt requires a positive slot");
    }
    if (!SUPPORTED_CONFIRMATION.has(settlement.confirmationStatus)) {
      fail("settled receipt requires a Solana confirmation status");
    }
    normalized.signature = settlement.signature;
    normalized.slot = settlement.slot;
    normalized.confirmationStatus = settlement.confirmationStatus;
  }

  if (settlement.explorerUrl !== undefined) {
    normalized.explorerUrl = normalizeIdentifier(settlement.explorerUrl, "settlement.explorerUrl");
  }

  return normalized;
}

function normalizeProofLock(proof) {
  assertObject(proof, "proof");
  return {
    proofBundleHash: normalizeHash(proof.proofBundleHash, "proof.proofBundleHash"),
    publicInputHash: normalizeHash(proof.publicInputHash, "proof.publicInputHash"),
    proofEncodingHash: normalizeHash(proof.proofEncodingHash, "proof.proofEncodingHash"),
  };
}

function normalizeRepositoryLock(repository) {
  assertObject(repository, "repository");
  const normalized = {
    commit: normalizeCommit(repository.commit),
    manifestSha256: normalizeHash(repository.manifestSha256, "repository.manifestSha256"),
  };

  if (repository.releaseChecksumsSha256 !== undefined) {
    normalized.releaseChecksumsSha256 = normalizeHash(
      repository.releaseChecksumsSha256,
      "repository.releaseChecksumsSha256",
    );
  }

  return normalized;
}

export function createPrivateX402Receipt(input) {
  assertObject(input, "input");
  const status = input.status ?? "settled";
  if (!SUPPORTED_STATUS.has(status)) {
    fail("status must be settled or rejected");
  }

  const requestBinding = input.requestBinding;
  assertObject(requestBinding, "requestBinding");

  const base = {
    schema: PRIVATE_X402_RECEIPT_SCHEMA,
    protocol: X402_PROTOCOL,
    status,
    observedAt: normalizeIsoDate(input.observedAt, "observedAt"),
    intentHash: normalizeHash(input.intentHash ?? requestBinding.intentHash, "intentHash"),
    replayKey: normalizeHash(requestBinding.replayKey, "requestBinding.replayKey"),
    x402: {
      paymentRequiredHash: normalizeHash(requestBinding.paymentRequiredHash, "requestBinding.paymentRequiredHash"),
      paymentSignatureHash: normalizeHash(requestBinding.paymentSignatureHash, "requestBinding.paymentSignatureHash"),
      paymentResponseHash: hashHeader(input.paymentResponseHeader, X402_HEADERS.paymentResponse),
      rawHeadersStored: false,
      requiredHeaders: [
        X402_HEADERS.paymentRequired,
        X402_HEADERS.paymentSignature,
        X402_HEADERS.paymentResponse,
      ],
    },
    request: {
      method: normalizeMethod(requestBinding.method),
      resourceHash: normalizeHash(requestBinding.resourceHash, "requestBinding.resourceHash"),
      bodyHash: normalizeHash(requestBinding.bodyHash, "requestBinding.bodyHash"),
    },
    response: {
      statusCode: Number.isInteger(input.response?.statusCode) ? input.response.statusCode : 200,
      bodyHash: normalizeHash(input.response?.bodyHash ?? EMPTY_BODY_SHA256, "response.bodyHash"),
    },
    privacy: {
      rawBuyerMetadataStored: false,
      rawPaymentHeadersStored: false,
      resourceIsHashed: true,
    },
    settlement: normalizeReceiptSettlement(input.settlement, status),
    proof: normalizeProofLock(input.proof),
    repository: normalizeRepositoryLock(input.repository),
    lock: {
      previousReceiptHash: input.previousReceiptHash === null || input.previousReceiptHash === undefined
        ? null
        : normalizeHash(input.previousReceiptHash, "previousReceiptHash"),
    },
  };

  return {
    ...base,
    lock: {
      ...base.lock,
      receiptHash: sha256Hex(base),
    },
  };
}

function receiptWithoutHash(receipt) {
  const clone = canonicalValue(receipt);
  if (!clone.lock || typeof clone.lock !== "object") {
    return clone;
  }
  const { receiptHash, ...lockWithoutHash } = clone.lock;
  return {
    ...clone,
    lock: lockWithoutHash,
  };
}

export function verifyPrivateX402Receipt(receipt, options = {}) {
  const failures = [];

  try {
    assertObject(receipt, "receipt");
    if (receipt.schema !== PRIVATE_X402_RECEIPT_SCHEMA) {
      failures.push(`schema must be ${PRIVATE_X402_RECEIPT_SCHEMA}`);
    }
    if (receipt.protocol !== X402_PROTOCOL) {
      failures.push(`protocol must be ${X402_PROTOCOL}`);
    }
    if (!SUPPORTED_STATUS.has(receipt.status)) {
      failures.push("status must be settled or rejected");
    }
    if (receipt.privacy?.rawBuyerMetadataStored !== false) {
      failures.push("privacy.rawBuyerMetadataStored must be false");
    }
    if (receipt.privacy?.rawPaymentHeadersStored !== false) {
      failures.push("privacy.rawPaymentHeadersStored must be false");
    }
    if (receipt.x402?.rawHeadersStored !== false) {
      failures.push("x402.rawHeadersStored must be false");
    }

    const expectedReceiptHash = sha256Hex(receiptWithoutHash(receipt));
    if (receipt.lock?.receiptHash !== expectedReceiptHash) {
      failures.push("receipt hash does not match canonical receipt body");
    }

    if (
      options.expectedPreviousReceiptHash !== undefined &&
      receipt.lock?.previousReceiptHash !== options.expectedPreviousReceiptHash
    ) {
      failures.push("previous receipt hash mismatch");
    }

    if (receipt.status === "settled") {
      if (!receipt.settlement?.signature || !BASE58_RE.test(receipt.settlement.signature)) {
        failures.push("settled receipt must include a Solana transaction signature");
      }
      if (!Number.isSafeInteger(receipt.settlement?.slot) || receipt.settlement.slot <= 0) {
        failures.push("settled receipt must include a positive Solana slot");
      }
      if (!SUPPORTED_CONFIRMATION.has(receipt.settlement?.confirmationStatus)) {
        failures.push("settled receipt must include a supported confirmation status");
      }
    }

    for (const [label, value] of [
      ["intentHash", receipt.intentHash],
      ["replayKey", receipt.replayKey],
      ["x402.paymentRequiredHash", receipt.x402?.paymentRequiredHash],
      ["x402.paymentSignatureHash", receipt.x402?.paymentSignatureHash],
      ["x402.paymentResponseHash", receipt.x402?.paymentResponseHash],
      ["request.bodyHash", receipt.request?.bodyHash],
      ["request.resourceHash", receipt.request?.resourceHash],
      ["response.bodyHash", receipt.response?.bodyHash],
      ["proof.proofBundleHash", receipt.proof?.proofBundleHash],
      ["proof.publicInputHash", receipt.proof?.publicInputHash],
      ["proof.proofEncodingHash", receipt.proof?.proofEncodingHash],
      ["repository.manifestSha256", receipt.repository?.manifestSha256],
    ]) {
      if (typeof value !== "string" || !HASH_RE.test(value)) {
        failures.push(`${label} must be a lowercase sha256 hex digest`);
      }
    }

    if (typeof receipt.repository?.commit !== "string" || !COMMIT_RE.test(receipt.repository.commit)) {
      failures.push("repository.commit must be a full 40-character lowercase git commit hash");
    }

    return {
      ok: failures.length === 0,
      failures,
      expectedReceiptHash,
      receiptHash: receipt.lock?.receiptHash ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      failures: [error.message],
      expectedReceiptHash: null,
      receiptHash: receipt?.lock?.receiptHash ?? null,
    };
  }
}

export async function verifyPrivateX402ReceiptOnSolana(receipt, connection, options = {}) {
  const local = verifyPrivateX402Receipt(receipt, options);
  const failures = [...local.failures];

  if (!connection || typeof connection.getSignatureStatuses !== "function") {
    failures.push("connection must expose getSignatureStatuses");
    return { ok: false, failures, signatureStatus: null };
  }

  if (receipt.status !== "settled") {
    return { ok: failures.length === 0, failures, signatureStatus: null };
  }

  const response = await connection.getSignatureStatuses([receipt.settlement.signature], {
    searchTransactionHistory: true,
  });
  const signatureStatus = response?.value?.[0] ?? null;

  if (!signatureStatus) {
    failures.push("Solana signature was not found");
  } else {
    if (signatureStatus.err !== null) {
      failures.push("Solana transaction has an error status");
    }
    if (signatureStatus.slot !== receipt.settlement.slot) {
      failures.push(`Solana slot mismatch: expected ${receipt.settlement.slot}, got ${signatureStatus.slot}`);
    }
    if (
      options.minConfirmationStatus === "finalized" &&
      signatureStatus.confirmationStatus !== "finalized"
    ) {
      failures.push("Solana transaction is not finalized");
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    signatureStatus,
  };
}
