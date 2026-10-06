# Dark NULL v2 Protocol Specification (V2_SPEC)

status: normative for Phase 1 (devnet). Version `v2.0-p1`, 2026-10-06. Branch `design/agentic-private-payments-2027`.
Companions: [`DESIGN_2027.md`](../DESIGN_2027.md) (rationale), [`PLAN_2027.md`](../PLAN_2027.md) (work packages),
[`PHASE0_RESULTS.md`](../PHASE0_RESULTS.md) (measurements), [`CLAIMS_POLICY.md`](../CLAIMS_POLICY.md).

The key words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119. Evidence labels follow DESIGN section 1:
**[M]** measured by a recorded run (file named), **[V]** verified against a cited source, **[E]** estimate.

## 0. Scope and conformance

**In scope (normative for Phase 1).** Encodings, the domain-separation registry, keys and addresses, notes, nullifiers,
the depth-32 tree, the `transact_v2` statement and its Phase 1 circuit (principal branch), the program
`dark-null-pool-v2` (state, instructions, account lists, execution order, errors, events), the nullifier store
(option A), the solvency guard, Transaction V1 building rules, the relayer flow, and the localhost HTTP API of the
local core.

**Fixed now, used later.** The x402 quote binding (Phase 2), voucher and channel encodings (Phase 3) and the
reserved owner kinds (Phase 3). They are pinned here so that Phase 1 notes, owners and `ext_data` stay valid
when those phases ship. They are marked *(fixed, P2)* or *(fixed, P3)*.

**Out of scope.** Changes to the dna-x402 repository (listed in DESIGN 6.5), the Phase 3 and Phase 4 circuit
branches, association sets, ragequit, and the mainnet setup ceremony.

**Conformance.** An implementation conforms to this version if it:

1. reproduces every value in the vector files of section 13.1 (byte-exact);
2. rejects every input that section 13.2 lists as rejected;
3. for the program, follows the execution order of section 8.5 and the error codes of section 8.9.

**Reference implementations** (all in this repository):

| Artifact | Path | Role |
|---|---|---|
| `dark-null-transcript` (Rust, `no_std`) | [`crates/dark-null-transcript`](../../crates/dark-null-transcript) | Encodings, preimages, `ext_data`, instruction layout, tree insertion, KDF byte rules, address codec |
| Vector generator (JS) | [`vectors/v2/tools`](../../vectors/v2/tools) | Independent implementation 1 (circomlibjs, node:crypto, @noble/curves, @scure/base) |
| Reference circuit | [`spikes/p0/circuits/transact_v2_spec.circom`](../../spikes/p0/circuits/transact_v2_spec.circom) | The section 7 constraint groups; checked against V-E2E |
| Devnet probe | [`spikes/p0/probe_v2`](../../spikes/p0/probe_v2), [`spikes/p0/scripts/s_probe_v2.mjs`](../../spikes/p0/scripts/s_probe_v2.mjs) | Runs the crate on chain with `sol_poseidon` / `sol_sha256` |

## 1. Notation and primitives

| Symbol | Definition |
|---|---|
| `r` | BN254 scalar field order `21888242871839275222246405745257275088548364400416034343698204186575808495617` (`0x30644e72...f0000001`) |
| `Fr` | integers modulo `r` |
| `q` | BN254 base field modulus `21888242871839275222246405745257275088696311157297823662689037894645226208583` (G1/G2 coordinates) |
| `l` | BabyJubJub prime subgroup order `2736030358979909402780800718157159386076813972158567259200215660948447373041` |
| BabyJubJub | twisted Edwards curve `a*x^2 + y^2 = 1 + d*x^2*y^2` over `Fr`, `a = 168700`, `d = 168696` (circomlib) |
| `B8` | `(5299619240641551281634865583518297030282874472190772894086521144482721001553, 16950150798460657717958625567821834550301663161624707787222815936182638968203)`, generator of the order-`l` subgroup |
| `L` | ed25519 group order `2^252 + 27742317777372353535851937790883648493` |
| `B` | ed25519 base point |
| `Poseidon(x1..xn)` | Poseidon over BN254, S-box `x^5`, circom/light-poseidon round constants and MDS, width `n+1`, `1 <= n <= 12`, output the first state element. Identical to circomlib `Poseidon(n)`, light-poseidon `Poseidon::new_circom(n)` and the `sol_poseidon` syscall with `parameters = 0` (Bn254X5) and `endianness = 0` (big-endian) |
| `SHA256`, `SHA512` | FIPS 180-4 |
| `HKDF(ikm, info, n)` | HKDF-SHA256 (RFC 5869), salt `"dark-null-keys-v1"` (ASCII), output `n` bytes |
| `X25519(k, u)` | RFC 7748 |
| `BE32(x)` | 32-byte big-endian encoding of an integer `x < 2^256` |
| `LE16/LE32/LE64(x)` | little-endian unsigned integers; `LE64i` two's-complement signed |
| `OS2IP(b)` | the big-endian integer value of byte string `b` |
| `h248(b)` | for a 32-byte hash `b`: `OS2IP(b[0..31])` (the first 31 bytes; always `< 2^248 < r`) |
| `LP16(s)` | `LE16(len(s)) \|\| s` for a UTF-8 string `s` of at most 65,535 bytes |
| `a \|\| b` | concatenation |

## 2. Encodings

### 2.1 Field elements

- Every field element that crosses a boundary (instruction data, `sol_poseidon` input, circuit input, vector file,
  API) is `BE32(x)` with `x < r`.
- A value `>= r` MUST be rejected (`E_NONCANONICAL_FIELD`), never reduced. Reason: `x` and `x + r` are the same field
  element but different bytes, and bytes are used as PDA seeds (section 8.6). Prover-malicious scenario S7.
- Reductions happen only where this document says "mod r" or "mod l" (64-byte HKDF and SHA-512 outputs). They use
  `OS2IP` of the full byte string.

### 2.2 Integers

- `value`, `deposit_amount`, `withdraw_amount`, `relayer_fee`, `claimed_epoch` and counters are `u64`. Leaf indices
  are `< 2^32`. A `root_hint` is `< 256`.
- In instruction data and `ext_data`, integers are little-endian (Solana convention).
- As Poseidon inputs, integers are field elements by value: `BE32(v)`.

### 2.3 Poseidon calls

- Inputs are passed as separate 32-byte big-endian elements; the call width is exactly the number of inputs.
  Implementations MUST NOT pad or elide inputs (SIMD-0359 makes the syscall enforce input lengths; scenario S1 shows
  that a width change is a different hash).
- `sol_poseidon` costs `61*n^2 + 542` CU for `n` inputs [V agave `execution_budget.rs`; M PHASE0_RESULTS section 5].

### 2.4 Hash to field and public keys to field

- A SHA-256 output enters the field as `h248(digest)`. Reducing it mod `r` instead is a different element for about
  81% of digests (scenario S10).
- A 32-byte public key (mint, program id) enters the field as two elements: `pk_hi = OS2IP(pk[0..16])`,
  `pk_lo = OS2IP(pk[16..32])`. Both are `< 2^128`, so no reduction or loss happens.

### 2.5 Signed public amount

```
public_amount = deposit_amount            if deposit_amount > 0 (then withdraw_amount MUST be 0)
              = r - withdraw_amount       if withdraw_amount > 0
              = 0                         otherwise
public_asset  = asset(mint)               if public_amount != 0
              = 0                         otherwise
```

Both `deposit_amount > 0` and `withdraw_amount > 0` in one transact is invalid (`E_BAD_PUBLIC_AMOUNT`).

### 2.6 Points and proofs

| Object | Wire encoding |
|---|---|
| BabyJubJub point as circuit/Poseidon input | `(x, y)`, two field elements |
| BabyJubJub point, packed (keys, vouchers) | circomlib `packPoint`: `y` little-endian in 32 bytes, top bit of byte 31 set iff `x > (r-1)/2` |
| EdDSA-Poseidon signature, packed | `packPoint(R8) \|\| LE256(S)` (64 bytes; circomlib `packSignature`) |
| ed25519 point | RFC 8032 compressed (32 bytes) |
| X25519 public key | RFC 7748 u-coordinate (32 bytes, little-endian) |
| Groth16 proof | `A` negated by the client: `x \|\| (q - y)` (64 B); `B`: `x.c1 \|\| x.c0 \|\| y.c1 \|\| y.c0` (128 B); `C`: `x \|\| y` (64 B); all big-endian (EIP-197 order, the `alt_bn128` syscall format); 256 bytes uncompressed |

## 3. Domain separation (final registry)

### 3.1 Field tags

`DS_x = OS2IP(ascii(tag))`. Every tag is shorter than 31 bytes, so `2^64 < DS_x < r`: a tag can never equal an
integer field (amount, index, counter, epoch). Pinned by [`V-DS.json`](../../vectors/v2/V-DS.json) and
`dark_null_transcript::ds`.

