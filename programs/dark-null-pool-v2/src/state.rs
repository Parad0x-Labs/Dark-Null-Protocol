//! Account layouts (V2_SPEC 8.1): `repr(C)` little-endian, read and written in place. Program-owned accounts start
//! with `SHA256("account:<Name>")[0..8]`.

use crate::error::PoolError;
use dark_null_transcript::fr::Fr32;
use dark_null_transcript::tree::{DEPTH, ROOT_HISTORY, ZEROS};
use solana_program::{account_info::AccountInfo, pubkey::Pubkey};

pub const ACCOUNT_VERSION: u8 = 1;

pub fn rd_u64(d: &[u8], off: usize) -> u64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&d[off..off + 8]);
    u64::from_le_bytes(b)
}

pub fn wr_u64(d: &mut [u8], off: usize, v: u64) {
    d[off..off + 8].copy_from_slice(&v.to_le_bytes());
}

pub fn rd_u16(d: &[u8], off: usize) -> u16 {
    u16::from_le_bytes([d[off], d[off + 1]])
}

pub fn rd32(d: &[u8], off: usize) -> [u8; 32] {
    let mut b = [0u8; 32];
    b.copy_from_slice(&d[off..off + 32]);
    b
}

/// `PoolConfig`, 256 bytes, `["dark-null-pool", pool_nonce]`.
pub mod pool_config {
    pub const LEN: usize = 256;
    /// `SHA256("account:PoolConfig")[0..8]`
    pub const DISC: [u8; 8] = [0x1a, 0x6c, 0x0e, 0x7b, 0x74, 0xe6, 0x81, 0x2b];
    pub const VERSION: usize = 8;
    pub const BUMP: usize = 9;
    pub const PAUSED: usize = 10;
    pub const FLAGS: usize = 11;
    /// Canonical bump of the vault authority PDA (spec change: was padding).
    pub const VAULT_AUTH_BUMP: usize = 12;
    pub const AUTHORITY: usize = 16;
    pub const POOL_NONCE: usize = 48;
    pub const POOL_ID: usize = 80;
    pub const VK_HASH: usize = 112;
    pub const EPOCH_SECONDS: usize = 144;
    pub const DEPOSIT_COUNTER: usize = 152;
    pub const TREE: usize = 160;
    pub const RESERVED: usize = 192;
}

/// `Tree`, 9,248 bytes, `["dark-null-tree", pool_config]`.
pub mod tree {
    pub const LEN: usize = 9_248;
    /// `SHA256("account:Tree")[0..8]`
    pub const DISC: [u8; 8] = [0x64, 0x09, 0xd5, 0x9a, 0x06, 0x88, 0x6d, 0x37];
    pub const VERSION: usize = 8;
    pub const BUMP: usize = 9;
    pub const NEXT_INDEX: usize = 16;
    pub const ROOT_HEAD: usize = 24;
    /// `filled[32][32]`, index 0 unused.
    pub const FILLED: usize = 32;
    /// `roots[256][32]`
    pub const ROOTS: usize = 1_056;
}

/// `MintState`, 192 bytes, `["dark-null-mint", pool_config, mint]`.
pub mod mint_state {
    pub const LEN: usize = 192;
    /// `SHA256("account:MintState")[0..8]`
    pub const DISC: [u8; 8] = [0x51, 0x11, 0x8f, 0x78, 0x17, 0x39, 0x16, 0x75];
    pub const VERSION: usize = 8;
    pub const BUMP: usize = 9;
    pub const VAULT_BUMP: usize = 10;
    pub const TOKEN_PROGRAM_KIND: usize = 11;
    pub const DECIMALS: usize = 12;
    pub const FREEZE_AUTHORITY_PRESENT: usize = 13;
    pub const MINT: usize = 16;
    pub const VAULT: usize = 48;
    pub const ASSET: usize = 80;
    pub const SUPPLY: usize = 112;
    pub const OUTFLOW_CAP_PER_EPOCH: usize = 120;
    pub const OUTFLOW_EPOCH: usize = 128;
    pub const OUTFLOW_IN_EPOCH: usize = 136;
    pub const RESERVED: usize = 144;
}

/// Pool config fields used by the instructions (copied out of the account).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PoolConfig {
    pub bump: u8,
    pub paused: u8,
    pub flags: u8,
    pub vault_auth_bump: u8,
    pub authority: Pubkey,
    pub pool_nonce: [u8; 32],
    pub pool_id: [u8; 32],
    pub vk_hash: [u8; 32],
    pub epoch_seconds: u64,
    pub deposit_counter: u64,
    pub tree: Pubkey,
}

