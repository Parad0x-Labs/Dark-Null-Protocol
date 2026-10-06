//! Implementation 2 of every v2 vector: re-derive vectors/v2/*.json with this crate (light-poseidon,
//! sha2, own HKDF/bech32m), curve25519-dalek (X25519, ed25519 stealth, PDA curve check) and the
//! independent BabyJubJub reference in tests/common. Implementation 1 is the circomlibjs/node
//! generator in vectors/v2/tools.

mod common;
use common::*;
use dark_null_transcript::address::ShieldedAddress;
use dark_null_transcript::ds;
use dark_null_transcript::extdata::{ext_data_hash, ExtData};
use dark_null_transcript::fr::{self, h248, is_canonical, L_BJJ_BE};
use dark_null_transcript::hash::{sha256, sha512, PoseidonHasher, SoftSha256};
use dark_null_transcript::ix::{TransactIx, LEN as IX_LEN};
use dark_null_transcript::kdf;
use dark_null_transcript::pool;
use dark_null_transcript::preimage::{self, Statement};
use dark_null_transcript::quote::{quote_binding, QuoteFields};
use dark_null_transcript::tree::{self, RootRing, DEPTH, ZEROS};
use num_bigint::BigUint;

#[test]
fn ds_registry_matches_v_ds() {
    let v = load("V-DS");
    let tags = v["tags"].as_object().unwrap();
    assert_eq!(tags.len(), ds::ALL.len());
    let two64 = [0u8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0];
    for (name, value) in ds::ALL.iter() {
        let t = &tags[*name];
        assert_eq!(fr(&t["value"]), *value, "{name}");
        let ascii = t["ascii"].as_str().unwrap().as_bytes();
        assert_eq!(&value[32 - ascii.len()..], ascii, "{name} ascii");
        assert!(is_canonical(value) && fr::lt(&two64, value), "{name} must lie in (2^64, r)");
    }
    for (i, (a, x)) in ds::ALL.iter().enumerate() {
        for (b, y) in ds::ALL.iter().skip(i + 1) {
            assert_ne!(x, y, "{a} == {b}");
        }
    }
    assert_eq!(v["byte_tags"]["EXTDATA"].as_str().unwrap().as_bytes(), ds::TAG_EXTDATA);
    assert_eq!(v["byte_tags"]["POOL_ID"].as_str().unwrap().as_bytes(), ds::TAG_POOL_ID);
    assert_eq!(v["byte_tags"]["QUOTE"].as_str().unwrap().as_bytes(), ds::TAG_QUOTE);
    assert_eq!(v["byte_tags"]["RCPT_CHAIN"].as_str().unwrap().as_bytes(), ds::TAG_RCPT_CHAIN);
    assert_eq!(v["byte_tags"]["EDDSA_NONCE"].as_str().unwrap().as_bytes(), ds::TAG_EDDSA_NONCE);
    assert_eq!(v["kdf"]["salt"].as_str().unwrap().as_bytes(), ds::KDF_SALT);
    let info = &v["kdf"]["info"];
    for (k, c) in [
        ("ASK", ds::kdf_info::ASK),
        ("ASK_NONCE", ds::kdf_info::ASK_NONCE),
        ("NK", ds::kdf_info::NK),
        ("IVK", ds::kdf_info::IVK),
        ("IVK_D", ds::kdf_info::IVK_D),
        ("OVK", ds::kdf_info::OVK),
        ("CHAN", ds::kdf_info::CHAN),
        ("CHAN_NONCE", ds::kdf_info::CHAN_NONCE),
        ("STEALTH", ds::kdf_info::STEALTH),
    ] {
        assert_eq!(info[k].as_str().unwrap().as_bytes(), c, "{k}");
    }
    for (name, d) in [
        ("transact", ds::discriminator::TRANSACT),
        ("initialize_pool", ds::discriminator::INITIALIZE_POOL),
        ("register_mint", ds::discriminator::REGISTER_MINT),
        ("set_beta_limits", ds::discriminator::SET_BETA_LIMITS),
        ("set_paused", ds::discriminator::SET_PAUSED),
    ] {
        assert_eq!(sha256(&[format!("global:{name}").as_bytes()])[..8], d, "{name}");
    }
}

