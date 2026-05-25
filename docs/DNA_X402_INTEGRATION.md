# DNA x402 Integration Slot

Dark Null should integrate with `dna-x402` as a payment settlement primitive, not by bloating the Solana program.

## Boundary

`dna-x402` owns HTTP payment negotiation, API gating, agent payment UX, facilitator calls, and merchant-side middleware. Dark Null owns proof-bound private settlement and receipt locking.

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

## Delivered Local Contract

- x402 V2 header names are fixed as `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, and `PAYMENT-RESPONSE`.
- Dark Null receipts store hashes, not raw buyer metadata or raw payment headers.
- Settled receipts bind Solana signature, slot, program id, repository commit, manifest hash, proof hash, and previous receipt hash.
- `npm run check:x402` validates the local receipt lock.
- `npm run check:x402:devnet` confirms the devnet receipt path against Solana RPC.

## Activation Requirements

- external `dna-x402` release commit
- adapter config with `x402_adapter.enabled = true`
- integration tests proving x402 payment intent maps to Dark Null settlement metadata
- replay cache and append-only receipt persistence in the service runtime
- no custody of user secrets by the adapter
- direct non-relayed submission remains possible
- public docs updated without production or audit overclaiming

Until those exist, the delivered claim is the private receipt/settlement contract, not a public merchant gateway.
