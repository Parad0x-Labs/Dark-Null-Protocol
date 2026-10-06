//! Throwaway devnet probe for WP-CIRCUIT (devnet only; closed after the run).
//! Verifies transact_v2 Groth16 proofs against the generated program verifying key with groth16-solana 0.2.0
//! (the version of the Phase 0 spike), so the vk.rs encoding, the proof encoding and the CU cost are checked on chain.
//!
//! Tags (first instruction byte):
//!   0x01 VERIFY     data: proof(256, A negated) || pi(32, big-endian); logs (1, verify CU between marks, 0, 0, 0)
//!   0x02 VK_HASH    recomputes SHA256(VK_BYTES) with sol_sha256; fails unless it equals VK_HASH
//!   0x03 CALIBRATE  two back-to-back CU marks (the client subtracts the mark cost)
use pinocchio::{account_info::AccountInfo, program_error::ProgramError, pubkey::Pubkey, ProgramResult};

#[path = "../../../../programs/dark-null-pool-v2/src/vk.rs"]
mod vk;

#[cfg(target_os = "solana")]
pinocchio::entrypoint!(process_instruction);

/// BN254 scalar field order r, big-endian.
const R_BE: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

#[inline(always)]
fn mark() {
    #[cfg(target_os = "solana")]
    unsafe {
        pinocchio::syscalls::sol_log_compute_units_()
    }
}

fn log5(a: u64, b: u64, c: u64, d: u64, e: u64) {
    #[cfg(target_os = "solana")]
    unsafe {
        pinocchio::syscalls::sol_log_64_(a, b, c, d, e)
    }
    #[cfg(not(target_os = "solana"))]
    let _ = (a, b, c, d, e);
}

fn err(code: u32) -> ProgramError {
    ProgramError::Custom(code)
}

pub fn process_instruction(_program_id: &Pubkey, _accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let (tag, d) = data.split_first().ok_or(ProgramError::InvalidInstructionData)?;
    match *tag {
        0x01 => verify(d),
        0x02 => vk_hash(),
        0x03 => {
            mark();
            mark();
            Ok(())
        }
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn verify(d: &[u8]) -> ProgramResult {
    if d.len() != 256 + 32 {
        return Err(ProgramError::InvalidInstructionData);
    }
    mark();
    let a: &[u8; 64] = d[0..64].try_into().unwrap();
    let b: &[u8; 128] = d[64..192].try_into().unwrap();
    let c: &[u8; 64] = d[192..256].try_into().unwrap();
    let inputs: [[u8; 32]; vk::NR_PUBLIC_INPUTS] = [d[256..288].try_into().unwrap()];
    // canonical public input (V2_SPEC 2.1): pi < r, compared as big-endian bytes
    if inputs[0] >= R_BE {
        return Err(err(0x302));
    }
    let mut v = groth16_solana::groth16::Groth16Verifier::new(a, b, c, &inputs, &vk::VERIFYING_KEY).map_err(|_| err(0x300))?;
    v.verify_unchecked().map_err(|_| err(0x301))?;
    mark();
    log5(1, 0, 0, 0, 0);
    Ok(())
}

fn vk_hash() -> ProgramResult {
    #[cfg(target_os = "solana")]
    {
        let parts: [&[u8]; 1] = [&vk::VK_BYTES];
        let mut out = [0u8; 32];
        unsafe {
            pinocchio::syscalls::sol_sha256(parts.as_ptr() as *const u8, 1, out.as_mut_ptr());
        }
        if out != vk::VK_HASH {
            return Err(err(0x310));
        }
        log5(2, 1, 0, 0, 0);
    }
    Ok(())
}
