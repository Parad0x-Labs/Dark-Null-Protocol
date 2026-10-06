// spikes/x402-batch/bench.mjs - x402 batch-settlement measurements on devnet.
// Usage (inside the sandbox container): node bench.mjs <phase>
// Phases: setup, a, b-setup, b, c, cleanup-b, cleanup-a, alt-close
// Every number is read back from the ledger (getTransaction meta.fee / computeUnitsConsumed).
import {
  PublicKey, SystemProgram, Transaction, TransactionMessage, VersionedTransaction, Keypair,
  AddressLookupTableProgram, ComputeBudgetProgram, TransactionInstruction, SYSVAR_INSTRUCTIONS_PUBKEY,
} from '@solana/web3.js';
import * as spl from '@solana/spl-token';
import { ed25519 } from '@noble/curves/ed25519';
import { AddressLookupTableAccount } from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'fs';
import {
  rpc, loadKey, blockhash, compileV1, sendAndConfirm, record, simulate, balance, sleep, OUT,
} from './lib.mjs';

const PROGRAM = new PublicKey('CyNw8DWqEmZuWvPQuXPtohS2zuVMGaCEfLMasXYBwgfd');
const ED25519_ID = new PublicKey('Ed25519SigVerify111111111111111111111111111');
const TOKEN = spl.TOKEN_PROGRAM_ID;
const DECIMALS = 6;
const STATE = `${OUT}/state.json`;

const payer = loadKey('/keys/payer.json');
const W = fs.readdirSync('/keys/w').sort().map((f) => loadKey(`/keys/w/${f}`));
const st = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
const save = () => fs.writeFileSync(STATE, JSON.stringify(st, null, 2));
const ata = (owner) => spl.getAssociatedTokenAddressSync(new PublicKey(st.mint), owner);

async function v1(label, instructions, signers, extra = {}, opts = {}) {
  const built = compileV1({ payer: payer.publicKey, instructions, recentBlockhash: await blockhash(), signers: [payer, ...signers], ...opts });
  if (built.raw.length > 4096) throw new Error(`${label}: ${built.raw.length} bytes > 4096`);
  const sent = await sendAndConfirm(built.raw, built.sig);
  if (!sent.ok) console.log(label, 'send result', JSON.stringify(sent).slice(0, 300));
  return record(label, sent, built, extra);
}

function signLegacy(ixs, signers, bh) {
  const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: bh });
  tx.add(...ixs);
  tx.sign(payer, ...signers);
  const raw = tx.serialize();
  return { raw, sig: bs58.encode(tx.signature), numAddresses: tx.compileMessage().accountKeys.length, numSigs: tx.signatures.length, version: 'legacy' };
}

function legacySize(ixs, nSigners) {
  const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: '11111111111111111111111111111111' });
  tx.add(...ixs);
  const m = tx.compileMessage().serialize().length;
  return 1 + 64 * nSigners + m;
}

async function legacy(label, ixs, signers, extra = {}) {
  const built = signLegacy(ixs, signers, await blockhash());
  const sent = await sendAndConfirm(built.raw, built.sig);
  if (!sent.ok) console.log(label, 'send result', JSON.stringify(sent).slice(0, 300));
  return record(label, sent, built, extra);
}

const xfer = (src, dst, owner, amount) => spl.createTransferCheckedInstruction(src, new PublicKey(st.mint), dst, owner, BigInt(amount), DECIMALS);

