# Dark NULL v2 Phase 1 Results (PHASE1_RESULTS)

status: measured. Phase 1 work packages of [`PLAN_2027.md`](./PLAN_2027.md) record their runs here, one section
per package. Evidence labels follow DESIGN section 1: **[M]** measured by a recorded run (file named), **[V]** checked
against a cited source, **[E]** estimate.

## WP-CIRCUIT: `transact_v2` circuit, `dev-setup` key, program VK, native prover path (2026-10-06)

Raw output: [`bench/results/p1/2026-10-06/`](../bench/results/p1/2026-10-06/). The machine spec is in
[`machine.json`](../bench/results/p1/2026-10-06/machine.json) and artifact hashes are in
[`artifacts.sha256`](../bench/results/p1/2026-10-06/artifacts.sha256). Builds, keys and proofs ran in throwaway
containers in the Colima VM, never on the key-holding host. `run_sandbox.sh test` and `run_sandbox.sh rederive` were
re-run in fresh sandboxes at commit `cbbf701` (the code commit before this document); both passed.

### Summary

| Item | Result |
|---|---|
| Circuit | [`circuits/v2/transact_v2.circom`](../circuits/v2/transact_v2.circom): the reference circuit plus review findings R1-R3 ([`REVIEW_NOTES.md`](../circuits/v2/REVIEW_NOTES.md)) |
| Constraints | **23,167** (circom 2.2.3 official release, `--O2`). That is 23,166 plus a review delta of +1: R1 +1, R2 +3, R3 -3 [M] |
| V-E2E | 3/3 witnesses give the V-E2E `pi` and satisfy the R1CS (snarkjs `wtns check`) [M] |
| Tampered witnesses | 17/17 rejected: W1-W13 (V2_SPEC 13.2) plus W14-W17 from the review. W14 and W17 pass the Phase 0 reference circuit [M] |
| Proofs | snarkjs proof for each V-E2E step verifies with `vk.json`; `pi + 1` and a swapped `C` are rejected [M] |
| Native path | The C++ witness equals the WASM witness on all 23,240 wires for each step. The arkworks proof from the dev zkey verifies in arkworks, in snarkjs and on devnet [M] |
| B1 | Native p50 **247 ms** (4 threads) and **711 ms** (1 thread), end to end per fresh process; peak RAM **46 MB**. Gate: p50 at most 3 s, at most 2 GB [M] |
| B5 | Re-derivation in a fresh sandbox matches MANIFEST: rebuilt r1cs and wasm are byte-identical, `snarkjs zkey verify` passes, and the vk.json and vk.rs regenerated from the zkey are byte-identical [M] |
| Devnet | 6/6 proofs (3 snarkjs, 3 arkworks) verify with the generated `vk.rs` through groth16-solana 0.2.0: **78,822 CU** per verify, 79,155 CU per instruction. The probe is closed; net spend 988,120 lamports [M] |

### Interface I1 (frozen with this commit)

Consumers: WP-PROGRAM (verifier) and WP-CLIENT (prover). All rows are tagged `dev-setup` in `MANIFEST.json` key
`dark_null_v2`.

| Artifact | SHA-256 | Size |
|---|---|---|
| `circuits/v2/transact_v2.circom` | `d8260fec68f66c5ac3762962bc6ae0d6c69c5b463b1cfd48730cfe510f2f4c49` | 9,424 |
| `circuits/v2/build/transact_v2.r1cs` | `9e5ee5d9957b505cfe0136f5626cc20611623f4572d2d897277c26056354f8c9` | 11,643,044 |
| `circuits/v2/build/transact_v2.wasm` | `5f9ba4733b0416fe3ce4e1865af499250e905b509757719ce16d4d638a239604` | 7,253,981 |
| `circuits/v2/build/transact_v2_dev.zkey` | `7e89212cee2f5cce336cd473b30308d27b8b0169719def8c906b0db3f44535e0` | 16,525,864 |
| `circuits/v2/build/vk.json` | `c9c9771db2fdeacf6c5351d6113812d4720d7b157cc23cff721cc750214ffc16` | 2,924 |
| `programs/dark-null-pool-v2/src/vk.rs` | `a74af3c7bc30b72f3a1fb64b971c670dc3b9b34615b285ab82e955954788721d` | 9,181 |

