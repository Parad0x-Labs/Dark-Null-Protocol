//! Host-only tests of the program's pure parts: the zero-copy parser against `TransactIx::decode` (proptest), the
//! pre-proof pipeline (steps 7-9) against V-E2E, the Groth16 path and a malformed-proof corpus, the Token-2022
//! allowlist parser, layouts, discriminators, PDAs and the error table.

mod common;

use common::*;
use dark_null_pool_v2::error::PoolError as E;
use dark_null_pool_v2::hash::{POSEIDON, SHA256};
use dark_null_pool_v2::instructions::TransactView;
use dark_null_pool_v2::state;
use dark_null_pool_v2::token::{self, ext, KIND_SPL_TOKEN, KIND_TOKEN_2022};
use dark_null_pool_v2::verify::verify_proof;
use dark_null_pool_v2::{pda, vk};
use dark_null_transcript::extdata::ext_data_hash;
use dark_null_transcript::fr::{R_BE, ZERO};
use dark_null_transcript::ix::TransactIx;
use dark_null_transcript::pool::pool_id_fr;
use dark_null_transcript::preimage::{deposit_label, public_amount, public_asset, Statement};
use dark_null_transcript::Error as TE;
use proptest::prelude::*;
use solana_sdk::pubkey::Pubkey;

fn vector_ix(i: usize) -> Vec<u8> {
    let e = load("V-E2E");
    let mut d = unhex(e["steps"][i]["instruction"]["data_with_zero_proof"].as_str().unwrap());
    d[8..264].copy_from_slice(&proof_for("snarkjs", STEP_NAMES[i]).proof);
    d
}

/// Steps 7-9 with the program's own pieces reproduce `ext_data_hash`, `deposit_label` and `pi` of every V-E2E step.
#[test]
fn pre_proof_pipeline_matches_v_e2e() {
    let e = load("V-E2E");
    let pool_id: [u8; 32] = unhex(e["pool"]["pool_id"].as_str().unwrap()).try_into().unwrap();
    let asset = fr(&e["pool"]["asset"]);
    let mut counter = 0u64;
    for i in 0..3 {
        let d = vector_ix(i);
        let v = TransactView::check(&d).unwrap();
        let p = &e["steps"][i]["public"];
        let edh = ext_data_hash(&SHA256, v.ext_data()).unwrap();
        assert_eq!(edh, fr(&p["ext_data_hash"]));
        let pa = public_amount(v.deposit_amount(), v.withdraw_amount()).unwrap();
        let label = if v.deposit_amount() > 0 { deposit_label(&POSEIDON, &pool_id_fr(&pool_id), counter).unwrap() } else { ZERO };
        assert_eq!(label, fr(&p["deposit_label"]));
        let st = Statement {
            root: *v.root(),
            nf: [*v.nf(0), *v.nf(1)],
            cm: [*v.cm(0), *v.cm(1)],
            public_amount: pa,
            public_asset: public_asset(&pa, &asset),
            ext_data_hash: edh,
            epoch: v.claimed_epoch(),
            deposit_label: label,
            assoc_root: *v.assoc_root(),
        };
        let pi = st.pi(&POSEIDON).unwrap();
        assert_eq!(pi, fr(&p["pi"]), "pi step {i}");
        verify_proof(v.proof_a_neg(), v.proof_b(), v.proof_c(), &pi).expect("fixture proof verifies");
        if v.deposit_amount() > 0 {
            counter += 1;
        }
    }
}

/// All six I1 fixture proofs verify; pi >= r is refused before the pairing; pi + 1 fails.
#[test]
fn groth16_fixtures_and_pi_range() {
    let ps = proofs();
    assert_eq!(ps.len(), 6);
    for p in &ps {
        let (a, b, c) = split(&p.proof);
        verify_proof(&a, &b, &c, &p.pi).unwrap_or_else(|e| panic!("{}: {e:?}", p.label));
        let mut pi1 = p.pi;
        pi1[31] ^= 1;
        assert_eq!(verify_proof(&a, &b, &c, &pi1), Err(E::ProofInvalid));
        for bad in [R_BE, plus_one(&R_BE), [0xff; 32], plus_r(&p.pi)] {
            assert_eq!(verify_proof(&a, &b, &c, &bad), Err(E::NonCanonicalField), "{}", p.label);
        }
    }
}