// ---------------------------------------------------------------- setup
async function setup() {
  if (st.mint) return setupAtas();
  st.balStart = await balance(payer.publicKey);
  const mintKp = Keypair.generate();
  const rent = (await rpc('getMinimumBalanceForRentExemption', [spl.MINT_SIZE])).result;
  st.mint = mintKp.publicKey.toBase58();
  save();
  const payerAta = ata(payer.publicKey);
  await v1('setup-mint', [
    SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mintKp.publicKey, lamports: rent, space: spl.MINT_SIZE, programId: TOKEN }),
    spl.createInitializeMint2Instruction(mintKp.publicKey, DECIMALS, payer.publicKey, null),
    spl.createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, payerAta, payer.publicKey, mintKp.publicKey),
    spl.createMintToCheckedInstruction(mintKp.publicKey, payerAta, payer.publicKey, 1_000_000_000_000n, DECIMALS),
  ], [mintKp], { phase: 'setup', mintRent: rent });
  return setupAtas();
}
async function setupAtas() {
  // 10 per tx: each ATA create adds ~5 entries to the 64-entry instruction trace
  for (let i = 0; i < W.length; i += 10) {
    const ixs = W.slice(i, i + 10).map((w) => spl.createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata(w.publicKey), w.publicKey, new PublicKey(st.mint)));
    await v1(`setup-ata-${i}`, ixs, [], { phase: 'setup', atasCreated: ixs.length });
  }
  st.ataRent = (await rpc('getMinimumBalanceForRentExemption', [165])).result;
  save();
}