- **Statement.** One public input, `pi` (V2_SPEC 7.1). Witness input names are exactly V2_SPEC 7.4.
  - The circuit also requires `nf0 != nf1` and `assoc_root = 0` (REVIEW_NOTES R1, R3).
  - A Phase 1 build must therefore never pass a non-zero `assoc_root`; the program rejects it anyway.
- **Program VK.** `vk.rs` exports the following, for groth16-solana 0.2:
  - `VERIFYING_KEY: Groth16Verifyingkey` and `NR_PUBLIC_INPUTS = 1`;
  - the raw `VK_ALPHA_G1`, `VK_BETA_G2`, `VK_GAMMA_G2`, `VK_DELTA_G2` and `VK_IC`;
  - `VK_BYTES` (576 bytes: alpha || beta || gamma || delta || IC0 || IC1);
  - `VK_HASH = SHA256(VK_BYTES) = 098eb04131454b87e0ab343130fbd76d75cc30d96b77c0c21ff3a6f094674e40`. This is the
    `vk_hash` of PoolConfig and `GET /v1/health`; the devnet probe recomputed it with `sol_sha256`.
- **Using the VK.** Call `Groth16Verifier::new(&a_neg, &b, &c, &[pi_be], &vk::VERIFYING_KEY)?.verify_unchecked()`
  after checking that `pi < r` (V2_SPEC 2.1). This is the code path that ran on devnet
  ([`circuits/v2/probe/src/lib.rs`](../circuits/v2/probe/src/lib.rs)).
- **Proof wire format** (V2_SPEC 2.6): `x(A) || (q - y(A))`, then `B` as `x.c1 || x.c0 || y.c1 || y.c0`, then
  `x(C) || y(C)`, all 32-byte big-endian, 256 bytes in total. Six proofs in this format with their `pi` are in
  [`circuits/v2/probe/tests/fixtures/proofs.txt`](../circuits/v2/probe/tests/fixtures/proofs.txt). They are usable
  as program test fixtures for V-E2E.
- **Prover (WP-CLIENT).** [`circuits/v2/tools/src/main.rs`](../circuits/v2/tools/src/main.rs) provides:
  - a snarkjs zkey to arkworks `ProvingKey` and `ConstraintMatrices` loader;
  - a `.wtns` reader;
  - the circom QAP reduction (`CircomReduction`, H on the odd coset of the 2n-th roots of unity);
  - `Groth16::<Bn254, CircomReduction>::create_proof_with_reduction_and_matrices`.

  This is the code to lift into `dark-null-client`'s `Prover`.
- **Native witness.** circom 2.2.3 `--c --no_asm` emits portable C++ (arm64 and x86_64) with no assembly.
  - Build it with g++, libgmp and nlohmann-json: [`scripts/setup/build_native_witness.sh`](../scripts/setup/build_native_witness.sh).
  - Run it as `transact_v2 <input.json> <out.wtns>`. A failed constraint exits 134 and names the template and line.
  - The generated sources are not committed (`transact_v2.cpp` is 40 MB). `run_sandbox.sh native` regenerates them
    deterministically from the pinned compiler.

### Constraint count

Baseline: the reference circuit compiled with the same official binary gives 23,166, equal to Phase 0. Each review
change was compiled on its own [M]:

| Change | Constraints | Delta |
|---|---|---|
| reference | 23,166 | |
| R1 `nf0 != nf1` (inverse hint) | | +1 |
| R2 `BabyCheck(R8)` | | +3 |
| R3 `assoc_root === 0` (a constant Poseidon lane folds one S-box) | | -3 |
| **transact_v2** | **23,167** | **+1** |

Regression test: [`circuits/v2/test/constraint_count.mjs`](../circuits/v2/test/constraint_count.mjs)
([`constraint_count.json`](../bench/results/p1/2026-10-06/constraint_count.json)). Wires: 23,240. Public outputs: 1.
Public inputs: 0.

### Tests

