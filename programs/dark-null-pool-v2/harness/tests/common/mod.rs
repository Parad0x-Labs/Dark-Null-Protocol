//! Program-test harness for `dark-null-pool-v2`.
//!
//! One test binary runs in two modes:
//! - native: the program runs as a builtin (`processor!`), with light-poseidon, software SHA-256 and the arkworks
//!   alt_bn128 implementation (see `src/hash.rs`);
//! - SBF: with `SBF_OUT_DIR` set, `prefer_bpf` loads `dark_null_pool_v2.so` and every syscall is the runtime's.
//!   Compute units are measured in this mode only.
//!
//! Fixtures: `vectors/v2/V-E2E.json` (pool, accounts, instruction bytes, roots) and the six real Groth16 proofs in
//! `circuits/v2/probe/tests/fixtures/proofs.txt` (I1, 256-byte wire format).
#![allow(dead_code)]

use dark_null_pool_v2::instructions::{self as ixs, TransactAccounts};
use dark_null_pool_v2::state::{self, MintState, PoolConfig};
use dark_null_pool_v2::token::{SPL_TOKEN_ID, TOKEN_2022_ID};
use serde_json::Value;
use solana_program_test::{processor, BanksClientError, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::{Account, AccountSharedData},
    clock::Clock,
    compute_budget::ComputeBudgetInstruction,
    instruction::{Instruction, InstructionError},
    pubkey::Pubkey,
    rent::Rent,
    signature::{Keypair, Signer},
    system_program,
    transaction::{Transaction, TransactionError},
};
use std::path::PathBuf;
use std::str::FromStr;

pub const EPOCH_SECONDS: u64 = 3600;
pub const LAMPORTS: u64 = 1_000_000_000;

pub fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

pub fn load(name: &str) -> Value {
    let p = repo().join("vectors/v2").join(format!("{name}.json"));
    serde_json::from_str(&std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("{}: {e}", p.display()))).unwrap()
}

pub fn unhex(s: &str) -> Vec<u8> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    let s = if s.len() % 2 == 1 { format!("0{s}") } else { s.to_string() };
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}

pub fn fr(v: &Value) -> [u8; 32] {
    let b = unhex(v.as_str().unwrap());
    let mut o = [0u8; 32];
    o[32 - b.len()..].copy_from_slice(&b);
    o
}

pub fn pk(v: &Value) -> Pubkey {
    Pubkey::from_str(v.as_str().unwrap()).unwrap()
}

pub fn dec(v: &Value) -> u64 {
    match v {
        Value::String(s) => s.parse().unwrap(),
        Value::Number(n) => n.as_u64().unwrap(),
        _ => panic!("not an integer"),
    }
}

pub fn sbf_mode() -> bool {
    std::env::var("SBF_OUT_DIR").is_ok() || std::env::var("BPF_OUT_DIR").is_ok()
}

pub fn mode() -> &'static str {
    if sbf_mode() {
        "sbf"
    } else {
        "native"
    }
}

/// A proof fixture line: `label proof_hex pi_hex`.
#[derive(Clone)]
pub struct ProofFixture {
    pub label: String,
    pub proof: [u8; 256],
    pub pi: [u8; 32],
}

pub fn proofs() -> Vec<ProofFixture> {
    let p = repo().join("circuits/v2/probe/tests/fixtures/proofs.txt");
    std::fs::read_to_string(p)
        .unwrap()
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| {
            let mut it = l.split_whitespace();
            let label = it.next().unwrap().to_string();
            let proof: [u8; 256] = unhex(it.next().unwrap()).try_into().unwrap();
            let pi: [u8; 32] = unhex(it.next().unwrap()).try_into().unwrap();
            ProofFixture { label, proof, pi }
        })
        .collect()
}

/// The proof for step `name` (`deposit`, `transfer`, `withdraw`) from prover `set` (`snarkjs`, `arkworks`).
pub fn proof_for(set: &str, name: &str) -> ProofFixture {
    proofs().into_iter().find(|p| p.label == format!("{set}-{name}")).unwrap()
}

pub const STEP_NAMES: [&str; 3] = ["deposit", "transfer", "withdraw"];