impl PoolConfig {
    pub fn read(d: &[u8]) -> Self {
        use pool_config::*;
        Self {
            bump: d[BUMP],
            paused: d[PAUSED],
            flags: d[FLAGS],
            vault_auth_bump: d[VAULT_AUTH_BUMP],
            authority: Pubkey::new_from_array(rd32(d, AUTHORITY)),
            pool_nonce: rd32(d, POOL_NONCE),
            pool_id: rd32(d, POOL_ID),
            vk_hash: rd32(d, VK_HASH),
            epoch_seconds: rd_u64(d, EPOCH_SECONDS),
            deposit_counter: rd_u64(d, DEPOSIT_COUNTER),
            tree: Pubkey::new_from_array(rd32(d, TREE)),
        }
    }

    pub fn write_new(&self, d: &mut [u8]) {
        use pool_config::*;
        d[..LEN].fill(0);
        d[0..8].copy_from_slice(&DISC);
        d[pool_config::VERSION] = ACCOUNT_VERSION;
        d[BUMP] = self.bump;
        d[PAUSED] = self.paused;
        d[FLAGS] = self.flags;
        d[VAULT_AUTH_BUMP] = self.vault_auth_bump;
        d[AUTHORITY..AUTHORITY + 32].copy_from_slice(self.authority.as_ref());
        d[POOL_NONCE..POOL_NONCE + 32].copy_from_slice(&self.pool_nonce);
        d[POOL_ID..POOL_ID + 32].copy_from_slice(&self.pool_id);
        d[VK_HASH..VK_HASH + 32].copy_from_slice(&self.vk_hash);
        wr_u64(d, EPOCH_SECONDS, self.epoch_seconds);
        wr_u64(d, DEPOSIT_COUNTER, self.deposit_counter);
        d[TREE..TREE + 32].copy_from_slice(self.tree.as_ref());
    }

    /// Load a pool config account: owner = program, exact length, discriminator, version, and the address is the PDA
    /// `["dark-null-pool", pool_nonce, bump]` with the stored nonce and bump.
    pub fn load(ai: &AccountInfo, program_id: &Pubkey) -> Result<Self, PoolError> {
        if ai.owner != program_id {
            return Err(PoolError::AccountMismatch);
        }
        let pc = {
            let d = ai.try_borrow_data().map_err(|_| PoolError::AccountMismatch)?;
            if d.len() != pool_config::LEN || d[0..8] != pool_config::DISC || d[pool_config::VERSION] != ACCOUNT_VERSION {
                return Err(PoolError::AccountMismatch);
            }
            Self::read(&d)
        };
        let expect = Pubkey::create_program_address(&[dark_null_transcript::pool::SEED_POOL, &pc.pool_nonce, &[pc.bump]], program_id)
            .map_err(|_| PoolError::AccountMismatch)?;
        if expect != *ai.key {
            return Err(PoolError::AccountMismatch);
        }
        Ok(pc)
    }
}

/// Mint state fields (copied out of the account).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MintState {
    pub bump: u8,
    pub vault_bump: u8,
    pub token_program_kind: u8,
    pub decimals: u8,
    pub freeze_authority_present: u8,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub asset: Fr32,
    pub supply: u64,
    pub outflow_cap_per_epoch: u64,
    pub outflow_epoch: u64,
    pub outflow_in_epoch: u64,
}

impl MintState {
    pub fn read(d: &[u8]) -> Self {
        use mint_state::*;
        Self {
            bump: d[BUMP],
            vault_bump: d[VAULT_BUMP],
            token_program_kind: d[TOKEN_PROGRAM_KIND],
            decimals: d[DECIMALS],
            freeze_authority_present: d[FREEZE_AUTHORITY_PRESENT],
            mint: Pubkey::new_from_array(rd32(d, MINT)),
            vault: Pubkey::new_from_array(rd32(d, VAULT)),
            asset: rd32(d, ASSET),
            supply: rd_u64(d, SUPPLY),
            outflow_cap_per_epoch: rd_u64(d, OUTFLOW_CAP_PER_EPOCH),
            outflow_epoch: rd_u64(d, OUTFLOW_EPOCH),
            outflow_in_epoch: rd_u64(d, OUTFLOW_IN_EPOCH),
        }
    }

    pub fn write_new(&self, d: &mut [u8]) {
        use mint_state::*;
        d[..LEN].fill(0);
        d[0..8].copy_from_slice(&DISC);
        d[mint_state::VERSION] = ACCOUNT_VERSION;
        d[BUMP] = self.bump;
        d[VAULT_BUMP] = self.vault_bump;
        d[TOKEN_PROGRAM_KIND] = self.token_program_kind;
        d[DECIMALS] = self.decimals;
        d[FREEZE_AUTHORITY_PRESENT] = self.freeze_authority_present;
        d[MINT..MINT + 32].copy_from_slice(self.mint.as_ref());
        d[VAULT..VAULT + 32].copy_from_slice(self.vault.as_ref());
        d[ASSET..ASSET + 32].copy_from_slice(&self.asset);
        self.write_counters(d);
    }

