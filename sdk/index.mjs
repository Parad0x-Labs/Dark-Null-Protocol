import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sdkDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(sdkDir, "..");
const idlPath = path.join(repoRoot, "idl", "paradox.json");
const manifestPath = path.join(repoRoot, "MANIFEST.json");
const networksPath = path.join(repoRoot, "NETWORKS.json");
const publishedIdl = JSON.parse(readFileSync(idlPath, "utf8"));
const canonicalManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const publishedNetworks = JSON.parse(readFileSync(networksPath, "utf8"));

const programIdManifest = Object.freeze([
  Object.freeze({
    key: "canonicalDevnet",
    label: "Canonical recovered devnet track",
    programId: "2stas3cZYnBiWpndcTXQDGLXwfQ7kjEYYrW52DsUAcxF",
    notes: "Promoted root path with canonical null_proof artifacts and Groth16 verifier",
    sources: Object.freeze(["Anchor.toml", "idl/paradox.json", "MANIFEST.json", "NETWORKS.json"]),
  }),
  Object.freeze({
    key: "v20Prototype",
    label: "V20 optimistic claim prototype",
    programId: "AeinEiBRodoCLJwdiXNd2fWXM49cByxhCsLW8DyRqCVe",
    notes: "Historical v1.22 claim-window materials",
    sources: Object.freeze(["tx/devnet_links.md", "CHANGELOG.md"]),
  }),
  Object.freeze({
    key: "v17Legacy",
    label: "V17 historical deployment",
    programId: "Ajdw9GaNN39P9mj6uqiAxAnYRS4wC1rQh2C7wguvJArB",
    notes: "Legacy reference",
    sources: Object.freeze(["env.example.txt", "CHANGELOG.md"]),
  }),
  Object.freeze({
    key: "v18DocsTrack",
    label: "V18 interface/docs track",
    programId: "7niGgy3EBVZtFjY1Gjx2hoeNHzeiJER76sEVhd4S5p6w",
    notes: "Historical interface-oriented references",
    sources: Object.freeze(["env.example.txt", "idl/README.md", "docs/getting-started.md"]),
  }),
  Object.freeze({
    key: "fullCycleArtifact",
    label: "January 11, 2026 full-cycle artifact bundle",
    programId: "33Uw9kiVRrn6wVmR439gA9QWh4MLv87N97taj2sLrkE4",
    notes: "Historical full-cycle evidence bundle",
    sources: Object.freeze(["LIVE_TEST_RESULTS.md", "full_cycle_results.json", "tests/full_cycle_e2e.ts"]),
  }),
  Object.freeze({
    key: "pythonClientSnapshot",
    label: "Python client snapshot",
    programId: "3hYWUSYmNCzrHNgsE6xo3jKT9GjCFxCpPWXj4Q4imToz",
    notes: "Historical client-side program reference",
    sources: Object.freeze(["client/dark_client.py"]),
  }),
]);

const programIdByKey = Object.freeze(
  Object.fromEntries(programIdManifest.map((entry) => [entry.key, entry.programId])),
);
const supportedNetworks = Object.freeze(
  Object.entries(publishedNetworks.supportedNetworks).map(([key, value]) =>
    Object.freeze({
      key,
      ...value,
    }),
  ),
);
const networkByKey = Object.freeze(
  Object.fromEntries(supportedNetworks.map((entry) => [entry.key, entry])),
);
const canonicalArtifacts = Object.freeze({
  anchorTomlPath: path.join(repoRoot, "Anchor.toml"),
  manifestPath,
  networksPath,
  idlPath,
  circuitPath: path.join(repoRoot, canonicalManifest.groth16.circuit),
  zkeyPath: path.join(repoRoot, canonicalManifest.groth16.zkey),
  wasmPath: path.join(repoRoot, canonicalManifest.groth16.wasm),
  vkJsonPath: path.join(repoRoot, canonicalManifest.groth16.vk_json),
});
const vaultSeed = Buffer.from("merkle_vault");
const rootAuthoritySeed = Buffer.from("root_authority");

function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function stripHexPrefix(value) {
  return value.startsWith("0x") ? value.slice(2) : value;
}

function assertBytes32Length(bytes) {
  if (bytes.length !== 32) {
    throw new Error(`Expected 32 bytes, received ${bytes.length}`);
  }
}

export const SDK_METADATA = Object.freeze({
  packageName: "@dark-null/protocol",
  sdkKind: "anchor-sdk",
  idlName: publishedIdl.metadata?.name ?? publishedIdl.name,
  idlVersion: publishedIdl.metadata?.version ?? publishedIdl.version,
});

export function getSdkMetadata() {
  return { ...SDK_METADATA };
}

export function getCanonicalManifest() {
  return deepCopy(canonicalManifest);
}

export function getIdl() {
  return deepCopy(publishedIdl);
}

export function getCanonicalArtifacts() {
  return { ...canonicalArtifacts };
}

export function listInstructionNames() {
  return publishedIdl.instructions.map((instruction) => instruction.name);
}

export function getInstructionDefinition(name) {
  const instruction = publishedIdl.instructions.find((candidate) => candidate.name === name);
  if (!instruction) {
    throw new Error(`Unknown instruction: ${name}`);
  }

  return deepCopy(instruction);
}

