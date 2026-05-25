# Compressed Anonymity State

status: research

This document describes how Dark Null could migrate bounded root and nullifier windows toward compressed-account or state-tree style storage. It is not an implementation claim.

## Current State

The current public root uses bounded on-chain windows for:

- commitments
- accepted roots
- used nullifiers

The program now fails closed when these windows are full. That is safer than silent overwrite behavior, but it is not enough for a large anonymity set.

## Target Direction

Compressed anonymity state would move large membership data into a state-tree model:

```text
deposit commitment
  |
compressed account / state tree leaf
  |
state root committed on Solana
  |
Dark Null proof references root + nullifier
  |
withdraw v2 verifies payout-bound public inputs
```

The design goal is not to reduce security checks. The goal is to make root and nullifier state scale without giant mutable Solana accounts.

## Candidate State Objects

| Object | Current model | Research target |
|---|---|---|
| commitment | bounded vault window | compressed leaf |
| root | bounded accepted-root list | state-tree root registry |
| nullifier | bounded used-nullifier list | compressed nullifier index |
| x402 receipt head | local receipt hash | compressed receipt-head leaf |

## Threat Model

An attacker may try to:

- prove against a root not accepted by Dark Null
- replay a nullifier after migration
- exploit indexer lag
- submit a compressed proof for the wrong tree
- race root publication and withdrawal
- create two receipt heads for one payment
- cause state exhaustion or denial of service through high-volume deposits

The compressed design must preserve:

- root validity
- nullifier uniqueness
- payout-bound public inputs
- receiver token account binding
- mint binding
- direct submission fallback
- clear failure behavior when indexers lag

## Required Tests

Before this can become a public claim, add tests for:

- wrong compressed root rejection
- stale root rejection
- duplicate nullifier rejection across compressed and legacy windows
- missing leaf rejection
- wrong state tree rejection
- indexer lag simulation
- migration from bounded window to compressed state
- receipt head append and replay rejection
- manifest hash binding for compressed-state parameters

## Activation Blockers

- compressed account backend chosen
- state-tree schema written
- localnet integration harness
- compressed proof adapter
- root updater replacement or stricter root-publication policy
- auditor review of migration and nullifier uniqueness

## Claim Boundary

Allowed current wording:

- "compressed anonymity state research"
- "bounded windows can migrate toward state-tree storage"
- "compressed-state design target"

Blocked wording:

- blocked phrase: `compressed anonymity state is live`
- blocked phrase: `million-user anonymity set`
- blocked phrase: `mainnet compressed nullifier state`