| Test | Result | Evidence |
|---|---|---|
| V-E2E witnesses produce V-E2E `pi` (WASM) and satisfy the R1CS | 3/3 | [`witness_check_transact_v2.json`](../bench/results/p1/2026-10-06/witness_check_transact_v2.json) |
| Tampered witnesses W1-W17 rejected (WASM) | 17/17 | same |
| Reference circuit on the same cases | W1-W13, W15, W16 rejected; W14 (one note spent twice) and W17 (`assoc_root != 0`) accepted with R1CS satisfied | same |
| Native C++ witness equals the WASM witness, satisfies the R1CS, gives `pi` | 3/3 steps, 0 differing wires of 23,240 | [`native_witness_check.json`](../bench/results/p1/2026-10-06/native_witness_check.json) |
| Native C++ generator rejects W1-W17 at the same template and line as WASM | 17/17 | [`native_witness_runs.jsonl`](../bench/results/p1/2026-10-06/native_witness_runs.jsonl) |
| snarkjs Groth16 proof per V-E2E step verifies; `pi + 1` and a swapped `C` rejected | 3/3 | [`proofs_snarkjs.json`](../bench/results/p1/2026-10-06/proofs_snarkjs.json) |
| arkworks proof (dev zkey) verifies in arkworks and in snarkjs | 3/3 | [`proofs_arkworks.json`](../bench/results/p1/2026-10-06/proofs_arkworks.json) |
| groth16-solana 0.2.0 with `vk.rs` (host), six proofs; changed `pi`, `A` or `C` and `pi >= r` rejected | pass | [`circuits/v2/probe/tests/verify_native.rs`](../circuits/v2/probe/tests/verify_native.rs) |
| Constraint-count regression | 23,167 | [`constraint_count.json`](../bench/results/p1/2026-10-06/constraint_count.json) |
| B5 re-derivation | pass | [`b5_rederive.json`](../bench/results/p1/2026-10-06/b5_rederive.json) |

### B1 prover runs

Fresh process per run, three V-E2E steps, 4 vCPU of an Apple M4 in a Linux VM. Other workloads shared the VM. A
4-core 2021-era laptop is expected to be slower [E]; the 1-thread rows bound that case. Raw:
[`b1_native.jsonl`](../bench/results/p1/2026-10-06/b1_native.jsonl), [`b1_snarkjs.jsonl`](../bench/results/p1/2026-10-06/b1_snarkjs.jsonl).
Summary: [`b1_summary.json`](../bench/results/p1/2026-10-06/b1_summary.json).

| Prover | Threads | Runs | p50 | p95 | Peak RAM |
|---|---|---|---|---|---|
| **Native end to end**: C++ witness process + arkworks process (zkey load, prove, verify) | 4 | 15 | **247 ms** | 294 ms | 46 MB |
| Native end to end | 1 | 15 | **711 ms** | 724 ms | 43 MB |
| arkworks prove only | 4 / 1 | 15 / 15 | 214 / 676 ms | 261 / 689 ms | 46 / 43 MB |
| C++ witness only (fresh process) | 1 | 30 | 14.8 ms | 22 ms | not sampled |
| snarkjs 0.7.6 (WASM witness + prove) | node default | 12 | 2,301 ms | 2,582 ms | 367 MB |
| WASM witness only | 1 | 12 | 159 ms | 184 ms | |

Verdict: B1 met by the native path with margin, single-threaded included. The B1 kill rule (p50 above 6 s) does not
fire. Native witness generation (15 ms) is about 10x faster than WASM (159 ms; Phase 0: 132 ms for the skeleton).

### B5 and setup provenance

- **`dev-setup` key.** Built with `snarkjs groth16 setup` on PPoT `ppot_0080_16`, then one `zkey contribute`.
  - Entropy came from `/dev/urandom` and was not recorded.
  - The contribution hash is `b944a83f 9c18479e ... ba7b482d` (full value in `b5_rederive.json`).
  - `snarkjs zkey verify` passes against the rebuilt r1cs and the PPoT file.
  - Trust: the operator of a single-operator phase 2 can forge proofs (DESIGN 8.1). This key is devnet only.
- **B5 re-derivation.** [`scripts/setup/run_sandbox.sh rederive`](../scripts/setup/run_sandbox.sh) does the following,
  using only public inputs and the committed zkey:
  1. fetches the circom release and the PPoT file and checks both hashes;
  2. recompiles the circuit without network;
  3. checks r1cs and wasm against MANIFEST;
  4. runs `snarkjs zkey verify`;
  5. re-exports vk.json and regenerates vk.rs.

  Every check passed in a fresh sandbox in 57 s [M] ([`b5_rederive.json`](../bench/results/p1/2026-10-06/b5_rederive.json)).
