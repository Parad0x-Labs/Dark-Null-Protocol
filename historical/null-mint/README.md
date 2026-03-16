# Recovered Null-Mint / Paradox Devnet Branch

This directory is a curated recovery of a historical `null-mint` / `paradox` devnet branch found in `Parad0x_Null.zip` on March 15, 2026.

The current root was promoted from this branch. If you want the active integration target, start at [`../../MANIFEST.json`](../../MANIFEST.json) instead of here.

It is here because it contains real source for a historical Groth16-on-Solana path that was missing from the cleaned root prototype:

- [`programs/paradox/src/lib.rs`](./programs/paradox/src/lib.rs) contains a real `Groth16Verifier::verify()` call
- [`circuits/null_proof.circom`](./circuits/null_proof.circom) plus the matching `.r1cs`, `.wasm`, `.zkey`, and `vk` artifacts are included
- [`idl/paradox.json`](./idl/paradox.json) and [`types/paradox.ts`](./types/paradox.ts) preserve the historical interface snapshot
- [`vk-gen`](./vk-gen) and [`tools/parse_vk_to_rust.cjs`](./tools/parse_vk_to_rust.cjs) preserve the verification-key conversion helpers
- [`MANIFEST.json`](./MANIFEST.json) binds the recovered program ID, Groth16 metadata, and artifact hashes into one reviewable snapshot

## Historical IDs

- `paradox`: `2stas3cZYnBiWpndcTXQDGLXwfQ7kjEYYrW52DsUAcxF`
- `whisper`: `4AQpjBrwsT7Dqm9iupMVBjm4gHKSnKVs13quzxmVAesr`
- `ghost_mint`: `AedRaM2Pimj9EkWqNx7QMkGXTGLXMbtz1Z96aMkGGmhe`
- Abyss PDA from the recovered notes: `4EQfWjVCDq7jG3Db8sygSxtpm4hzz3A2D2L3MRiVxvrS`
- pSOL mint from the recovered notes: `GkTuE7qYUY9yTaj8gPssDBnTN5wvKBqeya6xjriTcSBy`

## What Was Intentionally Excluded

- `wallet-b.json`
- `temp-wallet-a.json`
- `temp-wallet-b.json`
- `target/deploy/*keypair.json`
- `node_modules/`
- `target/` build output except for the selected IDL and TypeScript type snapshot
- loose demo and marketing scripts that embedded local paths, private wallet files, or mocked proof flows

## Reality Check

- This is historical provenance now, not the primary root integration path.
- Some sibling scripts in the original archive were obviously dirty or mocked; they were not imported.
- The useful part here is the program source, circuit artifacts, IDL/types, and verifier tooling.
- The root crate has since been hardened beyond this recovered branch. Do not assume the historical subtree still defines the active security posture.

## Fast Review Path

1. Compare the program ID across [`Anchor.toml`](./Anchor.toml), [`programs/paradox/src/lib.rs`](./programs/paradox/src/lib.rs), and [`idl/paradox.json`](./idl/paradox.json).
2. Compare `nr_pubinputs` in [`programs/paradox/src/lib.rs`](./programs/paradox/src/lib.rs) against [`verification_key_latest.json`](./verification_key_latest.json).
3. Inspect [`MANIFEST.json`](./MANIFEST.json) to verify the artifact hashes and the recovered program binding.
4. Inspect [`programs/paradox/src/lib.rs`](./programs/paradox/src/lib.rs) starting at `prepare_phantom_withdraw` for the actual Groth16 verification path.
