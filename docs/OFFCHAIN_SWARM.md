# Off-Chain Swarm

The Dark Null swarm is an operations layer around the Solana program. It does not replace the proof system and it must not hold upgrade authority, root authority, or user spending secrets.

## Beta Roles

| Role | Job | Holds secrets? |
|---|---|---|
| `indexer` | follows deposits, roots, nullifiers, and payout events | no |
| `relayer` | submits user transactions and pays transaction fees | tiny SOL float only |
| `prover` | generates proof jobs or routes client-side proving | no long-term secrets |
| `monitor` | watches liveness, caps, vault exposure, and anomalous events | no |
| `root_coordinator` | prepares root-update material for an external signer | no root authority key |
| `x402_adapter` | reserved adapter for `dna-x402`; private receipt primitives exist, service remains disabled until integration evidence exists | no |

## Endpoints

Every service profile must expose:

- `/health` for process liveness
- `/ready` for role/config readiness
- `/metrics` for Prometheus-style metrics

The reference module lives in [`../swarm/server.mjs`](../swarm/server.mjs). The example beta config lives in [`../config/swarm.open-beta.example.json`](../config/swarm.open-beta.example.json).

## Security Rules

- no root authority key on a server
- no upgrade authority key on a server
- relayer hot wallet has a small SOL float only
- direct user submission remains available
- relayer use is optional
- x402 adapter stays disabled until the external `dna-x402` integration has evidence
- x402 receipts store hashes, not raw buyer metadata or raw payment headers
- settled x402 receipts must bind a Solana transaction signature, slot, repo commit, manifest hash, and proof hash
- production claims stay disabled during open beta

## Validation

```bash
npm run check:swarm
npm run test:swarm
npm run check:x402
npm run test:x402
```

The swarm is useful because it makes the beta easier to operate. It is not a validator network, BFT layer, bridge product, or private compute system.
