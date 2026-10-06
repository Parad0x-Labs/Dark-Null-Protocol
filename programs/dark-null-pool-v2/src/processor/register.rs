//! `register_mint` (V2_SPEC 8.3, 8.7): mint checks and the Token-2022 allowlist, then `MintState` and the vault.
//!
//! Accounts: `authority` (s, w), `pool_config`, `mint`, `mint_state` (w), `vault` (w), `vault_authority`,
//! `token_program`, `system_program`. Data: `outflow_cap_per_epoch: u64` (`u64::MAX` = no cap).

use super::util::create_pda_account;
use crate::error::{from_transcript, PoolError};
use crate::hash::POSEIDON;
use crate::instructions::REGISTER_MINT_LEN;
use crate::pda;
use crate::state::{mint_state, MintState, PoolConfig};
use crate::token::{self, KIND_SPL_TOKEN, KIND_TOKEN_2022, SPL_TOKEN_ID, TOKEN_2022_ID};
use dark_null_transcript::pool::{SEED_MINT, SEED_VAULT, SEED_VAULT_AUTH};
use dark_null_transcript::preimage::asset_id;
use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, program::invoke, pubkey::Pubkey, rent::Rent, system_program, sysvar::Sysvar,
};

pub fn process(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() != REGISTER_MINT_LEN {
        return Err(PoolError::BadIx.into());
    }
    let cap = u64::from_le_bytes(data[8..16].try_into().expect("8 bytes"));
    let [authority, pool_config_ai, mint, mint_state_ai, vault, vault_authority, token_program, system] = accounts else {
        return Err(PoolError::AccountMismatch.into());
    };
    let pc = PoolConfig::load(pool_config_ai, program_id)?;
    if !authority.is_signer || *authority.key != pc.authority {
        return Err(PoolError::Unauthorized.into());
    }
    if !authority.is_writable || !mint_state_ai.is_writable || !vault.is_writable || *system.key != system_program::ID {
        return Err(PoolError::AccountMismatch.into());
    }
    let kind = if *token_program.key == SPL_TOKEN_ID {
        KIND_SPL_TOKEN
    } else if *token_program.key == TOKEN_2022_ID {
        KIND_TOKEN_2022
    } else {
        return Err(PoolError::AccountMismatch.into());
    };
    if mint.owner != token_program.key {
        return Err(PoolError::AccountMismatch.into());
    }
    let info = token::check_mint(&mint.try_borrow_data()?, kind)?;

    let pc_key = *pool_config_ai.key;
    let (ms_key, ms_bump) = pda::mint_state(program_id, &pc_key, mint.key);
    let (vault_key, vault_bump) = pda::vault(program_id, &pc_key, mint.key);
    let va_key = Pubkey::create_program_address(&[SEED_VAULT_AUTH, pc_key.as_ref(), &[pc.vault_auth_bump]], program_id)
        .map_err(|_| PoolError::AccountMismatch)?;
    if ms_key != *mint_state_ai.key || vault_key != *vault.key || va_key != *vault_authority.key {
        return Err(PoolError::AccountMismatch.into());
    }

    let rent = Rent::get()?;
    create_pda_account(
        authority,
        mint_state_ai,
        system,
        mint_state::LEN,
        program_id,
        &[SEED_MINT, pc_key.as_ref(), mint.key.as_ref(), &[ms_bump]],
        &rent,
        PoolError::AccountMismatch,
    )?;
    let vault_len = if kind == KIND_TOKEN_2022 { token::VAULT_LEN_2022 } else { token::ACCOUNT_LEN };
    create_pda_account(
        authority,
        vault,
        system,
        vault_len,
        token_program.key,
        &[SEED_VAULT, pc_key.as_ref(), mint.key.as_ref(), &[vault_bump]],
        &rent,
        PoolError::AccountMismatch,
    )?;
    if kind == KIND_TOKEN_2022 {
        invoke(&token::initialize_immutable_owner(vault.key), &[vault.clone(), token_program.clone()])?;
    }
    invoke(
        &token::initialize_account3(token_program.key, vault.key, mint.key, vault_authority.key),
        &[vault.clone(), mint.clone(), token_program.clone()],
    )?;

    let ms = MintState {
        bump: ms_bump,
        vault_bump,
        token_program_kind: kind,
        decimals: info.decimals,
        freeze_authority_present: info.freeze_authority_present as u8,
        mint: *mint.key,
        vault: vault_key,
        asset: asset_id(&POSEIDON, &mint.key.to_bytes()).map_err(from_transcript)?,
        supply: 0,
        outflow_cap_per_epoch: cap,
        outflow_epoch: 0,
        outflow_in_epoch: 0,
    };
    ms.write_new(&mut mint_state_ai.try_borrow_mut_data()?);
    Ok(())
}
