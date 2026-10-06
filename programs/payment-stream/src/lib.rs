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

solana_program::declare_id!("J6oHoysM1RGs3yZPXBp9ZUgdYgGQWZf2wKisS1tJQdaQ");

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
///   0: payer       writable (receives refund)
///   1: recipient   writable (receives accumulated)
///   2: channel_pda writable (drained)
///   3: system_program (unused but expected for consistency)
///
/// Authorization (audit C3): at least one of payer/recipient MUST be a signer.
/// If the recipient does not co-sign, the payer cannot be trusted to report the
/// true accumulated amount, so the channel settles at full max_lamports (the
/// PDA was pre-funded with exactly that).
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
    let claimed_accumulated = u64::from_le_bytes(data[8..16].try_into().unwrap());

    let account_info_iter = &mut accounts.iter();
    let payer = next_account_info(account_info_iter)?;
    let recipient = next_account_info(account_info_iter)?;
    let channel_pda = next_account_info(account_info_iter)?;
    let _system_program = next_account_info(account_info_iter)?;

    if !payer.is_signer && !recipient.is_signer {
        msg!("Error: close requires the payer or recipient signature");
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Load and verify state
    let state: ChannelState = {
        let data_ref = channel_pda.try_borrow_data()?;
        ChannelState::try_from_slice(&data_ref)?
    };

    if !state.is_open {
        msg!("Error: channel is already closed");
        return Err(ProgramError::InvalidAccountData);
    }

    // Without the recipient's signature the claimed amount is untrusted —
    // settle conservatively at the full funded cap.
    let accumulated = if recipient.is_signer {
        claimed_accumulated
    } else {
        state.max_lamports
    };

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

    let channel_lamports = channel_pda.lamports();
    let remaining = channel_lamports
        .checked_sub(accumulated)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    // Direct lamport manipulation — safe because program owns channel_pda.
    // Each balance is read into a local before its RefCell is borrowed mutably:
    // `**x.lamports.borrow_mut() = x.lamports.borrow() + ..` holds a mutable and an
    // immutable borrow of the same RefCell at once and panics ("already borrowed"),
    // which made every CloseChannel fail. Reads happen after the previous write so
    // the arithmetic stays correct even if two account slots alias one account.
    **channel_pda.try_borrow_mut_lamports()? = 0; // accumulated + remaining == channel_lamports

    let recipient_balance = recipient
        .lamports()
        .checked_add(accumulated)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    **recipient.try_borrow_mut_lamports()? = recipient_balance;

    let payer_balance = payer
        .lamports()
        .checked_add(remaining)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    **payer.try_borrow_mut_lamports()? = payer_balance;

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

#[cfg(test)]
mod tests {
    use super::*;

    const RENT: u64 = 1_461_600;
    const MAX: u64 = 5_000_000;

    struct Accs {
        program_id: Pubkey,
        payer: Pubkey,
        recipient: Pubkey,
        channel: Pubkey,
        sys: Pubkey,
        data: Vec<u8>,
    }

    fn setup() -> Accs {
        let program_id = Pubkey::new_unique();
        let payer = Pubkey::new_unique();
        let recipient = Pubkey::new_unique();
        let nonce = [7u8; 8];
        let (channel, bump) = Pubkey::find_program_address(
            &[b"stream-v1", payer.as_ref(), recipient.as_ref(), &nonce],
            &program_id,
        );
        let state = ChannelState { payer, recipient, max_lamports: MAX, nonce, is_open: true, bump };
        let data = borsh::to_vec(&state).unwrap();
        assert_eq!(data.len(), ChannelState::LEN);
        Accs { program_id, payer, recipient, channel, sys: Pubkey::default(), data }
    }

    fn close_ix(seq: u64, accumulated: u64) -> Vec<u8> {
        let mut d = vec![1u8];
        d.extend_from_slice(&seq.to_le_bytes());
        d.extend_from_slice(&accumulated.to_le_bytes());
        d
    }

    /// Runs CloseChannel and returns (payer, recipient, channel) balances after.
    fn run_close(a: &mut Accs, payer_signs: bool, recipient_signs: bool, accumulated: u64) -> (ProgramResult, u64, u64, u64) {
        let (mut pl, mut rl, mut cl, mut sl) = (10_000_000u64, 3_000_000u64, MAX + RENT, 1u64);
        let (mut pd, mut rd, mut sd): (Vec<u8>, Vec<u8>, Vec<u8>) = (vec![], vec![], vec![]);
        let sys_owner = Pubkey::default();
        let accounts = vec![
            AccountInfo::new(&a.payer, payer_signs, true, &mut pl, &mut pd, &sys_owner, false, 0),
            AccountInfo::new(&a.recipient, recipient_signs, true, &mut rl, &mut rd, &sys_owner, false, 0),
            AccountInfo::new(&a.channel, false, true, &mut cl, &mut a.data, &a.program_id, false, 0),
            AccountInfo::new(&a.sys, false, false, &mut sl, &mut sd, &sys_owner, true, 0),
        ];
        let res = process_instruction(&a.program_id, &accounts, &close_ix(1, accumulated));
        let out = (accounts[0].lamports(), accounts[1].lamports(), accounts[2].lamports());
        (res, out.0, out.1, out.2)
    }

    #[test]
    fn close_with_recipient_signature_pays_accumulated_and_refunds_rest() {
        let mut a = setup();
        let (res, p, r, c) = run_close(&mut a, true, true, 1_250_000);
        res.expect("close must not fail (previously panicked: RefCell already borrowed)");
        assert_eq!(r, 3_000_000 + 1_250_000);
        assert_eq!(p, 10_000_000 + (MAX + RENT - 1_250_000));
        assert_eq!(c, 0);
        assert!(a.data.iter().all(|b| *b == 0), "channel data zeroed");
    }

    #[test]
    fn close_by_payer_alone_settles_at_full_cap() {
        let mut a = setup();
        let (res, p, r, c) = run_close(&mut a, true, false, 1);
        res.expect("payer-only close");
        assert_eq!(r, 3_000_000 + MAX);
        assert_eq!(p, 10_000_000 + RENT);
        assert_eq!(c, 0);
    }

    #[test]
    fn lamports_are_conserved() {
        let mut a = setup();
        let before = 10_000_000 + 3_000_000 + MAX + RENT;
        let (res, p, r, c) = run_close(&mut a, false, true, MAX);
        res.unwrap();
        assert_eq!(p + r + c, before);
    }

    #[test]
    fn close_without_any_signature_is_rejected() {
        let mut a = setup();
        let (res, p, r, c) = run_close(&mut a, false, false, 0);
        assert_eq!(res, Err(ProgramError::MissingRequiredSignature));
        assert_eq!((p, r, c), (10_000_000, 3_000_000, MAX + RENT));
    }

    #[test]
    fn over_cap_accumulated_is_rejected() {
        let mut a = setup();
        let (res, _, _, c) = run_close(&mut a, true, true, MAX + 1);
        assert_eq!(res, Err(ProgramError::InvalidArgument));
        assert_eq!(c, MAX + RENT);
    }
}
