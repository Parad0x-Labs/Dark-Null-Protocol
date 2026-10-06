//! # dark-null-pool-v2
//!
//! The Dark NULL v2 shielded pool program, Phase 1 (devnet): normative source `docs/spec/V2_SPEC.md` section 8.
//!
//! - Five instructions: `initialize_pool`, `register_mint`, `transact`, `set_beta_limits`, `set_paused` (8.3).
//! - `transact` takes the 13 accounts of 8.4 and runs the 14 steps of 8.5 in order.
//! - Nullifiers are option-A records at the canonical PDA, derived on chain (F-BUMP), with the pre-funded address
//!   handled by top-up, allocate and assign (F-PREFUND), 8.6.
//! - Solvency guard and Token-2022 mint allowlist, 8.7. Groth16 with the frozen `dev-setup` key, 8.8.
//! - Error codes 6000-6023, 8.9. One `sol_log_data` event per transact and no other program logs, 8.10.
//!
//! Every encoding, preimage, `ext_data_hash`, `pi` and the tree insertion come from `dark-null-transcript`
//! (interface I2); this crate does not re-implement them.
//!
//! Build split (the only code that differs between the host build and the cluster build): the Poseidon backend
//! ([`hash::Poseidon`]) is `sol_poseidon` on `target_os = "solana"` and light-poseidon on the host; SHA-256 is
//! `sol_sha256` on chain and the `sha2` crate on the host; groth16-solana runs the `alt_bn128` syscalls on chain
//! and its arkworks implementation on the host.
#![deny(unsafe_code)]

pub mod error;
pub mod event;
pub mod hash;
pub mod instructions;
pub mod pda;
pub mod processor;
pub mod state;
pub mod token;
pub mod verify;
pub mod vk;

pub use error::PoolError;

solana_program::declare_id!("3WZenuUJ1dN7iWUathmmXExPYu5zh9KX9xFoWJCGy4Zi");

#[cfg(not(feature = "no-entrypoint"))]
#[allow(unsafe_code)]
mod entrypoint {
    use super::process_instruction;
    solana_program::entrypoint!(process_instruction);
}

pub use processor::process_instruction;
