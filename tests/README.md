# 🧪 Dark Null Protocol - Tests

## Test Strategy

Dark Null Protocol uses a **multi-layer testing approach**:

### Public Tests (This Directory)

| Test | Description | Status |
|------|-------------|--------|
| `examples/shield.ts` | Shield funds example | ✅ Available |
| `examples/unshield.ts` | Unshield funds example | ✅ Available |
| `examples/balance.ts` | Check shielded balance | ✅ Available |

### Private Tests (Internal)

Core protocol tests run in our private CI environment:

- ✅ ZK circuit constraint verification
- ✅ Groth16 proof generation/verification
- ✅ Merkle tree operations
- ✅ Nullifier double-spend prevention
- ✅ Maturity delay enforcement
- ✅ Fuzzing & edge cases

> **Why private?** Our test suite contains proprietary verification logic. 
> Public examples demonstrate the SDK interface without exposing internals.

---

## Run Public Examples

```bash
# Install dependencies
npm install @solana/web3.js @coral-xyz/anchor

# Run shield example
npx ts-node examples/shield.ts

# Run unshield example  
npx ts-node examples/unshield.ts
```

---

## Live Test Results

See [LIVE_TEST_RESULTS.md](../LIVE_TEST_RESULTS.md) for real devnet transactions:

| TX | Signature | Explorer |
|----|-----------|----------|
| Shield | `2r6KfAtCGWyj...` | [View](https://explorer.solana.com/tx/2r6KfAtCGWyjyY2zQwzRVokdKgUcDcdrZULxtKJjMVHLh1cX9p3hznAgKeewXNaf3x75uqggM7C5EPr3Cry5y5ay?cluster=devnet) |
| Update Root | `JEu866e7A3Np...` | [View](https://explorer.solana.com/tx/JEu866e7A3NpTPEGFe5YiyG4ZZKBZC1Q9mDUAMi7hTwDDNNCShbUhzLBPPoEPtkkUCbU39xzs3vuvcyZpgx1ppw?cluster=devnet) |

---

## CI/CD

GitHub Actions automatically:
- ✅ Lint documentation
- ✅ Check markdown links
- ✅ Verify relayer health
- ✅ Confirm program deployment

Full integration tests run in private infrastructure before each release.

---

*© 2026 Parad0x Labs*