// ---------------------------------------------------------------- A
async function phaseA() {
  const payerAta = ata(payer.publicKey);
  const A = (i) => ata(W[i].publicKey);

  // A0 baseline: one TransferChecked, one signer
  await legacy('A0-baseline-1xfer-legacy', [xfer(payerAta, A(0), payer.publicKey, 1000)], [], { approach: 'A0', payments: 1 });

  // A0 x402 exact shape: facilitator fee payer + client authority + compute budget ixs
  await legacy('A0-x402-exact-shape-legacy', [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 20_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
    xfer(A(0), payerAta, W[0].publicKey, 1000),
  ], [W[0]], { approach: 'A0', payments: 1, note: 'fee payer = facilitator, authority = client (2 tx signatures)' });

  // A legacy max fan-out (1232 bytes)
  let n = 1;
  while (n < W.length && legacySize(Array.from({ length: n + 1 }, (_, i) => xfer(payerAta, A(i), payer.publicKey, 1000)), 1) <= 1232) n++;
  await legacy(`A-legacy-fanout-max-${n}`, Array.from({ length: n }, (_, i) => xfer(payerAta, A(i), payer.publicKey, 1000)), [], { approach: 'A-legacy', payments: n });

  // A v0 + ALT max fan-out
  if (!st.alt) {
    const slot = (await rpc('getSlot', [{ commitment: 'finalized' }])).result;
    const [createIx, alt] = AddressLookupTableProgram.createLookupTable({ authority: payer.publicKey, payer: payer.publicKey, recentSlot: slot });
    st.alt = alt.toBase58();
    save();
    const addrs = [new PublicKey(st.mint), payerAta, ...W.map((w) => ata(w.publicKey))];
    await legacy('A-alt-create', [createIx, AddressLookupTableProgram.extendLookupTable({ payer: payer.publicKey, authority: payer.publicKey, lookupTable: alt, addresses: addrs.slice(0, 20) })], [], { approach: 'A-v0-alt-setup' });
    for (let i = 20; i < addrs.length; i += 25) {
      await legacy(`A-alt-extend-${i}`, [AddressLookupTableProgram.extendLookupTable({ payer: payer.publicKey, authority: payer.publicKey, lookupTable: alt, addresses: addrs.slice(i, i + 25) })], [], { approach: 'A-v0-alt-setup' });
    }
    await sleep(3000);
  }
  const altAcc = await (async () => {
    for (let a = 0; a < 10; a++) {
      const r = await rpc('getAccountInfo', [st.alt, { encoding: 'base64', commitment: 'confirmed' }]);
      if (r.result && r.result.value) {
        return new AddressLookupTableAccount({ key: new PublicKey(st.alt), state: AddressLookupTableAccount.deserialize(Buffer.from(r.result.value.data[0], 'base64')) });
      }
      await sleep(1500);
    }
  })();
  const v0Size = (k) => {
    const ixs = Array.from({ length: k }, (_, i) => xfer(payerAta, A(i), payer.publicKey, 1000));
    const m = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: '11111111111111111111111111111111', instructions: ixs }).compileToV0Message([altAcc]);
    const nAcc = m.staticAccountKeys.length + m.addressTableLookups.reduce((s, l) => s + l.writableIndexes.length + l.readonlyIndexes.length, 0);
    return { bytes: 1 + 64 + m.serialize().length, nAcc };
  };
  let k = 1;
  while (k < W.length) {
    const s = v0Size(k + 1);
    if (s.bytes > 1232 || s.nAcc > 64) break;
    k++;
  }
  {
    const ixs = Array.from({ length: k }, (_, i) => xfer(payerAta, A(i), payer.publicKey, 1000));
    const m = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: await blockhash(), instructions: ixs }).compileToV0Message([altAcc]);
    const tx = new VersionedTransaction(m);
    tx.sign([payer]);
    const built = { raw: Buffer.from(tx.serialize()), sig: bs58.encode(tx.signatures[0]), numAddresses: v0Size(k).nAcc, numSigs: 1, version: 'v0+alt' };
    const sent = await sendAndConfirm(built.raw, built.sig);
    await record(`A-v0-alt-fanout-max-${k}`, sent, built, { approach: 'A-v0-alt', payments: k });
  }

  // A V1 max fan-out: 64-address cap -> 60 recipients
  await v1(`A-v1-fanout-max-${W.length}`, W.map((w) => xfer(payerAta, ata(w.publicKey), payer.publicKey, 1000)), [], { approach: 'A-v1', payments: W.length });

  // A V1 fan-in with 11 client signers (12-signature cap)
  const m = 11;
  await v1(`A-v1-fanin-multisigner-${m}`, W.slice(0, m).map((w) => xfer(ata(w.publicKey), payerAta, w.publicKey, 100)), W.slice(0, m), { approach: 'A-v1-multisigner', payments: m });

  // read balances, approve facilitator as delegate (one-time per client), then V1 fan-in by delegate
  const bals = [];
  for (const w of W) {
    const r = await rpc('getTokenAccountBalance', [ata(w.publicKey).toBase58(), { commitment: 'confirmed' }]);
    bals.push(BigInt(r.result.value.amount));
  }
  for (let i = 0; i < W.length; i += 11) {
    const grp = W.slice(i, i + 11);
    await v1(`A-approve-delegate-${i}`, grp.map((w, j) => spl.createApproveCheckedInstruction(ata(w.publicKey), new PublicKey(st.mint), payer.publicKey, w.publicKey, bals[i + j], DECIMALS)), grp, { approach: 'A-v1-delegate-setup', approvals: grp.length });
  }
  await v1(`A-v1-fanin-delegate-${W.length}`, W.map((w, i) => xfer(ata(w.publicKey), payerAta, payer.publicKey, bals[i])), [], { approach: 'A-v1-delegate', payments: W.length });
}

// ---------------------------------------------------------------- B (program)
const seedAddr = (seed) => PublicKey.createWithSeed(payer.publicKey, seed, PROGRAM);
const u64le = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const DOMAIN = Buffer.from('DNX4BAT1');
const voucherMsg = (payeeOwner, amount, nonce) => Buffer.concat([DOMAIN, payeeOwner.toBuffer(), u64le(amount), u64le(nonce)]);

