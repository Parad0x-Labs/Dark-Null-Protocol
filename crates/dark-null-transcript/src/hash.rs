//! Hash backends (V2_SPEC section 2.3).
//!
//! Poseidon is BN254, x^5, circom/light-poseidon round constants, width n+1 for n = 1..12 inputs,
//! big-endian. That parameter set is exactly `sol_poseidon(Bn254X5, BigEndian)`. The crate never
//! implements the permutation itself; it pins the inputs, and a backend computes:
//! - [`LightPoseidon`] (feature `light`): host, light-poseidon 0.2;
//! - [`SolPoseidon`] (feature `solana`, `target_os = "solana"`): the syscall.

use crate::error::Error;
use crate::fr::{is_canonical, Fr32};
use sha2::{Digest, Sha256, Sha512};

/// Poseidon over 1..=12 canonical field elements.
pub trait PoseidonHasher {
    /// Hash `inputs` (1..=12 canonical elements) to one canonical element.
    fn poseidon(&self, inputs: &[Fr32]) -> Result<Fr32, Error>;
}

/// SHA-256 over a list of byte strings (concatenated).
pub trait Sha256Hasher {
    fn sha256(&self, parts: &[&[u8]]) -> [u8; 32];
}

/// Software SHA-256 (sha2 crate; no_std).
#[derive(Clone, Copy, Debug, Default)]
pub struct SoftSha256;

impl Sha256Hasher for SoftSha256 {
    fn sha256(&self, parts: &[&[u8]]) -> [u8; 32] {
        sha256(parts)
    }
}

/// SHA-256 of the concatenation of `parts`.
pub fn sha256(parts: &[&[u8]]) -> [u8; 32] {
    let mut h = Sha256::new();
    for p in parts {
        h.update(p);
    }
    h.finalize().into()
}

/// SHA-512 of the concatenation of `parts`.
pub fn sha512(parts: &[&[u8]]) -> [u8; 64] {
    let mut h = Sha512::new();
    for p in parts {
        h.update(p);
    }
    h.finalize().into()
}

/// Shared input validation for every backend: arity 1..=12, every input canonical.
pub fn check_inputs(inputs: &[Fr32]) -> Result<(), Error> {
    if inputs.is_empty() || inputs.len() > 12 {
        return Err(Error::PoseidonArity);
    }
    if inputs.iter().any(|x| !is_canonical(x)) {
        return Err(Error::NonCanonicalField);
    }
    Ok(())
}

#[cfg(feature = "light")]
mod light {
    use super::*;
    use ark_bn254::Fr;
    use light_poseidon::{Poseidon, PoseidonBytesHasher};

    /// Host Poseidon backend (light-poseidon 0.2, circom parameters).
    #[derive(Clone, Copy, Debug, Default)]
    pub struct LightPoseidon;

    impl PoseidonHasher for LightPoseidon {
        fn poseidon(&self, inputs: &[Fr32]) -> Result<Fr32, Error> {
            check_inputs(inputs)?;
            let mut h = Poseidon::<Fr>::new_circom(inputs.len()).map_err(|_| Error::PoseidonBackend)?;
            let mut refs: [&[u8]; 12] = [&[]; 12];
            for (i, x) in inputs.iter().enumerate() {
                refs[i] = &x[..];
            }
            h.hash_bytes_be(&refs[..inputs.len()]).map_err(|_| Error::PoseidonBackend)
        }
    }
}
#[cfg(feature = "light")]
pub use light::LightPoseidon;

#[cfg(feature = "solana")]
mod sol {
    use super::*;

    #[cfg(target_os = "solana")]
    extern "C" {
        fn sol_poseidon(parameters: u64, endianness: u64, vals: *const u8, val_len: u64, hash_result: *mut u8) -> u64;
        fn sol_sha256(vals: *const u8, val_len: u64, hash_result: *mut u8) -> u64;
    }

    /// On-chain Poseidon: `sol_poseidon(parameters = 0 (Bn254X5), endianness = 0 (big-endian))`.
    #[derive(Clone, Copy, Debug, Default)]
    pub struct SolPoseidon;

    impl PoseidonHasher for SolPoseidon {
        #[allow(unused_variables)]
        fn poseidon(&self, inputs: &[Fr32]) -> Result<Fr32, Error> {
            check_inputs(inputs)?;
            #[cfg(target_os = "solana")]
            {
                let mut refs: [&[u8]; 12] = [&[]; 12];
                for (i, x) in inputs.iter().enumerate() {
                    refs[i] = &x[..];
                }
                let mut out = [0u8; 32];
                // SAFETY: `refs[..n]` is a valid slice of byte slices for the duration of the call
                // and `out` is a writable 32-byte buffer, as the syscall ABI requires.
                #[allow(unsafe_code)]
                let rc = unsafe { sol_poseidon(0, 0, refs.as_ptr() as *const u8, inputs.len() as u64, out.as_mut_ptr()) };
                if rc != 0 {
                    return Err(Error::PoseidonBackend);
                }
                Ok(out)
            }
            #[cfg(not(target_os = "solana"))]
            {
                Err(Error::PoseidonBackend)
            }
        }
    }

    /// On-chain SHA-256 through `sol_sha256` (host builds fall back to the software hash).
    #[derive(Clone, Copy, Debug, Default)]
    pub struct SolSha256;

    impl Sha256Hasher for SolSha256 {
        fn sha256(&self, parts: &[&[u8]]) -> [u8; 32] {
            #[cfg(target_os = "solana")]
            {
                let mut out = [0u8; 32];
                // SAFETY: `parts` is a valid slice of byte slices; `out` is a writable 32-byte buffer.
                #[allow(unsafe_code)]
                unsafe {
                    sol_sha256(parts.as_ptr() as *const u8, parts.len() as u64, out.as_mut_ptr());
                }
                out
            }
            #[cfg(not(target_os = "solana"))]
            {
                sha256(parts)
            }
        }
    }
}
#[cfg(feature = "solana")]
pub use sol::{SolPoseidon, SolSha256};
