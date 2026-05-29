# DNA x402 Integration Slot

Dark Null should integrate with `dna-x402` as a payment settlement primitive, not by bloating the Solana program.

## Boundary

`dna-x402` owns HTTP payment negotiation, API gating, agent payment UX, facilitator calls, and merchant-side middleware. Dark Null owns proof-bound private settlement and receipt locking.

There are now two explicit paths:

| Path | Default | Owner | Use case |
|---|---:|---|---|
| normal DNA x402 | yes | `dna-x402` | fast paid APIs, signed receipts, optional receipt anchoring |
| Dark Null private receipt | no | this repo | privacy-sensitive paid unlocks that need hash-only receipt wrapping |

The swarm reserves an `x402_adapter` role, but it is disabled in [`../config/swarm.open-beta.example.json`](../config/swarm.open-beta.example.json) until integration evidence exists. The Dark Null-side receipt primitives live in [`../swarm/x402.mjs`](../swarm/x402.mjs) and are documented in [`PRIVATE_X402_PAYMENTS.md`](./PRIVATE_X402_PAYMENTS.md).

## Future Flow

```text
API asks for x402 payment
  |
dna-x402 middleware creates payment intent
  |
Dark Null adapter hashes the intent and binds replay key
  |
Dark Null client shields or proves settlement
  |
relayer submits proof-bound payout when needed
  |
merchant receives x402 success response plus receipt hash
```

## DNA Signed-Receipt Wrapper

The Dark Null SDK surface now includes `createPrivateX402ReceiptFromDna()`.

It consumes a signed DNA x402 receipt plus Solana settlement evidence and emits a Dark Null private receipt envelope:

- `normalPath = "dna-x402"`
- `privacyPath = "dark-null"`
- DNA receipt hash
- DNA receipt payload hash
- DNA receipt signature hash
- hashed resource
- hashed recipient
- hashed mint
- Dark Null private receipt hash

The wrapper does not store the raw DNA receipt, raw resource URL, raw payment headers, or raw buyer metadata in the Dark Null receipt.

## Delivered Local Contract

- x402 V2 header names are fixed as `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, and `PAYMENT-RESPONSE`.
- Dark Null receipts store hashes, not raw buyer metadata or raw payment headers.
- DNA signed receipts can be wrapped into Dark Null private receipts with `createPrivateX402ReceiptFromDna()`.
- Settled receipts bind Solana signature, slot, program id, repository commit, manifest hash, proof hash, and previous receipt hash.
- DNA x402 commit `297e5844` adds `null-miner-sdk` direct receipt-anchor callbacks so hosts can submit the 34-byte receipt anchor instruction without routing proof submission through the marketplace API.
- DNA x402 commit `297e5844` adds on-chain encrypted passkey vault storage in `dark_secp256r1_vault`; Dark Null should treat this as agent-key recovery storage, not proof of production passkey authentication until secp256r1 precompile enforcement is wired.
- DNA x402 commit `297e5844` adds `dark-null-mint-gate`; Dark Null should treat it as an on-chain emission claim ledger with nullifier and epoch-cap checks, not as live NULL minting until SPL mint CPI is enabled and tested.
- DNA x402 commit `297e5844` adds `dark-null-lottery`; Dark Null should treat it as a root-anchored commit-reveal primitive, not as a fully settled on-chain lottery until token settlement and winner verification are promoted.
- `npm run check:x402` validates the local receipt lock.
- `npm run check:x402:devnet` confirms the devnet receipt path against Solana RPC.

## Activation Requirements

- external `dna-x402` release commit
- adapter config with `x402_adapter.enabled = true`
- integration tests proving x402 payment intent maps to Dark Null settlement metadata
- public builders contract for `privacyPath=dark-null`
- replay cache and append-only receipt persistence in the service runtime
- no custody of user secrets by the adapter
- direct non-relayed submission remains possible
- public docs updated without production or audit overclaiming

Until those exist, the delivered claim is the private receipt/settlement contract, not a public merchant gateway.
