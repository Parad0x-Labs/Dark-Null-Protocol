# transact_v2 code review (WP-CIRCUIT, 2026-10-06)

Scope: `circuits/v2/transact_v2.circom` against [`V2_SPEC.md`](../../docs/spec/V2_SPEC.md) section 7, starting from the
Phase 0 reference circuit [`transact_v2_spec.circom`](../../spikes/p0/circuits/transact_v2_spec.circom), circomlib
2.0.5 and circom 2.2.3 `--O2`. Every finding below is backed by a witness or a compile; the files are in
[`bench/results/p1/2026-10-06/`](../../bench/results/p1/2026-10-06/).

## Findings that change constraints

| ID | Finding | Change | Constraints | Evidence |
|---|---|---|---|---|
| R1 | The circuit did not require `nf0 != nf1`. A witness that spends one note in both input slots counts its value twice in C4 and satisfies the reference R1CS. Only the program stopped it (distinct-nullifier check, and the second option-A record `CreateAccount` would fail). | `AssertNonZero(nf0 - nf1)`: one multiplication with an inverse hint. | +1 | W14: reference accepts (R1CS satisfied), transact_v2 rejects |
| R2 | circomlib's `EdDSAPoseidonVerifier` does not check that `R8` is on the curve. The twisted Edwards addition law is complete only on the curve. No forgery was found (an off-curve `R8` would have to be a fixed point of a hash-dependent map), so this is hardening. | `BabyCheck(sig_R8)` | +3 | W16 rejected by both circuits |
| R3 | `assoc_root` was a free statement field. Phase 1 has no association branch, so a Phase 1 proof with `assoc_root != 0` claims an association check it never ran. The program rejects it (`E_ASSOC_DISABLED`); the circuit did not. | `assoc_root === 0`. `--O2` then folds the first S-box of that Poseidon(12) lane. | -3 | W17: reference accepts, transact_v2 rejects |

Net delta: **+1**, 23,166 to **23,167** constraints. Each change was compiled on its own to attribute the count
(`no_r1` 23,166, `no_r2` 23,164, `no_r3` 23,170). The regression test is
[`test/constraint_count.mjs`](./test/constraint_count.mjs).

The witness input names and order are unchanged (V2_SPEC 7.4), and `pi` is the only public signal. The V-E2E
witnesses give the same `pi` in both circuits.

## Checks that needed no change

| ID | Item | Result |
|---|---|---|
| R4 | Range of `public_amount` | No change. C4 plus the four `Num2Bits(64)` value checks fix `public_amount` to the integer `out - in`, which lies in (-2^65, 2^65). Both sides of C4 stay below `3 * 2^64 < r`, so nothing wraps. The program's `u64` legs bound it to 2^64 (V2_SPEC 5.5). |
| R5 | Small-order `ak` | Covered by circomlib 2.0.5. `EdDSAPoseidonVerifier` requires `(4*A).x != 0`. That fails exactly for points of order 1, 2, 4 and 8, the points for which `S*B8 == R8 + 8*hm*A` would hold with `R8 = S*B8` and no `ask`. W15 (order-8 `ak`, `S = 1`, `R8 = B8`) is rejected at that line (`eddsaposeidon.circom:83`) in both circuits. **Invariant:** a circomlib upgrade must keep this check. |
| R6 | Signature scalar and hash bits | circomlib checks `S < l` (`Num2Bits(253)` + `CompConstant`) and decomposes `hm` with `Num2Bits_strict`. Both are canonical. |
| R7 | Bit decompositions | `Num2Bits(64)` (values) and `Num2Bits(32)` (leaf index) are unique because 2^64 and 2^32 are below `r`. The Merkle selectors are the boolean outputs of `Num2Bits(32)`. Only 254-bit decompositions need the strict form, and the one there (`hm`) uses it. |
| R8 | Unconstrained signals | `circom --inspect` ([`circom_inspect.log`](../../bench/results/p1/2026-10-06/circom_inspect.log)) reports only CA02 notes for bit outputs that a parent does not read: the four range checks here, and `CompConstant`/`EscalarMul` inside circomlib. These are expected, because the decompositions constrain through their own sum check. `--O2` replaces two main inputs by linear combinations: `out_value[1]`, which is defined by C4 and still range-checked as that combination (the same as in the reference), and `assoc_root`, which R3 sets to the constant 0. All other inputs are witness wires. |
| R9 | Membership gating | `(root' - root) * in_value == 0` skips membership only for value-0 inputs. Those carry no value (C4), and their nullifiers are recorded like any other (V2_SPEC 5.4). |
| R10 | Asset binding | All four commitments share one `asset` signal; C5 binds `public_asset` whenever `public_amount != 0`. With `public_amount = 0` the program sets `public_asset = 0`, and that value is in `pi` and `sighash`. |
| R11 | Labels | W3 now isolates C6 (`isDep * in_value == 0`). It uses a real note in the tree under the claimed root with a valid signature, so the deposit-input rule is the only failing constraint (line 186). Phase 0's W3 failed at membership first. |
| R12 | Statement and signature coverage | `sighash` covers `nf`, `cm_out`, both public legs, `ext_data_hash` and the epoch. `root` and `deposit_label` are bound by `pi` only, as V2_SPEC 7.2 specifies: the prover may re-prove against another valid root, and the program computes the deposit label. |

## Tampered witnesses

[`test/cases.mjs`](./test/cases.mjs) defines 17 cases. W1-W13 are the V2_SPEC 13.2 set, with W3 isolated as noted in R11.
W14-W17 come from this review. Every case is rejected by the WASM witness generator
([`witness_check_transact_v2.json`](../../bench/results/p1/2026-10-06/witness_check_transact_v2.json)) and by the native
C++ generator ([`native_witness_runs.jsonl`](../../bench/results/p1/2026-10-06/native_witness_runs.jsonl)). Both name the
same template and line for each case.