fn split(p: &[u8; 256]) -> ([u8; 64], [u8; 128], [u8; 64]) {
    (p[0..64].try_into().unwrap(), p[64..192].try_into().unwrap(), p[192..256].try_into().unwrap())
}

fn plus_one(x: &[u8; 32]) -> [u8; 32] {
    let mut o = *x;
    for i in (0..32).rev() {
        let (v, c) = o[i].overflowing_add(1);
        o[i] = v;
        if !c {
            break;
        }
    }
    o
}

const Q: &str = "30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47";

/// Malformed proof corpus: every corruption of every fixture is `E_PROOF_INVALID`.
#[test]
fn malformed_proof_corpus() {
    let q: [u8; 32] = unhex(Q).try_into().unwrap();
    let mut n = 0;
    for p in proofs() {
        let mut corpus: Vec<(String, [u8; 256])> = vec![];
        let mut add = |name: &str, f: &dyn Fn(&mut [u8; 256])| {
            let mut x = p.proof;
            f(&mut x);
            corpus.push((name.to_string(), x));
        };
        for k in (0..256).step_by(7) {
            add(&format!("bit flip {k}"), &|x| x[k] ^= 0x01);
        }
        add("zero", &|x| x.fill(0));
        add("ones", &|x| x.fill(0xff));
        add("A zero (identity)", &|x| x[0..64].fill(0));
        add("C zero (identity)", &|x| x[192..256].fill(0));
        add("A not negated", &|x| {
            let y: [u8; 32] = x[32..64].try_into().unwrap();
            x[32..64].copy_from_slice(&dark_null_transcript::fr::sub(&q, &y));
        });
        add("A.x = q", &|x| x[0..32].copy_from_slice(&q));
        add("C.y = q", &|x| x[224..256].copy_from_slice(&q));
        add("B c1/c0 order (x)", &|x| {
            let (h, l): ([u8; 32], [u8; 32]) = (x[64..96].try_into().unwrap(), x[96..128].try_into().unwrap());
            x[64..96].copy_from_slice(&l);
            x[96..128].copy_from_slice(&h);
        });
        add("B x/y swapped", &|x| {
            let (h, l): ([u8; 64], [u8; 64]) = (x[64..128].try_into().unwrap(), x[128..192].try_into().unwrap());
            x[64..128].copy_from_slice(&l);
            x[128..192].copy_from_slice(&h);
        });
        add("A <-> C", &|x| {
            let (a, c): ([u8; 64], [u8; 64]) = (x[0..64].try_into().unwrap(), x[192..256].try_into().unwrap());
            x[0..64].copy_from_slice(&c);
            x[192..256].copy_from_slice(&a);
        });
        add("A little-endian", &|x| {
            x[0..32].reverse();
            x[32..64].reverse();
        });
        for (name, x) in corpus {
            let (a, b, c) = split(&x);
            assert_eq!(verify_proof(&a, &b, &c, &p.pi), Err(E::ProofInvalid), "{} {name}", p.label);
            n += 1;
        }
    }
    println!("CORPUS malformed proofs rejected: {n}");
}

fn crate_class(e: TE) -> Vec<E> {
    match e {
        TE::Length => vec![E::BadIx],
        TE::Version => vec![E::BadIx, E::BadExtData],
        TE::NonCanonicalField => vec![E::NonCanonicalField],
        TE::BothLegsNonZero => vec![E::BadPublicAmount],
        TE::RootHint => vec![E::UnknownRoot],
        TE::DuplicateNullifier => vec![E::DuplicateNullifier],
        other => panic!("unexpected crate error {other:?}"),
    }
}

