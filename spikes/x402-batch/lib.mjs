// spikes/x402-batch/lib.mjs - devnet helpers for the x402 batch-settlement spike.
// Runs inside a throwaway node:22 container. Keys are read from /keys (tmpfs) and never printed.
import { Keypair, PublicKey, TransactionMessage } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';
import fs from 'fs';

export const RPC = process.env.RPC || 'https://api.devnet.solana.com';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function rpc(method, params) {
  for (let a = 0; a < 10; a++) {
    try {
      const res = await fetch(RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(500 * 2 ** a);
        continue;
      }
      return await res.json();
    } catch (e) {
      await sleep(500 * 2 ** a);
    }
  }
  throw new Error(`rpc ${method} failed after retries`);
}

export const loadKey = (p) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, 'utf8'))));

export async function blockhash() {
  const r = await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
  return r.result.value.blockhash;
}

const u16 = (n) => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

// SIMD-0385 Transaction V1 serializer. Account ordering and indices come from the
// legacy compiler (format is unchanged); only the framing differs.
export function compileV1({ payer, instructions, recentBlockhash, signers, cuLimit = 1_400_000, loadedBytes = 1 << 20, priorityLamports = 0n }) {
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash, instructions }).compileToLegacyMessage();
  const keys = msg.accountKeys;
  const cix = msg.compiledInstructions;
  let mask = (1 << 2) | (1 << 3);
  const cfg = [];
  if (priorityLamports > 0n) {
    mask |= 0b11;
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(priorityLamports));
    cfg.push(...b);
  }
  cfg.push(...u32(cuLimit), ...u32(loadedBytes));
  const out = [129, msg.header.numRequiredSignatures, msg.header.numReadonlySignedAccounts, msg.header.numReadonlyUnsignedAccounts, ...u32(mask)];
  out.push(...bs58.decode(recentBlockhash));
  out.push(cix.length, keys.length);
  for (const k of keys) out.push(...k.toBytes());
  out.push(...cfg);
  for (const ix of cix) out.push(ix.programIdIndex, ix.accountKeyIndexes.length, ...u16(ix.data.length));
  for (const ix of cix) {
    out.push(...ix.accountKeyIndexes);
    out.push(...ix.data);
  }
  const message = Uint8Array.from(out);
  const sigs = [];
  for (let i = 0; i < msg.header.numRequiredSignatures; i++) {
    const kp = signers.find((s) => s.publicKey.equals(keys[i]));
    if (!kp) throw new Error(`missing signer ${keys[i].toBase58()}`);
    sigs.push(ed25519.sign(message, kp.secretKey.slice(0, 32)));
  }
  const raw = Buffer.concat([Buffer.from(message), ...sigs.map((s) => Buffer.from(s))]);
  return { raw, sig: bs58.encode(sigs[0]), numAddresses: keys.length, numSigs: sigs.length, version: 'v1' };
}

export async function simulate(raw) {
  return rpc('simulateTransaction', [raw.toString('base64'), { encoding: 'base64', sigVerify: true, commitment: 'confirmed' }]);
}

export async function sendAndConfirm(raw, sig, { skipPreflight = false } = {}) {
  const b64 = raw.toString('base64');
  const s = await rpc('sendTransaction', [b64, { encoding: 'base64', skipPreflight, preflightCommitment: 'confirmed', maxRetries: 0 }]);
  if (s.error) return { ok: false, error: s.error };
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000) {
    await sleep(1200);
    const st = await rpc('getSignatureStatuses', [[sig], { searchTransactionHistory: false }]);
    const v = st.result && st.result.value[0];
    if (v && (v.confirmationStatus === 'confirmed' || v.confirmationStatus === 'finalized')) return { ok: !v.err, err: v.err };
    await rpc('sendTransaction', [b64, { encoding: 'base64', skipPreflight: true, maxRetries: 0 }]);
  }
  return { ok: false, error: 'timeout' };
}

export async function fetchTx(sig) {
  for (let a = 0; a < 20; a++) {
    for (const v of [1, 0]) {
      const r = await rpc('getTransaction', [sig, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: v }]);
      if (r.result) return r.result;
      if (r.error && !/version/i.test(r.error.message || '')) break;
    }
    await sleep(1500);
  }
  return null;
}

export const OUT = '/app/out';
fs.mkdirSync(OUT, { recursive: true });

// Read the outcome from the ledger and append it to results.jsonl
export async function record(label, sent, built, extra = {}) {
  const tx = sent.error ? null : await fetchTx(built.sig);
  const meta = tx ? tx.meta : null;
  const row = {
    label,
    sig: built.sig,
    version: built.version,
    ledgerVersion: tx ? tx.version : null,
    bytes: built.raw.length,
    numAddresses: built.numAddresses,
    txSignatures: built.numSigs,
    slot: tx ? tx.slot : null,
    fee: meta ? meta.fee : null,
    cu: meta ? meta.computeUnitsConsumed : null,
    costUnits: meta ? meta.costUnits ?? null : null,
    err: meta ? meta.err : sent.error || 'no-tx',
    ...extra,
  };
  if (row.payments && row.fee != null) row.feePerPayment = row.fee / row.payments;
  if (meta && meta.err) row.logs = (meta.logMessages || []).slice(-6);
  if (sent.error) row.logs = ((sent.error.data && sent.error.data.logs) || [JSON.stringify(sent.error).slice(0, 400)]).slice(-6);
  fs.appendFileSync(`${OUT}/results.jsonl`, JSON.stringify(row) + '\n');
  console.log(JSON.stringify({ label, sig: row.sig, bytes: row.bytes, fee: row.fee, cu: row.cu, payments: row.payments, err: row.err }));
  return row;
}

export async function balance(pk) {
  const r = await rpc('getBalance', [pk.toBase58(), { commitment: 'confirmed' }]);
  return r.result.value;
}

export const pk = (s) => new PublicKey(s);