- **PPoT file.** `https://pse-trusted-setup-ppot.s3.eu-central-1.amazonaws.com/pot28_0080/ppot_0080_16.ptau`.
  - Size: 75,590,802 bytes.
  - SHA-256: `ed3622a7c79b0b49aadd134ebbc5b77df8c8c59bccebdfd0d9bf2c1a51561cf9`, equal to the Phase 0 record.
  - BLAKE2b-512: `9532c6c0...a56971c3` (in MANIFEST). S3 ETag: `7b6f111fef36c8a3f45066a07829a9e0-10`.

  PSE publishes no digest for the prepared files, so the file was tied to the values PSE does publish [V]
  ([`ptau_info.json`](../bench/results/p1/2026-10-06/ptau_info.json), [`scripts/setup/ptau_info.mjs`](../scripts/setup/ptau_info.mjs)):
  - power 16 of ceremony power 28, 62 contribution records;
  - record 61, `carter-feldman`, has next-challenge `4bf672f3...d3954174`, the published `new_challenge` hash of
    contribution 0080;
  - record 60's next challenge is the published `challenge_0080` hash `d9ec6fad...d0afa2e8`;
  - record 62 is the beacon: the published randao reveal of beacon slot 7,325,000 with 2^31 iterations.

  The file is 75.6 MB and stays out of git. `scripts/setup/fetch_pinned.mjs` refetches it and refuses any other
  digest. A full `snarkjs powersoftau verify` of the file was started and stopped after about 50 min single-threaded,
  so the chain check above stands in for it.
- **circom binary.** v2.2.3 `circom-linux-amd64`, SHA-256 `85342c7f...fe53a3`. That is the GitHub release asset digest
  [V], checked before every use. The file is x86_64 glibc, so it runs in a `linux/amd64` container under emulation on
  the arm64 VM.

### Devnet probe

A throwaway program, [`circuits/v2/probe`](../circuits/v2/probe), compiles `programs/dark-null-pool-v2/src/vk.rs`
in through `#[path]`. It uses groth16-solana 0.2.0 and pinocchio 0.9.3 (the Phase 0 versions), SBPFv0, and is
17,568 bytes (`.so` SHA-256 `1afcc430...4e17`).
- Program id: `3UobuWHZicPCuxAwiQeoxbsprvt6EPWwZmaqVzQs2q9W`, a fresh key in the devnet burner folder, recorded in
  its ledger.
- Deploy signature: `eKEBUEym1koHvoziAm8vdgXLNF8TKxCqoigy9JMnzuj6BuQcMd5MoHfEPzpUE371ee7fR5H2zGoDnUsQPTjjJvj`.
- All transactions are V1; full output is in [`devnet_vk_probe.json`](../bench/results/p1/2026-10-06/devnet_vk_probe.json).

| Run | CU | Signature |
|---|---|---|
| VK_HASH (`sol_sha256(VK_BYTES) == VK_HASH`) | 529 | `63rEePio6pz1p6g1qjEkbbvB1spnDU4ik1PT3aabMdD5CWyoxct5qMQ3FvEmxqwWnKmHkWaHVKCGkgzip6xLBtE6` |
| VERIFY snarkjs deposit / transfer / withdraw | 78,822 each (79,155 per instruction) | `5cXyVMTn...`, `4FqVY7fS...`, `2mBHGT44...` |
| VERIFY arkworks deposit / transfer / withdraw | 78,822 each | `3ZGWmT6N...`, `3vKEbud5...`, `34bFASFL...` |
| Simulated: changed `pi`, `pi >= r`, changed `C` | rejected (0x301, 0x302, 0x301) | |

Groth16 verify is 78,822 CU, against 81,282 for the Phase 0 skeleton probe (a different canonical-input check) and
the 400k B2 budget.

**SOL.** Test payer only. 477,273,519 to 476,285,399 lamports: **net 988,120 lamports (0.00099 SOL)**. This covers
deploy and run fees plus the closed program account, after 0.09012428 SOL of programdata rent was reclaimed. No
program is left deployed.

### Reproduce

