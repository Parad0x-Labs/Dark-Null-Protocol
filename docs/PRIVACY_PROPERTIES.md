# Privacy properties of the canonical root program

Scope: the canonical root program `35GMe13ExGB1JGp1wZGrEvHfQnENKADroDQApeziKuwV` (devnet) as built from [`src/lib.rs`](../src/lib.rs), the circuit [`circuits/null_proof.circom`](../circuits/null_proof.circom) and its verifying key [`circuits/vk.json`](../circuits/vk.json) (`nPublic = 8`). Reviewed against source on 2026-10-06. Mainnet: no Dark Null program is deployed on mainnet.

**Summary.** Dark Null's root program is a devnet prototype for proof-verified withdrawals. The payout fields (amount, receiver token account, mint) and the note commitment are public, so a withdrawal is linkable to its deposit in the current construction. Unlinkable withdrawals are planned protocol work.

What the current construction does provide: a withdrawal only pays when a Groth16 proof over the note opening verifies on-chain, each note can be spent once, the payout cannot be redirected, and a withdrawal cannot exceed what was deposited against its commitment.

## Reproduction

| Test | Command | What it runs |
|---|---|---|
| [`tests/privacy_linkage.rs`](../tests/privacy_linkage.rs) `withdrawal_is_linkable_to_its_deposit_by_commitment` | `cargo test --locked --test privacy_linkage` (also `npm run test:rust`, and the Rust CI job) | The program entrypoint (`pdx_dark_protocol::entry`) executes two `deposit_wsol_and_whisper` calls with distinct notes and equal amounts, `update_root`, and `prepare_phantom_withdraw_v2` with a real Groth16 proof checked by the on-chain verifier and embedded `VERIFYING_KEY`; SPL Token transfers run in `spl_token::processor`. An observer that receives only instruction data, account keys with signer flags, program logs and account state identifies the spent deposit. |
| [`tests/privacy-linkage.test.mjs`](../tests/privacy-linkage.test.mjs) | `npm run test:privacy` (part of `npm test`) | Checks the fixture against the circuit artifacts by hash, verifies the fixture proof with snarkjs against `circuits/vk.json`, re-derives both deposit commitments from the circuit, and runs the same observer over the public signals. |
| Fixture | `npm run fixture:privacy-linkage` | [`scripts/generate-privacy-linkage-fixture.mjs`](../scripts/generate-privacy-linkage-fixture.mjs) writes [`tests/fixtures/privacy-linkage.json`](../tests/fixtures/privacy-linkage.json) from `circuits/null_proof_js/null_proof.wasm` and `circuits/null_proof_final.zkey`. |

Harness boundary: `initialize` and `init_nullifier_page` only allocate accounts through the system program, so the Rust harness writes those accounts directly with the program's own layouts (`Vault`, `RootAuthorityConfig`, `NullifierPage`). Deposits, the root update and the withdrawal execute through the program entrypoint. The harness does not run a validator; the same instruction path landed on devnet in tx `3wXv6wGS…` (see [`README.md`](../README.md)).

Result recorded by the test:

- deposits observed: 2, equal amounts; candidates by amount: 2
- candidates by commitment equality: **1** (the spent deposit, its depositor and source token account)
- linking field: withdrawal `public_inputs[0]` equals the `commitment` argument of the deposit
- second public path: the vault account's `deposited_amounts` changes only for the spent leaf
- the receiver wallet is a required signer (unsigned receiver is rejected with Anchor error 3010 `AccountNotSigner`)
- swapping `public_inputs[0]` for another deposit's commitment fails with 6004 `InvalidProof`; replaying the nullifier fails with 6000 `DoubleSpend`

## What a chain observer sees

| Data | Visible on-chain | Where |
|---|---|---|
| Deposit amount | yes | `deposit_wsol_and_whisper` arg `amount`; SPL transfer into the vault token account; `Vault.deposited_amounts[leaf]` |
| Withdrawal amount | yes | `prepare_phantom_withdraw_v2` arg `amount`; `public_inputs[3]`; SPL transfer out of the vault token account |
| Depositor account | yes | `user` signer and `user_wsol` source token account of the deposit |
| Receiver token account | yes | `receiver_token` account; `public_inputs[4..5]` |
| Receiver signer | yes | `receiver: Signer` in `PrepareWithdrawV2`; it must own `receiver_token` and sign the withdrawal transaction |
| Mint | yes | `mint` account; `public_inputs[6..7]` |
| Note commitment | yes | deposit arg `commitment`; `Vault.leaves`; withdrawal `public_inputs[0]` |
| Nullifier | yes | withdrawal arg `nullifier_hash`; `public_inputs[1]`; nullifier page accounts |
| Merkle root | yes | `update_root` arg; `Vault.roots`; withdrawal arg `root` and `public_inputs[2]` |
| Leaf index | yes | `LEAF_INDEX:` log; position in `Vault.leaves` |
| Note payload | ciphertext and metadata | `PDX_WHISPER:` (encrypted note bytes), `PDX_EPHEMERAL:` (ephemeral public key) and `PDX_TAG:` (view tag) logs at deposit; plaintext depends on the client's encryption, outside the proof system |
| Note secrets (`blinding`, `nullifier_secret`) and Merkle path | no | private witness inputs to the circuit |
| Real-world identity | not recorded by the program | follows from whatever links the depositor and receiver wallets (and fee payers) to people off-chain |

## Property matrix