async function bSetup() {
  const pages = [['x402b-P', W.length], ['x402b-M', 1]];
  for (let i = 0; i < 40; i++) pages.push([`x402b-a${i}`, 1]);
  st.pages = {};
  const creates = [];
  for (const [seed, slots] of pages) {
    const addr = await seedAddr(seed);
    st.pages[seed] = addr.toBase58();
    const space = 48 * slots;
    const lamports = (await rpc('getMinimumBalanceForRentExemption', [space])).result;
    creates.push(SystemProgram.createAccountWithSeed({ fromPubkey: payer.publicKey, newAccountPubkey: addr, basePubkey: payer.publicKey, seed, lamports, space, programId: PROGRAM }));
  }
  save();
  for (let i = 0; i < creates.length; i += 20) await v1(`B-setup-create-${i}`, creates.slice(i, i + 20), [], { phase: 'b-setup', accounts: creates.slice(i, i + 20).length });
  // init: P slots = W[i] with balance, M slot 0 = payer (merchant), a_i slot 0 = W[i]
  const initIx = (accts, entries) => new TransactionInstruction({
    programId: PROGRAM,
    keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }, ...accts.map((a) => ({ pubkey: a, isSigner: false, isWritable: true }))],
    data: Buffer.concat([Buffer.from([0, entries.length]), ...entries.map(([ai, si, owner, bal]) => Buffer.concat([Buffer.from([ai, si]), owner.toBuffer(), u64le(bal)]))]),
  });
  const P = new PublicKey(st.pages['x402b-P']);
  const M = new PublicKey(st.pages['x402b-M']);
  await v1('B-setup-init-P', [initIx([P, M], [...W.map((w, i) => [1, i, w.publicKey, 1_000_000_000n]), [2, 0, payer.publicKey, 0n]])], [], { phase: 'b-setup' });
  for (let i = 0; i < 40; i += 20) {
    const accts = Array.from({ length: 20 }, (_, j) => new PublicKey(st.pages[`x402b-a${i + j}`]));
    await v1(`B-setup-init-a${i}`, [initIx(accts, accts.map((_, j) => [1 + j, 0, W[i + j].publicKey, 1_000_000_000n]))], [], { phase: 'b-setup' });
  }
  st.nonceP = W.map(() => 0);
  st.nonceA = Array(40).fill(0);
  save();
}

function ed25519Ix(entries) {
  // entries: [{sig, pk, msg}] all inline (instruction index 0xffff)
  const n = entries.length;
  const base = 2 + 14 * n;
  const head = Buffer.alloc(base);
  head[0] = n;
  const body = [];
  entries.forEach((e, i) => {
    const off = base + 152 * i;
    const o = 2 + 14 * i;
    head.writeUInt16LE(off, o); head.writeUInt16LE(0xffff, o + 2);
    head.writeUInt16LE(off + 64, o + 4); head.writeUInt16LE(0xffff, o + 6);
    head.writeUInt16LE(off + 96, o + 8); head.writeUInt16LE(e.msg.length, o + 10); head.writeUInt16LE(0xffff, o + 12);
    body.push(Buffer.from(e.sig), e.pk.toBuffer(), e.msg);
  });
  return new TransactionInstruction({ programId: ED25519_ID, keys: [], data: Buffer.concat([head, ...body]) });
}

const sign = (w, msg) => Buffer.from(ed25519.sign(msg, w.secretKey.slice(0, 32)));

function b1Build(idxs, amount = 1000) {
  const P = new PublicKey(st.pages['x402b-P']);
  const M = new PublicKey(st.pages['x402b-M']);
  const entries = idxs.map((i) => {
    const msg = voucherMsg(payer.publicKey, amount, st.nonceP[i] + 1);
    return { sig: sign(W[i], msg), pk: W[i].publicKey, msg };
  });
  const settle = new TransactionInstruction({
    programId: PROGRAM,
    keys: [{ pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false }, { pubkey: P, isSigner: false, isWritable: true }, { pubkey: M, isSigner: false, isWritable: true }],
    data: Buffer.concat([Buffer.from([1, idxs.length]), ...idxs.map((i) => Buffer.from([1, i, 2, 0]))]),
  });
  return [ed25519Ix(entries), settle];
}

