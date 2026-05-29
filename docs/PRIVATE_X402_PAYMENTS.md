# Private x402 Machine Payments

Dark Null now has a local adapter surface for private x402-style machine payments. It is not a live production integration with `dna-x402`; it is the Dark Null side of the contract that keeps payment receipts private, replay-resistant, and hash-locked to Solana evidence.

## What Is Delivered

| Surface | Evidence |
|---|---|
| x402 V2 header helpers | [`../swarm/x402.mjs`](../swarm/x402.mjs) |
| Opaque payment intent hashing | `createPrivateX402Intent()` |
| `PAYMENT-REQUIRED` Base64 JSON payloads | `createPaymentRequiredHeader()` |
| Replay-safe request binding | `createPrivateX402RequestBinding()` |
| Hash-locked receipts | `createPrivateX402Receipt()` |
| DNA signed-receipt wrapper | `createPrivateX402ReceiptFromDna()` |
| Structural receipt verifier | `verifyPrivateX402Receipt()` |
| Solana signature verifier hook | `verifyPrivateX402ReceiptOnSolana()` |
| Tests | [`../tests/x402-private-payments.test.mjs`](../tests/x402-private-payments.test.mjs) |

## Privacy Rule

The adapter never stores raw buyer identity, raw payment headers, raw resource URLs, or user-specific query strings in the Dark Null receipt. It stores hashes:

- `intentHash`
- `resourceHash`
- `paymentRequiredHash`
- `paymentSignatureHash`
- `paymentResponseHash`
- `proofBundleHash`
- `publicInputHash`
- `receiptHash`

That gives operators a receipt that can prove what happened without turning the receipt log into a buyer metadata leak.

## DNA x402 Wrapper

`createPrivateX402ReceiptFromDna()` is the sync point with the DNA x402 rail.

The normal DNA path stays intact:

```text
quote -> commit -> payment proof -> signed DNA receipt -> paid unlock
```

The optional Dark Null path wraps the signed DNA receipt after settlement evidence exists:

```text
signed DNA receipt
  |
hash DNA receipt, signature, resource, recipient, mint
  |
create Dark Null private receipt envelope
  |
return Dark Null receipt hash and replay key
```

The wrapper stores hashes and the Dark Null private receipt. It does not store the raw DNA receipt, raw resource URL, raw payment headers, or raw buyer metadata.

Use it for paid alpha reveals, private signal rooms, wallet reports, private API access receipts, and append-only receipt chains.

## Receipt Lock

Each settled receipt must bind:

- x402 V2 payment headers by hash
- request method, resource hash, body hash, and replay key
- Dark Null proof bundle hash and public-input hash
- Solana cluster, program id, transaction signature, slot, and confirmation status
- repository commit and manifest hash
- previous receipt hash when chaining receipts

If any field changes, `verifyPrivateX402Receipt()` recomputes a different receipt hash and fails.

## x402 Flow

```text
client requests paid machine endpoint
  |
server returns 402 + PAYMENT-REQUIRED
  |
client sends PAYMENT-SIGNATURE
  |
dna-x402 verifies or settles the payment side
  |
Dark Null relayer/client settles private proof-bound payout when needed
  |
server returns PAYMENT-RESPONSE + Dark Null receipt hash
```

The HTTP negotiation belongs to `dna-x402`. Dark Null owns only the private settlement and receipt-locking layer.

## NULL Miner Sync

DNA x402 commit `297e5844` adds a direct receipt callback to `null-miner-sdk`:

```ts
onReceiptReady: async (instructionData) => {
  // host submits the 34-byte receipt_anchor instruction directly to Solana
}
```

That path lets a host bypass the marketplace proof endpoint for receipt anchoring when `marketplaceUrl` is not configured. If `marketplaceUrl` is configured, proof submission still goes through the marketplace API. Dark Null private receipts can wrap either path after Solana settlement evidence exists.

The same DNA commit adds on-chain encrypted passkey vault storage, an on-chain NULL emission claim ledger, Liquefy archive storage payload helpers, and a root-anchored lottery primitive. These are integration surfaces for the broader stack; they do not change the Dark Null claim boundary in this repo.

## Validation

Offline receipt validation:

```bash
npm run check:x402
npm run test:x402
```

Devnet receipt confirmation against Solana RPC:

```bash
npm run check:x402:devnet
```

The devnet command confirms a historical devnet transaction signature and the canonical devnet program account. It does not claim a live x402 production payment flow or a completed external audit.

## Activation Boundary

The swarm config still keeps `x402_adapter.enabled = false` for open beta. Turning it on requires:

- external `dna-x402` release commit
- integration test that maps a real x402 payment intent to Dark Null settlement metadata
- replay cache in the service runtime
- receipt persistence with append-only hash chaining
- direct user submission path preserved
- no hot user keys or root authority keys on the adapter

Until those exist, the delivered claim is: private x402 receipt primitives and devnet receipt verification, not a public x402 merchant gateway.
