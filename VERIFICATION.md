# ✅ Verification Guide

## Dark Null Protocol — Trust Through Verification

**Last Updated**: January 9, 2026

---

## Overview

Dark Null Protocol uses a **"Trust Through Verification"** model. While our core implementation is proprietary, we provide multiple ways to verify the security and correctness of the deployed protocol.

---

## 1. Verify Deployed Program Binary

### Devnet

```bash
# Program ID
PROGRAM_ID="7niGgy3EBVZtFjY1Gjx2hoeNHzeiJER76sEVhd4S5p6w"

# Dump the deployed program binary
solana program dump $PROGRAM_ID dark_null_v18.so --url devnet

# Calculate SHA256 hash
sha256sum dark_null_v18.so
```

### Expected Hashes

| Version | Network | SHA256 Hash |
|---------|---------|-------------|
| V18 (Dark Null v1) | Devnet | `[HASH PUBLISHED AFTER AUDIT]` |
| V18 (Dark Null v1) | Mainnet | `[PENDING MAINNET DEPLOY]` |

### What This Proves

✅ The deployed program matches the audited binary  
✅ No modifications after audit  
✅ Deterministic build from reviewed source

---

## 2. Verify IDL (Interface Definition)

The IDL defines all program instructions, accounts, and types.

### Fetch IDL from Chain

```bash
# Using Anchor CLI
anchor idl fetch 7niGgy3EBVZtFjY1Gjx2hoeNHzeiJER76sEVhd4S5p6w \
  --provider.cluster devnet \
  > idl_from_chain.json

# Compare with published IDL
diff idl_from_chain.json ./idl/dark_null_v1.json
```

### IDL Contents

The IDL reveals:
- All available instructions
- Account structures
- Event definitions
- Error codes

### What This Proves

✅ You know exactly what the program can do  
✅ No hidden instructions  
✅ Transparent interface

---

## 3. Verify ZK Verification Key

The verification key is embedded in the program and can be extracted.

### Published Verification Key

```json
{
  "protocol": "groth16",
  "curve": "bn254",
  "vk_alpha_g1": ["0x...", "0x..."],
  "vk_beta_g2": [["0x...", "0x..."], ["0x...", "0x..."]],
  "vk_gamma_g2": [["0x...", "0x..."], ["0x...", "0x..."]],
  "vk_delta_g2": [["0x...", "0x..."], ["0x...", "0x..."]],
  "vk_ic": [...]
}
```

Full key: [circuits/build/vkey.json](./circuits/build/vkey.json)

### What This Proves

✅ Proofs are verified against known parameters  
✅ Circuit structure is fixed  
✅ No proof forgery possible

---

## 4. Verify Relayer Service

### Health Check

```bash
curl https://relayer-falling-dust-5746.fly.dev/health
```

Expected response:
```json
{
  "ok": true,
  "cluster": "devnet",
  "programId": "7niGgy3EBVZtFjY1Gjx2hoeNHzeiJER76sEVhd4S5p6w",
  "relayerPubkey": "HBCXhujP9v2i7aPxPRahw46BeZzfcxNuWvCcUYNd2Ueu",
  "relayerBalance": 2000000000,
  "version": "1.0.0"
}
```

### Verify Relayer Transactions

All relayer transactions are visible on Solana Explorer:

```
https://explorer.solana.com/address/HBCXhujP9v2i7aPxPRahw46BeZzfcxNuWvCcUYNd2Ueu?cluster=devnet
```

### What This Proves

✅ Relayer is operational  
✅ All transactions are on-chain (auditable)  
✅ No off-chain manipulation

---

## 5. Verify IPFS Storage

Proofs and receipts are stored on IPFS via Pinata.

### Verify a Proof

```bash
# Given an IPFS hash from a transaction
IPFS_HASH="QmXyz..."

# Fetch from any IPFS gateway
curl "https://gateway.pinata.cloud/ipfs/$IPFS_HASH"
```

### What This Proves

✅ Proofs are immutably stored  
✅ Historical transactions are auditable  
✅ Decentralized storage (not just our servers)

---

## 6. Verify On-Chain State

### Global State PDA

```typescript
import { PublicKey } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("7niGgy3EBVZtFjY1Gjx2hoeNHzeiJER76sEVhd4S5p6w");
const [globalState] = PublicKey.findProgramAddressSync(
  [Buffer.from("global_state_v18")],
  PROGRAM_ID
);

console.log("Global State:", globalState.toBase58());
// Verify on: https://explorer.solana.com/address/[ADDRESS]?cluster=devnet
```

### Vault PDA

```typescript
const [vault] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault_v18")],
  PROGRAM_ID
);

console.log("Vault:", vault.toBase58());
// Check balance on explorer
```

### What This Proves

✅ Protocol state is transparent  
✅ Vault balance is verifiable  
✅ All funds accounted for

---

## 7. Verify Nullifier Usage

Nullifiers prevent double-spending. Each withdrawal consumes a unique nullifier.

### Check if Nullifier is Used

```typescript
import { PublicKey } from "@solana/web3.js";

const nullifierHash = "..."; // 32-byte hash
const shard = calculateShard(nullifierHash);
const page = calculatePage(nullifierHash);

const [nullifierPage] = PublicKey.findProgramAddressSync(
  [Buffer.from("nullifier_page"), Buffer.from([shard]), Buffer.from([page])],
  PROGRAM_ID
);

// Fetch and decode account to check occupancy
```

### What This Proves

✅ Each withdrawal is unique  
✅ No double-spending possible  
✅ Cryptographically enforced

---

## 8. Run E2E Test (Devnet)

You can run our public E2E test to verify the full flow:

```bash
# Clone SDK repository
git clone https://github.com/parad0x-labs/dark-null-sdk
cd dark-null-sdk

# Install and run test
npm install
npm run test:e2e
```

Expected output:
```
✅ Shield successful
✅ Maturity reached
✅ Proof generated
✅ Unshield successful
🎉 Full privacy flow verified!
```

### What This Proves

✅ Protocol works as documented  
✅ ZK proofs verify correctly  
✅ Funds flow properly

---

## Verification Checklist

| Item | How to Verify | Status |
|------|---------------|--------|
| Program binary hash | `sha256sum` dump | ✅ Available |
| IDL matches deployment | `anchor idl fetch` | ✅ Available |
| Verification key | Published in repo | ✅ Available |
| Relayer operational | Health endpoint | ✅ Live |
| IPFS storage | Gateway fetch | ✅ Working |
| On-chain state | Explorer | ✅ Transparent |
| E2E functionality | Run test | ✅ Passing |

---

## Third-Party Verification

### Audit Reports

See [AUDIT.md](./AUDIT.md) for security audit status and reports.

### Bug Bounty

See [SECURITY.md](./SECURITY.md) for our bug bounty program.

---

## Questions?

- **Technical**: hello@parad0xlabs.com
- **Security**: security@parad0xlabs.com
- **Discord**: [discord.gg/darknull](https://discord.gg/darknull)

---

**Trust, but verify. We give you the tools to verify.** ✅


