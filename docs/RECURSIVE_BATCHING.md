# Recursive Settlement Batching

status: research

Recursive batching is a future amortization path for Dark Null settlement proofs. It is not implemented in the current public root.

## Current Proof Lane

The current canonical path verifies one Groth16 proof bundle against the promoted eight-public-input shape:

```text
commitment
nullifier
root
amount
receiver_token_part_0
receiver_token_part_1
mint_part_0
mint_part_1
```

The current tests cover canonical proof generation, verification-key consistency, proof encoding, and malformed-proof rejection.

## Research Target

Recursive batching would let many private settlement proofs roll into an epoch-level proof:

```text
payment proof 0
payment proof 1
payment proof 2
...
payment proof n
  |
recursive verifier / accumulator
  |
epoch proof
  |
Dark Null checkpoint or settlement verifier
```

The purpose is amortization:

- fewer verifier calls per user payment
- batched settlement checkpoints
- compounded anonymity across sub-batches
- lower per-payment proof handling overhead

## Safety Requirements

Recursive batching must preserve:

- nullifier uniqueness across every sub-batch
- root membership for each payment
- amount binding
- receiver token account binding
- mint binding
- proof encoding consistency
- deterministic batch ordering
- batch manifest binding

## Failure Modes To Test

Before any public claim, add tests for:

- duplicate nullifier in one batch
- duplicate nullifier across two batches
- wrong sub-batch root
- wrong receiver token account in one sub-proof
- wrong amount in one sub-proof
- reordered batch vector
- malformed recursive proof
- batch manifest hash mismatch
- verifier-key mismatch between sub-proof and epoch proof

## Activation Blockers

- recursive proof system selected
- recursive circuit or verifier prototype
- epoch public-input format
- nullifier accumulator design
- benchmark comparing single proof and recursive batch cost
- manifest entries for recursive artifacts
- external review of recursive soundness assumptions

## Claim Boundary

Allowed current wording:

- "recursive settlement batching research"
- "future proof amortization path"
- "epoch proof design target"

Blocked wording:

- blocked phrase: `recursive batching is live`
- blocked phrase: `epoch proofs shipped`
- blocked phrase: `one proof settles all payments`
