# Review guide: Dark-Null-Protocol

A short reading path for people and AI reviewers. It says what this repository contains, what has been
demonstrated, where it runs, and what is not established. The capability table is generated from
[`evidence/claims.json`](./evidence/claims.json) and checked in CI by
[`scripts/check-claims-registry.mjs`](./scripts/check-claims-registry.mjs). The delivered-versus-blocked
boundary is also kept in [`docs/CLAIMS_LEDGER.md`](./docs/CLAIMS_LEDGER.md).

| Snapshot | |
|---|---|
| Commit checked | `57e353fee8986698359a53b6d659093cc70acd28` (`main`, observed 2026-10-06 08:23 UTC) |
| npm registry checked | 2026-10-06 08:23 UTC (`@dark-null/protocol` is not published) |
| Devnet checked | 2026-10-06 08:26 UTC |

Read in this order: this page, then [`docs/PRIVACY_PROPERTIES.md`](./docs/PRIVACY_PROPERTIES.md) (what an on-chain observer sees), then
[`SECURITY_MODEL.md`](./SECURITY_MODEL.md) and [`src/lib.rs`](./src/lib.rs).

## What it is

A devnet prototype of a shielded pool on Solana in which a withdrawal pays out only after a Groth16 proof
verifies on-chain. The proof is bound to the payout amount, receiver token account and mint, and a nullifier
stops a note being spent twice. Amount, receiver, mint and the note commitment are public inputs, so the
current construction does not hide which deposit a withdrawal spends; see
[`docs/PRIVACY_PROPERTIES.md`](./docs/PRIVACY_PROPERTIES.md).

## Component boundaries

