//! Groth16 verification of a `transact_v2` proof (V2_SPEC 8.8) with the frozen I1 key in [`crate::vk`].
//!
//! The path is the one measured on devnet by the WP-CIRCUIT probe: reject `pi >= r`, then
//! `Groth16Verifier::new(a_neg, b, c, &[pi], &VERIFYING_KEY)?.verify_unchecked()`. `verify_unchecked` does not
//! range-check public inputs; the canonical check above is what makes that safe (V2_SPEC 2.1).

use crate::error::PoolError;
use crate::vk;
use dark_null_transcript::fr::{is_canonical, Fr32};
use groth16_solana::groth16::Groth16Verifier;

/// Verify `proof = A_neg (64) || B (128) || C (64)` against the single public input `pi`.
pub fn verify_proof(proof_a_neg: &[u8; 64], proof_b: &[u8; 128], proof_c: &[u8; 64], pi: &Fr32) -> Result<(), PoolError> {
    if !is_canonical(pi) {
        return Err(PoolError::NonCanonicalField);
    }
    let inputs: [[u8; 32]; vk::NR_PUBLIC_INPUTS] = [*pi];
    let mut v = Groth16Verifier::new(proof_a_neg, proof_b, proof_c, &inputs, &vk::VERIFYING_KEY).map_err(|_| PoolError::ProofInvalid)?;
    v.verify_unchecked().map_err(|_| PoolError::ProofInvalid)
}
