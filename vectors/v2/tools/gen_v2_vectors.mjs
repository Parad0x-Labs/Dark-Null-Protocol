// Dark NULL v2: generate V-DS (final), V-ADDR, V-EXTDATA, V-VOUCHER and V-E2E (sandbox only).
// Usage: node gen_v2_vectors.mjs <vectors_dir> <circuit_input_dir>
// Normative source: docs/spec/V2_SPEC.md. Every value here is re-derived independently by
// crates/dark-null-transcript (tests/vectors.rs) and, for Poseidon, by sol_poseidon on devnet.
import fs from "node:fs";
import path from "node:path";
import {
  R, BJJ_L, ED_L, hex, be32, fromBE, le32, u64le, u16le, bhex, ascii, h248, pubkeyFields, signedAmountFr, sha256, H, CALLS,
  DS, DS_NAMES, BYTE_TAGS, KDF_INFO, drbg, drbgFr, bjjPub, bjjPack, bjjSign, hkdf, deriveAccount, stealthKeys, stealthDerive,
  stealthRecover, edMulBase, findPda, b58enc, b58dec, discriminator, Tree, ZEROS, DEPTH, leScalar32, STEALTH_TAG_VIEW, STEALTH_TAG_SHARED,
} from "./lib.mjs";

const outDir = process.argv[2] || "vectors";
const inDir = process.argv[3] || "circuit_inputs";
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(inDir, { recursive: true });
const STATUS = "final (docs/spec/V2_SPEC.md)";
const SOURCE = "vectors/v2/tools/gen_v2_vectors.mjs (circomlibjs 0.1.7, node:crypto, @noble/curves 1.9.7, @scure/base 1.2.6)";
const write = (name, obj) => fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify({ id: name, status: STATUS, source: SOURCE, ...obj }, null, 1) + "\n");
const str = (o) => JSON.parse(JSON.stringify(o, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
const pk58 = (b) => b58enc(b);

// ---------------- fixed program constants ----------------
const TOKEN_PROGRAM = b58dec("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = b58dec("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSTEM_PROGRAM = Buffer.alloc(32);
const MINT = b58dec("So11111111111111111111111111111111111111112");
const PROGRAM_ID = sha256(ascii("dark-null-v2-vector-program-id")); // fixture program id (never deployed)
const POOL_NONCE = sha256(ascii("dark-null-v2-vector-pool-nonce"));
const ata = (owner) => findPda([owner, TOKEN_PROGRAM, MINT], ATA_PROGRAM).address;

// ---------------- V-DS (final registry) ----------------
write("V-DS", {
  rule: "DS_x = big-endian integer of the ASCII tag (all tags are < 31 bytes, so 2^64 < DS_x < r)",
  tags: Object.fromEntries(Object.entries(DS_NAMES).map(([k, v]) => [k, { ascii: v, value: hex(DS[k]) }])),
  byte_tags: BYTE_TAGS,
  kdf: { hash: "HKDF-SHA256 (RFC 5869)", salt: BYTE_TAGS.KDF_SALT, info: KDF_INFO },
});

// ---------------- pool ----------------
const poolConfig = findPda([ascii("dark-null-pool"), POOL_NONCE], PROGRAM_ID);
const poolId = sha256(ascii(BYTE_TAGS.POOL_ID), PROGRAM_ID, poolConfig.address);
const poolIdFr = h248(poolId);
const treePda = findPda([ascii("dark-null-tree"), poolConfig.address], PROGRAM_ID);
const mintState = findPda([ascii("dark-null-mint"), poolConfig.address, MINT], PROGRAM_ID);
const vault = findPda([ascii("dark-null-vault"), poolConfig.address, MINT], PROGRAM_ID);
const vaultAuth = findPda([ascii("dark-null-vault-auth"), poolConfig.address], PROGRAM_ID);
const asset = H([DS.DS_ASSET, ...pubkeyFields(MINT)], "asset");
const pdaJson = (p) => ({ address: pk58(p.address), bump: p.bump });

// ---------------- V-ADDR ----------------
const seedA = sha256(ascii("dark-null-v2-vector-seed-alice"));
const seedB = sha256(ascii("dark-null-v2-vector-seed-bob"));
const alice = deriveAccount(seedA, 0, 0);
const bob = deriveAccount(seedB, 0, 0);
const bobD1 = deriveAccount(seedB, 0, 1);
const acctJson = (k, seed) => ({
  seed: bhex(seed), account_index: k.account, diversifier: k.diversifier,
  ask: hex(k.ask), ask_nonce_key: bhex(k.askNonceKey), ak: k.ak.map(hex), ak_packed: bhex(bjjPack(k.ak)),
  nk_seed: hex(k.nkSeed), nk: hex(k.nk), pk: hex(k.pk),
  ivk_root: bhex(k.ivkRoot), ivk_d: bhex(k.ivkD), ivk_pub_d: bhex(k.ivkPub), ovk: bhex(k.ovk), stealth_spend_seed: bhex(k.stealthSeed),
  address_payload: bhex(k.payload), address: k.address,
});
const bobStealth = stealthKeys(bob.stealthSeed);
const ephemSeed = drbg("stealth-ephemeral-seed");
const sd = stealthDerive(bobStealth.S, bobStealth.V, ephemSeed);
const p = stealthRecover(bobStealth.s, sd.shared);
if (!edMulBase(p).equals(sd.P)) throw new Error("stealth p*B != P");
const stealthAta = ata(sd.P);
write("V-ADDR", {
  formulas: {
    ask: "OS2IP(HKDF(seed, info=ASK || LE32(account), 64)) mod l_bjj",
    ak: "ask * B8 (BabyJubJub)",
    nk: "Poseidon(DS_NK, OS2IP(HKDF(seed, info=NK || LE32(account), 64)) mod r)",
    pk: "Poseidon(DS_PK, ak.x, ak.y, nk)",
    ivk_d: "HKDF(ikm=ivk_root, info=IVK_D || LE32(d), 32); ivk_pub_d = X25519(ivk_d, 9)",
    address: "bech32m('dnull', 0x01 || BE32(pk) || ivk_pub_d || LE32(d)), no 90-char limit",
    stealth: "DNA x402 dark-stealth-ed25519 scheme: s = LE(spend_seed) mod L; v = LE(SHA512(TAG_VIEW || LE32(s))) mod L; R = r*B; shared = LE(SHA512(TAG_SHARED || r*V)) mod L; P = S + shared*B; p = s + shared mod L",
  },
  constants: { l_bjj: hex(BJJ_L), l_ed25519: hex(ED_L), stealth_tag_view: STEALTH_TAG_VIEW, stealth_tag_shared: STEALTH_TAG_SHARED },
  accounts: { alice: acctJson(alice, seedA), bob: acctJson(bob, seedB), bob_d1: acctJson(bobD1, seedB) },
  stealth: {
    owner: "bob", spend_seed: bhex(bob.stealthSeed), s: hex(bobStealth.s), v: hex(bobStealth.v),
    meta_address: { spend_pub: bhex(bobStealth.S), view_pub: bhex(bobStealth.V), bytes: bhex(Buffer.concat([bobStealth.S, bobStealth.V])) },
    ephemeral_seed: bhex(ephemSeed), r: hex(sd.r), R: bhex(sd.R), shared: hex(sd.shared),
    P: bhex(sd.P), P_base58: pk58(sd.P), p: hex(p), p_le: bhex(leScalar32(p)),
    mint: pk58(MINT), ata_P: pk58(stealthAta),
  },
});

// ---------------- V-EXTDATA ----------------
function quoteBinding(q) {
  const lp = (s) => { const b = Buffer.from(s, "utf8"); if (b.length > 65535) throw new Error("lp"); return Buffer.concat([u16le(b.length), b]); };
  const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
  const expires = BigInt(Math.floor(Date.parse(q.expiresAt) / 1000));
  return sha256(ascii(BYTE_TAGS.QUOTE), lp(q.quoteId), sha256(Buffer.from(q.resource, "utf8")), u64le(q.amountAtomic), u64le(q.totalAtomic), b58dec(q.mint), lp(q.payTo), i64(expires));
}
const EXT_LEN = 649;
function encodeExt(e) {
  const b = Buffer.concat([Buffer.from([0x01]), e.pool_id, e.public_token_account, e.relayer_fee_account, u64le(e.relayer_fee), e.memo_binding, e.stealth_ephemeral, e.ciphertext0, e.ciphertext1, e.ciphertext_rec]);
  if (b.length !== EXT_LEN) throw new Error("ext_data length " + b.length);
  return b;
}
const extHash = (bytes) => h248(sha256(ascii(BYTE_TAGS.EXTDATA), bytes));
const randomPoint = (label) => edMulBase(fromBE(drbg(label, 64)) % ED_L); // unused stealth_ephemeral: a fresh valid point
const extJson = (e, bytes) => ({
  fields: { version: 1, pool_id: bhex(e.pool_id), public_token_account: pk58(e.public_token_account), relayer_fee_account: pk58(e.relayer_fee_account), relayer_fee: e.relayer_fee.toString(), memo_binding: bhex(e.memo_binding), stealth_ephemeral: bhex(e.stealth_ephemeral), ciphertext0: bhex(e.ciphertext0), ciphertext1: bhex(e.ciphertext1), ciphertext_rec: bhex(e.ciphertext_rec) },
  bytes: bhex(bytes), length: bytes.length, ext_data_hash: hex(extHash(bytes)),
});
const quote = { quoteId: "q_7f3a9c2e", resource: "https://api.example.test/v1/forecast?city=vilnius", amountAtomic: 600n, totalAtomic: 600n, mint: pk58(MINT), payTo: bob.address, expiresAt: "2026-10-06T12:00:00Z" };
const qb = quoteBinding(quote);
const relayerFeeAcct = b58dec("4P8DKU85xi1vZzscZTnCtnaUXpYwwvyxQfS7wvMwt34m"); // fixture pubkey (no key material)
const extExample = {
  pool_id: poolId, public_token_account: vault.address, relayer_fee_account: relayerFeeAcct, relayer_fee: 5n, memo_binding: qb,
  stealth_ephemeral: randomPoint("extdata-example-ephemeral"), ciphertext0: drbg("extdata-example-ct0", 160), ciphertext1: drbg("extdata-example-ct1", 160), ciphertext_rec: drbg("extdata-example-ctrec", 160),
};
const extBytes = encodeExt(extExample);
const LAYOUT = [["version", 0, 1], ["pool_id", 1, 32], ["public_token_account", 33, 32], ["relayer_fee_account", 65, 32], ["relayer_fee", 97, 8], ["memo_binding", 105, 32], ["stealth_ephemeral", 137, 32], ["ciphertext0", 169, 160], ["ciphertext1", 329, 160], ["ciphertext_rec", 489, 160]];
const mutations = LAYOUT.map(([name, off, len]) => { const m = Buffer.from(extBytes); m[off + len - 1] ^= 0x01; return { field: name, flipped_offset: off + len - 1, ext_data_hash: hex(extHash(m)) }; });
write("V-EXTDATA", {
  formulas: {
    pool_config: "PDA(['dark-null-pool', pool_nonce], program_id)",
    pool_id: "SHA256('dark-null-pool-id-v1' || program_id || pool_config)  (32 bytes; Fr form = first 31 bytes BE)",
    ext_data_hash: "first 31 bytes, big-endian, of SHA256('dark-null-extdata-v1' || ext_data[649])",
    quote_binding: "SHA256('dark-null-x402-quote-v1' || LP16(quoteId) || SHA256(resource) || LE64(amountAtomic) || LE64(totalAtomic) || mint[32] || LP16(payTo) || LE64i(expiresAt unix seconds))",
  },
  layout: LAYOUT.map(([name, offset, length]) => ({ name, offset, length })),
  pool: { program_id: pk58(PROGRAM_ID), pool_nonce: bhex(POOL_NONCE), pool_config: pdaJson(poolConfig), pool_id: bhex(poolId), pool_id_fr: hex(poolIdFr), vault: pdaJson(vault) },
  quote: { ...str(quote), expires_at_unix: Math.floor(Date.parse(quote.expiresAt) / 1000), quote_binding: bhex(qb) },
  example: extJson(extExample, extBytes),
  mutations,
});

// ---------------- V-VOUCHER ----------------
const chanNonce = drbg("chan-nonce");
const bjjSession = fromBE(hkdf(seedA, Buffer.concat([ascii(KDF_INFO.CHAN), chanNonce]), 64)) % BJJ_L;
const bjjNonceKey = hkdf(seedA, Buffer.concat([ascii(KDF_INFO.CHAN_NONCE), chanNonce]), 32);
const bjjSessionPub = bjjPub(bjjSession);
const chanSecret = drbgFr("chan-secret");
const nkCh = H([DS.DS_NK_CH, chanSecret], "nk_ch");
const expiryEpoch = 490_024n;
const ownerCh = H([DS.DS_CHAN, bob.pk, alice.pk, bjjSessionPub[0], bjjSessionPub[1], expiryEpoch, nkCh], "owner_ch");
const chanLabel = H([DS.DS_LABEL, poolIdFr, 7n], "label");
const chanSalt = drbgFr("chan-note-salt");
const chanCap = 1000n;
const chanId = H([DS.DS_NOTE, chanCap, asset, ownerCh, chanSalt, chanLabel], "cm");
let head = Buffer.alloc(32);
let cumulative = 0n;
const vouchers = [];
for (const [k, amount] of [[1, 10n], [2, 25n], [3, 40n]]) {
  cumulative += amount;
  const msg = H([DS.DS_VOUCHER, chanId, cumulative, h248(head)], "voucher");
  const sig = bjjSign(bjjSession, bjjNonceKey, msg);
  const dnaReceiptHash = sha256(ascii(`dark-null-v2-vector-dna-receipt-${k}`));
  const nextHead = sha256(ascii(BYTE_TAGS.RCPT_CHAIN), head, be32(msg), dnaReceiptHash);
  const wire = Buffer.concat([be32(chanId), u64le(cumulative), head, sig.packed]);
  vouchers.push({ k, amount: amount.toString(), cumulative: cumulative.toString(), receipt_head_prev: bhex(head), voucher_msg: hex(msg), sig: { R8: sig.R8.map(hex), S: hex(sig.S), hm: hex(sig.hm), packed: bhex(sig.packed) }, wire: bhex(wire), wire_length: wire.length, dna_receipt_hash: bhex(dnaReceiptHash), receipt_head: bhex(nextHead) });
  head = nextHead;
}
const anchorSalt = drbgFr("rcpt-anchor-salt");
const anchor = H([DS.DS_RCPT, h248(head), anchorSalt], "rcpt");
write("V-VOUCHER", {
  scope: "Phase 3 (dark-null-batch). Fixed now so that Phase 1 note and owner encodings stay compatible.",
  formulas: {
    bjj_session: "OS2IP(HKDF(seed, info=CHAN || chan_nonce, 64)) mod l_bjj",
    nk_ch: "Poseidon(DS_NK_CH, chan_secret)",
    owner_ch: "Poseidon(DS_CHAN, merchant_owner, refund_owner, bjj_pub.x, bjj_pub.y, expiry_epoch, nk_ch)",
    chan_id: "cm of the channel note = Poseidon(DS_NOTE, cap, asset, owner_ch, salt, label)",
    voucher_msg: "Poseidon(DS_VOUCHER, chan_id, cumulative, h248(receipt_head_prev))",
    signature: "EdDSA-Poseidon over BabyJubJub (spec 4.4); packed = packPoint(R8) || LE32(S)",
    voucher_wire: "BE32(chan_id) || LE64(cumulative) || receipt_head_prev[32] || packed_sig[64]  (136 bytes)",
    receipt_head: "SHA256('dark-null-rcpt-chain-v1' || receipt_head_prev || BE32(voucher_msg) || dna_receipt_hash); receipt_head_0 = 32 zero bytes",
    epoch_anchor: "memo_binding = BE32(Poseidon(DS_RCPT, h248(receipt_head_N), salt))",
  },
  channel: {
    payer: "alice", merchant: "bob", chan_nonce: bhex(chanNonce), bjj_session: hex(bjjSession), bjj_nonce_key: bhex(bjjNonceKey), bjj_session_pub: bjjSessionPub.map(hex), bjj_session_pub_packed: bhex(bjjPack(bjjSessionPub)),
    chan_secret: hex(chanSecret), nk_ch: hex(nkCh), merchant_owner: hex(bob.pk), refund_owner: hex(alice.pk), expiry_epoch: expiryEpoch.toString(), owner_ch: hex(ownerCh),
    cap: chanCap.toString(), asset: hex(asset), salt: hex(chanSalt), label: hex(chanLabel), label_counter: "7", chan_id: hex(chanId),
  },
  vouchers,
  epoch_anchor: { receipt_head_final: bhex(head), salt: hex(anchorSalt), memo_binding: hex(anchor) },
});

// ---------------- V-E2E: deposit -> private transfer -> relayed withdraw to a stealth address ----------------
const tree = new Tree();
const CLAIMED_EPOCH = 490_000n;
const supply = { v: 0n };
let depositCounter = 0n;
const relayerKey = b58dec("7DwfRAymZjJsdnKFUpPsU2c6g7Y9aserV1AHnXWwvTxs"); // fixture relayer pubkey (no key material)
const aliceTokenAcct = ata(b58dec("Br4GAsVBr1sRsPwXHXtsiXrQNxnaS6Mnpb5eFaznNp17")); // fixture depositor wallet ATA
const aliceWallet = b58dec("Br4GAsVBr1sRsPwXHXtsiXrQNxnaS6Mnpb5eFaznNp17");
const DISC = discriminator("transact");

function note(value, owner, label, saltLabel) { const salt = drbgFr(saltLabel); return { value, owner, salt, label, cm: H([DS.DS_NOTE, value, asset, owner, salt, label], "cm") }; }

function step({ name, spender, inputs, outputs, deposit = 0n, withdraw = 0n, relayerFee = 0n, publicTokenAccount, relayerFeeAccount, memo, stealthEphemeral, submitter }) {
  const isDeposit = deposit > 0n;
  const depositLabel = isDeposit ? H([DS.DS_LABEL, poolIdFr, depositCounter], "label") : 0n;
  const root = tree.root();
  const rootHint = (tree.roots.length - 1) % 256;
  const ins = inputs.map((inp) => {
    const cm = H([DS.DS_NOTE, inp.value, asset, spender.pk, inp.salt, inp.label], "cm");
    const path = inp.value !== 0n ? tree.path(inp.leafIndex) : { siblings: Array(DEPTH).fill(0n), root: 0n };
    if (inp.value !== 0n && path.root !== root) throw new Error("membership root mismatch");
    const nf = H([DS.DS_NF, spender.nk, cm, BigInt(inp.leafIndex)], "nf");
    return { ...inp, cm, nf, siblings: path.siblings };
  });
  const outs = outputs.map((o) => note(o.value, o.owner, isDeposit ? depositLabel : o.label, o.saltLabel));
  const publicAmount = signedAmountFr(deposit, withdraw);
  const publicAsset = publicAmount === 0n ? 0n : asset;
  // conservation (mod r) and 64-bit ranges
  const lhs = (ins[0].value + ins[1].value + publicAmount) % R;
  const rhs = (outs[0].value + outs[1].value) % R;
  if (lhs !== rhs) throw new Error(`${name}: conservation`);
  const ext = { pool_id: poolId, public_token_account: publicTokenAccount, relayer_fee_account: relayerFeeAccount, relayer_fee: relayerFee, memo_binding: memo, stealth_ephemeral: stealthEphemeral, ciphertext0: drbg(`${name}-ct0`, 160), ciphertext1: drbg(`${name}-ct1`, 160), ciphertext_rec: drbg(`${name}-ctrec`, 160) };
  const extBytesStep = encodeExt(ext);
  const edh = extHash(extBytesStep);
  const sighash = H([DS.DS_SIGHASH, ins[0].nf, ins[1].nf, outs[0].cm, outs[1].cm, publicAmount, publicAsset, edh, CLAIMED_EPOCH], "sighash");
  const sig = bjjSign(spender.ask, spender.askNonceKey, sighash);
  const assocRoot = 0n;
  const pi = H([DS.DS_PI, root, ins[0].nf, ins[1].nf, outs[0].cm, outs[1].cm, publicAmount, publicAsset, edh, CLAIMED_EPOCH, depositLabel, assocRoot], "pi");
  const proofZero = Buffer.alloc(256);
  const ixData = Buffer.concat([DISC, proofZero, be32(root), be32(ins[0].nf), be32(ins[1].nf), be32(outs[0].cm), be32(outs[1].cm), u64le(deposit), u64le(withdraw), u64le(CLAIMED_EPOCH), be32(assocRoot), u16le(rootHint), extBytesStep]);
  if (ixData.length !== 1131) throw new Error("ix length " + ixData.length);
  const nfPda = ins.map((x) => findPda([ascii("dark-null-nf"), poolConfig.address, be32(x.nf)], PROGRAM_ID));
  const ins_ = tree.insertPair(outs[0].cm, outs[1].cm);
  if (isDeposit) { depositCounter += 1n; supply.v += deposit; } else { if (supply.v < withdraw) throw new Error("supply"); supply.v -= withdraw; }
  const accounts = [
    ["submitter", submitter, true, true], ["pool_config", poolConfig.address, false, true], ["tree", treePda.address, false, true],
    ["vault", vault.address, false, true], ["mint", MINT, false, false], ["public_token_account", publicTokenAccount, false, true],
    ["relayer_fee_account", relayerFeeAccount, false, true], ["nf_pda0", nfPda[0].address, false, true], ["nf_pda1", nfPda[1].address, false, true],
    ["vault_authority", vaultAuth.address, false, false], ["mint_state", mintState.address, false, true], ["token_program", TOKEN_PROGRAM, false, false], ["system_program", SYSTEM_PROGRAM, false, false],
  ].map(([n, k, s, w]) => ({ name: n, pubkey: pk58(k), signer: s, writable: w }));
  const circuitInput = {
    root, public_amount: publicAmount, public_asset: publicAsset, ext_data_hash: edh, now_epoch: CLAIMED_EPOCH, deposit_label: depositLabel, assoc_root: assocRoot,
    asset, ak: spender.ak, nk: spender.nk, sig_R8: sig.R8, sig_S: sig.S,
    in_value: ins.map((x) => x.value), in_salt: ins.map((x) => x.salt), in_label: ins.map((x) => x.label), in_leaf_index: ins.map((x) => BigInt(x.leafIndex)), in_path: ins.map((x) => x.siblings),
    out_value: outs.map((x) => x.value), out_owner: outs.map((x) => x.owner), out_salt: outs.map((x) => x.salt), out_label: outs.map((x) => x.label),
  };
  fs.writeFileSync(path.join(inDir, `e2e_${name}.input.json`), JSON.stringify(str(circuitInput)));
  return {
    out: {
      name, spender: spender === alice ? "alice" : "bob",
      private: {
        inputs: ins.map((x) => ({ value: x.value.toString(), salt: hex(x.salt), label: hex(x.label), leaf_index: x.leafIndex, dummy: x.value === 0n, cm: hex(x.cm), path: x.siblings.map(hex) })),
        outputs: outs.map((x) => ({ value: x.value.toString(), owner: hex(x.owner), salt: hex(x.salt), label: hex(x.label) })),
        sighash: hex(sighash), sig: { R8: sig.R8.map(hex), S: hex(sig.S), packed: bhex(sig.packed) },
      },
      public: {
        root: hex(root), root_hint: rootHint, nf: ins.map((x) => hex(x.nf)), cm: outs.map((x) => hex(x.cm)),
        deposit_amount: deposit.toString(), withdraw_amount: withdraw.toString(), public_amount: hex(publicAmount), public_asset: hex(publicAsset),
        ext_data_hash: hex(edh), claimed_epoch: CLAIMED_EPOCH.toString(), deposit_label: hex(depositLabel), assoc_root: hex(assocRoot), pi: hex(pi),
      },
      ext_data: extJson(ext, extBytesStep),
      instruction: { discriminator: bhex(DISC), data_with_zero_proof: bhex(ixData), length: ixData.length, proof_note: "bytes 8..264 carry the Groth16 proof (not deterministic); zero here", accounts },
      nullifier_pdas: nfPda.map(pdaJson),
      after: { leaf_indices: [ins_.leafIndex, ins_.leafIndex + 1], new_root: hex(ins_.root), new_root_hint: ins_.rootHint, next_index: tree.next, deposit_counter: depositCounter.toString(), supply: supply.v.toString(), relayer_receives: relayerFee.toString(), public_account_receives: (withdraw - relayerFee).toString() },
    },
    outs, leafStart: ins_.leafIndex,
  };
}

const unusedMemo = (l) => drbg(l);
// step 1: Alice deposits 1000 (dummy inputs; outputs carry the program-assigned deposit label)
const s1 = step({
  name: "deposit", spender: alice, submitter: aliceWallet,
  inputs: [{ value: 0n, salt: drbgFr("s1-dummy0"), label: 0n, leafIndex: 0 }, { value: 0n, salt: drbgFr("s1-dummy1"), label: 0n, leafIndex: 0 }],
  outputs: [{ value: 1000n, owner: alice.pk, saltLabel: "s1-out0" }, { value: 0n, owner: alice.pk, saltLabel: "s1-out1" }],
  deposit: 1000n, publicTokenAccount: aliceTokenAcct, relayerFeeAccount: vault.address, memo: unusedMemo("s1-memo"), stealthEphemeral: randomPoint("s1-eph"),
});
const L0 = s1.outs[0].label;
// step 2: Alice pays Bob 600 in-pool (x402 exact quote bound in memo_binding), relayer fee 5 (public withdraw of the fee only)
const s2 = step({
  name: "transfer", spender: alice, submitter: relayerKey,
  inputs: [{ value: 1000n, salt: s1.outs[0].salt, label: L0, leafIndex: s1.leafStart }, { value: 0n, salt: drbgFr("s2-dummy1"), label: L0, leafIndex: 0 }],
  outputs: [{ value: 600n, owner: bob.pk, label: L0, saltLabel: "s2-out0" }, { value: 395n, owner: alice.pk, label: L0, saltLabel: "s2-out1" }],
  withdraw: 5n, relayerFee: 5n, publicTokenAccount: vault.address, relayerFeeAccount: relayerFeeAcct, memo: qb, stealthEphemeral: randomPoint("s2-eph"),
});
// step 3: Bob withdraws 600 to a one-time stealth address (ATA of P), relayer fee 10
const s3 = step({
  name: "withdraw", spender: bob, submitter: relayerKey,
  inputs: [{ value: 600n, salt: s2.outs[0].salt, label: L0, leafIndex: s2.leafStart }, { value: 0n, salt: drbgFr("s3-dummy1"), label: L0, leafIndex: 0 }],
  outputs: [{ value: 0n, owner: bob.pk, label: L0, saltLabel: "s3-out0" }, { value: 0n, owner: bob.pk, label: L0, saltLabel: "s3-out1" }],
  withdraw: 600n, relayerFee: 10n, publicTokenAccount: stealthAta, relayerFeeAccount: relayerFeeAcct, memo: unusedMemo("s3-memo"), stealthEphemeral: sd.R,
});
write("V-E2E", {
  scenario: "Alice deposits 1000; Alice pays Bob 600 in-pool with relayer fee 5 (x402 quote bound); Bob withdraws 600 to a stealth ATA with relayer fee 10",
  pool: { program_id: pk58(PROGRAM_ID), pool_config: pdaJson(poolConfig), pool_id: bhex(poolId), pool_id_fr: hex(poolIdFr), tree: pdaJson(treePda), mint: pk58(MINT), mint_state: pdaJson(mintState), vault: pdaJson(vault), vault_authority: pdaJson(vaultAuth), asset: hex(asset), token_program: pk58(TOKEN_PROGRAM) },
  tree: { depth: DEPTH, zeros: ZEROS.map(hex), empty_root: hex(ZEROS[DEPTH]), root_history: 256 },
  keys: { alice: { pk: hex(alice.pk), nk: hex(alice.nk), ak: alice.ak.map(hex) }, bob: { pk: hex(bob.pk), nk: hex(bob.nk), ak: bob.ak.map(hex) }, source: "V-ADDR.accounts" },
  claimed_epoch: CLAIMED_EPOCH.toString(),
  steps: [s1.out, s2.out, s3.out],
  final: { next_index: tree.next, root: hex(tree.root()), roots: tree.roots.map(hex), supply: supply.v.toString(), deposit_counter: depositCounter.toString() },
});

// Poseidon call log (deduplicated) for the on-chain probe
const seen = new Set();
const calls = CALLS.filter((c) => { const k = c.inputs.join(",") + c.output; if (seen.has(k)) return false; seen.add(k); return true; });
fs.writeFileSync(path.join(inDir, "poseidon_calls.json"), JSON.stringify(calls));
console.log(JSON.stringify({ pool_id: bhex(poolId), roots: tree.roots.map(hex), pis: [s1, s2, s3].map((s) => s.out.public.pi), poseidon_calls: calls.length, by_label: calls.reduce((m, c) => ((m[c.label] = (m[c.label] || 0) + 1), m), {}) }, null, 1));
