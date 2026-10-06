# Dark NULL v2: Private Agent Payments on Agave (DESIGN_2027)

status: design. Branch `design/agentic-private-payments-2027`. Written 2026-10-06. Updated 2026-10-06 with the
Phase 0 measurements in [`PHASE0_RESULTS.md`](./PHASE0_RESULTS.md) ([M] values below cite it).
Byte-level rules are normative in [`spec/V2_SPEC.md`](./spec/V2_SPEC.md); where this document differs, the spec
governs (V2_SPEC section 14 lists the differences).
Companions: [`PLAN_2027.md`](./PLAN_2027.md) (build plan, gates, port plan) and
[`CLAIMS_POLICY.md`](./CLAIMS_POLICY.md) (what may be said, when).

## 0. Summary

Dark NULL v2 is a shielded multi-asset note pool on Solana built for software agents that pay for
HTTP resources through x402. Four layers:

1. **Shielded pool v2.** Poseidon note commitments in an on-chain depth-32 Merkle tree updated with the
   `sol_poseidon` syscall. A single universal 2-in/2-out join-split circuit with in-circuit value
   conservation and 64-bit range checks. Position-bound nullifiers. Groth16 over BN254 on devnet, verified
   with the `alt_bn128` syscalls. The mainnet track is Groth16 with a public multi-party phase-2 ceremony
   (section 8; Phase 0 measured PLONK proving at 73.6 s for the Phase 1 circuit). Deposit and spend are unlinkable, in-pool amounts are hidden, any amount is
   allowed, and a relayer pays the fees.
2. **Agent payment branches inside the same circuit:**
   - delegated agent keys bounded by a principal's spend policy (per-payment cap, merchant allowlist,
     expiry, budget);
   - unidirectional payment channels whose escrow is itself a shielded note. This is the shielded
     counterpart of the x402 `batch-settlement` scheme: one on-chain settlement per merchant per epoch.
3. **x402 binding through DNA x402.** Two schemes, `dark-null-exact` and `dark-null-batch`. Quote
   hashes go into the proof's external-data hash. Merchant receipts and agent vouchers form a
   two-signed chain that is anchored once per epoch.
4. **Compliance surface.** Association-set membership proofs (Privacy Pools model) with a ragequit exit,
   plus hierarchical viewing keys.

Design rules that close the recorded risks:

- No elliptic-curve or Poseidon arithmetic is emulated in BPF. Every on-chain curve or hash operation
  is a syscall.
- No in-circuit curve arithmetic is non-native. The only in-circuit curve is BabyJubJub, which is
  defined over the BN254 scalar field.
- Folding is never on the privacy-critical path.

```
 principal (human / org)                      merchant (x402 seller, DNA x402 server)
   | funds + policy                              ^  vouchers (off-chain, per request, < 1 ms)
   v                                             |  signed receipts (DNA x402)
 agent runtime --- shielded notes --- channel note (escrow) --- close per epoch --+
   | (local keys, local prover)                                                   |
   v                                                                              v
 relayer ---> dark_null_pool_v2 (Agave): verify Groth16 via alt_bn128 syscalls,
              insert leaves via sol_poseidon, record nullifiers, solvency guard, payouts
```

## 1. Evidence labels used in this document

| Label | Meaning |
|---|---|
| **[V]** | Verified against the cited source on the cited date |
| **[M]** | Measured by a recorded run. The run and its date are named |
| **[E]** | Engineering estimate, derived as shown. Must be replaced by a benchmark before any claim |
| **[R]** | Open research question with a kill rule (section 11) |
| **[U]** | Could not be verified from a primary source. Not used for decisions |

"Prior internal research (Aug 2026)" refers to Parad0x Labs' internal folding-settlement experiments of
2026-08-25 and 2026-08-26. Their measured numbers are quoted with that attribution. Their code is
ported under Dark NULL names per PLAN_2027.md section 4.

## 2. What is new

### 2.1 What exists today

Survey date 2026-10-06. Re-check every row within 30 days of any public use (CLAIMS_POLICY.md).

| System | Chain / status | What it hides | Mechanism | Relevant limits for agents | Source |
|---|---|---|---|---|---|
| Token-2022 Confidential Transfers | Solana mainnet. ZK ElGamal proof program re-enabled (gate `zkexuyPRdyTVbZqEAREueqL2xvvoBhRgth9xGSc1tMN`, mainnet epoch 982) after the June 2025 disable | Amounts | Twisted ElGamal + sigma/range proofs, no trusted setup | Sender and recipient addresses public; mint opt-in; one proof set per transfer | [V] `solana feature status` 2026-10-06; solanacompass.com news 2026-06-18; solana.com/news/post-mortem-june-25-2025 |
| Privacy Cash | Solana mainnet since Aug 2025 | Deposit-to-withdraw link; in-pool amounts | Circom Groth16, 2-in/2-out join-split, Poseidon tree depth 26, 100-root history, 7 public inputs | No compliance exit; one proof per payment; no agent or x402 surface | [V] Privacy Cash docs (how-it-works, groth16-verification), accessed 2026-10-06 |
| Umbra (Solana) | Solana mainnet (private Feb 2026, public wallet 2026-03-27) | Balances, transfers | Arcium MPC encrypted token accounts | Depends on MPC cluster availability and trust; no batching; not agent-oriented | [V] theblock.co/post/394892 |
| Arcium | Mainnet alpha 2026-02 | General confidential compute | MPC execution environments | Infrastructure, not a payment protocol; MPC round latency per payment | [V] theblock.co/post/387564 |
| Helius Rings | Devnet private beta; mainnet target Aug-Oct 2026 | Confidential ring: asset + amount. Anonymous ring: also sender/recipient | ZK on Poseidon + alt_bn128; operator-configured allow/block lists, thresholds, viewer access | Compliance is operator policy, not membership proofs; no x402 or channel surface found | [V] solanacompass.com (Helius CEO statements); current mainnet status [U] |
| Light Protocol ZK Compression | Solana mainnet; V2 batched trees (state height 32, address height 40) | Nothing (state cost compression) | Groth16 validity proofs, ~100k CU per proof | Public state | [V] github.com/Lightprotocol/light-protocol `batched-merkle-tree/src/constants.rs`; zkcompression.com docs |
| Elusiv | Solana mainnet 2023; sunset announced 2024-02-29 (team became Arcium) | Deposit-to-withdraw link | Shielded pool | Discontinued | [V] helius.dev/blog/solana-privacy |
| x402 `batch-settlement` / `upto` | Spec at docs.x402.org; Coinbase facilitator supports `upto` on Solana through an escrow + voucher payment-channel program | Nothing | Escrow deposit + signed cumulative vouchers (Ed25519 on SVM), batch redemption | Payer, merchant and amounts public on-chain | [V] docs.x402.org/schemes/batch-settlement.md; solanacompass.com 2026-09-18 |
| Privacy Pools (0xbow) | Ethereum mainnet since 2025-03-31 | Deposit-to-withdraw link | Groth16, LeanIMT depth up to 32, ASP root + ragequit | Ethereum only; one label per deposit | [V] theblock.co/post/348959; l2beat.com/privacy/projects/privacy-pools (2026-05-28) |
| Railgun | Ethereum, Arbitrum, Base | Link, amounts | Groth16 (54 circuits); Private Proofs of Innocence | PPOI enforced by wallets/broadcasters, not by the protocol | [V] l2beat.com/privacy/projects/railgun (2026-09-11) |
| Aztec | Alpha network (V5 since 2026-07-21) | General private execution, private account contracts | UltraHonk/CHONK (folding of private call stacks) | Not Solana | [V] aztec.network blog; l2beat zk-catalog |
| Zcash Orchard | Zcash mainnet | Link, amounts | Halo2, no trusted setup, depth-32 tree | Not Solana | [V] orchard book `design/nullifiers.md` |
| Anonymous payment channels (Bolt, Green and Miers, CCS 2017) | Research construction for Zcash-style currencies | Channel payments | Blind signatures / commitments | Not deployed on Solana [U] | Citation from the literature; verify the link before publication |

### 2.2 What this design adds

Each item below is a specific combination that was not found anywhere in the 2026-10-06 survey. None of
them is described as "first". Each gets publication wording only after its gate passes
(CLAIMS_POLICY.md).

| # | New element | Closest existing work | Delta |
|---|---|---|---|
| N1 | **Shielded x402 batch settlement.** A unidirectional channel whose escrow is a shielded note. Open and close are pool transactions with the same shape as any other transaction. Vouchers are verified off-chain per request and in-circuit only at close. One settlement per merchant per epoch | x402 `batch-settlement` (public); Bolt (research, not on Solana) | Same voucher semantics as the x402 scheme, but merchant, amounts and payer are hidden on-chain. The channel lives inside the anonymity set |
| N2 | **Delegated agent keys with in-circuit spend policy.** The note owner is `Poseidon(principal_pk, agent_pk, policy_root)`. The agent can spend only within cap, allowlist, expiry and budget, and change returns to the same policy owner. The principal can revoke at any time | Swig and Squads Grid (public on-chain policies); Aztec private account contracts (other chain) | Policy enforced by the proof inside a Solana shielded pool. The chain learns neither the policy nor the agent |
| N3 | **Association-set membership proofs on Solana, with ragequit** | 0xbow Privacy Pools (Ethereum); Rings operator policies | Cryptographic exit rather than an operator gate, on Solana, combined with join-split label rules (section 5.7) |
| N4 | **Quote-bound private receipts.** The x402 quote binding hash enters the proof's `ext_data_hash`. Merchant-signed receipts and agent-signed vouchers chain into one log, and its salted head is anchored at epoch close | DNA x402 signed receipt chain (public settlement); repo `swarm/x402.mjs` (hash-only receipts after a public payment) | The receipt is bound to a private settlement instead of to a public transfer |
| N5 | **Syscall-only verification inside Agave budgets.** Every on-chain curve and hash operation is a syscall, and per-transaction CU is benchmarked (B2) | groth16-solana and Light (syscall verifiers) | A design rule plus an enforced budget, not a new primitive |
| N6 | **No Dark NULL-operated trusted setup.** Mainnet keys come from a public multi-party phase 2 on Perpetual Powers of Tau (changed by Phase 0: a PLONK prover meeting B1 is a research item, R-PLONK-PROVER), with gate B5 | Railgun / Privacy Pools (public phase-2 ceremonies); Zcash (Halo2, no setup) | Universal SRS reused directly; no circuit-specific phase 2 |

