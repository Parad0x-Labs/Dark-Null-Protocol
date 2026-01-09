# ZK Conventions for Paradox V17

**CRITICAL**: These conventions are battle-tested and MUST be followed exactly.  
Breaking any of these will result in `ProofVerificationFailed`.

---

## ✅ Canonical Rules

### 1. Proof A Negation (CLIENT-SIDE)

**groth16-solana v0.2.0 expects proof_A to be negated by the caller.**

```typescript
// ✅ CORRECT - Use this EXACT function
const negFq = (y: bigint): bigint => {
  const yMod = mod(y, FQ);
  return yMod === 0n ? 0n : (FQ - yMod);  // (-y) mod Fq
};

const proofA_y_neg = negFq(BigInt(proof.pi_a[1]));
```

```typescript
// ❌ WRONG - Never use naive subtraction
const proofA_y_neg = FQ - proofA_y;  // BUG: if y==0, produces FQ (invalid!)
```

**Why?** The Groth16 pairing equation requires `e(-A, B)`. The library does NOT negate internally.

---

### 2. G2 Encoding Format

**G2 points use `[x.c1, x.c0, y.c1, y.c0]` format (imaginary component first).**

```typescript
// snarkjs format: [[X.c0, X.c1], [Y.c0, Y.c1]]
// groth16-solana expects: [X.c1, X.c0, Y.c1, Y.c0]

const proofB = Buffer.concat([
  bigIntToBytes32(BigInt(proof.pi_b[0][1])), // X.c1 (imag) ← FIRST
  bigIntToBytes32(BigInt(proof.pi_b[0][0])), // X.c0 (real)
  bigIntToBytes32(BigInt(proof.pi_b[1][1])), // Y.c1 (imag) ← FIRST
  bigIntToBytes32(BigInt(proof.pi_b[1][0])), // Y.c0 (real)
]);
```

| Byte Range | snarkjs Source | Component |
|------------|----------------|-----------|
| 0-31 | `[0][1]` | X imaginary |
| 32-63 | `[0][0]` | X real |
| 64-95 | `[1][1]` | Y imaginary |
| 96-127 | `[1][0]` | Y real |

Each limb is **32-byte big-endian**.

---

### 3. Public Inputs Format

**Public inputs are 32-byte big-endian scalars in Fr (scalar field).**

```typescript
// BN254 scalar field prime (Fr) - for public inputs
const FR = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

// Validate BEFORE sending
const assertFr = (name: string, x: bigint) => {
  if (x < 0n || x >= FR) {
    throw new Error(`Public input ${name} out of Fr range`);
  }
};
```

**Consistency requirement**: The same integer value must be used in:
- Circuit (snarkjs witness)
- Client encoding (bigIntToBytes32)
- On-chain reconstruction

---

### 4. Never Mix Conventions

**Pick ONE negation convention and stick with it.**

| Convention | proof_A | VK alpha/gamma/delta |
|------------|---------|---------------------|
| ✅ **Ours (working)** | NEGATED | NOT negated |
| ❌ Alternative | NOT negated | NEGATED |

**Never** use negated VK constants (`verifier_constants.rs`) together with negated proof_A. This double-negates and breaks verification.

---

## 🔢 Critical Constants

```typescript
// BN254 base field prime (Fq) - for G1/G2 point coordinates & negation
const FQ = BigInt("21888242871839275222246405745257275088696311157297823662689037894645226208583");

// BN254 scalar field prime (Fr) - for public inputs / circuit signals  
const FR = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
```

| Use Case | Field |
|----------|-------|
| G1 point negation | Fq |
| G2 point coordinates | Fq |
| Public input validation | Fr |
| Circuit signals | Fr |

---

## 🧪 Regression Tests

### Test 1: Native Verifier (Host Rust)

Create `programs/paradox/tests/native_verify.rs`:

```rust
use groth16_solana::groth16::Groth16Verifier;
use paradox::verifier::VERIFYINGKEY;

fn hex_to_array<const N: usize>(s: &str) -> [u8; N] {
    let mut arr = [0u8; N];
    for i in 0..N {
        arr[i] = u8::from_str_radix(&s[i*2..i*2+2], 16).unwrap();
    }
    arr
}

#[test]
fn native_verify_proof() {
    // Paste hex from TS test output
    let proof_a: [u8; 64] = hex_to_array("...");
    let proof_b: [u8; 128] = hex_to_array("...");
    let proof_c: [u8; 64] = hex_to_array("...");
    
    let inputs: [[u8; 32]; 7] = [
        hex_to_array("..."), // root
        hex_to_array("..."), // nullifier
        hex_to_array("..."), // amount
        hex_to_array("..."), // recipient
        hex_to_array("..."), // salt1
        hex_to_array("..."), // salt2
        hex_to_array("..."), // salt3
    ];

    let verifier = Groth16Verifier::new(
        &proof_a, &proof_b, &proof_c, &inputs, &VERIFYINGKEY
    ).expect("init failed");
    
    verifier.verify().expect("verification failed");
}
```

Run with: `cargo test native_verify_proof`

### Test 2: On-Chain E2E

Already exists: `tests/v17_full_e2e_test.ts`

Run with: `npx ts-node tests/v17_full_e2e_test.ts`

---

## 🔄 Circuit/VK Rotation Procedure

When you update the circuit or regenerate keys:

### Step 1: Regenerate VK Rust bytes
```bash
cd circuits
node ../scripts/export_vkey.js > ../programs/paradox/src/verifier_generated.rs
# Then copy VERIFYINGKEY into verifier.rs
```

### Step 2: Run native verify FIRST
```bash
cargo test native_verify_proof
```
This catches encoding mismatches without waiting for on-chain deployment.

### Step 3: Run on-chain E2E
```powershell
npx ts-node tests/v17_full_e2e_test.ts
```

**This 3-step process prevents multi-day "pairing check mystery" debugging sessions.**

---

## 🚨 Common Failure Modes

| Error | Cause | Fix |
|-------|-------|-----|
| `ProofVerificationFailed` | Wrong negation, G2 order, or input mismatch | Check all conventions above |
| `PublicInputGreaterThanFieldSize` | Input >= Fr | Validate with `assertFr()` |
| `Verifier initialization failed` | Malformed VK bytes | Regenerate VK with export_vkey.js |

---

## 📋 Quick Reference Card

```
┌─────────────────────────────────────────────────────────────┐
│  PARADOX V17 ZK QUICK REFERENCE                             │
├─────────────────────────────────────────────────────────────┤
│  proof_A:  [x, negFq(y)]           ← Y NEGATED              │
│  proof_B:  [x.c1, x.c0, y.c1, y.c0] ← SWAPPED              │
│  proof_C:  [x, y]                   ← NOT negated           │
│  VK:       NOT negated              ← Standard export       │
│  Inputs:   32-byte BE, < Fr         ← Validate range        │
│  Bytes:    Always big-endian        ← MSB first             │
├─────────────────────────────────────────────────────────────┤
│  FQ = 218882428718392752222464057452572750886963111572...83 │
│  FR = 218882428718392752222464057452572750885483644004...17 │
└─────────────────────────────────────────────────────────────┘
```

---

*Last updated: January 8, 2026*  
*Verified working with groth16-solana v0.2.0*

