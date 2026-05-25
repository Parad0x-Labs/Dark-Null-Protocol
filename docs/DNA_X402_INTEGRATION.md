# DNA x402 Integration Slot

Dark Null should integrate with `dna-x402` as a payment settlement primitive, not by bloating the Solana program.

## Boundary

`dna-x402` owns HTTP payment negotiation, API gating, agent payment UX, and merchant-side middleware. Dark Null owns proof-bound private settlement.

The swarm reserves an `x402_adapter` role, but it is disabled in [`../config/swarm.open-beta.example.json`](../config/swarm.open-beta.example.json) until integration evidence exists.

## Future Flow

```text
API asks for x402 payment
  |
dna-x402 middleware creates payment intent
  |
Dark Null client shields or proves settlement
  |
relayer submits proof-bound payout when needed
  |
merchant receives x402 success response
```

## Activation Requirements

- external `dna-x402` release commit
- adapter config with `x402_adapter.enabled = true`
- integration tests proving x402 payment intent maps to Dark Null settlement metadata
- no custody of user secrets by the adapter
- direct non-relayed submission remains possible
- public docs updated without production or audit overclaiming

Until those exist, x402 is a planned integration slot, not a delivered claim.
