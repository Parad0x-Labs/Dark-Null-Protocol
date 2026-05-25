export declare const X402_PROTOCOL: "x402-v2";
export declare const X402_HEADERS: Readonly<{
  paymentRequired: "PAYMENT-REQUIRED";
  paymentSignature: "PAYMENT-SIGNATURE";
  paymentResponse: "PAYMENT-RESPONSE";
}>;
export declare const PRIVATE_X402_INTENT_SCHEMA: "dark-null-private-x402-intent-v1";
export declare const PRIVATE_X402_REQUEST_BINDING_SCHEMA: "dark-null-private-x402-request-binding-v1";
export declare const PRIVATE_X402_RECEIPT_SCHEMA: "dark-null-private-x402-receipt-v1";
export declare const EMPTY_BODY_SHA256: string;

export interface PrivateX402SettlementProfile {
  mode?: string;
  cluster: "devnet" | "localnet" | "mainnet-beta";
  programId: string;
  manifestLabel: string;
  amountLamports?: string | number | bigint;
  receiverTokenAccountHash?: string;
  mintHash?: string;
  proofEncodingHash?: string;
}

export interface CreatePrivateX402IntentInput {
  method?: string;
  resource: string;
  description?: string;
  nonce: string;
  expiresAt: string;
  maxAmountRequired: string | number | bigint;
  asset: string;
  network: string;
  payTo: string;
  settlement: PrivateX402SettlementProfile;
}

export interface PrivateX402Intent {
  schema: typeof PRIVATE_X402_INTENT_SCHEMA;
  protocol: typeof X402_PROTOCOL;
  scheme: "exact";
  method: string;
  resource: string;
  resourceHash: string;
  description: string;
  nonce: string;
  expiresAt: string;
  payment: {
    maxAmountRequired: string;
    asset: string;
    network: string;
    payTo: string;
  };
  settlement: Record<string, string>;
  privacy: {
    rawBuyerMetadataAllowed: false;
    rawBuyerMetadataStored: false;
    resourceIsOpaqueAlias: true;
    paymentHeadersStored: false;
  };
  intentHash: string;
}

export interface PaymentRequiredHeader {
  name: typeof X402_HEADERS.paymentRequired;
  value: string;
  payload: Record<string, unknown>;
}

export interface CreatePrivateX402RequestBindingInput {
  intent?: PrivateX402Intent;
  intentHash?: string;
  method?: string;
  resource?: string;
  bodyHash?: string;
  paymentRequiredHeader: string;
  paymentSignatureHeader: string;
}

export interface PrivateX402RequestBinding {
  schema: typeof PRIVATE_X402_REQUEST_BINDING_SCHEMA;
  protocol: typeof X402_PROTOCOL;
  intentHash: string;
  method: string;
  resourceHash: string;
  bodyHash: string;
  paymentRequiredHash: string;
  paymentSignatureHash: string;
  replayKey: string;
}

export interface PrivateX402ReceiptSettlement {
  cluster: "devnet" | "localnet" | "mainnet-beta";
  programId: string;
  signature?: string;
  slot?: number;
  confirmationStatus?: "processed" | "confirmed" | "finalized";
}

export interface PrivateX402ProofLock {
  proofBundleHash: string;
  publicInputHash: string;
  proofEncodingHash: string;
}

export interface PrivateX402RepositoryLock {
  commit: string;
  manifestSha256: string;
  releaseChecksumsSha256?: string;
}

export interface CreatePrivateX402ReceiptInput {
  status?: "settled" | "rejected";
  observedAt: string;
  intentHash?: string;
  requestBinding: PrivateX402RequestBinding;
  paymentResponseHeader: string;
  response?: {
    statusCode?: number;
    bodyHash?: string;
  };
  settlement: PrivateX402ReceiptSettlement;
  proof: PrivateX402ProofLock;
  repository: PrivateX402RepositoryLock;
  previousReceiptHash?: string | null;
}

export interface PrivateX402Receipt {
  schema: typeof PRIVATE_X402_RECEIPT_SCHEMA;
  protocol: typeof X402_PROTOCOL;
  status: "settled" | "rejected";
  observedAt: string;
  intentHash: string;
  replayKey: string;
  x402: {
    paymentRequiredHash: string;
    paymentSignatureHash: string;
    paymentResponseHash: string;
    rawHeadersStored: false;
    requiredHeaders: string[];
  };
  request: {
    method: string;
    resourceHash: string;
    bodyHash: string;
  };
  response: {
    statusCode: number;
    bodyHash: string;
  };
  privacy: {
    rawBuyerMetadataStored: false;
    rawPaymentHeadersStored: false;
    resourceIsHashed: true;
  };
  settlement: Required<Pick<PrivateX402ReceiptSettlement, "cluster" | "programId">> &
    Partial<PrivateX402ReceiptSettlement>;
  proof: PrivateX402ProofLock;
  repository: PrivateX402RepositoryLock;
  lock: {
    previousReceiptHash: string | null;
    receiptHash: string;
  };
}

export interface PrivateX402ReceiptVerification {
  ok: boolean;
  failures: string[];
  expectedReceiptHash: string | null;
  receiptHash: string | null;
}

export interface PrivateX402SolanaVerification {
  ok: boolean;
  failures: string[];
  signatureStatus: unknown;
}

export declare function canonicalJsonString(value: unknown): string;
export declare function sha256Hex(value: unknown): string;
export declare function encodeBase64Json(value: unknown): string;
export declare function decodeBase64Json(value: string): unknown;
export declare function createPrivateX402Intent(input: CreatePrivateX402IntentInput): PrivateX402Intent;
export declare function createPaymentRequiredHeader(intent: PrivateX402Intent): PaymentRequiredHeader;
export declare function createPrivateX402RequestBinding(
  input: CreatePrivateX402RequestBindingInput,
): PrivateX402RequestBinding;
export declare function createPrivateX402Receipt(input: CreatePrivateX402ReceiptInput): PrivateX402Receipt;
export declare function verifyPrivateX402Receipt(
  receipt: unknown,
  options?: { expectedPreviousReceiptHash?: string | null },
): PrivateX402ReceiptVerification;
export declare function verifyPrivateX402ReceiptOnSolana(
  receipt: PrivateX402Receipt,
  connection: unknown,
  options?: { minConfirmationStatus?: "finalized" },
): Promise<PrivateX402SolanaVerification>;
