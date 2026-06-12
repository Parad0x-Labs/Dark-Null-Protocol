use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    hash::hashv,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    secp256k1_recover::secp256k1_recover,
    system_instruction,
    sysvar::Sysvar,
};

solana_program::declare_id!("11111111111111111111111111111112");

// ── State structs ────────────────────────────────────────────────────────────

/// Size: 32 + 64 + 1 = 97 bytes
#[derive(BorshSerialize, BorshDeserialize)]
pub struct OracleConfig {
    /// Authority that owns this oracle config
    pub authority: Pubkey,
    /// secp256k1 uncompressed pubkey WITHOUT 0x04 prefix (64 bytes)
    pub oracle_pubkey: [u8; 64],
    /// PDA bump
    pub bump: u8,
}

impl OracleConfig {
    pub const LEN: usize = 32 + 64 + 1; // 97
}

/// Size: 32 + 8 + 32 + 1 = 73 bytes
#[derive(BorshSerialize, BorshDeserialize)]
pub struct ReceiptRecord {
    /// SHA256 of the external payment identifier
    pub payment_id: [u8; 32],
    /// Settlement amount in USD cents
    pub amount_usd_cents: u64,
    /// Solana recipient pubkey bytes
    pub recipient: [u8; 32],
    /// PDA bump
    pub bump: u8,
}

impl ReceiptRecord {
    pub const LEN: usize = 32 + 8 + 32 + 1; // 73
}

// ── Seeds ────────────────────────────────────────────────────────────────────

const ORACLE_SEED: &[u8] = b"fiat-oracle-v1";
const RECEIPT_SEED: &[u8] = b"fiat-receipt-v1";

// ── Entry point ──────────────────────────────────────────────────────────────

#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    if instruction_data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    match instruction_data[0] {
        0 => register_oracle(program_id, accounts, &instruction_data[1..]),
        1 => settle_receipt(program_id, accounts, &instruction_data[1..]),
        2 => close_oracle(program_id, accounts),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

// ── Instruction 0: RegisterOracle ────────────────────────────────────────────
//
// Payload (64 bytes): oracle_pubkey_uncompressed (secp256k1, no 0x04 prefix)
//
// Accounts:
//   0: authority          (signer, writable)
//   1: oracle_config_pda  (writable) — PDA seeds: [ORACLE_SEED, authority.key]
//   2: system_program

fn register_oracle(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if data.len() != 64 {
        msg!("RegisterOracle: expected 64 bytes, got {}", data.len());
        return Err(ProgramError::InvalidInstructionData);
    }

    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let oracle_config_pda = next_account_info(iter)?;
    let system_program = next_account_info(iter)?;

    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut oracle_pubkey = [0u8; 64];
    oracle_pubkey.copy_from_slice(data);

    // Derive PDA
    let seeds: &[&[u8]] = &[ORACLE_SEED, authority.key.as_ref()];
    let (pda, bump) = Pubkey::find_program_address(seeds, program_id);
    if pda != *oracle_config_pda.key {
        msg!("RegisterOracle: oracle_config_pda mismatch");
        return Err(ProgramError::InvalidArgument);
    }

    // Allocate account
    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(OracleConfig::LEN);

    let signer_seeds: &[&[u8]] = &[ORACLE_SEED, authority.key.as_ref(), &[bump]];
    invoke_signed(
        &system_instruction::create_account(
            authority.key,
            oracle_config_pda.key,
            lamports,
            OracleConfig::LEN as u64,
            program_id,
        ),
        &[authority.clone(), oracle_config_pda.clone(), system_program.clone()],
        &[signer_seeds],
    )?;

    let config = OracleConfig {
        authority: *authority.key,
        oracle_pubkey,
        bump,
    };
    config.serialize(&mut &mut oracle_config_pda.data.borrow_mut()[..])?;

    msg!("RegisterOracle: PDA {} created", pda);
    Ok(())
}

// ── Instruction 1: SettleReceipt ─────────────────────────────────────────────
//
// Payload (137 bytes):
//   [0..32]   payment_id       — SHA256 of external payment ID
//   [32..40]  amount_usd_cents — u64 little-endian
//   [40..72]  recipient        — 32-byte Solana pubkey
//   [72..104] oracle_sig_r     — secp256k1 sig R
//  [104..136] oracle_sig_s     — secp256k1 sig S
//  [136]      recovery_id      — 0 or 1
//
// Accounts:
//   0: authority          (signer, writable)
//   1: oracle_config_pda  (readable) — must match authority
//   2: receipt_pda        (writable) — PDA seeds: [RECEIPT_SEED, payment_id]
//   3: system_program