The pool layer (item 1 of section 0) is at parity with deployed systems such as Privacy Cash. It is a
prerequisite, not a novelty claim.

## 3. Threat model and privacy goals

### 3.1 Actors and adversaries

| Actor | Trust assumption |
|---|---|
| Agent (payer) | Holds its own spend key locally. May be compromised; damage is bounded by policy (section 5.6) |
| Principal | Funds agents and sets policy. Can revoke |
| Merchant (x402 seller) | Learns what it is paid and the channel it is paid through. Must not learn the payer's identity, other balances or other merchants |
| Relayer / facilitator | Sees proofs and IP-level metadata. Cannot redirect funds or change fees: both are bound by `ext_data_hash` |
| Chain observer | Sees all transactions. Must not link deposits to spends, see in-pool amounts, or learn merchants |
| Association-set provider (ASP) | Publishes approved-label roots. Can shrink the anonymity set of users who choose it. Cannot steal funds or block ragequit |
| Indexer / RPC | Sees query patterns. Mitigated by local scanning, view tags, and an optional PIR path (repo `swarm/piano-pir.mjs`) |
| Program upgrade authority | Trusted during devnet phases. Disclosed in every release note |

### 3.2 Goals

| ID | Goal | Mechanism | Property test |
|---|---|---|---|
| G1 | Unlinkable deposit to spend | Spends reveal only a nullifier and a Merkle root; the spent leaf stays hidden | P-UNLINK: no public field of a spend equals or is derivable from any public field of its deposit |
| G2 | Hidden amounts inside the pool | Values live only inside commitments; only the public legs (deposit, withdraw) carry an amount | P-AMOUNT |
| G3 | Recipient privacy | In-pool payments go to shielded addresses. Public withdrawals go to one-time stealth addresses (dna-x402 `crates/dark-stealth-ed25519`) | P-RECIP |
| G4 | Transaction shape uniformity | One circuit, always 2-in/2-out, constant `ext_data` size with padding. Deposits, transfers, channel opens and closes are indistinguishable except for the public-amount sign | P-SHAPE: byte length and account list are identical across all transact kinds |
| G5 | Timing and metadata hygiene | Channels remove per-request chain events; relayer submission; optional randomized submit delay; local note scanning | B6 linkability benchmark (section 10) |
| G6 | Relayer safety | `ext_data_hash` binds recipient, relayer, fee and ciphertexts | X-RELAY: a modified field makes the proof fail |
| G7 | Compliance exit | Association-set proof at exit, ragequit for depositors, viewing keys | B4, VK-* |
| G8 | Bounded agent authority | In-circuit policy branch | POL-* |
| G9 | Solvency | In-circuit conservation + range checks; pool-level supply counter per mint; vault balance invariant | T-SOLV |

### 3.3 What leaks, stated plainly

- Public legs leak. Deposit and withdraw amounts and mints are visible, and amount fingerprints are a
  leading deanonymization signal. Railgun studies found 17.65% of withdrawals uniquely linkable
  ([V] arXiv 2606.25926, 2026-06-24) and anonymity sets reduced 40.1-59.0% with public-token
  constraints as the strongest pruning signal ([V] arXiv 2608.22987, 2026-08-24).
- The SDK therefore defaults to rounded public-leg amounts and delayed, split withdrawals. Agents that
  stay inside the pool, paying merchants who also stay inside, avoid this class entirely.
- Merchants learn the channel cap and the per-request amounts of their own channels.
- Relayers and RPC providers see network metadata unless the runtime uses Tor/Nym-class transport.
- The ASP chosen at exit is public.

## 4. Keys, notes and hashing

### 4.1 Hash parameters

Everything is Poseidon over BN254 Fr, x^5 S-box, with circom/light-poseidon round constants and widths
2-13 (1-12 inputs). This is exactly what `sol_poseidon` implements ([V] anza-xyz/solana-sdk
`poseidon/src/lib.rs`; syscall gate `FL9RsQA6TVUoh5xJQ9d936RHSebA1NLQqe3Zv9sXZRpr`, active on mainnet
since epoch 644; cost `61*n^2 + 542` CU, [V] agave `program-runtime/src/execution_budget.rs`). SIMD-0359
input padding enforcement is active (mainnet epoch 940).

The same parameter set is used in three places:

- the circuit, via circomlib `Poseidon(n)`;
- the client, via light-poseidon, already wrapped in dna-x402 `crates/dark-poseidon-real`;
- the chain, via the syscall.

Test vector V-POS pins all three to identical outputs for n = 1..12.

Domain separation: every hash takes a first input `DS_*`, a distinct constant field element. The list is
fixed in the P0 spec. Every Fr crossing a boundary uses canonical 32-byte big-endian encoding, and the
program rejects non-canonical values (`>= r`), as v1 already does.

Note: the folding experiments of prior internal research used a different Poseidon configuration
(arkworks "paper" config, width 5). That configuration is not syscall-compatible. Section 7.3 and
PLAN_2027.md section 4 move every ported component to the syscall parameter set.

### 4.2 Keys

Proving and spend authorization are separate. The same split exists in Zcash Sapling/Orchard between
the proof-authorizing key and the spend-authorizing key.

- The prover holds only viewing-level material.
- Spending additionally needs an EdDSA-Poseidon signature over BabyJubJub by `ask` on a transaction
  digest (`sighash`). The signature is verified **inside** the circuit and never appears on-chain.
- A wallet layer can therefore hold `ask` in-process and never hand it to the prover. Section 12
  depends on this.

| Key | Derivation | Held by | Use |
|---|---|---|---|
| `seed` | 32 random bytes, generated locally | wallet layer only | Root secret, never exported |
| `ask` | BabyJubJub scalar, `HKDF(seed, "dnull-ask" ‖ account_index)` | wallet layer only | Spend authorization (signs `sighash`) |
| `ak` | `ask * G_bjj` (public point) | prover, public | Verification key for the in-circuit signature check |
| `pk` | `Poseidon(DS_PK, ak.x, ak.y, nk)` | public | Spend identifier inside owner fields. Binding `nk` here makes the nullifier key a property of the note's owner; without it a spender could pick a second `nk` and derive a second valid nullifier for one note (Phase 0 finding F-NK) |
| `nk` | `Poseidon(DS_NK, HKDF(seed, "dnull-nk" ‖ account_index))` | prover | Nullifier key (viewing-level: detects spends, cannot spend) |
| `ivk` | X25519 secret, `HKDF(seed, "dnull-ivk" ‖ account_index ‖ diversifier)` | prover | Decrypts incoming notes |
| `ovk` | `HKDF(seed, "dnull-ovk" ‖ account_index)` | prover | Encrypts sender-side copies and disclosure records |
| `fvk` | `(ak, nk, ivk, ovk)` | prover | Full viewing key: sees receipts and spends, cannot spend |
| `bjj_session` | BabyJubJub key, `HKDF(seed, "dnull-chan" ‖ chan_nonce)` | wallet layer only | Signs channel vouchers |
| `K_scope` | `HKDF(ovk, "dnull-scope" ‖ agent_index ‖ period_id)` | prover; exported only on opt-in | Scoped viewing key for one agent and one period (section 5.8) |

`sighash = Poseidon(DS_SIGHASH, nf0, nf1, cm0, cm1, public_amount, public_asset, ext_data_hash, claimed_epoch)`

- The program accepts `claimed_epoch` within one epoch of `Clock`.
- `ext_data_hash` covers the relayer fee, so the signature also covers the fee.
- All non-dummy inputs of a transact must share one owner, so one authorization signature suffices.

A shielded address encodes `(owner, ivk_pub, diversifier)` as bech32m with HRP `dnull`. The `owner` field
is described in section 5.6. Diversified addresses share the owner key, so they separate scanning keys but are
linkable to each other; per-merchant receive addresses that must be unlinkable use separate account indices
(V2_SPEC 4.3).

### 4.3 Note

```
note = (value: u64, asset: Fr, owner: Fr, salt: Fr, label: Fr)
asset = Poseidon(DS_ASSET, mint[0..16], mint[16..32])
cm    = Poseidon(DS_NOTE, value, asset, owner, salt, label)     # 6 inputs
nf    = Poseidon(DS_NF, nk, cm, leaf_index)                     # position-bound
```

- Position binding in `nf` makes two notes with identical commitments, placed at different leaves,
  produce different nullifiers. This closes the duplicate-commitment class that Zcash Sapling also
  addresses.
- `nk` is per owner. For delegated and channel owners, section 5 defines who holds it.
- Ciphertext: `epk (32) || ChaCha20-Poly1305(note opening || memo 32) || view_tag (1)`, padded to a
  constant 160 bytes. The view tag is the first byte of `H(shared secret)`; with it, a scanner skips
  255/256 of foreign notes (ERC-5564 uses the same technique: [V] eips.ethereum.org/EIPS/eip-5564).

## 5. The transact circuit

