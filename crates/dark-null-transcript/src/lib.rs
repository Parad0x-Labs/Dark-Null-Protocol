//! # dark-null-transcript
//!
//! The canonical transcript and encoding rules of Dark NULL v2 (`docs/spec/V2_SPEC.md`): domain tags,
//! BN254 field encodings, every Poseidon preimage (asset, owner key, note, nullifier, `sighash`,
//! `pi`, labels, vouchers), the `ext_data` record and its hash, the `transact` instruction layout,
//! the depth-32 tree insertion algorithm, key derivation byte rules, the x402 quote binding, the
//! pool id, and the bech32m shielded address.
//!
//! One crate for client, prover, relayer and program: it is `no_std`, allocation-free, and takes
//! the hash backend as a parameter, so the same code runs on the host (light-poseidon) and on
//! chain (`sol_poseidon`, `sol_sha256`). Ported from the canonical-transcript work of prior
//! internal research (Aug 2026) and moved to the `sol_poseidon` parameter set.
#![cfg_attr(not(feature = "std"), no_std)]
#![deny(unsafe_code)]

pub mod address;
pub mod ds;
pub mod error;
pub mod extdata;
pub mod fr;
pub mod hash;
pub mod ix;
pub mod kdf;
pub mod pool;
pub mod preimage;
pub mod quote;
pub mod tree;

pub use error::Error;
pub use fr::Fr32;