    /// Write the mutable fields (supply and outflow window).
    pub fn write_counters(&self, d: &mut [u8]) {
        use mint_state::*;
        wr_u64(d, SUPPLY, self.supply);
        wr_u64(d, OUTFLOW_CAP_PER_EPOCH, self.outflow_cap_per_epoch);
        wr_u64(d, OUTFLOW_EPOCH, self.outflow_epoch);
        wr_u64(d, OUTFLOW_IN_EPOCH, self.outflow_in_epoch);
    }

    /// Load a mint state account of `pool_config`: owner = program, length, discriminator, version, and the address
    /// is the PDA `["dark-null-mint", pool_config, mint, bump]` (the layout has no pool field, so the address is
    /// what ties a mint state to its pool).
    pub fn load(ai: &AccountInfo, program_id: &Pubkey, pool_config: &Pubkey) -> Result<Self, PoolError> {
        if ai.owner != program_id {
            return Err(PoolError::AccountMismatch);
        }
        let ms = {
            let d = ai.try_borrow_data().map_err(|_| PoolError::AccountMismatch)?;
            if d.len() != mint_state::LEN || d[0..8] != mint_state::DISC || d[mint_state::VERSION] != ACCOUNT_VERSION {
                return Err(PoolError::AccountMismatch);
            }
            Self::read(&d)
        };
        let expect = Pubkey::create_program_address(
            &[dark_null_transcript::pool::SEED_MINT, pool_config.as_ref(), ms.mint.as_ref(), &[ms.bump]],
            program_id,
        )
        .map_err(|_| PoolError::AccountMismatch)?;
        if expect != *ai.key {
            return Err(PoolError::AccountMismatch);
        }
        Ok(ms)
    }
}

/// Initialize a tree account: `roots[0] = ZEROS[32]`, everything else zero.
pub fn tree_init(d: &mut [u8], bump: u8) {
    d[..tree::LEN].fill(0);
    d[0..8].copy_from_slice(&tree::DISC);
    d[tree::VERSION] = ACCOUNT_VERSION;
    d[tree::BUMP] = bump;
    d[tree::ROOTS..tree::ROOTS + 32].copy_from_slice(&ZEROS[DEPTH]);
}

/// Check a tree account's layout (owner is checked by the caller).
pub fn tree_check(d: &[u8]) -> Result<(), PoolError> {
    if d.len() != tree::LEN || d[0..8] != tree::DISC || d[tree::VERSION] != ACCOUNT_VERSION {
        return Err(PoolError::AccountMismatch);
    }
    Ok(())
}

/// Root history lookup (6.3): accept iff `root != 0` and `roots[hint] == root`.
pub fn tree_root_known(d: &[u8], hint: u16, root: &Fr32) -> bool {
    let h = hint as usize;
    if h >= ROOT_HISTORY || *root == [0u8; 32] {
        return false;
    }
    let off = tree::ROOTS + 32 * h;
    d[off..off + 32] == root[..]
}

/// Insert `cm0, cm1` with `dark_null_transcript::tree::insert_pair` (6.2), push the new root into the ring and
/// advance `next_index`. Returns `(leaf_index_of_cm0, new_root_head, new_root)`.
pub fn tree_insert<H: dark_null_transcript::hash::PoseidonHasher>(
    h: &H,
    d: &mut [u8],
    cm0: &Fr32,
    cm1: &Fr32,
) -> Result<(u64, u16, Fr32), dark_null_transcript::Error> {
    let next_index = rd_u64(d, tree::NEXT_INDEX);
    let mut filled = [[0u8; 32]; DEPTH];
    for (i, f) in filled.iter_mut().enumerate() {
        let off = tree::FILLED + 32 * i;
        f.copy_from_slice(&d[off..off + 32]);
    }
    let root = dark_null_transcript::tree::insert_pair(h, &mut filled, next_index, cm0, cm1)?;
    for (i, f) in filled.iter().enumerate() {
        let off = tree::FILLED + 32 * i;
        d[off..off + 32].copy_from_slice(f);
    }
    let head = ((rd_u16(d, tree::ROOT_HEAD) as usize + 1) % ROOT_HISTORY) as u16;
    d[tree::ROOT_HEAD..tree::ROOT_HEAD + 2].copy_from_slice(&head.to_le_bytes());
    let off = tree::ROOTS + 32 * head as usize;
    d[off..off + 32].copy_from_slice(&root);
    // insert_pair rejects next_index > 2^32 - 2, so this cannot overflow
    wr_u64(d, tree::NEXT_INDEX, next_index + 2);
    Ok((next_index, head, root))
}