A single universal circuit, `transact_v2`. Every pool interaction (deposit, transfer, withdraw, channel
open, channel close, policy spend, ragequit) is one proof of this circuit with selector bits. One
circuit means one verifying key, so the verifier key never reveals the transaction kind (goal G4).

### 5.1 Public inputs

The program and the circuit both compute

`pi = Poseidon(DS_PI, root, nf0, nf1, cm0, cm1, public_amount, public_asset, ext_data_hash, now_epoch, deposit_label, assoc_root)`.

That is 12 inputs, the syscall maximum. `pi` is the single Groth16 public input:

- the program side costs `61*144 + 542 = 9,326` CU [V formula];
- the Groth16 verify then sits at the 1-input point, 78,293 CU ([V] groth16-solana README);
- the alternative, 11 separate public inputs, extrapolates to about 122k CU [E] from the README's
  1/2/4/8-input points.

B2 measures both variants.

| Field | Meaning |
|---|---|
| `root` | A root in the pool's root history |
| `nf0, nf1` | Nullifiers (dummy inputs get random-salt nullifiers, indistinguishable from real ones) |
| `cm0, cm1` | Output commitments |
| `public_amount` | Signed field: deposit > 0, withdraw < 0, transfer 0. The program enforces abs < 2^64 |
| `public_asset` | Asset id of the public leg (0 if none) |
| `ext_data_hash` | `sha256(borsh(ext_data))` truncated to 248 bits |
| `now_epoch` | `claimed_epoch` from `sighash`. The program accepts it only within one pool epoch of the `Clock` sysvar (epoch length set in pool config) |
| `deposit_label` | Program-assigned label for deposits (section 5.7); 0 otherwise |
| `assoc_root` | Chosen ASP root (section 5.7); 0 when not required |

`ext_data = { recipient_token_account, relayer, relayer_fee, ciphertext0, ciphertext1, ciphertext_rec, memo_binding, root_hint }`
(final 649-byte layout in V2_SPEC 7.3: adds `version`, `pool_id` and `stealth_ephemeral`; `root_hint` moves to the
instruction data).
`ciphertext_rec` is a constant-size scoped disclosure record (section 5.8). Random bytes fill it when it is
unused, so its presence leaks nothing.

`memo_binding` carries the x402 quote binding (section 6) or the epoch receipt-chain head. The relayer
cannot change any field without invalidating the proof.

### 5.2 Constraints

1. **Inputs (i = 0, 1).**
   - Recompute `cm_i`.
   - If `value_i != 0`, prove Merkle membership of `cm_i` under `root` (depth 32).
   - Compute `nf_i = Poseidon(DS_NF, nk_i, cm_i, idx_i)`.
   - Spend authority per section 5.6.
2. **Outputs (j = 0, 1).** `cm_j = Poseidon(DS_NOTE, ...)`, with `value_j` range-checked to 64 bits
   (Num2Bits(64)).
3. **Conservation.** `value_in0 + value_in1 + public_amount == value_out0 + value_out1`.
   - All four note values are less than 2^64 and the program bounds `public_amount`, so the equation
     cannot wrap modulo r.
   - Single asset per transact: all non-dummy notes share `asset`, and `public_asset == asset`
     whenever `public_amount != 0`.
4. **Label rules.** Section 5.7.
5. **Branch rules** for policy and channel. Sections 5.5 and 5.6.
6. **`ext_data_hash` binding.** It is a public input, so no extra constraint is needed beyond its
   presence in `pi`.

### 5.3 Size estimate

| Component | Constraints [E] |
|---|---|
| 2 Merkle paths, depth 32, Poseidon(2) about 240 each | ~15.5k |
| 4 note commitments, Poseidon(6) | ~1.6k |
| 2 nullifiers, owner derivations, key checks | ~2.0k |
| Spend authorization: EdDSA-Poseidon (BabyJubJub, native) over `sighash` | ~4-7k |
| Range checks (4 x 65) | ~0.3k |
| `pi` Poseidon(12) | ~0.5k |
| Channel branch: EdDSA-Poseidon (BabyJubJub, native) voucher verification | ~4-7k |
| Policy branch: allowlist path depth 16 + comparisons | ~4.2k |
| Association branch: label membership depth 20, two paths (cross-label merge; section 5.7) | ~10k |
| **Total** | **~43-49k**, below 2^16 (65,536) |

Measured in Phase 0 [M]:
- the principal-branch skeleton (`spikes/p0/circuits/transact_v2_skeleton.circom`) is 23,155 constraints;
- a full-size proxy with the channel EdDSA, allowlist and association paths added is 40,914 constraints.

Native Groth16 proving (arkworks, 4 vCPU of an Apple M4):
- skeleton: p50 260 ms, 108 MB;
- full-size proxy: p50 433 ms, 184 MB (1,291 ms single-threaded).

The browser figure (about 3-8 s) remains [E]. Every branch's constraints are always present. That cost buys shape uniformity (G4). If B1 misses
its gate, the fallback is two circuits (plain / agent), with the leak documented.

### 5.4 Merkle tree and Poseidon budget

- Depth 32, the same as Zcash Orchard and Light V2 state trees ([V] sources above), for 2^32 leaves. No
  migration is planned.
- Insertion: each transact inserts its two outputs as an aligned depth-1 subtree, so 1 + 31 = 32
  Poseidon(2) syscalls, 32 x 786 = 25,152 CU [V formula].
- Root history: a ring of 256 roots (8 KiB). The client passes `root_hint`, and the program checks
  `roots[hint] == root` in O(1).

### 5.5 Channel branch (shielded batch settlement)

Channel note owner:

`owner_ch = Poseidon(DS_CHAN, merchant_owner, refund_owner, bjj_pub.x, bjj_pub.y, expiry_epoch, nk_ch)`
(final form in V2_SPEC 5.2: `nk_ch` replaces `chan_nonce` so the owner binds the nullifier key, finding F-NK-CH).

Channel nullifier key: `nk_ch = Poseidon(DS_NK_CH, chan_secret)`. The agent sends `chan_secret` to the
merchant inside the encrypted channel-note ciphertext, so both parties can compute the channel
nullifier.

- **Voucher** (off-chain, per x402 request k):
  `v_k = EdDSA_BJJ.sign(bjj_session, Poseidon(DS_VOUCHER, chan_id, cumulative_k, receipt_head_{k-1}))`,
  where `chan_id = cm_channel`.
- **Merchant close** (`now_epoch <= expiry_epoch`). The merchant proves:
  - a `sighash` signature under the merchant's `ak` behind `merchant_owner`;
  - a valid voucher for `cumulative_X <= value_channel`;
  - outputs: `out0 = (X, merchant_owner)` and `out1 = (value_channel - X, refund_owner)`.
  - Rolling variant: `out1` is a fresh channel note with the same terms and a new nonce.
- **Agent reclaim** (`now_epoch > expiry_epoch`). The agent signs `sighash` under the `ak` behind
  `refund_owner`.
  Outputs are unrestricted.
- The two branches spend the same nullifier, so exactly one settlement happens.
- The merchant must close before expiry. The SDK closes at `expiry_epoch - margin`.
- Merchant-side safety before serving: the merchant checks that the channel leaf exists and that its
  nullifier is unspent (indexer query plus local recomputation), and that `cumulative <= value`.
- **Why BabyJubJub and not Ed25519.** Ed25519 arithmetic inside a BN254 circuit is non-native and costs
  orders of magnitude more constraints. That is the same cost class as the EC-halves kill rule
  (section 11). BabyJubJub is native and costs ~4-7k constraints [E]. Off-chain verification of a
  voucher takes well under 1 ms [E].
- **Conditional payments** (the refund-escrow semantics of dna-x402 `programs/x402_refund_escrow`) are
  a channel with a single voucher over a response hash. The merchant claims with the agent's delivery
  voucher; otherwise the agent reclaims after expiry. No separate escrow program is needed.

### 5.6 Owners, delegation and spend policy

`owner = Poseidon(DS_OWNER, principal_pk, agent_pk, policy_root)`. Plain notes use `agent_pk = 0` and
`policy_root = 0`.

- **Principal branch.** A valid `sighash` signature under `ak_principal` with
  `principal_pk = Poseidon(DS_PK, ak_principal)`. Spending is unrestricted.
