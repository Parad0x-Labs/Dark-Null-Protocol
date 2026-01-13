# Dark Null v1.22 — FAQ

## General

### Is the transaction size literally 32 bytes?

No. "32B" refers to the **claim hash** posted on-chain in the commit step.

The transaction includes accounts, instruction headers, and metadata — that's normal Solana transaction structure. The key optimization is that the **proof payload** is just 32 bytes on the happy path.

### Is this a mixer?

No. Dark Null is a privacy transfer protocol.

It uses an anonymity set + nullifiers + challengeable correctness. The design prioritizes legitimate use cases (payroll, donations, business payments) with built-in compliance options.

### How is this different from Tornado Cash?

1. **Lazy verification** — proof bytes aren't required on the happy path
2. **Compliance options** — optional audit tags for regulatory proof
3. **Maturity delays** — prevents instant mixing
4. **Not a mixer** — it's a privacy layer with legitimate use cases

### Is this legal?

Yes. Privacy is a fundamental right.

Dark Null provides "Maximum Legal Privacy" — privacy for legitimate use while maintaining compliance options. The protocol follows a "privacy by design" approach that respects both user privacy and regulatory requirements.

---

## Technical

### Where are the circuits / keys / prover code?

Not published in this repository by design.

The core protocol implementation is proprietary but **verified through security audits** and **deterministic builds**. This approach protects intellectual property while maintaining trust through verification.

### Why a challenge window?

It allows very cheap happy-path finalization while preserving security via permissionless fraud proofs.

Most transactions finalize without challenge (32B claim → wait → finalize). Only disputed transactions require full proof verification.

### How do micropayments work?

Our PIE+PIP+PAP system batches thousands of micropayment intents into single on-chain transactions, reducing costs by up to 10,000x.

This makes sub-cent payments economically viable.

### What happens if someone challenges my withdrawal?

If the challenge is valid (your claim was fraudulent):
- Your commit is rejected
- Your bond is slashed
- Challenger is rewarded

If the challenge is invalid (your claim was legitimate):
- Your commit is confirmed early
- Challenger's bond is slashed
- You can finalize immediately

---

## Integration

### Can I run my own relayer?

Yes. The relayer is optional infrastructure for UX convenience.

Users can also submit their own transactions directly.

### Is there an SDK?

Yes. See [@dark-null/sdk](https://github.com/Parad0x-Labs/Dark-Null-Protocol) for integration packages.

### What networks are supported?

| Network | Status |
|---------|--------|
| Devnet | ✅ Live |
| Mainnet | ⏳ After audit |

---

## Contact

- **Website**: [parad0xlabs.com](https://parad0xlabs.com)
- **Discord**: [discord.gg/Q7SCJfMJtr](https://discord.gg/Q7SCJfMJtr)
- **Email**: hello@parad0xlabs.com