// paged: refs into P/M. peracct: one account per payer + M.
function b2Build(idxs, { mode = 'paged', amount = 1000, tamper = false, closeAfter = false } = {}) {
  const M = new PublicKey(st.pages['x402b-M']);
  let accts; let refs;
  if (mode === 'paged') {
    accts = [new PublicKey(st.pages['x402b-P']), M];
    refs = idxs.map((i) => [0, i, 1, 0]);
  } else {
    accts = [...idxs.map((i) => new PublicKey(st.pages[`x402b-a${i}`])), M];
    refs = idxs.map((_, j) => [j, 0, idxs.length, 0]);
  }
  const body = idxs.map((i, j) => {
    const nonce = (mode === 'paged' ? st.nonceP[i] : st.nonceA[i]) + 1;
    const sig = sign(W[i], voucherMsg(payer.publicKey, amount, nonce));
    if (tamper && j === idxs.length - 1) sig[40] ^= 1;
    return Buffer.concat([Buffer.from(refs[j]), u64le(amount), sig]);
  });
  const ixs = [new TransactionInstruction({
    programId: PROGRAM,
    keys: accts.map((a) => ({ pubkey: a, isSigner: false, isWritable: true })),
    data: Buffer.concat([Buffer.from([2, idxs.length]), ...body]),
  })];
  if (closeAfter) {
    ixs.push(new TransactionInstruction({
      programId: PROGRAM,
      keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }, { pubkey: payer.publicKey, isSigner: false, isWritable: true }, ...accts.slice(0, -1).map((a) => ({ pubkey: a, isSigner: false, isWritable: true }))],
      data: Buffer.from([3]),
    }));
  }
  return ixs;
}

const bump = (arr, idxs) => idxs.forEach((i) => { arr[i] += 1; });
const sizeV1 = (ixs) => compileV1({ payer: payer.publicKey, instructions: ixs, recentBlockhash: '11111111111111111111111111111111', signers: [payer] }).raw.length;
const maxFit = (build, cap) => { let k = 1; while (k < cap && sizeV1(build(k + 1)) <= 4096) k++; return k; };

