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
    system_instruction,
    sysvar::Sysvar,
};

solana_program::declare_id!("ByFb6xcQTgG4fai31Zto7qpQve1eBo3cc2qrAJU5tN7k");

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

/// On-chain layout:
///   authority    [u8; 32]  bytes  0–31
///   commitment   [u8; 32]  bytes 32–63
///   count        u64 LE    bytes 64–71
///   is_finalized u8        byte  72
///   bump         u8        byte  73
///                                 = 74 bytes total
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct AccumulatorState {
    pub authority: Pubkey,
    pub commitment: [u8; 32],
    pub count: u64,
    pub is_finalized: bool,
    pub bump: u8,
}

const ACCUMULATOR_STATE_SIZE: usize = 74;
const PDA_SEED: &[u8] = b"accumulator-v1";

// ─────────────────────────────────────────────────────────────────────────────
// Entrypoint
// ─────────────────────────────────────────────────────────────────────────────

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

    let discriminant = instruction_data[0];
    let payload = &instruction_data[1..];

    match discriminant {
        0 => init_accumulator(program_id, accounts),
        1 => accumulate_receipt(program_id, accounts, payload),
        2 => finalize_accumulator(program_id, accounts),
        3 => close_accumulator(program_id, accounts),
        _ => {
            msg!("Unknown instruction discriminant: {}", discriminant);
            Err(ProgramError::InvalidInstructionData)
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Instruction 0: InitAccumulator
// ─────────────────────────────────────────────────────────────────────────────
// Accounts: [authority (signer+writable), accumulator_pda (writable), system_program]

fn init_accumulator(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let authority = next_account_info(account_iter)?;
    let accumulator_pda = next_account_info(account_iter)?;
    let system_program = next_account_info(account_iter)?;

    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Derive PDA and verify
    let (pda, bump) = Pubkey::find_program_address(
        &[PDA_SEED, authority.key.as_ref()],
        program_id,
    );
    if pda != *accumulator_pda.key {
        msg!("Invalid accumulator PDA");
        return Err(ProgramError::InvalidSeeds);
    }

    // Create the PDA account
    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(ACCUMULATOR_STATE_SIZE);

    invoke_signed(
        &system_instruction::create_account(
            authority.key,
            accumulator_pda.key,
            lamports,
            ACCUMULATOR_STATE_SIZE as u64,
            program_id,
        ),
        &[authority.clone(), accumulator_pda.clone(), system_program.clone()],
        &[&[PDA_SEED, authority.key.as_ref(), &[bump]]],
    )?;

    // Write initial state
    let state = AccumulatorState {
        authority: *authority.key,
        commitment: [0u8; 32],
        count: 0,
        is_finalized: false,
        bump,
    };

    let mut data = accumulator_pda.try_borrow_mut_data()?;
    state.serialize(&mut &mut data[..])?;

    msg!("InitAccumulator: authority={}", authority.key);
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Instruction 1: AccumulateReceipt
// ─────────────────────────────────────────────────────────────────────────────
// Accounts: [authority (signer), accumulator_pda (writable)]
// Payload:  receipt_hash [u8; 32]

fn require_valid_accumulator_pda(
    program_id: &Pubkey,
    authority: &AccountInfo,
    accumulator_pda: &AccountInfo,
) -> ProgramResult {
    let (expected, _) = Pubkey::find_program_address(
        &[PDA_SEED, authority.key.as_ref()],
        program_id,
    );
    if expected != *accumulator_pda.key {
        msg!("Invalid accumulator PDA");
        return Err(ProgramError::InvalidSeeds);
    }
    // Defense-in-depth: the account must be owned by this program, not a
    // lookalike owned by some other program (audit H5).
    if accumulator_pda.owner != program_id {
        msg!("Accumulator PDA not owned by this program");
        return Err(ProgramError::InvalidAccountOwner);
    }
    Ok(())
}

fn accumulate_receipt(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    payload: &[u8],
) -> ProgramResult {
    if payload.len() < 32 {
        msg!("AccumulateReceipt: payload too short (need 32 bytes, got {})", payload.len());
        return Err(ProgramError::InvalidInstructionData);
    }

    let account_iter = &mut accounts.iter();
    let authority = next_account_info(account_iter)?;
    let accumulator_pda = next_account_info(account_iter)?;

    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    require_valid_accumulator_pda(program_id, authority, accumulator_pda)?;

    let mut receipt_hash = [0u8; 32];
    receipt_hash.copy_from_slice(&payload[..32]);

    // Deserialize state — strict: trailing garbage is rejected.
    let mut data = accumulator_pda.try_borrow_mut_data()?;
    let mut state = AccumulatorState::try_from_slice(&data)?;

    // Authority check
    if state.authority != *authority.key {
        msg!("AccumulateReceipt: wrong authority");
        return Err(ProgramError::InvalidAccountData);
    }

    // Finalization guard
    if state.is_finalized {
        msg!("AccumulateReceipt: accumulator is already finalized");
        return Err(ProgramError::InvalidAccountData);
    }

    // Hash-chain fold: new_commitment = SHA256(current_commitment || receipt_hash)
    let new_hash = hashv(&[&state.commitment, &receipt_hash]);
    state.commitment.copy_from_slice(new_hash.as_ref());
    state.count = state.count.checked_add(1).ok_or(ProgramError::InvalidAccountData)?;

    msg!(
        "Accumulated receipt #{}, commitment updated",
        state.count
    );

    // Write updated state
    state.serialize(&mut &mut data[..])?;
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Instruction 2: FinalizeAccumulator
// ─────────────────────────────────────────────────────────────────────────────
// Accounts: [authority (signer), accumulator_pda (writable)]

fn finalize_accumulator(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let authority = next_account_info(account_iter)?;
    let accumulator_pda = next_account_info(account_iter)?;

    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    require_valid_accumulator_pda(program_id, authority, accumulator_pda)?;

    let mut data = accumulator_pda.try_borrow_mut_data()?;
    let mut state = AccumulatorState::try_from_slice(&data)?;

    // Authority check
    if state.authority != *authority.key {
        msg!("FinalizeAccumulator: wrong authority");
        return Err(ProgramError::InvalidAccountData);
    }

    // Double-finalize guard
    if state.is_finalized {
        msg!("FinalizeAccumulator: already finalized");
        return Err(ProgramError::InvalidAccountData);
    }

    state.is_finalized = true;

    msg!(
        "Accumulator finalized: {} receipts, commitment={:?}",
        state.count,
        &state.commitment[..4]
    );

    state.serialize(&mut &mut data[..])?;
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Instruction 3: CloseAccumulator
// ─────────────────────────────────────────────────────────────────────────────
// Accounts: [authority (signer+writable), accumulator_pda (writable), destination (writable)]
// Closes the accumulator PDA, returning rent to destination.

fn close_accumulator(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let account_iter = &mut accounts.iter();
    let authority = next_account_info(account_iter)?;
    let accumulator_pda = next_account_info(account_iter)?;
    let destination = next_account_info(account_iter)?;

    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let seeds: &[&[u8]] = &[PDA_SEED, authority.key.as_ref()];
    let (expected, _) = Pubkey::find_program_address(seeds, program_id);
    if expected != *accumulator_pda.key {
        msg!("CloseAccumulator: PDA mismatch");
        return Err(ProgramError::InvalidArgument);
    }

    let state = AccumulatorState::try_from_slice(&accumulator_pda.data.borrow())?;
    if state.authority != *authority.key {
        msg!("CloseAccumulator: authority mismatch");
        return Err(ProgramError::InvalidArgument);
    }

    let lamports = accumulator_pda.lamports();
    **accumulator_pda.lamports.borrow_mut() = 0;
    **destination.lamports.borrow_mut() = destination
        .lamports()
        .checked_add(lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    accumulator_pda.data.borrow_mut().fill(0);

    msg!("CloseAccumulator: closed, {} lamports returned", lamports);
    Ok(())
}
