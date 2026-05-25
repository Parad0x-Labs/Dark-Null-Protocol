# Proof-Carrying Relayer Swarm

status: research

This document defines the research target for proof-carrying relayer, prover, indexer, and monitor capsules. It does not turn the swarm into a validator network, BFT layer, bridge, or private compute network.

## Current Swarm Surface

The current repo has:

- `config/swarm.open-beta.example.json`
- `swarm/config.mjs`
- `swarm/server.mjs`
- `tests/swarm-config.test.mjs`

The current swarm validates roles, caps, hot-key policy, health endpoints, readiness endpoints, metrics endpoints, and x402 adapter disabled state.

## Capsule Goal

Each service should be able to publish a signed capsule:

```json
{
  "schema": "dark-null-swarm-capsule-v1",
  "role": "relayer",
  "repoCommit": "40-char-git-commit",
  "manifestSha256": "sha256",
  "configSha256": "sha256",
  "serviceId": "relayer-a",
  "network": "devnet",
  "caps": {
    "maxTotalValueLockedLamports": "10000000000",
    "maxDepositLamports": "1000000000",
    "dailyWithdrawLimitLamports": "5000000000"
  },
  "feePolicySha256": "sha256",
  "liveness": {
    "checkedAt": "iso-date",
    "healthPath": "/health",
    "readyPath": "/ready",
    "metricsPath": "/metrics"
  },
  "custody": {
    "rootKeyPresent": false,
    "upgradeKeyPresent": false,
    "userSpendingKeysPresent": false
  }
}
```

The capsule does not prove decentralized consensus. It proves service posture: what code, config, caps, role, and custody boundary the service claims at a point in time.

## Required Capsule Fields

| Field | Purpose |
|---|---|
| `repoCommit` | binds service to source commit |
| `manifestSha256` | binds service to artifact set |
| `configSha256` | binds service to declared swarm config |
| `role` | declares indexer, relayer, prover, monitor, root coordinator, or x402 adapter |
| `caps` | declares beta caps and service limits |
| `feePolicySha256` | binds fees without exposing mutable text |
| `liveness` | binds current health/readiness/metrics paths |
| `custody` | states no root key, no upgrade key, and no user spending secrets |
| `signature` | signs the capsule with a service identity key |

## Threat Model

An attacker may try to:

- publish a capsule for one commit while running another
- strip caps from a relayer profile
- claim the x402 adapter is enabled before evidence exists
- hide root or upgrade key custody
- spoof liveness
- reuse an old capsule
- create two conflicting capsules for one service id

## Required Tests

Before this becomes a public claim, add tests for:

- deterministic config hash
- deterministic fee policy hash
- capsule signature verification
- stale capsule rejection
- wrong manifest hash rejection
- forbidden root key flag rejection
- forbidden upgrade key flag rejection
- x402 adapter enabled without evidence rejection
- conflicting service id detection

## Activation Blockers

- capsule schema
- service identity key policy
- signing and verification module
- liveness freshness policy
- config digest policy
- append-only capsule history
- integration with swarm metrics

## Claim Boundary

Allowed current wording:

- "proof-carrying swarm research"
- "service posture capsule design"
- "relayer config attestation target"

Blocked wording:

- blocked phrase: `validator network`
- blocked phrase: `BFT layer`
- blocked phrase: `decentralized consensus`
- blocked phrase: `private compute network`
- blocked phrase: `bridge`
