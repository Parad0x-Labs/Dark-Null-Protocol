// Dark NULL v2 pool (programs/dark-null-pool-v2, V2_SPEC 8) end to end on a live cluster, all transactions V1.
//
// Flow: initialize_pool, register_mint (fresh SPL Token mint), V-E2E (deposit 1000, relayed in-pool transfer of 600
// bound to an x402 quote with relayer fee 5, relayed withdraw of 600 to a stealth ATA with relayer fee 10), and the
// negatives (tampered proof, ext_data tamper, unknown root, non-canonical public field, epoch window, double spend,
// deposit replay). Every outcome is graded from the ledger with getTransaction (err, logs, CU, fee); roots,
// nullifier records, balances and events are compared with V-E2E regenerated for this deployment's addresses.
//
// Addresses: V-E2E binds the program id (pool_id, PDAs), the mint (asset), the token accounts in ext_data and
// claimed_epoch into pi, so the committed fixture proofs only verify at the fixture program id. This script runs
// the committed generator (vectors/v2/tools/gen_v2_vectors.mjs) with the deploy-time program id, mint, wallets and
// the cluster's current epoch, then proves the three steps with the committed dev zkey (snarkjs). Everything that
// does not depend on addresses (keys, salts, values, tree shape, labels) is the committed V-E2E unchanged.
//
// Env:
//   RPC_URL          cluster RPC (required)
//   PAYER_KEY        keypair file: fee payer, pool authority, mint authority, funds the ephemeral wallets (required)
//   PROGRAM_ID       pool program id (default 3WZenuUJ1dN7iWUathmmXExPYu5zh9KX9xFoWJCGy4Zi)
//   EVIDENCE         output JSON path (default ./dark-null-pool-v2-e2e.json)
//   REPO             repository root (default: two levels above this file)
//   WORK_DIR         scratch dir for regenerated vectors and circuit inputs (default /tmp/dnp2-e2e)
//   EPOCH_SECONDS    pool epoch length (default 3600, V2_SPEC 8.2)
//   POOL_NONCE       64 hex (default: random, so every run makes a fresh pool)
//   WALLET_SOL       SOL funded to each ephemeral wallet (default 0.02); swept back to the payer at the end
// Key material is never logged. Ephemeral wallets and the mint key live in memory only.
//
// Transactions: @solana/kit 8.4.0 builds, signs and encodes every transaction as V1 (createTransactionMessage
// version 1, setTransactionMessageConfig with the compute-unit and loaded-accounts-data-size limits). Each encoded
// message is decoded again here with an independent SIMD-0385 parser (the layout proven on devnet by the Phase 0
// spikes, spikes/p0/scripts/devnet_lib.mjs) and checked against the intended instructions and limits.
// Dependencies (sandbox, npm install --ignore-scripts): @solana/kit 8.4.0, snarkjs 0.7.6, and the generator's
// circomlibjs 0.1.7, @noble/curves 1.9.7, @scure/base 1.2.6.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as kit from "@solana/kit";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RPC_URL = process.env.RPC_URL;
if (!RPC_URL || !process.env.PAYER_KEY) throw new Error("RPC_URL and PAYER_KEY are required");
const REPO = process.env.REPO || path.resolve(HERE, "../..");
const WORK = process.env.WORK_DIR || "/tmp/dnp2-e2e";
const EVIDENCE = process.env.EVIDENCE || "dark-null-pool-v2-e2e.json";
const EPOCH_SECONDS = BigInt(process.env.EPOCH_SECONDS || "3600");
const WALLET_LAMPORTS = BigInt(Math.round(Number(process.env.WALLET_SOL || "0.02") * 1e9));
const PROGRAM_ID_STR = process.env.PROGRAM_ID || "3WZenuUJ1dN7iWUathmmXExPYu5zh9KX9xFoWJCGy4Zi";
const POOL_NONCE_HEX = process.env.POOL_NONCE || crypto.randomBytes(32).toString("hex");

// ---------------- base58, keys, PDA (from spikes/p0/scripts/devnet_lib.mjs) ----------------
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58enc(buf) {
  let n = BigInt("0x" + (Buffer.from(buf).toString("hex") || "0"));
  let s = "";
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = "1" + s; else break; }
  return s;
}
function b58dec(s, len = 32) {
  let n = 0n;
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error("bad base58"); n = n * 58n + BigInt(i); }
  let h = n.toString(16); if (h.length % 2) h = "0" + h;
  let b = n === 0n ? Buffer.alloc(0) : Buffer.from(h, "hex");
  let lead = 0; for (const c of s) { if (c === "1") lead++; else break; }
  b = Buffer.concat([Buffer.alloc(lead), b]);
  if (len && b.length < len) b = Buffer.concat([Buffer.alloc(len - b.length), b]);
  return b;
}
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
function fromSeed(seed) {
  const key = crypto.createPrivateKey({ key: Buffer.concat([PKCS8, seed]), format: "der", type: "pkcs8" });
  const pub = Buffer.from(crypto.createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32));
  let pair = null; // WebCrypto key pair for @solana/kit, created on demand
  return { pub, address: b58enc(pub), kitPair: async () => (pair ||= await kit.createKeyPairFromBytes(new Uint8Array(Buffer.concat([seed, pub])))) };
}
function loadKeypair(p) {
  const arr = JSON.parse(fs.readFileSync(p, "utf8"));
  const kp = fromSeed(Buffer.from(arr.slice(0, 32)));
  if (!kp.pub.equals(Buffer.from(arr.slice(32, 64)))) throw new Error("keypair file: public key does not match the seed");
  return kp;
}
const ephemeral = () => fromSeed(crypto.randomBytes(32));
const P25519 = 2n ** 255n - 19n;
const modpow = (b, e, m) => { let r = 1n; b = ((b % m) + m) % m; while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; } return r; };
const D25519 = (-121665n * modpow(121666n, P25519 - 2n, P25519)) % P25519;
function isOnCurve(bytes) {
  const b = Buffer.from(bytes); b[31] &= 0x7f;
  const y = BigInt("0x" + Buffer.from(b).reverse().toString("hex"));
  if (y >= P25519) return false;
  const y2 = (y * y) % P25519;
  const u = (y2 - 1n + P25519) % P25519;
  const v = (D25519 * y2 + 1n) % P25519;
  const x2 = (u * modpow(v, P25519 - 2n, P25519)) % P25519;
  if (x2 === 0n) return true;
  return modpow(x2, (P25519 - 1n) / 2n, P25519) === 1n;
}
function findPda(seeds, programId) {
  for (let bump = 255; bump >= 0; bump--) {
    const h = crypto.createHash("sha256");
    for (const s of seeds) h.update(s);
    h.update(Buffer.from([bump])); h.update(programId); h.update(Buffer.from("ProgramDerivedAddress"));
    const a = h.digest();
    if (!isOnCurve(a)) return { address: a, bump };
  }
  throw new Error("no pda");
}

