//! Program tests for `dark-null-pool-v2` (PLAN_2027 WP-PROGRAM). Runs natively, and against the `.so` when
//! `SBF_OUT_DIR` is set. Every positive case uses the real I1 proofs and the V-E2E vectors; every rejection asserts
//! the exact V2_SPEC 8.9 code.

mod common;

use common::*;
use dark_null_pool_v2::error::PoolError as E;
use dark_null_pool_v2::instructions::{self as ixs, ext_off, TransactAccounts};
use dark_null_pool_v2::state;
use dark_null_pool_v2::token::{ext, SPL_TOKEN_ID, TOKEN_2022_ID};
use solana_sdk::{
    account::Account,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_program,
};

const SETS: [&str; 2] = ["snarkjs", "arkworks"];
const EXT: usize = dark_null_transcript::ix::EXT_DATA_OFFSET;

fn code(e: E) -> Fail {
    Fail::Code(e.code())
}

fn rej(r: Outcome) -> Fail {
    r.expect_err("expected a rejection")
}

// ---------------------------------------------------------------------------------------------------------------
// V-E2E end to end on the real proofs
// ---------------------------------------------------------------------------------------------------------------

async fn e2e(set: &str) -> Vec<(String, u64)> {
    let mut h = Harness::new().await;
    let mut cu = vec![];
    // pool identity and PDAs equal the vectors
    let p = h.pool().await;
    assert_eq!(hexs(&p.pool_id), h.e2e["pool"]["pool_id"].as_str().unwrap());
    assert_eq!(p.bump as u64, dec(&h.e2e["pool"]["pool_config"]["bump"]));
    assert_eq!(p.vault_auth_bump as u64, dec(&h.e2e["pool"]["vault_authority"]["bump"]));
    assert_eq!(p.vk_hash, dark_null_pool_v2::vk::VK_HASH);
    assert_eq!(p.epoch_seconds, EPOCH_SECONDS);
    let ms = h.mint_state().await;
    assert_eq!(ms.asset, fr(&h.e2e["pool"]["asset"]));
    assert_eq!(ms.bump as u64, dec(&h.e2e["pool"]["mint_state"]["bump"]));
    assert_eq!(ms.vault_bump as u64, dec(&h.e2e["pool"]["vault"]["bump"]));
    let (ni, head, td) = h.tree_state().await;
    assert_eq!((ni, head), (0, 0));
    assert_eq!(Harness::tree_root(&td, 0), fr(&h.e2e["tree"]["empty_root"]));

    let mut balances = std::collections::HashMap::<Pubkey, u64>::new();
    for i in 0..3 {
        let s = h.step(i).clone();
        let accts = h.step_accounts(i);
        let pub_before = h.token_balance(&accts.public_token_account).await;
        let rel_before = h.token_balance(&accts.relayer_fee_account).await;
        let units = h.run_step(i, set).await.unwrap_or_else(|e| panic!("{set} step {i}: {e:?}"));
        cu.push((format!("transact_{}", STEP_NAMES[i]), units));
        let after = &s["after"];
        // tree: root, root head, next index equal the vectors
        let (ni, head, td) = h.tree_state().await;
        assert_eq!(ni, dec(&after["next_index"]), "next_index step {i}");
        assert_eq!(head as u64, dec(&after["new_root_hint"]), "root_head step {i}");
        assert_eq!(Harness::tree_root(&td, head as usize), fr(&after["new_root"]), "root step {i}");
        // nullifier records at the vector PDAs, owned by the program, no data, rent exempt
        for j in 0..2 {
            let a = h.account(&pk(&s["nullifier_pdas"][j]["address"])).await.expect("record");
            assert_eq!(a.owner, h.program_id);
            assert!(a.data.is_empty());
            assert!(a.lamports >= h.rent.minimum_balance(0));
        }
        // supply, deposit counter, vault and recipient balances
        let ms = h.mint_state().await;
        assert_eq!(ms.supply, dec(&after["supply"]), "supply step {i}");
        assert_eq!(h.pool().await.deposit_counter, dec(&after["deposit_counter"]));
        assert_eq!(h.vault_amount().await, ms.supply, "vault equals supply step {i}");
        if i > 0 {
            let fee_gain = h.token_balance(&accts.relayer_fee_account).await - rel_before;
            assert_eq!(fee_gain, dec(&after["relayer_receives"]), "relayer step {i}");
            if accts.public_token_account != h.vault {
                let got = h.token_balance(&accts.public_token_account).await - pub_before;
                assert_eq!(got, dec(&after["public_account_receives"]), "recipient step {i}");
            }
        }
        balances.insert(accts.public_token_account, h.token_balance(&accts.public_token_account).await);
        // events (8.10), SBF only: one tx event (plus a deposit event), no program log lines
        if sbf_mode() {
            let (events, msgs) = h.own_logs();
            assert!(msgs.is_empty(), "program logged text: {msgs:?}");
            assert_eq!(events.len(), if i == 0 { 2 } else { 1 });
            assert_eq!(events[0][0], b"dnull-v2-tx");
            assert_eq!(events[0][1], (2 * i as u64).to_le_bytes());
            assert_eq!(events[0][2], ((i + 1) as u16).to_le_bytes());
            assert_eq!(events[0][3], fr(&after["new_root"]));
            if i == 0 {
                assert_eq!(events[1][0], b"dnull-v2-dep");
                assert_eq!(events[1][1], fr(&s["public"]["deposit_label"]));
                assert_eq!(events[1][2], h.depositor.pubkey().to_bytes());
                assert_eq!(events[1][3], h.mint.to_bytes());
                assert_eq!(events[1][4], 1000u64.to_le_bytes());
            }
        }
    }
    // final ring equals V-E2E final.roots
    let (_, _, td) = h.tree_state().await;
    for (k, r) in h.e2e["final"]["roots"].as_array().unwrap().iter().enumerate() {
        assert_eq!(Harness::tree_root(&td, k), fr(r));
    }
    assert_eq!(h.mint_state().await.supply, dec(&h.e2e["final"]["supply"]));
    assert!(h.solvent().await);
    // the depositor paid 1000 from 5000
    let src = pk(&h.step(0)["ext_data"]["fields"]["public_token_account"]);
    assert_eq!(h.token_balance(&src).await, 4_000);
    cu
}

#[tokio::test]
async fn v_e2e_snarkjs_proofs() {
    let cu = e2e("snarkjs").await;
    for (k, v) in &cu {
        println!("CU[{}] snarkjs {k} = {v}", mode());
    }
}

#[tokio::test]
async fn v_e2e_arkworks_proofs() {
    let cu = e2e("arkworks").await;
    for (k, v) in &cu {
        println!("CU[{}] arkworks {k} = {v}", mode());
    }
    if sbf_mode() {
        for (k, v) in &cu {
            assert!(*v < 400_000, "B2 gate: {k} = {v} CU");
        }
    }
}

/// Per-step CU of `transact` from a `--features cu-trace` build (`CU_TRACE=1`, SBF only). Segment k is the work
/// between markers k and k+1; each marker costs 100 CU, which is subtracted.
#[tokio::test]
async fn cu_breakdown_trace() {
    if std::env::var("CU_TRACE").is_err() || !sbf_mode() {
        return;
    }
    let names = ["1-4 parse, accounts, fee", "5-6 root, epoch", "7-9 ext hash, label, pi", "10 groth16", "11 nullifier records", "12 tree insert, event", "13 public leg", "14 solvency"];
    let mut h = Harness::new().await;
    for i in 0..3 {
        let total = h.run_step(i, "snarkjs").await.unwrap();
        let m = h.cu_marks();
        assert_eq!(m.len(), 9, "{:?}", h.logs);
        let segs: Vec<u64> = m.windows(2).map(|w| w[0] - w[1] - 100).collect();
        for (k, v) in segs.iter().enumerate() {
            println!("CUTRACE {} step {k} [{}] = {v}", STEP_NAMES[i], names[k]);
        }
        let markers = 9 * 100;
        let inside: u64 = segs.iter().sum();
        println!("CUTRACE {} outside markers (entrypoint, dispatch, return) = {}", STEP_NAMES[i], total - inside - markers);
        println!("CUTRACE {} total with markers = {total}", STEP_NAMES[i]);
    }
}