async function phaseB() {
  const range = (a, n) => Array.from({ length: n }, (_, i) => a + i);
  // negative tests first (simulate only, nothing lands)
  const neg = [];
  {
    const ixs = b2Build([0, 1], { tamper: true });
    const b = compileV1({ payer: payer.publicKey, instructions: ixs, recentBlockhash: await blockhash(), signers: [payer] });
    const s = await simulate(b.raw);
    neg.push({ label: 'B2-negative-tampered-sig', err: s.result?.value?.err ?? s.error, logs: (s.result?.value?.logs || []).slice(-3) });
    const [ed, settle] = b1Build([0, 1]);
    ed.data[2 + 28 + 10] ^= 1; // flip a signature byte of entry 0
    const b1 = compileV1({ payer: payer.publicKey, instructions: [ed, settle], recentBlockhash: await blockhash(), signers: [payer] });
    const s1 = await simulate(b1.raw);
    neg.push({ label: 'B1-negative-tampered-sig', err: s1.result?.value?.err ?? s1.error, logs: (s1.result?.value?.logs || []).slice(-3) });
  }

  // B1 precompile K=1 and K=max
  await v1('B1-precompile-k1', b1Build([0]), [], { approach: 'B1-precompile', payments: 1 }); bump(st.nonceP, [0]); save();
  const k1 = maxFit((k) => b1Build(range(1, k)), W.length - 1);
  await v1(`B1-precompile-max-${k1}`, b1Build(range(1, k1)), [], { approach: 'B1-precompile', payments: k1 }); bump(st.nonceP, range(1, k1)); save();

  // B2 in-program, paged ledger
  await v1('B2-inprogram-paged-k1', b2Build([0]), [], { approach: 'B2-inprogram-paged', payments: 1 }); bump(st.nonceP, [0]); save();
  await v1('B2-inprogram-paged-k8', b2Build(range(0, 8)), [], { approach: 'B2-inprogram-paged', payments: 8 }); bump(st.nonceP, range(0, 8)); save();
  const rows = fs.readFileSync(`${OUT}/results.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const r1 = rows.find((r) => r.label === 'B2-inprogram-paged-k1');
  const r8 = rows.find((r) => r.label === 'B2-inprogram-paged-k8');
  const per = (r8.cu - r1.cu) / 7;
  const cuCap = Math.floor((1_400_000 * 0.95 - (r1.cu - per)) / per);
  const k2 = Math.min(maxFit((k) => b2Build(range(0, k)), W.length), cuCap);
  console.log(JSON.stringify({ perVoucherCU: per, cuCap, k2 }));
  await v1(`B2-inprogram-paged-max-${k2}`, b2Build(range(0, k2)), [], { approach: 'B2-inprogram-paged', payments: k2 }); bump(st.nonceP, range(0, k2)); save();

  // replay of an already-settled voucher (paged, slot 0): rebuild with the old nonce -> must fail
  {
    const old = st.nonceP[0];
    st.nonceP[0] = old - 1;
    const ixs = b2Build([0]);
    st.nonceP[0] = old;
    const b = compileV1({ payer: payer.publicKey, instructions: ixs, recentBlockhash: await blockhash(), signers: [payer] });
    const s = await simulate(b.raw);
    neg.push({ label: 'B2-negative-replay', err: s.result?.value?.err ?? s.error, logs: (s.result?.value?.logs || []).slice(-3) });
  }

  // B2 in-program, one account per payer (escrow-account shape)
  const k3 = maxFit((k) => b2Build(range(0, k), { mode: 'peracct' }), 40);
  await v1(`B2-inprogram-peracct-max-${k3}`, b2Build(range(0, k3), { mode: 'peracct' }), [], { approach: 'B2-inprogram-peracct', payments: k3 }); bump(st.nonceA, range(0, k3)); save();
  fs.writeFileSync(`${OUT}/negative.json`, JSON.stringify(neg, null, 2));
  console.log(JSON.stringify(neg));
}

// ---------------------------------------------------------------- C (channel: 1 open + 1 close)
async function phaseC() {
  const ch = await seedAddr('x402b-ch2');
  const space = 48;
  const lamports = (await rpc('getMinimumBalanceForRentExemption', [space])).result;
  const client = W[59];
  const open = await v1('C-channel-open', [
    SystemProgram.createAccountWithSeed({ fromPubkey: payer.publicKey, newAccountPubkey: ch, basePubkey: payer.publicKey, seed: 'x402b-ch2', lamports, space, programId: PROGRAM }),
    new TransactionInstruction({ programId: PROGRAM, keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }, { pubkey: ch, isSigner: false, isWritable: true }], data: Buffer.concat([Buffer.from([0, 1, 1, 0]), client.publicKey.toBuffer(), u64le(1_000_000_000n)]) }),
  ], [], { approach: 'C-channel', phase: 'open', rent: lamports });
  // off-chain: N cumulative vouchers (nonce fixed at 1, amount grows); payee keeps the last
  const N = 1000;
  const t0 = process.hrtime.bigint();
  let last;
  for (let i = 1; i <= N; i++) last = { amount: 1000 * i, sig: sign(client, voucherMsg(payer.publicKey, 1000 * i, 1)) };
  const signMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const M = new PublicKey(st.pages['x402b-M']);
  const close = await v1('C-channel-close', [
    new TransactionInstruction({ programId: PROGRAM, keys: [{ pubkey: ch, isSigner: false, isWritable: true }, { pubkey: M, isSigner: false, isWritable: true }], data: Buffer.concat([Buffer.from([2, 1, 0, 0, 1, 0]), u64le(last.amount), last.sig]) }),
    new TransactionInstruction({ programId: PROGRAM, keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }, { pubkey: payer.publicKey, isSigner: false, isWritable: true }, { pubkey: ch, isSigner: false, isWritable: true }], data: Buffer.from([3]) }),
  ], [], { approach: 'C-channel', phase: 'close', offchainVouchers: N, offchainSignMsTotal: signMs, rentRefunded: lamports });
  fs.writeFileSync(`${OUT}/channel.json`, JSON.stringify({ N, signMs, openFee: open.fee, closeFee: close.fee, rent: lamports }, null, 2));

  // batch channel close: settle 1 voucher on each per-payer account and close them all in one tx
  const range = (a, n) => Array.from({ length: n }, (_, i) => a + i);
  const k = maxFit((kk) => b2Build(range(0, kk), { mode: 'peracct', closeAfter: true }), 40);
  await v1(`C-batch-close-${k}`, b2Build(range(0, k), { mode: 'peracct', closeAfter: true }), [], { approach: 'C-batch-close', payments: k, rentRefunded: k * lamports });
  bump(st.nonceA, range(0, k));
  st.closedA = k;
  save();
}

// ---------------------------------------------------------------- cleanup
async function cleanupB() {
  const close = (accts) => new TransactionInstruction({ programId: PROGRAM, keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }, { pubkey: payer.publicKey, isSigner: false, isWritable: true }, ...accts.map((a) => ({ pubkey: a, isSigner: false, isWritable: true }))], data: Buffer.from([3]) });
  const live = [];
  for (const [seed, a] of Object.entries(st.pages)) {
    const r = await rpc('getAccountInfo', [a, { encoding: 'base64', commitment: 'confirmed' }]);
    if (r.result && r.result.value) live.push(new PublicKey(a));
  }
  for (let i = 0; i < live.length; i += 30) await v1(`cleanup-B-close-${i}`, [close(live.slice(i, i + 30))], [], { phase: 'cleanup' });
}

async function cleanupA() {
  const payerAta = ata(payer.publicKey);
  for (let i = 0; i < W.length; i += 11) {
    const grp = W.slice(i, i + 11);
    await v1(`cleanup-A-close-atas-${i}`, grp.map((w) => spl.createCloseAccountInstruction(ata(w.publicKey), payer.publicKey, w.publicKey)), grp, { phase: 'cleanup' });
  }
  const r = await rpc('getTokenAccountBalance', [payerAta.toBase58(), { commitment: 'confirmed' }]);
  await v1('cleanup-A-burn-close-payer-ata', [
    spl.createBurnCheckedInstruction(payerAta, new PublicKey(st.mint), payer.publicKey, BigInt(r.result.value.amount), DECIMALS),
    spl.createCloseAccountInstruction(payerAta, payer.publicKey, payer.publicKey),
  ], [], { phase: 'cleanup' });
  await legacy('cleanup-A-alt-deactivate', [AddressLookupTableProgram.deactivateLookupTable({ lookupTable: new PublicKey(st.alt), authority: payer.publicKey })], [], { phase: 'cleanup' });
  st.altDeactivatedAt = Date.now();
  save();
}

async function altClose() {
  await legacy('cleanup-A-alt-close', [AddressLookupTableProgram.closeLookupTable({ lookupTable: new PublicKey(st.alt), authority: payer.publicKey, recipient: payer.publicKey })], [], { phase: 'cleanup' });
  st.balEnd = await balance(payer.publicKey);
  save();
}

const phase = process.argv[2];
const fns = { setup, a: phaseA, 'b-setup': bSetup, b: phaseB, c: phaseC, 'cleanup-b': cleanupB, 'cleanup-a': cleanupA, 'alt-close': altClose };
if (!fns[phase]) { console.error('unknown phase'); process.exit(2); }
const before = await balance(payer.publicKey);
await fns[phase]();
const after = await balance(payer.publicKey);
fs.appendFileSync(`${OUT}/balances.jsonl`, JSON.stringify({ phase, before, after, delta: after - before, at: new Date().toISOString() }) + '\n');
console.log(`phase ${phase}: payer delta ${after - before} lamports`);
