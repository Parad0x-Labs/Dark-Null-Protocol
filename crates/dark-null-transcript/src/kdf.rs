//! Key derivation (V2_SPEC section 4.2): HKDF-SHA256 (RFC 5869) with salt `KDF_SALT`, implemented
//! here over `sha2` so the crate stays no_std and dependency-light. Spend-authority scalars are
//! produced only in the wallet layer (`dark-null-signer`); this module pins the byte rules so the
//! signer, the core and the vectors agree.

use crate::ds::{kdf_info, KDF_SALT, TAG_EDDSA_NONCE};
use crate::error::Error;
use crate::fr::{reduce_be, Fr32, L_BJJ_BE, R_BE, ZERO};
use crate::hash::{sha256, sha512};

/// HMAC-SHA256 over the concatenation of `parts`.
pub fn hmac_sha256(key: &[u8], parts: &[&[u8]]) -> [u8; 32] {
    let mut k = [0u8; 64];
    if key.len() > 64 {
        k[..32].copy_from_slice(&sha256(&[key]));
    } else {
        k[..key.len()].copy_from_slice(key);
    }
    let mut ipad = [0x36u8; 64];
    let mut opad = [0x5cu8; 64];
    for i in 0..64 {
        ipad[i] ^= k[i];
        opad[i] ^= k[i];
    }
    let mut h = sha2::Sha256::default();
    sha2::Digest::update(&mut h, ipad);
    for p in parts {
        sha2::Digest::update(&mut h, p);
    }
    let inner: [u8; 32] = sha2::Digest::finalize(h).into();
    sha256(&[&opad, &inner])
}

/// HKDF-SHA256(ikm, salt = KDF_SALT, info = concat(info_parts)) into `out` (at most 8,160 bytes).
pub fn hkdf(ikm: &[u8], info_parts: &[&[u8]], out: &mut [u8]) -> Result<(), Error> {
    if out.len() > 255 * 32 {
        return Err(Error::Buffer);
    }
    let prk = hmac_sha256(KDF_SALT, &[ikm]);
    let mut t = [0u8; 32];
    let mut t_len = 0usize;
    let mut done = 0usize;
    let mut counter = 1u8;
    while done < out.len() {
        let mut parts: [&[u8]; 10] = [&[]; 10];
        parts[0] = &t[..t_len];
        if info_parts.len() > 8 {
            return Err(Error::Buffer);
        }
        for (i, p) in info_parts.iter().enumerate() {
            parts[1 + i] = p;
        }
        let c = [counter];
        parts[1 + info_parts.len()] = &c;
        t = hmac_sha256(&prk, &parts[..2 + info_parts.len()]);
        t_len = 32;
        let n = core::cmp::min(32, out.len() - done);
        out[done..done + n].copy_from_slice(&t[..n]);
        done += n;
        counter = counter.wrapping_add(1);
    }
    Ok(())
}

fn hkdf32(ikm: &[u8], info: &[u8], suffix: &[u8]) -> [u8; 32] {
    let mut o = [0u8; 32];
    hkdf(ikm, &[info, suffix], &mut o).expect("32 <= 8160");
    o
}

fn hkdf_mod(ikm: &[u8], info: &[u8], suffix: &[u8], m: &Fr32) -> Fr32 {
    let mut o = [0u8; 64];
    hkdf(ikm, &[info, suffix], &mut o).expect("64 <= 8160");
    reduce_be(&o, m)
}

/// Spend-authorization scalar `ask` (BabyJubJub, mod l), big-endian. Zero aborts.
pub fn ask(seed: &[u8; 32], account: u32) -> Result<Fr32, Error> {
    let a = hkdf_mod(seed, kdf_info::ASK, &account.to_le_bytes(), &L_BJJ_BE);
    if a == ZERO {
        return Err(Error::ZeroScalar);
    }
    Ok(a)
}

/// Key for the deterministic EdDSA nonce of `ask`.
pub fn ask_nonce_key(seed: &[u8; 32], account: u32) -> [u8; 32] {
    hkdf32(seed, kdf_info::ASK_NONCE, &account.to_le_bytes())
}

/// `nk_seed` (mod r); `nk = Poseidon(DS_NK, nk_seed)` (see `preimage::nk`).
pub fn nk_seed(seed: &[u8; 32], account: u32) -> Fr32 {
    hkdf_mod(seed, kdf_info::NK, &account.to_le_bytes(), &R_BE)
}

/// Incoming viewing root; per-diversifier X25519 secrets derive from it.
pub fn ivk_root(seed: &[u8; 32], account: u32) -> [u8; 32] {
    hkdf32(seed, kdf_info::IVK, &account.to_le_bytes())
}

/// X25519 secret for diversifier `d` (clamped by X25519 on use).
pub fn ivk_d(ivk_root: &[u8; 32], d: u32) -> [u8; 32] {
    hkdf32(ivk_root, kdf_info::IVK_D, &d.to_le_bytes())
}

/// Outgoing viewing key.
pub fn ovk(seed: &[u8; 32], account: u32) -> [u8; 32] {
    hkdf32(seed, kdf_info::OVK, &account.to_le_bytes())
}

/// 32-byte spend seed for the ed25519 stealth meta-address (DNA x402 scheme).
pub fn stealth_spend_seed(seed: &[u8; 32], account: u32) -> [u8; 32] {
    hkdf32(seed, kdf_info::STEALTH, &account.to_le_bytes())
}

/// Channel session scalar `bjj_session` (mod l). Zero aborts.
pub fn bjj_session(seed: &[u8; 32], chan_nonce: &[u8; 32]) -> Result<Fr32, Error> {
    let a = hkdf_mod(seed, kdf_info::CHAN, chan_nonce, &L_BJJ_BE);
    if a == ZERO {
        return Err(Error::ZeroScalar);
    }
    Ok(a)
}

/// Nonce key of `bjj_session`.
pub fn bjj_session_nonce_key(seed: &[u8; 32], chan_nonce: &[u8; 32]) -> [u8; 32] {
    hkdf32(seed, kdf_info::CHAN_NONCE, chan_nonce)
}

/// Deterministic EdDSA nonce `r = OS2IP(SHA512(TAG_EDDSA_NONCE || nonce_key || BE32(M))) mod l`.
pub fn eddsa_nonce(nonce_key: &[u8; 32], msg: &Fr32) -> Fr32 {
    reduce_be(&sha512(&[TAG_EDDSA_NONCE, nonce_key, msg]), &L_BJJ_BE)
}
