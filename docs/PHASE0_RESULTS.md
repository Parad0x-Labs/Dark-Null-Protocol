# Dark NULL v2 Phase 0 Results (PHASE0_RESULTS)

status: measured. Run date 2026-10-06 (UTC 08:55-09:45). Network: Solana devnet, public RPC
`https://api.devnet.solana.com` (cluster `4.4.0-beta.0`). Companion to [`DESIGN_2027.md`](./DESIGN_2027.md),
[`PLAN_2027.md`](./PLAN_2027.md) and [`CLAIMS_POLICY.md`](./CLAIMS_POLICY.md).

Every number below is a recorded run. Raw output lives in
[`bench/results/p0/2026-10-06/`](../bench/results/p0/2026-10-06/) (machine spec in [`machine.json`](../bench/results/p0/2026-10-06/machine.json), artifact hashes in
[`artifacts.sha256`](../bench/results/p0/2026-10-06/artifacts.sha256), program builds in [`programs.json`](../bench/results/p0/2026-10-06/programs.json)). Values marked
[E] are estimates and are labelled where they appear. Signature links open the devnet explorer; full signatures
are in the JSON files.

Spike sources and raw results were committed in `f01fc3e`; the measurements below ran on that code.
Spike sources: [`spikes/p0/`](../spikes/p0/) (circuits, spike program, host tools, drivers). Test vectors:
[`vectors/v2/`](../vectors/v2/).

## Summary

| Spike | Verdict | Headline numbers |
|---|---|---|
| S-TXV1 | **Pass.** V1 transactions build, sign, send and finalize through public RPC | 4,096-byte V1 transaction landed; 4,097 bytes rejected by RPC; 3,914 bytes of instruction data available to one signer + one program |
| S-PLONK | **On-chain cost passes K-PLONK; proving cost fails B1.** | PLONK verify 328,447 CU (fits V1 and legacy); Groth16 81,282 CU; fflonk 1,195,874 CU; PLONK proving of the join-split skeleton 73.6 s vs Groth16 0.26 s |
| S-NULL | **Option A confirmed for P1; option B measured as the P3 candidate.** | A: 1,727 CU and 650,240 lamports per nullifier; B: 111-217 CU per insert and 164,846 lamports per 32-byte slot |
| S-PROVER | **B1 met by the native Groth16 prover with margin.** | Skeleton 23,155 constraints, p50 260 ms (4 threads) / 735 ms (1 thread), 108 MB; full-size proxy 40,914 constraints, p50 433 ms / 1,291 ms, 184 MB |
| G0.1 vectors | **Pass.** | V-POS 24/24 identical across circomlibjs, circom witness, light-poseidon and `sol_poseidon` on devnet; 10/10 derivation vectors on chain |

Decisions this changes are listed in section 6. SOL spent and program status are in section 7.

## 1. S-TXV1: Transaction V1 (SIMD-0385) end to end

**Method.** A zero-dependency client ([`devnet_lib.mjs`](../spikes/p0/scripts/devnet_lib.mjs)) serializes V1 exactly as
solana-message 5.1.0 `versions/v1` and solana-transaction 5.1.0 do: `0x81 | header(3) | config mask u32 LE |
blockhash | n_ix | n_addr | addresses | config values | instruction headers (program idx, n_accounts, data_len u16 LE) |
payloads`, followed by `num_required_signatures` signatures without a length prefix. The signature covers the message
bytes including the `0x81` prefix. Signing uses ed25519 from node `crypto`.

Commands: `node spikes/p0/scripts/s_txv1_probe.mjs`, then the payload section of `s_store.mjs`.