// ---------------- Transaction V1 (SIMD-0385) ----------------
const ROLE = (m) => (m.isSigner ? (m.isWritable ? kit.AccountRole.WRITABLE_SIGNER : kit.AccountRole.READONLY_SIGNER) : (m.isWritable ? kit.AccountRole.WRITABLE : kit.AccountRole.READONLY));
async function kitV1(payer, signers, ixs, lifetime, cfg) {
  let m = kit.createTransactionMessage({ version: 1 });
  m = kit.setTransactionMessageFeePayer(kit.address(payer.address), m);
  m = kit.setTransactionMessageLifetimeUsingBlockhash(lifetime, m);
  m = kit.appendTransactionMessageInstructions(ixs.map((ix) => ({ programAddress: kit.address(b58enc(ix.programId)), accounts: ix.keys.map((k) => ({ address: kit.address(b58enc(k.pubkey)), role: ROLE(k) })), data: new Uint8Array(ix.data) })), m);
  m = kit.setTransactionMessageConfig(cfg, m);
  const uniq = [payer, ...signers].filter((k, i, a) => a.findIndex((x) => x.pub.equals(k.pub)) === i);
  const tx = await kit.signTransaction(await Promise.all(uniq.map((k) => k.kitPair())), kit.compileTransaction(m));
  return { raw: Buffer.from(kit.getBase64EncodedWireTransaction(tx), "base64"), signature: kit.getSignatureFromTransaction(tx), message: Buffer.from(tx.messageBytes) };
}
// Independent SIMD-0385 decoder: 0x81 | header[3] | LE32 config mask | blockhash | n_ix | n_addr | addresses |
// config values (priority fee 8, CU limit 4, loaded-accounts limit 4, heap 4, in mask-bit order) |
// per-instruction (program index, n_accounts, LE16 data_len) | payloads (account indices, data).
function parseV1(b) {
  if (b[0] !== 0x81) throw new Error("not a V1 message");
  const header = [b[1], b[2], b[3]];
  const mask = b.readUInt32LE(4);
  const blockhash = b58enc(b.subarray(8, 40));
  const nIx = b[40], nAddr = b[41];
  let o = 42;
  const keys = [];
  for (let i = 0; i < nAddr; i++, o += 32) keys.push(Buffer.from(b.subarray(o, o + 32)));
  const cfg = {};
  if ((mask & 3) === 3) { cfg.priorityFee = b.readBigUInt64LE(o); o += 8; }
  if (mask & 4) { cfg.computeUnitLimit = b.readUInt32LE(o); o += 4; }
  if (mask & 8) { cfg.loadedAccountsDataSizeLimit = b.readUInt32LE(o); o += 4; }
  if (mask & 16) { cfg.heapSize = b.readUInt32LE(o); o += 4; }
  const hdrs = [];
  for (let i = 0; i < nIx; i++, o += 4) hdrs.push({ prog: b[o], n: b[o + 1], len: b.readUInt16LE(o + 2) });
  const ixs = hdrs.map((h) => { const acc = [...b.subarray(o, o + h.n)]; o += h.n; const data = Buffer.from(b.subarray(o, o + h.len)); o += h.len; return { programId: keys[h.prog], accounts: acc.map((i) => keys[i]), accIdx: acc, data }; });
  if (o !== b.length) throw new Error("trailing bytes in V1 message");
  const [nSig, nRoSig, nRoUnsigned] = header;
  const isSigner = (i) => i < nSig;
  const isWritable = (i) => (i < nSig ? i < nSig - nRoSig : i < nAddr - nRoUnsigned);
  return { header, mask, blockhash, keys, cfg, ixs, isSigner, isWritable };
}
// The decoded message carries exactly the intended instructions, flags, fee payer, blockhash and limits.
function v1Matches(p, payer, ixs, blockhashStr, cfg) {
  if (!p.keys[0].equals(payer.pub) || p.blockhash !== blockhashStr || p.mask !== 0b1100) return false;
  if (p.cfg.computeUnitLimit !== cfg.computeUnitLimit || p.cfg.loadedAccountsDataSizeLimit !== cfg.loadedAccountsDataSizeLimit) return false;
  if (p.ixs.length !== ixs.length) return false;
  return ixs.every((ix, i) => {
    const d = p.ixs[i];
    if (!d.programId.equals(ix.programId) || !d.data.equals(ix.data) || d.accounts.length !== ix.keys.length) return false;
    return ix.keys.every((k, j) => d.accounts[j].equals(k.pubkey) && (!k.isSigner || p.isSigner(d.accIdx[j])) && (!k.isWritable || p.isWritable(d.accIdx[j])));
  });
}

