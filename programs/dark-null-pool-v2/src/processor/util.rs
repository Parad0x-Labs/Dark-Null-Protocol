//! Shared helpers: PDA account creation that survives a pre-funded address (finding F-PREFUND, V2_SPEC 8.6).

use crate::error::PoolError;
use solana_program::{
    account_info::AccountInfo,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction, system_program,
};

/// Create `target` (a PDA signed by `seeds`) with `space` bytes owned by `owner`, rent paid by `payer`.
///
/// - 0 lamports: `CreateAccount`.
/// - Owned by the System program with no data (someone sent lamports to the address, F-PREFUND): top up to the
///   rent-exempt minimum from `payer`, then `Allocate(space)` and `Assign(owner)`, both signed with the PDA seeds.
/// - Any other state: `foreign` (the caller's error code).
#[allow(clippy::too_many_arguments)]
pub fn create_pda_account<'a>(
    payer: &AccountInfo<'a>,
    target: &AccountInfo<'a>,
    system: &AccountInfo<'a>,
    space: usize,
    owner: &Pubkey,
    seeds: &[&[u8]],
    rent: &Rent,
    foreign: PoolError,
) -> Result<(), ProgramError> {
    let need = rent.minimum_balance(space);
    let have = target.lamports();
    if have == 0 {
        invoke_signed(
            &system_instruction::create_account(payer.key, target.key, need, space as u64, owner),
            &[payer.clone(), target.clone(), system.clone()],
            &[seeds],
        )?;
        return Ok(());
    }
    if *target.owner != system_program::ID || !target.data_is_empty() {
        return Err(foreign.into());
    }
    if have < need {
        invoke(&system_instruction::transfer(payer.key, target.key, need - have), &[payer.clone(), target.clone(), system.clone()])?;
    }
    invoke_signed(&system_instruction::allocate(target.key, space as u64), &[target.clone(), system.clone()], &[seeds])?;
    invoke_signed(&system_instruction::assign(target.key, owner), &[target.clone(), system.clone()], &[seeds])?;
    Ok(())
}

/// `now_epoch = floor(Clock.unix_timestamp / epoch_seconds)` (V2_SPEC 8.2). A negative clock has no epoch.
pub fn now_epoch(unix_timestamp: i64, epoch_seconds: u64) -> Option<u64> {
    if unix_timestamp < 0 || epoch_seconds == 0 {
        return None;
    }
    Some(unix_timestamp as u64 / epoch_seconds)
}
