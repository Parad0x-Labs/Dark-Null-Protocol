//! Hash backends (V2_SPEC 2.3). This module is the only place where the host build and the cluster build differ
//! in hashing:
//!
//! | Build | Poseidon | SHA-256 |
//! |---|---|---|
//! | `target_os = "solana"` | `SolPoseidon` (`sol_poseidon`, Bn254X5, big-endian) | `SolSha256` (`sol_sha256`) |
//! | host (native tests) | `LightPoseidon` (light-poseidon 0.2, circom parameters) | `SolSha256` host fallback (`sha2`) |
//!
//! Both Poseidon backends implement the same parameter set; `vectors/v2/V-POS.json` pins it and the crate tests
//! and the Phase 0 devnet probe check both against it.

#[cfg(target_os = "solana")]
pub use dark_null_transcript::hash::SolPoseidon as Poseidon;

#[cfg(not(target_os = "solana"))]
pub use dark_null_transcript::hash::LightPoseidon as Poseidon;

pub use dark_null_transcript::hash::SolSha256 as Sha256;

/// The Poseidon backend instance.
pub const POSEIDON: Poseidon = Poseidon;
/// The SHA-256 backend instance.
pub const SHA256: Sha256 = Sha256;
