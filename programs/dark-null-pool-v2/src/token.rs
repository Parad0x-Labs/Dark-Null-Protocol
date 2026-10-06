//! SPL Token and Token-2022 support without the token crates: account and mint parsing, the Token-2022 mint
//! extension allowlist (V2_SPEC 8.7), and the four instructions the program issues by CPI.
//!
//! Extension type numbers are those of `spl_token_2022::extension::ExtensionType` (append-only enum; values 0-27 as
//! of spl-token-2022 8.x). Any other value, including types added later, is rejected: an allowlist keeps future
//! extension types out by default.

use crate::error::PoolError;
use solana_program::{
    instruction::{AccountMeta, Instruction},
    pubkey,
    pubkey::Pubkey,
};

pub const SPL_TOKEN_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const TOKEN_2022_ID: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/// `MintState.token_program_kind`
pub const KIND_SPL_TOKEN: u8 = 0;
pub const KIND_TOKEN_2022: u8 = 1;

/// Base layouts (`spl_token::state`).
pub const MINT_LEN: usize = 82;
pub const ACCOUNT_LEN: usize = 165;
/// Token-2022 `AccountType` byte after the 165-byte base (mints are padded to it).
pub const ACCOUNT_TYPE_OFFSET: usize = 165;
pub const ACCOUNT_TYPE_MINT: u8 = 1;
pub const ACCOUNT_TYPE_ACCOUNT: u8 = 2;
/// Token-2022 vault: 165 + AccountType + ImmutableOwner TLV header (type, length 0).
pub const VAULT_LEN_2022: usize = ACCOUNT_LEN + 1 + 4;

/// Token-2022 `ExtensionType` values used below.
pub mod ext {
    pub const UNINITIALIZED: u16 = 0;
    pub const TRANSFER_FEE_CONFIG: u16 = 1;
    pub const TRANSFER_FEE_AMOUNT: u16 = 2;
    pub const MINT_CLOSE_AUTHORITY: u16 = 3;
    pub const CONFIDENTIAL_TRANSFER_MINT: u16 = 4;
    pub const CONFIDENTIAL_TRANSFER_ACCOUNT: u16 = 5;
    pub const DEFAULT_ACCOUNT_STATE: u16 = 6;
    pub const IMMUTABLE_OWNER: u16 = 7;
    pub const MEMO_TRANSFER: u16 = 8;
    pub const NON_TRANSFERABLE: u16 = 9;
    pub const INTEREST_BEARING_CONFIG: u16 = 10;
    pub const CPI_GUARD: u16 = 11;
    pub const PERMANENT_DELEGATE: u16 = 12;
    pub const NON_TRANSFERABLE_ACCOUNT: u16 = 13;
    pub const TRANSFER_HOOK: u16 = 14;
    pub const TRANSFER_HOOK_ACCOUNT: u16 = 15;
    pub const CONFIDENTIAL_TRANSFER_FEE_CONFIG: u16 = 16;
    pub const CONFIDENTIAL_TRANSFER_FEE_AMOUNT: u16 = 17;
    pub const METADATA_POINTER: u16 = 18;
    pub const TOKEN_METADATA: u16 = 19;
    pub const GROUP_POINTER: u16 = 20;
    pub const TOKEN_GROUP: u16 = 21;
    pub const GROUP_MEMBER_POINTER: u16 = 22;
    pub const TOKEN_GROUP_MEMBER: u16 = 23;
    pub const CONFIDENTIAL_MINT_BURN: u16 = 24;
    pub const SCALED_UI_AMOUNT: u16 = 25;
    pub const PAUSABLE: u16 = 26;
    pub const PAUSABLE_ACCOUNT: u16 = 27;
}

/// `DefaultAccountState` value `AccountState::Initialized`.
pub const ACCOUNT_STATE_INITIALIZED: u8 = 1;

/// The V2_SPEC 8.7 allowlist. `value` is the extension's TLV value.
pub fn extension_allowed(ext_type: u16, value: &[u8]) -> bool {
    use ext::*;
    match ext_type {
        METADATA_POINTER | TOKEN_METADATA | GROUP_POINTER | TOKEN_GROUP | GROUP_MEMBER_POINTER | TOKEN_GROUP_MEMBER => true,
        INTEREST_BEARING_CONFIG | SCALED_UI_AMOUNT => true,
        DEFAULT_ACCOUNT_STATE => value.len() == 1 && value[0] == ACCOUNT_STATE_INITIALIZED,
        _ => false,
    }
}

/// Mint facts recorded in `MintState`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MintInfo {
    pub decimals: u8,
    pub freeze_authority_present: bool,
}

