//! Instruction dispatch (V2_SPEC 8.3). An unknown or short discriminator is `E_BAD_IX`.

mod admin;
mod initialize;
mod register;
pub mod transact;
pub mod util;

use crate::error::PoolError;
use crate::instructions::{INITIALIZE_POOL, REGISTER_MINT, SET_BETA_LIMITS, SET_PAUSED, TRANSACT};
use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, pubkey::Pubkey};

pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() < 8 {
        return Err(PoolError::BadIx.into());
    }
    let disc: [u8; 8] = data[0..8].try_into().expect("8 bytes");
    match disc {
        TRANSACT => transact::process(program_id, accounts, data),
        INITIALIZE_POOL => initialize::process(program_id, accounts, data),
        REGISTER_MINT => register::process(program_id, accounts, data),
        SET_BETA_LIMITS => admin::set_beta_limits(program_id, accounts, data),
        SET_PAUSED => admin::set_paused(program_id, accounts, data),
        _ => Err(PoolError::BadIx.into()),
    }
}