| Case | Bytes | Result | Evidence |
|---|---|---|---|
| V1, System transfer, empty config | 188 | Simulation error `MaxLoadedAccountsDataSizeExceeded` | [`devnet_txv1_probe.json`](../bench/results/p0/2026-10-06/devnet_txv1_probe.json) |
| V1, compute-unit limit only | 192 | Same error | same |
| V1, compute-unit limit + loaded-accounts-data-size limit | 196 | Finalized, version 1, fee 5,000 lamports, 150 CU | [`2kaoaTzQ`](https://explorer.solana.com/tx/2kaoaTzQojdTEvnGSduUBJREzgjz6EX2ERNtJDYEujKxyzdfLiW8YmtNaiPcnqTPasiNtdDjDiTnMzNEuzPqKUG7?cluster=devnet) |
| V1 at the 4,096-byte limit (spike no-op instruction, 3,914 data bytes) | 4,096 | Finalized | [`4Kf3Y7j5`](https://explorer.solana.com/tx/4Kf3Y7j57arUUBURJ4DeTAZpJ6FDGKNajR4ERaLcnBBG9P3U8mkx4w7R28WMeTR2DKCyd6LWD5eeQ79PuXqUwFwo?cluster=devnet) |
| V1 at 4,097 bytes | 4,097 | RPC rejects: `VersionedTransaction too large: 4097 bytes (max: 4096 bytes)` | [`devnet_store.json`](../bench/results/p0/2026-10-06/devnet_store.json) |
| Legacy control at 1,232 / 1,233 bytes | 1,232 / 1,233 | Finalized / rejected with the same message (max 1,232) | [`4ioCSsRW`](https://explorer.solana.com/tx/4ioCSsRWqFZtQEa5VqKAVZhkmBKvTQVnRZzx6qrvoaJD68tjtdyE3DLCgcbLHX2RtbxRCRS3ohaTbKzmS1BbABrz?cluster=devnet) |
| V1 carrying 12 `sol_poseidon` checks (does not fit legacy) | 3,075 | Finalized, 51,453 CU | [`2oisRLim`](https://explorer.solana.com/tx/2oisRLimLAviQT8j8b8qotsMdfBqVy7rpq7QfjDXiNf5VBXxc4iTnmudH9gDN5SVdRXFMw65hFwRB5idMKSFwx9A?cluster=devnet) |
| PLONK verify (832-byte payload) in V1 | 1,015 | Finalized | [`5HhtTWC6`](https://explorer.solana.com/tx/5HhtTWC6owKRMTTWTUNi1gBPhaoLzMqVS7kjkjBtt5V73jaemHhMtm6Y9cYp37up8eFTUH8kMrTuGDrz7TEdpybz?cluster=devnet) |

Maximum instruction data with one signer and one program and no extra accounts: **3,914 bytes in V1** and
**1,062 bytes in legacy** (computed with the same serializer at the limits above).

**Finding.** In V1 an absent `loaded_accounts_data_size_limit` means 0, not a default; a V1 transaction that omits it
fails before execution. The v2 client builder must always set both the compute-unit limit and the
loaded-accounts-data-size limit.

**Verdict vs PLAN.** G0.2 recorded: V1 is accepted end to end. The P0 kill rule (fall back to legacy plus a compressed
proof and a lookup table) does not fire. V1 stays the primary format.

## 2. S-PLONK: PLONK-family verification on Solana with syscalls only

**Method.**
- Proving system: snarkjs 0.7.6 `plonk` and `fflonk` (KZG over BN254). SRS: Perpetual Powers of Tau, PSE
  `ppot_0080_16.ptau` and `ppot_0080_18.ptau` (80 contributions), hashes in [`artifacts.sha256`](../bench/results/p0/2026-10-06/artifacts.sha256).
  The Hermez bucket that snarkjs documents returns HTTP 403 as of this run.
- Verifier: [`plonk.rs`](../spikes/p0/program/src/plonk.rs) and [`fflonk.rs`](../spikes/p0/program/src/fflonk.rs), ports of
  snarkjs `plonk_verify.js` / `fflonk_verify.js`. Keccak transcript via `sol_keccak256`; G1 add/mul and pairing via
  `sol_alt_bn128_group_op`; Fr arithmetic in BPF ([`fr.rs`](../spikes/p0/program/src/fr.rs), Montgomery, 4 x u64).
  Native tests check accept and reject against real snarkjs proofs before deploy
  ([`verify_native.rs`](../spikes/p0/program/tests/verify_native.rs); 5/5 pass).
- PLONK needs one field inversion (the L1 denominator). Variant 0x40 takes it as a prover-supplied hint checked with
  one multiplication; variant 0x41 computes it on chain with a binary extended Euclid. fflonk batch-inverts 22
  denominators with one on-chain inversion.
- Groth16: groth16-solana 0.2.0 (`verify_unchecked` plus the same canonical public-input check done with `fr.rs`), same
  circuits, `dev-setup` keys.
- Circuits: `pi_hash` (1,464 R1CS constraints, 22,651 PLONK gates, domain 2^15) and the Phase 1 skeleton
  `transact_v2_skeleton` (23,155 R1CS constraints, 255,466 PLONK gates, domain 2^18). Both have one public input,
  as in DESIGN 5.1.
- CU per instruction comes from the runtime's `consumed N of M` log line. Phase breakdowns come from
  `sol_log_compute_units` checkpoints minus a measured 101 CU per checkpoint. `sol_remaining_compute_units` is not
  active on devnet (gate `5TuppMutoyzhUSfuYdhgzD47F92GL1g89KpCZQKqedxP` inactive on 2026-10-06).

Command: `MODE=verify node spikes/p0/scripts/s_verify.mjs` (and `MODE=fflonk`).

| Verifier | Circuit | Build | CU (instruction) | Tx bytes | Evidence |
|---|---|---|---|---|---|
| Groth16 (groth16-solana) | transact_v2_skeleton | SBPFv0 | 81,282 | 471 (V1) / 459 (legacy) | [`tkvN5Hmu`](https://explorer.solana.com/tx/tkvN5HmujEK3fMXy3bXmj6i89WYQkKSP76thaNZACBgXFHnkE4oEEwz97yLtdtZGkvFfV2i4rwYPiseZQvQHPvc?cluster=devnet), [`547gvJeW`](https://explorer.solana.com/tx/547gvJeWLm4bJhEEJFHX7UzHfbAYNvgfDrNNmx48oqDdzpMyp5q1VFXvJ817jm5TEtjRj61WDrSj6oNv3UoRWjaW?cluster=devnet) |
| Groth16 | pi_hash | SBPFv0 | 81,277 | 471 | [`5PEPe1B1`](https://explorer.solana.com/tx/5PEPe1B1g3Q6RXHmX526XFaSVwqm42o9o6qN4gHRSw2HEvNfjU3v3N6LPt6eQ8rRSb6WcvwijvEzWPgV58mDvVu3?cluster=devnet) |
| Groth16 | transact_v2_fullsize | SBPFv0 | 81,285 | 471 | [`2wkU8DNJ`](https://explorer.solana.com/tx/2wkU8DNJmKZfhm8VCmD38UYFh3LY4TYCpczxHe8ojCsKkbC8Ly1sJ1QDpNyFfVM9H5y7n4uDByMtYTjjjTojpA3P?cluster=devnet) |
| Groth16 | transact_v2_skeleton | SBPFv3 | 81,282 | 471 | [`3t6hbsmY`](https://explorer.solana.com/tx/3t6hbsmY6zuuF2iS35NU8k9N25A1oryHnJjnmjW5oUW6kBss6FS23HoJrJpvEqdYcVwVG1kXWTiaEv5gnbWh3Guw?cluster=devnet) |
| PLONK, inverse hint | pi_hash (2^15) | SBPFv0 / v3 | 329,610 / 328,447 | 1,015 | [`5p995ERM`](https://explorer.solana.com/tx/5p995ERM9x4LR9rTuXWfutqa2qvwh1hTKmW2Tr3igYgryrAefWdD2yToSfx22MxUxyEXrvLB7EgVLAEaFWKua4td?cluster=devnet) / [`5HhtTWC6`](https://explorer.solana.com/tx/5HhtTWC6owKRMTTWTUNi1gBPhaoLzMqVS7kjkjBtt5V73jaemHhMtm6Y9cYp37up8eFTUH8kMrTuGDrz7TEdpybz?cluster=devnet) |
| PLONK, on-chain inversion | pi_hash (2^15) | SBPFv0 / v3 | 383,757 / 382,594 | 983 | [`5ZkaQ2TN`](https://explorer.solana.com/tx/5ZkaQ2TN3TPogAGnhYujfiT7m3ZpQXxeF3zYvoBTMnV2yJw6d1EWYrfJxRPBZ55jSworj4FdRt9r2ZJ4BQjYP8p1?cluster=devnet) / [`3fttQQh7`](https://explorer.solana.com/tx/3fttQQh7CXBBA4d5Gs4R1Hzdmeuz52oavYLyJ3wRZZGAn4xp1pWJ2XSmNKEpoWQJSGjuWYwNcN1QrjphWx1Jnxz8?cluster=devnet) |
| PLONK, inverse hint | transact_v2_skeleton (2^18) | SBPFv0 / v3 | 336,059 / 334,896 | 1,015 | [`5j6D91u5`](https://explorer.solana.com/tx/5j6D91u5U15nYA2fBmxovK2RNYvwJKdxh31xFtPgEgEMT2wZVwKZUhsPErtad7uAW5hty7e6WjqJHg2k3mU7kPNz?cluster=devnet) / [`29KUeL23`](https://explorer.solana.com/tx/29KUeL23hjftowXpC9HDhdS5LPTU3sYkaivBXRuCkwJB7mu1m3jca7NNkFXDjGHtYCf6XnSJ5VyEstEUMiu7Dj1V?cluster=devnet) |
| PLONK in a legacy tx with SetComputeUnitLimit | pi_hash | SBPFv0 | 329,610 | 1,043 | [`4gDrkNaA`](https://explorer.solana.com/tx/4gDrkNaADoZcoNPWboz1y75ywVa56nxGYXZdX3saR2zB6ojzMCVxEBGizWZvxYauNWrX6KngHYXmQ4Fpak5SNzBj?cluster=devnet) |
| fflonk (opt-level s) | pi_hash (2^15) | SBPFv3 | 1,195,874 | 983 | [`4NGjiYvL`](https://explorer.solana.com/tx/4NGjiYvLZLWLGcfhtbMvTCjP5pk2itcpKSBt8zyXxGLikFdb1HGJGkCowgghJi8jj1C5C1YC97dvLtfZuUFzexBn?cluster=devnet) |

Phase breakdown (SBPFv3, CU):

| Verifier | Transcript (keccak + challenge reduction) | Fr arithmetic (BPF) | G1 mul/add (syscalls) | Pairing, 2 pairs |
|---|---|---|---|---|
| PLONK pi_hash, hint | 37,848 | 121,615 | 119,237 | 49,062 |
| PLONK skeleton, hint | 38,023 | 127,869 | 119,258 | 49,062 |
| fflonk pi_hash | 61,551 | 1,050,331 | 34,266 | 49,058 |

Rejection (simulated, devnet): Groth16 with one bit flipped in the public input fails (0x301); PLONK with a flipped
evaluation fails at the pairing (0x404); PLONK with a flipped public input fails the hint check (0x402) because the
transcript binds the input; fflonk with a flipped evaluation fails (0x504).

Proof and payload sizes: Groth16 256 B proof + 32 B input; PLONK 768 B proof + 32 B input + 32 B hint; fflonk 768 B
(4 G1 + 16 Fr) + 32 B input.

Spike-program binary sizes: verify (Groth16 + PLONK) 53,784 B (SBPFv0) / 51,072 B (SBPFv3); fflonk 43,800 B at
opt-level s (67,848 B at opt-level 3, too large for the test-payer budget).

**Observations.**
- PLONK verification is 4.0x the Groth16 cost. Fr arithmetic in BPF and the 18 G1 multiplications are each about a
  third of it. The SBPFv3 build changed the Fr cost by less than 0.1%; the generated code was not inspected for the
  cause.
- Domain size moves PLONK verify cost only through log2(n) squarings: +6,449 CU from 2^15 to 2^18.
- fflonk trades G1 multiplications (5 instead of 18) for about 350 Fr multiplications ([E], counted from the code) plus a batch inversion. With BPF
  field arithmetic that is 3.6x the PLONK total (8.6x in the Fr arithmetic phase).

**Verdict vs K-PLONK** (DESIGN 8.4: at most 600k CU and fits one V1 transaction).
- PLONK passes: 328,447 CU, 1,015-byte transaction.
- fflonk as implemented fails on CU (1,195,874).
- The setup decision also depends on proving cost, which section 4 measures: PLONK proving of the skeleton is 73.6 s
  (snarkjs) against Groth16 0.26 s (arkworks) and 1.40 s (snarkjs). Section 6 records the decision change.

## 3. S-NULL: nullifier storage on devnet

**Method.**
- Spike program [`lib.rs`](../spikes/p0/program/src/lib.rs), feature `store`.
- Option A: one PDA per nullifier, seeds `["nf", pool, nf]`, 0 data bytes, created with a System CPI signed by the
  program. A second insert fails atomically.
- Option B: open-addressing hash set in a program-owned page account.
  - Layout: 16-byte header, then 32-byte slots.
  - Probing is linear from the slot indexed by `nf[24..32] mod capacity`, with a 90% load cap.
  - A duplicate fails.
  - Test page: capacity 320 (10,256 bytes), filled to 288 entries in three V1 transactions of 96 inserts.
- Option C (Light address tree): not measured. ZK Compression on devnet needs a Photon indexer endpoint, which is only
  offered behind a keyed RPC endpoint. Light's documentation (zkcompression.com
  `learn/considerations`, read 2026-10-06) lists:
  - about 100,000 CU for validity-proof verification plus about 100,000 CU of system use per transaction touching
    compressed state;
  - about 6,000 CU per compressed account;
  - 10,000 lamports per new address in a v2 address tree;
  - 5,000 lamports per state tree per instruction.
  These are documentation figures, not measurements.
- Spike accounts were closed after measurement (spike-only close instruction restricted to the test payer).

Commands: `node spikes/p0/scripts/s_store.mjs`, `node spikes/p0/scripts/s_null_extra.mjs`.

Rent on devnet and mainnet on 2026-10-06: `getMinimumBalanceForRentExemption(0)` = **650,240 lamports**, which is
5,080 lamports per byte including the 128-byte account overhead.

| Measurement | Option A (PDA) | Option B (hash-set page) |
|---|---|---|
| Insert, one nullifier, whole instruction | 1,727 CU ([`owReT1zy`](https://explorer.solana.com/tx/owReT1zyE7Q4eUDPg2sruis3xzzZ4Bp3i3XXhM5YkTd6kaihddVcduk1WUBXsWqkTRwngpzsBYEVgSjRjXcHL2n?cluster=devnet)) | 111 CU average body at 0-30% load, 134 at 30-60%, 217 at 60-90% (p95 526) ([`49UEf2rG`](https://explorer.solana.com/tx/49UEf2rGSBqZtDvPRiwXhksscGxeBWYADRTTJvZUCwBhJi4DheZYJ5Ezuqeb8zUCBtuUbK6cDn9KyoPZQaFSTXfT?cluster=devnet), [`RYoyaeGh`](https://explorer.solana.com/tx/RYoyaeGhgvXZDgKYkUjRw8buZg6yfKFL7TMNc2so8ERqEFLGiAgmB7XV2crV5GbDuzQR8CT9eCQrRe8zb1kxTTx?cluster=devnet), [`5He15C9F`](https://explorer.solana.com/tx/5He15C9FzMrBBQkesAu8V2whJFn8YDdv548177G1fpAbxVFYr2wXyRxXASwMG2VDxnhoCiwhNhZegNoxkde8snpq?cluster=devnet)) |
| Two nullifiers (the transact shape) | 2 x 1,727 CU ([`4kETTubS`](https://explorer.solana.com/tx/4kETTubSkP8xnF8WRsBioAxozR4YdJgpbmdqLpi5oiNdCeXHn4SuDPLzjMwwKLdYeAnUriCqPswEjKiy1cTQetHC?cluster=devnet)) | 949 CU for one instruction inserting two, including 6 instrumentation syscalls (~600 CU) ([`4JNqSN5E`](https://explorer.solana.com/tx/4JNqSN5EWe8Xtw3CnPn52WPdQLmLZWxF8rHFw6bmXh8uP2pyqJ7UzEAbfNSXkEw6keMDsHUrrShZRdcnULKZb5Ma?cluster=devnet)) |
| Check (present / absent) | 1,917 / 1,905 CU, including `create_program_address` ([`4QTQyJw8`](https://explorer.solana.com/tx/4QTQyJw8SApLyeyaP6jxdhYzCbHAi6HzTnV3fmqtmfvJ9HhTigbzXd6GrcjSQFRGa5u9Nta8QPvzqQzeggA6Pguc?cluster=devnet)) | 48 CU (1 probe) / 213 CU (7 probes) at 90% load ([`5h7nrXLN`](https://explorer.solana.com/tx/5h7nrXLNCb1DJ34ebPMMHj4jvtKvuVDzVFUjJcGnot1fMfJg3i93dGn28ap3s7cByjFxqQh8nQWMg86QnvhBWn92?cluster=devnet)) |
| Duplicate rejected | yes, System `AccountAlreadyInUse`, 1,510 CU (simulated) | yes, 0x202, 250 CU (simulated) |
| Average / max probes | n/a | 1.17 / 3 at 0-30%; 2.28 / 12 at 30-60%; 6.43 / 45 at 60-90% |
| Storage per nullifier | **650,240 lamports**, never reclaimable in v2 | 164,846 lamports per slot (52,750,720 for 320 slots); **183,162 at 90% fill**, 219,795 at 75%, 329,692 at 50% |
| Write lock | a fresh account per nullifier, no contention | every insert write-locks its page; throughput needs sharding by nullifier prefix |
| Trust / liveness | program only | program only; pages must be pre-funded |

A transact records two nullifiers. With option A that is 1,300,480 lamports of non-reclaimable rent plus 3,454 CU per
transact.

**Verdict.**
- D-NULL: option A stays the P1 default. It is simple, atomic and uncontended, and costs 3.5k CU per transact.
- Option B cuts storage per nullifier by 3.0x at a 75% load cap (the recommended cap; probe length grows quickly
  above it) and cuts CU by about 10x. It brings page pre-funding and write-lock sharding.
- Option C needs an indexer endpoint and a CPI with about 200k CU per its documentation. It is measured in P3 only if
  an endpoint is provisioned.
- B3 picks between B and C before any per-payment cost claim.

## 4. S-PROVER: join-split circuit and proving cost

**Method.**
- Circuits: [`lib_v2.circom`](../spikes/p0/circuits/lib_v2.circom),
  [`transact_v2_skeleton.circom`](../spikes/p0/circuits/transact_v2_skeleton.circom),
  [`transact_v2_fullsize.circom`](../spikes/p0/circuits/transact_v2_fullsize.circom), compiled with circom 2.2.3 `--O2`.
- The skeleton is the Phase 1 principal branch:
  - 2-in/2-out notes with 64-bit range checks on all four values;
  - two depth-32 Poseidon(2) Merkle paths, enforced for non-zero inputs;
  - position-bound nullifiers;
  - value conservation and public-asset binding;
  - in-circuit EdDSA-Poseidon over BabyJubJub on `sighash`;
  - the single public input `pi = Poseidon(12)` (DESIGN 5.1).
- The full-size proxy adds the always-present branch components with live constraints to measure the universal-circuit
  cost: a second EdDSA verification, a depth-16 allowlist path and two depth-20 association paths. Branch semantics
  are not implemented in the proxy.
- Provers:
  - arkworks ark-groth16 0.5 (pure Rust, rayon), with the R1CS and witness loaded from circom files
    ([`tools/src/main.rs`](../spikes/p0/tools/src/main.rs)); fresh process per run;
  - snarkjs 0.7.6 under node 22 (WASM witness) for Groth16, PLONK and fflonk; fresh process per run.
- Machine: Apple M4 host; Linux VM with **4 vCPU and 8 GB**. Peak RAM is process VmHWM / maxRSS. A 4-core 2021-era
  laptop is expected to be slower than 4 M4 cores [E]; the 1-thread column bounds that case.

Commands: `dark-null-p0-tools setup|prove`, `node spikes/p0/scripts/prove_once.mjs`.

| Circuit | R1CS constraints | PLONK gates | Groth16 proving key |
|---|---|---|---|
| transact_v2_skeleton | 23,155 | 255,466 (domain 2^18) | 16.5 MB (zkey) / 9.5 MB (arkworks, uncompressed) |
| transact_v2_fullsize (proxy) | 40,914 | not set up (needs 2^19) | 27.6 MB / 17.3 MB |
| pi_hash | 1,464 | 22,651 (2^15) | 1.3 MB |

| Prover | Circuit | Runs | p50 | p95 | Peak RAM | Evidence |
|---|---|---|---|---|---|---|
| arkworks Groth16, 4 threads | skeleton | 15 | **260 ms** | 282 ms | 108 MB | [`prover_arkworks.jsonl`](../bench/results/p0/2026-10-06/prover_arkworks.jsonl) |
| arkworks Groth16, 1 thread | skeleton | 15 | 735 ms | 762 ms | 106 MB | same |
| arkworks Groth16, 4 threads | fullsize | 15 | **433 ms** | 459 ms | 184 MB | same |
| arkworks Groth16, 1 thread | fullsize | 15 | 1,291 ms | 1,357 ms | 180 MB | same |
| snarkjs Groth16 | skeleton | 10 | 1,395 ms | 1,444 ms | 358 MB | [`prover_snarkjs.jsonl`](../bench/results/p0/2026-10-06/prover_snarkjs.jsonl) |
| snarkjs Groth16 | fullsize | 10 | 2,584 ms | 2,711 ms | 443 MB | same |
| snarkjs PLONK | skeleton | 3 | **73,558 ms** | 73,876 ms | 1,544 MB | same |
| snarkjs PLONK | pi_hash | 5 | 9,863 ms | 10,305 ms | 482 MB | same |
| snarkjs fflonk | pi_hash | 3 | 14,977 ms | 15,270 ms | 1,312 MB | same |
| snarkjs Groth16 | pi_hash | 5 | 279 ms | 281 ms | 201 MB | same |

Witness generation (circom WASM, p50): 132 ms skeleton, 166 ms fullsize. The arkworks rows exclude it. All proofs
verified; the arkworks skeleton proof's public input equals V-PI.

**Verdict vs B1** (p50 at most 3 s, p95 at most 6 s, at most 2 GB, at most 4 threads).
- Groth16 with the native prover meets B1 for both the skeleton and the full-size proxy, single-threaded included.
- The two-circuit kill rule (B1 p50 above 6 s) does not fire.
- PLONK and fflonk with circom + snarkjs do not meet B1: the skeleton takes 73.6 s, because vanilla PLONK needs 11x
  more gates than R1CS constraints for Poseidon-heavy circuits.

## 5. Test vectors (G0.1) and devnet demo

**Domain tags (draft).** `DS_x = int.from_bytes(ascii(tag), "big")` with tags `dark-null-<name>-v1`
([`V-DS.json`](../vectors/v2/V-DS.json)). The P0 spec fixes them.

| Vector | Content | circomlibjs | circom witness | light-poseidon 0.4.0 | `sol_poseidon` (devnet) |
|---|---|---|---|---|---|
| [V-POS](../vectors/v2/V-POS.json) | Poseidon n = 1..12, two input sets (sequential; edge set with r-1 and 253-bit values) | generator | 24/24 | 24/24 | 24/24 ([`2oisRLim`](https://explorer.solana.com/tx/2oisRLimLAviQT8j8b8qotsMdfBqVy7rpq7QfjDXiNf5VBXxc4iTnmudH9gDN5SVdRXFMw65hFwRB5idMKSFwx9A?cluster=devnet), [`PdWRYYQa`](https://explorer.solana.com/tx/PdWRYYQa9GqepqsFqsFdjxBkv15VsxAqbGuXT7zviHykHTXVnpk2erFgk51aHapANpP1ryVZk6PBA93yfsNPhXP?cluster=devnet)) |
| [V-ASSET](../vectors/v2/V-ASSET.json), owner ([V-KEYS](../vectors/v2/V-KEYS.json)), [V-NOTE](../vectors/v2/V-NOTE.json) x4, [V-NF](../vectors/v2/V-NF.json) x2, [V-SIGHASH](../vectors/v2/V-SIGHASH.json), [V-PI](../vectors/v2/V-PI.json) | Phase 1 derivations of the skeleton witness | generator | circuit output `pi` matches V-PI | 10/10 | 10/10 ([`cwfssAa5`](https://explorer.solana.com/tx/cwfssAa585QaQPsYsNfGSVR3ycKSCwDVFn3yhv4iaMAvj4wR6W7AqiyZKGcYBxJLXj7riN7swLL18YP1GAfmK4w?cluster=devnet)) |
| [V-TREE](../vectors/v2/V-TREE.json) | depth-32 sparse tree root with two leaves | generator | used as the circuit root | n/a | n/a |

Measured `sol_poseidon` cost per call is `61 n^2 + 542` CU exactly, plus 33 CU of call-site overhead in the spike
(n = 1: 636; n = 12: 9,359). This confirms the DESIGN 4.1 formula on devnet.

**P0 devnet demo.** [`2oisRLim`](https://explorer.solana.com/tx/2oisRLimLAviQT8j8b8qotsMdfBqVy7rpq7QfjDXiNf5VBXxc4iTnmudH9gDN5SVdRXFMw65hFwRB5idMKSFwx9A?cluster=devnet) computes all 12 Poseidon widths with `sol_poseidon` and checks each output
against V-POS on chain; any mismatch fails the transaction. **G0.1: pass.**

## 6. Decisions changed by these measurements

1. **D-SETUP.**
   - Measured: PLONK verification fits (328k CU), but circom + snarkjs PLONK proving of the Phase 1 skeleton is 73.6 s
     against 0.26 s for native Groth16.
   - Recommendation is now: **Groth16 with a public multi-party phase-2 ceremony as the mainnet track**.
   - The PLONK path stays a research item (R-PLONK-PROVER). It needs a PLONK prover with custom Poseidon/EdDSA gates
     whose skeleton p50 is at most 3 s; re-measure on-chain verify with that system's transcript.
   - fflonk is dropped for Solana: 1.2M CU.
   - DESIGN 8.2 and 8.4 and PLAN section 5 are updated.
2. **Owner key binds `nk` (finding F-NK, soundness).**
   - DESIGN 4.2 had `pk = Poseidon(DS_PK, ak.x, ak.y)` with `nf = Poseidon(DS_NF, nk, cm, leaf_index)`. Nothing then
     ties `nk` to the note, so a spender could choose a second `nk` and produce a second valid nullifier for the same
     note.
   - Fix, implemented in the circuit and vectors: `pk = Poseidon(DS_PK, ak.x, ak.y, nk)`.
3. **D-NULL.**
   - Option A stays the P1 default, now with measured costs: 1,727 CU and 650,240 lamports per nullifier.
   - DESIGN 7.4 had 0.00089 SOL and "about 4x cheaper at 50% load" for option B. Measured: 0.00065024 SOL; option B
     is 2.0x cheaper at 50% load, 3.0x at 75% and 3.5x at 90%.
   - Recommended B load cap: 75%.
4. **V1 builder rule.** Always set the compute-unit limit and the loaded-accounts-data-size limit in the V1 config
   (DESIGN 7.8).
5. **Circuit size and proving budget.**
   - Replaces the 43-49k [E] estimate: skeleton 23,155 constraints; full-size proxy 40,914.
   - Replaces the 1-3 s [E] estimate: native Groth16 p50 260 ms / 433 ms (4 vCPU).
   - The two-circuit fallback is not needed.
6. **Verifier cost.** Groth16 with one public input costs 81,282 CU on devnet through groth16-solana (README figure
   78,293). With the measured components (Groth16 81,282, `pi` 9,359, two option-A nullifiers 3,454, tree insert
   25,152 by formula) the transact budget is [E] ~135-160k CU once the token CPI and framework estimates are added
   (DESIGN 10).
7. **Bench tooling.** `sol_remaining_compute_units` is inactive on devnet; per-phase CU uses `sol_log_compute_units`
   checkpoints.

## 7. SOL spent, programs, keys

- Payer: the devnet test payer only. Program keypairs are in the devnet burner folder (mode 600) and recorded in its
  ledger.
- Four spike programs were deployed with the test payer as fee payer and upgrade authority, measured, and **all closed**:
  - `J5qxM1v5KSaYwurJ86UtuQwbNURVZYgQdkhiuHgKFLEK` (store);
  - `fbG5hC4zLer8nQcE9T51sAcNNuXNadMdRLyqYE5aACu` (verify, SBPFv0);
  - `6m7o2L5qEDAKoQvd4x3gM746g3EZcu6XQsnBo9sw8y81` (verify, SBPFv3);
  - `GEQAGa5pcB7MBs9Q7W2MZHfTwn4vYyBWb22iLkPAHa4` (fflonk, SBPFv3).
- No program is left deployed. Phase 1 deploys `dark-null-pool-v2` fresh.
- Net spend: **5,832,960 lamports (0.00583 SOL)**, summed from the payer's balance deltas over all 230 Phase 0
  transactions:
  - 1,200,000 lamports in fees;
  - 3,332,480 lamports remaining in the four closed program accounts (the loader keeps 833,120 lamports each);
  - 1,300,480 lamports in two option-A nullifier PDAs left by a run that public RPC rate-limited (HTTP 429) after
    submission, before its close step; the store program was closed afterwards, so they stay. The transaction prefix
    is in [`programs.json`](../bench/results/p0/2026-10-06/programs.json).
- All other spike rent was recovered: 52.75M + 11.14M lamports of hash-set pages, 5 nullifier PDAs, and about
  0.87 SOL of program-data rent.

## 8. Reproduce

All builds and proofs ran in containers in a Colima VM, never on the key-holding host.
- npm: installs use `--ignore-scripts`.
- cargo: vendored, `--offline`.
- Devnet drivers: dependency-free node scripts on the host, reading the payer path from `TEST_PAYER`.

Sequence:

1. `circom2 circuits/<c>.circom --O2 --r1cs --wasm --sym -l node_modules`
2. `node spikes/p0/scripts/gen_inputs.mjs out` (writes the inputs and `vectors.json`)
3. snarkjs setup (`groth16 setup` with one `dev-setup` contribution; `plonk setup`; `fflonk setup`) with the PPoT files
   above
4. `node encode_ix.mjs out`, `node gen_vk_rs.mjs keys program/src/vk.rs`
5. `cargo test --release` in `spikes/p0/program`, then `cargo-build-sbf --features <store|verify|fflonk> [--arch v3]`
6. `solana program deploy` with the test payer; the drivers in `spikes/p0/scripts/`; `solana program close`

Next: the P0 spec (`docs/spec/V2_SPEC.md`) fixes the `DS_*` registry used here, and Phase 1 starts from
`transact_v2_skeleton` with option A nullifiers and V1 transactions.