fn hexs(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// Admin instructions and their CU; transaction sizes (V1 layout, 9.1).
#[tokio::test]
async fn admin_cu_and_transaction_sizes() {
    let e2e = load("V-E2E");
    let ext = load("V-EXTDATA");
    let program_id = pk(&e2e["pool"]["program_id"]);
    let nonce: [u8; 32] = unhex(ext["pool"]["pool_nonce"].as_str().unwrap()).try_into().unwrap();
    let mut h = Harness::new().await;
    // a second pool, to time initialize_pool and register_mint
    let nonce2 = [7u8; 32];
    let (pc2, _) = dark_null_pool_v2::pda::pool_config(&program_id, &nonce2);
    let (tr2, _) = dark_null_pool_v2::pda::tree(&program_id, &pc2);
    let a = h.authority.insecure_clone();
    let u_init = h.send(&[ixs::initialize_pool(&program_id, &a.pubkey(), &pc2, &tr2, &nonce2, EPOCH_SECONDS)], &a, &[]).await.unwrap();
    let (ms2, _) = dark_null_pool_v2::pda::mint_state(&program_id, &pc2, &h.mint);
    let (v2, _) = dark_null_pool_v2::pda::vault(&program_id, &pc2, &h.mint);
    let (va2, _) = dark_null_pool_v2::pda::vault_authority(&program_id, &pc2);
    let u_reg = h.send(&[ixs::register_mint(&program_id, &a.pubkey(), &pc2, &h.mint, &ms2, &v2, &va2, &SPL_TOKEN_ID, 1_000)], &a, &[]).await.unwrap();
    let u_lim = h.send(&[ixs::set_beta_limits(&program_id, &a.pubkey(), &pc2, &ms2, 2_000)], &a, &[]).await.unwrap();
    let u_pause = h.send(&[ixs::set_paused(&program_id, &a.pubkey(), &pc2, 1)], &a, &[]).await.unwrap();
    for (k, v) in [("initialize_pool", u_init), ("register_mint", u_reg), ("set_beta_limits", u_lim), ("set_paused", u_pause)] {
        println!("CU[{}] {k} = {v}", mode());
    }
    assert_eq!(nonce, h.pool_nonce);

    // transact V1 size: 1 signature, 14 addresses (13 accounts + program), compute-unit limit, loaded-accounts-data-size
    // limit, with and without a priority fee; plus the legacy size of the same transaction for reference.
    let data_len = ixs::TRANSACT_LEN;
    let with_fee = v1_size(1, 14, &[13], &[data_len], true);
    let without = v1_size(1, 14, &[13], &[data_len], false);
    println!("TXSIZE transact_v1_with_priority_fee = {with_fee}");
    println!("TXSIZE transact_v1_without_priority_fee = {without}");
    assert!(with_fee <= 4096);
    // legacy, for comparison (it does not fit the 1,232-byte limit; Phase 1 is V1 only)
    let accts = h.step_accounts(0);
    let ix = ixs::transact(&program_id, &accts, &h.step_data(0, "snarkjs"));
    let msg = solana_sdk::message::Message::new(&[ix], Some(&accts.submitter));
    let legacy = 1 + 64 + msg.serialize().len();
    println!("TXSIZE transact_legacy_reference = {legacy}");
    assert!(legacy > 1232);
}

// ---------------------------------------------------------------------------------------------------------------
// Replay and double spend (T-REPLAY, S9)
// ---------------------------------------------------------------------------------------------------------------

#[tokio::test]
async fn replay_same_proof_and_rerandomized_proof_are_double_spends() {
    let mut h = Harness::new().await;
    h.run_step(0, "snarkjs").await.unwrap();
    // A deposit replay: the deposit counter moved, so the program's deposit_label and pi differ (step 9) and the
    // proof fails (step 10) before the nullifier check (step 11).
    assert_eq!(rej(h.run_step(0, "snarkjs").await), code(E::ProofInvalid));
    assert_eq!(rej(h.run_step(0, "arkworks").await), code(E::ProofInvalid));
    // With the counter put back (state injection) the statement verifies again and the records stop it.
    let pc = h.pool_config;
    h.patch(&pc, |d| state::wr_u64(d, state::pool_config::DEPOSIT_COUNTER, 0)).await;
    assert_eq!(rej(h.run_step(0, "snarkjs").await), code(E::NullifierSpent), "same proof");
    assert_eq!(rej(h.run_step(0, "arkworks").await), code(E::NullifierSpent), "another proof of the same statement");
    h.patch(&pc, |d| state::wr_u64(d, state::pool_config::DEPOSIT_COUNTER, 1)).await;
    // transfer and withdraw: the same transact again, and a different proof of it
    h.run_step(1, "arkworks").await.unwrap();
    assert_eq!(rej(h.run_step(1, "arkworks").await), code(E::NullifierSpent));
    assert_eq!(rej(h.run_step(1, "snarkjs").await), code(E::NullifierSpent));
    h.run_step(2, "snarkjs").await.unwrap();
    assert_eq!(rej(h.run_step(2, "snarkjs").await), code(E::NullifierSpent));
    assert_eq!(rej(h.run_step(2, "arkworks").await), code(E::NullifierSpent));
    assert!(h.solvent().await);
    assert_eq!(h.mint_state().await.supply, 395);
}

// ---------------------------------------------------------------------------------------------------------------
// Step 1: parse (E_BAD_IX, E_NONCANONICAL_FIELD, E_BAD_PUBLIC_AMOUNT, E_UNKNOWN_ROOT hint range,
// E_DUPLICATE_NULLIFIER, E_BAD_EXT_DATA) and E_PAUSED
// ---------------------------------------------------------------------------------------------------------------

async fn try_mut(h: &mut Harness, i: usize, f: impl FnOnce(&mut Vec<u8>, &mut TransactAccounts)) -> Outcome {
    let mut d = h.step_data(i, "snarkjs");
    let mut a = h.step_accounts(i);
    f(&mut d, &mut a);
    h.transact(i, &d, &a).await
}

#[tokio::test]
async fn step1_parse_rejections() {
    let mut h = Harness::new().await;
    // length
    assert_eq!(rej(try_mut(&mut h, 0, |d, _| d.truncate(1130)).await), code(E::BadIx));
    assert_eq!(rej(try_mut(&mut h, 0, |d, _| d.push(0)).await), code(E::BadIx));
    // unknown discriminator, short data
    let a = h.step_accounts(0);
    let s = h.submitter(0);
    let ix = Instruction { program_id: h.program_id, accounts: a.metas(), data: vec![1, 2, 3] };
    assert_eq!(rej(h.send(&[ix], &s, &[]).await), code(E::BadIx));
    assert_eq!(rej(try_mut(&mut h, 0, |d, _| d[0] ^= 1).await), code(E::BadIx));
    // S7: x + r for each field element
    for off in [264usize, 296, 328, 360, 392] {
        let r = try_mut(&mut h, 0, |d, _| {
            let x: [u8; 32] = d[off..off + 32].try_into().unwrap();
            d[off..off + 32].copy_from_slice(&plus_r(&x));
        })
        .await;
        assert_eq!(rej(r), code(E::NonCanonicalField), "offset {off}");
    }
    // assoc_root = r is non-canonical (checked before E_ASSOC_DISABLED)
    assert_eq!(rej(try_mut(&mut h, 0, |d, _| d[448..480].copy_from_slice(&dark_null_transcript::fr::R_BE)).await), code(E::NonCanonicalField));
    // S12: both public legs
    assert_eq!(rej(try_mut(&mut h, 0, |d, _| d[432..440].copy_from_slice(&1u64.to_le_bytes())).await), code(E::BadPublicAmount));
    // root_hint >= 256
    assert_eq!(rej(try_mut(&mut h, 0, |d, _| d[480..482].copy_from_slice(&256u16.to_le_bytes())).await), code(E::UnknownRoot));
    // nf0 == nf1 (defence in depth over REVIEW_NOTES R1)
    assert_eq!(
        rej(try_mut(&mut h, 0, |d, a| {
            let nf0: [u8; 32] = d[296..328].try_into().unwrap();
            d[328..360].copy_from_slice(&nf0);
            a.nf_record1 = a.nf_record0;
        })
        .await),
        code(E::DuplicateNullifier)
    );
    // ext_data version
    assert_eq!(rej(try_mut(&mut h, 0, |d, _| d[EXT] = 2).await), code(E::BadExtData));
    assert_eq!(rej(try_mut(&mut h, 0, |d, _| d[EXT] = 0).await), code(E::BadExtData));
    // nothing changed
    assert_eq!(h.tree_state().await.0, 0);
    h.run_step(0, "snarkjs").await.unwrap();
}

#[tokio::test]
async fn paused_pool_rejects_every_transact_and_admin_is_authority_only() {
    let mut h = Harness::new().await;
    let a = h.authority.insecure_clone();
    let intruder = h.relayer.insecure_clone();
    let (pid, pc, ms) = (h.program_id, h.pool_config, h.mint_state);
    assert_eq!(rej(h.send(&[ixs::set_paused(&pid, &intruder.pubkey(), &pc, 1)], &intruder, &[]).await), code(E::Unauthorized));
    assert_eq!(rej(h.send(&[ixs::set_paused(&pid, &a.pubkey(), &pc, 2)], &a, &[]).await), code(E::BadIx));
    h.send(&[ixs::set_paused(&pid, &a.pubkey(), &pc, 1)], &a, &[]).await.unwrap();
    assert_eq!(h.pool().await.paused, 1);
    // paused is checked before the data: even malformed data gets E_PAUSED
    assert_eq!(rej(h.run_step(0, "snarkjs").await), code(E::Paused));
    assert_eq!(rej(try_mut(&mut h, 0, |d, _| d.truncate(10)).await), code(E::Paused));
    h.send(&[ixs::set_paused(&pid, &a.pubkey(), &pc, 0)], &a, &[]).await.unwrap();
    h.run_step(0, "snarkjs").await.unwrap();
    // set_beta_limits and register_mint are authority-only
    assert_eq!(rej(h.send(&[ixs::set_beta_limits(&pid, &intruder.pubkey(), &pc, &ms, 0)], &intruder, &[]).await), code(E::Unauthorized));
    let m = Pubkey::new_unique();
    h.put(&m, Account { lamports: LAMPORTS, data: mint_data(6, None), owner: SPL_TOKEN_ID, executable: false, rent_epoch: 0 });
    let (ms2, _) = dark_null_pool_v2::pda::mint_state(&pid, &pc, &m);
    let (v2, _) = dark_null_pool_v2::pda::vault(&pid, &pc, &m);
    let va = h.vault_authority;
    assert_eq!(rej(h.send(&[ixs::register_mint(&pid, &intruder.pubkey(), &pc, &m, &ms2, &v2, &va, &SPL_TOKEN_ID, 0)], &intruder, &[]).await), code(E::Unauthorized));
    // admin data lengths
    let mut ix = ixs::set_beta_limits(&pid, &a.pubkey(), &pc, &ms, 0);
    ix.data.pop();
    assert_eq!(rej(h.send(&[ix], &a, &[]).await), code(E::BadIx));
}

// ---------------------------------------------------------------------------------------------------------------
// Step 2: E_ASSOC_DISABLED, E_WRONG_POOL (S5)
// ---------------------------------------------------------------------------------------------------------------

#[tokio::test]
async fn step2_assoc_root_and_pool_binding() {
    let mut h = Harness::new().await;
    // assoc_root != 0 (defence in depth over REVIEW_NOTES R3)
    assert_eq!(rej(try_mut(&mut h, 0, |d, _| d[479] = 1).await), code(E::AssocDisabled));
    // pool_id rewritten
    assert_eq!(rej(try_mut(&mut h, 0, |d, _| d[EXT + ext_off::POOL_ID] ^= 1).await), code(E::WrongPool));
    // a transact of pool A sent to pool B (same program, same mint)
    let a = h.authority.insecure_clone();
    let pid = h.program_id;
    let nonce2 = [9u8; 32];
    let (pc2, _) = dark_null_pool_v2::pda::pool_config(&pid, &nonce2);
    let (tr2, _) = dark_null_pool_v2::pda::tree(&pid, &pc2);
    h.send(&[ixs::initialize_pool(&pid, &a.pubkey(), &pc2, &tr2, &nonce2, EPOCH_SECONDS)], &a, &[]).await.unwrap();
    let (ms2, _) = dark_null_pool_v2::pda::mint_state(&pid, &pc2, &h.mint);
    let (v2, _) = dark_null_pool_v2::pda::vault(&pid, &pc2, &h.mint);
    let (va2, _) = dark_null_pool_v2::pda::vault_authority(&pid, &pc2);
    let m = h.mint;
    h.send(&[ixs::register_mint(&pid, &a.pubkey(), &pc2, &m, &ms2, &v2, &va2, &SPL_TOKEN_ID, u64::MAX)], &a, &[]).await.unwrap();
    let r = try_mut(&mut h, 0, |_, acc| {
        acc.pool_config = pc2;
        acc.tree = tr2;
        acc.mint_state = ms2;
        acc.vault = v2;
        acc.relayer_fee_account = v2;
        acc.vault_authority = va2;
        let nfs = [h_nf(0, 0), h_nf(0, 1)];
        acc.nf_record0 = dark_null_pool_v2::pda::nullifier(&pid, &pc2, &nfs[0]).0;
        acc.nf_record1 = dark_null_pool_v2::pda::nullifier(&pid, &pc2, &nfs[1]).0;
    })
    .await;
    assert_eq!(rej(r), code(E::WrongPool));
    // pool A's mint state with pool B's config is an account mismatch (the mint state PDA binds its pool)
    let mut d = h.step_data(0, "snarkjs");
    let p2 = dark_null_transcript::pool::pool_id(&dark_null_transcript::hash::SoftSha256, &pid.to_bytes(), &pc2.to_bytes());
    d[EXT + 1..EXT + 33].copy_from_slice(&p2);
    let mut acc = h.step_accounts(0);
    acc.pool_config = pc2;
    acc.tree = tr2;
    assert_eq!(rej(h.transact(0, &d, &acc).await), code(E::AccountMismatch));
}

fn h_nf(step: usize, j: usize) -> [u8; 32] {
    fr(&load("V-E2E")["steps"][step]["public"]["nf"][j])
}

// ---------------------------------------------------------------------------------------------------------------
// Step 3: E_ACCOUNT_MISMATCH, E_TOKEN_ACCOUNT_INVALID, E_NULLIFIER_ACCOUNT (T-BUMP, S8)
// ---------------------------------------------------------------------------------------------------------------

#[tokio::test]
async fn step3_account_checks() {
    let mut h = Harness::new().await;
    let other = Pubkey::new_unique();
    let fresh_token = Pubkey::new_unique();
    let rent = h.rent.clone();
    h.put(&fresh_token, native_wsol_account(&rent, &other, 0));
    type F = Box<dyn Fn(&mut TransactAccounts)>;
    let cases: Vec<(&str, F)> = vec![
        ("tree", Box::new(move |a| a.tree = other)),
        ("vault", Box::new(move |a| a.vault = fresh_token)),
        ("mint", Box::new(move |a| a.mint = other)),
        ("vault_authority", Box::new(move |a| a.vault_authority = other)),
        ("mint_state", Box::new(move |a| a.mint_state = other)),
        ("token_program", Box::new(|a| a.token_program = TOKEN_2022_ID)),
        ("pool_config", Box::new(move |a| a.pool_config = other)),
        ("public_token_account", Box::new(move |a| a.public_token_account = fresh_token)),
        ("relayer_fee_account", Box::new(move |a| a.relayer_fee_account = fresh_token)),
    ];
    for (name, f) in cases {
        let r = try_mut(&mut h, 0, |_, a| f(a)).await;
        assert_eq!(rej(r), code(E::AccountMismatch), "{name}");
    }
    // system program
    let d = h.step_data(0, "snarkjs");
    let a = h.step_accounts(0);
    let mut metas = a.metas();
    metas[12] = AccountMeta::new_readonly(other, false);
    let s = h.submitter(0);
    assert_eq!(rej(h.send(&[Instruction { program_id: h.program_id, accounts: metas, data: d.clone() }], &s, &[]).await), code(E::AccountMismatch));
    // 12 and 14 accounts
    let mut metas = a.metas();
    metas.pop();
    assert_eq!(rej(h.send(&[Instruction { program_id: h.program_id, accounts: metas, data: d.clone() }], &s, &[]).await), code(E::AccountMismatch));
    let mut metas = a.metas();
    metas.push(AccountMeta::new_readonly(other, false));
    assert_eq!(rej(h.send(&[Instruction { program_id: h.program_id, accounts: metas, data: d.clone() }], &s, &[]).await), code(E::AccountMismatch));
    // submitter not a signer (another fee payer signs)
    let mut metas = a.metas();
    metas[0] = AccountMeta::new(a.submitter, false);
    let payer = h.authority.insecure_clone();
    assert_eq!(rej(h.send(&[Instruction { program_id: h.program_id, accounts: metas, data: d.clone() }], &payer, &[]).await), code(E::AccountMismatch));
    // read-only tree or mint state (the vault also appears writable at index 6 in a deposit, so the message makes
    // it writable anyway)
    for idx in [2usize, 10] {
        let mut metas = a.metas();
        metas[idx] = AccountMeta::new_readonly(metas[idx].pubkey, false);
        assert_eq!(rej(h.send(&[Instruction { program_id: h.program_id, accounts: metas, data: d.clone() }], &s, &[]).await), code(E::AccountMismatch), "read-only {idx}");
    }

    // E_TOKEN_ACCOUNT_INVALID: the ext_data public account exists but is not a token account of the mint
    let src = a.public_token_account;
    let good = h.account(&src).await.unwrap();
    let dep = h.depositor.pubkey();
    let variants: Vec<(&str, Account)> = vec![
        ("other mint", Account { data: token_account_data(&other, &dep, 5_000, None, 1), ..good.clone() }),
        ("uninitialized", Account { data: token_account_data(&h.mint, &dep, 5_000, None, 0), ..good.clone() }),
        ("wrong owner program", Account { owner: system_program::id(), ..good.clone() }),
        ("short data", Account { data: vec![0u8; 82], ..good.clone() }),
    ];
    for (name, acct) in variants {
        h.put(&src, acct);
        assert_eq!(rej(h.run_step(0, "snarkjs").await), code(E::TokenAccountInvalid), "{name}");
    }
    h.put(&src, good);

    // E_NULLIFIER_ACCOUNT: a lower off-curve bump gives a second address for the same nullifier (F-BUMP, S8)
    let pid = h.program_id;
    let pc = h.pool_config;
    let nf0 = h_nf(0, 0);
    let (canon, cb) = dark_null_pool_v2::pda::nullifier(&pid, &pc, &nf0);
    assert_eq!(canon, a.nf_record0);
    let alt = (0..cb)
        .rev()
        .find_map(|b| Pubkey::create_program_address(&[dark_null_transcript::pool::SEED_NF, pc.as_ref(), &nf0, &[b]], &pid).ok())
        .expect("a non-canonical bump exists");
    assert_ne!(alt, canon);
    assert_eq!(rej(try_mut(&mut h, 0, |_, a| a.nf_record0 = alt).await), code(E::NullifierAccount));
    assert_eq!(rej(try_mut(&mut h, 0, |_, a| std::mem::swap(&mut a.nf_record0, &mut a.nf_record1)).await), code(E::NullifierAccount));
    assert_eq!(rej(try_mut(&mut h, 0, |_, a| a.nf_record1 = other).await), code(E::NullifierAccount));
    h.run_step(0, "snarkjs").await.unwrap();
}

// ---------------------------------------------------------------------------------------------------------------
// Step 4: E_BAD_FEE
// ---------------------------------------------------------------------------------------------------------------

#[tokio::test]
async fn step4_fee_rules() {
    let mut h = Harness::new().await;
    let vault = h.vault;
    let src = h.step_accounts(0).public_token_account;
    // deposit: fee must be 0, relayer account must be the vault, public account must not be the vault
    assert_eq!(rej(try_mut(&mut h, 0, |d, _| d[EXT + ext_off::RELAYER_FEE] = 1).await), code(E::BadFee));
    assert_eq!(
        rej(try_mut(&mut h, 0, |d, a| {
            d[EXT + ext_off::RELAYER_FEE_ACCOUNT..EXT + ext_off::RELAYER_FEE_ACCOUNT + 32].copy_from_slice(src.as_ref());
            a.relayer_fee_account = src;
        })
        .await),
        code(E::BadFee)
    );
    assert_eq!(
        rej(try_mut(&mut h, 0, |d, a| {
            d[EXT + ext_off::PUBLIC_TOKEN_ACCOUNT..EXT + ext_off::PUBLIC_TOKEN_ACCOUNT + 32].copy_from_slice(vault.as_ref());
            a.public_token_account = vault;
        })
        .await),
        code(E::BadFee)
    );
    h.advance(2).await;
    // withdraw: fee above the withdraw amount
    assert_eq!(rej(try_mut(&mut h, 2, |d, _| d[EXT + ext_off::RELAYER_FEE..EXT + ext_off::RELAYER_FEE + 8].copy_from_slice(&601u64.to_le_bytes())).await), code(E::BadFee));
    // recipient amount > 0 but public account is the vault
    assert_eq!(
        rej(try_mut(&mut h, 2, |d, a| {
            d[EXT + ext_off::PUBLIC_TOKEN_ACCOUNT..EXT + ext_off::PUBLIC_TOKEN_ACCOUNT + 32].copy_from_slice(vault.as_ref());
            a.public_token_account = vault;
        })
        .await),
        code(E::BadFee)
    );
    // fee > 0 but the relayer account is the vault
    assert_eq!(
        rej(try_mut(&mut h, 2, |d, a| {
            d[EXT + ext_off::RELAYER_FEE_ACCOUNT..EXT + ext_off::RELAYER_FEE_ACCOUNT + 32].copy_from_slice(vault.as_ref());
            a.relayer_fee_account = vault;
        })
        .await),
        code(E::BadFee)
    );
    // fee == withdraw (recipient amount 0) but the public account is not the vault
    assert_eq!(rej(try_mut(&mut h, 2, |d, _| d[EXT + ext_off::RELAYER_FEE..EXT + ext_off::RELAYER_FEE + 8].copy_from_slice(&600u64.to_le_bytes())).await), code(E::BadFee));
    // fee 0 but the relayer account is not the vault
    assert_eq!(rej(try_mut(&mut h, 2, |d, _| d[EXT + ext_off::RELAYER_FEE..EXT + ext_off::RELAYER_FEE + 8].copy_from_slice(&0u64.to_le_bytes())).await), code(E::BadFee));
    h.run_step(2, "snarkjs").await.unwrap();
}

// ---------------------------------------------------------------------------------------------------------------
// Steps 5-6: roots (T-ROOT, S4) and the epoch window (S6)
// ---------------------------------------------------------------------------------------------------------------

#[tokio::test]
async fn step5_root_history() {
    let mut h = Harness::new().await;
    // hint at another slot (S4)
    assert_eq!(rej(try_mut(&mut h, 0, |d, _| d[480] = 1).await), code(E::UnknownRoot));
    // zero root at an empty slot (S4)
    assert_eq!(
        rej(try_mut(&mut h, 0, |d, _| {
            d[264..296].fill(0);
            d[480] = 9;
        })
        .await),
        code(E::UnknownRoot)
    );
    h.run_step(0, "snarkjs").await.unwrap();
    // the transfer's root sits at slot 1; a wrong hint is rejected, the right one accepted
    assert_eq!(rej(try_mut(&mut h, 1, |d, _| d[480] = 0).await), code(E::UnknownRoot));
    assert_eq!(rej(try_mut(&mut h, 1, |d, _| d[480] = 2).await), code(E::UnknownRoot));
    // stale root: the ring slot was overwritten (what 256 later insertions do)
    let tree = h.tree;
    let saved = h.data(&tree).await;
    h.patch(&tree, |d| d[state::tree::ROOTS + 32..state::tree::ROOTS + 64].copy_from_slice(&[0x11; 32])).await;
    assert_eq!(rej(h.run_step(1, "snarkjs").await), code(E::UnknownRoot));
    h.patch(&tree, |d| d.copy_from_slice(&saved)).await;
    // a relayer may correct the hint (it is outside ext_data and pi): same root copied to slot 7, hint 7
    h.patch(&tree, |d| {
        let r: [u8; 32] = d[state::tree::ROOTS + 32..state::tree::ROOTS + 64].try_into().unwrap();
        d[state::tree::ROOTS + 7 * 32..state::tree::ROOTS + 8 * 32].copy_from_slice(&r);
    })
    .await;
    try_mut(&mut h, 1, |d, _| d[480] = 7).await.expect("hint is not bound by the proof");
    // on-chain root equals the client (vector) root
    let (_, head, td) = h.tree_state().await;
    assert_eq!(Harness::tree_root(&td, head as usize), fr(&h.step(1)["after"]["new_root"]));
}

#[tokio::test]
async fn ring_wraps_after_256_insertions() {
    // pure ring arithmetic on a tree account image (the program's tree_insert with the host Poseidon)
    let mut d = vec![0u8; state::tree::LEN];
    state::tree_init(&mut d, 255);
    let h = dark_null_pool_v2::hash::POSEIDON;
    let early = {
        let (_, head, root) = state::tree_insert(&h, &mut d, &[0u8; 32], &[0u8; 32]).unwrap();
        assert_eq!(head, 1);
        root
    };
    assert!(state::tree_root_known(&d, 1, &early));
    // a root stays usable for 255 later insertions (V2_SPEC 6.3) and is gone after the 256th
    for k in 0..256u32 {
        assert!(state::tree_root_known(&d, 1, &early), "still known after {k} later insertions");
        let mut c = [0u8; 32];
        c[28..].copy_from_slice(&(k + 1).to_be_bytes());
        state::tree_insert(&h, &mut d, &c, &c).unwrap();
    }
    assert_eq!(state::rd_u16(&d, state::tree::ROOT_HEAD), 1);
    assert!(!state::tree_root_known(&d, 1, &early));
    assert_eq!(state::rd_u64(&d, state::tree::NEXT_INDEX), 514);
}

#[tokio::test]
async fn step6_epoch_window() {
    let mut h = Harness::new().await;
    for (epoch, ok) in [(490_002u64, false), (489_998, false)] {
        h.set_epoch(epoch, 0).await;
        assert_eq!(h.run_step(0, "snarkjs").await.is_ok(), ok);
        assert_eq!(rej(h.run_step(0, "arkworks").await), code(E::EpochWindow), "epoch {epoch}");
    }
    // moved into the window: claimed_epoch 490001 is inside, but pi changes (S6)
    h.set_epoch(490_001, 0).await;
    assert_eq!(rej(try_mut(&mut h, 0, |d, _| d[440..448].copy_from_slice(&490_001u64.to_le_bytes())).await), code(E::ProofInvalid));
    // edges of the window accept the vector epoch
    h.set_epoch(489_999, 3_599).await;
    h.run_step(0, "snarkjs").await.unwrap();
    h.set_epoch(490_001, 3_599).await;
    h.run_step(1, "snarkjs").await.unwrap();
}

// ---------------------------------------------------------------------------------------------------------------
// Steps 7-10: ext_data tampering (X-RELAY, S11, S3), statement tampering (S13, amounts, mint), proof corpus
// ---------------------------------------------------------------------------------------------------------------

#[tokio::test]
async fn x_relay_every_ext_data_field_mutation_fails() {
    let mut h = Harness::new().await;
    h.advance(2).await;
    let other_ta = Pubkey::new_unique();
    let rent = h.rent.clone();
    h.put(&other_ta, native_wsol_account(&rent, &Pubkey::new_unique(), 0));
    // (field, offset, expected code if the account list is left unchanged)
    let fields: [(&str, usize, E); 10] = [
        ("version", ext_off::VERSION, E::BadExtData),
        ("pool_id", ext_off::POOL_ID, E::WrongPool),
        ("public_token_account", ext_off::PUBLIC_TOKEN_ACCOUNT, E::AccountMismatch),
        ("relayer_fee_account", ext_off::RELAYER_FEE_ACCOUNT, E::AccountMismatch),
        ("relayer_fee", ext_off::RELAYER_FEE, E::ProofInvalid),
        ("memo_binding", ext_off::MEMO_BINDING, E::ProofInvalid),
        ("stealth_ephemeral", ext_off::STEALTH_EPHEMERAL, E::ProofInvalid),
        ("ciphertext0", ext_off::CIPHERTEXT0 + 77, E::ProofInvalid),
        ("ciphertext1", ext_off::CIPHERTEXT1 + 159, E::ProofInvalid),
        ("ciphertext_rec", ext_off::CIPHERTEXT_REC, E::ProofInvalid),
    ];
    for (name, off, want) in fields {
        let r = try_mut(&mut h, 2, |d, _| d[EXT + off] ^= 0x01).await;
        assert_eq!(rej(r), code(want), "{name}");
    }
    // a relayer that also swaps the account (so step 3 passes) is stopped by pi
    let r = try_mut(&mut h, 2, |d, a| {
        d[EXT + ext_off::PUBLIC_TOKEN_ACCOUNT..EXT + ext_off::PUBLIC_TOKEN_ACCOUNT + 32].copy_from_slice(other_ta.as_ref());
        a.public_token_account = other_ta;
    })
    .await;
    assert_eq!(rej(r), code(E::ProofInvalid), "redirected recipient");
    let r = try_mut(&mut h, 2, |d, a| {
        d[EXT + ext_off::RELAYER_FEE_ACCOUNT..EXT + ext_off::RELAYER_FEE_ACCOUNT + 32].copy_from_slice(other_ta.as_ref());
        a.relayer_fee_account = other_ta;
    })
    .await;
    assert_eq!(rej(r), code(E::ProofInvalid), "redirected fee");
    // a higher fee within the withdraw amount
    let r = try_mut(&mut h, 2, |d, _| d[EXT + ext_off::RELAYER_FEE..EXT + ext_off::RELAYER_FEE + 8].copy_from_slice(&11u64.to_le_bytes())).await;
    assert_eq!(rej(r), code(E::ProofInvalid), "fee raised");
    // every single byte of ext_data after the version and pool id: pi or an account rule rejects it
    let mut n = 0;
    for off in (33..649).step_by(23) {
        let r = try_mut(&mut h, 2, |d, _| d[EXT + off] ^= 0x80).await;
        assert!(matches!(rej(r), Fail::Code(c) if c == E::ProofInvalid.code() || c == E::AccountMismatch.code() || c == E::BadFee.code()), "offset {off}");
        n += 1;
    }
    assert!(n > 25);
    h.run_step(2, "snarkjs").await.unwrap();
}

#[tokio::test]
async fn statement_tampering_and_wrong_amount_or_mint() {
    let mut h = Harness::new().await;
    // S13: nullifiers swapped (accounts follow) and outputs swapped
    let r = try_mut(&mut h, 0, |d, a| {
        let (x, y): ([u8; 32], [u8; 32]) = (d[296..328].try_into().unwrap(), d[328..360].try_into().unwrap());
        d[296..328].copy_from_slice(&y);
        d[328..360].copy_from_slice(&x);
        std::mem::swap(&mut a.nf_record0, &mut a.nf_record1);
    })
    .await;
    assert_eq!(rej(r), code(E::ProofInvalid), "nf swap");
    let r = try_mut(&mut h, 0, |d, _| {
        let (x, y): ([u8; 32], [u8; 32]) = (d[360..392].try_into().unwrap(), d[392..424].try_into().unwrap());
        d[360..392].copy_from_slice(&y);
        d[392..424].copy_from_slice(&x);
    })
    .await;
    assert_eq!(rej(r), code(E::ProofInvalid), "cm swap");
    // a changed commitment or root (the root also needs a matching ring slot to reach the verifier)
    assert_eq!(rej(try_mut(&mut h, 0, |d, _| d[423] ^= 1).await), code(E::ProofInvalid), "cm1");
    // wrong amount: deposit 1001 against the 1000 proof
    assert_eq!(rej(try_mut(&mut h, 0, |d, _| d[424..432].copy_from_slice(&1001u64.to_le_bytes())).await), code(E::ProofInvalid), "amount");
    // a deposit leg turned into a withdraw leg
    let r = try_mut(&mut h, 0, |d, _| {
        d[424..432].fill(0);
        d[432..440].copy_from_slice(&1000u64.to_le_bytes());
    })
    .await;
    assert_eq!(rej(r), code(E::ProofInvalid), "leg flip");
    // wrong mint: the withdraw step, byte for byte, against a second registered mint (its asset differs, so the
    // program's public_asset and pi differ). The recipient and relayer accounts are made token accounts of that mint
    // so that every pre-proof check passes.
    h.advance(2).await;
    let a = h.authority.insecure_clone();
    let (pid, pc, va) = (h.program_id, h.pool_config, h.vault_authority);
    let m2 = Pubkey::new_unique();
    h.put(&m2, Account { lamports: LAMPORTS, data: mint_data(9, None), owner: SPL_TOKEN_ID, executable: false, rent_epoch: 0 });
    let (ms2, _) = dark_null_pool_v2::pda::mint_state(&pid, &pc, &m2);
    let (v2, _) = dark_null_pool_v2::pda::vault(&pid, &pc, &m2);
    h.send(&[ixs::register_mint(&pid, &a.pubkey(), &pc, &m2, &ms2, &v2, &va, &SPL_TOKEN_ID, u64::MAX)], &a, &[]).await.unwrap();
    let acc = h.step_accounts(2);
    let rent = h.rent.minimum_balance(165);
    let saved = [h.account(&acc.public_token_account).await.unwrap(), h.account(&acc.relayer_fee_account).await.unwrap()];
    for k in [acc.public_token_account, acc.relayer_fee_account] {
        h.put(&k, Account { lamports: rent, data: token_account_data(&m2, &Pubkey::new_unique(), 0, None, 1), owner: SPL_TOKEN_ID, executable: false, rent_epoch: 0 });
    }
    let r = try_mut(&mut h, 2, |_, x| {
        x.mint = m2;
        x.mint_state = ms2;
        x.vault = v2;
    })
    .await;
    assert_eq!(rej(r), code(E::ProofInvalid), "mint");
    h.put(&acc.public_token_account, saved[0].clone());
    h.put(&acc.relayer_fee_account, saved[1].clone());
    h.run_step(2, "snarkjs").await.unwrap();
}

/// Malformed proof corpus at program level (the native corpus in `tests/native.rs` is larger).
#[tokio::test]
async fn tampered_proofs_are_rejected() {
    let mut h = Harness::new().await;
    let q = dark_null_pool_v2_test_q();
    let cases: Vec<(&str, Box<dyn Fn(&mut [u8])>)> = vec![
        ("A x", Box::new(|p| p[0] ^= 1)),
        ("A y", Box::new(|p| p[63] ^= 1)),
        ("A not negated", Box::new(move |p| {
            let y: [u8; 32] = p[32..64].try_into().unwrap();
            p[32..64].copy_from_slice(&sub_be(&q, &y));
        })),
        ("B c0/c1 swapped", Box::new(|p| {
            let (x1, x0): ([u8; 32], [u8; 32]) = (p[64..96].try_into().unwrap(), p[96..128].try_into().unwrap());
            p[64..96].copy_from_slice(&x0);
            p[96..128].copy_from_slice(&x1);
        })),
        ("B y", Box::new(|p| p[191] ^= 1)),
        ("C x", Box::new(|p| p[192] ^= 1)),
        ("C = A", Box::new(|p| {
            let a: [u8; 64] = p[0..64].try_into().unwrap();
            p[192..256].copy_from_slice(&a);
        })),
        ("all zero", Box::new(|p| p.fill(0))),
        ("all 0xff", Box::new(|p| p.fill(0xff))),
        ("coordinate = q", Box::new(move |p| p[0..32].copy_from_slice(&q))),
    ];
    for (name, f) in cases {
        let r = try_mut(&mut h, 0, |d, _| f(&mut d[8..264])).await;
        assert_eq!(rej(r), code(E::ProofInvalid), "{name}");
    }
    // the transfer proof on the deposit statement
    let other = proof_for("snarkjs", "transfer");
    assert_eq!(rej(try_mut(&mut h, 0, |d, _| d[8..264].copy_from_slice(&other.proof)).await), code(E::ProofInvalid));
    h.run_step(0, "snarkjs").await.unwrap();
}

fn dark_null_pool_v2_test_q() -> [u8; 32] {
    unhex("30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47").try_into().unwrap()
}

fn sub_be(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    dark_null_transcript::fr::sub(a, b)
}

// ---------------------------------------------------------------------------------------------------------------
// Step 11: nullifier store (T-PREFUND, foreign state)
// ---------------------------------------------------------------------------------------------------------------

#[tokio::test]
async fn prefunded_nullifier_addresses_are_still_spendable() {
    let mut h = Harness::new().await;
    let a = h.step_accounts(0);
    let min = h.rent.minimum_balance(0);
    // nf0 address: 1 lamport (below rent); nf1 address: twice the rent (no top-up)
    h.put(&a.nf_record0, Account { lamports: 1, data: vec![], owner: system_program::id(), executable: false, rent_epoch: 0 });
    h.put(&a.nf_record1, Account { lamports: 2 * min, data: vec![], owner: system_program::id(), executable: false, rent_epoch: 0 });
    let units = h.run_step(0, "snarkjs").await.expect("pre-funded records are adopted");
    println!("CU[{}] transact_deposit_prefunded_records = {units}", mode());
    let r0 = h.account(&a.nf_record0).await.unwrap();
    let r1 = h.account(&a.nf_record1).await.unwrap();
    assert_eq!((r0.owner, r0.lamports, r0.data.len()), (h.program_id, min, 0));
    assert_eq!((r1.owner, r1.lamports, r1.data.len()), (h.program_id, 2 * min, 0));
    h.run_step(1, "snarkjs").await.unwrap();
}

#[tokio::test]
async fn nullifier_records_in_a_foreign_state_are_rejected() {
    let mut h = Harness::new().await;
    let a = h.step_accounts(0);
    let foreign = [
        Account { lamports: LAMPORTS, data: vec![], owner: SPL_TOKEN_ID, executable: false, rent_epoch: 0 },
        Account { lamports: LAMPORTS, data: vec![0u8; 8], owner: system_program::id(), executable: false, rent_epoch: 0 },
    ];
    for acct in foreign {
        h.put(&a.nf_record1, acct);
        assert_eq!(rej(h.run_step(0, "snarkjs").await), code(E::NullifierAccount));
    }
    // a record already owned by the program is "spent"
    h.put(&a.nf_record1, Account { lamports: LAMPORTS, data: vec![], owner: h.program_id, executable: false, rent_epoch: 0 });
    assert_eq!(rej(h.run_step(0, "snarkjs").await), code(E::NullifierSpent));
}

// ---------------------------------------------------------------------------------------------------------------
// Steps 12-14: tree capacity, outflow cap, supply, solvency, arithmetic (T-SOLV)
// ---------------------------------------------------------------------------------------------------------------

#[tokio::test]
async fn tree_capacity_edges() {
    let mut h = Harness::new().await;
    let tree = h.tree;
    h.patch(&tree, |d| state::wr_u64(d, state::tree::NEXT_INDEX, 1u64 << 32)).await;
    assert_eq!(rej(h.run_step(0, "snarkjs").await), code(E::TreeFull));
    h.patch(&tree, |d| state::wr_u64(d, state::tree::NEXT_INDEX, (1u64 << 32) - 2)).await;
    h.run_step(0, "snarkjs").await.expect("the last pair fits");
    assert_eq!(h.tree_state().await.0, 1u64 << 32);
}

#[tokio::test]
async fn outflow_cap_supply_and_solvency_guards() {
    // cap 4 per epoch: the transfer step withdraws 5 (its relayer fee)
    let mut h = Harness::new_with(4, |_, _| {}).await;
    h.run_step(0, "snarkjs").await.unwrap();
    assert_eq!(rej(h.run_step(1, "snarkjs").await), code(E::OutflowCap));
    let (pid, pc, ms) = (h.program_id, h.pool_config, h.mint_state);
    let a = h.authority.insecure_clone();
    h.send(&[ixs::set_beta_limits(&pid, &a.pubkey(), &pc, &ms, 5)], &a, &[]).await.unwrap();
    h.run_step(1, "snarkjs").await.unwrap();
    let m = h.mint_state().await;
    assert_eq!((m.outflow_epoch, m.outflow_in_epoch), (490_000, 5));
    // the cap is per epoch: 600 more in the same epoch exceeds a cap of 600, the next epoch resets it
    h.send(&[ixs::set_beta_limits(&pid, &a.pubkey(), &pc, &ms, 600)], &a, &[]).await.unwrap();
    assert_eq!(rej(h.run_step(2, "snarkjs").await), code(E::OutflowCap));
    h.set_epoch(490_001, 0).await;
    h.run_step(2, "snarkjs").await.unwrap();
    let m = h.mint_state().await;
    assert_eq!((m.outflow_epoch, m.outflow_in_epoch, m.supply), (490_001, 600, 395));

    // E_SUPPLY: supply below the withdraw amount (state injection), vault still holds the funds
    let mut h = Harness::new().await;
    h.run_step(0, "snarkjs").await.unwrap();
    let ms = h.mint_state;
    h.patch(&ms, |d| state::wr_u64(d, state::mint_state::SUPPLY, 4)).await;
    assert_eq!(rej(h.run_step(1, "snarkjs").await), code(E::Supply));

    // E_SOLVENCY: vault below supply after the transact (vault drained by injection)
    let mut h = Harness::new().await;
    h.run_step(0, "snarkjs").await.unwrap();
    let vault = h.vault;
    let reserve = h.rent.minimum_balance(165);
    let mut va = h.account(&vault).await.unwrap();
    va.data[64..72].copy_from_slice(&990u64.to_le_bytes());
    va.lamports = reserve + 990;
    h.put(&vault, va);
    assert_eq!(rej(h.run_step(1, "snarkjs").await), code(E::Solvency));

    // E_ARITHMETIC: supply overflow on deposit
    let mut h = Harness::new().await;
    let ms = h.mint_state;
    h.patch(&ms, |d| state::wr_u64(d, state::mint_state::SUPPLY, u64::MAX - 10)).await;
    let vault = h.vault;
    let mut va = h.account(&vault).await.unwrap();
    va.data[64..72].copy_from_slice(&0u64.to_le_bytes());
    h.put(&vault, va);
    assert_eq!(rej(h.run_step(0, "snarkjs").await), code(E::Arithmetic));
    // E_ARITHMETIC: outflow counter overflow
    let mut h = Harness::new().await;
    h.run_step(0, "snarkjs").await.unwrap();
    let ms = h.mint_state;
    h.patch(&ms, |d| {
        state::wr_u64(d, state::mint_state::OUTFLOW_EPOCH, 490_000);
        state::wr_u64(d, state::mint_state::OUTFLOW_IN_EPOCH, u64::MAX - 1);
    })
    .await;
    assert_eq!(rej(h.run_step(1, "snarkjs").await), code(E::Arithmetic));
}

// ---------------------------------------------------------------------------------------------------------------
// initialize_pool and register_mint (T-MINT)
// ---------------------------------------------------------------------------------------------------------------

#[tokio::test]
async fn initialize_pool_checks_and_prefunded_pool_address() {
    let mut h = Harness::new().await;
    let a = h.authority.insecure_clone();
    let (pid, pc, tree) = (h.program_id, h.pool_config, h.tree);
    let nonce = h.pool_nonce;
    // the same pool twice
    assert_eq!(rej(h.send(&[ixs::initialize_pool(&pid, &a.pubkey(), &pc, &tree, &nonce, EPOCH_SECONDS)], &a, &[]).await), code(E::AccountMismatch));
    // wrong PDA for the nonce, zero epoch length
    let n2 = [3u8; 32];
    let (pc2, _) = dark_null_pool_v2::pda::pool_config(&pid, &n2);
    let (t2, _) = dark_null_pool_v2::pda::tree(&pid, &pc2);
    assert_eq!(rej(h.send(&[ixs::initialize_pool(&pid, &a.pubkey(), &pc, &t2, &n2, EPOCH_SECONDS)], &a, &[]).await), code(E::AccountMismatch));
    assert_eq!(rej(h.send(&[ixs::initialize_pool(&pid, &a.pubkey(), &pc2, &t2, &n2, 0)], &a, &[]).await), code(E::BadIx));
    // pre-funded pool config and tree addresses (F-PREFUND applies to every PDA the program creates)
    h.put(&pc2, Account { lamports: 5, data: vec![], owner: system_program::id(), executable: false, rent_epoch: 0 });
    h.put(&t2, Account { lamports: 5, data: vec![], owner: system_program::id(), executable: false, rent_epoch: 0 });
    h.send(&[ixs::initialize_pool(&pid, &a.pubkey(), &pc2, &t2, &n2, EPOCH_SECONDS)], &a, &[]).await.unwrap();
    let d = h.data(&t2).await;
    assert_eq!(d.len(), state::tree::LEN);
    assert_eq!(Harness::tree_root(&d, 0), dark_null_transcript::tree::ZEROS[32]);
}

/// Mint extension TLV values: lengths of the real structures; content is not interpreted by the allowlist.
fn ext_value(t: u16) -> Vec<u8> {
    match t {
        ext::DEFAULT_ACCOUNT_STATE => vec![1],
        ext::METADATA_POINTER | ext::GROUP_POINTER | ext::GROUP_MEMBER_POINTER => vec![0u8; 64],
        ext::TOKEN_METADATA => vec![0u8; 100],
        ext::TOKEN_GROUP => vec![0u8; 80],
        ext::TOKEN_GROUP_MEMBER => vec![0u8; 72],
        ext::INTEREST_BEARING_CONFIG => vec![0u8; 52],
        ext::TRANSFER_FEE_CONFIG => vec![0u8; 108],
        _ => vec![0u8; 32],
    }
}

async fn register_2022(h: &mut Harness, data: Vec<u8>) -> (Outcome, Pubkey) {
    let m = Pubkey::new_unique();
    let rent = h.rent.minimum_balance(data.len());
    h.put(&m, Account { lamports: rent, data, owner: TOKEN_2022_ID, executable: false, rent_epoch: 0 });
    let (pid, pc, va) = (h.program_id, h.pool_config, h.vault_authority);
    let (ms, _) = dark_null_pool_v2::pda::mint_state(&pid, &pc, &m);
    let (v, _) = dark_null_pool_v2::pda::vault(&pid, &pc, &m);
    let a = h.authority.insecure_clone();
    (h.send(&[ixs::register_mint(&pid, &a.pubkey(), &pc, &m, &ms, &v, &va, &TOKEN_2022_ID, u64::MAX)], &a, &[]).await, m)
}

#[tokio::test]
async fn t_mint_token_2022_allowlist() {
    let mut h = Harness::new().await;
    // every rejected mint extension, the account-level types, unknown types, DefaultAccountState(Frozen)
    let rejected: Vec<(String, Vec<(u16, Vec<u8>)>)> = [
        ext::TRANSFER_FEE_CONFIG,
        ext::TRANSFER_FEE_AMOUNT,
        ext::MINT_CLOSE_AUTHORITY,
        ext::CONFIDENTIAL_TRANSFER_MINT,
        ext::CONFIDENTIAL_TRANSFER_ACCOUNT,
        ext::IMMUTABLE_OWNER,
        ext::MEMO_TRANSFER,
        ext::NON_TRANSFERABLE,
        ext::CPI_GUARD,
        ext::PERMANENT_DELEGATE,
        ext::NON_TRANSFERABLE_ACCOUNT,
        ext::TRANSFER_HOOK,
        ext::TRANSFER_HOOK_ACCOUNT,
        ext::CONFIDENTIAL_TRANSFER_FEE_CONFIG,
        ext::CONFIDENTIAL_TRANSFER_FEE_AMOUNT,
        ext::CONFIDENTIAL_MINT_BURN,
        ext::PAUSABLE,
        ext::PAUSABLE_ACCOUNT,
        28,
        0xfffe,
        0xffff,
    ]
    .iter()
    .map(|t| (format!("type {t}"), vec![(*t, ext_value(*t))]))
    .chain([
        ("DefaultAccountState(Frozen)".to_string(), vec![(ext::DEFAULT_ACCOUNT_STATE, vec![2u8])]),
        ("DefaultAccountState(Uninitialized)".to_string(), vec![(ext::DEFAULT_ACCOUNT_STATE, vec![0u8])]),
        ("allowed then rejected".to_string(), vec![(ext::METADATA_POINTER, vec![0u8; 64]), (ext::PERMANENT_DELEGATE, vec![0u8; 32])]),
    ])
    .collect();
    for (name, exts) in rejected {
        let (r, _) = register_2022(&mut h, mint_2022_data(6, &exts)).await;
        assert_eq!(rej(r), code(E::MintExtensionRejected), "{name}");
    }
    // malformed TLV: truncated value
    let mut d = mint_2022_data(6, &[(ext::METADATA_POINTER, vec![0u8; 64])]);
    d.truncate(d.len() - 1);
    assert_eq!(rej(register_2022(&mut h, d).await.0), code(E::MintExtensionRejected), "truncated");

    // accepted: each allowlisted type alone, then all together (with a freeze authority, which is recorded).
    // ScaledUiAmount (25) is newer than the spl-token-2022 1.0.0 program bundled with solana-program-test 1.18.26,
    // which cannot initialize a vault for it; it is covered by the parser test in tests/native.rs.
    let allowed = [
        ext::METADATA_POINTER,
        ext::TOKEN_METADATA,
        ext::GROUP_POINTER,
        ext::TOKEN_GROUP,
        ext::GROUP_MEMBER_POINTER,
        ext::TOKEN_GROUP_MEMBER,
        ext::INTEREST_BEARING_CONFIG,
        ext::DEFAULT_ACCOUNT_STATE,
    ];
    for t in allowed {
        let (r, m) = register_2022(&mut h, mint_2022_data(6, &[(t, ext_value(t))])).await;
        r.unwrap_or_else(|e| panic!("type {t}: {e:?}"));
        let (ms, _) = dark_null_pool_v2::pda::mint_state(&h.program_id, &h.pool_config, &m);
        let st = state::MintState::read(&h.data(&ms).await);
        assert_eq!((st.token_program_kind, st.decimals, st.freeze_authority_present), (1, 6, 0));
        let vd = h.data(&st.vault).await;
        assert_eq!(vd.len(), dark_null_pool_v2::token::VAULT_LEN_2022);
        assert_eq!(&vd[32..64], h.vault_authority.as_ref(), "vault owner is the vault authority");
        assert_eq!(&vd[166..168], &ext::IMMUTABLE_OWNER.to_le_bytes(), "vault has ImmutableOwner");
    }
    let all: Vec<(u16, Vec<u8>)> = allowed.iter().map(|t| (*t, ext_value(*t))).collect();
    let mut d = mint_2022_data(9, &all);
    d[46..50].copy_from_slice(&1u32.to_le_bytes());
    d[50..82].copy_from_slice(Pubkey::new_unique().as_ref());
    let (r, m) = register_2022(&mut h, d).await;
    r.expect("all allowlisted extensions together");
    let (ms, _) = dark_null_pool_v2::pda::mint_state(&h.program_id, &h.pool_config, &m);
    let st = state::MintState::read(&h.data(&ms).await);
    assert_eq!((st.decimals, st.freeze_authority_present), (9, 1));
    // a Token-2022 mint without extensions (82 bytes)
    register_2022(&mut h, mint_data(2, None)).await.0.expect("plain Token-2022 mint");
    // the same mint twice
    let m0 = h.mint;
    let (pid, pc, va) = (h.program_id, h.pool_config, h.vault_authority);
    let a = h.authority.insecure_clone();
    let (ms0, v0) = (h.mint_state, h.vault);
    assert_eq!(rej(h.send(&[ixs::register_mint(&pid, &a.pubkey(), &pc, &m0, &ms0, &v0, &va, &SPL_TOKEN_ID, 0)], &a, &[]).await), code(E::AccountMismatch));
    // an SPL Token mint named with the Token-2022 program
    assert_eq!(rej(h.send(&[ixs::register_mint(&pid, &a.pubkey(), &pc, &m0, &ms0, &v0, &va, &TOKEN_2022_ID, 0)], &a, &[]).await), code(E::AccountMismatch));
}

/// A Token-2022 pool passes every pre-proof check and reaches the verifier (no proof exists for its asset).
#[tokio::test]
async fn token_2022_transact_reaches_the_verifier() {
    let mut h = Harness::new().await;
    let (r, m) = register_2022(&mut h, mint_2022_data(6, &[(ext::METADATA_POINTER, vec![0u8; 64])])).await;
    r.unwrap();
    let (pid, pc) = (h.program_id, h.pool_config);
    let (ms, _) = dark_null_pool_v2::pda::mint_state(&pid, &pc, &m);
    let st = state::MintState::read(&h.data(&ms).await);
    let src = h.step_accounts(0).public_token_account;
    let dep = h.depositor.pubkey();
    let rent = h.rent.minimum_balance(165);
    h.put(&src, Account { lamports: rent, data: token_account_data(&m, &dep, 5_000, None, 1), owner: TOKEN_2022_ID, executable: false, rent_epoch: 0 });
    let r = try_mut(&mut h, 0, |d, a| {
        d[EXT + ext_off::RELAYER_FEE_ACCOUNT..EXT + ext_off::RELAYER_FEE_ACCOUNT + 32].copy_from_slice(st.vault.as_ref());
        a.mint = m;
        a.mint_state = ms;
        a.vault = st.vault;
        a.relayer_fee_account = st.vault;
        a.token_program = TOKEN_2022_ID;
    })
    .await;
    assert_eq!(rej(r), code(E::ProofInvalid));
}

// ---------------------------------------------------------------------------------------------------------------
// Solvency fuzz: random deposit / transact / withdraw sequences (fixture proofs where valid, tampered otherwise)
// ---------------------------------------------------------------------------------------------------------------

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

#[tokio::test]
async fn solvency_fuzz() {
    let cases: u64 = std::env::var("FUZZ_CASES").ok().and_then(|v| v.parse().ok()).unwrap_or(12);
    let ops: u64 = std::env::var("FUZZ_OPS").ok().and_then(|v| v.parse().ok()).unwrap_or(30);
    let leg = [(1000i64, 0u64, 0u64), (-5, 5, 0), (-600, 10, 590)]; // supply delta, relayer gain, recipient gain
    let mut totals = [0u64; 4]; // valid ok, rejected, replays, tampered
    for case in 0..cases {
        let mut rng = Rng(0x9e37_79b9_7f4a_7c15 ^ (case + 1).wrapping_mul(0x2545_f491_4f6c_dd1d));
        let mut h = Harness::new().await;
        let mut done = [false; 3];
        let mut supply = 0i64;
        let mut epoch = 490_000u64;
        let mut cap = u64::MAX;
        let mut out_epoch = 0u64;
        let mut out_in = 0u64;
        for op in 0..ops {
            let i = rng.below(3) as usize;
            let kind = rng.below(10);
            let set = SETS[rng.below(2) as usize];
            let mut d = h.step_data(i, set);
            let a = h.step_accounts(i);
            let mut tampered = false;
            match kind {
                0..=4 => {}
                5 => {
                    let k = 8 + rng.below(256) as usize;
                    d[k] ^= 1 << rng.below(8);
                    tampered = true;
                }
                6 => {
                    let k = EXT + 1 + rng.below(648) as usize;
                    d[k] ^= 1 << rng.below(8);
                    tampered = true;
                }
                7 => {
                    // amounts
                    let k = 424 + rng.below(16) as usize;
                    d[k] = d[k].wrapping_add(1 + rng.below(255) as u8);
                    tampered = true;
                }
                8 => {
                    // move the clock by -2..=2 epochs around the vector epoch
                    epoch = 489_998 + rng.below(5);
                    h.set_epoch(epoch, rng.below(3600)).await;
                }
                _ => {
                    // the authority changes the outflow cap
                    cap = [u64::MAX, 4, 5, 600, 700][rng.below(5) as usize];
                    let (pid, pc, ms) = (h.program_id, h.pool_config, h.mint_state);
                    let au = h.authority.insecure_clone();
                    h.send(&[ixs::set_beta_limits(&pid, &au.pubkey(), &pc, &ms, cap)], &au, &[]).await.unwrap();
                }
            }
            let fee_before = h.token_balance(&a.relayer_fee_account).await;
            let pub_before = h.token_balance(&a.public_token_account).await;
            let vault_before = h.vault_amount().await;
            let r = h.transact(i, &d, &a).await;
            // model: the untampered statement i succeeds iff not done, its root exists, the epoch is in the
            // window, and the outflow cap allows it
            let prereq = i == 0 || done[i - 1];
            let wd = if i == 0 { 0 } else { (-leg[i].0) as u64 };
            let (oe, oi) = if out_epoch != epoch { (epoch, 0) } else { (out_epoch, out_in) };
            let cap_ok = wd == 0 || oi + wd <= cap;
            let window = epoch.abs_diff(490_000) <= 1;
            let expect_ok = !tampered && !done[i] && prereq && window && cap_ok;
            match &r {
                Ok(_) => {
                    assert!(expect_ok, "case {case} op {op}: step {i} kind {kind} succeeded unexpectedly");
                    done[i] = true;
                    supply += leg[i].0;
                    if wd > 0 {
                        out_epoch = oe;
                        out_in = oi + wd;
                    }
                    if a.relayer_fee_account != h.vault {
                        assert_eq!(h.token_balance(&a.relayer_fee_account).await - fee_before, leg[i].1);
                    }
                    if a.public_token_account != h.vault && i > 0 {
                        assert_eq!(h.token_balance(&a.public_token_account).await - pub_before, leg[i].2);
                    }
                    totals[0] += 1;
                }
                Err(e) => {
                    assert!(!expect_ok, "case {case} op {op}: valid step {i} rejected: {e:?}");
                    assert!(matches!(e, Fail::Code(c) if (6000..=6023).contains(c)), "case {case} op {op}: {e:?}");
                    if done[i] && !tampered {
                        totals[2] += 1;
                    } else if tampered {
                        totals[3] += 1;
                    }
                    totals[1] += 1;
                    assert_eq!(h.vault_amount().await, vault_before, "a failed transact moved funds");
                }
            }
            // invariant after every instruction
            let ms = h.mint_state().await;
            let vault = h.vault_amount().await;
            assert_eq!(ms.supply as i64, supply, "case {case} op {op}: supply model");
            assert!(vault >= ms.supply, "case {case} op {op}: solvency {vault} < {}", ms.supply);
            assert_eq!(vault as i64, supply, "case {case} op {op}: vault model");
            let (ni, _, _) = h.tree_state().await;
            assert_eq!(ni, 2 * done.iter().filter(|x| **x).count() as u64);
        }
    }
    println!("FUZZ[{}] cases={cases} ops={ops} ok={} rejected={} replays={} tampered={}", mode(), totals[0], totals[1], totals[2], totals[3]);
    assert!(totals[0] > 0 && totals[3] > 0);
}

/// Random instruction data never succeeds and never moves funds.
#[tokio::test]
async fn random_instruction_data_is_rejected() {
    let mut h = Harness::new().await;
    let mut rng = Rng(42);
    let a = h.step_accounts(0);
    let n: u64 = std::env::var("FUZZ_OPS").ok().and_then(|v| v.parse().ok()).unwrap_or(30);
    for k in 0..n {
        let len = [0usize, 7, 8, 9, 16, 48, 1130, 1131, 1132][rng.below(9) as usize];
        let mut d: Vec<u8> = (0..len).map(|_| rng.next() as u8).collect();
        if len >= 8 && k % 2 == 0 {
            d[0..8].copy_from_slice(&ixs::TRANSACT);
        }
        let ix = Instruction { program_id: h.program_id, accounts: a.metas(), data: d };
        let s = h.submitter(0);
        let r = h.send(&[ix], &s, &[]).await;
        assert!(matches!(r, Err(Fail::Code(c)) if (6000..=6023).contains(&c)), "{r:?}");
    }
    assert_eq!(h.vault_amount().await, 0);
    let _ = Keypair::new();
}
