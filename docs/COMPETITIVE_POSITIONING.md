# Dark Null Competitive Positioning

*Last updated: May 2026*

Dark Null should win on verifiable evidence, not posture. The canonical root now publishes the program source, IDL, manifest, circuit, zkey, wasm, verifying key, SDK helpers, and a reproducible local Groth16 proof flow.

## Current Position

| Track | Dark Null status |
|---|---|
| Proof system | Groth16 on BN254 |
| Current verifier wire ABI | 256 bytes (`proof_a[64]`, `proof_b[128]`, `proof_c[64]`) |
| Compressed proof target | 128 bytes |
| Canonical proof flow | Reproducible with `npm run test:all` |
| Setup evidence | Development setup report is public; final mainnet setup evidence is still required |
| Payout safety | Legacy path fail-closed; v2 payout verifies amount, receiver token account, and mint before transfer |
| Audit status | No completed third-party audit |
| Mainnet status | Not released for mainnet |

## Why This Can Beat Heavier Privacy Stacks

Dark Null's strongest lane is Solana-native settlement with a small BN254 Groth16 proof surface and direct public artifact binding. A validator-run privacy L2 can add networking, slashing, and operator economics, but it also adds trust seams and operational burden. Dark Null should stay sharper: prove the circuit, bind the verifier, fail closed when semantics are not bound, and make every claim reproducible from the repo.

## Public Message

Dark Null is the evidence-first privacy settlement root for Solana: compact Groth16 proofs, canonical artifacts, reproducible tests, and no unsupported audit or launch claims.

Use the aggressive line only where the repo backs it:

```text
256-byte current verifier ABI. 128-byte compressed proof target. Public artifacts. Public tests. Payout-bound v2 withdraw.
```

## Advantages To Press

- **Small proof target:** 128-byte compressed proof class, with the current public ABI honestly documented as 256 bytes.
- **Verifier evidence:** root Rust verifier, `vk.json`, `null_proof.circom`, wasm, zkey, and manifest are all published together.
- **Setup honesty:** `CEREMONY.md` records the current setup boundary instead of implying a public ceremony that did not happen.
- **Payout-bound withdraw:** the promoted v2 path verifies amount, receiver token account, and mint before transfer; the legacy proof-unbound path stays closed.
- **SDK distribution:** `@dark-null/protocol` exposes IDL, network config, canonical artifact helpers, proof encoding metadata, and v2 public-input encoders.
- **Reviewability:** historical tracks are separated from the canonical root instead of being implied as one deployment.

## Gaps To Close Next

- Keep release integrity active: checksums, SBOM, and Sigstore attestations.
- Keep high-signal security automation active: CodeQL, strict npm audit gates, and deterministic malformed-proof tests.
- Publish a proof-size benchmark that validates both current ABI bytes and compressed target bytes.
- Replace development setup evidence with final mainnet setup evidence or explicit audit acceptance.
- Keep third-party audit and mainnet claims out until the evidence exists.

## Market Narrative

Dark Null is not trying to be a generic validator network. It is the compact, evidence-first Solana privacy settlement track: fewer moving parts, smaller proof target, public artifacts, and no fake readiness claims. The product standard is simple: if the repo cannot prove it, the docs must call it roadmap.