/// SPL Token mint (82 bytes).
pub fn mint_data(decimals: u8, freeze: Option<Pubkey>) -> Vec<u8> {
    let mut d = vec![0u8; 82];
    d[36..44].copy_from_slice(&u64::MAX.to_le_bytes()[..8]);
    d[44] = decimals;
    d[45] = 1;
    if let Some(f) = freeze {
        d[46..50].copy_from_slice(&1u32.to_le_bytes());
        d[50..82].copy_from_slice(f.as_ref());
    }
    d
}

/// Token-2022 mint with the given TLV extensions (`(type, value)`).
pub fn mint_2022_data(decimals: u8, exts: &[(u16, Vec<u8>)]) -> Vec<u8> {
    let mut d = mint_data(decimals, None);
    if exts.is_empty() {
        return d;
    }
    d.resize(165, 0);
    d.push(1); // AccountType::Mint
    for (t, v) in exts {
        d.extend_from_slice(&t.to_le_bytes());
        d.extend_from_slice(&(v.len() as u16).to_le_bytes());
        d.extend_from_slice(v);
    }
    d
}

/// SPL token account (165 bytes). `native_reserve` makes it a wrapped-SOL account.
pub fn token_account_data(mint: &Pubkey, owner: &Pubkey, amount: u64, native_reserve: Option<u64>, state: u8) -> Vec<u8> {
    let mut d = vec![0u8; 165];
    d[0..32].copy_from_slice(mint.as_ref());
    d[32..64].copy_from_slice(owner.as_ref());
    d[64..72].copy_from_slice(&amount.to_le_bytes());
    d[108] = state;
    if let Some(r) = native_reserve {
        d[109..113].copy_from_slice(&1u32.to_le_bytes());
        d[113..121].copy_from_slice(&r.to_le_bytes());
    }
    d
}

pub fn token_amount(d: &[u8]) -> u64 {
    u64::from_le_bytes(d[64..72].try_into().unwrap())
}

/// Transaction outcome: `Ok(compute units)` or the custom error code (or a description).
pub type Outcome = Result<u64, Fail>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Fail {
    Code(u32),
    Other(String),
}

pub fn code_of(e: &TransactionError) -> Fail {
    match e {
        TransactionError::InstructionError(_, InstructionError::Custom(c)) => Fail::Code(*c),
        other => Fail::Other(format!("{other:?}")),
    }
}

pub struct Harness {
    pub ctx: ProgramTestContext,
    pub e2e: Value,
    pub program_id: Pubkey,
    pub pool_nonce: [u8; 32],
    pub pool_config: Pubkey,
    pub tree: Pubkey,
    pub mint: Pubkey,
    pub mint_state: Pubkey,
    pub vault: Pubkey,
    pub vault_authority: Pubkey,
    pub authority: Keypair,
    pub depositor: Keypair,
    pub relayer: Keypair,
    pub rent: Rent,
    pub logs: Vec<String>,
    /// Makes every transaction unique within one blockhash (failed transactions are deduplicated too).
    pub sent: u32,
}

pub fn program_test(program_id: Pubkey) -> ProgramTest {
    let mut pt = ProgramTest::new("dark_null_pool_v2", program_id, processor!(dark_null_pool_v2::process_instruction));
    pt.prefer_bpf(sbf_mode());
    pt.set_compute_max_units(1_400_000);
    pt
}

pub fn native_wsol_account(rent: &Rent, owner: &Pubkey, amount: u64) -> Account {
    let reserve = rent.minimum_balance(165);
    Account {
        lamports: reserve + amount,
        data: token_account_data(&spl_native_mint(), owner, amount, Some(reserve), 1),
        owner: SPL_TOKEN_ID,
        executable: false,
        rent_epoch: 0,
    }
}

pub fn spl_native_mint() -> Pubkey {
    Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap()
}

