//! PDA derivations (V2_SPEC 3.3). Every PDA uses the canonical bump. Seeds come from `dark_null_transcript::pool`.

use dark_null_transcript::pool::{SEED_MINT, SEED_NF, SEED_POOL, SEED_TREE, SEED_VAULT, SEED_VAULT_AUTH};
use solana_program::pubkey::Pubkey;

pub fn pool_config(program_id: &Pubkey, pool_nonce: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SEED_POOL, pool_nonce], program_id)
}

pub fn tree(program_id: &Pubkey, pool_config: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SEED_TREE, pool_config.as_ref()], program_id)
}

pub fn mint_state(program_id: &Pubkey, pool_config: &Pubkey, mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SEED_MINT, pool_config.as_ref(), mint.as_ref()], program_id)
}

pub fn vault(program_id: &Pubkey, pool_config: &Pubkey, mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SEED_VAULT, pool_config.as_ref(), mint.as_ref()], program_id)
}

pub fn vault_authority(program_id: &Pubkey, pool_config: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SEED_VAULT_AUTH, pool_config.as_ref()], program_id)
}

/// Canonical nullifier record `["dark-null-nf", pool_config, BE32(nf)]` (8.6, finding F-BUMP).
pub fn nullifier(program_id: &Pubkey, pool_config: &Pubkey, nf: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SEED_NF, pool_config.as_ref(), nf], program_id)
}