- **Agent branch.** A valid `sighash` signature under `ak_agent` with `agent_pk = Poseidon(DS_PK, ak_agent)`,
  and
  `policy_root = Poseidon(DS_POLICY, per_payment_cap, expiry_epoch, allowlist_root, max_channel_cap, flags)`
  holds with these constraints:
  - `out0.value <= per_payment_cap`, or for a channel open `channel_value <= max_channel_cap`;
  - `now_epoch <= expiry_epoch`;
  - when `flags.allowlist` is set, `out0.owner` (or the channel's `merchant_owner`) is in `allowlist_root`;
  - `out1.owner == owner`: change returns to the same policy owner, so the agent cannot sweep;
  - `public_amount >= 0`: an agent cannot withdraw publicly unless `flags.withdraw` is set.
- **Budget.** The total value of notes under the policy owner is the hard cumulative budget.
- **Revocation.** The principal spends the notes to a new owner. The old agent key becomes useless at
  once.
- `nk` for a policy owner is derived from the principal's seed and handed to the agent at delegation.
  The agent can compute nullifiers but holds no principal spend authority.

### 5.7 Labels and association sets

- **Deposit.** A transact with `public_amount > 0` must have dummy inputs, and both outputs carry
  `label = deposit_label`. The program assigns `deposit_label = Poseidon(DS_LABEL, pool_id, deposit_counter)`
  and logs `(deposit_label, depositor, mint, amount)` for ASPs. These are the Privacy Pools semantics
  ([V] l2beat Privacy Pools).
- **Same-label spend.** Outputs inherit the label.
- **Cross-label merge.**
  - Allowed only with an association proof: both input labels must be members of `assoc_root`, which
    must be a root currently posted in the ASP registry.
  - Outputs get `label = Poseidon(DS_MERGED, asp_id, assoc_root)`, a refresh label that the ASP's own
    set includes by rule.
  - Trade-off, recorded as decision D-ASSOC in PLAN_2027.md: a refresh label stays valid if an origin
    label is later revoked.
  - The alternative, bounded lineage sets of K origin labels per note, keeps revocation working at
    about K x 5k constraints. Phase 4 decides with measurements.
- **Withdraw.** If the pool is configured to require association, the note's label must be in
  `assoc_root`.
- **Ragequit.** The original depositor recorded for `deposit_label` can always withdraw the note's value
  publicly to the depositor address, without an association proof. The note must still carry its pure
  deposit label. Funds stay safe; the link becomes public ([V] the same semantics as 0xbow).
- The ASP registry is a PDA per ASP holding a ring of recent roots. An ASP can only post roots. It never
  touches funds.

### 5.8 Viewing keys and disclosure

| Scope | Holder sees | Mechanism |
|---|---|---|
| Incoming (`ivk`) | Notes received | Trial decryption with view tags |
| Outgoing (`ovk`) | Notes sent | Sender-side encrypted copies |
| Full (`fvk`) | Receipts and spends (balance history) | `nk` lets the holder recompute nullifiers |
| Per-channel | One channel's terms and vouchers | `chan_secret` |
| Payment disclosure | One payment | Opening + Merkle path + nullifier; the verifier recomputes |
| Scoped disclosure key `K_scope` (one agent, one period) | Every transact made by that agent in that period: amounts, merchants, receipt-chain heads, nullifiers | Each transact carries `ciphertext_rec`, which encrypts `(agent_index, period_id, note openings, nf0, nf1, memo_binding)` under `K_scope`. The holder trial-decrypts the period's transactions and checks each record against chain state (recomputes `cm`, checks leaf and nullifier presence) without any spend key. Derived per agent and per period, so one export reveals nothing outside its scope |
| Compliance viewer (opt-in) | All outputs of a policy owner | Policy flag requires in-circuit verifiable encryption of output openings to a viewer BabyJubJub key (~3-5k constraints [E]). Phase 4 option, off by default |

## 6. Agentic x402 flow through DNA x402

### 6.1 Schemes

Two new x402 schemes, advertised in `PAYMENT-REQUIRED` with CAIP-2 network ids as x402 v2 requires ([V]
x402.org v2 launch post, 2025-12-11):

| Scheme | Mirrors | Use |
|---|---|---|
| `dark-null-exact` | x402 `exact` | Occasional payments. One transact per payment |
| `dark-null-batch` | x402 `batch-settlement` (cumulative vouchers) | High-frequency calls. One transact per merchant per epoch |

The `accepts` entry carries:

- `payTo`: the merchant's shielded address (`dnull1...`);
- `asset`: the mint;
- `maxAmount`;
- `extra.pool`: program id, resolved from network config and never hardcoded;
- `extra.batch`: minimum channel cap, epoch length, close margin.

### 6.2 `dark-null-exact`

1. The agent requests the resource. DNA x402 returns 402 with a `Quote`
   (`quoteId, amountAtomic, mint, recipient, expiresAt, memoHash`; dna-x402 `x402/src/types.ts`).
2. The agent computes
   `quote_binding = sha256("dnull-x402-quote-v1" || quoteId || resourceHash || amountAtomic || mint || payTo || expiresAt)`
   (final encoding in V2_SPEC 11.1: tag `dark-null-x402-quote-v1`, length-prefixed strings, fixed-width integers).
   It then builds a transact: agent notes in, `out0 = (amount, merchant owner)`, `out1 =` change,
   `ext_data.memo_binding = quote_binding`, and `ciphertext0` to the merchant with memo `quoteId` plus a
   one-time refund address.
3. A relayer (the DNA facilitator can act as one) submits the transaction. The agent sends
   `PAYMENT-SIGNATURE = { scheme, txSignature, outIndex }`.
4. The merchant verifier:
   - fetches the transaction and checks the program id and `memo_binding`;
   - trial-decrypts `ciphertext0` with its `ivk`, recomputes `cm0` from the opening, and checks
     `value >= amount`;
   - records the replay key `sha256(shop || cm0)`.
5. DNA x402 returns the resource plus a signed receipt whose payload carries
   `settlement: "dark-null-exact"`, `outputCommitment`, `quoteBinding` and `poolProgramId`. Raw recipient
   and payer fields are replaced by salted hashes.

Latency estimate: proof 1-3 s plus landing about 1 s [E]. That suits occasional calls; high-frequency
use goes through 6.3.

### 6.3 `dark-null-batch` (session mode)

1. **Open.** One transact moves agent notes into a channel note (cap V, expiry at the end of the epoch)
   plus change. The opening, including `chan_secret` and `bjj_pub`, goes to the merchant in
   `ciphertext0`. The agent sends `PAYMENT-SIGNATURE = { scheme, chanId, openTx }`.
2. **Per request.** The header carries a voucher: `chanId`, cumulative amount, `receipt_head_{k-1}`, and
   the BabyJubJub signature.
   - The merchant verifies it off-chain (sub-millisecond [E]), checks `cumulative_k - cumulative_{k-1} == quote_k.amount`
     and `cumulative_k <= V`, serves the resource, and returns a DNA signed receipt whose `prevHash`
     chain links to the voucher.
   - Merchant-signed receipts and agent-signed vouchers thus form one two-signed log. Each side holds
     the other's signatures as dispute evidence.
3. **Close or roll** at epoch end. The merchant proves the latest voucher (section 5.5).
   - `ext_data.memo_binding = Poseidon(DS_RCPT, receipt_chain_head, salt)` anchors the whole session log
     without revealing it. Optional: dna-x402 `programs/receipt_anchor` can anchor the same salted head.
   - Unused cap returns to the agent's refund owner in the same transaction.
4. **Per-payment on-chain cost** is the per-epoch close cost divided by N requests. B3 measures it,
   including nullifier storage (section 7.4).

### 6.4 Refunds

- **Batch mode.** Unused cap refunds automatically at close. Partial service credits are paid by the
  merchant through a normal transact to the refund address carried in the channel opening.
- **Exact mode.** The merchant pays the one-time refund address from the payment memo.
- **Conditional (escrowed).** The channel-with-one-voucher construction of section 5.5.

### 6.5 DNA x402 integration points

No edits to dna-x402 in this task. The paths are listed for Phase 2.

| Surface (dna-x402 path) | Change |
|---|---|
| `x402/src/types.ts`: `SettlementMode`, `PaymentProof`, `PaymentAccept.scheme`/`network`, `ReceiptPayload` | Add `dark-null-exact` and `dark-null-batch` and their proof variants. In `ReceiptPayload`, add `outputCommitment`, `quoteBinding`, `chanId`, `voucherHash` and `poolProgramId`, and make `recipient` a salted hash for private schemes |
| `x402/src/paymentVerifier.ts`; injection via `createPaymentVerifier({paymentVerifier})` in `x402/src/sdk/paymentSupport.ts` | A `DarkNullVerifier` implementing 6.2 step 4 and 6.3 step 2 |
| `x402/src/x402/compat/parse.ts` (`canonicalizeProof`); the server's `proofToPaymentProof` and `/finalize` | New proof kinds; replay keys from `cm0` / `(chanId, cumulative)` |
| `x402/src/client.ts` (`AgentWallet`, `chooseSettlement`) | `payPrivate` / `openChannel` / `signVoucher`; prefer batch mode when the expected calls per epoch exceed the B3 break-even |
| `x402/src/privacy/darkNull.ts` | Replace. The current post-hoc request keeps the raw transaction signature and unsalted public hashes, so it provides no payment privacy (it wraps a public transfer) |
| `programs/receipt_anchor` | Anchor salted epoch receipt heads instead of `payerCommitment32B` |
| `crates/dark-poseidon-real` | Rust reference implementation for test vector V-POS |
| `crates/dark-stealth-ed25519` | One-time destinations for public withdrawals |
| `crates/dark-shielded-pool-core`, `programs/dark_shielded_pool` | Reference for the incremental tree and relayer-fee binding (depth 20 there; 32 here) |
| `ceremony/README.md` | Already states the correct phase-2 trust model (section 8.1) |

## 7. On-chain program on Agave: `dark_null_pool_v2`

### 7.1 Instructions

| Instruction | Notes |
|---|---|
| `initialize_pool` | Config PDA, tree PDA, root ring, epoch length, beta limits |
| `register_mint` | Creates a vault token account owned by a PDA. Rejects Token-2022 mints with TransferFee, TransferHook, PermanentDelegate, ConfidentialTransfer, NonTransferable, or DefaultAccountState(frozen) |
| `transact(proof, pi_fields, ext_data)` | One instruction for every kind (section 5) |
| `post_assoc_root` | ASP signer; appends to the ASP's root ring |
| `ragequit(proof_ragequit, ...)` | Small separate circuit: proves the note opening and pure deposit label; pays the recorded depositor |
| `set_beta_limits` / `pause` | Devnet and beta only. Authority disclosed; timelocked before any mainnet discussion |

### 7.2 `transact` execution order

1. Parse `ext_data` and compute `ext_data_hash`: sha256 syscall, 85 + bytes CU [V formula].
2. Check `roots[root_hint] == root`.
3. Read `now_epoch` from Clock.
4. Compute `pi` with one `sol_poseidon` call (12 inputs).
5. Run the Groth16 verify (groth16-solana on the `alt_bn128` syscalls).
6. Record both nullifiers (section 7.4). An existing nullifier fails the whole transaction.
7. Insert `cm0, cm1` (32 Poseidon syscalls).
8. Public leg:
   - Deposit: token transfer in.
   - Withdraw: check `supply[mint] >= amount`, transfer out to `recipient_token_account`, and pay the
     relayer fee.
9. Update `supply[mint]` and check the invariant `vault.amount >= supply[mint]`.
10. Emit the leaf indices with `sol_log_data`. The ciphertexts are already in instruction data, so
    nothing depends on log retention. That fixes the v1 `msg!` reliance.

### 7.3 Verifier

- **Devnet Phases 1-4.** Groth16 via groth16-solana: [V] 78,293 CU for 1 public input, 108,762 for 8
  (README, 2026-09-23). [M] 81,282 CU per instruction on devnet for the Phase 1 skeleton with 1 public input
  (PHASE0_RESULTS section 2).
- **Syscall facts used.** [V] agave `execution_budget.rs`, identical at tag v4.3.0:
  - G1 add 334, G1 mul 3,840;
  - pairing 36,364 for the first pair + 12,121 per extra pair;
  - G1 decompress 398, G2 decompress 13,610.
- **Proof encoding.** Send uncompressed (256 B): G2 decompression would cost 13,610 CU, and a V1
  transaction has room for the extra 128 B.
- **Mainnet-track verifier.** Groth16, keys from a public multi-party phase 2 (section 8.2).
- **No in-BPF field-heavy arithmetic.** S-PLONK measured what a PLONK verifier adds:
  - [M] 121,615 CU of BPF Fr arithmetic;
  - 37,848 CU of transcript;
  - 328,447 CU in total.

### 7.4 Nullifier storage (the dominant cost)

Every transact records two nullifiers, dummies included (G4).

| Option | Lookup | Storage cost per nullifier | Trust / liveness | Phase |
|---|---|---|---|---|
| A. PDA per nullifier (`["nf", pool, nf]`, 0 data; canonical bump derived on chain and pre-funded addresses handled, V2_SPEC 8.6) | O(1), atomic create-fails-if-exists. [M] 1,727 CU per insert plus 1,535 CU per bump attempt | Rent-exempt minimum for a 0-byte account: [M] 650,240 lamports (devnet and mainnet, 2026-10-06), never reclaimable | None beyond the program | P1 default |
| B. Sharded open-addressing hash-set accounts (up to 10 MiB each, [V] account limit) | O(1) expected. [M] 111-217 CU per insert up to 90% load; average probes 6.4 at 60-90% | [M] 164,846 lamports per 32-byte slot: 2.0x cheaper than A at 50% load, 3.0x at a 75% cap (recommended), 3.5x at 90%. Pages are pre-funded and write-locked per insert | None | P3 candidate |
| C. Light V2 address tree (height 40) as a uniqueness set | Non-inclusion via Light validity proof | Not rent-based. Light documentation (read 2026-10-06): 10,000 lamports per new address, 5,000 per state tree per instruction, ~200k CU per transaction. Not measured: devnet needs a keyed indexer endpoint | Light forester liveness; CPI into Light system program (~100k CU proof, [V] docs) | P1.5 candidate |
| D. Evolving / epoch nullifiers (Bowe and Miers, ePrint 2025/2031) | Prunable sets | Lowest | Research | R-track |

Consequence: at option A costs, a batch-mode close is dominated by rent, not compute. B3 decides
between B and C before P3 claims any per-payment cost.

### 7.5 Solvency guard

Defense in depth on top of in-circuit conservation:

- `supply[mint]` increases on deposit and decreases on withdraw. A withdraw may never exceed it.
- After every transact the program checks `vault_token.amount >= supply[mint]`.
- Beta: a per-epoch outflow cap per mint, with a disclosed authority and timelock. It bounds the damage
  of an undiscovered circuit bug to one epoch's cap.
- Disclosure: a mint with a freeze authority (for example USDC) lets the issuer freeze the vault account
  for all users of that mint. The SDK shows this per mint.

### 7.6 Relayers and fees

- Relayers are permissionless. A relayer pays the transaction fee and the nullifier storage cost, and is
  repaid via `relayer_fee` from the public leg. For in-pool transfers, the fee comes from a 1-unit
  public withdraw to the relayer's token account.
- Self-submission is always possible but links the fee payer.
- The DNA x402 facilitator can operate a relayer.
- Relayer selection and fee quotes use the existing swarm health surface (`swarm/server.mjs`).

### 7.7 State layout and throughput

- **State.** The tree PDA holds 32 filled-subtree nodes and the root ring: about 9.3 KiB. The pool
  config holds per-mint supply.
- **Contention.** Every transact write-locks the tree PDA.
  - Mainnet budget: [V] 25M CU per writable account per block at 250 ms slots, derived from agave
    `runtime/src/slot_params.rs` with SIMD-0286 and SIMD-0525 active.
  - At an estimated ~150k CU per transact, one tree takes about 166 transacts per block, about 660/s [E].
  - More throughput comes from sharding by `tree_id`, at the cost of splitting the anonymity set.

### 7.8 Transaction format

- Transaction V1 (SIMD-0385, gate `txv1aq4pp281K9um3tnPgkfX8UqtFT6wcVW3hNezGLL`) is active on mainnet
  (epoch 1035), devnet and testnet ([V] `solana feature status` 2026-10-06). It allows 4,096 B and 64
  accounts, without lookup tables.
- A transact is about 1.4 KB uncompressed [E]: proof 256, pi fields about 200, `ext_data` about 560
  (three 160 B ciphertexts plus fixed fields), about 12 accounts, plus signature and header.
- V1 is the primary format. Fallback: a legacy/v0 transaction (1,232 B, [V] solana-sdk `PACKET_DATA_SIZE`)
  with a compressed proof and an address lookup table.
- [M] V1 is accepted end to end through public devnet RPC:
  - a 4,096-byte V1 transaction finalized;
  - 4,097 bytes is rejected by RPC;
  - 3,914 bytes of instruction data are available to one signer and one program.
- [M] The V1 config must set `loaded_accounts_data_size_limit` (and the compute-unit limit). An absent value
  means 0 and the transaction fails with `MaxLoadedAccountsDataSizeExceeded` (PHASE0_RESULTS section 1).

## 8. Setup: universal SRS, no Dark NULL-operated ceremony

### 8.1 Correction to the earlier "local phase 2" reasoning

Prior internal research (Aug 2026) argued that a local, single-operator Groth16 phase 2 on top of the
Perpetual Powers of Tau transcript inherits the transcript's trust. **That is not correct.**

- Phase 1 secrets (tau, alpha, beta) and the phase-2 secret delta are separate trapdoors.
- In snarkjs verifying keys gamma is the group generator. Anyone who knows delta alone can therefore
  produce a verifying "proof" for any public input:
  - A = [alpha]_1 and B = [beta]_2, both public in the verifying key;
  - C = -delta^-1 * sum_i(pub_i * IC_i).
- So a phase 2 run only by us is a phase 2 we could forge against. Groth16 needs at least one
  uncompromised phase-2 contributor who is independent of the operator. That is a ceremony.
- dna-x402 `ceremony/README.md` already states this model correctly.

### 8.2 Decision

| Track | Artifact | Trust | Status label |
|---|---|---|---|
| Devnet P1-P4 | Groth16, development phase 2 | Operator can forge; devnet only | `dev-setup` in MANIFEST.json |
| Mainnet track, preferred (changed by Phase 0) | Groth16 with a public multi-party phase 2 (external contributors, beacon) on PPoT phase 1 | At least one uncompromised phase-2 contributor | Owner decision D-SETUP; this is a ceremony |
| Research (R-PLONK-PROVER) | PLONK over BN254 using the PPoT powers directly (no circuit-specific phase) | At least one uncompromised PPoT contributor | On-chain verify passes K-PLONK; adopt only with a prover that meets B1 |

Reason for the change [M]:
- PLONK verification fits: 328,447 CU in a 1,015-byte transaction.
- Proving the Phase 1 skeleton with circom + snarkjs PLONK takes 73.6 s (255,466 gates, 1.5 GB), against 0.26 s for
  native Groth16.
- fflonk verification costs 1,195,874 CU.
- Details in PHASE0_RESULTS sections 2 and 4.

### 8.3 SRS provenance

- PPoT supports up to 2^28 ([V] ethereum.org Perpetual Powers of Tau page).
- The Hermez `powersOfTau28_hez_final.ptau` contains the first 54 PPoT contributions plus a beacon ([V]
  Hermez VERIFY notes).
- Phase 0 used the PSE PPoT files `ppot_0080_16.ptau` and `ppot_0080_18.ptau` (80 contributions); hashes are in
  `bench/results/p0/2026-10-06/artifacts.sha256`. The Hermez download bucket returned HTTP 403 on 2026-10-06.
- The circuit needs about 2^16 powers. The blake2b hash of the ptau slice and the derived verifying key
  are bound into `MANIFEST.json`.
- B5 is a script any third party runs to re-derive the verifying key from the public ptau and the
  committed r1cs/PLONK circuit.
- The Ethereum KZG ceremony is BLS12-381 and cannot be used for alt_bn128 verifiers ([V]
  blog.ethereum.org 2023-01-16). BLS12-381 syscalls are active on Solana (SIMD-0388, mainnet epoch 986,
  [V]), which keeps that option open but out of scope.

### 8.4 PLONK-family cost on Solana

Measured on devnet in Phase 0 [M] (PHASE0_RESULTS section 2):

| Verifier | CU | Transcript | BPF Fr arithmetic | G1 syscalls | Pairing |
|---|---|---|---|---|---|
| Groth16 (groth16-solana), 1 input | 81,282 | n/a | n/a | n/a | n/a |
| PLONK, inverse hint, 2^15 / 2^18 | 328,447 / 334,896 | 37,848 | 121,615 | 119,237 | 49,062 |
| PLONK, on-chain inversion, 2^15 | 382,594 | 37,848 | 175,766 | 119,237 | 49,062 |
| fflonk, 2^15 | 1,195,874 | 61,551 | 1,050,331 | 34,266 | 49,058 |

- Proof size: PLONK and fflonk 768 B; a PLONK verify instruction fits a 1,015-byte V1 transaction and a legacy
  transaction.
- The earlier fflonk estimate (150-300k CU) did not hold: fflonk replaces G1 multiplications with BPF field
  arithmetic, which costs more on Solana.
- Kill rule K-PLONK: if verification exceeds 600k CU or cannot fit a single V1 transaction, keep Groth16
  and take the ceremony fallback.

## 9. What changes from Dark NULL v1 and why

v1 = current `main`: `circuits/null_proof.circom`, `src/lib.rs`.

| # | v1 weakness (location) | Consequence | v2 resolution |
|---|---|---|---|
| 1 | Withdraw debits by the deposit commitment: `vault.debit_withdrawal(public_inputs[0], amount)` (`src/lib.rs:233`). The commitment is public input 0 | Every withdraw names its deposit. No unlinkability at all | Spends reveal only `nf` and a root. Solvency moves to the pool-level supply counter + in-circuit conservation (7.5) |
| 2 | `amount`, receiver token account and mint are public inputs (`circuits/null_proof.circom:75-83`) | Amounts and receivers visible for every payment | In-pool transfers carry no amount; only the public legs do (G2, G3) |
| 3 | MiMC Merkle tree computed off-chain; roots posted by `update_root` under a root authority (`src/lib.rs:132`) | Trusted root operator; with unlinkable spends a forged root would be fatal | On-chain incremental tree via `sol_poseidon`; no root authority |
| 4 | Depth 7, `LEAF_WINDOW = 128`, `ROOT_WINDOW = 20` (`src/lib.rs:10-11`); linear scans | Anonymity set of 128 at most | Depth 32; O(1) root check with hint |
| 5 | `nf = MiMC(nullifier_secret)` (`circuits/null_proof.circom:60`), not bound to position | Duplicate-commitment ambiguity | `nf = Poseidon(DS_NF, nk, cm, leaf_index)` |
| 6 | Nullifier pages: `record_nullifier` requires every page in the transaction (`pages.len() == current_page + 1`, `src/lib.rs:567`; 32 per page, at most 256 pages) | Withdrawals stop once the page count exceeds transaction account and size limits; O(n) scan | O(1) nullifier store (7.4) |
| 7 | `receiver: Signer` on withdraw (`src/lib.rs:326`, `:339`) | Receiver signs and pays fees, so the payout is linked to a funded identity; no relayer path | Relayer submission with `ext_data_hash` binding (7.6) |
| 8 | Encrypted notes via `msg!` logs (`src/lib.rs:125`, `:271`) | Log truncation and retention risk | Ciphertexts in instruction data, bound by `ext_data_hash` |
| 9 | Single-party development zkey (`CEREMONY.md`) | Operator can forge proofs | Section 8 |
| 10 | `burn_and_whisper` burns without recording a commitment (`src/lib.rs:269`) | Orphan path | Removed in v2 |
| 11 | Fixed per-commitment amounts; no change notes | Agents cannot pay arbitrary amounts privately | Join-split with change |

v2 is a new program under a new id with new artifacts. v1 stays as-is for its documented devnet scope.
No v1 state migrates; users of v1 withdraw on v1.

## 10. Budgets

| Item | Number | Label / source |
|---|---|---|
| Max CU per transaction | 1,400,000; default 200,000 per instruction | [V] agave `execution_budget.rs` |
| Groth16 verify, 1 public input | 78,293 CU | [V] groth16-solana README |
| Groth16 verify, 1 public input, transact_v2 skeleton on devnet | 81,282 CU | [M] PHASE0_RESULTS section 2 |
| PLONK verify, 1 public input, on devnet | 328,447 CU | [M] PHASE0_RESULTS section 2 |
| Groth16 verify, 8 public inputs | 108,762 CU | [V] same |
| Groth16 verify of a wrapped settlement proof on devnet | 85,274 CU (tx `5NgqqVEAwQeuDfyeT2WrrpaW9QY1r5NxsibxJAtuhNtmyNyvY6TkmtQ36v2WGuTi1pq186zJ9m9Qo7rECAypqLvg`) | [M] prior internal research, 2026-08-26 |
| Settle with nullifier ledger write (test validator, Agave 4.2.1) | 94,352 CU; replay rejected at 3,070 CU | [M] prior internal research, 2026-08-26 |
| `pi` Poseidon(12) | 9,326 CU | [V] formula |
| Tree insert (32 x Poseidon(2)) | 25,152 CU | [V] formula |
| `ext_data` sha256 (~700 B) | ~800 CU | [V] formula |
| 2 nullifier records (option A) | 3,454 CU + 1,300,480 lamports rent | [M] PHASE0_RESULTS section 3 |
| Token transfer CPI | ~5-8k CU | [E] |
| Framework overhead (Anchor zero-copy) | ~10-30k CU | [E] |
| **transact total** | **~135-160k CU** (about 9x headroom under 1.4M) | [E] from the measured verify, Poseidon and nullifier components plus the CPI and framework estimates; gate B2 at 400k |
| transact size | ~1.4 KB (V1) | [E] |
| Circuit | 23,155 constraints (skeleton); 40,914 (full-size proxy) | [M] PHASE0_RESULTS section 4; gate B1 |
| Proving time | native Groth16 p50 260 ms (skeleton) / 433 ms (full-size proxy), 4 vCPU; browser 3-8 s | [M] native; [E] browser; gate B1 |
| Voucher sign + verify | < 1 ms each | [E]; gate B6-lat |
| Folding step (Sonobe Nova + CycleFold, 128 steps, Apple laptop, unoptimized) | ~340 ms per step | [M] prior internal research, 2026-08-26 |
| Sonobe on-chain decider circuit | ~11.9M constraints for a 500k-constraint step (CycleFold part 5.1M) | [V] sonobe.pse.dev `design/nova-decider-onchain.html` |
| In-circuit BN254 Pedersen openings (emulated) at real scale | ~11-26M constraints, expected ~18M | [E] prior internal research budget; kill rule fired |
| Per-account block budget (mainnet) | 25M CU per writable account per 250 ms block | [V] derived from agave `slot_params.rs` + active gates |

Privacy benchmark B6 (definition in PLAN_2027.md) is the only allowed source of anonymity-set and
linkability numbers.

## 11. Research risks and kill rules

### 11.1 The EC-halves kill rule and how v2 avoids it

What fired:

- Prior internal research (Aug 2026) wrapped a Nova (Sonobe) folding decider in Groth16 over BN254 and
  needed the in-circuit openings of BN254-G1 Pedersen commitments.
- Those are non-native (BN254 base field inside a BN254 scalar-field circuit). The estimate was about
  18M constraints, against a kill line of 1M. The rule fired.
- The adopted workaround published the witness as public inputs and checked the commitments on-chain
  through syscalls. That made session contents public, so privacy had to be suspended.

v2 removes the conflict instead of re-optimizing it:

1. **Privacy never depends on folding.** Unlinkability and hidden amounts come from the small
   join-split circuit (section 5), which contains no Pedersen openings. Its only in-circuit curve is
   BabyJubJub, which is native.
2. **Amortization does not need folding.** A unidirectional channel's final state (one cumulative
   voucher) settles N payments with one proof (section 5.5). Batching becomes N:1 per merchant-epoch
   with zero recursion.
