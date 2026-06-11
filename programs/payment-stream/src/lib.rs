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

/// Channel state stored in the PDA — 82 bytes total:
///   payer:        32
///   recipient:    32
///   max_lamports:  8
///   nonce:         8
///   is_open:       1
///   bump:          1
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct ChannelState {
    pub payer: Pubkey,
    pub recipient: Pubkey,
    pub max_lamports: u64,
    pub nonce: [u8; 8],
    pub is_open: bool,
    pub bump: u8,
}

impl ChannelState {
    pub const LEN: usize = 32 + 32 + 8 + 8 + 1 + 1; // 82
}

#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    if instruction_data.is_empty() {
        msg!("Error: empty instruction data");
        return Err(ProgramError::InvalidInstructionData);
    }

    match instruction_data[0] {
        0 => {
            msg!("Instruction: OpenChannel");
            process_open_channel(program_id, accounts, &instruction_data[1..])
        }
        1 => {
            msg!("Instruction: CloseChannel");
            process_close_channel(program_id, accounts, &instruction_data[1..])
        }
        _ => {
            msg!("Error: unknown instruction discriminant");
            Err(ProgramError::InvalidInstructionData)
        }
    }
}

/// OpenChannel — instruction payload (16 bytes after discriminant):
///   max_lamports: u64 le (8 bytes)
///   nonce:        [u8; 8]  (8 bytes)
///
/// Accounts:
///   0: payer          signer + writable
///   1: recipient      read-only
///   2: channel_pda    writable (to be created)
///   3: system_program
fn process_open_channel(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if data.len() < 16 {
        msg!("Error: OpenChannel payload too short (need 16 bytes, got {})", data.len());
        return Err(ProgramError::InvalidInstructionData);
    }

    let max_lamports = u64::from_le_bytes(data[0..8].try_into().unwrap());
    let nonce: [u8; 8] = data[8..16].try_into().unwrap();

    let account_info_iter = &mut accounts.iter();
    let payer = next_account_info(account_info_iter)?;
    let recipient = next_account_info(account_info_iter)?;
    let channel_pda = next_account_info(account_info_iter)?;
    let system_program = next_account_info(account_info_iter)?;

    if !payer.is_signer {
        msg!("Error: payer must be a signer");
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Derive PDA and verify it matches the provided channel_pda account
    let seeds: &[&[u8]] = &[
        b"stream-v1",
        payer.key.as_ref(),
        recipient.key.as_ref(),
        &nonce,
    ];
    let (derived_pda, bump) = Pubkey::find_program_address(seeds, program_id);

    if derived_pda != *channel_pda.key {
        msg!("Error: channel_pda mismatch — expected {}", derived_pda);
        return Err(ProgramError::InvalidArgument);
    }

    let rent = Rent::get()?;
    let rent_lamports = rent.minimum_balance(ChannelState::LEN);
    let total_lamports = max_lamports
        .checked_add(rent_lamports)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    let signer_seeds: &[&[&[u8]]] = &[&[
        b"stream-v1",
        payer.key.as_ref(),
        recipient.key.as_ref(),
        &nonce,
        &[bump],
    ]];

    invoke_signed(
        &system_instruction::create_account(
            payer.key,
            channel_pda.key,
            total_lamports,
            ChannelState::LEN as u64,
            program_id,
        ),
        &[payer.clone(), channel_pda.clone(), system_program.clone()],
        signer_seeds,
    )?;

    let state = ChannelState {
        payer: *payer.key,
        recipient: *recipient.key,
        max_lamports,
        nonce,
        is_open: true,
        bump,
    };

    let mut data_ref = channel_pda.try_borrow_mut_data()?;
    state.serialize(&mut &mut data_ref[..])?;

    msg!(
        "OpenChannel: pda={}, max_lamports={}, nonce={:?}",
        channel_pda.key,
        max_lamports,
        nonce
    );

    Ok(())
}

/// CloseChannel — instruction payload (16 bytes after discriminant):
///   seq:         u64 le (8 bytes)
///   accumulated: u64 le (8 bytes)
///
/// Accounts:
///   0: payer       writable (receives refund — does NOT need to be signer)
///   1: recipient   writable (receives accumulated)
///   2: channel_pda writable (drained)
///   3: system_program (unused but expected for consistency)
fn process_close_channel(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if data.len() < 16 {
        msg!("Error: CloseChannel payload too short (need 16 bytes, got {})", data.len());
        return Err(ProgramError::InvalidInstructionData);
    }

    let _seq = u64::from_le_bytes(data[0..8].try_into().unwrap());
    let accumulated = u64::from_le_bytes(data[8..16].try_into().unwrap());

    let account_info_iter = &mut accounts.iter();
    let payer = next_account_info(account_info_iter)?;
    let recipient = next_account_info(account_info_iter)?;
    let channel_pda = next_account_info(account_info_iter)?;
    let _system_program = next_account_info(account_info_iter)?;

    // Load and verify state
    let state: ChannelState = {
        let data_ref = channel_pda.try_borrow_data()?;
        ChannelState::try_from_slice(&data_ref)?
    };

    if !state.is_open {
        msg!("Error: channel is already closed");
        return Err(ProgramError::InvalidAccountData);
    }

    if accumulated > state.max_lamports {
        msg!(
            "Error: accumulated ({}) exceeds max_lamports ({})",
            accumulated,
            state.max_lamports
        );
        return Err(ProgramError::InvalidArgument);
    }

    // Verify payer and recipient match stored state
    if *payer.key != state.payer {
        msg!("Error: payer mismatch");
        return Err(ProgramError::InvalidArgument);
    }
    if *recipient.key != state.recipient {
        msg!("Error: recipient mismatch");
        return Err(ProgramError::InvalidArgument);
    }

    // Verify the channel_pda address itself
    let seeds: &[&[u8]] = &[
        b"stream-v1",
        state.payer.as_ref(),
        state.recipient.as_ref(),
        &state.nonce,
    ];
    let (derived_pda, _) = Pubkey::find_program_address(seeds, program_id);
    if derived_pda != *channel_pda.key {
        msg!("Error: channel_pda does not match stored state");
        return Err(ProgramError::InvalidArgument);
    }

    // Direct lamport manipulation — safe because program owns channel_pda
    **channel_pda.lamports.borrow_mut() -= accumulated;
    **recipient.lamports.borrow_mut() += accumulated;

    let remaining = **channel_pda.lamports.borrow();
    **channel_pda.lamports.borrow_mut() -= remaining;
    **payer.lamports.borrow_mut() += remaining;

    // Mark closed (zero out data)
    let mut data_ref = channel_pda.try_borrow_mut_data()?;
    data_ref.fill(0);

    msg!(
        "CloseChannel: accumulated={} → recipient={}, remaining={} → payer={}",
        accumulated,
        recipient.key,
        remaining,
        payer.key
    );

    Ok(())
}