/// Check a mint account's data for `register_mint` (8.7).
///
/// - SPL Token: exactly the 82-byte base, initialized.
/// - Token-2022: the 82-byte base alone, or base + zero padding to 165 + `AccountType::Mint` + TLV entries, each
///   of which must be in the allowlist. TLV parsing follows `spl_token_2022::extension::get_tlv_data_info`: it stops
///   at an `Uninitialized` type or when fewer than 2 bytes remain; a truncated header or value is malformed.
pub fn check_mint(data: &[u8], kind: u8) -> Result<MintInfo, PoolError> {
    if data.len() < MINT_LEN {
        return Err(PoolError::AccountMismatch);
    }
    // is_initialized
    if data[45] != 1 {
        return Err(PoolError::AccountMismatch);
    }
    let freeze_tag = u32::from_le_bytes([data[46], data[47], data[48], data[49]]);
    let info = MintInfo { decimals: data[44], freeze_authority_present: freeze_tag == 1 };
    if kind == KIND_SPL_TOKEN {
        return if data.len() == MINT_LEN { Ok(info) } else { Err(PoolError::AccountMismatch) };
    }
    if data.len() == MINT_LEN {
        return Ok(info);
    }
    if data.len() <= ACCOUNT_LEN || data[ACCOUNT_TYPE_OFFSET] != ACCOUNT_TYPE_MINT || data[MINT_LEN..ACCOUNT_LEN].iter().any(|b| *b != 0) {
        return Err(PoolError::MintExtensionRejected);
    }
    let tlv = &data[ACCOUNT_TYPE_OFFSET + 1..];
    let mut i = 0usize;
    while i < tlv.len() {
        if tlv.len() - i < 2 {
            break;
        }
        let t = u16::from_le_bytes([tlv[i], tlv[i + 1]]);
        if t == ext::UNINITIALIZED {
            break;
        }
        if tlv.len() - i < 4 {
            return Err(PoolError::MintExtensionRejected);
        }
        let len = u16::from_le_bytes([tlv[i + 2], tlv[i + 3]]) as usize;
        let v0 = i + 4;
        if tlv.len() - v0 < len {
            return Err(PoolError::MintExtensionRejected);
        }
        if !extension_allowed(t, &tlv[v0..v0 + len]) {
            return Err(PoolError::MintExtensionRejected);
        }
        i = v0 + len;
    }
    Ok(info)
}

/// The fields of a token account the program reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TokenAccount {
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub state: u8,
}

/// Parse a token account of the given program kind: SPL Token is exactly 165 bytes; Token-2022 is 165 bytes or
/// longer with `AccountType::Account` at offset 165. `None` if the data is not a token account.
pub fn parse_token_account(data: &[u8], kind: u8) -> Option<TokenAccount> {
    let ok = match kind {
        KIND_SPL_TOKEN => data.len() == ACCOUNT_LEN,
        KIND_TOKEN_2022 => data.len() == ACCOUNT_LEN || (data.len() > ACCOUNT_LEN && data[ACCOUNT_TYPE_OFFSET] == ACCOUNT_TYPE_ACCOUNT),
        _ => false,
    };
    if !ok {
        return None;
    }
    let mut amount = [0u8; 8];
    amount.copy_from_slice(&data[64..72]);
    Some(TokenAccount {
        mint: Pubkey::new_from_array(crate::state::rd32(data, 0)),
        owner: Pubkey::new_from_array(crate::state::rd32(data, 32)),
        amount: u64::from_le_bytes(amount),
        state: data[108],
    })
}

/// Token account `amount` (offset 64) without other checks; used on the vault, which the program created.
pub fn amount_of(data: &[u8]) -> u64 {
    crate::state::rd_u64(data, 64)
}

/// `TransferChecked` (instruction 12): source, mint, destination, authority (signer).
pub fn transfer_checked(token_program: &Pubkey, source: &Pubkey, mint: &Pubkey, dest: &Pubkey, authority: &Pubkey, amount: u64, decimals: u8) -> Instruction {
    let mut data = Vec::with_capacity(10);
    data.push(12u8);
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(decimals);
    Instruction {
        program_id: *token_program,
        accounts: vec![
            AccountMeta::new(*source, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(*dest, false),
            AccountMeta::new_readonly(*authority, true),
        ],
        data,
    }
}

/// `InitializeAccount3` (instruction 18): account, mint; owner in data.
pub fn initialize_account3(token_program: &Pubkey, account: &Pubkey, mint: &Pubkey, owner: &Pubkey) -> Instruction {
    let mut data = Vec::with_capacity(33);
    data.push(18u8);
    data.extend_from_slice(owner.as_ref());
    Instruction {
        program_id: *token_program,
        accounts: vec![AccountMeta::new(*account, false), AccountMeta::new_readonly(*mint, false)],
        data,
    }
}

/// Token-2022 `InitializeImmutableOwner` (instruction 22): account.
pub fn initialize_immutable_owner(account: &Pubkey) -> Instruction {
    Instruction { program_id: TOKEN_2022_ID, accounts: vec![AccountMeta::new(*account, false)], data: vec![22u8] }
}
