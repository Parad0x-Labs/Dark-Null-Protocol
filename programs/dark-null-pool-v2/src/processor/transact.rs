//! `transact` (V2_SPEC 8.4, 8.5). The 14 steps run in the normative order; each step's error code is the one the
//! spec names. Steps 1-9 are pure and match the reference model in
//! `crates/dark-null-transcript/tests/prover_malicious.rs`.
//!
//! Interpretations (recorded in V2_SPEC 8.5):
//! - Step 1 reads `paused` from `pool_config`, so the pool config account is loaded before step 1 (owner = program, length,
//!   discriminator); an unusable pool config or an account list other than 13 is `E_ACCOUNT_MISMATCH`.
//! - Step 3 derives the canonical nullifier PDAs (`E_NULLIFIER_ACCOUNT`); step 11 applies the spent predicate and
//!   creates the records.
//! - Defence in depth over the circuit (REVIEW_NOTES R1, R3): `nf0 != nf1` (step 1) and `assoc_root == 0` (step 2).

use super::util::{create_pda_account, now_epoch};
use crate::error::{from_transcript, PoolError};
use crate::event;
use crate::hash::{POSEIDON, SHA256};
use crate::instructions::{TransactView, TRANSACT_ACCOUNTS};
use crate::state::{pool_config, tree_check, tree_insert, tree_root_known, wr_u64, MintState, PoolConfig};
use crate::token::{self, KIND_SPL_TOKEN, SPL_TOKEN_ID, TOKEN_2022_ID};
use crate::verify::verify_proof;
use dark_null_transcript::extdata::ext_data_hash;
use dark_null_transcript::fr::ZERO;
use dark_null_transcript::pool::{pool_id_fr, SEED_NF, SEED_VAULT_AUTH};
use dark_null_transcript::preimage::{deposit_label, public_amount, public_asset, Statement};
use solana_program::{
    account_info::AccountInfo,
    clock::Clock,
    entrypoint::ProgramResult,
    program::{invoke, invoke_signed},
    pubkey::Pubkey,
    rent::Rent,
    system_program,
    sysvar::Sysvar,
};

/// Compute-unit marker for measurement builds (`--features cu-trace`); compiles to nothing otherwise.
macro_rules! cu {
    () => {
        #[cfg(feature = "cu-trace")]
        solana_program::log::sol_log_compute_units();
    };
}

