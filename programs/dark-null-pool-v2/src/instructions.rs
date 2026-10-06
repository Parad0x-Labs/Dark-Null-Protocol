//! Instruction data and account lists (V2_SPEC 8.3, 8.4): client-side builders and the zero-copy `transact` view.
//!
//! `transact` data is parsed in place (8.5 step 1: "SHOULD be read in place"; SBF frames are 4 KiB). Offsets and
//! lengths come from `dark_null_transcript::{ix, extdata}`; [`TransactView::check`] applies exactly the stateless
//! checks of `dark_null_transcript::ix::TransactIx::decode`, in the spec's order, with the program's error codes.
//! A property test checks that both agree on every input.

use crate::error::PoolError;
use dark_null_transcript::ds::discriminator;
use dark_null_transcript::extdata;
use dark_null_transcript::fr::{is_canonical, Fr32};
use dark_null_transcript::ix;
use dark_null_transcript::tree::ROOT_HISTORY;
use solana_program::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    system_program,
};

pub use discriminator::{INITIALIZE_POOL, REGISTER_MINT, SET_BETA_LIMITS, SET_PAUSED, TRANSACT};

/// `initialize_pool` data length: discriminator, `pool_nonce[32]`, `epoch_seconds: u64`.
pub const INITIALIZE_POOL_LEN: usize = 8 + 32 + 8;
/// `register_mint` data length: discriminator, `outflow_cap_per_epoch: u64`.
pub const REGISTER_MINT_LEN: usize = 8 + 8;
/// `set_beta_limits` data length.
pub const SET_BETA_LIMITS_LEN: usize = 8 + 8;
/// `set_paused` data length.
pub const SET_PAUSED_LEN: usize = 8 + 1;
/// `transact` data length (1,131).
pub const TRANSACT_LEN: usize = ix::LEN;
/// Number of `transact` accounts.
pub const TRANSACT_ACCOUNTS: usize = 13;

/// `ext_data` field offsets (V2_SPEC 7.3).
pub mod ext_off {
    pub const VERSION: usize = 0;
    pub const POOL_ID: usize = 1;
    pub const PUBLIC_TOKEN_ACCOUNT: usize = 33;
    pub const RELAYER_FEE_ACCOUNT: usize = 65;
    pub const RELAYER_FEE: usize = 97;
    pub const MEMO_BINDING: usize = 105;
    pub const STEALTH_EPHEMERAL: usize = 137;
    pub const CIPHERTEXT0: usize = 169;
    pub const CIPHERTEXT1: usize = 329;
    pub const CIPHERTEXT_REC: usize = 489;
}

/// Zero-copy view over `transact` instruction data (V2_SPEC 8.4 offsets).
#[derive(Clone, Copy)]
pub struct TransactView<'a> {
    d: &'a [u8],
}

fn arr<const N: usize>(d: &[u8], off: usize) -> &[u8; N] {
    // lengths are fixed by TRANSACT_LEN, checked in `check`
    d[off..off + N].try_into().expect("fixed offset")
}

impl<'a> TransactView<'a> {
    /// V2_SPEC 8.5 step 1 (after the pause check): length and discriminator (`E_BAD_IX`); canonical
    /// `root, nf0, nf1, cm0, cm1, assoc_root` (`E_NONCANONICAL_FIELD`); at most one public leg
    /// (`E_BAD_PUBLIC_AMOUNT`); `root_hint < 256` (`E_UNKNOWN_ROOT`); `nf0 != nf1` (`E_DUPLICATE_NULLIFIER`);
    /// `ext_data` version (`E_BAD_EXT_DATA`).
    pub fn check(d: &'a [u8]) -> Result<Self, PoolError> {
        if d.len() != TRANSACT_LEN || d[0..8] != TRANSACT {
            return Err(PoolError::BadIx);
        }
        let v = Self { d };
        for x in [v.root(), v.nf(0), v.nf(1), v.cm(0), v.cm(1), v.assoc_root()] {
            if !is_canonical(x) {
                return Err(PoolError::NonCanonicalField);
            }
        }
        if v.deposit_amount() != 0 && v.withdraw_amount() != 0 {
            return Err(PoolError::BadPublicAmount);
        }
        if v.root_hint() as usize >= ROOT_HISTORY {
            return Err(PoolError::UnknownRoot);
        }
        if v.nf(0) == v.nf(1) {
            return Err(PoolError::DuplicateNullifier);
        }
        if v.ext_data()[ext_off::VERSION] != extdata::VERSION {
            return Err(PoolError::BadExtData);
        }
        Ok(v)
    }

