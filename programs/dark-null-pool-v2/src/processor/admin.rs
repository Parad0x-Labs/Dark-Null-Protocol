//! `set_beta_limits` and `set_paused` (V2_SPEC 8.3; devnet/beta only).

use crate::error::PoolError;
use crate::instructions::{SET_BETA_LIMITS_LEN, SET_PAUSED_LEN};
use crate::state::{mint_state, pool_config, wr_u64, MintState, PoolConfig};
use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, pubkey::Pubkey};

fn authorize(authority: &AccountInfo, pc: &PoolConfig) -> Result<(), PoolError> {
    if !authority.is_signer || *authority.key != pc.authority {
        return Err(PoolError::Unauthorized);
    }
    Ok(())
}

/// Accounts: `authority` (s), `pool_config`, `mint_state` (w). Data: `outflow_cap_per_epoch: u64`.
pub fn set_beta_limits(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() != SET_BETA_LIMITS_LEN {
        return Err(PoolError::BadIx.into());
    }
    let [authority, pool_config_ai, mint_state_ai] = accounts else {
        return Err(PoolError::AccountMismatch.into());
    };
    let pc = PoolConfig::load(pool_config_ai, program_id)?;
    authorize(authority, &pc)?;
    MintState::load(mint_state_ai, program_id, pool_config_ai.key)?;
    if !mint_state_ai.is_writable {
        return Err(PoolError::AccountMismatch.into());
    }
    let cap = u64::from_le_bytes(data[8..16].try_into().expect("8 bytes"));
    let mut d = mint_state_ai.try_borrow_mut_data()?;
    wr_u64(&mut d, mint_state::OUTFLOW_CAP_PER_EPOCH, cap);
    Ok(())
}

/// Accounts: `authority` (s), `pool_config` (w). Data: `paused: u8` (0 or 1).
pub fn set_paused(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() != SET_PAUSED_LEN || data[8] > 1 {
        return Err(PoolError::BadIx.into());
    }
    let [authority, pool_config_ai] = accounts else {
        return Err(PoolError::AccountMismatch.into());
    };
    let pc = PoolConfig::load(pool_config_ai, program_id)?;
    authorize(authority, &pc)?;
    if !pool_config_ai.is_writable {
        return Err(PoolError::AccountMismatch.into());
    }
    let mut d = pool_config_ai.try_borrow_mut_data()?;
    d[pool_config::PAUSED] = data[8];
    Ok(())
}