All steps run from the host through [`scripts/setup/run_sandbox.sh`](../scripts/setup/run_sandbox.sh). Nothing is
installed on the host, and files are streamed in and out of containers with tar.
1. `run_sandbox.sh test`: witness tests, snarkjs proofs and the constraint count against the committed artifacts.
2. `run_sandbox.sh native`: build the C++ witness generator and compare it with WASM; check W1-W17.
3. `run_sandbox.sh rederive`: B5.
4. `run_sandbox.sh setup`: a new dev-setup key. This changes `vk.rs` and `VK_HASH` and needs a new I1 freeze.
5. B1: build the prover tool with [`scripts/setup/build_prover_tool.sh`](../scripts/setup/build_prover_tool.sh)
   (vendored crates, `--offline --locked`), then run
   [`circuits/v2/bench/b1_native.sh`](../circuits/v2/bench/b1_native.sh),
   [`b1_snarkjs_once.mjs`](../circuits/v2/bench/b1_snarkjs_once.mjs) and
   [`b1_summary.mjs`](../circuits/v2/bench/b1_summary.mjs).
6. Devnet probe:
   - `cargo-build-sbf --offline` in `circuits/v2/probe` (vendored from the committed `Cargo.lock`);
   - `solana program deploy` with the test payer;
   - `TEST_PAYER=... PROBE_PROGRAM=... node circuits/v2/probe/run_probe.mjs circuits/v2/probe/tests/fixtures/proofs.txt <out>`;
   - `solana program close`.

### Open items for later phases

- The mainnet track needs a public multi-party phase 2 (D-SETUP); this key is `dev-setup` only.
- Native witness on Windows and macOS hosts: the C++ code is portable but needs GMP. A pure-Rust witness generator
  (no GMP) is coming next for the WP-CLIENT prover.

## WP-PROGRAM: `dark-null-pool-v2` program (2026-10-06)

Code commit `5c8f2b3`: [`programs/dark-null-pool-v2`](../programs/dark-null-pool-v2), with tests in
[`programs/dark-null-pool-v2/harness`](../programs/dark-null-pool-v2/harness). Raw output is in
[`bench/results/p1/2026-10-06/`](../bench/results/p1/2026-10-06/):
- [`wp_program_tests_native.txt`](../bench/results/p1/2026-10-06/wp_program_tests_native.txt)
- [`wp_program_tests_sbf.txt`](../bench/results/p1/2026-10-06/wp_program_tests_sbf.txt)
- [`wp_program_cu_trace.txt`](../bench/results/p1/2026-10-06/wp_program_cu_trace.txt)
- [`wp_program_summary.json`](../bench/results/p1/2026-10-06/wp_program_summary.json)

Every build and test ran offline in the sandbox container, never on the key-holding host.

### Summary

| Item | Result |
|---|---|
| Program | V2_SPEC 8: 5 instructions; `transact` with 13 accounts and the 14 steps of 8.5 in order; F-BUMP; F-PREFUND; solvency guard and outflow cap; Token-2022 allowlist; codes 6000-6023; events 8.10 |
| Shared code | `dark-null-transcript` for every encoding, `ext_data_hash`, `pi` and the tree insertion. The I1 `vk.rs` is unchanged (`a74af3c7...721d`) |
| Circuit guarantees enforced again on chain | `nf0 != nf1` (step 1, `E_DUPLICATE_NULLIFIER`) and `assoc_root == 0` (step 2, `E_ASSOC_DISABLED`); REVIEW_NOTES R1 and R3 |
| Tests, native mode | 11 + 25 pass (`tests/native.rs`, `tests/program.rs`) [M] |
| Tests, SBF mode (the `.so`) | 11 + 25 pass; solvency fuzz with 40 cases of 40 operations [M] |
| V-E2E on the real proofs | deposit, relayed transfer bound to an x402 quote, relayed withdraw to a stealth address. Both proof sets (snarkjs, arkworks) pass in both modes. Roots, root head, `next_index`, nullifier records, supply, deposit counter and token balances equal the vectors [M] |
| B2 | `transact` 152,362 / 156,954 / 159,328 CU (deposit / transfer / withdraw), gate 400k; 1,718 bytes as V1, limit 4,096 [M] |
| Binary | `dark_null_pool_v2.so` **130,568 bytes**, SHA-256 `1bc08dd7cdd25145dc81b88324095e5ef3e9e920c106d07d1481e326d02c28fc`. A clean rebuild from the committed `Cargo.lock` gave the same hash [M] |
| Program id | `3WZenuUJ1dN7iWUathmmXExPYu5zh9KX9xFoWJCGy4Zi` in `declare_id!`. It is a fresh key generated in the sandbox, kept in the devnet burner folder and never committed |

### Build and test environment

