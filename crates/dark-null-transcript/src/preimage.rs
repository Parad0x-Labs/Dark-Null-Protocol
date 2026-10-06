//! Statement preimages: the exact Poseidon input lists of V2_SPEC sections 4-7, in order.
//!
//! Every function validates canonical encodings and then calls the backend once. The `*_inputs`
//! forms return the preimage itself, so a circuit, a program and a client can be checked against
//! the same array.

use crate::ds::*;
use crate::error::Error;
use crate::fr::{from_u64, h248, is_canonical, neg_u64, pubkey_fields, Fr32, ZERO};
use crate::hash::PoseidonHasher;

fn canon(xs: &[&Fr32]) -> Result<(), Error> {
    if xs.iter().all(|x| is_canonical(x)) {
        Ok(())
    } else {
        Err(Error::NonCanonicalField)
    }
}

/// `asset = Poseidon(DS_ASSET, BE(mint[0..16]), BE(mint[16..32]))`.
pub fn asset_id<H: PoseidonHasher>(h: &H, mint: &[u8; 32]) -> Result<Fr32, Error> {
    let (hi, lo) = pubkey_fields(mint);
    h.poseidon(&[DS_ASSET, hi, lo])
}

/// `nk = Poseidon(DS_NK, nk_seed)`.
pub fn nk<H: PoseidonHasher>(h: &H, nk_seed: &Fr32) -> Result<Fr32, Error> {
    h.poseidon(&[DS_NK, *nk_seed])
}

/// Owner key of a plain note: `pk = Poseidon(DS_PK, ak.x, ak.y, nk)` (binds `nk`, finding F-NK).
pub fn owner_pk<H: PoseidonHasher>(h: &H, ak_x: &Fr32, ak_y: &Fr32, nk: &Fr32) -> Result<Fr32, Error> {
    h.poseidon(&[DS_PK, *ak_x, *ak_y, *nk])
}

/// `cm = Poseidon(DS_NOTE, value, asset, owner, salt, label)`.
pub fn note_commitment<H: PoseidonHasher>(h: &H, value: u64, asset: &Fr32, owner: &Fr32, salt: &Fr32, label: &Fr32) -> Result<Fr32, Error> {
    h.poseidon(&[DS_NOTE, from_u64(value), *asset, *owner, *salt, *label])
}

/// `nf = Poseidon(DS_NF, nk, cm, leaf_index)`; `leaf_index < 2^32`.
pub fn nullifier<H: PoseidonHasher>(h: &H, nk: &Fr32, cm: &Fr32, leaf_index: u64) -> Result<Fr32, Error> {
    if leaf_index >= 1u64 << 32 {
        return Err(Error::LeafIndex);
    }
    h.poseidon(&[DS_NF, *nk, *cm, from_u64(leaf_index)])
}

/// `deposit_label = Poseidon(DS_LABEL, pool_id_fr, deposit_counter)`.
pub fn deposit_label<H: PoseidonHasher>(h: &H, pool_id_fr: &Fr32, counter: u64) -> Result<Fr32, Error> {
    h.poseidon(&[DS_LABEL, *pool_id_fr, from_u64(counter)])
}

/// Tree node `Poseidon(left, right)` (the only hash without a domain tag; V2_SPEC 6.1).
pub fn tree_node<H: PoseidonHasher>(h: &H, left: &Fr32, right: &Fr32) -> Result<Fr32, Error> {
    h.poseidon(&[*left, *right])
}

/// Signed public amount as a field element: `deposit`, `r - withdraw`, or 0. At most one leg is non-zero.
pub fn public_amount(deposit_amount: u64, withdraw_amount: u64) -> Result<Fr32, Error> {
    match (deposit_amount, withdraw_amount) {
        (0, 0) => Ok(ZERO),
        (d, 0) => Ok(from_u64(d)),
        (0, w) => Ok(neg_u64(w)),
        _ => Err(Error::BothLegsNonZero),
    }
}

/// `public_asset = asset` when the public amount is non-zero, else 0.
pub fn public_asset(public_amount: &Fr32, asset: &Fr32) -> Fr32 {
    if *public_amount == ZERO {
        ZERO
    } else {
        *asset
    }
}

/// The public statement of one transact (V2_SPEC 7.1).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Statement {
    pub root: Fr32,
    pub nf: [Fr32; 2],
    pub cm: [Fr32; 2],
    pub public_amount: Fr32,
    pub public_asset: Fr32,
    pub ext_data_hash: Fr32,
    pub epoch: u64,
    pub deposit_label: Fr32,
    pub assoc_root: Fr32,
}