impl Harness {
    /// A pool at the V-E2E addresses (program id, pool nonce), wSOL registered, clock in epoch 490000, and the
    /// V-E2E public token accounts in place. `cap` is the outflow cap per epoch.
    pub async fn new_with(cap: u64, prep: impl FnOnce(&mut ProgramTest, &Value)) -> Self {
        let e2e = load("V-E2E");
        let ext = load("V-EXTDATA");
        let program_id = pk(&e2e["pool"]["program_id"]);
        let pool_nonce: [u8; 32] = unhex(ext["pool"]["pool_nonce"].as_str().unwrap()).try_into().unwrap();
        let mut pt = program_test(program_id);
        let rent = Rent::default();
        let authority = Keypair::new();
        let depositor = Keypair::new();
        let relayer = Keypair::new();
        for k in [&authority, &depositor, &relayer] {
            pt.add_account(k.pubkey(), Account { lamports: 100 * LAMPORTS, data: vec![], owner: system_program::id(), executable: false, rent_epoch: 0 });
        }
        let mint = spl_native_mint();
        pt.add_account(mint, Account { lamports: rent.minimum_balance(82), data: mint_data(9, None), owner: SPL_TOKEN_ID, executable: false, rent_epoch: 0 });
        // deposit source (owned by the depositor), relayer fee account, stealth withdraw destination
        let steps = e2e["steps"].as_array().unwrap();
        let dep_src = pk(&steps[0]["ext_data"]["fields"]["public_token_account"]);
        let fee_acct = pk(&steps[1]["ext_data"]["fields"]["relayer_fee_account"]);
        let stealth = pk(&steps[2]["ext_data"]["fields"]["public_token_account"]);
        pt.add_account(dep_src, native_wsol_account(&rent, &depositor.pubkey(), 5_000));
        pt.add_account(fee_acct, native_wsol_account(&rent, &relayer.pubkey(), 0));
        pt.add_account(stealth, native_wsol_account(&rent, &Pubkey::new_unique(), 0));
        prep(&mut pt, &e2e);
        let ctx = pt.start_with_context().await;
        let pool_config = pk(&e2e["pool"]["pool_config"]["address"]);
        let tree = pk(&e2e["pool"]["tree"]["address"]);
        let mut h = Self {
            ctx,
            program_id,
            pool_nonce,
            pool_config,
            tree,
            mint,
            mint_state: pk(&e2e["pool"]["mint_state"]["address"]),
            vault: pk(&e2e["pool"]["vault"]["address"]),
            vault_authority: pk(&e2e["pool"]["vault_authority"]["address"]),
            authority,
            depositor,
            relayer,
            rent,
            e2e,
            logs: vec![],
            sent: 0,
        };
        h.set_epoch(490_000, 1_800).await;
        let ix = ixs::initialize_pool(&program_id, &h.authority.pubkey(), &pool_config, &tree, &pool_nonce, EPOCH_SECONDS);
        let a = h.authority.insecure_clone();
        h.send(&[ix], &a, &[]).await.expect("initialize_pool");
        let ix = ixs::register_mint(&program_id, &h.authority.pubkey(), &pool_config, &mint, &h.mint_state, &h.vault, &h.vault_authority, &SPL_TOKEN_ID, cap);
        h.send(&[ix], &a, &[]).await.expect("register_mint");
        h
    }

    pub async fn new() -> Self {
        Self::new_with(u64::MAX, |_, _| {}).await
    }

    pub async fn set_epoch(&mut self, epoch: u64, offset: u64) {
        let mut c: Clock = self.ctx.banks_client.get_sysvar().await.unwrap();
        c.unix_timestamp = (epoch * EPOCH_SECONDS + offset) as i64;
        self.ctx.set_sysvar(&c);
    }

    /// Send `ixs` with a compute-unit limit; fee payer `payer`, extra signers `signers`. Returns the compute units
    /// of the whole transaction (the limit instruction itself costs 150 CU and is subtracted).
    pub async fn send(&mut self, ixs: &[Instruction], payer: &Keypair, signers: &[&Keypair]) -> Outcome {
        self.send_with_limit(ixs, payer, signers, 1_400_000).await
    }

    pub async fn send_with_limit(&mut self, ixs: &[Instruction], payer: &Keypair, signers: &[&Keypair], limit: u32) -> Outcome {
        self.sent += 1;
        let mut all = vec![ComputeBudgetInstruction::set_compute_unit_limit(limit - self.sent % 100_000)];
        all.extend_from_slice(ixs);
        let bh = self.ctx.banks_client.get_latest_blockhash().await.unwrap();
        let mut keys: Vec<&Keypair> = vec![payer];
        keys.extend_from_slice(signers);
        let tx = Transaction::new_signed_with_payer(&all, Some(&payer.pubkey()), &keys, bh);
        let r = self.ctx.banks_client.process_transaction_with_metadata(tx).await;
        match r {
            Ok(res) => {
                let md = res.metadata.clone();
                if let Some(m) = &md {
                    self.logs = m.log_messages.clone();
                }
                match res.result {
                    Ok(()) => Ok(md.map(|m| m.compute_units_consumed.saturating_sub(150)).unwrap_or(0)),
                    Err(e) => Err(code_of(&e)),
                }
            }
            Err(BanksClientError::TransactionError(e)) => Err(code_of(&e)),
            Err(e) => Err(Fail::Other(format!("{e:?}"))),
        }
    }