- **solana-program version.** The worktree pins two versions: 1.18.26 in the root `Cargo.lock` (Anchor 0.30.1) and
  2.3.0 in the `programs/` workspace. The program uses **1.18.26**, so that native and SBF tests share the
  `solana-program-test` 1.18.26 runtime available offline in the sandbox.
- **Toolchains and libraries.**
  - SBF: `cargo-build-sbf` 4.1.0 with platform-tools v1.54 (rustc 1.89.0), SBPF v0, release with fat LTO.
  - Host tests: `cargo +1.89.0-sbpf-solana-v1.54`, because `time` 0.3.47 in the lock needs rustc 1.88.
  - groth16-solana 0.2.0, as in the WP-CIRCUIT probe.
- **Sources.**
  - 17 crates were missing from the sandbox registry: groth16-solana 0.2.0, solana-bn254 2.2.2,
    solana-define-syscall 2.3.0, the arkworks 0.5 family, educe, enum-ordinalize, itertools 0.13 and allocator-api2.
  - A throwaway networked container fetched them as sources only (no build scripts ran) and streamed them into the
    build container. Every other crate came from the image's registry.
  - The resolution was seeded from the dna-x402 `Cargo.lock` (commit `44a3bf5a`).
  - The program lock (`programs/dark-null-pool-v2/Cargo.lock`, 191 packages) covers the program build only.
  - The harness is its own workspace. Its lock is resolved from the same seed (SHA-256 `1a379408...cc2f`) and is
    not committed.
- **Test build versus cluster build.** Only the hash and pairing backends differ (`src/hash.rs`):

  | Function | Cluster build (and SBF tests) | Native tests |
  |---|---|---|
  | Poseidon | `sol_poseidon` (`SolPoseidon`) | light-poseidon 0.2 (`LightPoseidon`) |
  | SHA-256 | `sol_sha256` | the `sha2` crate |
  | Pairing and EC operations | `alt_bn128` syscalls | the arkworks code inside solana-bn254 |

  The `cu-trace` feature only adds `sol_log_compute_units` markers for the step breakdown; it is never in the cluster
  build.
- **Syscalls.** The 1.18.26 runtime has every syscall the program calls, so SBF tests run the cluster code path
  unchanged and no portable substitute was needed. Three things this runtime cannot show:
  - It has no Transaction V1, so the V1 size below is computed with the V1 layout. The model reproduces the 188- and
    196-byte devnet cases of PHASE0_RESULTS section 1.
  - Its default rent is 890,880 lamports for a 0-byte account; devnet charges 650,240.
  - Its bundled spl-token-2022 1.0.0 predates `ScaledUiAmount`, so that type is tested in the allowlist parser only.

### Tests against the PLAN list

| PLAN item | Tests (`harness/tests/`) |
|---|---|
| V-E2E end to end | `v_e2e_snarkjs_proofs`, `v_e2e_arkworks_proofs`. Pool id, PDAs and bumps, asset, roots after each step, the final ring, records, supply, counter, balances, and events (SBF) all equal the vectors. No program text log is written |
| T-SOLV | `outflow_cap_supply_and_solvency_guards`: cap per epoch and its reset, `E_SUPPLY`, `E_SOLVENCY`, `E_ARITHMETIC`; plus `solvency_fuzz` |
| T-ROOT | `step5_root_history`: hint at another slot, zero root, stale slot, hint correction outside `pi`, on-chain root equals the vector root. `ring_wraps_after_256_insertions`: a root is still known after 255 later insertions and gone after 256 |
| T-REPLAY, S9 | `replay_same_proof_and_rerandomized_proof_are_double_spends`: the same transaction, and the other prover's proof of the same statement |
| T-FR-CANON, S7 | `step1_parse_rejections` (`x + r` for root, nf0, nf1, cm0, cm1; `assoc_root = r`); `groth16_fixtures_and_pi_range` (`pi` in {r, r+1, 2^256-1, pi+r}) |
| T-BUMP, S8 | `step3_account_checks`: a lower off-curve bump for nf0, swapped records, a foreign key |
| T-PREFUND | `prefunded_nullifier_addresses_are_still_spendable` (1 lamport, and twice the rent); `initialize_pool_checks_and_prefunded_pool_address` |
| X-RELAY, S11, S3 | `x_relay_every_ext_data_field_mutation_fails`: each of the 10 fields, a recipient or fee account swapped together with the account list, a raised fee, and 27 single-byte flips across `ext_data` |
| T-MINT | `t_mint_token_2022_allowlist`: 21 rejected types, `DefaultAccountState` Frozen and Uninitialized, a mixed list, truncated TLV, the 8 allowlisted types alone and together (vault 170 bytes with `ImmutableOwner`, freeze authority recorded). `mint_allowlist_parser` covers TLV framing and `ScaledUiAmount` |
| Malformed proof corpus | `malformed_proof_corpus`: 288 corruptions of the 6 proofs; `tampered_proofs_are_rejected`: 11 at program level |
| Instruction parsing proptests | 3 properties, 2,048 cases each. The zero-copy parser agrees with `TransactIx::decode` on mutated vectors, field-targeted values and arbitrary bytes |
| S4, S5, S6, S12, S13 | `step5_root_history`, `step2_assoc_root_and_pool_binding`, `step6_epoch_window`, `step1_parse_rejections`, `statement_tampering_and_wrong_amount_or_mint` |
| S1, S2, S10 | The program derives the V-E2E `pi` (`pre_proof_pipeline_matches_v_e2e`) and accepts the real proofs. Any other width, tag or byte order gives another `pi`, which the verifier rejects |
| Wrong mint or amount | `statement_tampering_and_wrong_amount_or_mint`: deposit 1001 against the 1000 proof; the withdraw against a second registered mint |
| Token-2022 pool | `token_2022_transact_reaches_the_verifier`: every pre-proof check passes for a Token-2022 mint |
| Random data | `random_instruction_data_is_rejected` |

