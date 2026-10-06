//! Dark NULL v2 Phase 0 spike program (devnet only; closed after measurement).
//!
//! Tags (first instruction byte):
//!   0x01 POSEIDON_CHECK  data: repeated [n u8][n x 32 BE inputs][32 BE expected]; logs (1, n, cu, ok, 0)
//!   0x02 NOOP            any payload; logs (2, len, 0, 0, 0)            (S-TXV1 payload probe)
//!   0x03 CU_CALIBRATE    logs (3, delta of two back-to-back cu() reads)
//!   0x10 NF_A_INSERT     accts [payer s w, nf_pda w, system]; data nf(32) bump(1)
//!   0x11 NF_A_CHECK      accts [nf_pda]; data nf(32) bump(1); logs spent flag
//!   0x12 CLOSE           accts [target w, authority s w]   (spike rent recovery; authority = test payer)
//!   0x20 NF_B_INSERT     accts [page w]; data k x nf(32)
//!   0x21 NF_B_CHECK      accts [page]; data nf(32)
//!   0x30/0x31/0x32 G16_VERIFY (groth16-solana) skeleton / pi_hash / fullsize vk; data a_neg(64) b(128) c(64) pub(32)
//!   0x40 PLONK_VERIFY    data pub(32) proof(768) inv_hint(32)
//!   0x41 PLONK_VERIFY    data pub(32) proof(768)  (on-chain inversion)
//!   0x42 PLONK_VERIFY    transact_v2_skeleton vk (2^18 domain); data pub(32) proof(768) inv_hint(32)
//!   0x50 FFLONK_VERIFY   pi_hash vk; data pub(32) proof(768)

#[cfg(feature = "fflonk")]
pub mod fflonk;
pub mod fr;
#[cfg(any(feature = "verify", feature = "fflonk"))]
pub mod plonk;
pub mod sys;
#[cfg(any(feature = "verify", feature = "fflonk"))]
mod vk;

use pinocchio::{
    account_info::AccountInfo,
    instruction::{Seed, Signer},
    program_error::ProgramError,
    pubkey::{create_program_address, Pubkey},
    sysvars::{rent::Rent, Sysvar},
    ProgramResult,
};

#[cfg(target_os = "solana")]
pinocchio::entrypoint!(process_instruction);

/// Spike pool id used in nullifier PDA seeds ["nf", POOL, nf, bump].
pub const POOL: [u8; 32] = *b"dark-null-p0-spike-pool-00000001";
/// Only the devnet test payer may close spike accounts (rent recovery).
/// GTs3YgDY4Aqi67wW4zr5xZdJCwBVHiwTrRdgWpFPjXD3
pub const AUTHORITY: Pubkey = [
    0xe5, 0xc0, 0xfd, 0x60, 0x23, 0x52, 0x8c, 0x05, 0x51, 0xc2, 0x1f, 0x00, 0xd6, 0x3a, 0x8e, 0x74,
    0x16, 0x4e, 0x24, 0x91, 0x4a, 0x08, 0x0c, 0x60, 0x98, 0x34, 0x62, 0x51, 0x8d, 0x5c, 0x12, 0xe2,
];

const PAGE_HEADER: usize = 16;

fn err(code: u32) -> ProgramError {
    ProgramError::Custom(code)
}

pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let (tag, rest) = data.split_first().ok_or(ProgramError::InvalidInstructionData)?;
    match *tag {
        #[cfg(feature = "store")]
        0x01 => poseidon_check(rest),
        0x02 => {
            sys::log5(2, data.len() as u64, 0, 0, 0);
            Ok(())
        }
        0x03 => {
            let a = sys::cu();
            let b = sys::cu();
            sys::log5(3, a - b, 0, 0, 0);
            Ok(())
        }
        #[cfg(feature = "store")]
        0x10 => nf_a_insert(program_id, accounts, rest),
        #[cfg(feature = "store")]
        0x11 => nf_a_check(program_id, accounts, rest),
        #[cfg(feature = "store")]
        0x12 => close(program_id, accounts),
        #[cfg(feature = "store")]
        0x20 => nf_b_insert(program_id, accounts, rest),
        #[cfg(feature = "store")]
        0x21 => nf_b_check(program_id, accounts, rest),
        #[cfg(feature = "verify")]
        0x30 | 0x31 | 0x32 => g16_verify(*tag, rest),
        #[cfg(feature = "verify")]
        0x40 | 0x41 | 0x42 => plonk_verify(*tag, rest),
        #[cfg(feature = "fflonk")]
        0x50 => fflonk_verify(rest),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

#[cfg(feature = "store")]
fn poseidon_check(mut d: &[u8]) -> ProgramResult {
    while !d.is_empty() {
        let n = d[0] as usize;
        if n == 0 || n > 12 || d.len() < 1 + 32 * n + 32 {
            return Err(ProgramError::InvalidInstructionData);
        }
        let mut parts: [&[u8]; 12] = [&[]; 12];
        for i in 0..n {
            parts[i] = &d[1 + 32 * i..1 + 32 * (i + 1)];
        }
        let expected = &d[1 + 32 * n..1 + 32 * n + 32];
        let c0 = sys::cu();
        let h = sys::poseidon(&parts[..n]).ok_or(err(0x100))?;
        let c1 = sys::cu();
        let ok = h[..] == expected[..];
        sys::log5(1, n as u64, c0 - c1, ok as u64, 0);
        if !ok {
            return Err(err(0x101));
        }
        d = &d[1 + 32 * n + 32..];
    }
    Ok(())
}

#[cfg(feature = "store")]
fn nf_a_insert(program_id: &Pubkey, accounts: &[AccountInfo], d: &[u8]) -> ProgramResult {
    let [payer, pda, _system, ..] = accounts else { return Err(ProgramError::NotEnoughAccountKeys) };
    if d.len() != 33 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let c0 = sys::cu();
    let lamports = Rent::get()?.minimum_balance(0);
    let bump = [d[32]];
    let seeds = [Seed::from(b"nf".as_ref()), Seed::from(POOL.as_ref()), Seed::from(&d[..32]), Seed::from(bump.as_ref())];
    let signer = Signer::from(&seeds);
    pinocchio_system::instructions::CreateAccount { from: payer, to: pda, lamports, space: 0, owner: program_id }
        .invoke_signed(&[signer])?;
    let c1 = sys::cu();
    sys::log5(0x10, c0 - c1, lamports, 0, 0);
    Ok(())
}

#[cfg(feature = "store")]
fn nf_a_check(program_id: &Pubkey, accounts: &[AccountInfo], d: &[u8]) -> ProgramResult {
    let [pda, ..] = accounts else { return Err(ProgramError::NotEnoughAccountKeys) };
    if d.len() != 33 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let c0 = sys::cu();
    let bump = [d[32]];
    let addr = create_program_address(&[b"nf", &POOL, &d[..32], &bump], program_id)?;
    if &addr != pda.key() {
        return Err(err(0x110));
    }
    let spent = pda.owner() == program_id && pda.lamports() > 0;
    let c1 = sys::cu();
    sys::log5(0x11, c0 - c1, spent as u64, 0, 0);
    Ok(())
}

#[cfg(feature = "store")]
fn close(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let [target, authority, ..] = accounts else { return Err(ProgramError::NotEnoughAccountKeys) };
    if !authority.is_signer() || authority.key() != &AUTHORITY {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if target.owner() != program_id {
        return Err(ProgramError::IncorrectProgramId);
    }
    let l = target.lamports();
    *authority.try_borrow_mut_lamports()? += l;
    *target.try_borrow_mut_lamports()? = 0;
    sys::log5(0x12, l, 0, 0, 0);
    Ok(())
}

#[cfg(feature = "store")]
fn page_slot(nf: &[u8], cap: usize) -> usize {
    let mut w = [0u8; 8];
    w.copy_from_slice(&nf[24..32]);
    (u64::from_le_bytes(w) % cap as u64) as usize
}

#[cfg(feature = "store")]
fn nf_b_insert(program_id: &Pubkey, accounts: &[AccountInfo], d: &[u8]) -> ProgramResult {
    let [page, ..] = accounts else { return Err(ProgramError::NotEnoughAccountKeys) };
    if page.owner() != program_id || d.is_empty() || d.len() % 32 != 0 {
        return Err(ProgramError::InvalidArgument);
    }
    let mut data = page.try_borrow_mut_data()?;
    let cap = (data.len() - PAGE_HEADER) / 32;
    for nf in d.chunks(32) {
        let c0 = sys::cu();
        if nf.iter().all(|b| *b == 0) {
            return Err(err(0x200));
        }
        let mut count = u32::from_le_bytes(data[0..4].try_into().unwrap()) as usize;
        if (count + 1) * 10 > cap * 9 {
            return Err(err(0x201)); // page full (90% load cap)
        }
        let mut i = page_slot(nf, cap);
        let mut probes = 1u64;
        loop {
            let off = PAGE_HEADER + i * 32;
            let slot = &mut data[off..off + 32];
            if slot.iter().all(|b| *b == 0) {
                slot.copy_from_slice(nf);
                break;
            }
            if &slot[..] == nf {
                return Err(err(0x202)); // already spent
            }
            i = (i + 1) % cap;
            probes += 1;
        }
        count += 1;
        data[0..4].copy_from_slice(&(count as u32).to_le_bytes());
        let c1 = sys::cu();
        sys::log5(0x20, c0 - c1, probes, count as u64, cap as u64);
    }
    Ok(())
}

#[cfg(feature = "store")]
fn nf_b_check(program_id: &Pubkey, accounts: &[AccountInfo], d: &[u8]) -> ProgramResult {
    let [page, ..] = accounts else { return Err(ProgramError::NotEnoughAccountKeys) };
    if page.owner() != program_id || d.len() != 32 {
        return Err(ProgramError::InvalidArgument);
    }
    let c0 = sys::cu();
    let data = page.try_borrow_data()?;
    let cap = (data.len() - PAGE_HEADER) / 32;
    let mut i = page_slot(d, cap);
    let mut probes = 1u64;
    let found = loop {
        let off = PAGE_HEADER + i * 32;
        let slot = &data[off..off + 32];
        if slot.iter().all(|b| *b == 0) {
            break false;
        }
        if slot == d {
            break true;
        }
        i = (i + 1) % cap;
        probes += 1;
    };
    let c1 = sys::cu();
    sys::log5(0x21, c0 - c1, probes, found as u64, 0);
    Ok(())
}

#[cfg(feature = "verify")]
fn g16_verify(tag: u8, d: &[u8]) -> ProgramResult {
    if d.len() != 64 + 128 + 64 + 32 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let c0 = sys::cu();
    let a: &[u8; 64] = d[0..64].try_into().unwrap();
    let b: &[u8; 128] = d[64..192].try_into().unwrap();
    let c: &[u8; 64] = d[192..256].try_into().unwrap();
    let inputs: [[u8; 32]; 1] = [d[256..288].try_into().unwrap()];
    let key = match tag {
        0x30 => &vk::G16_SKELETON,
        0x31 => &vk::G16_PI_HASH,
        _ => &vk::G16_FULLSIZE,
    };
    // canonical public input check (same rule as groth16-solana's verify(), without num-bigint)
    if fr::Fr::from_be_canonical(&inputs[0]).is_none() {
        return Err(err(0x302));
    }
    let mut v = groth16_solana::groth16::Groth16Verifier::new(a, b, c, &inputs, key).map_err(|_| err(0x300))?;
    v.verify_unchecked().map_err(|_| err(0x301))?;
    let c1 = sys::cu();
    sys::log5(tag as u64, c0 - c1, 0, 0, 0);
    Ok(())
}

#[cfg(feature = "verify")]
fn plonk_verify(tag: u8, d: &[u8]) -> ProgramResult {
    let hinted = tag != 0x41;
    let want = 32 + plonk::PROOF_LEN + if hinted { 32 } else { 0 };
    if d.len() != want {
        return Err(ProgramError::InvalidInstructionData);
    }
    let pub_in: &[u8; 32] = d[0..32].try_into().unwrap();
    let proof = &d[32..32 + plonk::PROOF_LEN];
    let hint: Option<&[u8; 32]> = if hinted { Some(d[32 + plonk::PROOF_LEN..].try_into().unwrap()) } else { None };
    let key = if tag == 0x42 { &vk::PLONK_SKELETON } else { &vk::PLONK_PI_HASH };
    let mut m = plonk::Meter([0; 5]);
    let r = plonk::verify(key, pub_in, proof, hint, &mut m);
    match r {
        Ok(()) => {
            // (tag, transcript, field, g1, pairing)
            sys::log5(tag as u64, m.0[0] - m.0[1], m.0[1] - m.0[2], m.0[2] - m.0[3], m.0[3] - m.0[4]);
            Ok(())
        }
        Err(e) => Err(err(0x400 + e as u32)),
    }
}

#[cfg(feature = "fflonk")]
fn fflonk_verify(d: &[u8]) -> ProgramResult {
    if d.len() != 32 + fflonk::PROOF_LEN {
        return Err(ProgramError::InvalidInstructionData);
    }
    let pub_in: &[u8; 32] = d[0..32].try_into().unwrap();
    let mut m = plonk::Meter([0; 5]);
    match fflonk::verify(&vk::FFLONK_PI_HASH, pub_in, &d[32..], &mut m) {
        Ok(()) => {
            sys::log5(0x50, m.0[0] - m.0[1], m.0[1] - m.0[2], m.0[2] - m.0[3], m.0[3] - m.0[4]);
            Ok(())
        }
        Err(e) => Err(err(0x500 + e as u32)),
    }
}
