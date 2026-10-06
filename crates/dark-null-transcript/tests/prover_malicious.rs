//! Prover-malicious transcript harness, ported from the canonical-transcript harness of prior
//! internal research (Aug 2026) and re-targeted to the v2 statement.
//!
//! REFERENCE: a model of the program's pre-proof checks and `pi` derivation (V2_SPEC 8.5), using
//! only what the program receives (instruction bytes, its own pool, root ring, clock, nullifier
//! set). A Groth16 proof generated for public input `claimed_pi` verifies only if the program
//! derives the same `pi`, so "rejected" below means either a pre-check fails or the program's
//! `pi` differs from the prover's.
//!
//! MALICIOUS CLIENT: one strategy per scenario. Each test asserts the reference REJECTS it, and the
//! valid baseline is ACCEPTED. Scenario list (V2_SPEC 13.2): S1 Poseidon parameter/width mismatch,
//! S2 missing domain separation, S3 ext_data_hash over bytes the program does not see, S4 root-hint
//! swap, S5 cross-pool replay, S6 epoch window, S7 non-canonical field element, S8 non-canonical PDA
//! bump, S9 replay, S10 byte-order and hash-to-field divergence, S11 relayer mutation of every
//! ext_data field, S12 two public legs, S13 output order swap.

mod common;
use common::*;
use dark_null_transcript::ds;
use dark_null_transcript::extdata::{ext_data_hash, ExtData, LEN as EXT_LEN};
use dark_null_transcript::fr::{self, h248, Fr32, R_BE};
use dark_null_transcript::hash::{sha256, PoseidonHasher, SoftSha256};
use dark_null_transcript::ix::{TransactIx, EXT_DATA_OFFSET};
use dark_null_transcript::pool;
use dark_null_transcript::preimage::{self, Statement};
use dark_null_transcript::tree::RootRing;
use dark_null_transcript::Error;
use std::collections::HashSet;

#[derive(Debug, PartialEq)]
enum Reject {
    Decode(Error),
    WrongPool,
    UnknownRoot,
    EpochWindow,
    ProofMismatch,
    NullifierAccount,
    DoubleSpend,
}

struct PoolModel {
    program: [u8; 32],
    config: [u8; 32],
    pool_id: [u8; 32],
    asset: Fr32,
    ring: RootRing,
    now_epoch: u64,
    deposit_counter: u64,
    spent: HashSet<[u8; 32]>,
}

impl PoolModel {
    fn from_vectors(step: usize) -> (Self, serde_json::Value) {
        let e = load("V-E2E");
        let p = &e["pool"];
        let program = b58dec(p["program_id"].as_str().unwrap());
        let config = b58dec(p["pool_config"]["address"].as_str().unwrap());
        let mut ring = RootRing::default();
        for r in e["final"]["roots"].as_array().unwrap().iter().skip(1) {
            ring.push(fr(r));
        }
        let m = Self {
            program,
            config,
            pool_id: pool::pool_id(&SoftSha256, &program, &config),
            asset: fr(&p["asset"]),
            ring,
            now_epoch: dec_u64(&e["claimed_epoch"]),
            deposit_counter: step as u64, // deposits before this step (the vector deposits once, first)
            spent: HashSet::new(),
        };
        (m, e["steps"][step].clone())
    }

    /// The program's derivation of `pi` from what it receives, plus every pre-proof check.
    fn verify(&mut self, ix_bytes: &[u8], nf_accounts: [[u8; 32]; 2], claimed_pi: &Fr32) -> Result<(), Reject> {
        let ix = TransactIx::decode(ix_bytes).map_err(Reject::Decode)?;
        let ext = ExtData::decode(&ix.ext_data).map_err(Reject::Decode)?;
        if ext.pool_id != self.pool_id {
            return Err(Reject::WrongPool);
        }
        self.ring.check(ix.root_hint, &ix.root).map_err(|_| Reject::UnknownRoot)?;
        if ix.claimed_epoch.abs_diff(self.now_epoch) > 1 {
            return Err(Reject::EpochWindow);
        }
        let edh = ext_data_hash(&SoftSha256, &ix.ext_data).map_err(Reject::Decode)?;
        let dl = if ix.deposit_amount > 0 { preimage::deposit_label(&HP, &pool::pool_id_fr(&self.pool_id), self.deposit_counter).unwrap() } else { fr::ZERO };
        let pi = ix.statement(&self.asset, &edh, &dl).map_err(Reject::Decode)?.pi(&HP).map_err(Reject::Decode)?;
        if &pi != claimed_pi {
            return Err(Reject::ProofMismatch);
        }
        for i in 0..2 {
            let (canonical, _) = find_pda(&[pool::SEED_NF, &self.config, &ix.nf[i]], &self.program);
            if nf_accounts[i] != canonical {
                return Err(Reject::NullifierAccount);
            }
        }
        for a in nf_accounts {
            if !self.spent.insert(a) {
                return Err(Reject::DoubleSpend);
            }
        }
        Ok(())
    }
}