    pub fn step(&self, i: usize) -> &Value {
        &self.e2e["steps"][i]
    }

    /// V-E2E instruction data for step `i` with the fixture proof.
    pub fn step_data(&self, i: usize, set: &str) -> Vec<u8> {
        let s = self.step(i);
        let mut d = unhex(s["instruction"]["data_with_zero_proof"].as_str().unwrap());
        assert_eq!(d.len(), ixs::TRANSACT_LEN);
        let p = proof_for(set, STEP_NAMES[i]);
        assert_eq!(p.pi, fr(&s["public"]["pi"]), "fixture pi equals V-E2E pi");
        d[8..264].copy_from_slice(&p.proof);
        d
    }

    /// The 13 accounts of step `i` as V-E2E lists them, with the harness's submitter.
    pub fn step_accounts(&self, i: usize) -> TransactAccounts {
        let a = &self.step(i)["instruction"]["accounts"];
        let k = |j: usize| pk(&a[j]["pubkey"]);
        TransactAccounts {
            submitter: self.submitter(i).pubkey(),
            pool_config: k(1),
            tree: k(2),
            vault: k(3),
            mint: k(4),
            public_token_account: k(5),
            relayer_fee_account: k(6),
            nf_record0: k(7),
            nf_record1: k(8),
            vault_authority: k(9),
            mint_state: k(10),
            token_program: k(11),
        }
    }

    pub fn submitter(&self, i: usize) -> Keypair {
        if i == 0 {
            self.depositor.insecure_clone()
        } else {
            self.relayer.insecure_clone()
        }
    }

    /// Send a transact for step `i` with `data` and `accts`.
    pub async fn transact(&mut self, i: usize, data: &[u8], accts: &TransactAccounts) -> Outcome {
        let ix = ixs::transact(&self.program_id, accts, data);
        let s = self.submitter(i);
        self.send(&[ix], &s, &[]).await
    }

    /// Step `i` unmodified with proof set `set`.
    pub async fn run_step(&mut self, i: usize, set: &str) -> Outcome {
        let d = self.step_data(i, set);
        let a = self.step_accounts(i);
        self.transact(i, &d, &a).await
    }

    /// Run steps `0..n` successfully.
    pub async fn advance(&mut self, n: usize) {
        for i in 0..n {
            self.run_step(i, "snarkjs").await.unwrap_or_else(|e| panic!("step {i}: {e:?}"));
        }
    }

    pub async fn account(&mut self, k: &Pubkey) -> Option<Account> {
        self.ctx.banks_client.get_account(*k).await.unwrap()
    }

    pub async fn data(&mut self, k: &Pubkey) -> Vec<u8> {
        self.account(k).await.map(|a| a.data).unwrap_or_default()
    }

    pub async fn pool(&mut self) -> PoolConfig {
        PoolConfig::read(&self.data(&self.pool_config.clone()).await)
    }

    pub async fn mint_state(&mut self) -> MintState {
        MintState::read(&self.data(&self.mint_state.clone()).await)
    }

    pub async fn vault_amount(&mut self) -> u64 {
        token_amount(&self.data(&self.vault.clone()).await)
    }

    pub async fn token_balance(&mut self, k: &Pubkey) -> u64 {
        token_amount(&self.data(k).await)
    }

    pub async fn tree_state(&mut self) -> (u64, u16, Vec<u8>) {
        let d = self.data(&self.tree.clone()).await;
        (state::rd_u64(&d, state::tree::NEXT_INDEX), state::rd_u16(&d, state::tree::ROOT_HEAD), d)
    }

    pub fn tree_root(d: &[u8], slot: usize) -> [u8; 32] {
        state::rd32(d, state::tree::ROOTS + 32 * slot)
    }