fn agree(d: &[u8]) {
    let a = TransactView::check(d);
    let b = TransactIx::decode(d);
    match (a, b) {
        (Ok(v), Ok(ix)) => {
            assert_eq!(v.root(), &ix.root);
            assert_eq!([*v.nf(0), *v.nf(1)], ix.nf);
            assert_eq!([*v.cm(0), *v.cm(1)], ix.cm);
            assert_eq!((v.deposit_amount(), v.withdraw_amount(), v.claimed_epoch(), v.root_hint()), (ix.deposit_amount, ix.withdraw_amount, ix.claimed_epoch, ix.root_hint));
            assert_eq!(v.assoc_root(), &ix.assoc_root);
            assert_eq!(&v.ext_data()[..], &ix.ext_data[..]);
            assert_eq!(v.proof_a_neg(), &ix.proof_a_neg);
            assert_eq!(v.proof_b(), &ix.proof_b);
            assert_eq!(v.proof_c(), &ix.proof_c);
            assert_eq!(&ix.encode()[..], d);
        }
        (Err(pe), Err(te)) => assert!(crate_class(te).contains(&pe), "program {pe:?} vs crate {te:?}"),
        (a, b) => panic!("parser disagreement: program {:?} crate {:?}", a.err(), b.err()),
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 2048, .. ProptestConfig::default() })]

    /// Mutations of a valid V-E2E instruction: up to 4 bytes overwritten anywhere, or the length changed.
    #[test]
    fn parser_agrees_with_transcript_decode(step in 0usize..3, edits in proptest::collection::vec((0usize..1131, any::<u8>()), 0..4), cut in 0usize..8) {
        let mut d = vector_ix(step);
        for (k, v) in edits {
            d[k] = v;
        }
        match cut {
            1 => { d.pop(); }
            2 => d.push(0),
            _ => {}
        }
        agree(&d);
    }

    /// Field-targeted mutations: each field element set to a random 32-byte value (often >= r), random amounts and
    /// hint, nf1 := nf0.
    #[test]
    fn parser_field_targeted(step in 0usize..3, field in 0usize..9, val in any::<[u8; 32]>(), amt in any::<u64>(), hint in any::<u16>()) {
        let mut d = vector_ix(step);
        match field {
            0..=5 => { let off = [264, 296, 328, 360, 392, 448][field]; d[off..off + 32].copy_from_slice(&val); }
            6 => { let off = [424, 432][(amt & 1) as usize]; d[off..off + 8].copy_from_slice(&amt.to_le_bytes()); }
            7 => d[480..482].copy_from_slice(&hint.to_le_bytes()),
            _ => { let x: [u8; 32] = d[296..328].try_into().unwrap(); d[328..360].copy_from_slice(&x); }
        }
        agree(&d);
    }

    /// Arbitrary bytes of arbitrary length (mostly short).
    #[test]
    fn parser_arbitrary_bytes(d in proptest::collection::vec(any::<u8>(), 0..1200)) {
        agree(&d);
    }
}

