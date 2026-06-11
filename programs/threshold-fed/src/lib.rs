use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint, entrypoint::ProgramResult,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    system_instruction,
    sysvar::rent::Rent,
    sysvar::Sysvar,
};
use borsh::{BorshDeserialize, BorshSerialize};

solana_program::declare_id!("11111111111111111111111111111112");

// ── account layouts ──────────────────────────────────────────────────────────

/// Stored at PDA seeds: [b"threshold-fed-v1", authority.key]
/// Total: 32 + 1 + 1 + 33 + 8 + 1 = 76 bytes
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct FederationConfig {
    pub authority: Pubkey,        // 32
    pub threshold: u8,            //  1
    pub total_signers: u8,        //  1
    pub aggregate_pubkey: [u8; 33], // 33
    pub issuance_count: u64,      //  8
    pub bump: u8,                 //  1
}

/// Stored at PDA seeds: [b"issuance-v1", token_hash]
/// Total: 32 + 32 + 1 = 65 bytes
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct IssuanceRecord {
    pub token_hash: [u8; 32],  // 32
    pub fed_config: Pubkey,    // 32
    pub bump: u8,              //  1
}

// ── entrypoint ───────────────────────────────────────────────────────────────

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

    match instruction_data[0] {
        0 => {
            msg!("Instruction: InitFederation");
            process_init_federation(program_id, accounts, &instruction_data[1..])
        }
        1 => {
            msg!("Instruction: RecordIssuance");
            process_record_issuance(program_id, accounts, &instruction_data[1..])
        }
        _ => {
            msg!("Error: unknown instruction discriminant");
            Err(ProgramError::InvalidInstructionData)
        }
    }
}

// ── InitFederation ───────────────────────────────────────────────────────────
//
// Payload (35 bytes after discriminant):
//   [0] threshold        u8
//   [1] total_signers    u8
//   [2..35] aggregate_pubkey [u8; 33]
//
// Accounts:
//   0  authority         signer + writable
//   1  fed_config_pda    writable
//   2  system_program