/// Valid client view of one vector step: the instruction bytes and the pi it proves.
struct Client {
    ix: TransactIx,
    stmt: Statement,
    nf_accounts: [[u8; 32]; 2],
}

fn valid_client(step: usize) -> (PoolModel, Client) {
    let (m, st) = PoolModel::from_vectors(step);
    let ix = TransactIx::decode(&bytes(&st["instruction"]["data_with_zero_proof"])).unwrap();
    let edh = ext_data_hash(&SoftSha256, &ix.ext_data).unwrap();
    let stmt = ix.statement(&m.asset, &edh, &fr(&st["public"]["deposit_label"])).unwrap();
    let nf_accounts = [0, 1].map(|i| b58dec(st["nullifier_pdas"][i]["address"].as_str().unwrap()));
    (m, Client { ix, stmt, nf_accounts })
}

fn pi_of(c: &Client) -> Fr32 {
    c.stmt.pi(&HP).unwrap()
}

#[test]
fn baseline_valid_steps_accepted() {
    for step in 0..3 {
        let (mut m, c) = valid_client(step);
        assert_eq!(m.verify(&c.ix.encode(), c.nf_accounts, &pi_of(&c)), Ok(()), "step {step}");
    }
}

/// S1: the client's Poseidon differs from the chain's: (a) inputs fed little-endian, (b) a trailing
/// zero input elided (width 11 instead of 12; SIMD-0359 makes the syscall reject silent padding).
#[test]
fn s1_poseidon_mismatch_detected() {
    let (mut m, c) = valid_client(1);
    let le: Vec<Fr32> = c.stmt.pi_inputs().iter().map(|x| fr::reduce_be(&fr::reverse(x), &R_BE)).collect();
    let pi_le = HP.poseidon(&le).unwrap();
    assert_eq!(m.verify(&c.ix.encode(), c.nf_accounts, &pi_le), Err(Reject::ProofMismatch));
    let pi_11 = HP.poseidon(&c.stmt.pi_inputs()[..11]).unwrap();
    assert_eq!(c.stmt.assoc_root, fr::ZERO);
    assert_eq!(m.verify(&c.ix.encode(), c.nf_accounts, &pi_11), Err(Reject::ProofMismatch));
}

/// S2: no domain tag. The tagged pi is rejected when the client drops DS_PI; and two families of equal
/// width collide without tags (nullifier vs voucher over the same three elements) but not with them.
#[test]
fn s2_missing_domain_separation_detected() {
    let (mut m, c) = valid_client(2);
    let mut untagged = c.stmt.pi_inputs();
    untagged[0] = fr::ZERO;
    let pi_untagged = HP.poseidon(&untagged).unwrap();
    assert_eq!(m.verify(&c.ix.encode(), c.nf_accounts, &pi_untagged), Err(Reject::ProofMismatch));
    let (a, b, x) = (fr::from_u64(11), fr::from_u64(22), fr::from_u64(33));
    assert_eq!(HP.poseidon(&[a, b, x]).unwrap(), HP.poseidon(&[a, b, x]).unwrap());
    let nf_like = HP.poseidon(&[ds::DS_NF, a, b, x]).unwrap();
    let voucher_like = HP.poseidon(&[ds::DS_VOUCHER, a, b, x]).unwrap();
    assert_ne!(nf_like, voucher_like, "tags must separate equal-width families");
    // sighash and pi never share a preimage: different widths and different tags
    assert_ne!(c.stmt.sighash(&HP).unwrap(), c.stmt.pi(&HP).unwrap());
}