    /// Overwrite an account's data in place (state injection for guard tests).
    pub async fn patch(&mut self, k: &Pubkey, f: impl FnOnce(&mut Vec<u8>)) {
        let mut a = self.account(k).await.expect("account exists");
        f(&mut a.data);
        self.ctx.set_account(k, &AccountSharedData::from(a));
    }

    pub fn put(&mut self, k: &Pubkey, a: Account) {
        self.ctx.set_account(k, &AccountSharedData::from(a));
    }

    /// The invariant of V2_SPEC 8.7: `vault.amount >= supply`.
    pub async fn solvent(&mut self) -> bool {
        let v = self.vault_amount().await;
        let s = self.mint_state().await.supply;
        v >= s
    }

    /// Program logs (8.10): `(program data events of this program, any "Program log:" line emitted at this
    /// program's own invocation depth)`.
    /// `sol_log_compute_units` readings of this program (measurement builds with `--features cu-trace`).
    pub fn cu_marks(&self) -> Vec<u64> {
        let me = self.program_id.to_string();
        let mut stack: Vec<String> = vec![];
        let mut out = vec![];
        for l in &self.logs {
            if let Some(rest) = l.strip_prefix("Program ") {
                let mut w = rest.split_whitespace();
                let who = w.next().unwrap_or("");
                let second = w.next().unwrap_or("");
                if second == "invoke" {
                    stack.push(who.to_string());
                } else if second == "success" || second == "failed:" {
                    stack.pop();
                } else if who == "consumption:" && stack.last().map(|s| s == &me).unwrap_or(false) {
                    out.push(second.parse().unwrap());
                }
            }
        }
        out
    }

    pub fn own_logs(&self) -> (Vec<Vec<Vec<u8>>>, Vec<String>) {
        let me = self.program_id.to_string();
        let mut stack: Vec<String> = vec![];
        let mut data = vec![];
        let mut msgs = vec![];
        for l in &self.logs {
            if let Some(rest) = l.strip_prefix("Program ") {
                let mut w = rest.split_whitespace();
                let who = w.next().unwrap_or("");
                let second = w.next().unwrap_or("");
                if second == "invoke" {
                    stack.push(who.to_string());
                    continue;
                }
                if second == "success" || second == "failed:" {
                    stack.pop();
                    continue;
                }
                if stack.last().map(|s| s == &me).unwrap_or(false) {
                    if let Some(b) = l.strip_prefix("Program data: ") {
                        data.push(b.split_whitespace().map(b64).collect());
                    } else if l.starts_with("Program log:") {
                        msgs.push(l.clone());
                    }
                }
            }
        }
        (data, msgs)
    }
}

pub fn b64(s: &str) -> Vec<u8> {
    const A: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = vec![];
    let mut buf = 0u32;
    let mut bits = 0;
    for c in s.bytes() {
        if c == b'=' {
            break;
        }
        let v = A.iter().position(|x| *x == c).expect("base64") as u32;
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    out
}

/// Add `x + r` to a 32-byte big-endian value (scenario S7).
pub fn plus_r(x: &[u8; 32]) -> [u8; 32] {
    let r = dark_null_transcript::fr::R_BE;
    let mut o = [0u8; 32];
    let mut carry = 0u16;
    for i in (0..32).rev() {
        let s = x[i] as u16 + r[i] as u16 + carry;
        o[i] = s as u8;
        carry = s >> 8;
    }
    assert_eq!(carry, 0);
    o
}

/// V1 transaction size (SIMD-0385, V2_SPEC 9.1): `0x81 || header[3] || LE32(mask) || blockhash || n_ix || n_addr ||
/// addresses || config values || per-instruction (program idx, n_accounts, LE16(len)) || payloads (account
/// indices || data)`, then the signatures.
pub fn v1_size(n_sigs: usize, n_addrs: usize, ix_accounts: &[usize], ix_data: &[usize], priority_fee: bool) -> usize {
    let config = if priority_fee { 8 } else { 0 } + 4 + 4;
    let headers = 4 * ix_accounts.len();
    let payloads: usize = ix_accounts.iter().zip(ix_data).map(|(a, d)| a + d).sum();
    1 + 3 + 4 + 32 + 1 + 1 + 32 * n_addrs + config + headers + payloads + 64 * n_sigs
}

pub fn token_2022_id() -> Pubkey {
    TOKEN_2022_ID
}
