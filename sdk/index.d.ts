export interface ProgramIdEntry {
  key:
    | "canonicalDevnet"
    | "v20Prototype"
    | "v17Legacy"
    | "v18DocsTrack"
    | "fullCycleArtifact"
    | "pythonClientSnapshot";
  label: string;
  programId: string;
  notes: string;
  sources: string[];
}

export interface CanonicalManifest {
  label: string;
  status: string;
  promoted_on: string;
  program: {
    name: string;
    id: string;
    cluster: string;
  };
  source: {
    promoted_from: string;
    recovered_manifest: string;
  };
  groth16: {
    protocol: string;
    curve: string;
    n_public: number;
    vk_ic_count: number;
    circuit: string;
    zkey: string;
    wasm: string;
    vk_json: string;
  };
  artifacts: Array<{
    path: string;
    sha256: string;
    size: number;
  }>;
}

export interface CanonicalArtifacts {
  anchorTomlPath: string;
  manifestPath: string;
  networksPath: string;
  idlPath: string;
  circuitPath: string;
  zkeyPath: string;
  wasmPath: string;
  vkJsonPath: string;
}

export interface NetworkDefinition {
  key: "devnet" | "localnet";
  label: string;
  cluster: string;
  anchorCluster: string;
  rpcUrl: string;
  wsUrl: string | null;
  manifestKey: ProgramIdEntry["key"];
}

export interface NetworkConfig {
  network: NetworkDefinition["key"];
  label: string;
  cluster: string;
  anchorCluster: string;
  rpcUrl: string;
  wsUrl: string | null;
  walletPath: string | null;
  commitment: string;
  programId: string;
  manifestKey: ProgramIdEntry["key"];
  manifestLabel: string;
}

export interface CanonicalPdas {
  programId: string;
  vaultPda: string;
  rootAuthorityPda: string;
}

export interface SdkMetadata {
  packageName: "@dark-null/protocol";
  sdkKind: "anchor-sdk";
  idlName: string;
  idlVersion: string;
}

export interface CreateAnchorProgramOptions {
  provider: unknown;
  programId?: string;
  manifestKey?: ProgramIdEntry["key"];
  anchor?: unknown;
}

export interface ResolveNetworkConfigOptions {
  network?: NetworkDefinition["key"];
  rpcUrl?: string;
  walletPath?: string;
  commitment?: string;
}

export declare const SDK_METADATA: Readonly<SdkMetadata>;

export declare function getSdkMetadata(): SdkMetadata;
export declare function getCanonicalManifest(): CanonicalManifest;
export declare function getIdl(): any;
export declare function getCanonicalArtifacts(): CanonicalArtifacts;
export declare function listInstructionNames(): string[];
export declare function getInstructionDefinition(name: string): any;
export declare function listAccountNames(): string[];
export declare function getProgramIdManifest(): ProgramIdEntry[];
export declare function listSupportedNetworks(): NetworkDefinition[];
export declare function getNetworkDefinition(name: string): NetworkDefinition | null;
export declare function findProgramIdEntry(value: string): ProgramIdEntry | null;
export declare function resolveProgramId(value: string): string;
export declare function resolveNetworkConfig(options?: ResolveNetworkConfigOptions | NetworkDefinition["key"]): NetworkConfig;
export declare function deriveCanonicalPdas(options?: {
  programId?: string;
  manifestKey?: ProgramIdEntry["key"];
  web3?: unknown;
}): Promise<CanonicalPdas>;
export declare function bytes32ToHex(input: string | ArrayLike<number>): string;
export declare function hexToBytes32(input: string): number[];
export declare function normalizeBytes32(input: string | ArrayLike<number>): number[];
export declare function createAnchorProgram(options: CreateAnchorProgramOptions): Promise<any>;
export declare function createConnection(rpcUrl: string, web3Module?: unknown): Promise<any>;
export declare function createConnectionForNetwork(options?: ResolveNetworkConfigOptions | NetworkDefinition["key"], web3Module?: unknown): Promise<any>;