#[test]
fn mint_allowlist_parser() {
    let base = mint_2022_data(6, &[]);
    assert_eq!(token::check_mint(&base, KIND_SPL_TOKEN).unwrap().decimals, 6);
    assert_eq!(token::check_mint(&base, KIND_TOKEN_2022).unwrap().decimals, 6);
    // ScaledUiAmount is allowlisted (V2_SPEC 8.7); its vault path is not testable on the bundled token-2022 1.0.0
    let allowed = [
        ext::METADATA_POINTER,
        ext::TOKEN_METADATA,
        ext::GROUP_POINTER,
        ext::TOKEN_GROUP,
        ext::GROUP_MEMBER_POINTER,
        ext::TOKEN_GROUP_MEMBER,
        ext::INTEREST_BEARING_CONFIG,
        ext::SCALED_UI_AMOUNT,
    ];
    for t in allowed {
        assert!(token::check_mint(&mint_2022_data(6, &[(t, vec![0u8; 40])]), KIND_TOKEN_2022).is_ok(), "{t}");
    }
    assert!(token::check_mint(&mint_2022_data(6, &[(ext::DEFAULT_ACCOUNT_STATE, vec![1])]), KIND_TOKEN_2022).is_ok());
    for t in 0u16..=40 {
        let ok = allowed.contains(&t);
        if t == ext::UNINITIALIZED || t == ext::DEFAULT_ACCOUNT_STATE {
            continue;
        }
        let r = token::check_mint(&mint_2022_data(6, &[(t, vec![0u8; 8])]), KIND_TOKEN_2022);
        assert_eq!(r.is_ok(), ok, "type {t}");
        if !ok {
            assert_eq!(r, Err(E::MintExtensionRejected));
        }
    }
    for v in [vec![0u8], vec![2u8], vec![1u8, 0], vec![]] {
        assert_eq!(token::check_mint(&mint_2022_data(6, &[(ext::DEFAULT_ACCOUNT_STATE, v.clone())]), KIND_TOKEN_2022), Err(E::MintExtensionRejected), "{v:?}");
    }
    // TLV framing, as spl-token-2022 get_tlv_data_info: an Uninitialized type ends the list; one trailing byte is
    // free space; a truncated header or value is malformed
    let mut d = mint_2022_data(6, &[(ext::METADATA_POINTER, vec![0u8; 64])]);
    d.extend_from_slice(&[0, 0, 0, 0, 0, 0]);
    assert!(token::check_mint(&d, KIND_TOKEN_2022).is_ok());
    let mut d1 = mint_2022_data(6, &[(ext::METADATA_POINTER, vec![0u8; 64])]);
    d1.push(0x0c);
    assert!(token::check_mint(&d1, KIND_TOKEN_2022).is_ok(), "one trailing byte");
    let mut d2 = mint_2022_data(6, &[(ext::METADATA_POINTER, vec![0u8; 64])]);
    d2.extend_from_slice(&[0x0c, 0x00, 0x01]);
    assert_eq!(token::check_mint(&d2, KIND_TOKEN_2022), Err(E::MintExtensionRejected), "truncated header");
    let mut d3 = mint_2022_data(6, &[(ext::METADATA_POINTER, vec![0u8; 64])]);
    d3.pop();
    assert_eq!(token::check_mint(&d3, KIND_TOKEN_2022), Err(E::MintExtensionRejected), "truncated value");
    // non-zero padding, wrong account type, lengths between 82 and 166
    let mut d4 = mint_2022_data(6, &[(ext::METADATA_POINTER, vec![0u8; 64])]);
    d4[100] = 1;
    assert_eq!(token::check_mint(&d4, KIND_TOKEN_2022), Err(E::MintExtensionRejected));
    let mut d5 = mint_2022_data(6, &[(ext::METADATA_POINTER, vec![0u8; 64])]);
    d5[165] = 2;
    assert_eq!(token::check_mint(&d5, KIND_TOKEN_2022), Err(E::MintExtensionRejected));
    for len in [83usize, 120, 165] {
        let mut d6 = base.clone();
        d6.resize(len, 0);
        assert!(token::check_mint(&d6, KIND_TOKEN_2022).is_err(), "{len}");
    }
    // SPL Token: exactly 82 bytes; uninitialized mints refused; freeze authority recorded
    let mut d7 = base.clone();
    d7.push(0);
    assert_eq!(token::check_mint(&d7, KIND_SPL_TOKEN), Err(E::AccountMismatch));
    let mut d8 = base.clone();
    d8[45] = 0;
    assert_eq!(token::check_mint(&d8, KIND_SPL_TOKEN), Err(E::AccountMismatch));
    assert!(token::check_mint(&mint_data(6, Some(Pubkey::new_unique())), KIND_SPL_TOKEN).unwrap().freeze_authority_present);
}

#[test]
fn token_account_parser() {
    let m = Pubkey::new_unique();
    let o = Pubkey::new_unique();
    let d = token_account_data(&m, &o, 7, None, 1);
    let t = token::parse_token_account(&d, KIND_SPL_TOKEN).unwrap();
    assert_eq!((t.mint, t.owner, t.amount, t.state), (m, o, 7, 1));
    assert!(token::parse_token_account(&d, KIND_TOKEN_2022).is_some());
    let mut d2 = d.clone();
    d2.extend_from_slice(&[2, 7, 0, 0, 0]);
    assert!(token::parse_token_account(&d2, KIND_TOKEN_2022).is_some());
    assert!(token::parse_token_account(&d2, KIND_SPL_TOKEN).is_none());
    let mut d3 = d.clone();
    d3.extend_from_slice(&[1, 7, 0, 0, 0]);
    assert!(token::parse_token_account(&d3, KIND_TOKEN_2022).is_none(), "a mint is not a token account");
    assert!(token::parse_token_account(&d[..164], KIND_SPL_TOKEN).is_none());
}