pub fn process(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    cu!();
    let [submitter, pool_config_ai, tree_ai, vault, mint, public_ta, relayer_ta, nf_rec0, nf_rec1, vault_authority, mint_state_ai, token_program, system] = accounts
    else {
        return Err(PoolError::AccountMismatch.into());
    };
    debug_assert_eq!(accounts.len(), TRANSACT_ACCOUNTS);
    let pc_key = *pool_config_ai.key;

    // 1. paused; stateless parse checks
    let mut pc = PoolConfig::load(pool_config_ai, program_id)?;
    if pc.paused != 0 {
        return Err(PoolError::Paused.into());
    }
    let v = TransactView::check(data)?;

    // 2. association root (Phase 1) and pool binding
    if *v.assoc_root() != ZERO {
        return Err(PoolError::AssocDisabled.into());
    }
    if *v.pool_id() != pc.pool_id {
        return Err(PoolError::WrongPool.into());
    }

    // 3. accounts (8.4)
    let mismatch = || -> ProgramResult { Err(PoolError::AccountMismatch.into()) };
    if !submitter.is_signer || !submitter.is_writable || !pool_config_ai.is_writable {
        return mismatch();
    }
    if *tree_ai.key != pc.tree || tree_ai.owner != program_id || !tree_ai.is_writable {
        return mismatch();
    }
    let mut ms = MintState::load(mint_state_ai, program_id, &pc_key)?;
    if !mint_state_ai.is_writable || *vault.key != ms.vault || !vault.is_writable || *mint.key != ms.mint {
        return mismatch();
    }
    let va_key = Pubkey::create_program_address(&[SEED_VAULT_AUTH, pc_key.as_ref(), &[pc.vault_auth_bump]], program_id)
        .map_err(|_| PoolError::AccountMismatch)?;
    if *vault_authority.key != va_key {
        return mismatch();
    }
    let expect_tp = if ms.token_program_kind == KIND_SPL_TOKEN { SPL_TOKEN_ID } else { TOKEN_2022_ID };
    if *token_program.key != expect_tp || *system.key != system_program::ID {
        return mismatch();
    }
    if public_ta.key.as_ref() != v.public_token_account() || relayer_ta.key.as_ref() != v.relayer_fee_account() || !public_ta.is_writable || !relayer_ta.is_writable {
        return mismatch();
    }
    for ta in [public_ta, relayer_ta] {
        let ok = ta.owner == token_program.key
            && token::parse_token_account(&ta.try_borrow_data()?, ms.token_program_kind)
                .map(|t| t.mint == ms.mint && t.state == 1)
                .unwrap_or(false);
        if !ok {
            return Err(PoolError::TokenAccountInvalid.into());
        }
    }
    let mut nf_bump = [0u8; 2];
    for (i, rec) in [nf_rec0, nf_rec1].into_iter().enumerate() {
        let (addr, bump) = Pubkey::find_program_address(&[SEED_NF, pc_key.as_ref(), v.nf(i)], program_id);
        if addr != *rec.key || !rec.is_writable {
            return Err(PoolError::NullifierAccount.into());
        }
        nf_bump[i] = bump;
    }

    // 4. fee rules
    let dep = v.deposit_amount();
    let wd = v.withdraw_amount();
    let fee = v.relayer_fee();
    let pub_is_vault = public_ta.key == vault.key;
    let rel_is_vault = relayer_ta.key == vault.key;
    let fee_ok = if dep > 0 {
        fee == 0 && rel_is_vault && !pub_is_vault
    } else {
        fee <= wd && pub_is_vault == (wd - fee == 0) && rel_is_vault == (fee == 0)
    };
    if !fee_ok {
        return Err(PoolError::BadFee.into());
    }

    cu!();
    // 5. root in the 256-root ring
    {
        let td = tree_ai.try_borrow_data()?;
        tree_check(&td)?;
        if !tree_root_known(&td, v.root_hint(), v.root()) {
            return Err(PoolError::UnknownRoot.into());
        }
    }

    // 6. epoch window
    let clock = Clock::get()?;
    let now = now_epoch(clock.unix_timestamp, pc.epoch_seconds).ok_or(PoolError::EpochWindow)?;
    if v.claimed_epoch().abs_diff(now) > 1 {
        return Err(PoolError::EpochWindow.into());
    }

    cu!();
    // 7. ext_data_hash over the received bytes
    let edh = ext_data_hash(&SHA256, v.ext_data()).map_err(from_transcript)?;

    // 8. asset, public amount and asset, deposit label
    let pa = public_amount(dep, wd).map_err(from_transcript)?;
    let label = if dep > 0 { deposit_label(&POSEIDON, &pool_id_fr(&pc.pool_id), pc.deposit_counter).map_err(from_transcript)? } else { ZERO };

    // 9. pi (one Poseidon call, 12 inputs)
    let st = Statement {
        root: *v.root(),
        nf: [*v.nf(0), *v.nf(1)],
        cm: [*v.cm(0), *v.cm(1)],
        public_amount: pa,
        public_asset: public_asset(&pa, &ms.asset),
        ext_data_hash: edh,
        epoch: v.claimed_epoch(),
        deposit_label: label,
        assoc_root: *v.assoc_root(),
    };
    let pi = st.pi(&POSEIDON).map_err(from_transcript)?;

    cu!();
    // 10. Groth16
    verify_proof(v.proof_a_neg(), v.proof_b(), v.proof_c(), &pi)?;

    cu!();
    // 11. nullifier records, nf0 then nf1 (option A)
    let rent = Rent::get()?;
    for (i, rec) in [nf_rec0, nf_rec1].into_iter().enumerate() {
        if rec.owner == program_id {
            return Err(PoolError::NullifierSpent.into());
        }
        create_pda_account(submitter, rec, system, 0, program_id, &[SEED_NF, pc_key.as_ref(), v.nf(i), &[nf_bump[i]]], &rent, PoolError::NullifierAccount)?;
    }

    cu!();
    // 12. insert cm0, cm1; push the root; events
    let (leaf, head, new_root) = {
        let mut td = tree_ai.try_borrow_mut_data()?;
        tree_insert(&POSEIDON, &mut td, v.cm(0), v.cm(1)).map_err(from_transcript)?
    };
    event::emit_tx(leaf, head, &new_root);
    if dep > 0 {
        event::emit_deposit(&label, &submitter.key.to_bytes(), &mint.key.to_bytes(), dep);
    }

    cu!();
    // 13. public leg
    if dep > 0 {
        let before = token::amount_of(&vault.try_borrow_data()?);
        invoke(
            &token::transfer_checked(token_program.key, public_ta.key, mint.key, vault.key, submitter.key, dep, ms.decimals),
            &[public_ta.clone(), mint.clone(), vault.clone(), submitter.clone(), token_program.clone()],
        )?;
        let after = token::amount_of(&vault.try_borrow_data()?);
        if Some(after) != before.checked_add(dep) {
            return Err(PoolError::DepositDelta.into());
        }
        ms.supply = ms.supply.checked_add(dep).ok_or(PoolError::Arithmetic)?;
        pc.deposit_counter = pc.deposit_counter.checked_add(1).ok_or(PoolError::Arithmetic)?;
        wr_u64(&mut pool_config_ai.try_borrow_mut_data()?, pool_config::DEPOSIT_COUNTER, pc.deposit_counter);
    } else if wd > 0 {
        if ms.outflow_epoch != now {
            ms.outflow_epoch = now;
            ms.outflow_in_epoch = 0;
        }
        let out = ms.outflow_in_epoch.checked_add(wd).ok_or(PoolError::Arithmetic)?;
        if out > ms.outflow_cap_per_epoch {
            return Err(PoolError::OutflowCap.into());
        }
        ms.outflow_in_epoch = out;
        if ms.supply < wd {
            return Err(PoolError::Supply.into());
        }
        ms.supply -= wd;
        let seeds: &[&[u8]] = &[SEED_VAULT_AUTH, pc_key.as_ref(), &[pc.vault_auth_bump]];
        let to_recipient = wd - fee;
        if to_recipient > 0 {
            invoke_signed(
                &token::transfer_checked(token_program.key, vault.key, mint.key, public_ta.key, vault_authority.key, to_recipient, ms.decimals),
                &[vault.clone(), mint.clone(), public_ta.clone(), vault_authority.clone(), token_program.clone()],
                &[seeds],
            )?;
        }
        if fee > 0 {
            invoke_signed(
                &token::transfer_checked(token_program.key, vault.key, mint.key, relayer_ta.key, vault_authority.key, fee, ms.decimals),
                &[vault.clone(), mint.clone(), relayer_ta.clone(), vault_authority.clone(), token_program.clone()],
                &[seeds],
            )?;
        }
    }
    ms.write_counters(&mut mint_state_ai.try_borrow_mut_data()?);

    cu!();
    // 14. solvency
    if token::amount_of(&vault.try_borrow_data()?) < ms.supply {
        return Err(PoolError::Solvency.into());
    }
    cu!();
    Ok(())
}
