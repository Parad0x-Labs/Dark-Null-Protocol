//! Pool identity (V2_SPEC 8.2). Binds proofs to one pool through `ext_data.pool_id`.

use crate::ds::TAG_POOL_ID;
use crate::fr::{h248, Fr32};
use crate::hash::Sha256Hasher;

/// PDA seed prefix of the pool config account: `["dark-null-pool", pool_nonce]`.
pub const SEED_POOL: &[u8] = b"dark-null-pool";
/// `["dark-null-tree", pool_config]`
pub const SEED_TREE: &[u8] = b"dark-null-tree";
/// `["dark-null-mint", pool_config, mint]`
pub const SEED_MINT: &[u8] = b"dark-null-mint";
/// `["dark-null-vault", pool_config, mint]`
pub const SEED_VAULT: &[u8] = b"dark-null-vault";
/// `["dark-null-vault-auth", pool_config]`
pub const SEED_VAULT_AUTH: &[u8] = b"dark-null-vault-auth";
/// `["dark-null-nf", pool_config, nf_be32]`
pub const SEED_NF: &[u8] = b"dark-null-nf";

/// `pool_id = SHA256("dark-null-pool-id-v1" || program_id || pool_config)`.
pub fn pool_id<S: Sha256Hasher>(s: &S, program_id: &[u8; 32], pool_config: &[u8; 32]) -> [u8; 32] {
    s.sha256(&[TAG_POOL_ID, program_id, pool_config])
}

/// Field form used inside Poseidon (`deposit_label`): first 31 bytes, big-endian.
pub fn pool_id_fr(pool_id: &[u8; 32]) -> Fr32 {
    h248(pool_id)
}