3. **Folding moves to where witness privacy toward the verifier is not required.** That is the agent's
   spend-accountability proof to its own principal or compliance viewer (PLAN_2027.md Phase 3):
   - the agent folds its receipt and voucher log, and the principal verifies off-chain;
   - nothing is verified in BPF, so the EC-halves cost class never arises on-chain.
4. **On-chain rule.** Every curve operation is an `alt_bn128` syscall and every Poseidon is
   `sol_poseidon`.
   - The ported BPF Poseidon implementation becomes a test oracle only. Its own analytic estimate was
     "low-single-digit-million BPF instructions" per permutation; the syscall costs 786 CU for 2
     inputs [V].

### 11.2 Open research items

| ID | Question | Kill rule |
|---|---|---|
| R-FOLD-CHAIN | On-chain verification of a folded multi-merchant epoch proof with hidden witness. Candidates: Nova ZK via folding with a random instance ([V] microsoft/Nova README), commitments checked natively through KZG pairings, CycleFold on Grumpkin in-circuit (native, ~1.1M constraints [E] prior internal research) | Drop if the wrap exceeds 2M constraints, proving exceeds 120 s on a 16-core server, or verification exceeds 600k CU. Channel settlement stays the mechanism |
| R-PLONK | PLONK/fflonk verify CU on Solana | Measured in Phase 0: PLONK 328,447 CU passes K-PLONK; fflonk 1,195,874 CU fails it (section 8.4) |
| R-PLONK-PROVER | A PLONK-family prover with custom Poseidon/EdDSA gates for `transact_v2` (circom + snarkjs PLONK: 255,466 gates, 73.6 s [M]) | Adopt the no-ceremony track only if the full-size circuit proves at p50 at most 3 s within 2 GB and verifies at most 600k CU on devnet with the matching transcript; otherwise the ceremony track stands |
| R-NULL | Nullifier storage cost (7.4) | If neither B nor C lowers per-nullifier cost below 25% of option A, batch mode is claimed only at N where B3 shows break-even. Phase 0 [M]: B reaches 33.8% of A at a 75% load cap and 28.2% at 90%; C is unmeasured (documentation lists 10,000 lamports per address) |
| R-ASSOC | Revocation semantics for merged labels (5.7) | If bounded lineage exceeds the 2^16 circuit budget, ship refresh labels and state the revocation limit |
| R-SCAN | Note discovery cost for merchants with many channels | If scanning exceeds 1 s per 10k transactions on a laptop, add a hint index or oblivious sync (Bowe and Miers, ePrint 2025/2031) |
| R-PQ | Post-quantum migration (Binius64 / LatticeFold+ / hash-based wrap) | Watch item only; no dependency |

