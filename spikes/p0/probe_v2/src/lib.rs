//! Dark NULL v2 Phase 0 probe program (devnet only; closed after the run).
//!
//! No framework: a raw entrypoint for instructions without accounts. Every hash is computed by
//! `dark-null-transcript` with its `solana` backends, so this checks the crate itself on chain.
//!
//! Tags (first data byte):
//!   0x01 POSEIDON_CHECK  repeated [n u8][n x 32 BE inputs][32 BE expected]
//!   0x02 TRANSACT_CHECK  [transact ix 1131][pool_id 32][asset 32][deposit_counter u64 LE][pi 32][ext_data_hash 32]
//!   0x03 TREE_CHECK      [k u8] then k x [cm0 32][cm1 32][expected root 32], inserted from the empty tree
//!   0x04 NF_PDA_CHECK    [program_id 32][pool_config 32] then repeated [nf 32][expected address 32][expected bump u8]
//! Errors: Custom(0x100 + step) on the first mismatch. Logs: sol_log_64(tag, index, ok, cu_before, cu_after) style checkpoints.
#![no_std]
#![allow(clippy::missing_safety_doc)]

use dark_null_transcript::extdata::{ext_data_hash, ExtData};
use dark_null_transcript::fr::Fr32;
use dark_null_transcript::hash::{PoseidonHasher, SolPoseidon, SolSha256};
use dark_null_transcript::ix::{TransactIx, LEN as IX_LEN};
use dark_null_transcript::{pool, preimage, tree};

#[cfg(target_os = "solana")]
extern "C" {
    fn sol_log_64_(a: u64, b: u64, c: u64, d: u64, e: u64);
    fn sol_log_compute_units_();
    fn sol_try_find_program_address(seeds: *const u8, seeds_len: u64, program_id: *const u8, address: *mut u8, bump: *mut u8) -> u64;
}

fn log5(a: u64, b: u64, c: u64, d: u64, e: u64) {
    #[cfg(target_os = "solana")]
    unsafe {
        sol_log_64_(a, b, c, d, e)
    }
    #[cfg(not(target_os = "solana"))]
    let _ = (a, b, c, d, e);
}

fn cu_mark() {
    #[cfg(target_os = "solana")]
    unsafe {
        sol_log_compute_units_()
    }
}

fn find_pda(seeds: &[&[u8]], program: &[u8; 32]) -> Option<([u8; 32], u8)> {
    #[cfg(target_os = "solana")]
    {
        let mut addr = [0u8; 32];
        let mut bump = 0u8;
        let rc = unsafe { sol_try_find_program_address(seeds.as_ptr() as *const u8, seeds.len() as u64, program.as_ptr(), addr.as_mut_ptr(), &mut bump) };
        if rc == 0 {
            return Some((addr, bump));
        }
        None
    }
    #[cfg(not(target_os = "solana"))]
    {
        let _ = (seeds, program);
        None
    }
}

/// `ProgramError::Custom(n)` for n != 0 is returned to the runtime as the plain value n.
fn custom(n: u32) -> u64 {
    n as u64
}

fn fr_at(d: &[u8], off: usize) -> Fr32 {
    let mut o = [0u8; 32];
    o.copy_from_slice(&d[off..off + 32]);
    o
}

#[inline(never)]
fn poseidon_check(mut d: &[u8]) -> u64 {
    let mut i = 0u32;
    let mut inputs = [[0u8; 32]; 12];
    while !d.is_empty() {
        let n = d[0] as usize;
        if n == 0 || n > 12 || d.len() < 1 + 32 * n + 32 {
            return custom(0x1ff);
        }
        for k in 0..n {
            inputs[k] = fr_at(d, 1 + 32 * k);
        }
        let expected = fr_at(d, 1 + 32 * n);
        match SolPoseidon.poseidon(&inputs[..n]) {
            Ok(h) if h == expected => {}
            _ => {
                log5(1, i as u64, n as u64, 0, 0);
                return custom(0x100 + i);
            }
        }
        d = &d[1 + 32 * n + 32..];
        i += 1;
    }
    log5(1, i as u64, 1, 0, 0);
    0
}