    pub fn proof_a_neg(&self) -> &'a [u8; 64] {
        arr(self.d, 8)
    }
    pub fn proof_b(&self) -> &'a [u8; 128] {
        arr(self.d, 72)
    }
    pub fn proof_c(&self) -> &'a [u8; 64] {
        arr(self.d, 200)
    }
    pub fn root(&self) -> &'a Fr32 {
        arr(self.d, 264)
    }
    pub fn nf(&self, i: usize) -> &'a Fr32 {
        arr(self.d, 296 + 32 * i)
    }
    pub fn cm(&self, i: usize) -> &'a Fr32 {
        arr(self.d, 360 + 32 * i)
    }
    pub fn deposit_amount(&self) -> u64 {
        u64::from_le_bytes(*arr(self.d, 424))
    }
    pub fn withdraw_amount(&self) -> u64 {
        u64::from_le_bytes(*arr(self.d, 432))
    }
    pub fn claimed_epoch(&self) -> u64 {
        u64::from_le_bytes(*arr(self.d, 440))
    }
    pub fn assoc_root(&self) -> &'a Fr32 {
        arr(self.d, 448)
    }
    pub fn root_hint(&self) -> u16 {
        u16::from_le_bytes(*arr(self.d, 480))
    }
    /// The 649 `ext_data` bytes exactly as received (the hash covers these bytes, scenario S3).
    pub fn ext_data(&self) -> &'a [u8; extdata::LEN] {
        arr(self.d, ix::EXT_DATA_OFFSET)
    }
    pub fn pool_id(&self) -> &'a [u8; 32] {
        arr(self.ext_data(), ext_off::POOL_ID)
    }
    pub fn public_token_account(&self) -> &'a [u8; 32] {
        arr(self.ext_data(), ext_off::PUBLIC_TOKEN_ACCOUNT)
    }
    pub fn relayer_fee_account(&self) -> &'a [u8; 32] {
        arr(self.ext_data(), ext_off::RELAYER_FEE_ACCOUNT)
    }
    pub fn relayer_fee(&self) -> u64 {
        u64::from_le_bytes(*arr(self.ext_data(), ext_off::RELAYER_FEE))
    }
}

/// The 13 `transact` accounts in V2_SPEC 8.4 order.
#[derive(Clone, Copy, Debug)]
pub struct TransactAccounts {
    pub submitter: Pubkey,
    pub pool_config: Pubkey,
    pub tree: Pubkey,
    pub vault: Pubkey,
    pub mint: Pubkey,
    pub public_token_account: Pubkey,
    pub relayer_fee_account: Pubkey,
    pub nf_record0: Pubkey,
    pub nf_record1: Pubkey,
    pub vault_authority: Pubkey,
    pub mint_state: Pubkey,
    pub token_program: Pubkey,
}

impl TransactAccounts {
    pub fn metas(&self) -> Vec<AccountMeta> {
        vec![
            AccountMeta::new(self.submitter, true),
            AccountMeta::new(self.pool_config, false),
            AccountMeta::new(self.tree, false),
            AccountMeta::new(self.vault, false),
            AccountMeta::new_readonly(self.mint, false),
            AccountMeta::new(self.public_token_account, false),
            AccountMeta::new(self.relayer_fee_account, false),
            AccountMeta::new(self.nf_record0, false),
            AccountMeta::new(self.nf_record1, false),
            AccountMeta::new_readonly(self.vault_authority, false),
            AccountMeta::new(self.mint_state, false),
            AccountMeta::new_readonly(self.token_program, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ]
    }
}

/// `transact` instruction from encoded data (`dark_null_transcript::ix::TransactIx::encode`).
pub fn transact(program_id: &Pubkey, accounts: &TransactAccounts, data: &[u8]) -> Instruction {
    Instruction { program_id: *program_id, accounts: accounts.metas(), data: data.to_vec() }
}

pub fn initialize_pool(program_id: &Pubkey, authority: &Pubkey, pool_config: &Pubkey, tree: &Pubkey, pool_nonce: &[u8; 32], epoch_seconds: u64) -> Instruction {
    let mut data = Vec::with_capacity(INITIALIZE_POOL_LEN);
    data.extend_from_slice(&INITIALIZE_POOL);
    data.extend_from_slice(pool_nonce);
    data.extend_from_slice(&epoch_seconds.to_le_bytes());
    Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new(*authority, true),
            AccountMeta::new(*pool_config, false),
            AccountMeta::new(*tree, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

#[allow(clippy::too_many_arguments)]
pub fn register_mint(
    program_id: &Pubkey,
    authority: &Pubkey,
    pool_config: &Pubkey,
    mint: &Pubkey,
    mint_state: &Pubkey,
    vault: &Pubkey,
    vault_authority: &Pubkey,
    token_program: &Pubkey,
    outflow_cap_per_epoch: u64,
) -> Instruction {
    let mut data = Vec::with_capacity(REGISTER_MINT_LEN);
    data.extend_from_slice(&REGISTER_MINT);
    data.extend_from_slice(&outflow_cap_per_epoch.to_le_bytes());
    Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new(*authority, true),
            AccountMeta::new_readonly(*pool_config, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(*mint_state, false),
            AccountMeta::new(*vault, false),
            AccountMeta::new_readonly(*vault_authority, false),
            AccountMeta::new_readonly(*token_program, false),
            AccountMeta::new_readonly(system_program::id(), false),
        ],
        data,
    }
}

pub fn set_beta_limits(program_id: &Pubkey, authority: &Pubkey, pool_config: &Pubkey, mint_state: &Pubkey, outflow_cap_per_epoch: u64) -> Instruction {
    let mut data = Vec::with_capacity(SET_BETA_LIMITS_LEN);
    data.extend_from_slice(&SET_BETA_LIMITS);
    data.extend_from_slice(&outflow_cap_per_epoch.to_le_bytes());
    Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new_readonly(*authority, true),
            AccountMeta::new_readonly(*pool_config, false),
            AccountMeta::new(*mint_state, false),
        ],
        data,
    }
}

pub fn set_paused(program_id: &Pubkey, authority: &Pubkey, pool_config: &Pubkey, paused: u8) -> Instruction {
    let mut data = Vec::with_capacity(SET_PAUSED_LEN);
    data.extend_from_slice(&SET_PAUSED);
    data.push(paused);
    Instruction {
        program_id: *program_id,
        accounts: vec![AccountMeta::new_readonly(*authority, true), AccountMeta::new(*pool_config, false)],
        data,
    }
}