fn settle_receipt(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if data.len() != 137 {
        msg!("SettleReceipt: expected 137 bytes, got {}", data.len());
        return Err(ProgramError::InvalidInstructionData);
    }

    // ── Parse payload ────────────────────────────────────────────────────────
    let mut payment_id = [0u8; 32];
    payment_id.copy_from_slice(&data[0..32]);

    let amount_usd_cents = u64::from_le_bytes(data[32..40].try_into().unwrap());

    let mut recipient = [0u8; 32];
    recipient.copy_from_slice(&data[40..72]);

    let mut oracle_sig_r = [0u8; 32];
    oracle_sig_r.copy_from_slice(&data[72..104]);

    let mut oracle_sig_s = [0u8; 32];
    oracle_sig_s.copy_from_slice(&data[104..136]);

    let recovery_id = data[136];
    if recovery_id > 1 {
        msg!("SettleReceipt: invalid recovery_id {}", recovery_id);
        return Err(ProgramError::InvalidArgument);
    }

    // ── Accounts ─────────────────────────────────────────────────────────────
    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let oracle_config_pda = next_account_info(iter)?;
    let receipt_pda = next_account_info(iter)?;
    let system_program = next_account_info(iter)?;

    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // ── Load & validate OracleConfig ─────────────────────────────────────────
    let config =
        OracleConfig::deserialize(&mut &oracle_config_pda.data.borrow()[..])?;
    if config.authority != *authority.key {
        msg!("SettleReceipt: authority mismatch");
        return Err(ProgramError::InvalidArgument);
    }

    // ── Reconstruct message hash ─────────────────────────────────────────────
    // msg_hash = SHA256(payment_id || amount_le_bytes || recipient)
    let amount_le = amount_usd_cents.to_le_bytes();
    let msg_hash = hashv(&[&payment_id, &amount_le, &recipient]);

    // ── Verify secp256k1 signature ───────────────────────────────────────────
    let mut sig_bytes = [0u8; 64];
    sig_bytes[..32].copy_from_slice(&oracle_sig_r);
    sig_bytes[32..].copy_from_slice(&oracle_sig_s);

    let recovered = secp256k1_recover(msg_hash.as_ref(), recovery_id, &sig_bytes)
        .map_err(|_| {
            msg!("SettleReceipt: secp256k1_recover failed");
            ProgramError::InvalidArgument
        })?;

    if recovered.0 != config.oracle_pubkey {
        msg!("SettleReceipt: recovered pubkey does not match oracle");
        return Err(ProgramError::InvalidArgument);
    }

    // ── Replay protection: receipt PDA must not yet exist ────────────────────
    let receipt_seeds: &[&[u8]] = &[RECEIPT_SEED, &payment_id];
    let (receipt_key, receipt_bump) =
        Pubkey::find_program_address(receipt_seeds, program_id);
    if receipt_key != *receipt_pda.key {
        msg!("SettleReceipt: receipt_pda mismatch");
        return Err(ProgramError::InvalidArgument);
    }
    if !receipt_pda.data_is_empty() {
        msg!("SettleReceipt: receipt already exists — replay rejected");
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    // ── Create receipt PDA ───────────────────────────────────────────────────
    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(ReceiptRecord::LEN);

    let receipt_signer_seeds: &[&[u8]] =
        &[RECEIPT_SEED, &payment_id, &[receipt_bump]];
    invoke_signed(
        &system_instruction::create_account(
            authority.key,
            receipt_pda.key,
            lamports,
            ReceiptRecord::LEN as u64,
            program_id,
        ),
        &[authority.clone(), receipt_pda.clone(), system_program.clone()],
        &[receipt_signer_seeds],
    )?;

    // ── Store ReceiptRecord ──────────────────────────────────────────────────
    let record = ReceiptRecord {
        payment_id,
        amount_usd_cents,
        recipient,
        bump: receipt_bump,
    };
    record.serialize(&mut &mut receipt_pda.data.borrow_mut()[..])?;

    msg!(
        "SettleReceipt: payment_id={:?} amount_cents={} receipt={}",
        &payment_id[..8],
        amount_usd_cents,
        receipt_key
    );
    Ok(())
}

// ── Instruction 2: CloseOracle ────────────────────────────────────────────────
//
// Payload: none (0 bytes after discriminant)
//
// Accounts:
//   0: authority          (signer, writable)
//   1: oracle_config_pda  (writable) — must match authority
//   2: destination        (writable) — receives recovered rent lamports

fn close_oracle(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let oracle_config_pda = next_account_info(iter)?;
    let destination = next_account_info(iter)?;

    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Verify PDA
    let seeds: &[&[u8]] = &[ORACLE_SEED, authority.key.as_ref()];
    let (expected_pda, _bump) = Pubkey::find_program_address(seeds, program_id);
    if expected_pda != *oracle_config_pda.key {
        msg!("CloseOracle: oracle_config_pda mismatch");
        return Err(ProgramError::InvalidArgument);
    }

    // Verify ownership: only the registering authority can close
    let config = OracleConfig::deserialize(&mut &oracle_config_pda.data.borrow()[..])?;
    if config.authority != *authority.key {
        msg!("CloseOracle: authority mismatch");
        return Err(ProgramError::InvalidArgument);
    }

    // Transfer all lamports to destination, zero data
    let lamports = oracle_config_pda.lamports();
    **oracle_config_pda.lamports.borrow_mut() = 0;
    **destination.lamports.borrow_mut() = destination
        .lamports()
        .checked_add(lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    oracle_config_pda.data.borrow_mut().fill(0);

    msg!("CloseOracle: closed, {} lamports returned", lamports);
    Ok(())
}
