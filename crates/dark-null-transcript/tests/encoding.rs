//! Field arithmetic, HMAC and codec checks against num-bigint and published test vectors.

use dark_null_transcript::address::ShieldedAddress;
use dark_null_transcript::extdata::{ExtData, LEN as EXT_LEN};
use dark_null_transcript::fr::{self, Fr32, L_BJJ_BE, R_BE};
use dark_null_transcript::hash::sha256;
use dark_null_transcript::ix::{TransactIx, LEN as IX_LEN};
use dark_null_transcript::kdf::hmac_sha256;
use dark_null_transcript::preimage;
use dark_null_transcript::Error;
use num_bigint::BigUint;

fn big(x: &[u8]) -> BigUint {
    BigUint::from_bytes_be(x)
}
fn bytes32(x: &BigUint) -> Fr32 {
    let v = x.to_bytes_be();
    let mut o = [0u8; 32];
    o[32 - v.len()..].copy_from_slice(&v);
    o
}

#[test]
fn modulus_constants() {
    assert_eq!(big(&R_BE).to_string(), "21888242871839275222246405745257275088548364400416034343698204186575808495617");
    assert_eq!(big(&L_BJJ_BE).to_string(), "2736030358979909402780800718157159386076813972158567259200215660948447373041");
}

#[test]
fn reduce_add_neg_match_bigint() {
    let r = big(&R_BE);
    let l = big(&L_BJJ_BE);
    for i in 0u32..200 {
        let a = sha256(&[b"enc-a", &i.to_le_bytes()]);
        let b = sha256(&[b"enc-b", &i.to_le_bytes()]);
        let mut wide = [0u8; 64];
        wide[..32].copy_from_slice(&a);
        wide[32..].copy_from_slice(&b);
        assert_eq!(fr::reduce_be(&wide, &R_BE), bytes32(&(big(&wide) % &r)));
        assert_eq!(fr::reduce_be(&wide, &L_BJJ_BE), bytes32(&(big(&wide) % &l)));
        let x = fr::reduce_be(&a, &R_BE);
        let y = fr::reduce_be(&b, &R_BE);
        assert_eq!(fr::add_mod_r(&x, &y), bytes32(&((big(&x) + big(&y)) % &r)));
        assert_eq!(fr::is_canonical(&a), big(&a) < r);
        let v = u64::from_le_bytes(a[..8].try_into().unwrap());
        assert_eq!(fr::neg_u64(v), bytes32(&((&r - BigUint::from(v)) % &r)));
        assert_eq!(big(&fr::h248(&a)), big(&a[..31]));
    }
    // edges
    let rm1 = fr::sub(&R_BE, &fr::from_u64(1));
    assert!(fr::is_canonical(&rm1) && !fr::is_canonical(&R_BE));
    assert_eq!(fr::add_mod_r(&rm1, &rm1), bytes32(&((big(&rm1) * 2u32) % &r)));
    assert_eq!(fr::add_mod_r(&rm1, &fr::from_u64(1)), fr::ZERO);
    assert_eq!(fr::neg_u64(0), fr::ZERO);
    assert_eq!(fr::reduce_be(&R_BE, &R_BE), fr::ZERO);
    assert_eq!(fr::reduce_be(&[0xff; 64], &R_BE), bytes32(&(big(&[0xff; 64]) % &r)));
}

#[test]
fn public_amount_rules() {
    assert_eq!(preimage::public_amount(0, 0).unwrap(), fr::ZERO);
    assert_eq!(preimage::public_amount(5, 0).unwrap(), fr::from_u64(5));
    assert_eq!(preimage::public_amount(0, u64::MAX).unwrap(), fr::neg_u64(u64::MAX));
    assert_eq!(preimage::public_amount(1, 1), Err(Error::BothLegsNonZero));
    // value conservation cannot wrap: 2 * (2^64 - 1) + (2^64 - 1) < r
    let max = big(&fr::from_u64(u64::MAX));
    assert!(max * 4u32 < big(&R_BE));
}

#[test]
fn hmac_sha256_rfc4231_case2() {
    let mac = hmac_sha256(b"Jefe", &[b"what do ya want ", b"for nothing?"]);
    assert_eq!(hex::encode(mac), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
}

#[test]
fn layouts_and_rejections() {
    assert_eq!(EXT_LEN, 649);
    assert_eq!(IX_LEN, 1131);
    let e = ExtData { pool_id: [1; 32], public_token_account: [2; 32], relayer_fee_account: [3; 32], relayer_fee: 9, memo_binding: [4; 32], stealth_ephemeral: [5; 32], ciphertext0: [6; 160], ciphertext1: [7; 160], ciphertext_rec: [8; 160] };
    let ix = TransactIx { proof_a_neg: [0; 64], proof_b: [0; 128], proof_c: [0; 64], root: fr::from_u64(1), nf: [fr::from_u64(2), fr::from_u64(3)], cm: [fr::from_u64(4), fr::from_u64(5)], deposit_amount: 0, withdraw_amount: 7, claimed_epoch: 9, assoc_root: fr::ZERO, root_hint: 255, ext_data: e.encode() };
    let raw = ix.encode();
    assert_eq!(TransactIx::decode(&raw).unwrap(), ix);
    let mut bad = raw;
    bad[0] ^= 1;
    assert_eq!(TransactIx::decode(&bad), Err(Error::Version));
    let mut bad = raw;
    bad[480..482].copy_from_slice(&256u16.to_le_bytes());
    assert_eq!(TransactIx::decode(&bad), Err(Error::RootHint));
    let mut bad = raw;
    bad[328..360].copy_from_slice(&fr::from_u64(2));
    assert_eq!(TransactIx::decode(&bad), Err(Error::DuplicateNullifier));
    let mut bad = raw;
    bad[264..296].copy_from_slice(&R_BE);
    assert_eq!(TransactIx::decode(&bad), Err(Error::NonCanonicalField));
    assert_eq!(TransactIx::decode(&raw[..1130]), Err(Error::Length));
}

#[test]
fn address_rejects_wrong_hrp_case_and_padding() {
    let a = ShieldedAddress { pk: fr::from_u64(42), ivk_pub: [9; 32], diversifier: 3 };
    let mut buf = [0u8; dark_null_transcript::address::ENCODED_LEN];
    let s = a.encode(&mut buf).to_string();
    assert_eq!(ShieldedAddress::decode(&s).unwrap(), a);
    assert!(ShieldedAddress::decode(&s.to_uppercase()).is_err());
    assert!(ShieldedAddress::decode(&s.replacen("dnull", "dnulx", 1)).is_err());
    assert!(ShieldedAddress::decode(&s[..s.len() - 1]).is_err());
}