export function listAccountNames() {
  return (publishedIdl.accounts ?? []).map((account) => account.name);
}

export function getProgramIdManifest() {
  return programIdManifest.map((entry) => ({
    ...entry,
    sources: [...entry.sources],
  }));
}

export function listSupportedNetworks() {
  return supportedNetworks.map((entry) => ({ ...entry }));
}

export function getNetworkDefinition(name) {
  const entry = networkByKey[name];
  return entry ? { ...entry } : null;
}

export function findProgramIdEntry(value) {
  const entry = programIdManifest.find(
    (candidate) => candidate.key === value || candidate.programId === value,
  );
  return entry
    ? {
        ...entry,
        sources: [...entry.sources],
      }
    : null;
}

export function resolveProgramId(value) {
  if (!value) {
    throw new Error("Program ID lookup requires a manifest key or explicit program ID");
  }

  return programIdByKey[value] ?? value;
}

export function resolveNetworkConfig(options = {}) {
  const normalized = typeof options === "string" ? { network: options } : options;
  const network = normalized.network ?? publishedNetworks.defaultNetwork;
  const definition = networkByKey[network];

  if (!definition) {
    const knownNetworks = supportedNetworks.map((entry) => entry.key).join(", ");
    throw new Error(`Unknown network: ${network}. Expected one of ${knownNetworks}`);
  }

  return {
    network: definition.key,
    label: definition.label,
    cluster: definition.cluster,
    anchorCluster: definition.anchorCluster,
    rpcUrl: normalized.rpcUrl ?? definition.rpcUrl,
    wsUrl: definition.wsUrl ?? null,
    walletPath: normalized.walletPath ?? null,
    commitment: normalized.commitment ?? "confirmed",
    programId: resolveProgramId(definition.manifestKey),
    manifestKey: definition.manifestKey,
    manifestLabel: canonicalManifest.label,
  };
}

export async function deriveCanonicalPdas({ programId, manifestKey, web3 } = {}) {
  const resolvedProgramId = resolveProgramId(manifestKey ?? programId ?? "canonicalDevnet");
  const web3Module = web3 ?? (await import("@solana/web3.js"));
  const PublicKey = web3Module.PublicKey ?? web3Module.default?.PublicKey;

  if (!PublicKey || typeof PublicKey.findProgramAddressSync !== "function") {
    throw new Error("web3 module does not expose PublicKey.findProgramAddressSync");
  }

  const programKey = new PublicKey(resolvedProgramId);
  const [vaultPda] = PublicKey.findProgramAddressSync([vaultSeed], programKey);
  const [rootAuthorityPda] = PublicKey.findProgramAddressSync([rootAuthoritySeed], programKey);

  return {
    programId: typeof programKey.toBase58 === "function" ? programKey.toBase58() : resolvedProgramId,
    vaultPda: typeof vaultPda.toBase58 === "function" ? vaultPda.toBase58() : vaultPda,
    rootAuthorityPda:
      typeof rootAuthorityPda.toBase58 === "function" ? rootAuthorityPda.toBase58() : rootAuthorityPda,
  };
}

export function bytes32ToHex(input) {
  const bytes = normalizeBytes32(input);
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

export function hexToBytes32(input) {
  const normalized = stripHexPrefix(input);
  if (normalized.length !== 64) {
    throw new Error(`Expected 64 hex characters, received ${normalized.length}`);
  }

  const bytes = Array.from(Buffer.from(normalized, "hex"));
  assertBytes32Length(bytes);
  return bytes;
}

export function normalizeBytes32(input) {
  if (typeof input === "string") {
    return hexToBytes32(input);
  }

  const bytes = Array.from(input);
  assertBytes32Length(bytes);
  return bytes.map((value) => {
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new Error(`Invalid byte value: ${value}`);
    }
    return value;
  });
}

export async function createAnchorProgram({
  provider,
  programId,
  manifestKey,
  anchor,
} = {}) {
  if (!provider) {
    throw new Error("createAnchorProgram requires a provider");
  }

  const resolvedProgramId = resolveProgramId(manifestKey ?? programId);
  const anchorModule = anchor ?? (await import("@coral-xyz/anchor"));
  const AnchorProgram = anchorModule.Program ?? anchorModule.default?.Program;
  const PublicKey = anchorModule.web3?.PublicKey ?? anchorModule.default?.web3?.PublicKey;

  if (!AnchorProgram || !PublicKey) {
    throw new Error("Anchor module does not expose Program and web3.PublicKey");
  }

  return new AnchorProgram(getIdl(), new PublicKey(resolvedProgramId), provider);
}

export async function createConnection(rpcUrl, web3Module) {
  if (!rpcUrl) {
    throw new Error("createConnection requires an rpcUrl");
  }

  const web3 = web3Module ?? (await import("@solana/web3.js"));
  const Connection = web3.Connection ?? web3.default?.Connection;

  if (!Connection) {
    throw new Error("web3 module does not expose Connection");
  }

  return new Connection(rpcUrl);
}

export async function createConnectionForNetwork(options = {}, web3Module) {
  const config = resolveNetworkConfig(options);
  return createConnection(config.rpcUrl, web3Module);
}