| Component | Path | What it is | Runs where |
|---|---|---|---|
| Root program | `src/lib.rs` | Anchor program `35GMe13…`: deposits, root updates, `prepare_phantom_withdraw_v2` with `groth16-solana` verification | Devnet |
| Circuit and artifacts | `circuits/` | `null_proof.circom`, final zkey, wasm, `vk.json`, hash-pinned in `MANIFEST.json` | Local proving |
| SDK and Python client | `sdk/`, `client/` | Encoders, network config, proof packing | Local; not on npm |
| Swarm modules | `swarm/` | Private x402 receipt wrapper and frontier prototypes | Local |
| Integration programs | `programs/` (6) | Native programs, each with its own devnet ID | Devnet |
| dna-x402 `dark-*` crates | other repository | Not used here. Similar names, separate code; see [dna-x402 `docs/DARK_CRATES_STATUS.md`](https://github.com/Parad0x-Labs/dna-x402/blob/main/docs/DARK_CRATES_STATUS.md) | — |

## Capability table

Columns: **Exists in source** is the implementation status and main path at the snapshot commit.
**Demonstrated** is what code or a recorded run shows. **Where it runs** names the network for anything
deployed. **Not established** lists what a reader should not infer.

<!-- claims-table:start (generated from evidence/claims.json; edit the registry, then run scripts/check-claims-registry.mjs --write) -->
| ID | Capability | Exists in source | Demonstrated | Where it runs | Not established |
|---|---|---|---|---|---|
| `dark-null.groth16-withdraw` | The root program pays a withdrawal only after an on-chain Groth16 proof over eight public inputs verifies. | prototype: `src/lib.rs` | verifier: groth16-solana Groth16Verifier over the alt_bn128 syscalls with the embedded VERIFYING_KEY (vk.json SHA-256 6abfff44...3d63a); circuit, zkey, wasm and vk.json pinned by SHA-256 in MANIFEST.json; devnet transaction 3wXv6wGS... (slot 487904628) invoked this program ID and succeeded (test: pass 2026-10-06) | devnet `35GM…KuwV` | that the current devnet bytes are the build that ran 3wXv6wGS...: the program was last deployed at slot 487918755, after that transaction; a reproducible build hash binding devnet bytes to this commit; a multi-party trusted setup; mainnet deployment (none) |
| `dark-null.payout-binding` | prepare_phantom_withdraw_v2 binds the proof to the amount, receiver token account and mint. | implemented: `src/lib.rs` | amount, receiver token account and mint are public inputs 3 to 7; a proof for one destination does not verify for another; commitment accounting refuses a withdrawal above the amount deposited against the commitment (test: pass 2026-10-06) | local / off-chain | hiding of amount, receiver or mint: these are public by construction (see docs/PRIVACY_PROPERTIES.md) |
| `dark-null.privacy-properties` | Which deposit and withdrawal fields an on-chain observer can see, and which properties the prototype protects. | prototype: `src/lib.rs` | possession of a deposited note opening is required to withdraw; nullifier replay is refused; payout cannot be redirected; note secrets stay private witness inputs (test: partial 2026-10-06) | local / off-chain | deposit to withdrawal unlinkability: the withdrawal's public input 0 equals the deposit commitment, so the spent deposit is identifiable; amount confidentiality; an anonymity set: a depth-7 tree has 128 leaf positions, which is capacity, not a measured set |
| `dark-null.integration-programs` | Six native integration programs from programs/ are deployed on devnet. | prototype: `programs/silent-pay/src/lib.rs` | all six program accounts exist on devnet (last deployed between slots 487904982 and 487905446) | devnet (6 programs) | ZK properties: fiat-oracle and inference verify oracle signatures, accumulator is a rolling SHA-256 hash, not a folding scheme; build hashes binding devnet bytes to this commit; end-to-end runs in this review pass |
| `dark-null.private-x402-receipts` | Private x402 receipt primitives wrap a DNA x402 signed receipt without storing raw URLs or payment headers. | implemented: `swarm/x402.mjs` | resource URL stored as a hash; receipt locks header hashes, proof bundle hash and previous receipt hash (test: pass 2026-10-06) | local / off-chain | a hosted x402 merchant gateway; on-chain privacy of the underlying payment |
| `dark-null.frontier-prototypes` | Six frontier modules (receipt DAG, batch settlement, ZK access receipts, Piano PIR, blind tokens, x402 privacy extension) exist as local prototypes with tests. | prototype: `swarm/receipt-dag.mjs` | in-process modules with unit tests (test: pass 2026-10-06) | local / off-chain | persistent services or deployments; the ZK access receipt uses an HMAC token, not a ZK circuit; batch settlement is sequential O(N) verification, not aggregation |
| `dark-null.sdk-package` | The JavaScript SDK @dark-null/protocol is used from a clone of this repository. | implemented: `sdk/index.mjs` | proof and public-input encoders, network config, IDL export (test: pass 2026-10-06) | local / off-chain; `@dark-null/protocol` git 1.2.1, not on npm | npm publication (the package name is not on the registry) |
| `dark-null.separate-from-dna-crates` | The Dark Null verifier is a separate program from the similarly named dark-* crates and programs in dna-x402. | implemented: `src/lib.rs` | no Cargo dependency in either direction; the only shared artifact is circuits/vk.json, byte-identical to dna-x402 evidence/zk/vk.json | local / off-chain | a finding about one repository's crates applies to the other; each is assessed separately |
| `dark-null.mainnet` | A Dark Null program is deployed on mainnet. | planned: `docs/CLAIMS_LEDGER.md` | none recorded | n/a (not implemented) | any mainnet deployment; the gates are listed in docs/CLAIMS_LEDGER.md (Blocked Claims) |
<!-- claims-table:end -->

## Deployment identity

- Root program `35GMe13ExGB1JGp1wZGrEvHfQnENKADroDQApeziKuwV` on devnet, upgrade authority
  `4cTBfB8vJK8YiCBcVrvZV4wx89AFzGEbm7LLghJsNUyD`, last deployed in slot 487918755.
- The proof-verified payout transaction cited in the README (`3wXv6wGS…`, slot 487904628) succeeded against
  this program ID before that last deployment. A build hash tying the current devnet bytes to a commit is not
  recorded yet.
- No Dark Null program is deployed on mainnet.

## Reproduce

```bash
git clone https://github.com/Parad0x-Labs/Dark-Null-Protocol && cd Dark-Null-Protocol
node scripts/check-claims-registry.mjs   # registry and this table
npm ci --ignore-scripts
npm test                                 # repo checks plus SDK, config, x402, artifact and frontier suites
npm run test:proof                       # proof encoding and malformed proofs
npm run release:verify                   # MANIFEST.json hash pins
cargo test --locked                      # root program
solana program show 35GMe13ExGB1JGp1wZGrEvHfQnENKADroDQApeziKuwV --url devnet
```

A green CI run shows the tests pass at a commit. It is not an external security review or a privacy proof,
and no completed external security review is claimed.