| Property | Claim | Observable on-chain | Implementation path | Test | Assumptions | Limitation |
|---|---|---|---|---|---|---|
| Possession / authorization | A withdrawal pays only for a party that knows the opening of a deposited commitment under an accepted root | proof bytes, eight public inputs | `NullProofV2` in `circuits/null_proof.circom`; `verify_withdraw_v2_public_inputs` with `VERIFYING_KEY`; `contains_root`; `debit_withdrawal` | `tests/privacy_linkage.rs`, `tests/canonical-proof-flow.test.mjs`, `tests/malformed-proof.test.mjs` | Groth16 soundness; the setup toxic waste is not held by an attacker; MiMC preimage resistance | Trusted setup is a single-party development setup (see Trusted setup row) |
| Replay resistance | Each note can be withdrawn once | nullifier in args, public inputs and nullifier pages | `record_nullifier` across `NullifierPage` PDAs; circuit `nullifier = MiMC(nullifier_secret)` | `tests/privacy_linkage.rs` (6000 `DoubleSpend`); devnet rejection in `docs/PROJECT_DETAIL.md` | nullifier pages are supplied in order (enforced by PDA derivation and counts) | One withdrawal per note; a partially withdrawn note cannot be spent again |
| Payout binding | A proof cannot be redirected to another amount, token account or mint | amount, receiver token account, mint (public inputs and accounts) | `public_inputs[3..7]` compared to `amount`, `receiver_token`, `mint`; `receiver_token.owner == receiver`; `vault_token` owner/mint checks | `tests/privacy_linkage.rs`, `tests/canonical-proof-flow.test.mjs` (mutated amount rejected) | as above | Binding is achieved by making these fields public; the receiver is fixed when the note is created |
| Solvency per commitment | A withdrawal cannot exceed what was deposited against its commitment | `Vault.deposited_amounts` | `credit_deposit` / `debit_withdrawal` (`InsufficientCommittedDeposit` 6013) | Rust unit test `withdrawal_cannot_exceed_deposited_amount_for_commitment`; devnet rejection in `docs/PROJECT_DETAIL.md` | u64 checked arithmetic | This per-commitment accounting is also what makes the withdrawal linkable (see the unlinkability row) |
| Confidentiality of note secrets | `blinding` and `nullifier_secret` never appear on-chain | none | private circuit inputs; only the commitment and nullifier hashes are public | `tests/privacy_linkage.rs` observer uses public data only | MiMC preimage resistance; client keeps secrets | The encrypted note in `PDX_WHISPER` is produced by the client; its confidentiality depends on that encryption and was not evaluated here |
| Deposit-to-withdrawal unlinkability | **Not provided** | commitment at deposit equals `public_inputs[0]` at withdrawal; the debited `deposited_amounts` slot | `debit_withdrawal(public_inputs[0], amount)` | `tests/privacy_linkage.rs`, `tests/privacy-linkage.test.mjs` assert exactly one candidate | none needed by the observer | Any observer links each withdrawal to its deposit and depositor |
| Amount confidentiality | **Not provided** | deposit and withdrawal amounts, per-leaf totals | instruction args, SPL transfers, `public_inputs[3]` | `tests/privacy_linkage.rs` | none | Amounts are public at both ends |
| Recipient confidentiality | **Not provided** | receiver token account, receiver signer | `public_inputs[4..5]`, `receiver: Signer` | `tests/privacy_linkage.rs` (unsigned receiver rejected) | none | The receiver wallet signs the withdrawal; this program has no relayer path. A one-time receiver address can reduce linkage to a real-world identity, but the address itself is on-chain |
| Depositor confidentiality | **Not provided** | depositor signer and source token account, linked to the withdrawal by commitment | `DepositWsol` accounts | `tests/privacy_linkage.rs` | none | Depositor and receiver are linked through the commitment |
| Anonymity set | **Not provided** | all of the above | depth-7 tree, `LEAF_WINDOW = 128` | `tests/privacy_linkage.rs` (candidate count 1) | none | 128 is a leaf capacity, not an anonymity set; with the commitment public, the set for a withdrawal has one member |
| Trusted setup | The verifying key is generated from the published zkey | `src/verifying_key.rs`, `circuits/vk.json` | [`CEREMONY.md`](../CEREMONY.md), `npm run check:ceremony` | `tests/verification-key-consistency.test.mjs` | the single contributor discarded its toxic waste | Single-party development setup. Whoever held the toxic waste could produce proofs for arbitrary public inputs, including another depositor's commitment and a new receiver; per-commitment solvency still caps the payout at the deposited amount |
| Root updater | Only the configured authority posts roots | `update_root` signer, `Vault.roots` | `RootAuthorityConfig` PDA, `has_one = authority`, duplicate-root rejection | Rust unit test `root_authority_rejects_unauthorized_signer` | the authority key is held safely | Trusted for liveness: withdrawals need a posted root that the proof's path resolves to. The program does not recompute roots from `Vault.leaves`; because withdrawals debit the per-commitment record, a malicious root does not let a prover take more than was deposited against a commitment whose opening it knows |

Integer encoding: the circuit has no range constraint on `amount`; the program encodes the instruction's `u64` amount itself (`encode_u64_public_input`) and requires `public_inputs[3]` to equal it, so the payout and the solvency debit use the same `u64` value.

## Other Dark Null code paths

- The legacy `prepare_phantom_withdraw` path is fail-closed and pays nothing.
- `burn_and_whisper` burns tokens and logs a note payload; it records no commitment.
- The fixed-denomination relayer pool in `dna-x402` (`programs/dark_shielded_pool`) is a separate construction with different public inputs. This document does not cover it, and its properties need their own reproduction before they are claimed.

## Wording to use

- Use: "devnet prototype for proof-verified withdrawals", "payout-bound withdrawal proof", "amount, receiver token account, mint and note commitment are public", "withdrawals are linkable to deposits in the current construction", "unlinkable withdrawals are planned protocol work".
- Do not use for the root program: hidden amounts, hidden sender or recipient, unlinkable withdrawals, anonymity set size, or any mixer comparison that implies unlinkability.