## 12. Runtime integration surface (local-first agent runtime)

This section fits the answers the runtime lane gave on 2026-10-06, checked against that runtime's main
branch.

### 12.1 What the runtime already has

The runtime ships an optional local Solana wallet. Properties as of 2026-10-06:

- off by default and devnet only;
- per-transaction, daily and weekly spend caps;
- an OS consent prompt on every spend, and a panic freeze;
- local receipts;
- on macOS, the seed lives in the Keychain and is unlocked with Touch ID;
- its x402 code exists, but the USDC spend lane is disabled.

It has no shielded balances, stealth addresses, viewing keys, or mainnet payments.

### 12.2 Promises this design keeps

The runtime's public promises, and how this design keeps each one:

| Runtime promise | How Dark NULL v2 keeps it |
|---|---|
| The wallet is optional | The Dark NULL core is a separate optional binary. It is started only when the user enables the wallet, and it does nothing on its own |
| The model cannot move money alone (human consent + caps) | The core holds no spend keys, so it cannot authorize anything. Every spend needs a `sighash` signature that the runtime's wallet layer produces only after its consent prompt and cap check. In-circuit policy (section 5.6) adds a chain-enforced bound underneath; it does not replace the runtime's caps |
| Keys are never exported | `seed`, `ask` and `bjj_session` stay inside the wallet-layer process (section 4.2). The core receives only viewing-level material (`ak, nk, ivk, ovk`) over loopback, keeps it in memory, and never writes it unencrypted. Scoped viewing keys are a separate, opt-in, read-only export (12.6) and are never spend keys |
| Mainnet is impossible in this build | The core is compiled with the `devnet-only` cargo feature. There is no mainnet program id in the binary, and the core refuses to start unless the RPC genesis hash equals devnet's |
| x402 USDC is disabled | The `/v1/x402/*` endpoints return `E_FEATURE_DISABLED` unless the runtime starts the core with `x402_enabled=true` and the mint is in the runtime-supplied mint allowlist. The default allowlist is devnet wSOL plus a devnet test mint |
| Fees are shown and approved before anything is signed | Every build returns a `fee_quote` (network fee, priority fee, CU estimate, nullifier storage, relayer fee, total debit) **before** any signing request. `sighash` commits to the relayer fee through `ext_data_hash`, so the signed fee is the shown fee |