#[test]
fn v_pos_all_widths() {
    let v = load("V-POS");
    let cases = v["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 24);
    for c in cases {
        let inputs: Vec<_> = c["inputs"].as_array().unwrap().iter().map(fr).collect();
        assert_eq!(HP.poseidon(&inputs).unwrap(), fr(&c["output"]), "n={}", c["n"]);
    }
}

#[test]
fn phase0_derivation_vectors() {
    let a = load("V-ASSET");
    let mint = b58dec(a["mint"].as_str().unwrap());
    let (hi, lo) = fr::pubkey_fields(&mint);
    assert_eq!((hi, lo), (fr(&a["mint_hi"]), fr(&a["mint_lo"])));
    let asset = preimage::asset_id(&HP, &mint).unwrap();
    assert_eq!(asset, fr(&a["asset"]));

    let k = load("V-KEYS");
    let ak = [fr(&k["ak"][0]), fr(&k["ak"][1])];
    assert_eq!(preimage::nk(&HP, &from_u64_fr(1)).unwrap(), fr(&k["nk"]));
    assert_eq!(preimage::owner_pk(&HP, &ak[0], &ak[1], &fr(&k["nk"])).unwrap(), fr(&k["owner"]));
    assert!(on_curve(&(fe(&ak[0]), fe(&ak[1]))));

    let n = load("V-NOTE");
    let mut cms = vec![];
    for c in n["cases"].as_array().unwrap() {
        let cm = preimage::note_commitment(&HP, dec_u64(&c["value"]), &asset, &fr(&c["owner"]), &fr(&c["salt"]), &fr(&c["label"])).unwrap();
        assert_eq!(cm, fr(&c["cm"]));
        cms.push(cm);
    }
    let f = load("V-NF");
    let mut nfs = vec![];
    for c in f["cases"].as_array().unwrap() {
        let nf = preimage::nullifier(&HP, &fr(&c["nk"]), &fr(&c["cm"]), dec_u64(&c["leaf_index"])).unwrap();
        assert_eq!(nf, fr(&c["nf"]));
        nfs.push(nf);
    }
    // Phase 0 fixture: ext_data_hash = h248(SHA256(ascii)) without the final tag (draft rule; V2_SPEC adds the tag).
    let s = load("V-SIGHASH");
    let edh = h248(&sha256(&[s["ext_data_ascii"].as_str().unwrap().as_bytes()]));
    assert_eq!(edh, fr(&s["ext_data_hash"]));
    let pa = preimage::public_amount(0, 150).unwrap();
    assert_eq!(pa, fr(&s["public_amount_field"]));
    let t = load("V-TREE");
    let root = sparse_root(&[(dec_u64(&t["leaves"][0]["index"]), cms[0]), (dec_u64(&t["leaves"][1]["index"]), cms[1])]);
    assert_eq!(root, fr(&t["root"]));
    assert_eq!(ZEROS[DEPTH], fr(&t["zero_root"]));
    let st = Statement { root, nf: [nfs[0], nfs[1]], cm: [cms[2], cms[3]], public_amount: pa, public_asset: asset, ext_data_hash: edh, epoch: dec_u64(&s["now_epoch"]), deposit_label: fr::ZERO, assoc_root: fr::ZERO };
    assert_eq!(st.sighash(&HP).unwrap(), fr(&s["sighash"]));
    // the Phase 0 signature verifies under the independent BabyJubJub reference
    let r8 = (fe(&fr(&s["sig"]["R8"][0])), fe(&fr(&s["sig"]["R8"][1])));
    assert!(eddsa_verify(&(fe(&ak[0]), fe(&ak[1])), &r8, &big(&fr(&s["sig"]["S"])), &fr(&s["sighash"])));
    let p = load("V-PI");
    assert_eq!(st.pi(&HP).unwrap(), fr(&p["skeleton_pi"]));
    let st2 = Statement { assoc_root: fr(&p["fullsize_assoc_root"]), ..st };
    assert_eq!(st2.pi(&HP).unwrap(), fr(&p["fullsize_pi"]));
}

fn sparse_root(leaves: &[(u64, fr::Fr32)]) -> fr::Fr32 {
    use std::collections::BTreeMap;
    let mut level: BTreeMap<u64, fr::Fr32> = leaves.iter().copied().collect();
    for d in 0..DEPTH {
        let mut next = BTreeMap::new();
        for (&i, _) in level.iter() {
            let p = i >> 1;
            if next.contains_key(&p) {
                continue;
            }
            let l = *level.get(&(p * 2)).unwrap_or(&ZEROS[d]);
            let r = *level.get(&(p * 2 + 1)).unwrap_or(&ZEROS[d]);
            next.insert(p, preimage::tree_node(&HP, &l, &r).unwrap());
        }
        level = next;
    }
    level[&0]
}

#[test]
fn zeros_match_poseidon() {
    let mut z = fr::ZERO;
    assert_eq!(ZEROS[0], z);
    for (i, expected) in ZEROS.iter().enumerate().skip(1) {
        z = preimage::tree_node(&HP, &z, &z).unwrap();
        assert_eq!(&z, expected, "level {i}");
    }
    let e = load("V-E2E");
    for (i, zv) in e["tree"]["zeros"].as_array().unwrap().iter().enumerate() {
        assert_eq!(fr(zv), ZEROS[i]);
    }
}

fn x25519_pub(secret: &[u8; 32]) -> [u8; 32] {
    let mut k = *secret;
    k[0] &= 248;
    k[31] &= 127;
    k[31] |= 64;
    (curve25519_dalek::constants::X25519_BASEPOINT * curve25519_dalek::scalar::Scalar::from_bits(k)).to_bytes()
}

#[test]
fn v_addr_keys_and_addresses() {
    let v = load("V-ADDR");
    assert_eq!(fr(&v["constants"]["l_bjj"]), L_BJJ_BE);
    assert_eq!(big(&L_BJJ_BE), l_bjj());
    for (_, acc) in v["accounts"].as_object().unwrap() {
        let seed = b32(&acc["seed"]);
        let account = acc["account_index"].as_u64().unwrap() as u32;
        let d = acc["diversifier"].as_u64().unwrap() as u32;
        let ask = kdf::ask(&seed, account).unwrap();
        assert_eq!(ask, fr(&acc["ask"]));
        assert_eq!(kdf::ask_nonce_key(&seed, account), b32(&acc["ask_nonce_key"]));
        let ak = mul(&b8(), &big(&ask));
        assert_eq!(pt_bytes(&ak), [fr(&acc["ak"][0]), fr(&acc["ak"][1])]);
        assert_eq!(pack(&ak), b32(&acc["ak_packed"]));
        assert_eq!(unpack(&pack(&ak)).unwrap(), ak);
        let nk_seed = kdf::nk_seed(&seed, account);
        assert_eq!(nk_seed, fr(&acc["nk_seed"]));
        let nk = preimage::nk(&HP, &nk_seed).unwrap();
        assert_eq!(nk, fr(&acc["nk"]));
        let pk = preimage::owner_pk(&HP, &fe_bytes(&ak.0), &fe_bytes(&ak.1), &nk).unwrap();
        assert_eq!(pk, fr(&acc["pk"]));
        let ivk_root = kdf::ivk_root(&seed, account);
        assert_eq!(ivk_root, b32(&acc["ivk_root"]));
        let ivk_d = kdf::ivk_d(&ivk_root, d);
        assert_eq!(ivk_d, b32(&acc["ivk_d"]));
        let ivk_pub = x25519_pub(&ivk_d);
        assert_eq!(ivk_pub, b32(&acc["ivk_pub_d"]));
        assert_eq!(kdf::ovk(&seed, account), b32(&acc["ovk"]));
        assert_eq!(kdf::stealth_spend_seed(&seed, account), b32(&acc["stealth_spend_seed"]));
        let addr = ShieldedAddress { pk, ivk_pub, diversifier: d };
        assert_eq!(addr.payload().to_vec(), bytes(&acc["address_payload"]));
        let mut buf = [0u8; dark_null_transcript::address::ENCODED_LEN];
        let s = addr.encode(&mut buf);
        assert_eq!(s, acc["address"].as_str().unwrap());
        assert_eq!(ShieldedAddress::decode(s).unwrap(), addr);
        // one flipped character fails the checksum
        let mut bad = s.as_bytes().to_vec();
        bad[40] = if bad[40] == b'q' { b'p' } else { b'q' };
        assert!(ShieldedAddress::decode(std::str::from_utf8(&bad).unwrap()).is_err());
    }
    // ed25519 stealth (DNA x402 dark-stealth-ed25519 scheme) with curve25519-dalek
    use curve25519_dalek::constants::ED25519_BASEPOINT_TABLE as BT;
    use curve25519_dalek::edwards::CompressedEdwardsY;
    use curve25519_dalek::scalar::Scalar;
    let st = &v["stealth"];
    let wide = |b: [u8; 64]| Scalar::from_bytes_mod_order_wide(&b);
    let le_be = |s: &Scalar| {
        let mut b = s.to_bytes();
        b.reverse();
        b
    };
    let s = Scalar::from_bytes_mod_order(b32(&st["spend_seed"]));
    assert_eq!(le_be(&s), fr(&st["s"]));
    let vv = wide(sha512(&[v["constants"]["stealth_tag_view"].as_str().unwrap().as_bytes(), &s.to_bytes()]));
    assert_eq!(le_be(&vv), fr(&st["v"]));
    let sp = (&s * &BT).compress().to_bytes();
    let vp = (&vv * &BT).compress().to_bytes();
    assert_eq!(sp.to_vec(), bytes(&st["meta_address"]["spend_pub"]));
    assert_eq!(vp.to_vec(), bytes(&st["meta_address"]["view_pub"]));
    let r = Scalar::from_bytes_mod_order(b32(&st["ephemeral_seed"]));
    let big_r = (&r * &BT).compress().to_bytes();
    assert_eq!(big_r.to_vec(), bytes(&st["R"]));
    let rv = (r * CompressedEdwardsY(vp).decompress().unwrap()).compress().to_bytes();
    let shared = wide(sha512(&[v["constants"]["stealth_tag_shared"].as_str().unwrap().as_bytes(), &rv]));
    assert_eq!(le_be(&shared), fr(&st["shared"]));
    let p_pt = CompressedEdwardsY(sp).decompress().unwrap() + &shared * &BT;
    assert_eq!(p_pt.compress().to_bytes().to_vec(), bytes(&st["P"]));
    let p = s + shared;
    assert_eq!(p.to_bytes().to_vec(), bytes(&st["p_le"]));
    assert_eq!((&p * &BT).compress(), p_pt.compress());
    // the recipient's view-only scan recomputes the same shared secret from R
    let vr = (vv * CompressedEdwardsY(big_r).decompress().unwrap()).compress().to_bytes();
    assert_eq!(vr, rv);
    let token = b58dec("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    let ata_prog = b58dec("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
    let mint = b58dec(st["mint"].as_str().unwrap());
    let (ata, _) = find_pda(&[&p_pt.compress().to_bytes(), &token, &mint], &ata_prog);
    assert_eq!(b58enc(&ata), st["ata_P"].as_str().unwrap());
}

fn ext_from_fields(f: &serde_json::Value) -> ExtData {
    ExtData {
        pool_id: b32(&f["pool_id"]),
        public_token_account: b58dec(f["public_token_account"].as_str().unwrap()),
        relayer_fee_account: b58dec(f["relayer_fee_account"].as_str().unwrap()),
        relayer_fee: dec_u64(&f["relayer_fee"]),
        memo_binding: b32(&f["memo_binding"]),
        stealth_ephemeral: b32(&f["stealth_ephemeral"]),
        ciphertext0: bytes(&f["ciphertext0"]).try_into().unwrap(),
        ciphertext1: bytes(&f["ciphertext1"]).try_into().unwrap(),
        ciphertext_rec: bytes(&f["ciphertext_rec"]).try_into().unwrap(),
    }
}

#[test]
fn v_extdata_pool_quote_and_mutations() {
    let v = load("V-EXTDATA");
    let pl = &v["pool"];
    let program = b58dec(pl["program_id"].as_str().unwrap());
    let nonce = b32(&pl["pool_nonce"]);
    let (cfg, bump) = find_pda(&[pool::SEED_POOL, &nonce], &program);
    assert_eq!(b58enc(&cfg), pl["pool_config"]["address"].as_str().unwrap());
    assert_eq!(bump as u64, pl["pool_config"]["bump"].as_u64().unwrap());
    let pid = pool::pool_id(&SoftSha256, &program, &cfg);
    assert_eq!(pid, b32(&pl["pool_id"]));
    assert_eq!(pool::pool_id_fr(&pid), fr(&pl["pool_id_fr"]));
    let q = &v["quote"];
    let qb = quote_binding(&QuoteFields {
        quote_id: q["quoteId"].as_str().unwrap(),
        resource: q["resource"].as_str().unwrap(),
        amount_atomic: dec_u64(&q["amountAtomic"]),
        total_atomic: dec_u64(&q["totalAtomic"]),
        mint: b58dec(q["mint"].as_str().unwrap()),
        pay_to: q["payTo"].as_str().unwrap(),
        expires_at_unix: q["expires_at_unix"].as_i64().unwrap(),
    })
    .unwrap();
    assert_eq!(qb, b32(&q["quote_binding"]));
    let ex = &v["example"];
    let e = ext_from_fields(&ex["fields"]);
    assert_eq!(e.memo_binding, qb);
    let enc = e.encode();
    assert_eq!(enc.to_vec(), bytes(&ex["bytes"]));
    assert_eq!(ExtData::decode(&enc).unwrap(), e);
    assert_eq!(ext_data_hash(&SoftSha256, &enc).unwrap(), fr(&ex["ext_data_hash"]));
    // layout table and X-RELAY precursor: every field mutation changes the hash
    for m in v["mutations"].as_array().unwrap() {
        let mut b = enc;
        let off = m["flipped_offset"].as_u64().unwrap() as usize;
        b[off] ^= 1;
        let h = ext_data_hash(&SoftSha256, &b).unwrap();
        assert_eq!(h, fr(&m["ext_data_hash"]), "{}", m["field"]);
        assert_ne!(h, fr(&ex["ext_data_hash"]));
    }
    let mut bad = enc;
    bad[0] = 2;
    assert!(ExtData::decode(&bad).is_err());
    assert!(ext_data_hash(&SoftSha256, &enc[..648]).is_err());
}

#[test]
fn v_voucher_channel_and_signatures() {
    let v = load("V-VOUCHER");
    let addr = load("V-ADDR");
    let seed_a = b32(&addr["accounts"]["alice"]["seed"]);
    let c = &v["channel"];
    let nonce = b32(&c["chan_nonce"]);
    let sess = kdf::bjj_session(&seed_a, &nonce).unwrap();
    assert_eq!(sess, fr(&c["bjj_session"]));
    let nk_key = kdf::bjj_session_nonce_key(&seed_a, &nonce);
    assert_eq!(nk_key, b32(&c["bjj_nonce_key"]));
    let sess_pub = mul(&b8(), &big(&sess));
    assert_eq!(pt_bytes(&sess_pub), [fr(&c["bjj_session_pub"][0]), fr(&c["bjj_session_pub"][1])]);
    assert_eq!(pack(&sess_pub), b32(&c["bjj_session_pub_packed"]));
    let nk_ch = preimage::nk_channel(&HP, &fr(&c["chan_secret"])).unwrap();
    assert_eq!(nk_ch, fr(&c["nk_ch"]));
    let owner = preimage::channel_owner(&HP, &fr(&c["merchant_owner"]), &fr(&c["refund_owner"]), &pt_bytes(&sess_pub), dec_u64(&c["expiry_epoch"]), &nk_ch).unwrap();
    assert_eq!(owner, fr(&c["owner_ch"]));
    assert_eq!(fr(&c["merchant_owner"]), fr(&addr["accounts"]["bob"]["pk"]));
    let e2e = load("V-E2E");
    let pool_id_fr = fr(&e2e["pool"]["pool_id_fr"]);
    let label = preimage::deposit_label(&HP, &pool_id_fr, dec_u64(&c["label_counter"])).unwrap();
    assert_eq!(label, fr(&c["label"]));
    let chan_id = preimage::note_commitment(&HP, dec_u64(&c["cap"]), &fr(&c["asset"]), &owner, &fr(&c["salt"]), &label).unwrap();
    assert_eq!(chan_id, fr(&c["chan_id"]));
    let mut head = [0u8; 32];
    let mut prev_cum = 0u64;
    for vc in v["vouchers"].as_array().unwrap() {
        let cum = dec_u64(&vc["cumulative"]);
        assert_eq!(cum - prev_cum, dec_u64(&vc["amount"]));
        assert!(cum <= dec_u64(&c["cap"]));
        prev_cum = cum;
        assert_eq!(b32(&vc["receipt_head_prev"]), head);
        let msg = preimage::voucher_msg(&HP, &chan_id, cum, &head).unwrap();
        assert_eq!(msg, fr(&vc["voucher_msg"]));
        let (r8, s, hm) = eddsa_sign(&sess, &nk_key, &msg);
        assert_eq!(pt_bytes(&r8), [fr(&vc["sig"]["R8"][0]), fr(&vc["sig"]["R8"][1])]);
        assert_eq!(big_bytes(&s), fr(&vc["sig"]["S"]));
        assert_eq!(hm, fr(&vc["sig"]["hm"]));
        let packed = pack_sig(&r8, &s);
        assert_eq!(packed.to_vec(), bytes(&vc["sig"]["packed"]));
        // verify from the packed wire form
        let wire = bytes(&vc["wire"]);
        assert_eq!(wire.len(), 136);
        assert_eq!(&wire[..32], &chan_id);
        assert_eq!(u64::from_le_bytes(wire[32..40].try_into().unwrap()), cum);
        assert_eq!(&wire[40..72], &head);
        let r8w = unpack(&wire[72..104].try_into().unwrap()).unwrap();
        let mut s_le: [u8; 32] = wire[104..136].try_into().unwrap();
        s_le.reverse();
        assert!(eddsa_verify(&sess_pub, &r8w, &BigUint::from_bytes_be(&s_le), &msg));
        assert!(!eddsa_verify(&sess_pub, &r8w, &BigUint::from_bytes_be(&s_le), &fr::add_mod_r(&msg, &from_u64_fr(1))));
        let next = preimage::receipt_head_next(&head, &msg, &b32(&vc["dna_receipt_hash"]));
        assert_eq!(next, b32(&vc["receipt_head"]));
        head = next;
    }
    let an = &v["epoch_anchor"];
    assert_eq!(head, b32(&an["receipt_head_final"]));
    assert_eq!(preimage::receipt_anchor(&HP, &head, &fr(&an["salt"])).unwrap(), fr(&an["memo_binding"]));
}

#[test]
fn v_e2e_join_split_sequence() {
    let e = load("V-E2E");
    let addr = load("V-ADDR");
    let p = &e["pool"];
    let program = b58dec(p["program_id"].as_str().unwrap());
    let cfg = b58dec(p["pool_config"]["address"].as_str().unwrap());
    let mint = b58dec(p["mint"].as_str().unwrap());
    let asset = preimage::asset_id(&HP, &mint).unwrap();
    assert_eq!(asset, fr(&p["asset"]));
    let pid = pool::pool_id(&SoftSha256, &program, &cfg);
    assert_eq!(pid, b32(&p["pool_id"]));
    let pid_fr = pool::pool_id_fr(&pid);
    for (name, seeds) in [
        ("tree", vec![pool::SEED_TREE, &cfg[..]]),
        ("mint_state", vec![pool::SEED_MINT, &cfg[..], &mint[..]]),
        ("vault", vec![pool::SEED_VAULT, &cfg[..], &mint[..]]),
        ("vault_authority", vec![pool::SEED_VAULT_AUTH, &cfg[..]]),
    ] {
        let (a, b) = find_pda(&seeds, &program);
        assert_eq!(b58enc(&a), p[name]["address"].as_str().unwrap(), "{name}");
        assert_eq!(b as u64, p[name]["bump"].as_u64().unwrap(), "{name}");
    }
    let key = |who: &str| {
        let a = &addr["accounts"][who];
        let seed = b32(&a["seed"]);
        let ask = kdf::ask(&seed, 0).unwrap();
        let ak = mul(&b8(), &big(&ask));
        let nk = preimage::nk(&HP, &kdf::nk_seed(&seed, 0)).unwrap();
        let pk = preimage::owner_pk(&HP, &fe_bytes(&ak.0), &fe_bytes(&ak.1), &nk).unwrap();
        (ask, kdf::ask_nonce_key(&seed, 0), ak, nk, pk)
    };
    let mut filled = [fr::ZERO; DEPTH];
    let mut ring = RootRing::default();
    let mut next_index = 0u64;
    let mut deposit_counter = 0u64;
    let mut supply = 0u64;
    let epoch = dec_u64(&e["claimed_epoch"]);
    for st in e["steps"].as_array().unwrap() {
        let (ask, nonce_key, ak, nk, pk) = key(st["spender"].as_str().unwrap());
        let pv = &st["private"];
        let pu = &st["public"];
        let root = fr(&pu["root"]);
        let hint = pu["root_hint"].as_u64().unwrap() as u16;
        ring.check(hint, &root).unwrap();
        // inputs
        let mut nf = [fr::ZERO; 2];
        for (i, inp) in pv["inputs"].as_array().unwrap().iter().enumerate() {
            let value = dec_u64(&inp["value"]);
            let cm = preimage::note_commitment(&HP, value, &asset, &pk, &fr(&inp["salt"]), &fr(&inp["label"])).unwrap();
            assert_eq!(cm, fr(&inp["cm"]));
            let idx = inp["leaf_index"].as_u64().unwrap();
            if value != 0 {
                let sib: Vec<_> = inp["path"].as_array().unwrap().iter().map(fr).collect();
                let r = tree::root_from_path(&HP, &cm, idx, &sib.try_into().unwrap()).unwrap();
                assert_eq!(r, root, "membership");
            }
            nf[i] = preimage::nullifier(&HP, &nk, &cm, idx).unwrap();
            assert_eq!(nf[i], fr(&pu["nf"][i]));
        }
        // outputs
        let mut cm = [fr::ZERO; 2];
        let mut out_sum = 0u128;
        for (j, o) in pv["outputs"].as_array().unwrap().iter().enumerate() {
            let value = dec_u64(&o["value"]);
            out_sum += value as u128;
            cm[j] = preimage::note_commitment(&HP, value, &asset, &fr(&o["owner"]), &fr(&o["salt"]), &fr(&o["label"])).unwrap();
            assert_eq!(cm[j], fr(&pu["cm"][j]));
        }
        let dep = dec_u64(&pu["deposit_amount"]);
        let wd = dec_u64(&pu["withdraw_amount"]);
        let in_sum: u128 = pv["inputs"].as_array().unwrap().iter().map(|i| dec_u64(&i["value"]) as u128).sum();
        assert_eq!(in_sum + dep as u128, out_sum + wd as u128, "conservation");
        // labels
        let dl = if dep > 0 { preimage::deposit_label(&HP, &pid_fr, deposit_counter).unwrap() } else { fr::ZERO };
        assert_eq!(dl, fr(&pu["deposit_label"]));
        for o in pv["outputs"].as_array().unwrap() {
            let expect = if dep > 0 { dl } else { fr(&pv["inputs"][0]["label"]) };
            assert_eq!(fr(&o["label"]), expect);
        }
        // ext_data and the instruction
        let ext = ext_from_fields(&st["ext_data"]["fields"]);
        assert_eq!(ext.pool_id, pid);
        let ext_bytes = ext.encode();
        assert_eq!(ext_bytes.to_vec(), bytes(&st["ext_data"]["bytes"]));
        let edh = ext_data_hash(&SoftSha256, &ext_bytes).unwrap();
        assert_eq!(edh, fr(&pu["ext_data_hash"]));
        let ix_bytes = bytes(&st["instruction"]["data_with_zero_proof"]);
        assert_eq!(ix_bytes.len(), IX_LEN);
        let ix = TransactIx::decode(&ix_bytes).unwrap();
        assert_eq!(ix.encode().to_vec(), ix_bytes);
        assert_eq!((ix.root, ix.nf, ix.cm, ix.root_hint, ix.claimed_epoch), (root, nf, cm, hint, epoch));
        assert_eq!(ix.ext_data, ext_bytes);
        let stmt = ix.statement(&asset, &edh, &dl).unwrap();
        assert_eq!(stmt.public_amount, fr(&pu["public_amount"]));
        assert_eq!(stmt.public_asset, fr(&pu["public_asset"]));
        let sighash = stmt.sighash(&HP).unwrap();
        assert_eq!(sighash, fr(&pv["sighash"]));
        assert_eq!(stmt.pi(&HP).unwrap(), fr(&pu["pi"]));
        // spend authorization: reproduce and verify the signature
        let (r8, s, _) = eddsa_sign(&ask, &nonce_key, &sighash);
        assert_eq!(pt_bytes(&r8), [fr(&pv["sig"]["R8"][0]), fr(&pv["sig"]["R8"][1])]);
        assert_eq!(big_bytes(&s), fr(&pv["sig"]["S"]));
        assert_eq!(pack_sig(&r8, &s).to_vec(), bytes(&pv["sig"]["packed"]));
        assert!(eddsa_verify(&ak, &r8, &s, &sighash));
        // nullifier PDAs (canonical bump)
        for i in 0..2 {
            let (a, b) = find_pda(&[pool::SEED_NF, &cfg, &nf[i]], &program);
            assert_eq!(b58enc(&a), st["nullifier_pdas"][i]["address"].as_str().unwrap());
            assert_eq!(b as u64, st["nullifier_pdas"][i]["bump"].as_u64().unwrap());
        }
        // on-chain insertion algorithm and root history
        let new_root = tree::insert_pair(&HP, &mut filled, next_index, &cm[0], &cm[1]).unwrap();
        let after = &st["after"];
        assert_eq!(after["leaf_indices"][0].as_u64().unwrap(), next_index);
        assert_eq!(new_root, fr(&after["new_root"]));
        next_index += 2;
        let h = ring.push(new_root);
        assert_eq!(h as u64, after["new_root_hint"].as_u64().unwrap());
        // the insertion root equals full recomputation of the new leaves' paths
        if dep > 0 {
            deposit_counter += 1;
            supply += dep;
        } else {
            supply -= wd;
        }
        assert_eq!(supply, dec_u64(&after["supply"]));
        assert_eq!(deposit_counter, dec_u64(&after["deposit_counter"]));
        let fee = ext.relayer_fee;
        assert!(fee <= wd || (dep > 0 && fee == 0));
        assert_eq!(dec_u64(&after["public_account_receives"]), wd - fee);
    }
    assert_eq!(fr(&e["final"]["root"]), ring.roots[ring.head as usize]);
}
