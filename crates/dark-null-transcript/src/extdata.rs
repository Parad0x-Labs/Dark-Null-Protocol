//! `ext_data`: the fixed 649-byte record bound into the proof by `ext_data_hash` (V2_SPEC 7.3).
//!
//! | offset | len | field |
//! |---|---|---|
//! | 0 | 1 | version = 0x01 |
//! | 1 | 32 | pool_id |
//! | 33 | 32 | public_token_account |
//! | 65 | 32 | relayer_fee_account |
//! | 97 | 8 | relayer_fee (u64 LE) |
//! | 105 | 32 | memo_binding |
//! | 137 | 32 | stealth_ephemeral |
//! | 169 | 160 | ciphertext0 |
//! | 329 | 160 | ciphertext1 |
//! | 489 | 160 | ciphertext_rec |

use crate::ds::TAG_EXTDATA;
use crate::error::Error;
use crate::fr::{h248, Fr32};
use crate::hash::Sha256Hasher;

/// Encoded length.
pub const LEN: usize = 649;
/// Ciphertext slot length.
pub const CT_LEN: usize = 160;
/// Current version byte.
pub const VERSION: u8 = 1;

/// Decoded `ext_data`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ExtData {
    pub pool_id: [u8; 32],
    pub public_token_account: [u8; 32],
    pub relayer_fee_account: [u8; 32],
    pub relayer_fee: u64,
    pub memo_binding: [u8; 32],
    pub stealth_ephemeral: [u8; 32],
    pub ciphertext0: [u8; CT_LEN],
    pub ciphertext1: [u8; CT_LEN],
    pub ciphertext_rec: [u8; CT_LEN],
}

fn take<const N: usize>(b: &[u8], off: usize) -> [u8; N] {
    let mut o = [0u8; N];
    o.copy_from_slice(&b[off..off + N]);
    o
}

impl ExtData {
    /// Serialize to the 649-byte wire form.
    pub fn encode(&self) -> [u8; LEN] {
        let mut b = [0u8; LEN];
        b[0] = VERSION;
        b[1..33].copy_from_slice(&self.pool_id);
        b[33..65].copy_from_slice(&self.public_token_account);
        b[65..97].copy_from_slice(&self.relayer_fee_account);
        b[97..105].copy_from_slice(&self.relayer_fee.to_le_bytes());
        b[105..137].copy_from_slice(&self.memo_binding);
        b[137..169].copy_from_slice(&self.stealth_ephemeral);
        b[169..329].copy_from_slice(&self.ciphertext0);
        b[329..489].copy_from_slice(&self.ciphertext1);
        b[489..649].copy_from_slice(&self.ciphertext_rec);
        b
    }

    /// Parse; rejects a wrong length or version.
    pub fn decode(b: &[u8]) -> Result<Self, Error> {
        if b.len() != LEN {
            return Err(Error::Length);
        }
        if b[0] != VERSION {
            return Err(Error::Version);
        }
        Ok(Self {
            pool_id: take(b, 1),
            public_token_account: take(b, 33),
            relayer_fee_account: take(b, 65),
            relayer_fee: u64::from_le_bytes(take(b, 97)),
            memo_binding: take(b, 105),
            stealth_ephemeral: take(b, 137),
            ciphertext0: take(b, 169),
            ciphertext1: take(b, 329),
            ciphertext_rec: take(b, 489),
        })
    }
}

/// `ext_data_hash = h248(SHA256("dark-null-extdata-v1" || ext_data_bytes))` over exactly the bytes the
/// program receives.
pub fn ext_data_hash<S: Sha256Hasher>(s: &S, ext_data_bytes: &[u8]) -> Result<Fr32, Error> {
    if ext_data_bytes.len() != LEN {
        return Err(Error::Length);
    }
    Ok(h248(&s.sha256(&[TAG_EXTDATA, ext_data_bytes])))
}