| Name | ASCII tag | Value (hex) | Used in | Phase |
|---|---|---|---|---|
| `DS_ASSET` | `dark-null-asset-v1` | `0x6461726b2d6e756c6c2d61737365742d7631` | asset id | P1 |
| `DS_NOTE` | `dark-null-note-v1` | `0x6461726b2d6e756c6c2d6e6f74652d7631` | note commitment | P1 |
| `DS_NF` | `dark-null-nf-v1` | `0x6461726b2d6e756c6c2d6e662d7631` | nullifier | P1 |
| `DS_PK` | `dark-null-pk-v1` | `0x6461726b2d6e756c6c2d706b2d7631` | owner key | P1 |
| `DS_NK` | `dark-null-nk-v1` | `0x6461726b2d6e756c6c2d6e6b2d7631` | nullifier key | P1 |
| `DS_SIGHASH` | `dark-null-sighash-v1` | `0x6461726b2d6e756c6c2d736967686173682d7631` | spend digest | P1 |
| `DS_PI` | `dark-null-pi-v1` | `0x6461726b2d6e756c6c2d70692d7631` | public input | P1 |
| `DS_LABEL` | `dark-null-label-v1` | `0x6461726b2d6e756c6c2d6c6162656c2d7631` | deposit label | P1 |
| `DS_OWNER` | `dark-null-owner-v1` | `0x6461726b2d6e756c6c2d6f776e65722d7631` | policy owner | fixed, P3 |
| `DS_POLICY` | `dark-null-policy-v1` | `0x6461726b2d6e756c6c2d706f6c6963792d7631` | policy root | fixed, P3 |
| `DS_CHAN` | `dark-null-chan-v1` | `0x6461726b2d6e756c6c2d6368616e2d7631` | channel owner | fixed, P3 |
| `DS_NK_CH` | `dark-null-nk-ch-v1` | `0x6461726b2d6e756c6c2d6e6b2d63682d7631` | channel nullifier key | fixed, P3 |
| `DS_VOUCHER` | `dark-null-voucher-v1` | `0x6461726b2d6e756c6c2d766f75636865722d7631` | voucher digest | fixed, P3 |
| `DS_MERGED` | `dark-null-merged-v1` | `0x6461726b2d6e756c6c2d6d65726765642d7631` | refresh label | reserved, P4 |
| `DS_RCPT` | `dark-null-rcpt-v1` | `0x6461726b2d6e756c6c2d726370742d7631` | receipt-chain anchor | fixed, P3 |

Rules:

- Every Poseidon hash in the protocol takes its `DS_*` tag as the first input, with two exceptions:
  - **Tree nodes** `Poseidon(left, right)`: the circomlib/Light convention, which keeps a depth-32 path at
    32 x 786 CU. Width 2 is shared with `nk = Poseidon(DS_NK, nk_seed)` and `nk_ch`; a node equals such a hash only if
    its left child equals the tag constant, and children are Poseidon outputs or 0, so that needs a Poseidon
    preimage of a fixed value.
  - **The EdDSA challenge** `hm = Poseidon(R8.x, R8.y, A.x, A.y, M)`: fixed by the circomlib verifier. Width 5 is
    shared with none of the tagged hashes of Phase 1 (`cm` is width 6, `nf`/`pk` width 4, `asset`/`label` width 3).
- Tags are pairwise distinct; equal-width families (for example `nf` and `voucher`, both width 4) differ only by
  the tag (scenario S2).
- Changing a tag or a preimage order is a protocol version change (`-v2` suffix) and a new verifying key.

### 3.2 Byte tags (SHA-256 / SHA-512 prefixes and KDF labels)

| Name | Bytes (ASCII) | Use |
|---|---|---|
| `TAG_EXTDATA` | `dark-null-extdata-v1` | `ext_data_hash` |
| `TAG_POOL_ID` | `dark-null-pool-id-v1` | pool id |
| `TAG_QUOTE` | `dark-null-x402-quote-v1` | x402 quote binding (replaces the draft string `dnull-x402-quote-v1` of DESIGN 6.2) |
| `TAG_RCPT_CHAIN` | `dark-null-rcpt-chain-v1` | receipt chain |
| `TAG_EDDSA_NONCE` | `dark-null-eddsa-nonce-v1` | deterministic EdDSA nonce |
| `KDF_SALT` | `dark-null-keys-v1` | HKDF salt for every derivation |
| KDF infos | `dark-null-kdf-{ask,ask-nonce,nk,ivk,ivk-d,ovk,chan,chan-nonce,stealth}-v1` | section 4.2 |
| `TAG_NOTE_ENC` | `dark-null-note-enc-v1` | note encryption key schedule (section 5.7) |

### 3.3 PDA seeds and discriminators

| Account | Seeds (program = `dark-null-pool-v2`) |
|---|---|
| Pool config | `["dark-null-pool", pool_nonce[32]]` |
| Tree | `["dark-null-tree", pool_config]` |
| Mint state | `["dark-null-mint", pool_config, mint]` |
| Vault (token account) | `["dark-null-vault", pool_config, mint]` |
| Vault authority | `["dark-null-vault-auth", pool_config]` |
| Nullifier record | `["dark-null-nf", pool_config, BE32(nf)]` |

Every PDA is derived with the **canonical bump** (the highest bump that yields an off-curve address).

Instruction discriminators are `SHA256("global:<name>")[0..8]` (Anchor-compatible; a non-Anchor implementation
uses the same bytes): `transact = d995828fdd34fc77`, `initialize_pool = 5fb40aac54aee828`,
`register_mint = f22b4aa2d9d6bfab`, `set_beta_limits = 4e478dcb8ab58a5c`, `set_paused = 5b3c7dc0b0e1a6da`.
Account discriminators are `SHA256("account:<Name>")[0..8]`.

## 4. Keys and addresses

### 4.1 Roles

| Material | Held by | Never leaves |
|---|---|---|
| `seed` (32 random bytes) | wallet layer (`dark-null-signer`) | the wallet-layer process |
| `ask`, `ask_nonce_key`, `bjj_session`, its nonce key | wallet layer | the wallet-layer process |
| viewing bundle `{ ak, nk, ivk_root, ovk }` | local core (memory only; encrypted at rest with `storage_key`) | the machine |
| `pk`, shielded address | public | |

The core never receives `seed`, `ask` or `bjj_session` and therefore cannot authorize a spend (section 10).

### 4.2 Derivations (pinned by [`V-ADDR.json`](../../vectors/v2/V-ADDR.json))

`acct` is the account index (`u32`), `d` the diversifier (`u32`).

```
ask           = OS2IP(HKDF(seed, "dark-null-kdf-ask-v1"       || LE32(acct), 64)) mod l     ; abort if 0
ask_nonce_key =       HKDF(seed, "dark-null-kdf-ask-nonce-v1" || LE32(acct), 32)
ak            = ask * B8                                       ; BabyJubJub, (x, y)
nk_seed       = OS2IP(HKDF(seed, "dark-null-kdf-nk-v1"        || LE32(acct), 64)) mod r
nk            = Poseidon(DS_NK, nk_seed)
pk            = Poseidon(DS_PK, ak.x, ak.y, nk)                ; plain owner (binds nk: finding F-NK)
ivk_root      =       HKDF(seed, "dark-null-kdf-ivk-v1"       || LE32(acct), 32)
ivk_d         =       HKDF(ivk_root, "dark-null-kdf-ivk-d-v1" || LE32(d), 32)     ; X25519 secret
ivk_pub_d     = X25519(ivk_d, 9)
ovk           =       HKDF(seed, "dark-null-kdf-ovk-v1"       || LE32(acct), 32)
stealth_seed  =       HKDF(seed, "dark-null-kdf-stealth-v1"   || LE32(acct), 32)  ; section 9.4
bjj_session   = OS2IP(HKDF(seed, "dark-null-kdf-chan-v1"      || chan_nonce[32], 64)) mod l   ; P3
```

### 4.3 Shielded address

```
payload = 0x01 || BE32(pk) || ivk_pub_d || LE32(d)          ; 69 bytes, version 0x01 = plain owner
address = bech32m("dnull", payload)                          ; BIP-350 checksum, 123 characters
```

- Decoders MUST accept exactly 123 lowercase characters, check the bech32m checksum, version `0x01`, canonical `pk`
  and zero padding bits. The BIP-173 90-character limit does not apply (as in Zcash unified addresses).
- Version `0x02` is reserved for policy owners (P3).
- Diversified addresses (`d = 0, 1, ...`) share `pk`, so anyone who holds two of them can link them. They separate
  incoming-viewing keys for scanning and revocation only. Receive addresses that must be unlinkable to each other
  use different account indices. On chain, `pk` never appears in clear (it lives inside commitments). DESIGN 4.2
  described diversified addresses as unlinkable; that holds only with per-diversifier owners, which the fixed
  owner formula of Phase 0 does not have (change 10 in section 14).

### 4.4 EdDSA-Poseidon over BabyJubJub (spend authorization and vouchers)

Signing key `a` (`ask` or `bjj_session`), public key `A = a * B8`, message `M` (a field element), nonce key `K`:

```
r  = OS2IP(SHA512("dark-null-eddsa-nonce-v1" || K || BE32(M))) mod l
R8 = r * B8
hm = Poseidon(R8.x, R8.y, A.x, A.y, M)
S  = (r + 8 * hm * a) mod l
signature = (R8, S)
```

