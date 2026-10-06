//! Domain-separation registry (V2_SPEC section 3). Final values.
//!
//! Field tags: `DS_x = OS2IP(ascii(tag))`, the big-endian integer of the ASCII bytes, as the FIRST
//! Poseidon input of every hash except tree nodes. Byte tags prefix SHA-256 / SHA-512 inputs and
//! label HKDF derivations. Changing any value is a protocol version change.

use crate::fr::Fr32;

const fn tag(s: &[u8]) -> Fr32 {
    let mut o = [0u8; 32];
    let n = s.len();
    let mut i = 0;
    while i < n {
        o[32 - n + i] = s[i];
        i += 1;
    }
    o
}

pub const DS_ASSET: Fr32 = tag(b"dark-null-asset-v1");
pub const DS_NOTE: Fr32 = tag(b"dark-null-note-v1");
pub const DS_NF: Fr32 = tag(b"dark-null-nf-v1");
pub const DS_PK: Fr32 = tag(b"dark-null-pk-v1");
pub const DS_NK: Fr32 = tag(b"dark-null-nk-v1");
pub const DS_SIGHASH: Fr32 = tag(b"dark-null-sighash-v1");
pub const DS_PI: Fr32 = tag(b"dark-null-pi-v1");
pub const DS_LABEL: Fr32 = tag(b"dark-null-label-v1");
pub const DS_OWNER: Fr32 = tag(b"dark-null-owner-v1");
pub const DS_POLICY: Fr32 = tag(b"dark-null-policy-v1");
pub const DS_CHAN: Fr32 = tag(b"dark-null-chan-v1");
pub const DS_NK_CH: Fr32 = tag(b"dark-null-nk-ch-v1");
pub const DS_VOUCHER: Fr32 = tag(b"dark-null-voucher-v1");
pub const DS_MERGED: Fr32 = tag(b"dark-null-merged-v1");
pub const DS_RCPT: Fr32 = tag(b"dark-null-rcpt-v1");

/// Every field tag with its ASCII name (registry order).
pub const ALL: [(&str, Fr32); 15] = [
    ("DS_ASSET", DS_ASSET),
    ("DS_NOTE", DS_NOTE),
    ("DS_NF", DS_NF),
    ("DS_PK", DS_PK),
    ("DS_NK", DS_NK),
    ("DS_SIGHASH", DS_SIGHASH),
    ("DS_PI", DS_PI),
    ("DS_LABEL", DS_LABEL),
    ("DS_OWNER", DS_OWNER),
    ("DS_POLICY", DS_POLICY),
    ("DS_CHAN", DS_CHAN),
    ("DS_NK_CH", DS_NK_CH),
    ("DS_VOUCHER", DS_VOUCHER),
    ("DS_MERGED", DS_MERGED),
    ("DS_RCPT", DS_RCPT),
];

/// SHA-256 prefix of the `ext_data` hash.
pub const TAG_EXTDATA: &[u8] = b"dark-null-extdata-v1";
/// SHA-256 prefix of the pool id.
pub const TAG_POOL_ID: &[u8] = b"dark-null-pool-id-v1";
/// SHA-256 prefix of the x402 quote binding.
pub const TAG_QUOTE: &[u8] = b"dark-null-x402-quote-v1";
/// SHA-256 prefix of the two-signed receipt chain.
pub const TAG_RCPT_CHAIN: &[u8] = b"dark-null-rcpt-chain-v1";
/// SHA-512 prefix of the deterministic EdDSA nonce.
pub const TAG_EDDSA_NONCE: &[u8] = b"dark-null-eddsa-nonce-v1";
/// HKDF-SHA256 salt for every key derivation.
pub const KDF_SALT: &[u8] = b"dark-null-keys-v1";

/// HKDF info prefixes (followed by the listed suffix).
pub mod kdf_info {
    /// `|| LE32(account)`
    pub const ASK: &[u8] = b"dark-null-kdf-ask-v1";
    /// `|| LE32(account)`
    pub const ASK_NONCE: &[u8] = b"dark-null-kdf-ask-nonce-v1";
    /// `|| LE32(account)`
    pub const NK: &[u8] = b"dark-null-kdf-nk-v1";
    /// `|| LE32(account)`
    pub const IVK: &[u8] = b"dark-null-kdf-ivk-v1";
    /// `|| LE32(diversifier)`, ikm = ivk_root
    pub const IVK_D: &[u8] = b"dark-null-kdf-ivk-d-v1";
    /// `|| LE32(account)`
    pub const OVK: &[u8] = b"dark-null-kdf-ovk-v1";
    /// `|| chan_nonce[32]`
    pub const CHAN: &[u8] = b"dark-null-kdf-chan-v1";
    /// `|| chan_nonce[32]`
    pub const CHAN_NONCE: &[u8] = b"dark-null-kdf-chan-nonce-v1";
    /// `|| LE32(account)`
    pub const STEALTH: &[u8] = b"dark-null-kdf-stealth-v1";
}

/// Anchor-compatible 8-byte instruction discriminators: `SHA256("global:<name>")[0..8]`.
pub mod discriminator {
    /// `SHA256("global:transact")[0..8]`
    pub const TRANSACT: [u8; 8] = [0xd9, 0x95, 0x82, 0x8f, 0xdd, 0x34, 0xfc, 0x77];
    /// `SHA256("global:initialize_pool")[0..8]`
    pub const INITIALIZE_POOL: [u8; 8] = [0x5f, 0xb4, 0x0a, 0xac, 0x54, 0xae, 0xe8, 0x28];
    /// `SHA256("global:register_mint")[0..8]`
    pub const REGISTER_MINT: [u8; 8] = [0xf2, 0x2b, 0x4a, 0xa2, 0xd9, 0xd6, 0xbf, 0xab];
    /// `SHA256("global:set_beta_limits")[0..8]`
    pub const SET_BETA_LIMITS: [u8; 8] = [0x4e, 0x47, 0x8d, 0xcb, 0x8a, 0xb5, 0x8a, 0x5c];
    /// `SHA256("global:set_paused")[0..8]`
    pub const SET_PAUSED: [u8; 8] = [0x5b, 0x3c, 0x7d, 0xc0, 0xb0, 0xe1, 0xa6, 0xda];
}
