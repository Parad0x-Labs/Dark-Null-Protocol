import test from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_BODY_SHA256,
  DNA_X402_PRIVATE_RECEIPT_SCHEMA,
  PRIVATE_X402_RECEIPT_SCHEMA,
  X402_HEADERS,
  createPaymentRequiredHeader,
  createPrivateX402ReceiptFromDna,
  createPrivateX402Intent,
  createPrivateX402Receipt,
  createPrivateX402RequestBinding,
  decodeBase64Json,
  sha256Hex,
  verifyPrivateX402Receipt,
  verifyPrivateX402ReceiptOnSolana,
} from "../swarm/x402.mjs";

const proofEncodingHash = sha256Hex({
  field: "bn254-fr",
  publicInputs: [
    "commitment",
    "nullifier",
    "root",
    "amount",
    "receiver_token_part_0",
    "receiver_token_part_1",
    "mint_part_0",
    "mint_part_1",
  ],
});

const baseIntentInput = {
  method: "POST",
  resource: "api:quotes:v1",
  description: "dark-null-private-machine-payment",
  nonce: "testnonce_20260525_a",
  expiresAt: "2026-05-25T12:00:00.000Z",
  maxAmountRequired: "2500",
  asset: "solana-devnet:usdc",
  network: "solana-devnet",
  payTo: "merchant-vault-devnet",
  settlement: {
    mode: "dark-null-withdraw-v2",
    cluster: "devnet",
    programId: "35GMe13ExGB1JGp1wZGrEvHfQnENKADroDQApeziKuwV",
    manifestLabel: "canonical-devnet-root-2",
    amountLamports: "2500",
    receiverTokenAccountHash: sha256Hex("receiver-token-account"),
    mintHash: sha256Hex("usdc-mint"),
    proofEncodingHash,
  },
};

function buildReceipt() {
  const intent = createPrivateX402Intent(baseIntentInput);
  const paymentRequired = createPaymentRequiredHeader(intent);
  const paymentSignatureHeader = "eyJzaWduYXR1cmUiOiJ0ZXN0LXNpZ25hdHVyZSJ9";
  const paymentResponseHeader = "eyJzdGF0dXMiOiJzZXR0bGVkIn0=";
  const binding = createPrivateX402RequestBinding({
    intent,
    paymentRequiredHeader: paymentRequired.value,
    paymentSignatureHeader,
    bodyHash: EMPTY_BODY_SHA256,
  });

  const receipt = createPrivateX402Receipt({
    requestBinding: binding,
    paymentResponseHeader,
    observedAt: "2026-05-25T12:00:01.000Z",
    settlement: {
      cluster: "devnet",
      programId: baseIntentInput.settlement.programId,
      signature: "2526CKHHajSYmZV2BGquS4K9bNJFuCamgkcCjbps8tWLg5Hub4k2qtL3Frwnos8bhaDoaPcszmzA5CL16Zi7En1d",
      slot: 434395918,
      confirmationStatus: "finalized",
    },
    proof: {
      proofBundleHash: sha256Hex("proof-bundle"),
      publicInputHash: sha256Hex("public-inputs"),
      proofEncodingHash,
    },
    repository: {
      commit: "0123456789abcdef0123456789abcdef01234567",
      manifestSha256: sha256Hex("manifest"),
    },
  });

  return { intent, paymentRequired, paymentSignatureHeader, paymentResponseHeader, binding, receipt };
}

function buildDnaReceipt() {
  const payload = {
    receiptId: "receipt_dna_1",
    quoteId: "quote_dna_1",
    commitId: "commit_dna_1",
    resource: "https://provider.example/private-alpha?buyer=alice",
    requestId: "request_dna_1",
    requestDigest: sha256Hex("POST|/private-alpha|body"),
    responseDigest: sha256Hex("200|alpha-payload"),
    shopId: "shop_dna_1",
    payerCommitment32B: sha256Hex("payer"),
    recipient: "merchant-vault-devnet",
    mint: "usdc-devnet-mint",
    amountAtomic: "2499",
    feeAtomic: "1",
    totalAtomic: "2500",
    settlement: "transfer",
    settledOnchain: true,
    txSignature: "2526CKHHajSYmZV2BGquS4K9bNJFuCamgkcCjbps8tWLg5Hub4k2qtL3Frwnos8bhaDoaPcszmzA5CL16Zi7En1d",
    createdAt: "2026-05-25T12:00:00.000Z",
  };
  return {
    payload,
    prevHash: "0".repeat(64),
    receiptHash: sha256Hex({ prevHash: "0".repeat(64), payload }),
    signerPublicKey: "seller-receipt-pubkey",
    signature: "seller-receipt-signature",
  };
}

test("private x402 intents produce opaque x402 V2 payment requirements", () => {
  const intent = createPrivateX402Intent(baseIntentInput);
  const paymentRequired = createPaymentRequiredHeader(intent);
  const decoded = decodeBase64Json(paymentRequired.value);

  assert.equal(paymentRequired.name, X402_HEADERS.paymentRequired);
  assert.equal(decoded.x402Version, 2);
  assert.equal(decoded.accepts[0].scheme, "exact");
  assert.equal(decoded.accepts[0].resource, "api:quotes:v1");
  assert.equal(decoded.accepts[0].extra.darkNull.intentHash, intent.intentHash);
  assert.equal(decoded.accepts[0].extra.darkNull.rawBuyerMetadataAllowed, false);
  assert.doesNotMatch(paymentRequired.value, /quotes\?/);
  assert.match(intent.intentHash, /^[0-9a-f]{64}$/);
});