#[inline(never)]
fn transact_check(d: &[u8]) -> u64 {
    if d.len() != IX_LEN + 32 + 32 + 8 + 32 + 32 {
        return custom(0x2ff);
    }
    cu_mark();
    let ix = match TransactIx::decode(&d[..IX_LEN]) {
        Ok(x) => x,
        Err(_) => return custom(0x201),
    };
    let ext = match ExtData::decode(&ix.ext_data) {
        Ok(x) => x,
        Err(_) => return custom(0x202),
    };
    let pool_id = fr_at(d, IX_LEN);
    if ext.pool_id != pool_id {
        return custom(0x203);
    }
    cu_mark();
    let edh = match ext_data_hash(&SolSha256, &ix.ext_data) {
        Ok(x) => x,
        Err(_) => return custom(0x204),
    };
    cu_mark();
    if edh != fr_at(d, IX_LEN + 32 + 32 + 8 + 32) {
        return custom(0x205);
    }
    let asset = fr_at(d, IX_LEN + 32);
    let mut ctr = [0u8; 8];
    ctr.copy_from_slice(&d[IX_LEN + 64..IX_LEN + 72]);
    let dl = if ix.deposit_amount > 0 {
        match preimage::deposit_label(&SolPoseidon, &pool::pool_id_fr(&pool_id), u64::from_le_bytes(ctr)) {
            Ok(x) => x,
            Err(_) => return custom(0x206),
        }
    } else {
        dark_null_transcript::fr::ZERO
    };
    let pi = match ix.statement(&asset, &edh, &dl).and_then(|s| s.pi(&SolPoseidon)) {
        Ok(x) => x,
        Err(_) => return custom(0x207),
    };
    cu_mark();
    if pi != fr_at(d, IX_LEN + 72) {
        return custom(0x208);
    }
    log5(2, ix.deposit_amount, ix.withdraw_amount, 1, 0);
    0
}

#[inline(never)]
fn tree_check(d: &[u8]) -> u64 {
    if d.is_empty() || d.len() != 1 + 96 * d[0] as usize {
        return custom(0x3ff);
    }
    let mut filled = [[0u8; 32]; tree::DEPTH];
    let mut next = 0u64;
    for k in 0..d[0] as usize {
        let off = 1 + 96 * k;
        cu_mark();
        let root = match tree::insert_pair(&SolPoseidon, &mut filled, next, &fr_at(d, off), &fr_at(d, off + 32)) {
            Ok(r) => r,
            Err(_) => return custom(0x300 + k as u32),
        };
        cu_mark();
        if root != fr_at(d, off + 64) {
            log5(3, k as u64, 0, 0, 0);
            return custom(0x310 + k as u32);
        }
        next += 2;
    }
    log5(3, d[0] as u64, 1, next, 0);
    0
}

#[inline(never)]
fn nf_pda_check(d: &[u8]) -> u64 {
    if d.len() < 64 || (d.len() - 64) % 65 != 0 {
        return custom(0x4ff);
    }
    let program = fr_at(d, 0);
    let config = fr_at(d, 32);
    let mut rest = &d[64..];
    let mut i = 0u32;
    while !rest.is_empty() {
        let nf = fr_at(rest, 0);
        cu_mark();
        let got = find_pda(&[pool::SEED_NF, &config, &nf], &program);
        cu_mark();
        match got {
            Some((a, b)) if a[..] == rest[32..64] && b == rest[64] => log5(4, i as u64, b as u64, 1, 0),
            _ => return custom(0x400 + i),
        }
        rest = &rest[65..];
        i += 1;
    }
    0
}

/// Raw entrypoint. Input layout with zero accounts: u64 num_accounts (= 0), u64 data_len, data, program_id.
#[no_mangle]
pub unsafe extern "C" fn entrypoint(input: *mut u8) -> u64 {
    let num_accounts = core::ptr::read_unaligned(input as *const u64);
    if num_accounts != 0 {
        return custom(0xfff);
    }
    let len = core::ptr::read_unaligned(input.add(8) as *const u64) as usize;
    let data = core::slice::from_raw_parts(input.add(16), len);
    match data.first() {
        Some(0x01) => poseidon_check(&data[1..]),
        Some(0x02) => transact_check(&data[1..]),
        Some(0x03) => tree_check(&data[1..]),
        Some(0x04) => nf_pda_check(&data[1..]),
        _ => custom(0xffe),
    }
}

#[cfg(target_os = "solana")]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    loop {}
}
