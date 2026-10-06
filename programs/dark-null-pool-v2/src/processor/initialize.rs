//! `initialize_pool` (V2_SPEC 8.3): creates `PoolConfig` and `Tree`, computes `pool_id` (8.2), `roots[0] = ZEROS[32]`.
//!
//! Accounts: `authority` (s, w), `pool_config` (w), `tree` (w), `system_program`.
//! Data: `pool_nonce[32]`, `epoch_seconds: u64` (non-zero).

use super::util::create_pda_account;
use crate::error::PoolError;
use crate::hash::SHA256;
use crate::instructions::INITIALIZE_POOL_LEN;
use crate::pda;
use crate::state::{pool_config, tree, tree_init, PoolConfig};
use crate::vk;
use dark_null_transcript::pool::{pool_id, SEED_POOL, SEED_TREE};
use solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, pubkey::Pubkey, rent::Rent, system_program, sysvar::Sysvar};

pub fn process(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() != INITIALIZE_POOL_LEN {
        return Err(PoolError::BadIx.into());
    }
    let pool_nonce: [u8; 32] = data[8..40].try_into().expect("32 bytes");
    let epoch_seconds = u64::from_le_bytes(data[40..48].try_into().expect("8 bytes"));
    if epoch_seconds == 0 {
        return Err(PoolError::BadIx.into());
    }
    let [authority, pool_config_ai, tree_ai, system] = accounts else {
        return Err(PoolError::AccountMismatch.into());
    };
    if !authority.is_signer || !authority.is_writable || !pool_config_ai.is_writable || !tree_ai.is_writable || *system.key != system_program::ID {
        return Err(PoolError::AccountMismatch.into());
    }
    let (pc_key, pc_bump) = pda::pool_config(program_id, &pool_nonce);
    if pc_key != *pool_config_ai.key {
        return Err(PoolError::AccountMismatch.into());
    }
    let (tree_key, tree_bump) = pda::tree(program_id, &pc_key);
    if tree_key != *tree_ai.key {
        return Err(PoolError::AccountMismatch.into());
    }
    let (_, vault_auth_bump) = pda::vault_authority(program_id, &pc_key);

    let rent = Rent::get()?;
    create_pda_account(authority, pool_config_ai, system, pool_config::LEN, program_id, &[SEED_POOL, &pool_nonce, &[pc_bump]], &rent, PoolError::AccountMismatch)?;
    create_pda_account(authority, tree_ai, system, tree::LEN, program_id, &[SEED_TREE, pc_key.as_ref(), &[tree_bump]], &rent, PoolError::AccountMismatch)?;

    let pc = PoolConfig {
        bump: pc_bump,
        paused: 0,
        flags: 0,
        vault_auth_bump,
        authority: *authority.key,
        pool_nonce,
        pool_id: pool_id(&SHA256, &program_id.to_bytes(), &pc_key.to_bytes()),
        vk_hash: vk::VK_HASH,
        epoch_seconds,
        deposit_counter: 0,
        tree: tree_key,
    };
    pc.write_new(&mut pool_config_ai.try_borrow_mut_data()?);
    tree_init(&mut tree_ai.try_borrow_mut_data()?, tree_bump);
    Ok(())
}