### 12.3 Signing model

The chosen model is: **the core builds, the wallet layer signs in-process, and the core proves.** This
is the one model consistent with both "keys never exported" and "no hot keys".

1. The runtime asks the core to build. The core selects notes, fetches the root, composes `ext_data`,
   computes `sighash`, and returns:
   - a human-readable summary and the `fee_quote`;
   - one or more signing requests, each `{ key_role, key_ref, digest }`. A `key_ref` names a key; it
     never contains one.
2. The runtime shows the summary and fees, checks its caps, and raises the OS consent prompt.
3. On approval, the runtime's wallet layer signs each digest in-process with `dark-null-signer`. This is
   a small Rust library with Python bindings, linked into the wallet layer. It derives `ask` and
   `bjj_session` from the seed it is handed in-process and returns only signatures.
   - A deposit's public token transfer needs the runtime's own ed25519 wallet signature. Withdrawals and
     in-pool spends use relayer submission, so no Solana signature from the user is needed.
4. The runtime posts the signatures to the core. The core generates the proof locally, with the
   signatures as private witness, and submits through a relayer, or returns the transaction for
   self-submission.

Panic freeze: the runtime calls `POST /v1/freeze`.

- The core cancels pending builds and refuses new ones.
- The wallet layer stops signing vouchers.
- Funds already in open channels stay escrowed until the merchant closes or the agent reclaims after
  expiry. Exposure during a freeze is therefore bounded by the open channel caps, which the freeze
  status reports.
- An optional on-chain `revoke` (one consented transaction) moves policy-owner notes back to the
  principal.

### 12.4 Caps and in-circuit policy

| Runtime cap | On-chain counterpart |
|---|---|
| Per-transaction cap | Enforced by the runtime before signing, and by the in-circuit `per_payment_cap` in the agent's policy owner |
| Weekly cap | The principal funds the agent's policy owner with one weekly allowance note with `expiry_epoch` at week end. The note value is the in-circuit hard budget |
| Daily cap | Enforced by the runtime only. Cumulative in-circuit counters are outside v2 |
| Consent per spend | **Exact mode:** one prompt per payment. **Batch mode:** the consented spend is the channel open (escrow of up to cap V for one merchant for one epoch), and V counts against daily and weekly caps at open. Vouchers inside V are then signed by the wallet layer without further prompts. **This needs explicit sign-off from the runtime lane**, because per-voucher prompts would remove the benefit of batching |

### 12.5 Local proving budget

- Proving runs only on the user's machine, after consent, because the witness includes the signature.
- Targets (gate B1): p50 at most 3 s and p95 at most 6 s on a 2021-or-newer laptop using at most 4
  threads, with peak RAM at most 2 GB. The proving key is an estimated 20-40 MB [E].
- The prover is pure Rust (arkworks Groth16 with a native witness generator), so behaviour is identical
  on macOS, Windows and Linux. Cross-OS CI runs the same test vectors and requires byte-identical proofs
  for fixed randomness.
- **Offline-first:**
  - builds and proofs can be made from a cached root that is still inside the 256-root history window;
  - note scanning resumes from the last synced slot;
  - only submission needs the network.

### 12.6 Viewing keys

- Off by default.
- `K_scope` is derived per agent and per period from `ovk` (section 4.2). An export covers exactly one
  agent for one period.
- Exporting needs a consent token from the runtime, the same as a spend.
- The holder can check every spend in scope against the chain (section 5.8) without any spend key.
- The owner always keeps full receipts locally: the two-signed receipt log and the decrypted notes.

### 12.7 Localhost HTTP API (v1)

Transport rules:

- Bind to `127.0.0.1` on a port chosen by the runtime.
- Bearer token passed at process start over stdin, never in argv or the environment.
- Reject any `Host` header other than `127.0.0.1:<port>` (DNS-rebinding defense). No CORS.
- JSON bodies. Amounts are decimal strings in atomic units.
- Every response is `{ "ok": true, "data": {...} }` or
  `{ "ok": false, "error": { "code", "message", "retryable" } }`.

| Method and path | Request | Response `data` |
|---|---|---|
| `GET /v1/health` | | `{ version, network: "solana:devnet", genesis_hash, vk_hash, synced_slot, frozen, x402_enabled }` |
| `POST /v1/accounts` | `{ account_id, viewing_bundle: { ak, nk, ivk, ovk }, storage_key }` (all from `dark-null-signer` in the wallet layer) | `{ account_id, shielded_address }` |
| `POST /v1/accounts/{id}/sync` | `{ max_slots? }` | `{ synced_slot, notes, channels }` |
| `GET /v1/accounts/{id}/balance` | | `{ by_mint: [{ mint, spendable, pending, in_channels }] }` |
| `POST /v1/builds/deposit` | `{ account_id, mint, amount, from_pubkey }` | Build object |
| `POST /v1/builds/delegate` | `{ account_id, agent_index, agent_ak, policy: { per_payment_cap, max_channel_cap, allowance, expiry_epoch, allowlist[], flags } }` | Build object |
| `POST /v1/builds/transfer` | `{ account_id, to_address, mint, amount }` | Build object |
| `POST /v1/builds/withdraw` | `{ account_id, mint, amount, to: { stealth: meta_address } or { address } }` | Build object |
| `POST /v1/x402/exact` | `{ account_id, payment_required, max_amount }` (decoded x402 `PAYMENT-REQUIRED`) | Build object; after confirmation, `payment_signature_header` |
| `POST /v1/x402/channels` | `{ account_id, payment_required, cap, epochs }` | Build object for the channel open |
| `POST /v1/x402/channels/{chan_id}/vouchers` | `{ quote, amount }` | `{ voucher_id, digest, cumulative, remaining }`, a signing request for `bjj_session` |
| `POST /v1/x402/channels/{chan_id}/vouchers/{voucher_id}/signature` | `{ signature }` | `{ payment_signature_header }` |
| `POST /v1/builds/channel-reclaim` | `{ account_id, chan_id }` | Build object (valid after expiry) |
| `POST /v1/builds/{build_id}/signatures` | `{ signatures: [{ key_role, signature }], consent_token }` | `{ status: "proving" }` |
| `GET /v1/builds/{build_id}` | | `{ status, tx_signature?, error? }`. Status values: `awaiting_signature`, `proving`, `proved`, `submitted`, `confirmed`, `failed`, `cancelled`, `expired` |
| `POST /v1/builds/{build_id}/submit` | `{ via: "relayer" or "self" }` | `{ status, tx_signature? }`, or `{ unsigned_tx_base64 }` for `self` |
| `DELETE /v1/builds/{build_id}` | | `{ status: "cancelled" }` |
| `GET /v1/receipts` | `?since=&merchant=&chan_id=` | `{ receipts: [...] }` (local two-signed log) |
| `POST /v1/viewing-keys` | `{ account_id, agent_index, period: { from_epoch, to_epoch }, consent_token }` | `{ scope, k_scope, verify_instructions }` |
| `POST /v1/freeze` / `POST /v1/unfreeze` | `{ consent_token? }` (unfreeze requires one) | `{ frozen, open_channel_exposure: [{ chan_id, remaining }] }` |

