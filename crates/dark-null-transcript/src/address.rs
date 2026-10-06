//! Shielded address: bech32m (BIP-350 checksum) with HRP `dnull` and no 90-character limit
//! (V2_SPEC 4.3). Payload (69 bytes): `0x01 || BE32(pk) || ivk_pub_d[32] || LE32(d)`.

use crate::error::Error;
use crate::fr::{is_canonical, Fr32};

/// Human-readable part.
pub const HRP: &str = "dnull";
/// Payload version for plain (principal) owners.
pub const VERSION_PLAIN: u8 = 0x01;
/// Payload length.
pub const PAYLOAD_LEN: usize = 69;
/// Encoded length of a v1 address: hrp + '1' + ceil(69*8/5) + 6.
pub const ENCODED_LEN: usize = 5 + 1 + 111 + 6;

const CHARSET: &[u8; 32] = b"qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32M_CONST: u32 = 0x2bc8_30a3;

fn polymod(values: impl Iterator<Item = u8>) -> u32 {
    const GEN: [u32; 5] = [0x3b6a_57b2, 0x2650_8e6d, 0x1ea1_19fa, 0x3d42_33dd, 0x2a14_62b3];
    let mut chk: u32 = 1;
    for v in values {
        let b = chk >> 25;
        chk = ((chk & 0x01ff_ffff) << 5) ^ v as u32;
        for (i, g) in GEN.iter().enumerate() {
            if (b >> i) & 1 == 1 {
                chk ^= g;
            }
        }
    }
    chk
}

fn hrp_expand(hrp: &[u8]) -> impl Iterator<Item = u8> + '_ {
    hrp.iter().map(|c| c >> 5).chain(core::iter::once(0)).chain(hrp.iter().map(|c| c & 31))
}

/// A decoded shielded address.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ShieldedAddress {
    pub pk: Fr32,
    pub ivk_pub: [u8; 32],
    pub diversifier: u32,
}

impl ShieldedAddress {
    /// The 69-byte payload.
    pub fn payload(&self) -> [u8; PAYLOAD_LEN] {
        let mut p = [0u8; PAYLOAD_LEN];
        p[0] = VERSION_PLAIN;
        p[1..33].copy_from_slice(&self.pk);
        p[33..65].copy_from_slice(&self.ivk_pub);
        p[65..69].copy_from_slice(&self.diversifier.to_le_bytes());
        p
    }

    /// Encode into `out`; returns the string slice.
    pub fn encode<'a>(&self, out: &'a mut [u8; ENCODED_LEN]) -> &'a str {
        let payload = self.payload();
        let mut data = [0u8; 111];
        let mut acc: u32 = 0;
        let mut bits = 0u32;
        let mut n = 0;
        for b in payload {
            acc = ((acc << 8) | b as u32) & 0x1fff;
            bits += 8;
            while bits >= 5 {
                bits -= 5;
                data[n] = ((acc >> bits) & 31) as u8;
                n += 1;
            }
        }
        if bits > 0 {
            data[n] = ((acc << (5 - bits)) & 31) as u8;
            n += 1;
        }
        debug_assert_eq!(n, 111);
        let hrp = HRP.as_bytes();
        let pm = polymod(hrp_expand(hrp).chain(data.iter().copied()).chain([0u8; 6])) ^ BECH32M_CONST;
        out[..5].copy_from_slice(hrp);
        out[5] = b'1';
        for (i, d) in data.iter().enumerate() {
            out[6 + i] = CHARSET[*d as usize];
        }
        for i in 0..6 {
            out[117 + i] = CHARSET[((pm >> (5 * (5 - i))) & 31) as usize];
        }
        core::str::from_utf8(&out[..]).expect("ascii")
    }

    /// Decode and validate (lowercase only, HRP, checksum, version, canonical pk, zero padding).
    pub fn decode(s: &str) -> Result<Self, Error> {
        let b = s.as_bytes();
        if b.len() != ENCODED_LEN || &b[..6] != b"dnull1" {
            return Err(Error::Address);
        }
        let mut data = [0u8; 117];
        for (i, c) in b[6..].iter().enumerate() {
            data[i] = CHARSET.iter().position(|x| x == c).ok_or(Error::Address)? as u8;
        }
        if polymod(hrp_expand(HRP.as_bytes()).chain(data.iter().copied())) != BECH32M_CONST {
            return Err(Error::Address);
        }
        let mut payload = [0u8; PAYLOAD_LEN];
        let mut acc: u32 = 0;
        let mut bits = 0u32;
        let mut n = 0;
        for d in &data[..111] {
            acc = ((acc << 5) | *d as u32) & 0x1fff;
            bits += 5;
            if bits >= 8 {
                bits -= 8;
                if n == PAYLOAD_LEN {
                    return Err(Error::Address);
                }
                payload[n] = ((acc >> bits) & 0xff) as u8;
                n += 1;
            }
        }
        if n != PAYLOAD_LEN || bits >= 5 || (acc & ((1 << bits) - 1)) != 0 {
            return Err(Error::Address);
        }
        if payload[0] != VERSION_PLAIN {
            return Err(Error::Version);
        }
        let mut pk = [0u8; 32];
        pk.copy_from_slice(&payload[1..33]);
        if !is_canonical(&pk) {
            return Err(Error::NonCanonicalField);
        }
        let mut ivk_pub = [0u8; 32];
        ivk_pub.copy_from_slice(&payload[33..65]);
        let mut d = [0u8; 4];
        d.copy_from_slice(&payload[65..69]);
        Ok(Self { pk, ivk_pub, diversifier: u32::from_le_bytes(d) })
    }
}
