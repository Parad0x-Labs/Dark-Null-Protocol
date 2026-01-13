# 🛡️ Security Policy

## Dark Null Protocol — Security & Bug Bounty

**Effective Date**: January 9, 2026  
**Contact**: security@parad0xlabs.com

---

## Reporting Security Vulnerabilities

We take security seriously. If you discover a vulnerability, please report it responsibly.

### How to Report

1. **Email**: hello@parad0xlabs.com
2. **Subject**: `[SECURITY] Brief description`
3. **Encrypt**: Use our PGP key (below) for sensitive reports

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Any proof-of-concept code (if applicable)
- Your contact information for follow-up

### PGP Key

```
-----BEGIN PGP PUBLIC KEY BLOCK-----
[PGP KEY WILL BE ADDED]
-----END PGP PUBLIC KEY BLOCK-----
```

---

## Bug Bounty Program

**Status**: 🚧 Coming Soon (Post-Audit)

We will offer rewards for responsible disclosure after our security audit is complete.

### Planned Reward Tiers

| Severity | Description | Planned Reward |
|----------|-------------|----------------|
| **Critical** | Fund theft, protocol drain, ZK bypass | TBD |
| **High** | Double-spend, unauthorized access | TBD |
| **Medium** | DoS, griefing, minor issues | TBD |
| **Low** | Best practice violations | TBD |

*Rewards will be announced after mainnet launch.*

### Scope

#### In Scope ✅

| Component | Location |
|-----------|----------|
| Solana Program (V20) | `AeinEiBRodoCLJwdiXNd2fWXM49cByxhCsLW8DyRqCVe` |
| Relayer API | `https://api.parad0xlabs.com` |
| ZK Proof Verification | On-chain Groth16 verifier (BN254) |
| V20 Lazy Verification | CommitUnshieldV20, ChallengeCommitV20, FinalizeUnshieldV20 |
| Nullifier Management | Double-spend prevention via nullifier pages |

#### Out of Scope ❌

- Third-party services (Solana, Pinata, Fly.io)
- Social engineering attacks
- Physical attacks
- Denial of service via rate limiting (expected behavior)
- Issues in dependencies (report to upstream)
- Already known issues (check KNOWN_ISSUES.md)

### Rules

1. **No public disclosure** until we've had 90 days to fix
2. **No exploitation** of vulnerabilities beyond proof-of-concept
3. **No access** to other users' data
4. **Good faith** effort to avoid disruption
5. **One report per vulnerability**

### Safe Harbor

We will not pursue legal action against researchers who:
- Follow this responsible disclosure policy
- Make good faith efforts to avoid harm
- Do not access/modify other users' data
- Report findings promptly

---

## Security Measures

### On-Chain Security

| Measure | Description |
|---------|-------------|
| **Groth16 ZK-SNARKs** | Battle-tested cryptographic proofs |
| **Nullifier Tracking** | Prevents double-spending |
| **Maturity Delays** | Anti-correlation timing protection |
| **Admin Controls** | Pause functionality for emergencies |
| **Rate Limiting** | Per-slot transaction limits |

### Infrastructure Security

| Measure | Description |
|---------|-------------|
| **HTTPS Everywhere** | TLS 1.3 for all connections |
| **Secret Management** | Fly.io secrets, not in code |
| **No Logging of Secrets** | Proofs/secrets never logged |
| **Input Validation** | All inputs sanitized |

### Cryptographic Security

| Component | Standard |
|-----------|----------|
| ZK Proofs | Groth16 (BN254 curve) |
| Hashing | Poseidon (ZK-friendly) |
| Signatures | Ed25519 |
| Key Derivation | BIP-32/39 compatible |

---

## Known Security Considerations

### By Design

1. **Maturity Period**: Users must wait before withdrawing (anti-correlation)
2. **Denomination Tiers**: Fixed amounts improve anonymity set
3. **Relayer Trust**: Relayer cannot steal funds but can censor transactions
4. **Merkle Tree Depth**: 20 levels = 1M+ deposits supported

### Theoretical Attacks (Mitigated)

| Attack | Mitigation |
|--------|------------|
| Timing correlation | Maturity delays |
| Amount correlation | Fixed denominations |
| Graph analysis | Stealth addresses |
| Front-running | Intent signatures with expiry |
| Double-spend | Nullifier tracking |

---

## Incident Response

### If We Discover a Vulnerability

1. **Assess** severity and impact
2. **Pause** protocol if critical (admin function)
3. **Fix** and test thoroughly
4. **Deploy** fix to devnet, then mainnet
5. **Disclose** after fix is live

### Contact Timeline

| Action | Timeline |
|--------|----------|
| Acknowledgment | Within 24 hours |
| Initial Assessment | Within 72 hours |
| Status Updates | Weekly |
| Fix Deployment | Based on severity |
| Bounty Payment | Within 30 days of fix |

---

## Audit Reports

| Auditor | Date | Report |
|---------|------|--------|
| TBD | Q1 2026 | [Link when available] |

---

## Contact

- **Security Issues**: security@parad0xlabs.com
- **General Questions**: hello@parad0xlabs.com
- **Discord**: [discord.gg/Q7SCJfMJtr](https://discord.gg/Q7SCJfMJtr)

---

**Thank you for helping keep Dark Null Protocol secure!**