Build object:

```json
{
  "build_id": "b_…",
  "kind": "deposit | delegate | transfer | withdraw | x402_exact | channel_open | channel_reclaim",
  "network": "solana:devnet",
  "expires_at": "<RFC 3339; root-window bound>",
  "summary": { "mint": "…", "amount": "…", "counterparty": "<merchant label or address hash>",
               "change": "…", "channel_cap": "…" },
  "fee_quote": { "network_fee_lamports": "…", "priority_fee_lamports": "…", "cu_estimate": 0,
                 "nullifier_storage_lamports": "…", "relayer": "<pubkey>", "relayer_fee": "…",
                 "total_debit": "…" },
  "policy_check": { "in_circuit_policy": "none | agent", "within_policy": true },
  "signing_requests": [ { "key_role": "spend_auth | solana_owner",
                          "key_ref": "<account_id or agent_index>",
                          "digest": "<hex>", "digest_kind": "dnull-sighash-v1 | solana-message" } ]
}
```

Error codes:

| HTTP | `code` | Meaning | `retryable` |
|---|---|---|---|
| 400 | `E_BAD_REQUEST` | Malformed body or field | no |
| 401 | `E_UNAUTHORIZED` | Missing or wrong bearer token, or wrong Host | no |
| 403 | `E_FROZEN` | Panic freeze active | no |
| 403 | `E_NETWORK_FORBIDDEN` | RPC genesis is not devnet, or a non-devnet id was requested | no |
| 403 | `E_FEATURE_DISABLED` | x402 or the mint is not enabled by the runtime | no |
| 403 | `E_CONSENT_REQUIRED` | Missing or invalid consent token | no |
| 409 | `E_STALE_ROOT` | Root left the history window; rebuild | yes |
| 409 | `E_NULLIFIER_SPENT` | An input note was spent elsewhere; resync | yes |
| 410 | `E_BUILD_EXPIRED` | Build or quote expired | no |
| 422 | `E_INSUFFICIENT_FUNDS` | Not enough spendable value | no |
| 422 | `E_POLICY_VIOLATION` | Would fail the in-circuit policy (cap, allowlist, expiry) | no |
| 422 | `E_QUOTE_INVALID` | x402 quote expired, malformed, or amount above `max_amount` | no |
| 422 | `E_BAD_SIGNATURE` | Signature does not verify against `ak` or the session key | no |
| 425 | `E_NOT_SYNCED` | Local state too far behind to build | yes |
| 503 | `E_RELAYER_UNAVAILABLE` | No relayer accepted; self-submission possible | yes |
| 504 | `E_PROVER_TIMEOUT` | Proving exceeded the configured limit | yes |
| 500 | `E_INTERNAL` | Unexpected; details in the local log only | yes |

MCP is a second entry point: the runtime can expose these calls as MCP tools. MCP tools can only reach
build and read endpoints. A spend still needs the wallet layer's signature, which only the runtime's
consent path produces, so MCP cannot bypass consent or caps by construction.

### 12.8 Per-payment latency, compute and cost

All numbers are [E] until B1-B3 and B6-lat pass.

| Mode | Added latency per call (after consent) | Chain CU per call | Chain cost per call |
|---|---|---|---|
| exact | 1-3 s prove + ~1 s land | ~150k | 1 transaction fee + 2 nullifier records + relayer fee |
| batch (N calls per merchant-epoch) | < 5 ms (voucher build + in-process sign + header) | ~300k / N (open + close) | (2 transactions + 4 nullifier records) / N; with rolling channels, about (1 transaction + 2 records) / N |

## 13. Verified Agave facts used here

Checked 2026-10-06 with `solana feature status` (CLI 4.2.1) against mainnet-beta, devnet and testnet,
and against anza-xyz/agave `master` (execution_budget.rs last changed 2026-07-18, identical at tag
v4.3.0).

| Fact | Status (mainnet epoch) | Source |
|---|---|---|
| alt_bn128 G1 add/mul/pairing (`A16q37opZdQMCbe5qJ6xpBB9usykfv8jZaMkxvZQi4GJ`) | active (638); devnet 546 | CLI |
| alt_bn128 compression (`EJJewYSddEEtSZHiqugnvhQHiWyZKjkFDQASd7oKSagn`) | active (641) | CLI |
| SIMD-0284 little-endian variants | active (984) | CLI; SIMD 0284 |
| SIMD-0302 G2 add/mul syscalls | active (985) | CLI; SIMD 0302 |
| SIMD-0334 pairing length fix / SIMD-0222 G1 mul length fix | active (942 / 836) | CLI |
| `sol_poseidon` (`FL9RsQA6TVUoh5xJQ9d936RHSebA1NLQqe3Zv9sXZRpr`); SIMD-0359 padding | active (644 / 940) | CLI; solana-sdk `poseidon` |
| `big_mod_exp` | inactive on all clusters; new gate (SIMD-0529) not created; Firedancer does not register it | CLI; `solana account`; firedancer `fd_vm_syscall.c` |
| secp256r1 precompile (SIMD-0075) | active (800) | CLI |
| ZK ElGamal proof program re-enable (`zkexuyPRdyTVbZqEAREueqL2xvvoBhRgth9xGSc1tMN`) | active (982) | CLI |
| Block limit gates SIMD-0207 / 0256 / 0286 | active (770 / 822 / 1009); effective 62.5M CU per block and 25M per writable account at 250 ms slots | CLI; agave `slot_params.rs` |
| Slot time 250 ms (SIMD-0525) | active (1036); 200 ms active on devnet/testnet | CLI |
| Transaction V1 (SIMD-0385), 4,096 B | active (1035) | CLI; solana-sdk `message/src/versions/v1` |
| Loader-v4 (SIMD-0167) | abandoned (gate id `LoaderV4WasAbandoned1111...`) | CLI |
| CPI nesting 4→8 (SIMD-0268) | inactive | CLI |
| SBPFv3 (SIMD-0178/0189/0377) | active (993) | CLI |
| BLS12-381 syscalls (SIMD-0388) | active (986) | CLI |
| Alpenglow (new gate `A1pengvuM6JEcyNuTnMqepBKhwHE3N6PmUrdATGawhJS`) | not on mainnet; active on devnet and testnet | `solana account` |
| Firedancer | ~14.3% of mainnet stake; registers the alt_bn128 and Poseidon syscalls | CLI version table; firedancer `fd_vm_syscall.c` |
| Agave release | v4.3.0 (2026-09-18) carries ~82% of mainnet stake | GitHub releases; CLI |

Devnet runs the Alpenglow gate and 200 ms slots while mainnet does not. Devnet latency numbers are
labelled as devnet and never extrapolated to mainnet.

## 14. Sources

Dates are publication dates or the access date 2026-10-06.

- Agave source: github.com/anza-xyz/agave (`program-runtime/src/execution_budget.rs`,
  `runtime/src/slot_params.rs`, `syscalls/src/lib.rs`, `cost-model/src/block_cost_limits.rs`), v4.3.0
- solana-sdk: github.com/anza-xyz/solana-sdk (`poseidon`, `packet`, `message/src/versions/v1`)
- SIMDs: github.com/solana-foundation/solana-improvement-documents (0284, 0296, 0302, 0385, 0529)
- Firedancer: github.com/firedancer-io/firedancer (`src/flamenco/vm/syscall/fd_vm_syscall.c`)
- groth16-solana: github.com/Lightprotocol/groth16-solana (README, 2026-09-23)
- sp1-solana: github.com/succinctlabs/sp1-solana (README, about 280k CU)
- Light Protocol: github.com/Lightprotocol/light-protocol; zkcompression.com docs
- Confidential transfer return: solanacompass.com news, 2026-06-18; solana.com/news/post-mortem-june-25-2025
- Privacy Pools: theblock.co/post/348959 (2025-03-31); l2beat.com/privacy/projects/privacy-pools (2026-05-28)
- Railgun: l2beat.com/privacy/projects/railgun (2026-09-11); arXiv 2606.25926; arXiv 2608.22987
- Zcash: orchard book (docs.rs orchard 0.15.3); Bowe and Miers, ePrint 2025/2031
- Aztec: aztec.network/blog/announcing-the-alpha-network
- Folding: Nova ePrint 2021/370; HyperNova 2023/573; CycleFold 2023/1192; Mova 2024/1220; LatticeFold+ 2025/247;
  github.com/microsoft/Nova; github.com/privacy-ethereum/sonobe; sonobe.pse.dev design docs
- PPoT: ethereum.org/developers/tools/perpetual-powers-of-tau; Hermez ptau VERIFY notes
- x402: x402.org/writing/x402-v2-launch (2025-12-11); docs.x402.org schemes (exact, upto, batch-settlement);
  blog.cloudflare.com/x402; linuxfoundation.org x402 Foundation press (2026-04-02)
- Solana privacy landscape: theblock.co/post/387564 (Arcium), /394892 (Umbra), /403982 (Light acquisition);
  helius.dev/blog/solana-privacy; Privacy Cash docs
- ERC-5564: eips.ethereum.org/EIPS/eip-5564