fn process_init_federation(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if data.len() < 35 {
        msg!("Error: InitFederation requires 35 bytes of payload");
        return Err(ProgramError::InvalidInstructionData);
    }

    let threshold = data[0];
    let total_signers = data[1];
    let mut aggregate_pubkey = [0u8; 33];
    aggregate_pubkey.copy_from_slice(&data[2..35]);

    // Validate federation parameters
    if threshold < 1 {
        msg!("Error: threshold must be >= 1");
        return Err(ProgramError::InvalidArgument);
    }
    if total_signers < 2 {
        msg!("Error: total_signers must be >= 2");
        return Err(ProgramError::InvalidArgument);
    }
    if threshold > total_signers {
        msg!("Error: threshold must be <= total_signers");
        return Err(ProgramError::InvalidArgument);
    }

    let accounts_iter = &mut accounts.iter();
    let authority = next_account_info(accounts_iter)?;
    let fed_config_pda = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;

    if !authority.is_signer {
        msg!("Error: authority must be a signer");
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Derive and verify PDA
    let seeds: &[&[u8]] = &[b"threshold-fed-v1", authority.key.as_ref()];
    let (pda, bump) = Pubkey::find_program_address(seeds, program_id);
    if pda != *fed_config_pda.key {
        msg!("Error: fed_config_pda does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Allocate the PDA account
    let rent = Rent::get()?;
    let space: usize = 76;
    let lamports = rent.minimum_balance(space);

    let signer_seeds: &[&[&[u8]]] = &[&[b"threshold-fed-v1", authority.key.as_ref(), &[bump]]];

    invoke_signed(
        &system_instruction::create_account(
            authority.key,
            &pda,
            lamports,
            space as u64,
            program_id,
        ),
        &[authority.clone(), fed_config_pda.clone(), system_program.clone()],
        signer_seeds,
    )?;

    // Serialize FederationConfig into the newly created account
    let config = FederationConfig {
        authority: *authority.key,
        threshold,
        total_signers,
        aggregate_pubkey,
        issuance_count: 0,
        bump,
    };
    let mut data_ref = fed_config_pda.try_borrow_mut_data()?;
    config.serialize(&mut &mut data_ref[..])?;

    msg!(
        "InitFederation: threshold={}/{}, aggregate_pubkey={}",
        threshold,
        total_signers,
        hex_encode(&aggregate_pubkey)
    );

    Ok(())
}

// ── RecordIssuance ───────────────────────────────────────────────────────────
//
// Payload (32 bytes after discriminant):
//   [0..32] token_hash [u8; 32]
//
// Accounts:
//   0  authority              signer + writable
//   1  fed_config_pda         writable
//   2  issuance_record_pda    writable
//   3  system_program

fn process_record_issuance(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if data.len() < 32 {
        msg!("Error: RecordIssuance requires 32 bytes of payload");
        return Err(ProgramError::InvalidInstructionData);
    }

    let mut token_hash = [0u8; 32];
    token_hash.copy_from_slice(&data[..32]);

    let accounts_iter = &mut accounts.iter();
    let authority = next_account_info(accounts_iter)?;
    let fed_config_pda = next_account_info(accounts_iter)?;
    let issuance_record_pda = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;

    if !authority.is_signer {
        msg!("Error: authority must be a signer");
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Verify fed_config_pda belongs to this program and load it
    if fed_config_pda.owner != program_id {
        msg!("Error: fed_config_pda not owned by this program");
        return Err(ProgramError::IncorrectProgramId);
    }

    let mut config: FederationConfig = {
        let data_ref = fed_config_pda.try_borrow_data()?;
        FederationConfig::try_from_slice(&data_ref)?
    };

    // Verify authority matches the stored federation authority
    if config.authority != *authority.key {
        msg!("Error: signer is not the federation authority");
        return Err(ProgramError::InvalidArgument);
    }

    // Derive and verify issuance record PDA
    let record_seeds: &[&[u8]] = &[b"issuance-v1", &token_hash];
    let (record_pda, record_bump) =
        Pubkey::find_program_address(record_seeds, program_id);
    if record_pda != *issuance_record_pda.key {
        msg!("Error: issuance_record_pda does not match expected PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Replay protection: reject if account already has data
    if issuance_record_pda.data_len() > 0 {
        msg!("Error: issuance record already exists — replay detected");
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    // Allocate the issuance record account
    let rent = Rent::get()?;
    let space: usize = 65;
    let lamports = rent.minimum_balance(space);

    let signer_seeds: &[&[&[u8]]] =
        &[&[b"issuance-v1", &token_hash, &[record_bump]]];

    invoke_signed(
        &system_instruction::create_account(
            authority.key,
            &record_pda,
            lamports,
            space as u64,
            program_id,
        ),
        &[
            authority.clone(),
            issuance_record_pda.clone(),
            system_program.clone(),
        ],
        signer_seeds,
    )?;

    // Store IssuanceRecord
    let record = IssuanceRecord {
        token_hash,
        fed_config: *fed_config_pda.key,
        bump: record_bump,
    };
    {
        let mut data_ref = issuance_record_pda.try_borrow_mut_data()?;
        record.serialize(&mut &mut data_ref[..])?;
    }

    // Increment issuance_count and re-serialize FederationConfig
    config.issuance_count = config
        .issuance_count
        .checked_add(1)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    {
        let mut data_ref = fed_config_pda.try_borrow_mut_data()?;
        config.serialize(&mut &mut data_ref[..])?;
    }

    msg!(
        "RecordIssuance: token_hash={}, issuance_count={}",
        hex_encode(&token_hash),
        config.issuance_count
    );

    Ok(())
}

// ── helpers ───────────────────────────────────────────────────────────────────

fn hex_encode(bytes: &[u8]) -> alloc::string::String {
    bytes.iter().map(|b| alloc::format!("{:02x}", b)).collect()
}

extern crate alloc;
