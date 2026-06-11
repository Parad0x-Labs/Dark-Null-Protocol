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
    system_instruction,
    sysvar::rent::Rent,
    sysvar::Sysvar,
};

solana_program::declare_id!("11111111111111111111111111111112");

// ---------------------------------------------------------------------------
// Instruction discriminants
// ---------------------------------------------------------------------------

const IX_REGISTER_SCAN_KEYS: u8 = 0;
const IX_RECORD_PAYMENT: u8 = 1;

// ---------------------------------------------------------------------------
// On-chain account data structures
// ---------------------------------------------------------------------------

/// 67 bytes: 33 + 33 + 1
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct ScanKeyRecord {
    pub scan_pubkey: [u8; 33],
    pub spend_pubkey: [u8; 33],
    pub bump: u8,
}

/// 67 bytes: 33 + 33 + 1
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct PaymentRecord {
    pub eph_pubkey: [u8; 33],
    pub one_time_address: [u8; 33],
    pub bump: u8,
}

// ---------------------------------------------------------------------------
// Instruction payload structs (deserialized from remaining bytes after disc)
// ---------------------------------------------------------------------------

#[derive(BorshDeserialize, Debug)]
struct RegisterScanKeysArgs {
    scan_pubkey: [u8; 33],
    spend_pubkey: [u8; 33],
}

#[derive(BorshDeserialize, Debug)]
struct RecordPaymentArgs {
    eph_pubkey: [u8; 33],
    one_time_address: [u8; 33],
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    if instruction_data.is_empty() {
        msg!("Error: instruction data is empty");
        return Err(ProgramError::InvalidInstructionData);
    }

    let (discriminant, payload) = instruction_data.split_first().ok_or(ProgramError::InvalidInstructionData)?;

    match *discriminant {
        IX_REGISTER_SCAN_KEYS => {
            msg!("Instruction: RegisterScanKeys");
            process_register_scan_keys(program_id, accounts, payload)
        }
        IX_RECORD_PAYMENT => {
            msg!("Instruction: RecordPayment");
            process_record_payment(program_id, accounts, payload)
        }
        _ => {
            msg!("Error: unknown discriminant {}", discriminant);
            Err(ProgramError::InvalidInstructionData)
        }
    }
}

// ---------------------------------------------------------------------------
// RegisterScanKeys
//
// Accounts (0-indexed):
//   0. payer          — signer, writable, pays rent
//   1. wallet         — signer, the recipient wallet; used in PDA seed
//   2. scan_key_pda   — writable, new PDA ["silent-pay-v1", wallet_pubkey]
//   3. system_program — System program
// ---------------------------------------------------------------------------

fn process_register_scan_keys(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    payload: &[u8],
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let payer = next_account_info(account_iter)?;
    let wallet = next_account_info(account_iter)?;
    let scan_key_pda = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;

    if !payer.is_signer {
        msg!("Error: payer must be signer");
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !wallet.is_signer {
        msg!("Error: wallet must be signer");
        return Err(ProgramError::MissingRequiredSignature);
    }

    let args = RegisterScanKeysArgs::try_from_slice(payload)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    // Derive PDA
    let seeds: &[&[u8]] = &[b"silent-pay-v1", wallet.key.as_ref()];
    let (expected_pda, bump) = Pubkey::find_program_address(seeds, program_id);
    if expected_pda != *scan_key_pda.key {
        msg!("Error: scan_key_pda does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    let record = ScanKeyRecord {
        scan_pubkey: args.scan_pubkey,
        spend_pubkey: args.spend_pubkey,
        bump,
    };

    let data_len = 67usize; // BorshSerialize of ScanKeyRecord
    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(data_len);

    let signer_seeds: &[&[&[u8]]] = &[&[b"silent-pay-v1", wallet.key.as_ref(), &[bump]]];

    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            scan_key_pda.key,
            lamports,
            data_len as u64,
            program_id,
        ),
        &[payer.clone(), scan_key_pda.clone(), system_program.clone()],
        signer_seeds,
    )?;

    let mut data = scan_key_pda.try_borrow_mut_data()?;
    let serialized = borsh::to_vec(&record).map_err(|_| ProgramError::InvalidAccountData)?;
    data[..serialized.len()].copy_from_slice(&serialized);

    msg!("RegisterScanKeys: PDA {}", scan_key_pda.key);
    Ok(())
}

// ---------------------------------------------------------------------------
// RecordPayment
//
// Accounts (0-indexed):
//   0. payer           — signer, writable, pays rent
//   1. payment_pda     — writable, new PDA ["silent-payment-v1", eph_pubkey]
//   2. system_program  — System program
// ---------------------------------------------------------------------------

fn process_record_payment(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    payload: &[u8],
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let payer = next_account_info(account_iter)?;
    let payment_pda = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;

    if !payer.is_signer {
        msg!("Error: payer must be signer");
        return Err(ProgramError::MissingRequiredSignature);
    }

    let args = RecordPaymentArgs::try_from_slice(payload)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    // SHA256(eph_pubkey) → 32-byte seed (raw 33-byte key exceeds Solana's 32-byte seed limit)
    let eph_hash = hashv(&[&args.eph_pubkey]);
    let eph_hash_bytes = eph_hash.to_bytes();

    let seeds: &[&[u8]] = &[b"silent-payment-v1", &eph_hash_bytes];
    let (expected_pda, bump) = Pubkey::find_program_address(seeds, program_id);
    if expected_pda != *payment_pda.key {
        msg!("Error: payment_pda does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    let record = PaymentRecord {
        eph_pubkey: args.eph_pubkey,
        one_time_address: args.one_time_address,
        bump,
    };

    let data_len = 67usize; // BorshSerialize of PaymentRecord
    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(data_len);

    let signer_seeds: &[&[&[u8]]] = &[&[b"silent-payment-v1", &eph_hash_bytes, &[bump]]];

    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            payment_pda.key,
            lamports,
            data_len as u64,
            program_id,
        ),
        &[payer.clone(), payment_pda.clone(), system_program.clone()],
        signer_seeds,
    )?;

    let mut data = payment_pda.try_borrow_mut_data()?;
    let serialized = borsh::to_vec(&record).map_err(|_| ProgramError::InvalidAccountData)?;
    data[..serialized.len()].copy_from_slice(&serialized);

    msg!("RecordPayment: PDA {}", payment_pda.key);
    Ok(())
}