#[test]
fn layouts_discriminators_vk_and_errors() {
    use dark_null_transcript::hash::sha256;
    for (name, disc) in [("PoolConfig", state::pool_config::DISC), ("Tree", state::tree::DISC), ("MintState", state::mint_state::DISC)] {
        assert_eq!(&sha256(&[b"account:", name.as_bytes()])[..8], &disc[..], "{name}");
    }
    for (name, disc) in [
        ("transact", dark_null_pool_v2::instructions::TRANSACT),
        ("initialize_pool", dark_null_pool_v2::instructions::INITIALIZE_POOL),
        ("register_mint", dark_null_pool_v2::instructions::REGISTER_MINT),
        ("set_beta_limits", dark_null_pool_v2::instructions::SET_BETA_LIMITS),
        ("set_paused", dark_null_pool_v2::instructions::SET_PAUSED),
    ] {
        assert_eq!(&sha256(&[b"global:", name.as_bytes()])[..8], &disc[..], "{name}");
    }
    assert_eq!(sha256(&[&vk::VK_BYTES]), vk::VK_HASH);
    assert_eq!(vk::NR_PUBLIC_INPUTS, 1);
    // V2_SPEC 8.1 sizes and offsets
    assert_eq!(state::pool_config::LEN, 256);
    assert_eq!(state::pool_config::RESERVED + 64, 256);
    assert_eq!(state::tree::LEN, state::tree::ROOTS + 256 * 32);
    assert_eq!(state::tree::ROOTS, state::tree::FILLED + 32 * 32);
    assert!(state::tree::LEN <= 10_240);
    assert_eq!(state::mint_state::LEN, state::mint_state::RESERVED + 48);
    assert_eq!(dark_null_pool_v2::instructions::TRANSACT_LEN, 1_131);
    // error codes 6000..=6023, contiguous, in the V2_SPEC 8.9 order
    for (k, e) in E::ALL.iter().enumerate() {
        assert_eq!(e.code(), 6000 + k as u32);
    }
}

#[test]
fn pdas_match_v_e2e() {
    let e = load("V-E2E");
    let p = &e["pool"];
    let pid = pk(&p["program_id"]);
    let nonce: [u8; 32] = unhex(load("V-EXTDATA")["pool"]["pool_nonce"].as_str().unwrap()).try_into().unwrap();
    let (pc, b) = pda::pool_config(&pid, &nonce);
    assert_eq!((pc, b as u64), (pk(&p["pool_config"]["address"]), dec(&p["pool_config"]["bump"])));
    let mint = pk(&p["mint"]);
    for (got, key) in [
        (pda::tree(&pid, &pc), "tree"),
        (pda::mint_state(&pid, &pc, &mint), "mint_state"),
        (pda::vault(&pid, &pc, &mint), "vault"),
        (pda::vault_authority(&pid, &pc), "vault_authority"),
    ] {
        assert_eq!((got.0, got.1 as u64), (pk(&p[key]["address"]), dec(&p[key]["bump"])), "{key}");
    }
    let pool_id = dark_null_transcript::pool::pool_id(&SHA256, &pid.to_bytes(), &pc.to_bytes());
    assert_eq!(pool_id.to_vec(), unhex(p["pool_id"].as_str().unwrap()));
    for s in e["steps"].as_array().unwrap() {
        for j in 0..2 {
            let (a, b) = pda::nullifier(&pid, &pc, &fr(&s["public"]["nf"][j]));
            assert_eq!((a, b as u64), (pk(&s["nullifier_pdas"][j]["address"]), dec(&s["nullifier_pdas"][j]["bump"])));
        }
    }
}

#[test]
fn v1_transaction_size_model() {
    // the Phase 0 measured cases (PHASE0_RESULTS 1): a System transfer (2 addresses, 2 account indices, 12 data
    // bytes) is 188 bytes with an empty config and 196 bytes with the compute-unit and loaded-size limits
    let empty = 1 + 3 + 4 + 32 + 1 + 1 + 2 * 32 + 4 + (2 + 12) + 64;
    assert_eq!(empty, 188);
    assert_eq!(v1_size(1, 2, &[2], &[12], false), 196);
}