Verification is circomlib `EdDSAPoseidonVerifier` / `verifyPoseidon`: `S < l` and `S * B8 == R8 + (8 * hm) * A`.
This equals circomlib signing with the pruned scalar `s = 8a`, so circomlibjs verifies these signatures unchanged
(checked for every signature in the vectors).

## 5. Notes

### 5.1 Fields

```
note = (value: u64, asset: Fr, owner: Fr, salt: Fr, label: Fr)
asset = Poseidon(DS_ASSET, mint_hi, mint_lo)                      ; section 2.4
cm    = Poseidon(DS_NOTE, value, asset, owner, salt, label)       ; 6 inputs
nf    = Poseidon(DS_NF, nk, cm, leaf_index)                       ; position-bound
```

### 5.2 Owner kinds

| Kind | `owner` | Spend authority | Nullifier key | Phase |
|---|---|---|---|---|
| Plain | `pk = Poseidon(DS_PK, ak.x, ak.y, nk)` | signature by `ask` | `nk` | P1 |
| Policy | `Poseidon(DS_OWNER, principal_pk, agent_pk, policy_root)` | principal or agent `ask` | the principal's `nk` (bound inside `principal_pk`) | fixed, P3 |
| Channel | `Poseidon(DS_CHAN, merchant_owner, refund_owner, bjj.x, bjj.y, expiry_epoch, nk_ch)` | merchant before expiry, refund owner after | `nk_ch = Poseidon(DS_NK_CH, chan_secret)` | fixed, P3 |

**Invariant I-NK.** For every owner kind, the `nk` used in `nf` MUST be bound inside the owner preimage. Otherwise a
spender picks a second `nk` and derives a second valid nullifier for the same note (finding F-NK in Phase 0).

**Finding F-NK-CH (changed by this spec).** DESIGN 5.5 had `owner_ch = Poseidon(DS_CHAN, ..., expiry_epoch, chan_nonce)`
with `nk_ch` outside the preimage, which breaks I-NK. The final channel owner puts `nk_ch` in the last position
(`chan_nonce` is no longer an owner input; `nk_ch` derives from the random `chan_secret`).

### 5.3 Labels (Phase 1 rules)

- A deposit (a transact with `deposit_amount > 0`) gets `deposit_label = Poseidon(DS_LABEL, h248(pool_id), deposit_counter)`
  from the program, and both its outputs carry it. Its inputs MUST be dummies (value 0).