**Error codes.** Tests assert 23 of the 24 codes exactly:

| Codes | Reached through |
|---|---|
| 6000-6015, 6018, 6021, 6022 | instruction data and account lists |
| 6016 `E_SUPPLY`, 6017 `E_SOLVENCY`, 6019 `E_TREE_FULL`, 6023 `E_ARITHMETIC` | state written into the test bank |
| 6020 `E_DEPOSIT_DELTA` | unreachable: an allowlisted mint has no transfer fee or hook (V2_SPEC 8.5.1) |

**Solvency fuzz (SBF).**
- Setup: 40 cases of 40 operations. Each operation is one of the three V-E2E transacts with either proof set,
  either unchanged or with a random bit flip in the proof, a random bit flip in `ext_data`, or a changed amount.
  Clock moves and authority cap changes are mixed in.
- Model: an unchanged transact must succeed exactly when it is not yet done, its root exists, the epoch is in the
  window and the cap allows it. Every other operation must fail with a code in 6000-6023 and move no funds.
- Checks after every instruction: `vault.amount >= supply`; supply and vault equal the model; `next_index` equals 2
  per successful transact.
- Result: 1,600 operations; 95 succeeded, 1,505 rejected (668 replays, 468 tampered); no violation [M].

### Compute units

Whole transaction minus the 150-CU compute-unit-limit instruction, on the `solana-program-test` 1.18.26 runtime.

| Instruction | CU |
|---|---|
| `transact` deposit | **152,362** |
| `transact` relayed transfer (fee 5, no recipient leg) | **156,954** |
| `transact` relayed withdraw (recipient 590, fee 10) | **159,328** |
| `transact` deposit, both record addresses pre-funded | 157,400 |
| `initialize_pool` | 18,217 |
| `register_mint` (SPL Token) | 21,074 |
| `set_beta_limits` | 4,527 |
| `set_paused` | 2,521 |

The per-step breakdown comes from a `cu-trace` build, with 100 CU per marker removed. The verifier takes 78,892 CU
here and took 78,822 CU on devnet in the WP-CIRCUIT probe.

| Steps of V2_SPEC 8.5 | Deposit | Transfer | Withdraw |
|---|---|---|---|
| 1-4 parse, accounts (3 PDA checks), nullifier PDA search, fee rules | 10,418 | 16,425 | 10,409 |
| 5-6 root, epoch | 246 | 246 | 246 |
| 7-9 `ext_data_hash`, deposit label, `pi` | 11,851 | 11,328 | 11,328 |
| 10 Groth16 | 78,892 | 78,892 | 78,892 |
| 11 two nullifier records | 5,936 | 5,936 | 5,936 |
| 12 tree insertion, events | 32,954 | 32,181 | 32,178 |
| 13 public leg | 8,284 | 8,164 | 16,362 |
| 14 solvency | 18 | 18 | 18 |
| Entrypoint, dispatch, return | 3,760 | 3,760 | 3,955 |

