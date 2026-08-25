/**
 * OX-DARK NULL — Live Devnet ZK Cycle Demo ("Proof-of-Privacy Live Fire")
 *
 * Stages (run in order, resumable):
 *   node scripts/ox_dark_live_demo.mjs setup      — initialize vault PDA + token accounts
 *   node scripts/ox_dark_live_demo.mjs deposit    — real wSOL deposit bound to commitment C
 *   node scripts/ox_dark_live_demo.mjs root       — authority publishes Merkle root
 *   node scripts/ox_dark_live_demo.mjs page       — init nullifier page 0
 *   node scripts/ox_dark_live_demo.mjs overclaim  — prove 2x amount, expect on-chain REJECT
 *   node scripts/ox_dark_live_demo.mjs withdraw   — prove honest amount, expect payout
 *
 * Requires: .env-style env or defaults below, deployed mixer, funded keypair.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, sendAndConfirmTransaction,
} from "@solana/web3.js";

import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ART = path.join(ROOT, "artifacts", "live-demo");
fs.mkdirSync(ART, { recursive: true });

// ── config ────────────────────────────────────────────────────────────────────
const PROGRAM_ID = new PublicKey("35GMe13ExGB1JGp1wZGrEvHfQnENKADroDQApeziKuwV");
const RPC = process.env.OX_RPC_URL || "https://api.devnet.solana.com";
const PAYER_FILE = process.env.OX_KEYPAIR || path.join(ROOT, "..", "keys", "devnet-deployer.json");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const DEPOSIT_LAMPORTS = 50_000_000n; // 0.05 SOL

const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(PAYER_FILE, "utf8"))));
const conn = new Connection(RPC, "confirmed");
const log = (...a) => console.log("[demo]", ...a);

// ── MiMC sponge (circomlib-compatible) ────────────────────────────────────────
const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
function loadRoundConstants() {
  const src = fs.readFileSync(
    path.join(ROOT, "node_modules", "circomlib", "circuits", "mimcsponge.circom"), "utf8");
  const block = src.slice(src.indexOf("c_partial[218]"));
  const nums = [...block.matchAll(/(\d{10,})\s*,?/g)].map(m => BigInt(m[1]));
  if (nums.length !== 218) throw new Error(`expected 218 round constants, got ${nums.length}`);
  return nums;
}
const C = loadRoundConstants();
function feistel(xL_in, xR_in, k) {
  let xL = xL_in, xR = xR_in;
  for (let i = 0; i < 220; i++) {
    const c = (i === 0 || i === 219) ? 0n : C[i - 1];
    const t = (i === 0 ? k + xL_in : k + xL + c) % P;
    const t5 = t * t % P * t % P * t % P * t % P;
    if (i < 219) {
      const aux = (i === 0) ? xR_in : xR;
      const nxL = (aux + t5) % P;
      xR = xL; xL = nxL;
    } else {
      const out_xR = (xR + t5) % P;
      return [xL, out_xR];
    }
  }
}
export function mimcSponge(ins, k = 0n) {
  let xL = 0n, xR = 0n;
  for (let i = 0; i < ins.length; i++) {
    if (i === 0) { [xL, xR] = feistel(ins[0] % P, 0n, k); }
    else { [xL, xR] = feistel((xL + ins[i]) % P, xR, k); }
  }
  // outs[0] = last component's xL_out (template MiMCSponge with nOutputs=1)
  return xL;
}
const hash2 = (a, b) => mimcSponge([a, b]);

// ── helpers ───────────────────────────────────────────────────────────────────
const disc = (name) => crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
function u64le(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; }
function le32(n) {
  const b = Buffer.alloc(32);
  b.writeBigInt64LE ? null : null;
  let v = BigInt(n);
  for (let i = 0; i < 32; i++) { b[i] = Number(v & 0xffn); v >>= 8n; }
  return b;
}
function be32(n) {
  const h = BigInt(n).toString(16).padStart(64, "0");
  if (h.length > 64) throw new Error("value exceeds 32 bytes");
  return Buffer.from(h, "hex");
}
function bytes16ToFr(bytes16) { const b = Buffer.alloc(32); bytes16.copy(b, 16); return BigInt("0x" + b.toString("hex")); }
const pubParts = (pk) => { const b = pk.toBuffer(); return [bytes16ToFr(b.subarray(0, 16)), bytes16ToFr(b.subarray(16))]; };
function ix(name, keys, args) {
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data: Buffer.concat([disc(name), args]) });
}
async function send(ixs, extraSigners = []) {
  const tx = new Transaction().add(...ixs);
  return sendAndConfirmTransaction(conn, tx, [payer, ...extraSigners]);
}
const save = (f, o) => { fs.writeFileSync(path.join(ART, f), typeof o === "string" ? o : JSON.stringify(o, null, 2)); log("wrote", f); };

// ── PDAs / state file ─────────────────────────────────────────────────────────
const [VAULT] = PublicKey.findProgramAddressSync([Buffer.from("merkle_vault")], PROGRAM_ID);
const [ROOT_AUTH] = PublicKey.findProgramAddressSync([Buffer.from("root_authority")], PROGRAM_ID);

function loadState() {
  const f = path.join(ART, "state.json");
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
}
function patchState(obj) {
  const s = { ...loadState(), ...obj };
  save("state.json", s);
  return s;
}

// ── stages ────────────────────────────────────────────────────────────────────
const stage = process.argv[2];
if (!stage) { console.log("usage: demo <setup|deposit|root|page|overclaim|withdraw>"); process.exit(1); }

if (stage === "setup") {
  log("payer:", payer.publicKey.toBase58());
  log("vault PDA:", VAULT.toBase58());
  if (!loadState().initialized) {
    const sig = await send([
      ix("initialize", [
        { pubkey: VAULT, isSigner: false, isWritable: true },
        { pubkey: ROOT_AUTH, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ], Buffer.alloc(0)),
    ]);
    log("initialize tx:", sig);
    patchState({ initialized: true });
  }

  // Token plumbing via spl-token CLI. The CLI's signer parser chokes on paths
  // with spaces, so stage a copy of the keypair at a clean path.
  const kpCopy = path.join(os.homedir(), ".ox-demo-keypair.json");
  fs.copyFileSync(PAYER_FILE, kpCopy);
  const cli = (args) => {
    try {
      return execFileSync("spl-token",
        [...args, "--fee-payer", kpCopy, "--url", RPC.split("/")[2] === "api.devnet.solana.com" ? "devnet" : RPC],
        { encoding: "utf8" });
    } catch (e) {
      // "Account already exists" still prints the address on stdout — usable.
      if (/already exists/.test(String(e))) return String(e.stdout || "");
      throw e;
    }
  };

  let s = loadState();
  if (!s.userWsol) {
    const out = cli(["create-account", WSOL_MINT.toBase58()]);
    const m = out.match(/Creating account (\w+)/);
    const userWsol = m ? m[1] : (await conn.getTokenAccountsByOwner(payer.publicKey, { mint: WSOL_MINT })).value[0].pubkey.toBase58();
    patchState({ userWsol }); s = loadState();
    log("user wSOL ATA:", userWsol);
    const wrapOut = cli(["wrap", "1"]);
    log("wrapped 1 SOL into wSOL");
  }
  if (!s.vaultWsol) {
    const out = cli(["create-account", WSOL_MINT.toBase58(), "--owner", VAULT.toBase58()]);
    const m = out.match(/Creating account (\w+)/);
    if (!m) throw new Error("could not parse vault token account from: " + out);
    patchState({ vaultWsol: m[1] });
    log("vault wSOL account:", m[1]);
  }
}

else if (stage === "deposit") {
  const s = loadState();
  if (!s.userWsol || !s.vaultWsol) throw new Error("run setup-token first");
  const secret = BigInt("0x" + crypto.randomBytes(31).toString("hex")) % P;
  const blinding = BigInt("0x" + crypto.randomBytes(31).toString("hex")) % P;
  const userWsol = new PublicKey(s.userWsol);
  const [r0, r1] = pubParts(userWsol);
  const [m0, m1] = pubParts(WSOL_MINT);
  const commitment = mimcSponge([BigInt(DEPOSIT_LAMPORTS), r0, r1, m0, m1, blinding, secret]);
  log("commitment:", commitment.toString(16));

  const idx = s.nextLeaf ?? 0;
  patchState({ secret: secret.toString(), blinding: blinding.toString(),
    commitment: commitment.toString(), leafIndex: idx,
    nextLeaf: idx + 1,
    deposits: [...(s.deposits || []), { index: idx, commitment: commitment.toString() }] });

  const note = Buffer.from(crypto.randomBytes(64));
  const eph = crypto.randomBytes(32);
  const args = Buffer.concat([
    u64le(DEPOSIT_LAMPORTS),
    be32(commitment),
    (() => { const l = Buffer.alloc(4); l.writeUInt32LE(note.length); return Buffer.concat([l, note]); })(),
    eph,
    Buffer.from([0]),
  ]);
  const sig = await send([
    ix("deposit_wsol_and_whisper", [
      { pubkey: VAULT, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: userWsol, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(s.vaultWsol), isSigner: false, isWritable: true },
      { pubkey: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), isSigner: false, isWritable: false },
    ], args),
  ]);
  log("deposit tx:", sig);
  patchState({ depositTx: sig });
}

else if (stage === "root") {
  // Rebuild the tree locally: leaf = our commitment at leafIndex, rest zeros.
  const s = loadState();
  const depth = 7;
  // Reconstruct the full leaf set as it exists on-chain.
  const leaves = new Array(128).fill(0n);
  for (const d of s.deposits || []) leaves[d.index] = BigInt(d.commitment);
  let level = leaves.slice();
  const defaults = [hash2(0n, 0n)];
  for (let i = 1; i < depth; i++) defaults.push(hash2(defaults[i - 1], defaults[i - 1]));
  const idx = s.leafIndex ?? 0;
  const pathElements = [], pathIndices = [];
  let levelIdx = idx;
  for (let i = 0; i < depth; i++) {
    const sibling = (levelIdx % 2 === 0) ? level[levelIdx + 1] : level[levelIdx - 1];
    pathElements.push(sibling); pathIndices.push(levelIdx % 2);
    const next = [];
    for (let j = 0; j < level.length; j += 2) next.push(hash2(level[j], level[j + 1]));
    level = next;
    levelIdx = Math.floor(levelIdx / 2);
  }
  const root = level[0];
  log("root:", root.toString(16));
  patchState({ root: root.toString(), pathElements: pathElements.map(String), pathIndices });
  const args = be32(root);
  const sig = await send([
    ix("update_root", [
      { pubkey: VAULT, isSigner: false, isWritable: true },
      { pubkey: ROOT_AUTH, isSigner: false, isWritable: false },
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
    ], args),
  ]);
  log("update_root tx:", sig);
}

else if (stage === "page") {
  const [pagePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("nullifier_page"), VAULT.toBuffer(), Buffer.from([0])], PROGRAM_ID);
  log("page PDA:", pagePda.toBase58());
  const sig = await send([
    ix("init_nullifier_page", [
      { pubkey: VAULT, isSigner: false, isWritable: false },
      { pubkey: pagePda, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ], Buffer.from([0])),
  ]);
  log("init_nullifier_page tx:", sig);
  patchState({ pagePda: pagePda.toBase58() });
}

// shared: build circom input + run snarkjs, cache per amount
async function proveForAmount(amountLamports, forceAttack) {
  const s = loadState();
  const useAttack = forceAttack || !!s.useAttackNote;
  const sec = useAttack ? s.attackSecret : s.secret;
  const blind = useAttack ? s.attackBlinding : s.blinding;
  const userWsol = new PublicKey(s.userWsol);
  const [r0, r1] = pubParts(userWsol);
  const [m0, m1] = pubParts(WSOL_MINT);
  const input = {
    amount: amountLamports.toString(),
    receiver_token_part_0: r0.toString(),
    receiver_token_part_1: r1.toString(),
    mint_part_0: m0.toString(),
    mint_part_1: m1.toString(),
    blinding: blind,
    nullifier_secret: sec,
    pathElements: s.pathElements,
    pathIndices: s.pathIndices,
  };
  const tag = `amt${amountLamports}${useAttack ? "-atk" : ""}`;
  const inFile = path.join(ART, `input_${tag}.json`);
  fs.writeFileSync(inFile, JSON.stringify(input));
  const outFile = path.join(ART, `proof_${tag}.json`);
  execFileSync(path.join(ROOT, "node_modules", ".bin", "snarkjs"),
    ["groth16", "fullprove", inFile,
     path.join(ROOT, "circuits", "null_proof_js", "null_proof.wasm"),
     path.join(ROOT, "circuits", "null_proof_final.zkey"), outFile,
     path.join(ART, `public_${tag}.json`)],
    { stdio: "inherit" });
  const proof = JSON.parse(fs.readFileSync(outFile, "utf8"));
  const pub = JSON.parse(fs.readFileSync(path.join(ART, `public_${tag}.json`), "utf8")).map(BigInt);
  log("publicSignals:", pub.map(p => p.toString(16)));
  // sanity: commitment/nullifier/root match local computation
  const nullifier = mimcSponge([BigInt(sec)]);
  // Expected commitment recomputed at THIS claim's amount (over-claims commit
  // to a different amount by design).
  const userWsol2 = new PublicKey(s.userWsol);
  const [er0, er1] = pubParts(userWsol2);
  const [em0, em1] = pubParts(WSOL_MINT);
  const expectCommit = mimcSponge([
    BigInt(amountLamports), er0, er1, em0, em1,
    BigInt(blind), BigInt(sec),
  ]);
  if (!process.env.OX_SKIP_SANITY) {
    if (pub[0] !== expectCommit) throw new Error(`commitment mismatch circuit vs js! (${pub[0].toString(16)} vs ${expectCommit.toString(16)})`);
    if (pub[1] !== nullifier) throw new Error("nullifier mismatch circuit vs js!");
    if (pub[2] !== BigInt(s.root)) throw new Error("root mismatch circuit vs js!");
    log("✔ JS MiMC matches circom circuit (commitment, nullifier, root)");
  }
  return { proof, publicSignals: pub };
}

function groth16SolanaBytes(proof) {
  // Convention matrix driver: OX_A in {raw,yneg,xneg}, OX_B_SWAP 0/1, OX_LE 0/1
  const Pmod = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  const be = (dec) => Buffer.from(BigInt(dec).toString(16).padStart(64, "0"), "hex");
  const le = (dec) => { const b = Buffer.alloc(32); let v = BigInt(dec); for (let i = 0; i < 32; i++) { b[i] = Number(v & 0xffn); v >>= 8n; } return b; };
  const f = process.env.OX_LE === "1" ? le : be;
  const flip = process.env.OX_A || "yneg";
  const a = proof.pi_a, b = proof.pi_b, c = proof.pi_c;
  const ax = flip === "x" ? (Pmod - BigInt(a[0])) % Pmod : BigInt(a[0]);
  const ay = flip === "y" ? (Pmod - BigInt(a[1])) % Pmod : BigInt(a[1]);
  const swap = process.env.OX_B_SWAP === "1";
  const r0 = swap ? [b[0][1], b[0][0]] : [b[0][0], b[0][1]];
  const r1 = swap ? [b[1][1], b[1][0]] : [b[1][0], b[1][1]];
  return {
    proofA: Buffer.concat([f(ax), f(ay)]),
    proofB: Buffer.concat([f(r0[0]), f(r0[1]), f(r1[0]), f(r1[1])]),
    proofC: Buffer.concat([f(c[0]), f(c[1])]),
  };
}

async function withdrawAttempt(amountLamports, expectReject) {
  let s = loadState();
  const useAttack = process.argv[3] === "attack";
  if (useAttack) { s.useAttackNote = true; }
  const sec = useAttack ? s.attackSecret : s.secret;
  const { proof, publicSignals } = await proveForAmount(amountLamports, useAttack);
  const { proofA, proofB, proofC } = groth16SolanaBytes(proof);
  const nullifier = mimcSponge([BigInt(sec)]);
  const userWsol = new PublicKey(s.userWsol);
  const vaultWsol = new PublicKey(s.vaultWsol);
  const [r0, r1] = pubParts(userWsol);
  const [m0, m1] = pubParts(WSOL_MINT);
  const pubInputs = [
    be32(publicSignals[0]), be32(nullifier), be32(BigInt(s.root)),
    (() => { const b = Buffer.alloc(32); b.writeBigUInt64BE(amountLamports, 24); return b; })(),
    be32(r0), be32(r1), be32(m0), be32(m1),
  ];
  fs.writeFileSync(path.join(ART, "onchain_bytes.json"), JSON.stringify({
    proofA: proofA.toString("hex"), proofB: proofB.toString("hex"),
    proofC: proofC.toString("hex"),
    pubs: pubInputs.map(x => x.toString("hex")),
  }));
  const args = Buffer.concat([
    u64le(amountLamports),
    be32(nullifier), be32(BigInt(s.root)),
    proofA, proofB, proofC,
    Buffer.concat(pubInputs),
  ]);
  const keys = [
    { pubkey: VAULT, isSigner: false, isWritable: true },
    { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
    { pubkey: vaultWsol, isSigner: false, isWritable: true },
    { pubkey: userWsol, isSigner: false, isWritable: true },
    { pubkey: payer.publicKey, isSigner: true, isWritable: false },
    { pubkey: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), isSigner: false, isWritable: false },
    { pubkey: new PublicKey(s.pagePda), isSigner: false, isWritable: true }, // remaining: page 0
  ];
  try {
    const sig = await send([ix("prepare_phantom_withdraw_v2", keys, args)]);
    log(`WITHDRAW ${expectReject ? "(UNEXPECTED SUCCESS)" : "OK"} tx:`, sig);
    return { ok: true, sig };
  } catch (e) {
    log(`WITHDRAW result:`, String(e).split("\n")[0]);
    return { ok: false, error: String(e) };
  }
}

if (stage === "attack-deposit") {
  // THE C1 ATTACK, live: commit to 2x while transferring only 1x.
  const s = loadState();
  const ATTACK_AMOUNT = DEPOSIT_LAMPORTS * 2n;
  const secret = BigInt("0x" + crypto.randomBytes(31).toString("hex")) % P;
  const blinding = BigInt("0x" + crypto.randomBytes(31).toString("hex")) % P;
  const userWsol = new PublicKey(s.userWsol);
  const [r0, r1] = pubParts(userWsol);
  const [m0, m1] = pubParts(WSOL_MINT);
  const attackCommitment = mimcSponge([BigInt(ATTACK_AMOUNT), r0, r1, m0, m1, blinding, secret]);
  const idx = s.nextLeaf ?? 0;
  patchState({ attackSecret: secret.toString(), attackBlinding: blinding.toString(),
    attackCommitment: attackCommitment.toString(),
    leafIndex: idx, nextLeaf: idx + 1,
    deposits: [...(s.deposits || []), { index: idx, commitment: attackCommitment.toString() }] });
  const note = Buffer.from(crypto.randomBytes(64));
  const args = Buffer.concat([
    u64le(DEPOSIT_LAMPORTS),
    be32(attackCommitment),
    (() => { const l = Buffer.alloc(4); l.writeUInt32LE(note.length); return Buffer.concat([l, note]); })(),
    crypto.randomBytes(32),
    Buffer.from([0]),
  ]);
  const sig = await send([
    ix("deposit_wsol_and_whisper", [
      { pubkey: VAULT, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: userWsol, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(s.vaultWsol), isSigner: false, isWritable: true },
      { pubkey: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), isSigner: false, isWritable: false },
    ], args),
  ]);
  log("attack deposit tx (paid 0.05 SOL, committed as 0.1):", sig);
}

if (stage === "matrix") {
  // Brute-force remaining byte conventions against deployed verifier.
  const combos = [];
  for (const A of ["raw", "yneg", "xneg"]) for (const SW of ["0","1"]) for (const LE of ["0","1"]) {
    combos.push({A, SW, LE});
  }
  const s0 = loadState();
  // prove once for attack note at 2x
  process.argv[3] = "attack";
  const amountLamports = DEPOSIT_LAMPORTS * 2n;
  const { proof: prf } = await proveForAmount(amountLamports);
  const nullifier = mimcSponge([BigInt(s0.attackSecret)]);
  const userWsol = new PublicKey(s0.userWsol);
  const vaultWsol = new PublicKey(s0.vaultWsol);
  const [r0v, r1v] = pubParts(userWsol);
  const [m0v, m1v] = pubParts(WSOL_MINT);
  const keys = [
    { pubkey: VAULT, isSigner: false, isWritable: true },
    { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
    { pubkey: vaultWsol, isSigner: false, isWritable: true },
    { pubkey: userWsol, isSigner: false, isWritable: true },
    { pubkey: payer.publicKey, isSigner: true, isWritable: false },
    { pubkey: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), isSigner: false, isWritable: false },
    { pubkey: new PublicKey(s0.pagePda), isSigner: false, isWritable: true },
  ];
  for (const c of combos) {
    process.env.OX_A = c.A; process.env.OX_B_SWAP = c.SW; process.env.OX_LE = c.LE;
    const { proofA, proofB, proofC } = (() => {
      const Pmod2 = P;
      const be = (dec) => Buffer.from(BigInt(dec).toString(16).padStart(64, "0"), "hex");
      const le = (dec) => { const b2 = Buffer.alloc(32); let v = BigInt(dec); for (let i2 = 0; i2 < 32; i2++) { b2[i2] = Number(v & 0xffn); v >>= 8n; } return b2; };
      const f = c.LE === "1" ? le : be;
      const flip = c.A;
      const ax = flip === "x" ? (Pmod2 - BigInt(prf.pi_a[0])) % Pmod2 : BigInt(prf.pi_a[0]);
      const ay = flip === "y" ? (Pmod2 - BigInt(prf.pi_a[1])) % Pmod2 : BigInt(prf.pi_a[1]);
      const swapH = c.SW === "1";
      const rr0 = swapH ? [prf.pi_b[0][1], prf.pi_b[0][0]] : [prf.pi_b[0][0], prf.pi_b[0][1]];
      const rr1 = swapH ? [prf.pi_b[1][1], prf.pi_b[1][0]] : [prf.pi_b[1][0], prf.pi_b[1][1]];
      return {
        proofA: Buffer.concat([f(ax), f(ay)]),
        proofB: Buffer.concat([f(rr0[0]), f(rr0[1]), f(rr1[0]), f(rr1[1])]),
        proofC: Buffer.concat([f(prf.pi_c[0]), f(prf.pi_c[1])]),
      };
    })();
    // build pubInputs properly
    const pubsArr = JSON.parse(fs.readFileSync(path.join(ART, `public_amt${amountLamports}-atk.json`), "utf8")).map(BigInt);
    const args2 = Buffer.concat([
      u64le(amountLamports),
      be32(nullifier), be32(BigInt(s0.root)),
      proofA, proofB, proofC,
      pubsArr.map(x => be32(x)).reduce((a2, b2) => Buffer.concat([a2, b2])),
    ]);
    try {
      const sig = await send([ix("prepare_phantom_withdraw_v2", keys, args2)]);
      console.log(`SUCCESS combo ${JSON.stringify(c)} tx=${sig}`);
      process.exit(0);
    } catch (e) {
      const msg = String(e);
      const code = msg.match(/Error Number: (\d+)/)?.[1];
      console.log(`combo ${JSON.stringify(c)} -> ${code ?? msg.split("\n")[0].slice(0,60)}`);
    }
  }
}

if (stage === "overclaim") {
  if (!loadState().useAttackNote) {
    // mark attack note usage for the withdraw path
  }
  const res = await withdrawAttempt(DEPOSIT_LAMPORTS * 2n, true);
  if (res.ok) throw new Error("SECURITY FAILURE: over-claim went through!");
  if (!res.error.includes("6012") && !res.error.toLowerCase().includes("exceeds what was deposited"))
    throw new Error("rejected but not by the solvency guard: " + res.error);
  log("✔ solvency guard rejected the over-claim on-chain (InsufficientCommittedDeposit)");
}

else if (stage === "withdraw") {
  const before = (await conn.getTokenAccountBalance(new PublicKey(loadState().userWsol))).value.amount;
  const res = await withdrawAttempt(DEPOSIT_LAMPORTS, false);
  if (!res.ok) throw new Error("honest withdraw failed: " + res.error);
  const after = (await conn.getTokenAccountBalance(new PublicKey(loadState().userWsol))).value.amount;
  log(`✔ paid out: ${before} → ${after} (delta ${BigInt(after) - BigInt(before)})`);
}