// ---------------- RPC ----------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rpc(method, params = []) {
  for (let attempt = 0; ; attempt++) {
    let j;
    try {
      const r = await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      if (r.status === 429 && attempt < 10) { await sleep(1500 * (attempt + 1)); continue; }
      j = await r.json();
    } catch (e) { if (attempt < 6) { await sleep(1000 * (attempt + 1)); continue; } throw e; }
    if (j.error && j.error.code === 429 && attempt < 10) { await sleep(2000 * (attempt + 1)); continue; }
    if (j.error) { const e = new Error(`${method}: ${JSON.stringify(j.error)}`); e.rpc = j.error; throw e; }
    return j.result;
  }
}
const lifetime = async () => { const v = (await rpc("getLatestBlockhash", [{ commitment: "confirmed" }])).value; return { blockhash: v.blockhash, lastValidBlockHeight: BigInt(v.lastValidBlockHeight) }; };
async function accountInfo(k) {
  const v = (await rpc("getAccountInfo", [b58enc(k), { encoding: "base64", commitment: "confirmed" }])).value;
  return v ? { lamports: BigInt(v.lamports), owner: v.owner, data: Buffer.from(v.data[0], "base64"), executable: v.executable } : null;
}
async function multipleAccounts(keys) {
  const out = [];
  for (let i = 0; i < keys.length; i += 100) {
    const v = (await rpc("getMultipleAccounts", [keys.slice(i, i + 100).map(b58enc), { encoding: "base64", commitment: "confirmed", dataSlice: { offset: 0, length: 0 } }])).value;
    out.push(...v);
  }
  return out;
}
const rentExempt = async (n) => BigInt(await rpc("getMinimumBalanceForRentExemption", [n]));