/// S3: ext_data_hash computed over bytes the program never receives (account list appended), or with
/// the Phase 0 draft rule (no tag). Both change pi.
#[test]
fn s3_ext_data_hash_over_unseen_bytes_detected() {
    let (mut m, c) = valid_client(1);
    let extra = h248(&sha256(&[ds::TAG_EXTDATA, &c.ix.ext_data, &c.nf_accounts[0]]));
    let no_tag = h248(&sha256(&[&c.ix.ext_data]));
    for edh in [extra, no_tag] {
        let st = Statement { ext_data_hash: edh, ..c.stmt };
        assert_eq!(m.verify(&c.ix.encode(), c.nf_accounts, &st.pi(&HP).unwrap()), Err(Reject::ProofMismatch));
    }
}

/// S4: root hint pointing at another slot, or at an empty slot with a zero root.
#[test]
fn s4_root_hint_swap_detected() {
    let (mut m, c) = valid_client(2);
    let mut ix = c.ix;
    ix.root_hint = 1; // holds root1, the proof is against root2
    assert_eq!(m.verify(&ix.encode(), c.nf_accounts, &pi_of(&c)), Err(Reject::UnknownRoot));
    let mut ix0 = c.ix;
    ix0.root_hint = 200;
    ix0.root = fr::ZERO;
    let st = Statement { root: fr::ZERO, ..c.stmt };
    assert_eq!(m.verify(&ix0.encode(), c.nf_accounts, &st.pi(&HP).unwrap()), Err(Reject::UnknownRoot));
}

/// S5: a transact for pool A submitted to pool B of the same program. B rejects the foreign pool id;
/// rewriting ext_data.pool_id to B's id changes ext_data_hash and so pi.
#[test]
fn s5_cross_pool_replay_detected() {
    let (_, c) = valid_client(1);
    let (mut b, _) = PoolModel::from_vectors(1);
    let (cfg_b, _) = find_pda(&[pool::SEED_POOL, &[7u8; 32]], &b.program);
    b.config = cfg_b;
    b.pool_id = pool::pool_id(&SoftSha256, &b.program, &cfg_b);
    assert_eq!(b.verify(&c.ix.encode(), c.nf_accounts, &pi_of(&c)), Err(Reject::WrongPool));
    let mut ix = c.ix;
    ix.ext_data[1..33].copy_from_slice(&b.pool_id);
    assert_eq!(b.verify(&ix.encode(), c.nf_accounts, &pi_of(&c)), Err(Reject::ProofMismatch));
}

/// S6: claimed_epoch outside the one-epoch window; moving it into the window changes pi.
#[test]
fn s6_epoch_window_detected() {
    let (mut m, c) = valid_client(1);
    m.now_epoch += 2;
    assert_eq!(m.verify(&c.ix.encode(), c.nf_accounts, &pi_of(&c)), Err(Reject::EpochWindow));
    let mut ix = c.ix;
    ix.claimed_epoch = m.now_epoch;
    assert_eq!(m.verify(&ix.encode(), c.nf_accounts, &pi_of(&c)), Err(Reject::ProofMismatch));
}

/// S7: nf + r (same residue, different bytes, different PDA). Rejected at decode.
#[test]
fn s7_non_canonical_field_detected() {
    let (mut m, c) = valid_client(1);
    let shifted = {
        let mut o = [0u8; 32];
        let mut carry = 0u16;
        for i in (0..32).rev() {
            let s = c.ix.nf[0][i] as u16 + R_BE[i] as u16 + carry;
            o[i] = s as u8;
            carry = s >> 8;
        }
        assert_eq!(carry, 0, "fixture nf + r fits 256 bits");
        o
    };
    let mut ix = c.ix;
    ix.nf[0] = shifted;
    let mut raw = c.ix.encode();
    raw[296..328].copy_from_slice(&shifted);
    assert_eq!(m.verify(&raw, c.nf_accounts, &pi_of(&c)), Err(Reject::Decode(Error::NonCanonicalField)));
    let (a, _) = find_pda(&[pool::SEED_NF, &m.config, &shifted], &m.program);
    assert_ne!(a, c.nf_accounts[0], "a second PDA would exist for the same nullifier");
}