impl Statement {
    /// `pi` preimage: `DS_PI, root, nf0, nf1, cm0, cm1, public_amount, public_asset, ext_data_hash, now_epoch, deposit_label, assoc_root`.
    pub fn pi_inputs(&self) -> [Fr32; 12] {
        [
            DS_PI,
            self.root,
            self.nf[0],
            self.nf[1],
            self.cm[0],
            self.cm[1],
            self.public_amount,
            self.public_asset,
            self.ext_data_hash,
            from_u64(self.epoch),
            self.deposit_label,
            self.assoc_root,
        ]
    }

    /// `sighash` preimage: `DS_SIGHASH, nf0, nf1, cm0, cm1, public_amount, public_asset, ext_data_hash, claimed_epoch`.
    pub fn sighash_inputs(&self) -> [Fr32; 9] {
        [
            DS_SIGHASH,
            self.nf[0],
            self.nf[1],
            self.cm[0],
            self.cm[1],
            self.public_amount,
            self.public_asset,
            self.ext_data_hash,
            from_u64(self.epoch),
        ]
    }

    fn check(&self) -> Result<(), Error> {
        canon(&[
            &self.root,
            &self.nf[0],
            &self.nf[1],
            &self.cm[0],
            &self.cm[1],
            &self.public_amount,
            &self.public_asset,
            &self.ext_data_hash,
            &self.deposit_label,
            &self.assoc_root,
        ])
    }

    /// The single Groth16 public input.
    pub fn pi<H: PoseidonHasher>(&self, h: &H) -> Result<Fr32, Error> {
        self.check()?;
        h.poseidon(&self.pi_inputs())
    }

    /// The spend-authorization digest signed by `ask`.
    pub fn sighash<H: PoseidonHasher>(&self, h: &H) -> Result<Fr32, Error> {
        self.check()?;
        h.poseidon(&self.sighash_inputs())
    }
}

/// EdDSA-Poseidon challenge `hm = Poseidon(R8.x, R8.y, A.x, A.y, M)` (circomlib; no domain tag, V2_SPEC 4.4).
pub fn eddsa_challenge<H: PoseidonHasher>(h: &H, r8: &[Fr32; 2], a: &[Fr32; 2], m: &Fr32) -> Result<Fr32, Error> {
    h.poseidon(&[r8[0], r8[1], a[0], a[1], *m])
}

/// Channel nullifier key `nk_ch = Poseidon(DS_NK_CH, chan_secret)` (Phase 3).
pub fn nk_channel<H: PoseidonHasher>(h: &H, chan_secret: &Fr32) -> Result<Fr32, Error> {
    h.poseidon(&[DS_NK_CH, *chan_secret])
}

/// Channel owner `Poseidon(DS_CHAN, merchant_owner, refund_owner, bjj.x, bjj.y, expiry_epoch, nk_ch)` (Phase 3; binds `nk_ch`, finding F-NK-CH).
pub fn channel_owner<H: PoseidonHasher>(
    h: &H,
    merchant_owner: &Fr32,
    refund_owner: &Fr32,
    bjj_pub: &[Fr32; 2],
    expiry_epoch: u64,
    nk_ch: &Fr32,
) -> Result<Fr32, Error> {
    h.poseidon(&[DS_CHAN, *merchant_owner, *refund_owner, bjj_pub[0], bjj_pub[1], from_u64(expiry_epoch), *nk_ch])
}

/// Voucher digest `Poseidon(DS_VOUCHER, chan_id, cumulative, h248(receipt_head_prev))` (Phase 3).
pub fn voucher_msg<H: PoseidonHasher>(h: &H, chan_id: &Fr32, cumulative: u64, receipt_head_prev: &[u8; 32]) -> Result<Fr32, Error> {
    h.poseidon(&[DS_VOUCHER, *chan_id, from_u64(cumulative), h248(receipt_head_prev)])
}

/// Next receipt-chain head `SHA256(TAG_RCPT_CHAIN || prev || BE32(voucher_msg) || dna_receipt_hash)`.
pub fn receipt_head_next(prev: &[u8; 32], voucher_msg: &Fr32, dna_receipt_hash: &[u8; 32]) -> [u8; 32] {
    crate::hash::sha256(&[TAG_RCPT_CHAIN, prev, voucher_msg, dna_receipt_hash])
}

/// Epoch anchor `memo_binding = BE32(Poseidon(DS_RCPT, h248(receipt_head), salt))` (Phase 3).
pub fn receipt_anchor<H: PoseidonHasher>(h: &H, receipt_head: &[u8; 32], salt: &Fr32) -> Result<Fr32, Error> {
    h.poseidon(&[DS_RCPT, h248(receipt_head), *salt])
}