- Any other transact: both inputs carry the same label `L` (a dummy input copies the real input's label) and both
  outputs carry `L`. Notes of different labels cannot be merged in Phase 1; a payer with several labels makes
  several transacts. Cross-label merges arrive with association proofs (DESIGN 5.7, Phase 4).
- These rules hold from the first deposit, so every Phase 1 note keeps a pure deposit label that Phase 4
  association sets and ragequit can use.

### 5.4 Dummy notes

- A dummy input has `value = 0`, the spender's `pk` as owner, a fresh uniformly random `salt`, the label required by
  section 5.3, and `leaf_index = 0` (any index is valid; 0 is RECOMMENDED). Its nullifier is computed and recorded
  like any other, so dummies are indistinguishable on chain.
- A dummy output has `value = 0`, an owner chosen by the sender (normally its own `pk`) and a fresh random salt.
- Two dummies with the same salt in one transact produce equal nullifiers and the transact fails
  (`E_DUPLICATE_NULLIFIER`); salts MUST come from a CSPRNG.

### 5.5 Value bounds

All four note values are `< 2^64` (range-checked in circuit) and `|public_amount| < 2^64` (a `u64` on the wire). The
conservation equation is therefore an integer equation: both sides are below `3 * 2^64 < r`.

### 5.6 Asset

One transact moves one asset: all four notes share `asset`, and `public_asset = asset` when `public_amount != 0`.
The program derives `asset` from the mint account it is given (section 8.5 step 8).

### 5.7 Note encryption (normative; cross-implementation vector V-NOTE-ENC is a Phase 1 deliverable of WP-CLIENT)

Each output `j` has a 160-byte ciphertext slot in `ext_data`:

```
esk     = 32 random bytes;   epk = X25519(esk, 9);   ss = X25519(esk, ivk_pub_d)
okm     = HKDF(ss, "dark-null-note-enc-v1" || epk || ivk_pub_d, 97)
key     = okm[0..32];   salt = OS2IP(okm[32..96]) mod r;   view_tag = okm[96]
pt      = 0x01 || LE64(value) || BE32(asset) || BE32(label) || memo[32] || 0x00*6          ; 111 bytes
ct      = ChaCha20-Poly1305(key, nonce = 0x00*12, aad = empty, pt)                         ; 127 bytes
slot    = epk || ct || view_tag                                                            ; 160 bytes
```

- The note's `salt` is the derived `salt`, so the recipient learns it from the shared secret. `owner` is the
  recipient's own `pk` and is not transmitted.
- Scanning: compute `ss' = X25519(ivk_d, epk)`, re-derive `okm`, compare `view_tag` (skips 255/256 of foreign
  notes), then decrypt and recompute `cm` against the transact's `cm_j`. A mismatch means the slot is not for this key.
- Unused slots (a dummy output, `ciphertext_rec` in Phase 1) carry 160 uniformly random bytes.
- The circuit does not check encryption. A sender who writes a wrong ciphertext only hurts its own payment; the
  x402 merchant verifier (P2) decrypts and recomputes `cm0` before serving.
- `memo` for `dark-null-exact` is the 32-byte `quote_binding` (section 11.1); otherwise 32 random bytes.

## 6. Merkle tree

### 6.1 Structure

- Depth 32; leaves are `cm` values; an empty leaf is 0; node `= Poseidon(left, right)` (untagged, section 3.1).
- `ZEROS[0] = 0`, `ZEROS[i+1] = Poseidon(ZEROS[i], ZEROS[i])`; the empty root is `ZEROS[32] = 0x2f68a1c5...34ead9`
  (all 33 values in V-E2E `tree.zeros` and `dark_null_transcript::tree::ZEROS`).
- Path bit `k` (LSB first) of `leaf_index` selects whether the node at level `k` is a right child.

### 6.2 On-chain insertion (one aligned depth-1 subtree per transact)

```
require next_index % 2 == 0 and next_index <= 2^32 - 2           ; else E_TREE_FULL
node = Poseidon(cm0, cm1)                                         ; level 1, cm0 at next_index, cm1 at next_index + 1
idx  = next_index >> 1
for level in 1..=31:
    if idx & 1 == 0: filled[level] = node; node = Poseidon(node, ZEROS[level])
    else:                                  node = Poseidon(filled[level], node)
    idx >>= 1
root_head = (root_head + 1) mod 256;  roots[root_head] = node;  next_index += 2
```

Exactly 32 `Poseidon(2)` calls. [M] 32,869-32,892 CU per insertion with `dark-null-transcript` on devnet
(`bench/results/p0/2026-10-06/devnet_probe_v2.json`; the syscall alone is 32 x 786 = 25,152 CU).

### 6.3 Root history

- A ring of 256 roots. At initialization `roots[0] = ZEROS[32]`, all other slots are zero, `root_head = 0`.
- A transact names `root` and `root_hint`. The program accepts it iff `root != 0` and `roots[root_hint] == root`
  (`E_UNKNOWN_ROOT`). The zero check stops a zero root matching an unwritten slot (scenario S4).
- A root stays usable for 255 later transacts. A client whose root left the window rebuilds (`E_STALE_ROOT` in the API).

## 7. The `transact_v2` statement and the Phase 1 circuit

### 7.1 Public input

The Groth16 proof has one public input:

```
pi = Poseidon(DS_PI, root, nf0, nf1, cm0, cm1, public_amount, public_asset,
              ext_data_hash, claimed_epoch, deposit_label, assoc_root)          ; 12 inputs
```

| Field | Source on chain | Phase 1 rule |
|---|---|---|
| `root` | instruction data | in the root ring (6.3) |
| `nf0, nf1` | instruction data | canonical, distinct, unspent |
| `cm0, cm1` | instruction data | canonical; inserted in this order |
| `public_amount` | derived from `deposit_amount`, `withdraw_amount` (2.5) | at most one leg |
| `public_asset` | derived from the mint account (2.5) | |
| `ext_data_hash` | computed by the program from the `ext_data` bytes (7.3) | |
| `claimed_epoch` | instruction data | `\|claimed_epoch - now_epoch\| <= 1` |
| `deposit_label` | computed by the program (5.3) for deposits, else 0 | |
| `assoc_root` | instruction data | MUST be 0 in Phase 1 (`E_ASSOC_DISABLED`) |

### 7.2 Spend digest

```
sighash = Poseidon(DS_SIGHASH, nf0, nf1, cm0, cm1, public_amount, public_asset, ext_data_hash, claimed_epoch)
```

`sighash` covers `ext_data_hash`, so the signature covers the relayer, the fee, the recipient and the memo.

### 7.3 `ext_data` (649 bytes) and its hash

| Offset | Len | Field | Rule |
|---|---|---|---|
| 0 | 1 | `version` | `0x01` |
| 1 | 32 | `pool_id` | MUST equal the pool's `pool_id` (8.2); binds the proof to one pool (scenario S5) |
| 33 | 32 | `public_token_account` | deposit: the source token account; withdraw with recipient amount > 0: the destination; otherwise the pool vault address (meaning "none") |
| 65 | 32 | `relayer_fee_account` | token account of the mint that receives `relayer_fee`; the vault address when `relayer_fee = 0` |
| 97 | 8 | `relayer_fee` | `LE64`; MUST be 0 for deposits; MUST be `<= withdraw_amount` otherwise |
| 105 | 32 | `memo_binding` | `quote_binding` (11.1) for x402 exact; receipt anchor (11.3) for channel close; otherwise 32 random bytes |
| 137 | 32 | `stealth_ephemeral` | `R` of a stealth withdraw (9.4); otherwise the compression of `x * B` for a fresh random scalar `x` |
| 169 | 160 | `ciphertext0` | output 0 (5.7) |
| 329 | 160 | `ciphertext1` | output 1 |
| 489 | 160 | `ciphertext_rec` | Phase 4 disclosure record; 160 random bytes in Phase 1 |

```
ext_data_hash = h248(SHA256("dark-null-extdata-v1" || ext_data[0..649]))
```

The hash covers exactly the bytes the program receives (scenario S3). Unused fields are random rather than zero so
that transact kinds stay indistinguishable apart from the public legs (DESIGN G4).

### 7.4 Witness

| Signal | Type | Meaning |
|---|---|---|
| `root, public_amount, public_asset, ext_data_hash, now_epoch, deposit_label, assoc_root` | Fr | statement fields (7.1); `now_epoch` is `claimed_epoch` |
| `asset` | Fr | the transact's asset |
| `ak[2]` | Fr | spender's BabyJubJub public key |
| `nk` | Fr | spender's nullifier key |
| `sig_R8[2], sig_S` | Fr | signature on `sighash` |
| `in_value[2], in_salt[2], in_label[2], in_leaf_index[2]` | Fr | input notes (owner is `pk`, computed) |
| `in_path[2][32]` | Fr | authentication paths (siblings, leaf level first) |
| `out_value[2], out_owner[2], out_salt[2], out_label[2]` | Fr | output notes |
| output `pi` | Fr | the only public signal |

### 7.5 Constraints (normative; reference: `transact_v2_spec.circom`)

- **C1 spend key.** `ak` is on BabyJubJub (`BabyCheck`). `pk = Poseidon(DS_PK, ak.x, ak.y, nk)`.
- **C2 inputs** (`i = 0, 1`).
  - `Num2Bits(64)(in_value[i])`.
  - `cm_in[i] = Poseidon(DS_NOTE, in_value[i], asset, pk, in_salt[i], in_label[i])`.
  - `Num2Bits(32)(in_leaf_index[i])` gives the path bits.
  - `(MerkleRoot(cm_in[i], bits, in_path[i]) - root) * in_value[i] == 0`: membership for non-zero values.
  - `nf[i] = Poseidon(DS_NF, nk, cm_in[i], in_leaf_index[i])`.
- **C3 outputs** (`j = 0, 1`). `Num2Bits(64)(out_value[j])`;
  `cm_out[j] = Poseidon(DS_NOTE, out_value[j], asset, out_owner[j], out_salt[j], out_label[j])`.
- **C4 conservation.** `in_value[0] + in_value[1] + public_amount == out_value[0] + out_value[1]`.
- **C5 public asset.** `public_amount * (public_asset - asset) == 0`.
- **C6 labels.** `isDep = 1 - IsZero(deposit_label)`;
  `isDep * in_value[i] == 0`; `(1 - isDep) * (in_label[1] - in_label[0]) == 0`;
  `out_label[j] == isDep * deposit_label + (1 - isDep) * in_label[0]`.
- **C7 spend authorization.** `sighash` per 7.2 from `nf`, `cm_out` and the statement fields;
  `EdDSAPoseidonVerifier(enabled = 1, A = ak, R8 = sig_R8, S = sig_S, M = sighash)`.
- **C8 statement.** `pi = Poseidon(DS_PI, root, nf0, nf1, cm_out0, cm_out1, public_amount, public_asset, ext_data_hash, now_epoch, deposit_label, assoc_root)`.

[M] 23,166 R1CS constraints (circom 2.2.3 `--O2`), 3 V-E2E witnesses satisfy it with `pi` equal to the vectors, and 13
tampered witnesses (each group C1-C7) fail: [`witness_check_v2_spec.json`](../../bench/results/p0/2026-10-06/witness_check_v2_spec.json).

### 7.6 Soundness notes

- **No wrap.** C2/C3 range checks plus the `u64` public leg keep C4 an integer equation (5.5).
- **One nullifier per note.** `nk` is bound in `pk` (C1) and `pk` is the input owner (C2), so `nf` is a function of
  the note and its position. Two notes with equal `cm` at different leaves have different `nf` (position binding).
- **Value-0 inputs** skip membership; they create no value (C4) and their nullifiers are random.
- **Deposits** cannot carry value in from existing notes (C6), so every note's label traces to exactly one deposit.
- **Relayer.** Every relayer-visible field is in `ext_data`, and `ext_data_hash` is in `pi` and `sighash`.
- **Malleability.** Groth16 proofs can be re-randomized; a re-randomized proof has the same `pi` and nullifiers and
  is rejected as a double spend.
- **Setup.** Phase 1 keys are `dev-setup` (single-operator phase 2, operator can forge; DESIGN 8.1). They are labelled
  as such in `MANIFEST.json`.

### 7.7 Phase 1 versus later branches

The Phase 1 circuit contains the principal branch only (C1-C8). Phase 3 adds the policy and channel branches and
Phase 4 the association branch, under the same `pi`, the same note format and the same owner encodings (5.2). That
is a new verifying key. Phase 1 notes remain spendable through the plain-owner branch of the later circuit; no note
migrates. Reason for not compiling inactive branches into Phase 1: the program could only disable them through a
public selector, which would reveal the transaction kind (DESIGN G4), and they would cost proving time for no
function. Phase 0 measured the full-size proxy at p50 433 ms (4 vCPU), so B1 does not force this choice.

## 8. Program `dark-null-pool-v2` (Phase 1)

### 8.1 State

Program-owned accounts begin with an 8-byte account discriminator. Layouts are `repr(C)` little-endian.

**`PoolConfig`** (`["dark-null-pool", pool_nonce]`, 256 bytes):

| Off | Len | Field |
|---|---|---|
| 0 | 8 | discriminator |
| 8 | 1 | `version` = 1 |
| 9 | 1 | `bump` |
| 10 | 1 | `paused` (0/1) |
| 11 | 1 | `flags` (bit 0 `require_assoc`, MUST be 0 in Phase 1) |
| 12 | 4 | padding |
| 16 | 32 | `authority` (devnet/beta admin; disclosed) |
| 48 | 32 | `pool_nonce` |
| 80 | 32 | `pool_id` |
| 112 | 32 | `vk_hash` = SHA256 of the verifying-key bytes compiled into the program |
| 144 | 8 | `epoch_seconds` |
| 152 | 8 | `deposit_counter` |
| 160 | 32 | `tree` |
| 192 | 64 | reserved (zero) |

**`Tree`** (`["dark-null-tree", pool_config]`, 9,248 bytes, below the 10,240-byte CPI allocation limit):

| Off | Len | Field |
|---|---|---|
| 0 | 8 | discriminator |
| 8 | 1 | `version` = 1 |
| 9 | 1 | `bump` |
| 10 | 6 | padding |
| 16 | 8 | `next_index` |
| 24 | 2 | `root_head` |
| 26 | 6 | padding |
| 32 | 1,024 | `filled[32][32]` (index 0 unused) |
| 1,056 | 8,192 | `roots[256][32]` |

**`MintState`** (`["dark-null-mint", pool_config, mint]`, 192 bytes):

| Off | Len | Field |
|---|---|---|
| 0 | 8 | discriminator |
| 8 | 1 | `version` = 1 |
| 9 | 1 | `bump` |
| 10 | 1 | `vault_bump` |
| 11 | 1 | `token_program_kind` (0 SPL Token, 1 Token-2022) |
| 12 | 1 | `decimals` |
| 13 | 1 | `freeze_authority_present` (disclosed per mint, DESIGN 7.5) |
| 14 | 2 | padding |
| 16 | 32 | `mint` |
| 48 | 32 | `vault` |
| 80 | 32 | `asset` (5.1) |
| 112 | 8 | `supply` |
| 120 | 8 | `outflow_cap_per_epoch` (`u64::MAX` = no cap) |
| 128 | 8 | `outflow_epoch` |
| 136 | 8 | `outflow_in_epoch` |
| 144 | 48 | reserved |

**Vault**: a token account at `["dark-null-vault", pool_config, mint]` for `mint`, authority = vault authority PDA
`["dark-null-vault-auth", pool_config]` (one authority per pool). Token-2022 vaults are created with `ImmutableOwner`.

**Nullifier record**: `["dark-null-nf", pool_config, BE32(nf)]`, 0 data bytes, owner = the pool program (8.6).

### 8.2 Pool identity and epochs

```
pool_id   = SHA256("dark-null-pool-id-v1" || program_id || pool_config)       ; 32 bytes, stored in PoolConfig
now_epoch = floor(Clock.unix_timestamp / epoch_seconds)
```

`pool_nonce` is chosen by the initializer; it SHOULD be `SHA256(genesis_hash || 32 random bytes)` so that pools of
the same program id on different clusters have different ids. Devnet default `epoch_seconds = 3600`.

### 8.3 Instructions

| Instruction | Accounts | Data after the discriminator | Effect |
|---|---|---|---|
| `initialize_pool` | `authority` (s, w), `pool_config` (w), `tree` (w), `system_program` | `pool_nonce[32]`, `epoch_seconds: u64` | Creates `PoolConfig` and `Tree`; computes `pool_id`; `roots[0] = ZEROS[32]` |
| `register_mint` | `authority` (s, w), `pool_config`, `mint`, `mint_state` (w), `vault` (w), `vault_authority`, `token_program`, `system_program` | `outflow_cap_per_epoch: u64` | Mint checks (8.7), creates `MintState` and the vault, sets `asset` |
| `transact` | 13 accounts (8.4) | 1,123 bytes (1,131 with the discriminator; 8.4) | Section 8.5 |
| `set_beta_limits` | `authority` (s), `pool_config`, `mint_state` (w) | `outflow_cap_per_epoch: u64` | Devnet/beta only |
| `set_paused` | `authority` (s), `pool_config` (w) | `paused: u8` | Devnet/beta only; while paused every `transact` fails with `E_PAUSED` |
| `post_assoc_root`, `ragequit` | | | Reserved (Phase 4) |

### 8.4 `transact` instruction

Data (1,131 bytes, `dark_null_transcript::ix`):

| Off | Len | Field |
|---|---|---|
| 0 | 8 | discriminator `d995828fdd34fc77` |
| 8 | 64 | `proof_a` (negated) |
| 72 | 128 | `proof_b` |
| 200 | 64 | `proof_c` |
| 264 | 32 | `root` |
| 296 | 32 | `nf0` |
| 328 | 32 | `nf1` |
| 360 | 32 | `cm0` |
| 392 | 32 | `cm1` |
| 424 | 8 | `deposit_amount` (`LE64`) |
| 432 | 8 | `withdraw_amount` (`LE64`) |
| 440 | 8 | `claimed_epoch` (`LE64`) |
| 448 | 32 | `assoc_root` |
| 480 | 2 | `root_hint` (`LE16`) |
| 482 | 649 | `ext_data` (7.3) |

`root_hint` sits outside `ext_data` (DESIGN 5.1 listed it inside): it only locates `root`, which `pi` binds, so a
relayer MAY correct a hint without invalidating the proof.

Accounts (identical list and flags for every transact kind):

| # | Account | Signer | Writable | Check |
|---|---|---|---|---|
| 0 | `submitter` | yes | yes | Fee payer; pays nullifier rent. Deposit: authority of `public_token_account`. Spend: the relayer (or self) |
| 1 | `pool_config` | | yes | PDA, owner = program |
| 2 | `tree` | | yes | `== pool_config.tree` |
| 3 | `vault` | | yes | `== mint_state.vault` |
| 4 | `mint` | | | `== mint_state.mint` |
| 5 | `public_token_account` | | yes | `== ext_data.public_token_account`; a token account of `mint` |
| 6 | `relayer_fee_account` | | yes | `== ext_data.relayer_fee_account`; a token account of `mint` |
| 7 | `nf_record0` | | yes | canonical PDA for `nf0` (8.6) |
| 8 | `nf_record1` | | yes | canonical PDA for `nf1` |
| 9 | `vault_authority` | | | PDA |
| 10 | `mint_state` | | yes | PDA for (`pool_config`, `mint`) |
| 11 | `token_program` | | | `== SPL Token` or `Token-2022` per `mint_state.token_program_kind` |
| 12 | `system_program` | | | |

The address table of a transact has 14 entries (13 accounts plus the program id).

### 8.5 `transact` execution order (normative)

1. `paused == 0`, else `E_PAUSED`. Parse the data: length 1,131, discriminator, canonical `root, nf0, nf1, cm0, cm1,
   assoc_root` (`E_NONCANONICAL_FIELD`), at most one public leg (`E_BAD_PUBLIC_AMOUNT`), `root_hint < 256`,
   `nf0 != nf1` (`E_DUPLICATE_NULLIFIER`), `ext_data` version (`E_BAD_EXT_DATA`). The data SHOULD be read in place
   (zero-copy); SBF stack frames are 4 KiB.
2. `assoc_root == 0` (`E_ASSOC_DISABLED`). `ext_data.pool_id == pool_config.pool_id` (`E_WRONG_POOL`).
3. Account checks of 8.4 (`E_ACCOUNT_MISMATCH`, `E_TOKEN_ACCOUNT_INVALID`).
4. Fee rules (`E_BAD_FEE`): deposit ⇒ `relayer_fee == 0`, `relayer_fee_account == vault` and
   `public_token_account != vault`; otherwise `relayer_fee <= withdraw_amount`, and
   `public_token_account == vault` exactly when `withdraw_amount - relayer_fee == 0`; `relayer_fee_account == vault`
   exactly when `relayer_fee == 0`.
5. Root: `root != 0` and `tree.roots[root_hint] == root` (`E_UNKNOWN_ROOT`).
6. Epoch: `|claimed_epoch - now_epoch| <= 1` (`E_EPOCH_WINDOW`).
7. `ext_data_hash = h248(sol_sha256("dark-null-extdata-v1", ext_data))`.
8. `asset = mint_state.asset`; `public_amount`, `public_asset` per 2.5;
   `deposit_label = Poseidon(DS_LABEL, h248(pool_id), deposit_counter)` if `deposit_amount > 0`, else 0.
9. `pi` per 7.1 with one `sol_poseidon` call (12 inputs).
10. Groth16 verify of (`proof_a`, `proof_b`, `proof_c`) against `[pi]` with the compiled verifying key
    (groth16-solana on the `alt_bn128` syscalls), else `E_PROOF_INVALID`.
11. Record `nf0`, then `nf1` (8.6); an existing record fails the transaction (`E_NULLIFIER_SPENT`).
12. Insert `cm0, cm1` (6.2), push the root, emit the event (8.10).
13. Public leg:
    - deposit: `TransferChecked(public_token_account -> vault, deposit_amount)` signed by `submitter`; then
      `vault.amount_after == vault.amount_before + deposit_amount` (`E_DEPOSIT_DELTA`); `supply += deposit_amount`
      (checked); `deposit_counter += 1`.
    - withdraw: outflow cap (8.7); `supply >= withdraw_amount` (`E_SUPPLY`); `supply -= withdraw_amount`;
      `TransferChecked(vault -> public_token_account, withdraw_amount - relayer_fee)` if non-zero and
      `TransferChecked(vault -> relayer_fee_account, relayer_fee)` if non-zero, both signed by `vault_authority`.
14. Solvency: reload the vault; `vault.amount >= supply` (`E_SOLVENCY`).

Steps 1-9 are pure and identical to the reference model in
[`tests/prover_malicious.rs`](../../crates/dark-null-transcript/tests/prover_malicious.rs).

### 8.6 Nullifier store, option A

- Record address: canonical PDA `["dark-null-nf", pool_config, BE32(nf)]`. The program derives it with
  `find_program_address` (`sol_try_find_program_address`) and compares it with the account at index 7/8
  (`E_NULLIFIER_ACCOUNT`). The client does not send a bump.
- **Finding F-BUMP (new in this spec).** If the program accepted a client-supplied bump, a lower off-curve bump
  gives a second valid address for the same nullifier, which is a double spend. The Phase 0 spike took the bump from
  the client; `dark-null-pool-v2` MUST NOT (scenario S8). Cost [M]: 1,535 CU per bump attempt (bump 255: 1,535;
  254: 3,035; 251: 7,535), [`devnet_probe_v2.json`](../../bench/results/p0/2026-10-06/devnet_probe_v2.json); mean
  about 2 attempts [E].
- **Spent predicate:** the record account's owner is the pool program.
- **Creation:** if the account has 0 lamports, `CreateAccount(space 0, owner = program)` funded by `submitter` and
  signed with the PDA seeds. **Finding F-PREFUND:** anyone can send lamports to an unused record address (the
  nullifier is visible in a pending transaction), which makes `CreateAccount` fail. If the account is owned by the
  System program with 0 data, the program instead tops it up to the rent-exempt minimum, then `Allocate(0)` and
  `Assign(program)` with the PDA seeds. Any other state is `E_NULLIFIER_ACCOUNT`.
- Cost: [M] 1,727 CU per create (PHASE0_RESULTS section 3) plus the PDA search; 650,240 lamports rent per record,
  never reclaimed. No instruction closes a record.

### 8.7 Mints and the solvency guard

`register_mint` accepts a mint owned by SPL Token, or by Token-2022 whose extensions are all in this allowlist:

| Accepted (Token-2022 mint extensions) | Note |
|---|---|
| `MetadataPointer`, `TokenMetadata`, `GroupPointer`, `TokenGroup`, `GroupMemberPointer`, `TokenGroupMember` | metadata only |
| `InterestBearingConfig`, `ScaledUiAmount` | UI amount only; raw amounts are unchanged; disclosed per mint |
| `DefaultAccountState` with state `Initialized` | |

Everything else is rejected (`E_MINT_EXTENSION_REJECTED`), including: `TransferFeeConfig`, `TransferHook`,
`PermanentDelegate`, `ConfidentialTransferMint`, `ConfidentialTransferFeeConfig`, `ConfidentialMintBurn`,
`NonTransferable`, `MintCloseAuthority`, `Pausable`, `DefaultAccountState(Frozen)`, and any extension type unknown to
the pinned `spl-token-2022` version. An allowlist (not a blocklist) keeps future extension types out by default.
A classic freeze authority is accepted and recorded in `freeze_authority_present`; the API shows it (the issuer can
freeze the vault for every user of that mint).

Solvency guard (defense in depth over C4):

- `supply` per mint rises on deposit and falls on withdraw; a withdraw never exceeds it.
- After every transact, `vault.amount >= supply`.
- Beta outflow cap: if `now_epoch != outflow_epoch` then `outflow_epoch = now_epoch, outflow_in_epoch = 0`; require
  `outflow_in_epoch + withdraw_amount <= outflow_cap_per_epoch` (`E_OUTFLOW_CAP`). Bounds the loss from an unknown
  circuit bug to one epoch's cap per mint.

### 8.8 Verifier

- groth16-solana `Groth16Verifier` with one public input; the verifying key is generated at build time from the
  manifest-bound `dev-setup` artifacts (`scripts/generate-verifying-key.mjs`); `vk_hash` is stored in `PoolConfig`
  and served by `GET /v1/health`.
- [M] 81,282 CU per verify on devnet for the Phase 1 skeleton (PHASE0_RESULTS section 2).

### 8.9 Error codes

Anchor-style custom codes. The API column is what the local core reports when it sees the code.

| Code | Name | Meaning | API code |
|---|---|---|---|
| 6000 | `E_PAUSED` | pool paused | `E_INTERNAL` |
| 6001 | `E_BAD_IX` | wrong length or discriminator | `E_INTERNAL` |
| 6002 | `E_NONCANONICAL_FIELD` | a field element `>= r` | `E_INTERNAL` |
| 6003 | `E_BAD_PUBLIC_AMOUNT` | both legs non-zero | `E_BAD_REQUEST` |
| 6004 | `E_BAD_EXT_DATA` | `ext_data` length or version | `E_INTERNAL` |
| 6005 | `E_WRONG_POOL` | `ext_data.pool_id` mismatch | `E_INTERNAL` |
| 6006 | `E_ASSOC_DISABLED` | `assoc_root != 0` in Phase 1 | `E_INTERNAL` |
| 6007 | `E_UNKNOWN_ROOT` | root not at `root_hint` or zero | `E_STALE_ROOT` |
| 6008 | `E_EPOCH_WINDOW` | `claimed_epoch` outside the window | `E_BUILD_EXPIRED` |
| 6009 | `E_DUPLICATE_NULLIFIER` | `nf0 == nf1` | `E_INTERNAL` |
| 6010 | `E_NULLIFIER_ACCOUNT` | record account not the canonical PDA or in a foreign state | `E_INTERNAL` |
| 6011 | `E_NULLIFIER_SPENT` | nullifier already recorded | `E_NULLIFIER_SPENT` |
| 6012 | `E_PROOF_INVALID` | Groth16 verification failed | `E_INTERNAL` |
| 6013 | `E_ACCOUNT_MISMATCH` | an account of 8.4 does not match | `E_INTERNAL` |
| 6014 | `E_TOKEN_ACCOUNT_INVALID` | public or relayer account is not a token account of `mint` | `E_BAD_REQUEST` |
| 6015 | `E_BAD_FEE` | fee rule of 8.5 step 4 | `E_BAD_REQUEST` |
| 6016 | `E_SUPPLY` | withdraw above `supply` | `E_INSUFFICIENT_FUNDS` |
| 6017 | `E_SOLVENCY` | `vault.amount < supply` after the transact | `E_INTERNAL` |
| 6018 | `E_OUTFLOW_CAP` | beta outflow cap reached | `E_RELAYER_UNAVAILABLE` (retry next epoch) |
| 6019 | `E_TREE_FULL` | `next_index > 2^32 - 2` | `E_INTERNAL` |
| 6020 | `E_DEPOSIT_DELTA` | vault received a different amount | `E_INTERNAL` |
| 6021 | `E_MINT_EXTENSION_REJECTED` | `register_mint` allowlist | n/a |
| 6022 | `E_UNAUTHORIZED` | admin instruction without the authority | n/a |
| 6023 | `E_ARITHMETIC` | checked arithmetic overflow | `E_INTERNAL` |

### 8.10 Events and logs

- One `sol_log_data` per transact: `["dnull-v2-tx", LE64(leaf_index_of_cm0), LE16(root_head), new_root[32]]`.
- Deposits add `["dnull-v2-dep", deposit_label[32], submitter[32], mint[32], LE64(deposit_amount)]` (public anyway;
  input for association-set providers in Phase 4).
- No other program logs: no `msg!` with variable content, and the Anchor instruction-name log is disabled
  (`no-log-ix-name`). Ciphertexts live in instruction data, so scanning never depends on log retention.
- Nothing logged is derived from private data; every logged value is already in the instruction data or account
  state.

### 8.11 Compute and transaction budget

| Component | CU | Label |
|---|---|---|
| Groth16 verify, 1 public input | 81,282 | [M] PHASE0_RESULTS 2 |
| Parse + `ext_data_hash` (`sol_sha256`, 669 bytes) + `pi` (+ deposit label) via `dark-null-transcript` | 13,056 (spend) / 13,311 (deposit) | [M] `devnet_probe_v2.json` (`sha256` alone 487) |
| Tree insertion via `dark-null-transcript` | 32,869-32,892 | [M] same |
| Two nullifier records: PDA search (1,535 per attempt) + create (1,727) | about 6.5k-9.5k | [M] parts; total [E] |
| Two token transfers (CPI) | about 10-16k | [E] |
| Account checks, framework | about 10-30k | [E] |
| **transact total** | **about 155-185k** | [E] from the measured parts; gate B2 at 400k |

## 9. Transactions and relayers

### 9.1 Transaction V1 (SIMD-0385)

- Format per PHASE0_RESULTS section 1: `0x81 || header[3] || LE32(config_mask) || blockhash[32] || n_ix || n_addr ||
  addresses || config values || per-instruction (program index, n_accounts, LE16(data_len)) || payloads`, followed by
  the signatures (no length prefix). The signature covers the message bytes including `0x81`.
- The builder MUST set both the compute-unit limit and the loaded-accounts-data-size limit: an absent
  loaded-accounts-data-size limit means 0 and the transaction fails before execution [M].
  - `compute_unit_limit = min(400_000, ceil(1.1 * simulated_units) + 5_000)`; 400,000 when simulation is not
    possible.
  - `loaded_accounts_data_size_limit =` the sum of the data lengths of every account in the message, plus the
    ProgramData account of every upgradeable program invoked (pool, token program), plus 32 KiB, rounded up to a
    multiple of 32 KiB, at most 64 MiB.
  - Priority fee (config bits 0-1) MAY be set; it is part of the fee quote.
- Size: about 1.72 KB for a transact with one signature and a priority fee [E from 8.4: 1,131 data bytes, 14
  addresses], below the 4,096-byte limit [M]. A legacy (1,232-byte) fallback is not specified for Phase 1.

### 9.2 Deposit

Self-submitted: the depositor's Solana wallet is `submitter` and signs. The deposit's shielded side (dummy inputs,
outputs to the depositor's `pk` with the program-assigned label) is proved like any transact; `deposit_label` is
read from `pool_config.deposit_counter` at build time. If another deposit lands first, the counter moves, `pi`
changes and the transaction fails; the core re-proves (one retry, then `E_STALE_ROOT`).

### 9.3 Relayed spends

Relayers are permissionless HTTP services (the DNA facilitator MAY run one).

| Method and path | Request | Response |
|---|---|---|
| `GET /v1/relayer/quote?mint=<b58>` | | `{ relayer: <b58 fee payer>, fee_account: <b58 token account of mint>, fee_atomic: "<u64>", nf_rent_lamports: "1300480", expires_at: <RFC 3339> }` |
| `POST /v1/relayer/submit` | `{ message_base64: <V1 message, fee payer = relayer>, quote_id? }` | `{ signature }` or error |

The relayer MUST, before signing: parse the message (one `transact`, the 13-account list, fee payer = itself);
check `ext_data.relayer_fee_account == fee_account` and `relayer_fee >= fee_atomic`; simulate. It cannot change
any `ext_data` field (each change breaks `pi`, scenario S11) and cannot redirect funds. Self-submission is always
possible and links the fee payer.

### 9.4 Withdraw to a stealth address (DNA x402 `dark-stealth-ed25519` scheme, unchanged for interoperability)

```
recipient meta-address (S, V):  s = LE(stealth_seed) mod L;  v = LE(SHA512("nullpay-ed25519-view-key-v1" || LE32(s))) mod L
sender: r = LE(32 random bytes) mod L;  R = r*B;  shared = LE(SHA512("nullpay-ed25519-shared-v1" || compress(r*V))) mod L
        P = S + shared*B;   public_token_account = ATA(P, mint);   ext_data.stealth_ephemeral = R
recipient: shared = LE(SHA512(tag || compress(v*R))) mod L;  p = s + shared mod L;  p*B == P
```

`LE(.) mod L` is curve25519-dalek `from_bytes_mod_order` (32 bytes) / `from_bytes_mod_order_wide` (64 bytes). The
tags keep their DNA x402 names so that `.null` meta-addresses published through DNA x402 work unchanged. The
recipient scans withdraws by recomputing `ATA(P', mint)` from each `stealth_ephemeral`.

## 10. Local core: localhost HTTP API v1

Normative form of DESIGN 12.7. The core proves and builds; it never holds spend keys.

### 10.1 Process and transport

- Started by the runtime only when the user enables the wallet. argv carries no secret. The first stdin line is a
  JSON object `{ bearer_token, consent_key, rpc_url, relayers: [url], x402_enabled: false, mint_allowlist: [b58],
  data_dir }`.
- Binds `127.0.0.1:<port>` (port from argv). Rejects a `Host` other than `127.0.0.1:<port>` and a missing or wrong
  `Authorization: Bearer` with `E_UNAUTHORIZED`. No CORS headers. JSON bodies; amounts are decimal strings of
  atomic units; byte strings are lowercase hex; Solana keys are base58.
- **Devnet only.** Built with the `devnet-only` cargo feature (the only build). No mainnet program id is compiled
  in. At start and on every RPC reconnect, `getGenesisHash` MUST equal
  `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` (devnet [V] 2026-10-06), else the core refuses with
  `E_NETWORK_FORBIDDEN`.
- **x402 off by default.** `/v1/x402/*` returns `E_FEATURE_DISABLED` unless `x402_enabled = true` and the mint is in
  `mint_allowlist` (default: devnet wSOL and one devnet test mint).
- Envelope: `{ "ok": true, "data": {...} }` or `{ "ok": false, "error": { "code", "message", "retryable" } }`.

### 10.2 Signing model and consent

1. A build endpoint selects notes, fetches a root, composes `ext_data`, computes `sighash`, and returns a **build
   object** with a `fee_quote` and `signing_requests`. Nothing is signed or submitted yet.
2. The runtime shows the summary and the fee quote, checks its caps, and raises its consent prompt.
3. The wallet layer signs each `digest` in-process with `dark-null-signer` and returns signatures.
4. The runtime posts `{ signatures, consent_token }`. `consent_token = hex(HMAC-SHA256(consent_key,
   "dark-null-consent-v1" || build_id || digest_1 || ... || digest_n))`. The core checks the token and verifies each
   signature against `ak` (or the session key) before proving; then proves locally and submits.

No endpoint accepts a seed, `ask` or `bjj_session`, and no endpoint returns a submitted spend without a verified
signature from the wallet layer (test C-CONSENT).

### 10.3 Endpoints

| Method and path | Request body / query | Response `data` | Phase |
|---|---|---|---|
| `GET /v1/health` | | `{ version, network: "solana:devnet", genesis_hash, program_id, vk_hash, synced_slot, frozen, x402_enabled }` | P2 |
| `POST /v1/accounts` | `{ account_id, viewing_bundle: { ak: [hex32, hex32], nk: hex32, ivk_root: hex32, ovk: hex32 }, storage_key: hex32 }` | `{ account_id, shielded_address }` | P2 |
| `POST /v1/accounts/{id}/sync` | `{ max_slots? }` | `{ synced_slot, notes: <count>, channels: <count> }` | P2 |
| `GET /v1/accounts/{id}/balance` | | `{ by_mint: [{ mint, spendable, pending, in_channels, labels: <count>, freeze_authority_present }] }` | P2 |
| `POST /v1/builds/deposit` | `{ account_id, mint, amount, from_pubkey }` | build object | P2 |
| `POST /v1/builds/transfer` | `{ account_id, to_address, mint, amount }` | build object | P2 |
| `POST /v1/builds/withdraw` | `{ account_id, mint, amount, to: { stealth: hex64 meta-address } \| { address: b58 } }` | build object | P2 |
| `POST /v1/x402/exact` | `{ account_id, payment_required, max_amount }` | build object; after confirmation `GET /v1/builds/{id}` adds `payment_signature_header` | P2 |
| `POST /v1/builds/delegate` | `{ account_id, agent_index, agent_ak, policy }` | build object | P3 |
| `POST /v1/x402/channels` | `{ account_id, payment_required, cap, epochs }` | build object | P3 |
| `POST /v1/x402/channels/{chan_id}/vouchers` | `{ quote, amount }` | `{ voucher_id, digest, cumulative, remaining }` | P3 |
| `POST /v1/x402/channels/{chan_id}/vouchers/{voucher_id}/signature` | `{ signature: hex64 }` | `{ payment_signature_header }` | P3 |
| `POST /v1/builds/channel-reclaim` | `{ account_id, chan_id }` | build object | P3 |
| `POST /v1/builds/{build_id}/signatures` | `{ signatures: [{ key_role, signature: hex64 }], consent_token }` | `{ status: "proving" }` | P2 |
| `GET /v1/builds/{build_id}` | | `{ status, tx_signature?, error?, payment_signature_header? }` | P2 |
| `POST /v1/builds/{build_id}/submit` | `{ via: "relayer" \| "self" }` | `{ status, tx_signature? }` or `{ unsigned_message_base64 }` for `self` | P2 |
| `DELETE /v1/builds/{build_id}` | | `{ status: "cancelled" }` | P2 |
| `GET /v1/receipts` | `?since=&merchant=&chan_id=` | `{ receipts: [...] }` | P2 |
| `POST /v1/viewing-keys` | `{ account_id, agent_index, period, consent_token }` | `{ scope, k_scope, verify_instructions }` | P4 |
| `POST /v1/freeze`, `POST /v1/unfreeze` | `{ consent_token? }` (unfreeze requires it) | `{ frozen, open_channel_exposure: [{ chan_id, remaining }] }` | P2 |

Build status values: `awaiting_signature`, `proving`, `proved`, `submitted`, `confirmed`, `failed`, `cancelled`,
`expired`.

### 10.4 Build object

```json
{
  "build_id": "b_<26 base32 chars>",
  "kind": "deposit | transfer | withdraw | x402_exact | delegate | channel_open | channel_reclaim",
  "network": "solana:devnet",
  "expires_at": "<RFC 3339: earliest of quote expiry, claimed_epoch + 1 end, root window estimate>",
  "summary": { "mint": "<b58>", "amount": "<u64>", "counterparty": "<merchant label | address hash>",
               "change": "<u64>", "channel_cap": "<u64 | null>" },
  "fee_quote": {
    "network_fee_lamports": "<5000 x signatures>",
    "priority_fee_lamports": "<ceil(cu_limit x micro_lamports / 1e6)>",
    "cu_estimate": 0,
    "loaded_accounts_data_size": 0,
    "nullifier_storage_lamports": "1300480",
    "relayer": "<b58 | null>",
    "relayer_fee": "<atomic units of the mint>",
    "payer_lamports": "<SOL paid by the user's wallet: deposits only>",
    "total_debit": "<atomic units leaving the shielded balance: amount + relayer_fee>"
  },
  "policy_check": { "in_circuit_policy": "none", "within_policy": true },
  "signing_requests": [
    { "key_role": "spend_auth | solana_owner", "key_ref": "<account_id>",
      "digest": "<hex32>", "digest_kind": "dnull-sighash-v1 | solana-message" }
  ]
}
```

- The fee quote is produced before any signing request is answered. `sighash` commits to `ext_data_hash`, which
  commits to `relayer_fee` and `relayer_fee_account`, so the signed fee is the shown fee.
- `nullifier_storage_lamports` is paid by the relayer for relayed spends (and recovered through `relayer_fee`), and by
  the depositor for deposits.

### 10.5 Errors

| HTTP | `code` | Meaning | `retryable` |
|---|---|---|---|
| 400 | `E_BAD_REQUEST` | malformed body or field | no |
| 401 | `E_UNAUTHORIZED` | bearer token or `Host` | no |
| 403 | `E_FROZEN` | panic freeze active | no |
| 403 | `E_NETWORK_FORBIDDEN` | RPC genesis is not devnet | no |
| 403 | `E_FEATURE_DISABLED` | x402 or the mint not enabled | no |
| 403 | `E_CONSENT_REQUIRED` | missing or wrong `consent_token` | no |
| 409 | `E_STALE_ROOT` | root left the window or deposit counter moved | yes |
| 409 | `E_NULLIFIER_SPENT` | an input was spent elsewhere | yes |
| 410 | `E_BUILD_EXPIRED` | build, quote or epoch window expired | no |
| 422 | `E_INSUFFICIENT_FUNDS` | not enough spendable value under one label | no |
| 422 | `E_POLICY_VIOLATION` | would fail the in-circuit policy (P3) | no |
| 422 | `E_QUOTE_INVALID` | x402 quote expired, malformed, or above `max_amount` | no |
| 422 | `E_BAD_SIGNATURE` | signature does not verify | no |
| 425 | `E_NOT_SYNCED` | local state too far behind | yes |
| 503 | `E_RELAYER_UNAVAILABLE` | no relayer accepted (self-submission possible) | yes |
| 504 | `E_PROVER_TIMEOUT` | proving exceeded the limit | yes |
| 500 | `E_INTERNAL` | unexpected; details in the local log only | yes |

## 11. x402 bindings

### 11.1 Quote binding *(fixed, P2)*

```
quote_binding = SHA256("dark-null-x402-quote-v1" || LP16(quoteId) || SHA256(resource) || LE64(amountAtomic)
                       || LE64(totalAtomic) || mint[32] || LP16(payTo) || LE64i(expiresAt as Unix seconds))
```

Fields come from the DNA x402 `Quote` (`x402/src/types.ts`); `payTo` is the merchant's `dnull1...` address string.
For `dark-null-exact`: `ext_data.memo_binding = quote_binding`, and `ciphertext0` carries the payment to the merchant
with `memo = quote_binding`. A refund address for exact mode travels in the payment header (P2), not on chain.
Pinned by [`V-EXTDATA.json`](../../vectors/v2/V-EXTDATA.json).

### 11.2 Vouchers and the receipt chain *(fixed, P3)*

```
voucher_msg_k   = Poseidon(DS_VOUCHER, chan_id, cumulative_k, h248(receipt_head_{k-1}))       ; chan_id = cm of the channel note
signature_k     = EdDSA-Poseidon(bjj_session, voucher_msg_k)                                    ; 4.4
voucher_wire_k  = BE32(chan_id) || LE64(cumulative_k) || receipt_head_{k-1} || packed_sig_k     ; 136 bytes
receipt_head_0  = 0x00*32
receipt_head_k  = SHA256("dark-null-rcpt-chain-v1" || receipt_head_{k-1} || BE32(voucher_msg_k) || dna_receipt_hash_k)
epoch anchor    = memo_binding = BE32(Poseidon(DS_RCPT, h248(receipt_head_N), salt))
```

Merchant checks per request: signature, `cumulative_k - cumulative_{k-1} == quote_k.amount`, `cumulative_k <= cap`.
Pinned by [`V-VOUCHER.json`](../../vectors/v2/V-VOUCHER.json).

## 12. What a transact reveals

| Observer sees | Deposit | In-pool transfer (relayed) | Withdraw |
|---|---|---|---|
| Depositor wallet, mint, amount | yes | | |
| Mint | yes | yes (the fee leg names it) | yes |
| Amount | deposit amount | relayer fee only | withdraw amount and fee |
| Recipient | | no | the token account (stealth ATA when used) |
| Which notes were spent | | no (nullifiers only) | no |
| Sender, receiver identities inside the pool | | no | no |
| Relayer | | yes | yes |
| Account list, instruction size | identical across kinds | identical | identical |

DESIGN 3.3 covers amount and timing fingerprints of public legs; the core defaults to rounded amounts and delayed
withdrawals.

## 13. Conformance material

### 13.1 Vectors

| File | Pins | Implementation 1 (JS) | Implementation 2 (Rust) | Chain (`sol_poseidon` / `sol_sha256`) | Circuit witness |
|---|---|---|---|---|---|
| V-DS | 15 field tags, byte tags, KDF infos, discriminators | generator | `ds_registry_matches_v_ds` | via every hash below | via V-E2E |
| V-POS | Poseidon n = 1..12 | circomlibjs | `v_pos_all_widths` | 24/24 (Phase 0) | 24/24 (Phase 0) |
| V-ASSET, V-KEYS, V-NOTE, V-NF, V-SIGHASH, V-PI, V-TREE | Phase 0 derivations | circomlibjs | `phase0_derivation_vectors` | 10/10 (Phase 0) | skeleton `pi` (Phase 0) |
| V-ADDR | key derivation, `pk`, X25519 `ivk_pub_d`, bech32m address, ed25519 stealth, ATA | node:crypto, circomlibjs, @noble/curves, @scure/base | `v_addr_keys_and_addresses` (own HKDF/bech32m, BabyJubJub reference, curve25519-dalek) | `nk`, `pk` calls | |
| V-EXTDATA | pool id, quote binding, `ext_data` layout and hash, 10 field mutations | node:crypto | `v_extdata_pool_quote_and_mutations` | `ext_data_hash` in TRANSACT_CHECK | |
| V-VOUCHER | session key, `nk_ch`, channel owner, `chan_id`, 3 vouchers with signatures and wire form, receipt chain, anchor | circomlibjs | `v_voucher_channel_and_signatures` | all Poseidon calls incl. EdDSA `hm` | |
| V-E2E | deposit, relayed transfer (x402 quote bound), relayed stealth withdraw: witnesses, nullifiers, commitments, `ext_data`, `sighash`, signatures, `pi`, instruction bytes, accounts and PDAs, roots after each insertion | generator | `v_e2e_join_split_sequence` | TRANSACT_CHECK x3, TREE_CHECK, NF_PDA_CHECK | 3/3 `pi` match |

### 13.2 Required rejections

From [`prover_malicious.rs`](../../crates/dark-null-transcript/tests/prover_malicious.rs) (ported from prior internal
research, Aug 2026) and the reference circuit:

| ID | Input | Rejected by |
|---|---|---|
| S1 | Poseidon with LE inputs or an elided trailing input | `pi` mismatch |
| S2 | `pi` without `DS_PI` | `pi` mismatch |
| S3 | `ext_data_hash` over extra bytes or without `TAG_EXTDATA` | `pi` mismatch |
| S4 | root hint at another slot; zero root at an empty slot | `E_UNKNOWN_ROOT` |
| S5 | a transact of pool A at pool B; `pool_id` rewritten | `E_WRONG_POOL`; `pi` mismatch |
| S6 | `claimed_epoch` outside the window; moved into it | `E_EPOCH_WINDOW`; `pi` mismatch |
| S7 | `nf + r` | `E_NONCANONICAL_FIELD` |
| S8 | nullifier record at a non-canonical bump | `E_NULLIFIER_ACCOUNT` |
| S9 | the same transact twice | `E_NULLIFIER_SPENT` |
| S10 | LE reading of BE bytes; hash reduced mod `r` | different elements (pinned) |
| S11 | any one-byte change in any `ext_data` field | `E_BAD_EXT_DATA`, `E_WRONG_POOL` or `pi` mismatch |
| S12 | both public legs | `E_BAD_PUBLIC_AMOUNT` |
| S13 | outputs or nullifiers swapped | `pi` mismatch |
| W1-W13 | tampered witnesses for C1-C7 (labels, signature, conservation, asset, membership, leaf index, second `nk`, off-curve `ak`, range) | circuit |

### 13.3 Cross-check results (2026-10-06)

- Rust crate: 28 tests pass (8 vector, 14 prover-malicious, 6 encoding)
  [`crate_tests_dark_null_transcript.txt`](../../bench/results/p0/2026-10-06/crate_tests_dark_null_transcript.txt).
- Circuit: 3/3 valid witnesses match `pi`; 13/13 tampered witnesses rejected
  [`witness_check_v2_spec.json`](../../bench/results/p0/2026-10-06/witness_check_v2_spec.json).
- Devnet: 170/170 generator Poseidon calls, 3/3 TRANSACT_CHECK, 1 TREE_CHECK (3 insertions), 6/6 canonical
  nullifier PDAs, and 5/5 negative simulations rejected with the expected codes
  [`devnet_probe_v2.json`](../../bench/results/p0/2026-10-06/devnet_probe_v2.json).

## 14. Changes relative to DESIGN_2027 (this spec governs)

| # | Item | DESIGN | This spec | Why |
|---|---|---|---|---|
| 1 | Channel owner | `..., expiry_epoch, chan_nonce` | `..., expiry_epoch, nk_ch` | F-NK-CH: invariant I-NK (5.2) |
| 2 | Nullifier record bump | client-supplied in the Phase 0 spike | canonical, derived on chain | F-BUMP: double spend through a second PDA (8.6) |
| 3 | Pre-funded record address | not covered | top up + allocate + assign | F-PREFUND: denial of service on a pending spend (8.6) |
| 4 | `root_hint` | inside `ext_data` | instruction field | lets a relayer fix a hint; the root is bound by `pi` |
| 5 | `ext_data` fields | `recipient, relayer, relayer_fee, ciphertext0/1/rec, memo_binding, root_hint` | adds `version`, `pool_id`, `stealth_ephemeral`; fixed 649-byte layout | pool binding (S5), stealth withdraws (9.4) |
| 6 | Labels | Phase 4 | enforced from Phase 1 | every note keeps a pure deposit label |
| 7 | Quote tag | `dnull-x402-quote-v1`, unprefixed fields | `dark-null-x402-quote-v1`, length-prefixed fields | unambiguous encoding |
| 8 | Phase 1 circuit | every branch compiled in, disabled by program config | principal branch only; later branches under a new key | no public selector (7.7) |
| 9 | Note ciphertext | `epk \|\| AEAD(opening \|\| memo) \|\| view_tag` | 5.7 (salt derived from the shared secret) | fits 160 bytes with asset and label |
| 10 | Diversified addresses | unlinkable per-merchant addresses | linkable (shared `pk`); use account indices for unlinkable addresses | the fixed owner formula has no diversifier (4.3) |
| 11 | Exact-mode refund address | in the payment memo | in the x402 payment header | 32-byte memo holds the quote binding (11.1) |
