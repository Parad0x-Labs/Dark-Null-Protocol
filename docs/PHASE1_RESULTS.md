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
