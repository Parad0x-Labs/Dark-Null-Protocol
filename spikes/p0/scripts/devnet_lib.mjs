// Zero-dependency devnet client for the Phase 0 spikes (node >= 20 builtins only: crypto, fetch).
// Builds legacy and Transaction V1 (SIMD-0385) messages, signs with ed25519, sends through public RPC.
// Keys are read from paths given by environment variables; key material is never logged.
import crypto from "node:crypto";
import fs from "node:fs";

export const RPC = process.env.DEVNET_RPC || "https://api.devnet.solana.com";

// ---------------- base58 ----------------
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function b58enc(buf) {
  let n = BigInt("0x" + (Buffer.from(buf).toString("hex") || "0"));
  let s = "";
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = "1" + s; else break; }
  return s;
}
export function b58dec(s, len = 32) {
  let n = 0n;
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error("bad base58"); n = n * 58n + BigInt(i); }
  let h = n.toString(16); if (h.length % 2) h = "0" + h;
  let b = n === 0n ? Buffer.alloc(0) : Buffer.from(h, "hex");
  let lead = 0; for (const c of s) { if (c === "1") lead++; else break; }
  b = Buffer.concat([Buffer.alloc(lead), b]);
  if (len && b.length < len) b = Buffer.concat([Buffer.alloc(len - b.length), b]);
  return b;
}

// ---------------- keys ----------------
export function loadKeypair(path) {
  const arr = JSON.parse(fs.readFileSync(path, "utf8"));
  const seed = Buffer.from(arr.slice(0, 32));
  const pub = Buffer.from(arr.slice(32, 64));
  const key = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
  return { pub, address: b58enc(pub), sign: (msg) => crypto.sign(null, msg, key) };
}
export function ephemeralKeypair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { pub, address: b58enc(pub), sign: (msg) => crypto.sign(null, msg, privateKey) };
}

// ---------------- PDA ----------------
const P = 2n ** 255n - 19n;
const D = (-121665n * modpow(121666n, P - 2n, P)) % P;
function modpow(b, e, m) { let r = 1n; b = ((b % m) + m) % m; while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; } return r; }
function isOnCurve(bytes) {
  const b = Buffer.from(bytes); b[31] &= 0x7f;
  const y = BigInt("0x" + Buffer.from(b).reverse().toString("hex"));
  if (y >= P) return false;
  const y2 = (y * y) % P;
  const u = (y2 - 1n + P) % P;
  const v = (D * y2 + 1n) % P;
  const x2 = (u * modpow(v, P - 2n, P)) % P;
  if (x2 === 0n) return true;
  return modpow(x2, (P - 1n) / 2n, P) === 1n;
}
export function findPda(seeds, programId) {
  for (let bump = 255; bump >= 0; bump--) {
    const h = crypto.createHash("sha256");
    for (const s of seeds) h.update(s);
    h.update(Buffer.from([bump])); h.update(programId); h.update(Buffer.from("ProgramDerivedAddress"));
    const a = h.digest();
    if (!isOnCurve(a)) return { address: a, bump };
  }
  throw new Error("no pda");
}

// ---------------- messages ----------------
// ix: { programId: Buffer, keys: [{pubkey: Buffer, isSigner, isWritable}], data: Buffer }
function compileKeys(payer, ixs) {
  const map = new Map();
  const add = (k, s, w) => { const id = k.toString("hex"); const e = map.get(id) || { k, s: false, w: false }; e.s ||= s; e.w ||= w; map.set(id, e); };
  add(payer, true, true);
  for (const ix of ixs) { for (const m of ix.keys) add(m.pubkey, m.isSigner, m.isWritable); add(ix.programId, false, false); }
  const all = [...map.values()];
  const payerHex = payer.toString("hex");
  const order = [
    ...all.filter((e) => e.k.toString("hex") === payerHex),
    ...all.filter((e) => e.k.toString("hex") !== payerHex && e.s && e.w),
    ...all.filter((e) => e.s && !e.w),
    ...all.filter((e) => !e.s && e.w),
    ...all.filter((e) => !e.s && !e.w),
  ];
  const header = [order.filter((e) => e.s).length, order.filter((e) => e.s && !e.w).length, order.filter((e) => !e.s && !e.w).length];
  const idx = (k) => order.findIndex((e) => e.k.equals(k));
  return { order, header, idx };
}
function shortvec(n) { const out = []; let v = n; for (;;) { let b = v & 0x7f; v >>= 7; if (v) { out.push(b | 0x80); } else { out.push(b); break; } } return Buffer.from(out); }

export function legacyMessage(payer, ixs, blockhash) {
  const { order, header, idx } = compileKeys(payer, ixs);
  const parts = [Buffer.from(header), shortvec(order.length), ...order.map((e) => e.k), b58dec(blockhash), shortvec(ixs.length)];
  for (const ix of ixs) {
    parts.push(Buffer.from([idx(ix.programId)]), shortvec(ix.keys.length), Buffer.from(ix.keys.map((m) => idx(m.pubkey))), shortvec(ix.data.length), ix.data);
  }
  return { bytes: Buffer.concat(parts), signers: order.filter((e) => e.s).map((e) => e.k) };
}