// ---------------- programs and instruction builders ----------------
const SYSTEM = Buffer.alloc(32);
const TOKEN = b58dec("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = b58dec("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const UPGRADEABLE = "BPFLoaderUpgradeab1e11111111111111111111111";
const CLOCK = b58dec("SysvarC1ock11111111111111111111111111111111");
const PROGRAM_ID = b58dec(PROGRAM_ID_STR);
const DISC = {
  initialize_pool: Buffer.from([0x5f, 0xb4, 0x0a, 0xac, 0x54, 0xae, 0xe8, 0x28]),
  register_mint: Buffer.from([0xf2, 0x2b, 0x4a, 0xa2, 0xd9, 0xd6, 0xbf, 0xab]),
  transact: Buffer.from([0xd9, 0x95, 0x82, 0x8f, 0xdd, 0x34, 0xfc, 0x77]),
};
const meta = (pubkey, isSigner, isWritable) => ({ pubkey, isSigner, isWritable });
const u64le = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const u32le = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const sysTransfer = (from, to, lamports) => ({ programId: SYSTEM, keys: [meta(from, true, true), meta(to, false, true)], data: Buffer.concat([u32le(2), u64le(lamports)]) });
const sysCreate = (from, to, lamports, space, owner) => ({ programId: SYSTEM, keys: [meta(from, true, true), meta(to, true, true)], data: Buffer.concat([u32le(0), u64le(lamports), u64le(space), owner]) });
const initMint2 = (mint, decimals, authority) => ({ programId: TOKEN, keys: [meta(mint, false, true)], data: Buffer.concat([Buffer.from([20, decimals]), authority, Buffer.from([0])]) });
const ataOf = (owner, mint) => findPda([owner, TOKEN, mint], ATA_PROGRAM).address;
const createAtaIdem = (payer, owner, mint) => ({ programId: ATA_PROGRAM, keys: [meta(payer, true, true), meta(ataOf(owner, mint), false, true), meta(owner, false, false), meta(mint, false, false), meta(SYSTEM, false, false), meta(TOKEN, false, false)], data: Buffer.from([1]) });
const mintTo = (mint, dest, authority, amount) => ({ programId: TOKEN, keys: [meta(mint, false, true), meta(dest, false, true), meta(authority, true, false)], data: Buffer.concat([Buffer.from([7]), u64le(amount)]) });
const ixInitPool = (authority, poolConfig, tree, nonce, epochSeconds) => ({ programId: PROGRAM_ID, keys: [meta(authority, true, true), meta(poolConfig, false, true), meta(tree, false, true), meta(SYSTEM, false, false)], data: Buffer.concat([DISC.initialize_pool, nonce, u64le(epochSeconds)]) });
const ixRegisterMint = (authority, poolConfig, mint, mintState, vault, vaultAuth, cap) => ({
  programId: PROGRAM_ID,
  keys: [meta(authority, true, true), meta(poolConfig, false, false), meta(mint, false, false), meta(mintState, false, true), meta(vault, false, true), meta(vaultAuth, false, false), meta(TOKEN, false, false), meta(SYSTEM, false, false)],
  data: Buffer.concat([DISC.register_mint, u64le(cap)]),
});
// V2_SPEC 8.4: the 13 transact accounts, in order, flags from V-E2E.
const ixTransact = (accounts, data) => ({ programId: PROGRAM_ID, keys: accounts.map((a) => meta(b58dec(a.pubkey), a.signer, a.writable)), data });

// ---------------- evidence ----------------
const ev = { started: new Date().toISOString(), rpc: RPC_URL.replace(/api-key=[^&]+/i, "api-key=REDACTED"), program_id: PROGRAM_ID_STR, txs: [], checks: [], cu: {} };
let failures = 0;
function check(name, ok, detail = {}) {
  ev.checks.push({ name, ok: !!ok, ...detail });
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${Object.keys(detail).length ? " " + JSON.stringify(detail, (_, v) => (typeof v === "bigint" ? v.toString() : v)) : ""}`);
}
const save = () => fs.writeFileSync(EVIDENCE, JSON.stringify(ev, (_, v) => (typeof v === "bigint" ? v.toString() : v), 1) + "\n");

// V2_SPEC 9.1: loaded_accounts_data_size_limit = sum of data lengths of every message account + ProgramData of every
// upgradeable program invoked + 32 KiB, rounded up to 32 KiB.
async function loadedLimit(keys) {
  const accs = await rpc("getMultipleAccounts", [keys.map(b58enc), { encoding: "base64", commitment: "confirmed" }]);
  let sum = 0;
  for (let i = 0; i < keys.length; i++) {
    const a = accs.value[i];
    if (!a) continue;
    const data = Buffer.from(a.data[0], "base64");
    sum += data.length;
    // every upgradeable program in the message, including the token program reached by CPI (V2_SPEC 9.1)
    if (a.owner === UPGRADEABLE && a.executable) {
      const pd = await accountInfo(data.subarray(4, 36));
      sum += pd ? pd.data.length : 0;
    }
  }
  const K = 32 * 1024;
  return Math.min(64 * 1024 * 1024, Math.ceil((sum + K) / K) * K);
}

let nonceCounter = 0;
// Send one V1 transaction (skip preflight so failures land in the ledger), then grade it from getTransaction.
// `expect`: undefined = success, number = custom error code.
async function send(label, ixs, payer, signers, { expect, cuLimit } = {}) {
  const life = await lifetime();
  // the message account set: decode a trial build of the same instructions
  const keys = parseV1((await kitV1(payer, signers, ixs, life, { computeUnitLimit: 400_000, loadedAccountsDataSizeLimit: 0 })).message).keys;
  const loaded = await loadedLimit(keys);
  let limit = cuLimit;
  let simulated = null;
  if (limit === undefined) {
    // V2_SPEC 9.1: min(400k, ceil(1.1 * simulated) + 5000); 400k when simulation is not possible (expected failures)
    limit = 400_000;
    if (expect === undefined) {
      try {
        const probe = await kitV1(payer, signers, ixs, life, { computeUnitLimit: 400_000, loadedAccountsDataSizeLimit: loaded });
        const sim = (await rpc("simulateTransaction", [probe.raw.toString("base64"), { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }])).value;
        if (!sim.err && sim.unitsConsumed) { simulated = sim.unitsConsumed; limit = Math.min(400_000, Math.ceil(1.1 * sim.unitsConsumed) + 5000); }
      } catch (_) { /* fall back to 400k */ }
    }
    limit -= nonceCounter++ % 1000; // distinct message per retry or replay
  }
  const cfg = { computeUnitLimit: limit, loadedAccountsDataSizeLimit: loaded };
  const { raw, signature, message } = await kitV1(payer, signers, ixs, life, cfg);
  const layoutOk = v1Matches(parseV1(message), payer, ixs, life.blockhash, cfg) && raw.length === message.length + 64 * parseV1(message).header[0];
  await rpc("sendTransaction", [raw.toString("base64"), { encoding: "base64", skipPreflight: true, maxRetries: 10 }]);
  let tx = null;
  for (let i = 0; i < 120 && !tx; i++) {
    await sleep(i < 5 ? 400 : 1000);
    const st = (await rpc("getSignatureStatuses", [[signature], { searchTransactionHistory: false }])).value[0];
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) {
      for (let k = 0; k < 30 && !tx; k++) {
        tx = await rpc("getTransaction", [signature, { encoding: "base64", commitment: "confirmed", maxSupportedTransactionVersion: 1 }]).catch(() => null);
        if (!tx) await sleep(500);
      }
    }
  }
  if (!tx) throw new Error(`${label}: not confirmed ${signature}`);
  const m = tx.meta;
  const code = m.err && m.err.InstructionError && m.err.InstructionError[1] && m.err.InstructionError[1].Custom !== undefined ? m.err.InstructionError[1].Custom : null;
  const rec = { label, signature, slot: tx.slot, version: tx.version, bytes: raw.length, kit_v1_layout_ok: layoutOk, err: m.err, code, cu: m.computeUnitsConsumed, fee: m.fee, cu_limit: limit, simulated_cu: simulated, loaded_limit: loaded, logs: m.logMessages };
  ev.txs.push(rec);
  save();
  if (expect === undefined) check(`${label}: success`, m.err === null, { signature, cu: rec.cu, fee: rec.fee, version: tx.version, err: m.err });
  else check(`${label}: rejected with ${expect}`, code === expect, { signature, got: m.err, cu: rec.cu, fee: rec.fee, version: tx.version });
  check(`${label}: landed as Transaction V1; kit bytes decode under SIMD-0385 to the intended message`, (tx.version === 1 || tx.version === "1") && layoutOk, { version: tx.version, bytes: raw.length });
  return rec;
}

// own-program log lines: "Program data:" events and any "Program log:" at this program's depth (8.10 allows none)
function ownLogs(logs) {
  const me = PROGRAM_ID_STR;
  const stack = [];
  const data = [];
  const msgs = [];
  const marks = [];
  for (const l of logs || []) {
    const m = /^Program (\S+) (invoke|success|failed:|consumed)/.exec(l);
    if (m && m[2] === "invoke") { stack.push(m[1]); continue; }
    if (m && (m[2] === "success" || m[2] === "failed:")) { stack.pop(); continue; }
    if (stack[stack.length - 1] !== me) continue;
    if (l.startsWith("Program data: ")) data.push(l.slice(14).split(" ").map((s) => Buffer.from(s, "base64")));
    else if (l.startsWith("Program log:")) msgs.push(l);
    else if (l.startsWith("Program consumption: ")) marks.push(Number(l.split(" ")[2]));
  }
  return { data, msgs, marks };
}

// ---------------- state readers (programs/dark-null-pool-v2/src/state.rs offsets) ----------------
const rd64 = (d, o) => d.readBigUInt64LE(o);
const tokenAmount = async (k) => { const a = await accountInfo(k); return a ? a.data.readBigUInt64LE(64) : null; };
const unhex = (s) => Buffer.from(s.replace(/^0x/, "").padStart(64, "0"), "hex");
const hex32 = (b) => "0x" + Buffer.from(b).toString("hex");

// ---------------- main ----------------
const payer = loadKeypair(process.env.PAYER_KEY);
const depositor = ephemeral();
const relayer = ephemeral();
const mintKp = ephemeral();
const MINT = mintKp.pub;
ev.wallets = { payer: payer.address, depositor: depositor.address, relayer: relayer.address, mint: mintKp.address };
ev.pool_nonce = POOL_NONCE_HEX;
ev.epoch_seconds = EPOCH_SECONDS.toString();

const prog = await accountInfo(PROGRAM_ID);
check("program account is executable and upgradeable", prog && prog.executable && prog.owner === UPGRADEABLE, { owner: prog && prog.owner });
const pd = prog ? await accountInfo(prog.data.subarray(4, 36)) : null;
if (pd) {
  const so = pd.data.subarray(45);
  ev.programdata = { address: b58enc(prog.data.subarray(4, 36)), data_len: so.length, sha256_of_data: crypto.createHash("sha256").update(so).digest("hex") };
  console.log("programdata", JSON.stringify(ev.programdata));
}

// 1. clock and epoch
const clockNow = async () => { const c = await accountInfo(CLOCK); return { slot: rd64(c.data, 0), unix: c.data.readBigInt64LE(32) }; };
const c0 = await clockNow();
const claimedEpoch = c0.unix / EPOCH_SECONDS;
ev.clock = { slot: c0.slot, unix_timestamp: c0.unix, claimed_epoch: claimedEpoch };

// 2. regenerate V-E2E for this deployment and prove the three steps with the dev zkey
fs.mkdirSync(WORK, { recursive: true });
const vecDir = path.join(WORK, "vectors");
const inDir = path.join(WORK, "inputs");
execFileSync(process.execPath, [path.join(REPO, "vectors/v2/tools/gen_v2_vectors.mjs"), vecDir, inDir], {
  env: { ...process.env, V2_PROGRAM_ID: PROGRAM_ID_STR, V2_MINT: mintKp.address, V2_POOL_NONCE: POOL_NONCE_HEX, V2_CLAIMED_EPOCH: claimedEpoch.toString(), V2_DEPOSITOR: depositor.address, V2_RELAYER: relayer.address },
  stdio: ["ignore", "ignore", "inherit"],
});
const E2E = JSON.parse(fs.readFileSync(path.join(vecDir, "V-E2E.json"), "utf8"));
const ADDR = JSON.parse(fs.readFileSync(path.join(vecDir, "V-ADDR.json"), "utf8"));
const FIX = JSON.parse(fs.readFileSync(path.join(REPO, "vectors/v2/V-E2E.json"), "utf8"));
fs.copyFileSync(path.join(vecDir, "V-E2E.json"), EVIDENCE.replace(/\.json$/, "") + ".V-E2E.json");
// address-independent parts must equal the committed vectors
const strip = (s) => ({ name: s.name, spender: s.spender, values_in: s.private.inputs.map((x) => [x.value, x.salt, x.leaf_index, x.dummy]), values_out: s.private.outputs.map((x) => [x.value, x.owner, x.salt]), deposit: s.public.deposit_amount, withdraw: s.public.withdraw_amount, public_amount: s.public.public_amount, hint: s.public.root_hint, after: [s.after.leaf_indices, s.after.new_root_hint, s.after.next_index, s.after.deposit_counter, s.after.supply, s.after.relayer_receives, s.after.public_account_receives] });
check("regenerated V-E2E equals the committed V-E2E in every address-independent field", JSON.stringify(E2E.steps.map(strip)) === JSON.stringify(FIX.steps.map(strip)) && JSON.stringify(E2E.keys) === JSON.stringify(FIX.keys) && JSON.stringify(E2E.tree) === JSON.stringify(FIX.tree));
check("regenerated V-E2E is bound to this deployment", E2E.pool.program_id === PROGRAM_ID_STR && E2E.pool.mint === mintKp.address && E2E.claimed_epoch === claimedEpoch.toString());
const snarkjs = await import("snarkjs");
const WASM = path.join(REPO, "circuits/v2/build/transact_v2.wasm");
const ZKEY = path.join(REPO, "circuits/v2/build/transact_v2_dev.zkey");
const VK = JSON.parse(fs.readFileSync(path.join(REPO, "circuits/v2/build/vk.json"), "utf8"));
const Q = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
const R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const be = (x) => BigInt(x).toString(16).padStart(64, "0");
const encodeProof = (p) => Buffer.from(be(p.pi_a[0]) + be((Q - BigInt(p.pi_a[1])) % Q) + be(p.pi_b[0][1]) + be(p.pi_b[0][0]) + be(p.pi_b[1][1]) + be(p.pi_b[1][0]) + be(p.pi_c[0]) + be(p.pi_c[1]), "hex");
const STEP = ["deposit", "transfer", "withdraw"];
const proofs = [];
ev.proofs = [];
for (let i = 0; i < 3; i++) {
  const input = JSON.parse(fs.readFileSync(path.join(inDir, `e2e_${STEP[i]}.input.json`), "utf8"));
  const t0 = performance.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  const ms = Math.round(performance.now() - t0);
  const ok = await snarkjs.groth16.verify(VK, publicSignals, proof);
  const pi = BigInt(publicSignals[0]);
  check(`proof ${STEP[i]}: snarkjs verifies and pi equals regenerated V-E2E pi`, ok && pi === BigInt(E2E.steps[i].public.pi), { pi: hex32(unhex(pi.toString(16))), prove_ms: ms });
  proofs.push(encodeProof(proof));
  ev.proofs.push({ step: STEP[i], proof: proofs[i].toString("hex"), pi: E2E.steps[i].public.pi, prove_ms: ms });
}
if (typeof globalThis.curve_bn128 !== "undefined") await globalThis.curve_bn128.terminate();
save();

const A = (s) => b58dec(s);
const poolConfig = A(E2E.pool.pool_config.address);
const tree = A(E2E.pool.tree.address);
const mintState = A(E2E.pool.mint_state.address);
const vault = A(E2E.pool.vault.address);
const vaultAuth = A(E2E.pool.vault_authority.address);
const depAta = ataOf(depositor.pub, MINT);
const relAta = ataOf(relayer.pub, MINT);
const stealthP = A(ADDR.stealth.P_base58);
const stealthAta = ataOf(stealthP, MINT);
check("deposit source, relayer fee account and stealth destination are the V-E2E ext_data accounts", E2E.steps[0].ext_data.fields.public_token_account === b58enc(depAta) && E2E.steps[1].ext_data.fields.relayer_fee_account === b58enc(relAta) && E2E.steps[2].ext_data.fields.public_token_account === b58enc(stealthAta) && ADDR.stealth.ata_P === b58enc(stealthAta));
ev.addresses = { pool_config: E2E.pool.pool_config, tree: E2E.pool.tree, mint_state: E2E.pool.mint_state, vault: E2E.pool.vault, vault_authority: E2E.pool.vault_authority, pool_id: E2E.pool.pool_id, asset: E2E.pool.asset, depositor_ata: b58enc(depAta), relayer_ata: b58enc(relAta), stealth_P: ADDR.stealth.P_base58, stealth_ata: b58enc(stealthAta) };

// 3. wallets, mint, token accounts
const payerStart = (await accountInfo(payer.pub)).lamports;
ev.payer_start_lamports = payerStart;
await send("fund ephemeral wallets", [sysTransfer(payer.pub, depositor.pub, WALLET_LAMPORTS), sysTransfer(payer.pub, relayer.pub, WALLET_LAMPORTS)], payer, []);
const mintRent = await rentExempt(82);
await send("create SPL mint (6 decimals)", [sysCreate(payer.pub, MINT, mintRent, 82, TOKEN), initMint2(MINT, 6, payer.pub)], payer, [mintKp]);
await send("create ATAs and mint 5000 to the depositor", [createAtaIdem(payer.pub, depositor.pub, MINT), createAtaIdem(payer.pub, relayer.pub, MINT), createAtaIdem(payer.pub, stealthP, MINT), mintTo(MINT, depAta, payer.pub, 5000n)], payer, []);

// 4. initialize_pool and register_mint
const nonce = Buffer.from(POOL_NONCE_HEX, "hex");
const rInit = await send("initialize_pool", [ixInitPool(payer.pub, poolConfig, tree, nonce, EPOCH_SECONDS)], payer, []);
ev.cu.initialize_pool = rInit.cu;
{
  const d = (await accountInfo(poolConfig)).data;
  check("PoolConfig: pool_id, vk_hash, epoch_seconds, authority, deposit_counter", hex32(d.subarray(80, 112)) === "0x" + E2E.pool.pool_id && d.subarray(112, 144).toString("hex") === "098eb04131454b87e0ab343130fbd76d75cc30d96b77c0c21ff3a6f094674e40" && rd64(d, 144) === EPOCH_SECONDS && d.subarray(16, 48).equals(payer.pub) && rd64(d, 152) === 0n && d.subarray(160, 192).equals(tree), { pool_id: hex32(d.subarray(80, 112)) });
  const t = (await accountInfo(tree)).data;
  check("Tree: next_index 0, roots[0] = empty root", rd64(t, 16) === 0n && hex32(t.subarray(1056, 1088)) === E2E.tree.empty_root);
}
const rReg = await send("register_mint", [ixRegisterMint(payer.pub, poolConfig, MINT, mintState, vault, vaultAuth, 2n ** 64n - 1n)], payer, []);
ev.cu.register_mint = rReg.cu;
{
  const d = (await accountInfo(mintState)).data;
  check("MintState: mint, vault, asset, supply 0, token program kind SPL", d.subarray(16, 48).equals(MINT) && d.subarray(48, 80).equals(vault) && hex32(d.subarray(80, 112)) === E2E.pool.asset && rd64(d, 112) === 0n && d[11] === 0, { asset: hex32(d.subarray(80, 112)), kind: d[11] });
  const v = await accountInfo(vault);
  check("vault: SPL token account of the mint owned by vault_authority", v && v.owner === b58enc(TOKEN) && v.data.subarray(0, 32).equals(MINT) && v.data.subarray(32, 64).equals(vaultAuth));
}

// 5. transact helpers
const stepData = (i, mutate) => {
  const d = Buffer.from(E2E.steps[i].instruction.data_with_zero_proof, "hex");
  proofs[i].copy(d, 8);
  if (mutate) mutate(d);
  return d;
};
const submitter = (i) => (i === 0 ? depositor : relayer);
const stepAccounts = (i) => E2E.steps[i].instruction.accounts.map((a, j) => (j === 0 ? { ...a, pubkey: submitter(i).address } : a));
const transact = (label, i, opts = {}) => send(label, [ixTransact(opts.accounts ? opts.accounts(stepAccounts(i)) : stepAccounts(i), stepData(i, opts.mutate))], submitter(i), [], { expect: opts.expect });
const EXT = 482; // ext_data offset in transact data (V2_SPEC 8.4)
const plusR = (b) => { const v = BigInt("0x" + b.toString("hex")) + R; return Buffer.from(v.toString(16).padStart(64, "0"), "hex"); };

// 6. negatives on the unspent deposit statement (fail before any state change)
await transact("NEG tampered proof (C.x flipped)", 0, { expect: 6012, mutate: (d) => { d[8 + 192 + 31] ^= 0x01; } });
await transact("NEG tampered proof (A from the transfer proof)", 0, { expect: 6012, mutate: (d) => { proofs[1].copy(d, 8, 0, 64); } });
await transact("NEG ext_data tamper (ciphertext0 byte)", 0, { expect: 6012, mutate: (d) => { d[EXT + 169] ^= 0x01; } });
await transact("NEG ext_data relayer_fee_account changed, account list not (step 3)", 0, { expect: 6013, mutate: (d) => { d[EXT + 65 + 31] ^= 0x01; } });
await transact("NEG unknown root", 0, { expect: 6007, mutate: (d) => { d[264 + 31] ^= 0x01; } });
await transact("NEG nf0 + r (non-canonical field, pi >= r class)", 0, { expect: 6002, mutate: (d) => { plusR(d.subarray(296, 328)).copy(d, 296); } });
await transact("NEG assoc_root = r", 0, { expect: 6002, mutate: (d) => { plusR(Buffer.alloc(32)).copy(d, 448); } });
await transact("NEG claimed_epoch + 2 (outside window)", 0, { expect: 6008, mutate: (d) => { d.writeBigUInt64LE(claimedEpoch + 2n, 440); } });
{
  const d = (await accountInfo(mintState)).data;
  check("negatives moved no funds and wrote no state", rd64(d, 112) === 0n && (await tokenAmount(vault)) === 0n && rd64((await accountInfo(tree)).data, 16) === 0n);
}

// 7. V-E2E
async function gradeStep(i, rec) {
  const s = E2E.steps[i];
  const t = (await accountInfo(tree)).data;
  const hint = s.after.new_root_hint;
  check(`${STEP[i]}: tree next_index, root_head and root ring equal V-E2E`, rd64(t, 16) === BigInt(s.after.next_index) && t.readUInt16LE(24) === hint && hex32(t.subarray(1056 + 32 * hint, 1088 + 32 * hint)) === s.after.new_root, { next_index: rd64(t, 16), root_head: t.readUInt16LE(24), root: hex32(t.subarray(1056 + 32 * hint, 1088 + 32 * hint)) });
  const recs = await Promise.all(s.nullifier_pdas.map((p) => accountInfo(A(p.address))));
  const rent0 = await rentExempt(0);
  check(`${STEP[i]}: both nullifier records exist at the V-E2E PDAs (program-owned, 0 bytes, rent-exempt)`, recs.every((r) => r && r.owner === PROGRAM_ID_STR && r.data.length === 0 && r.lamports >= rent0), { pdas: s.nullifier_pdas.map((p) => p.address), rent0 });
  const ms = (await accountInfo(mintState)).data;
  const pc = (await accountInfo(poolConfig)).data;
  const vaultAmt = await tokenAmount(vault);
  check(`${STEP[i]}: supply, deposit_counter and vault equal V-E2E`, rd64(ms, 112) === BigInt(s.after.supply) && rd64(pc, 152) === BigInt(s.after.deposit_counter) && vaultAmt === BigInt(s.after.supply), { supply: rd64(ms, 112), deposit_counter: rd64(pc, 152), vault: vaultAmt });
  const { data, msgs, marks } = ownLogs(rec.logs);
  // measurement builds only (--features cu-trace): 9 sol_log_compute_units markers, 100 CU each (V2_SPEC 8.11 steps)
  if (marks.length === 9) {
    const names = ["1-4 parse, accounts, fee", "5-6 root, epoch", "7-9 ext hash, label, pi", "10 groth16", "11 nullifier records", "12 tree insert, event", "13 public leg", "14 solvency"];
    const segs = marks.slice(1).map((m, k) => marks[k] - m - 100);
    ev.cu_trace = ev.cu_trace || {};
    ev.cu_trace[STEP[i]] = { ...Object.fromEntries(names.map((n, k) => [n, segs[k]])), outside_markers: rec.cu - segs.reduce((a, b) => a + b, 0) - 900, total_with_markers: rec.cu };
    console.log("CUTRACE", STEP[i], JSON.stringify(ev.cu_trace[STEP[i]]));
  }
  const txEv = data.find((f) => f[0].toString() === "dnull-v2-tx");
  const okTx = txEv && txEv[1].readBigUInt64LE(0) === BigInt(s.after.leaf_indices[0]) && txEv[2].readUInt16LE(0) === hint && hex32(txEv[3]) === s.after.new_root;
  let okDep = true;
  if (i === 0) {
    const dep = data.find((f) => f[0].toString() === "dnull-v2-dep");
    okDep = dep && hex32(dep[1]) === s.public.deposit_label && dep[2].equals(depositor.pub) && dep[3].equals(MINT) && dep[4].readBigUInt64LE(0) === 1000n;
  }
  check(`${STEP[i]}: events equal V-E2E and the program wrote no other log`, okTx && okDep && msgs.length === 0 && data.length === (i === 0 ? 2 : 1), { events: data.map((f) => f[0].toString()), program_log_lines: msgs.length });
}
const rDep = await transact("V-E2E deposit 1000", 0);
ev.cu.transact_deposit = rDep.cu;
await gradeStep(0, rDep);
check("deposit: depositor ATA 5000 -> 4000", (await tokenAmount(depAta)) === 4000n);
// X-RELAY: a relayer redirecting its fee to another token account of the mint, ext_data and account list changed
// together, so every account check passes and only the proof (ext_data_hash in pi) catches it.
await transact("NEG ext_data relayer_fee_account swapped with the account list (relayed transfer)", 1, {
  expect: 6012,
  mutate: (d) => { depAta.copy(d, EXT + 65); },
  accounts: (a) => a.map((x, j) => (j === 6 ? { ...x, pubkey: b58enc(depAta) } : x)),
});
check("fee redirect moved no funds", (await tokenAmount(depAta)) === 4000n && (await tokenAmount(vault)) === 1000n);
const rTr = await transact("V-E2E relayed transfer 600 (x402 quote bound, fee 5)", 1);
ev.cu.transact_transfer = rTr.cu;
await gradeStep(1, rTr);
{
  const q = JSON.parse(fs.readFileSync(path.join(vecDir, "V-EXTDATA.json"), "utf8")).quote;
  check("transfer: memo_binding is the x402 quote binding (quote mint = this mint)", E2E.steps[1].ext_data.fields.memo_binding === q.quote_binding && q.mint === mintKp.address, { quote_id: q.quoteId, amount: q.amountAtomic });
}
check("transfer: relayer ATA receives 5", (await tokenAmount(relAta)) === 5n);
const rWd = await transact("V-E2E relayed withdraw 600 to stealth ATA (fee 10)", 2);
ev.cu.transact_withdraw = rWd.cu;
await gradeStep(2, rWd);
check("withdraw: stealth ATA receives 590, relayer ATA totals 15", (await tokenAmount(stealthAta)) === 590n && (await tokenAmount(relAta)) === 15n);
{
  const t = (await accountInfo(tree)).data;
  const ring = E2E.final.roots.map((_, k) => hex32(t.subarray(1056 + 32 * k, 1088 + 32 * k)));
  check("final: next_index 6, root ring equals V-E2E final.roots, supply 395, vault 395", rd64(t, 16) === 6n && JSON.stringify(ring) === JSON.stringify(E2E.final.roots) && (await tokenAmount(vault)) === 395n && rd64((await accountInfo(mintState)).data, 112) === 395n);
}

// 8. negatives after the spends
await transact("NEG double spend: withdraw again", 2, { expect: 6011 });
await transact("NEG double spend: transfer again", 1, { expect: 6011 });
await transact("NEG deposit replay (label moved, V2_SPEC 13.2 S9)", 0, { expect: 6012 });
check("solvency after negatives: vault == supply == 395", (await tokenAmount(vault)) === 395n && rd64((await accountInfo(mintState)).data, 112) === 395n);

// 9. sweep ephemeral SOL back to the payer
for (const w of [depositor, relayer]) {
  const a = await accountInfo(w.pub);
  if (!a) continue;
  const fee = 5000n;
  if (a.lamports > fee) await send(`sweep ${w === depositor ? "depositor" : "relayer"}`, [sysTransfer(w.pub, payer.pub, a.lamports - fee)], w, []);
}
const payerEnd = (await accountInfo(payer.pub)).lamports;
ev.payer_end_lamports = payerEnd;
ev.payer_spent_lamports = payerStart - payerEnd;
ev.cu_transact_v1 = { deposit: rDep.cu, transfer: rTr.cu, withdraw: rWd.cu, reference_1_18_26: { deposit: 152362, transfer: 156954, withdraw: 159328 } };
ev.fees = ev.txs.reduce((s, t) => s + t.fee, 0);
ev.finished = new Date().toISOString();
ev.result = failures === 0 ? "PASS" : "FAIL";
ev.passed = ev.checks.filter((c) => c.ok).length;
ev.total = ev.checks.length;
save();
console.log(JSON.stringify({ result: ev.result, passed: ev.passed, total: ev.total, cu: ev.cu, payer_spent_lamports: ev.payer_spent_lamports.toString(), evidence: EVIDENCE }));
process.exit(failures === 0 ? 0 : 1);
