//! `transact` instruction data (V2_SPEC 8.4), 1,131 bytes.
//!
//! | offset | len | field |
//! |---|---|---|
//! | 0 | 8 | discriminator `SHA256("global:transact")[0..8]` |
//! | 8 | 64 | proof_a, negated (G1, x‖y big-endian) |
//! | 72 | 128 | proof_b (G2, x.c1‖x.c0‖y.c1‖y.c0 big-endian) |
//! | 200 | 64 | proof_c (G1) |
//! | 264 | 32 | root |
//! | 296 | 32 | nf0 |
//! | 328 | 32 | nf1 |
//! | 360 | 32 | cm0 |
//! | 392 | 32 | cm1 |
//! | 424 | 8 | deposit_amount (u64 LE) |
//! | 432 | 8 | withdraw_amount (u64 LE) |
//! | 440 | 8 | claimed_epoch (u64 LE) |
//! | 448 | 32 | assoc_root (zero in Phase 1) |
//! | 480 | 2 | root_hint (u16 LE, < 256) |
//! | 482 | 649 | ext_data |

use crate::ds::discriminator::TRANSACT;
use crate::error::Error;
use crate::extdata;
use crate::fr::{is_canonical, Fr32};
use crate::preimage::{public_amount, public_asset, Statement};
use crate::tree::ROOT_HISTORY;

/// Encoded length.
pub const LEN: usize = 8 + 256 + 5 * 32 + 3 * 8 + 32 + 2 + extdata::LEN;
/// Offset of `ext_data` inside the instruction data.
pub const EXT_DATA_OFFSET: usize = 482;

/// Decoded `transact` instruction data.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TransactIx {
    pub proof_a_neg: [u8; 64],
    pub proof_b: [u8; 128],
    pub proof_c: [u8; 64],
    pub root: Fr32,
    pub nf: [Fr32; 2],
    pub cm: [Fr32; 2],
    pub deposit_amount: u64,
    pub withdraw_amount: u64,
    pub claimed_epoch: u64,
    pub assoc_root: Fr32,
    pub root_hint: u16,
    pub ext_data: [u8; extdata::LEN],
}

fn take<const N: usize>(b: &[u8], off: usize) -> [u8; N] {
    let mut o = [0u8; N];
    o.copy_from_slice(&b[off..off + N]);
    o
}

impl TransactIx {
    /// Serialize.
    pub fn encode(&self) -> [u8; LEN] {
        let mut b = [0u8; LEN];
        b[0..8].copy_from_slice(&TRANSACT);
        b[8..72].copy_from_slice(&self.proof_a_neg);
        b[72..200].copy_from_slice(&self.proof_b);
        b[200..264].copy_from_slice(&self.proof_c);
        b[264..296].copy_from_slice(&self.root);
        b[296..328].copy_from_slice(&self.nf[0]);
        b[328..360].copy_from_slice(&self.nf[1]);
        b[360..392].copy_from_slice(&self.cm[0]);
        b[392..424].copy_from_slice(&self.cm[1]);
        b[424..432].copy_from_slice(&self.deposit_amount.to_le_bytes());
        b[432..440].copy_from_slice(&self.withdraw_amount.to_le_bytes());
        b[440..448].copy_from_slice(&self.claimed_epoch.to_le_bytes());
        b[448..480].copy_from_slice(&self.assoc_root);
        b[480..482].copy_from_slice(&self.root_hint.to_le_bytes());
        b[482..].copy_from_slice(&self.ext_data);
        b
    }

    /// Parse and apply the stateless checks of V2_SPEC 8.5 step 1: length, discriminator, canonical
    /// field elements, one public leg at most, root hint range, distinct nullifiers, ext_data version.
    pub fn decode(b: &[u8]) -> Result<Self, Error> {
        if b.len() != LEN {
            return Err(Error::Length);
        }
        if b[0..8] != TRANSACT {
            return Err(Error::Version);
        }
        let ix = Self {
            proof_a_neg: take(b, 8),
            proof_b: take(b, 72),
            proof_c: take(b, 200),
            root: take(b, 264),
            nf: [take(b, 296), take(b, 328)],
            cm: [take(b, 360), take(b, 392)],
            deposit_amount: u64::from_le_bytes(take(b, 424)),
            withdraw_amount: u64::from_le_bytes(take(b, 432)),
            claimed_epoch: u64::from_le_bytes(take(b, 440)),
            assoc_root: take(b, 448),
            root_hint: u16::from_le_bytes(take(b, 480)),
            ext_data: take(b, 482),
        };
        for x in [&ix.root, &ix.nf[0], &ix.nf[1], &ix.cm[0], &ix.cm[1], &ix.assoc_root] {
            if !is_canonical(x) {
                return Err(Error::NonCanonicalField);
            }
        }
        if ix.deposit_amount != 0 && ix.withdraw_amount != 0 {
            return Err(Error::BothLegsNonZero);
        }
        if ix.root_hint as usize >= ROOT_HISTORY {
            return Err(Error::RootHint);
        }
        if ix.nf[0] == ix.nf[1] {
            return Err(Error::DuplicateNullifier);
        }
        extdata::ExtData::decode(&ix.ext_data)?;
        Ok(ix)
    }

    /// The statement the program hashes into `pi`, given the values it derives itself
    /// (`asset` of the named mint, `ext_data_hash`, `deposit_label`).
    pub fn statement(&self, asset: &Fr32, ext_data_hash: &Fr32, deposit_label: &Fr32) -> Result<Statement, Error> {
        let pa = public_amount(self.deposit_amount, self.withdraw_amount)?;
        Ok(Statement {
            root: self.root,
            nf: self.nf,
            cm: self.cm,
            public_amount: pa,
            public_asset: public_asset(&pa, asset),
            ext_data_hash: *ext_data_hash,
            epoch: self.claimed_epoch,
            deposit_label: *deposit_label,
            assoc_root: self.assoc_root,
        })
    }
}