// SIMD-0385 Transaction V1: 0x81 | header(3) | config mask u32 LE | blockhash | n_ix u8 | n_addr u8 | addrs |
// config values | ix headers (program idx u8, n_accts u8, data_len u16 LE) | payloads (acct idx, data); signatures appended after.
export function v1Message(payer, ixs, blockhash, cfg = {}) {
  const { order, header, idx } = compileKeys(payer, ixs);
  let mask = 0;
  const vals = [];
  if (cfg.priorityFee !== undefined) { mask |= 0b11; const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(cfg.priorityFee)); vals.push(b); }
  if (cfg.computeUnitLimit !== undefined) { mask |= 0b100; const b = Buffer.alloc(4); b.writeUInt32LE(cfg.computeUnitLimit); vals.push(b); }
  if (cfg.loadedAccountsDataSizeLimit !== undefined) { mask |= 0b1000; const b = Buffer.alloc(4); b.writeUInt32LE(cfg.loadedAccountsDataSizeLimit); vals.push(b); }
  if (cfg.heapSize !== undefined) { mask |= 0b10000; const b = Buffer.alloc(4); b.writeUInt32LE(cfg.heapSize); vals.push(b); }
  const m = Buffer.alloc(4); m.writeUInt32LE(mask);
  const parts = [Buffer.from([0x81]), Buffer.from(header), m, b58dec(blockhash), Buffer.from([ixs.length, order.length]), ...order.map((e) => e.k), ...vals];
  for (const ix of ixs) { const l = Buffer.alloc(2); l.writeUInt16LE(ix.data.length); parts.push(Buffer.from([idx(ix.programId), ix.keys.length]), l); }
  for (const ix of ixs) parts.push(Buffer.from(ix.keys.map((k) => idx(k.pubkey))), ix.data);
  return { bytes: Buffer.concat(parts), signers: order.filter((e) => e.s).map((e) => e.k), v1: true };
}

export function signTx(msg, keypairs) {
  const sigs = msg.signers.map((pk) => { const kp = keypairs.find((k) => k.pub.equals(pk)); if (!kp) throw new Error("missing signer " + b58enc(pk)); return kp.sign(msg.bytes); });
  const raw = msg.v1 ? Buffer.concat([msg.bytes, ...sigs]) : Buffer.concat([shortvec(sigs.length), ...sigs, msg.bytes]);
  return { raw, signature: b58enc(sigs[0]) };
}

// ---------------- RPC ----------------
export async function rpc(method, params = []) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    if (r.status === 429 && attempt < 8) { await new Promise((s) => setTimeout(s, 1500 * (attempt + 1))); continue; }
    const j = await r.json();
    if (j.error && j.error.code === 429 && attempt < 8) { await new Promise((s) => setTimeout(s, 2000 * (attempt + 1))); continue; }
    if (j.error) { const e = new Error(`${method}: ${JSON.stringify(j.error)}`); e.rpc = j.error; throw e; }
    return j.result;
  }
}
export const blockhash = async () => (await rpc("getLatestBlockhash", [{ commitment: "confirmed" }])).value.blockhash;
export const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

export async function simulate(raw) {
  return (await rpc("simulateTransaction", [raw.toString("base64"), { encoding: "base64", sigVerify: false, replaceRecentBlockhash: false, commitment: "confirmed" }])).value;
}

export async function sendAndConfirm(raw, signature, { skipPreflight = false } = {}) {
  await rpc("sendTransaction", [raw.toString("base64"), { encoding: "base64", skipPreflight, preflightCommitment: "confirmed", maxRetries: 5 }]);
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const st = (await rpc("getSignatureStatuses", [[signature]])).value[0];
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) {
      let tx = null;
      for (let k = 0; k < 20 && !tx; k++) {
        tx = await rpc("getTransaction", [signature, { encoding: "base64", commitment: "confirmed", maxSupportedTransactionVersion: 1 }]).catch((e) => ({ fetchError: e.message }));
        if (tx && tx.fetchError && k < 19) { tx = null; }
        if (!tx) await sleep(1000);
      }
      return { signature, status: st, tx };
    }
  }
  throw new Error("not confirmed: " + signature);
}

// parse sol_log_64 lines ("Program log: 0x1, 0x2, ...") into arrays of numbers
export function log64(logs) {
  return (logs || []).filter((l) => /^Program log: 0x[0-9a-f]+, 0x/.test(l)).map((l) => l.slice(13).split(", ").map((h) => Number(BigInt(h))));
}
export const explorer = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
export const SYSTEM = Buffer.alloc(32);