test("private x402 metadata rejects raw URLs, query strings, and user identifiers", () => {
  assert.throws(
    () => createPrivateX402Intent({ ...baseIntentInput, resource: "https://api.example.test/quotes?user=alice" }),
    /opaque lowercase alias|raw URL|query string/,
  );
  assert.throws(
    () => createPrivateX402Intent({ ...baseIntentInput, description: "payment for alice@example.test" }),
    /email address/,
  );
  assert.throws(
    () => createPrivateX402Intent({ ...baseIntentInput, nonce: "short" }),
    /URL-safe nonce/,
  );
});

test("request binding creates replay keys that move when payment authorization changes", () => {
  const { intent, paymentRequired, binding } = buildReceipt();
  const changedBinding = createPrivateX402RequestBinding({
    intent,
    paymentRequiredHeader: paymentRequired.value,
    paymentSignatureHeader: "eyJzaWduYXR1cmUiOiJvdGhlci1zaWduYXR1cmUifQ==",
    bodyHash: EMPTY_BODY_SHA256,
  });

  assert.match(binding.replayKey, /^[0-9a-f]{64}$/);
  assert.notEqual(binding.replayKey, changedBinding.replayKey);
});

test("settled private x402 receipts are hash-locked to repo, proof, x402, and Solana fields", () => {
  const { receipt } = buildReceipt();
  const verification = verifyPrivateX402Receipt(receipt);

  assert.equal(receipt.schema, PRIVATE_X402_RECEIPT_SCHEMA);
  assert.equal(receipt.x402.rawHeadersStored, false);
  assert.equal(receipt.privacy.rawBuyerMetadataStored, false);
  assert.equal(receipt.privacy.rawPaymentHeadersStored, false);
  assert.equal(verification.ok, true);
  assert.deepEqual(verification.failures, []);
  assert.equal(receipt.lock.receiptHash, verification.expectedReceiptHash);

  const tampered = {
    ...receipt,
    settlement: {
      ...receipt.settlement,
      slot: receipt.settlement.slot + 1,
    },
  };
  assert.equal(verifyPrivateX402Receipt(tampered).ok, false);
});

test("receipt chain rejects wrong previous hash", () => {
  const { receipt } = buildReceipt();
  const secondReceipt = createPrivateX402Receipt({
    requestBinding: {
      schema: receipt.schema,
      intentHash: receipt.intentHash,
      method: receipt.request.method,
      resourceHash: receipt.request.resourceHash,
      bodyHash: receipt.request.bodyHash,
      paymentRequiredHash: receipt.x402.paymentRequiredHash,
      paymentSignatureHash: receipt.x402.paymentSignatureHash,
      replayKey: receipt.replayKey,
    },
    paymentResponseHeader: "eyJzdGF0dXMiOiJzZXR0bGVkIn0=",
    observedAt: "2026-05-25T12:05:01.000Z",
    settlement: receipt.settlement,
    proof: receipt.proof,
    repository: receipt.repository,
    previousReceiptHash: receipt.lock.receiptHash,
  });

  assert.equal(
    verifyPrivateX402Receipt(secondReceipt, { expectedPreviousReceiptHash: receipt.lock.receiptHash }).ok,
    true,
  );
  assert.equal(
    verifyPrivateX402Receipt(secondReceipt, { expectedPreviousReceiptHash: sha256Hex("wrong") }).ok,
    false,
  );
});

test("Solana receipt verifier confirms signatures through an injected connection", async () => {
  const { receipt } = buildReceipt();
  const connection = {
    async getSignatureStatuses(signatures, options) {
      assert.deepEqual(signatures, [receipt.settlement.signature]);
      assert.equal(options.searchTransactionHistory, true);
      return {
        value: [
          {
            slot: receipt.settlement.slot,
            err: null,
            confirmationStatus: "finalized",
          },
        ],
      };
    },
  };

  const result = await verifyPrivateX402ReceiptOnSolana(receipt, connection, {
    minConfirmationStatus: "finalized",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test("DNA x402 signed receipts can be wrapped into a Dark Null private receipt path", () => {
  const dnaReceipt = buildDnaReceipt();
  const envelope = createPrivateX402ReceiptFromDna({
    dnaReceipt,
    observedAt: "2026-05-25T12:00:02.000Z",
    expiresAt: "2026-05-25T12:05:00.000Z",
    cluster: "devnet",
    programId: baseIntentInput.settlement.programId,
    manifestLabel: "canonical-devnet-root-2",
    slot: 434395918,
    repository: {
      commit: "0123456789abcdef0123456789abcdef01234567",
      manifestSha256: sha256Hex("manifest"),
    },
  });

  assert.equal(envelope.schema, DNA_X402_PRIVATE_RECEIPT_SCHEMA);
  assert.equal(envelope.normalPath, "dna-x402");
  assert.equal(envelope.privacyPath, "dark-null");
  assert.equal(envelope.privacy.rawDnaReceiptStored, false);
  assert.equal(envelope.privacy.rawResourceStored, false);
  assert.equal(envelope.receipt.lock.receiptHash, envelope.receiptHash);
  assert.equal(verifyPrivateX402Receipt(envelope.receipt).ok, true);
  assert.doesNotMatch(JSON.stringify(envelope), /provider\.example|buyer=alice/);

  const tampered = {
    ...envelope.receipt,
    response: {
      ...envelope.receipt.response,
      bodyHash: sha256Hex("changed-response"),
    },
  };
  assert.equal(verifyPrivateX402Receipt(tampered).ok, false);
});
