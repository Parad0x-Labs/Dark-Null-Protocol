# Contributing to Dark Null Protocol

Thank you for your interest in contributing to Dark Null Protocol! 🌑

---

## How to Contribute

### 🐛 Bug Reports

Found a bug? Please report it!

1. **Security bugs**: Email security@parad0xlabs.com (see [SECURITY.md](./SECURITY.md))
2. **Other bugs**: Open a GitHub issue

#### Bug Report Template

```markdown
**Describe the bug**
A clear description of what the bug is.

**To Reproduce**
1. Go to '...'
2. Click on '...'
3. See error

**Expected behavior**
What you expected to happen.

**Environment**
- Network: Devnet/Mainnet
- SDK Version: x.x.x
- OS: Windows/Mac/Linux

**Screenshots/Logs**
If applicable.
```

### 💡 Feature Requests

Have an idea? We'd love to hear it!

1. Check existing issues first
2. Open a new issue with `[FEATURE]` prefix
3. Describe the use case and proposed solution

### 📝 Documentation

Help improve our docs:

- Fix typos or unclear explanations
- Add examples
- Translate to other languages

### 🔧 Code Contributions

#### What You Can Contribute

| Area | Contribution Type |
|------|-------------------|
| SDK | Bug fixes, new features, tests |
| Integrations | x402, Jupiter, MCP improvements |
| Examples | New usage examples |
| Documentation | Guides, tutorials, API docs |

#### What Requires Approval

Due to the proprietary nature of core protocol:

| Area | Status |
|------|--------|
| Core protocol (`programs/`) | ❌ Not accepting PRs |
| ZK circuits (`circuits/`) | ❌ Not accepting PRs |
| Relayer core | ❌ Not accepting PRs |

### Pull Request Process

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

#### PR Requirements

- [ ] Tests pass
- [ ] Documentation updated
- [ ] No breaking changes (or clearly documented)
- [ ] Follows code style

---

## Development Setup

### Prerequisites

- Node.js 18+
- npm or yarn
- Solana CLI (for testing)

### Setup

```bash
# Clone the SDK repository
git clone https://github.com/parad0x-labs/dark-null-sdk
cd dark-null-sdk

# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build
```

### Testing Against Devnet

```bash
# Set environment
export SOLANA_RPC_URL=https://api.devnet.solana.com
export PROGRAM_ID=7niGgy3EBVZtFjY1Gjx2hoeNHzeiJER76sEVhd4S5p6w

# Run E2E tests
npm run test:e2e
```

---

## Code Style

### TypeScript

- Use TypeScript strict mode
- Prefer `const` over `let`
- Use meaningful variable names
- Add JSDoc comments for public APIs

### Example

```typescript
/**
 * Shield funds into the privacy pool
 * @param amount - Amount in SOL to shield
 * @param wallet - User's wallet adapter
 * @returns Shield transaction result
 */
export async function shield(
  amount: number,
  wallet: WalletAdapter
): Promise<ShieldResult> {
  // Implementation
}
```

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new shield method
fix: correct proof encoding
docs: update API reference
test: add integration tests
chore: update dependencies
```

---

## Community

### Get Help

- **Discord**: [discord.gg/darknull](https://discord.gg/darknull)
- **Twitter**: [@DarkNullProtocol](https://twitter.com/DarkNullProtocol)
- **Email**: hello@parad0xlabs.com

### Code of Conduct

Please read and follow our [Code of Conduct](./CODE_OF_CONDUCT.md).

---

## Recognition

Contributors are recognized in:

- CHANGELOG.md for significant contributions
- GitHub contributors list
- Community spotlight (Discord/Twitter)

---

## License

By contributing, you agree that your contributions will be licensed under the same license as the component you're contributing to:

- SDK/Integrations: MIT License
- Documentation: CC BY 4.0

---

**Thank you for helping make privacy accessible to everyone!** 🌑


