//! Thin syscall wrappers. Host builds (unit tests) get panicking fallbacks.

#[cfg(target_os = "solana")]
use pinocchio::syscalls;

/// CU checkpoint. `sol_remaining_compute_units` is not active on devnet (gate
/// 5TuppMutoyzhUSfuYdhgzD47F92GL1g89KpCZQKqedxP inactive, checked 2026-10-06), so each checkpoint
/// logs "Program consumption: N units remaining" via sol_log_compute_units_ and the client computes
/// deltas between consecutive checkpoints. Returns 0.
#[inline(always)]
pub fn cu() -> u64 {
    #[cfg(target_os = "solana")]
    unsafe {
        syscalls::sol_log_compute_units_()
    }
    0
}

pub fn log5(a: u64, b: u64, c: u64, d: u64, e: u64) {
    #[cfg(target_os = "solana")]
    unsafe {
        syscalls::sol_log_64_(a, b, c, d, e)
    }
    #[cfg(not(target_os = "solana"))]
    let _ = (a, b, c, d, e);
}

pub fn keccak(parts: &[&[u8]]) -> [u8; 32] {
    let mut out = [0u8; 32];
    #[cfg(target_os = "solana")]
    unsafe {
        syscalls::sol_keccak256(parts as *const _ as *const u8, parts.len() as u64, out.as_mut_ptr());
    }
    #[cfg(not(target_os = "solana"))]
    {
        use sha3::Digest;
        let mut h = sha3::Keccak256::new();
        for p in parts {
            h.update(p);
        }
        out.copy_from_slice(&h.finalize());
    }
    out
}

/// sol_poseidon, Bn254X5 parameters (0), big-endian (0). Returns None on syscall error.
pub fn poseidon(parts: &[&[u8]]) -> Option<[u8; 32]> {
    #[cfg(target_os = "solana")]
    {
        let mut out = [0u8; 32];
        let r = unsafe { syscalls::sol_poseidon(0, 0, parts as *const _ as *const u8, parts.len() as u64, out.as_mut_ptr()) };
        if r != 0 {
            return None;
        }
        Some(out)
    }
    #[cfg(not(target_os = "solana"))]
    {
        let _ = parts;
        unimplemented!()
    }
}

const ADD: u64 = 0;
const MUL: u64 = 2;
const PAIRING: u64 = 3;

fn bn(op: u64, input: &[u8], out: &mut [u8]) -> bool {
    #[cfg(target_os = "solana")]
    unsafe {
        syscalls::sol_alt_bn128_group_op(op, input.as_ptr(), input.len() as u64, out.as_mut_ptr()) == 0
    }
    #[cfg(not(target_os = "solana"))]
    {
        use solana_bn254::prelude::*;
        let r = match op {
            ADD => alt_bn128_addition(input),
            MUL => alt_bn128_multiplication(input),
            _ => alt_bn128_pairing(input),
        };
        match r {
            Ok(v) => {
                out[..v.len()].copy_from_slice(&v);
                true
            }
            Err(_) => false,
        }
    }
}

pub fn g1_add(a: &[u8; 64], b: &[u8; 64]) -> Option<[u8; 64]> {
    let mut i = [0u8; 128];
    i[..64].copy_from_slice(a);
    i[64..].copy_from_slice(b);
    let mut o = [0u8; 64];
    if bn(ADD, &i, &mut o) { Some(o) } else { None }
}

pub fn g1_mul(p: &[u8; 64], s: &[u8; 32]) -> Option<[u8; 64]> {
    let mut i = [0u8; 96];
    i[..64].copy_from_slice(p);
    i[64..].copy_from_slice(s);
    let mut o = [0u8; 64];
    if bn(MUL, &i, &mut o) { Some(o) } else { None }
}

pub fn pairing(input: &[u8]) -> Option<bool> {
    let mut o = [0u8; 32];
    if bn(PAIRING, input, &mut o) { Some(o[31] == 1) } else { None }
}