The transfer's `nf1` record has bump 251, so its PDA search makes 5 attempts. All three totals sit at the low end of
the Phase 0 estimate of 155-185k and below 40% of the 400k B2 gate. The B2 kill rule (split above 1.0M CU) does not
fire.

### Transaction size (V1, V2_SPEC 9.1)

| Transaction | Bytes |
|---|---|
| `transact`, 1 signature, 14 addresses, compute-unit limit, loaded-accounts-data-size limit, priority fee | **1,718** |
| The same without the priority fee | 1,710 |
| Limit (V1) | 4,096 |
| The same instruction as a legacy transaction, without compute-budget instructions | 1,666 (legacy limit 1,232) |

### Deploy cost on devnet

These figures come from `getMinimumBalanceForRentExemption` on devnet, 2026-10-06. For an exact `--max-len 130568`
deploy:

| Item | Lamports |
|---|---|
| Program data rent (130,613 bytes) | 664,164,280 |
| Program account rent | 833,120 |
| **Total rent held** | **664,997,400 (0.665 SOL)** |
| Transaction fees | about 670,000-700,000 |
| Buffer rent, refunded at deploy | 664,123,640 |
| Peak balance needed during the deploy | about 1.33 SOL |

### Spec changes (V2_SPEC, same commit as the code)

| Section | Change | Kind |
|---|---|---|
| 7.5 | 23,167 constraints with R1-R3 as C9; the reference circuit's 23,166 kept as history | sync with WP-CIRCUIT |
| 8.1 | `PoolConfig` offset 12 is `vault_auth_bump`; it was padding | defect: the layout had no vault authority bump, so each transact would have searched for it |
| 8.1 | Token-2022 vault is 170 bytes with `ImmutableOwner`; SPL Token vault is 165 bytes | precision |
| 8.5.1 (new) | Loading `pool_config` before step 1; the order of the step 3 checks; writable flags; `root_hint >= 256` gives `E_UNKNOWN_ROOT`; deposit replay; `pi >= r`; `E_DEPOSIT_DELTA`; F-PREFUND for every PDA; setup and admin error codes | interpretation, now normative |
| 8.6 | Record rent is the cluster's 0-byte minimum: 650,240 on devnet, 890,880 under the test runtime's default rent; measured record CU | precision |
| 8.7 | Allowlist pinned to `ExtensionType` 0-27 (spl-token-2022 8.x): accepted values 6 (Initialized only), 10, 18-23 and 25; TLV framing rules | precision |
| 8.8, 8.11 | Measured verifier and per-step CU replace estimates | measurement |
| 9.1 | V1 size 1,718 / 1,710 bytes | measurement |
| 13.2 S9 | A replayed deposit fails with `E_PROOF_INVALID`, because `deposit_counter` moved its label; spends give `E_NULLIFIER_SPENT` | defect in the expected code |
| 14 | Rows 12-14 record the three changes above | |

### Spec items outside this package run

- `post_assoc_root` and `ragequit`: reserved for Phase 4 (V2_SPEC 8.3).
- Devnet deploy and the devnet B2 run: the keypair is in the devnet burner folder with a ledger row, and the SOL
  figure is above. This run did not deploy, as instructed.
- `MANIFEST.json` row for the program binary: v2 MANIFEST rows belong to WP-CIRCUIT. The `.so` hash above is the value
  to bind when the binary is deployed.

### Reproduce

All commands run in the sandbox container, with the vendored sources configured through `.cargo/config.toml`.

1. Build: `cargo-build-sbf --offline` in `programs/dark-null-pool-v2`. The result should be 130,568 bytes with
   SHA-256 `1bc08dd7...28fc`.
2. Native tests: `cargo +1.89.0-sbpf-solana-v1.54 test` in `programs/dark-null-pool-v2/harness`.
3. SBF tests: as step 2 with `SBF_OUT_DIR=<dir of the .so>`. Set `FUZZ_CASES=40 FUZZ_OPS=40` for the fuzz size above.
4. CU breakdown:
   - build with `cargo-build-sbf --offline --features cu-trace`;
   - run `CU_TRACE=1 SBF_OUT_DIR=<that dir> cargo test --test program cu_breakdown_trace -- --nocapture`.
