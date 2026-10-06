// S-TXV1 step 1: does devnet public RPC accept a SIMD-0385 Transaction V1? (System transfer 1 lamport to self)
// Usage: TEST_PAYER=<keypair path> node s_txv1_probe.mjs
import { loadKeypair, v1Message, legacyMessage, signTx, simulate, sendAndConfirm, blockhash, SYSTEM, explorer, rpc } from "./devnet_lib.mjs";
const payer = loadKeypair(process.env.TEST_PAYER);
const data = Buffer.alloc(12); data.writeUInt32LE(2, 0); data.writeBigUInt64LE(1n, 4);
const ix = { programId: SYSTEM, keys: [{ pubkey: payer.pub, isSigner: true, isWritable: true }, { pubkey: payer.pub, isSigner: false, isWritable: true }], data };
const out = { rpc: process.env.DEVNET_RPC || "https://api.devnet.solana.com", cluster_version: await rpc("getVersion"), cases: [] };
const bh = await blockhash();
for (const [name, cfg] of [["v1-empty-config", {}], ["v1-cu-limit-only", { computeUnitLimit: 2000 }], ["v1-cu+loaded-data", { computeUnitLimit: 2000, loadedAccountsDataSizeLimit: 65536 }]]) {
  const m = v1Message(payer.pub, [ix], bh, cfg);
  const { raw } = signTx(m, [payer]);
  const sim = await simulate(raw).catch((e) => ({ rpcError: e.message }));
  out.cases.push({ name, bytes: raw.length, simulate: { err: sim.err ?? null, rpcError: sim.rpcError, unitsConsumed: sim.unitsConsumed, logs: sim.logs } });
}
// send the first variant that simulated cleanly
const ok = out.cases.find((c) => !c.simulate.rpcError && c.simulate.err === null);
if (ok) {
  const cfg = ok.name === "v1-empty-config" ? {} : ok.name === "v1-cu-limit-only" ? { computeUnitLimit: 2000 } : { computeUnitLimit: 2000, loadedAccountsDataSizeLimit: 65536 };
  const m = v1Message(payer.pub, [ix], await blockhash(), cfg);
  const { raw, signature } = signTx(m, [payer]);
  const r = await sendAndConfirm(raw, signature);
  out.sent = { name: ok.name, signature, explorer: explorer(signature), bytes: raw.length, status: r.status.confirmationStatus, err: r.status.err, fee: r.tx?.meta?.fee, cu: r.tx?.meta?.computeUnitsConsumed, version: r.tx?.version, fetchError: r.tx?.fetchError };
}
// legacy control
const lm = legacyMessage(payer.pub, [ix], await blockhash());
const ls = signTx(lm, [payer]);
const lsim = await simulate(ls.raw);
out.legacy_control = { bytes: ls.raw.length, err: lsim.err, unitsConsumed: lsim.unitsConsumed };
console.log(JSON.stringify(out, null, 1));
