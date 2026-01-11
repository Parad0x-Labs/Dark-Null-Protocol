# 🔐 Audit Reports

## Dark Null Protocol — Security Audits

**Last Updated**: January 9, 2026

---

## Audit Status

| Auditor | Scope | Status | Report |
|---------|-------|--------|--------|
| TBD | Full Protocol Audit | ⏳ Scheduled Q1 2026 | Pending |
| TBD | ZK Circuit Review | ⏳ Scheduled Q1 2026 | Pending |
| TBD | Infrastructure Audit | ⏳ Scheduled Q1 2026 | Pending |

---

## Planned Audit Scope

### 1. On-Chain Program

- [ ] Solana program logic (`paradox_v18`)
- [ ] Groth16 verifier implementation
- [ ] Nullifier management
- [ ] Merkle tree operations
- [ ] Access control (admin functions)
- [ ] Fund handling (vault security)

### 2. ZK Circuits

- [ ] Circom circuit correctness
- [ ] Constraint satisfaction
- [ ] Soundness verification
- [ ] Public input handling
- [ ] Trusted setup ceremony (if applicable)

### 3. Infrastructure

- [ ] Relayer security
- [ ] Intent signature verification
- [ ] API input validation
- [ ] Rate limiting effectiveness
- [ ] Secret management

---

## Completed Reviews

### Internal Security Review (January 2026)

**Conducted by**: Parad0x Labs Internal Team

**Findings Summary**:

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 0 | N/A |
| High | 0 | N/A |
| Medium | 2 | ✅ Fixed |
| Low | 5 | ✅ Fixed |
| Informational | 8 | ✅ Addressed |

**Key Areas Reviewed**:
- ZK proof encoding (G2 point ordering, Y-coordinate negation)
- Maturity delay enforcement
- Double-spend prevention
- Intent signature expiry

---

## Verification Without Full Source

We provide multiple ways to verify the security of Dark Null Protocol without requiring full source access:

### 1. Binary Verification

```bash
# Dump deployed program
solana program dump 7niGgy3EBVZtFjY1Gjx2hoeNHzeiJER76sEVhd4S5p6w dark_null.so --url devnet

# Compare hash to audited binary
sha256sum dark_null.so
```

**Expected Hash** (Devnet V18): `[TO BE PUBLISHED AFTER AUDIT]`

### 2. IDL Verification

The Interface Definition Language (IDL) is fully public:

```bash
# Fetch IDL from chain
anchor idl fetch 7niGgy3EBVZtFjY1Gjx2hoeNHzeiJER76sEVhd4S5p6w --provider.cluster devnet
```

### 3. Deterministic Builds

Auditors receive access to source code and can verify:
1. Source compiles to exact deployed binary
2. No hidden functionality
3. IDL matches implementation

---

## Audit Firm Requirements

We're seeking auditors with:

- [ ] Solana/Anchor expertise
- [ ] ZK-SNARK experience (Groth16, Circom)
- [ ] Previous privacy protocol audits
- [ ] Cryptographic background

**Interested auditors**: Contact security@parad0xlabs.com

---

## Post-Audit Process

1. **Receive Report** — Full findings from auditor
2. **Address Findings** — Fix all critical/high issues
3. **Re-Audit** — Verify fixes are correct
4. **Publish Report** — Make audit report public
5. **Update Hashes** — Publish new verified binary hashes
6. **Mainnet Deploy** — Only after clean audit

---

## Historical Versions

| Version | Network | Program ID | Audit Status |
|---------|---------|------------|--------------|
| V18 (Dark Null v1) | Devnet | `7niGgy3EBVZtFjY1Gjx2hoeNHzeiJER76sEVhd4S5p6w` | Internal review |
| V17 | Devnet | `Ajdw9GaNN39P9mj6uqiAxAnYRS4wC1rQh2C7wguvJArB` | Internal review |

---

## Contact

For audit-related inquiries:

- **Email**: security@parad0xlabs.com
- **Subject**: `[AUDIT] Your inquiry`

---

**We believe in trust through verification. Audit reports will be published here upon completion.**