/// S8: a non-canonical bump gives a second off-curve PDA for the same nullifier. Accepting it would
/// allow a double spend; the reference derives the canonical bump itself.
#[test]
fn s8_non_canonical_bump_detected() {
    let (mut m, c) = valid_client(1);
    let (canonical, bump) = find_pda(&[pool::SEED_NF, &m.config, &c.ix.nf[0]], &m.program);
    assert_eq!(canonical, c.nf_accounts[0]);
    let other = (0..bump).rev().find_map(|b| create_pda(&[pool::SEED_NF, &m.config, &c.ix.nf[0]], b, &m.program)).expect("a lower off-curve bump exists");
    assert_ne!(other, canonical);
    assert_eq!(m.verify(&c.ix.encode(), [other, c.nf_accounts[1]], &pi_of(&c)), Err(Reject::NullifierAccount));
    assert_eq!(m.verify(&c.ix.encode(), c.nf_accounts, &pi_of(&c)), Ok(()));
}

/// S9: the same transact twice.
#[test]
fn s9_replay_detected() {
    let (mut m, c) = valid_client(2);
    assert_eq!(m.verify(&c.ix.encode(), c.nf_accounts, &pi_of(&c)), Ok(()));
    assert_eq!(m.verify(&c.ix.encode(), c.nf_accounts, &pi_of(&c)), Err(Reject::DoubleSpend));
}

/// S10: byte order and hash-to-field are pinned: LE reading of BE limbs is a different element, and
/// reducing a 256-bit hash mod r differs from the 248-bit truncation whenever the hash is >= r.
#[test]
fn s10_encoding_divergence_is_pinned() {
    let f = fr::from_u64(0x0102_0304_0506_0708);
    assert_eq!(f[31], 0x08);
    assert_eq!(f[..24], [0u8; 24]);
    let le = fr::reduce_be(&fr::reverse(&f), &R_BE);
    assert_ne!(le, f);
    assert_ne!(HP.poseidon(&[f]).unwrap(), HP.poseidon(&[le]).unwrap());
    let mut found = false;
    for i in 0u32..64 {
        let h = sha256(&[b"dark-null-s10", &i.to_le_bytes()]);
        if !fr::is_canonical(&h) {
            assert_ne!(fr::reduce_be(&h, &R_BE), h248(&h));
            found = true;
            break;
        }
    }
    assert!(found);
}

/// S11 (X-RELAY at transcript level): any change to any ext_data field after signing changes pi.
#[test]
fn s11_relayer_mutation_of_every_field_detected() {
    let layout = load("V-EXTDATA")["layout"].clone();
    for f in layout.as_array().unwrap() {
        let (mut m, c) = valid_client(2);
        let off = f["offset"].as_u64().unwrap() as usize;
        let len = f["length"].as_u64().unwrap() as usize;
        let mut raw = c.ix.encode();
        raw[EXT_DATA_OFFSET + off + len - 1] ^= 0x01;
        let r = m.verify(&raw, c.nf_accounts, &pi_of(&c));
        let name = f["name"].as_str().unwrap();
        match name {
            "version" => assert_eq!(r, Err(Reject::Decode(Error::Version)), "{name}"),
            "pool_id" => assert_eq!(r, Err(Reject::WrongPool), "{name}"),
            _ => assert_eq!(r, Err(Reject::ProofMismatch), "{name}"),
        }
    }
    assert_eq!(EXT_LEN, 649);
}

/// S12: both public legs non-zero.
#[test]
fn s12_two_public_legs_rejected() {
    let (mut m, c) = valid_client(2);
    let mut ix = c.ix;
    ix.deposit_amount = 1;
    assert_eq!(m.verify(&ix.encode(), c.nf_accounts, &pi_of(&c)), Err(Reject::Decode(Error::BothLegsNonZero)));
}

/// S13: outputs submitted in swapped order (ported "swapped last chunk"): order is part of pi.
#[test]
fn s13_output_order_swap_detected() {
    let (mut m, c) = valid_client(1);
    let mut ix = c.ix;
    ix.cm.swap(0, 1);
    assert_eq!(m.verify(&ix.encode(), c.nf_accounts, &pi_of(&c)), Err(Reject::ProofMismatch));
    let mut ix2 = c.ix;
    ix2.nf.swap(0, 1);
    assert_eq!(m.verify(&ix2.encode(), [c.nf_accounts[1], c.nf_accounts[0]], &pi_of(&c)), Err(Reject::ProofMismatch));
}
