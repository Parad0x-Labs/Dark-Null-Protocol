# Integration Guide

This guide focuses on the current canonical root that is actually present in this repository today.

## Recommended Integration Paths

### TypeScript / Anchor

Use:

- `@dark-null/protocol`
- `@coral-xyz/anchor`
- `@solana/web3.js`
- the canonical IDL in [`../idl/paradox.json`](../idl/paradox.json)

### Python

Use:

- [`../client/dark_client.py`](../client/dark_client.py)
- [`../client/requirements.txt`](../client/requirements.txt)

## SDK-first

```typescript
import {
  createAnchorProgram,
  getInstructionDefinition,
  resolveProgramId,
} from "@dark-null/protocol";

const program = await createAnchorProgram({
  anchor,
  provider,
  manifestKey: "canonicalDevnet",
});

const withdraw = getInstructionDefinition("prepare_phantom_withdraw");
const programId = resolveProgramId("canonicalDevnet");
```

## Raw IDL

If you bypass the SDK, bind the root directly using [`../MANIFEST.json`](../MANIFEST.json).

## Historical Material

If you want older harnesses or earlier flows, inspect:

- [`../historical/null-mint`](../historical/null-mint)
- [`../historical/root-toy-prototype`](../historical/root-toy-prototype)
- [`../tests/dark_null_v1_full_e2e.ts`](../tests/dark_null_v1_full_e2e.ts)
- [`../tests/full_cycle_e2e.ts`](../tests/full_cycle_e2e.ts)

These are historical aids, not the current integration target.

## What Is Still Not Fully Curated

- relayer operational code
- production wallet distribution
- production browser-extension distribution

## DNA x402 Boundary

Dark Null is not the request-time payment rail. For HTTP 402 payment flows, use the separate DNA x402 repo:

- [dna-x402](https://github.com/Parad0x-Labs/dna-x402)
