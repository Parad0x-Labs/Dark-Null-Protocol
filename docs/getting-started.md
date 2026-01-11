# Getting Started with Dark Null Protocol

Welcome to Dark Null Protocol — zero-knowledge privacy payments on Solana.

---

## Prerequisites

- Node.js 18 or higher
- A Solana wallet (Phantom, Solflare, etc.)
- Some devnet SOL for testing

### Get Devnet SOL

```bash
solana airdrop 2 YOUR_WALLET_ADDRESS --url devnet
```

Or use [solfaucet.com](https://solfaucet.com)

---

## Installation

```bash
npm install @dark-null/sdk
```

---

## Quick Start

### 1. Initialize the Client

```typescript
import { DarkNullClient } from '@dark-null/sdk';
import { Connection, clusterApiUrl } from '@solana/web3.js';

const connection = new Connection(clusterApiUrl('devnet'));

const client = new DarkNullClient({
  connection,
  programId: '7niGgy3EBVZtFjY1Gjx2hoeNHzeiJER76sEVhd4S5p6w',
});
```

### 2. Shield Funds (Deposit)

"Shielding" deposits funds into the privacy pool:

```typescript
const shieldResult = await client.shield({
  amount: 0.1,  // SOL
  wallet: yourWalletAdapter,
});

console.log('Shield TX:', shieldResult.signature);
console.log('Commitment:', shieldResult.commitment);
console.log('Secret:', shieldResult.secret); // SAVE THIS! Needed for withdrawal
```

⚠️ **Important**: Save your `secret` securely. You need it to withdraw!

### 3. Wait for Maturity

Privacy requires waiting for the maturity period:

```typescript
await client.waitForMaturity(shieldResult.commitment);
console.log('Maturity reached! Ready to unshield.');
```

Default maturity: ~20 seconds on devnet, ~10 minutes recommended for mainnet.

### 4. Unshield Funds (Withdraw)

"Unshielding" withdraws funds privately:

```typescript
const unshieldResult = await client.unshield({
  secret: shieldResult.secret,
  recipient: recipientAddress,
});

console.log('Unshield TX:', unshieldResult.signature);
console.log('IPFS Proof:', unshieldResult.ipfsProof);
```

The recipient receives funds with **no on-chain link to the sender**!

---

## Using the Relayer

For maximum privacy, use the relayer so your wallet never appears as fee payer:

```typescript
const client = new DarkNullClient({
  connection,
  programId: '7niGgy3EBVZtFjY1Gjx2hoeNHzeiJER76sEVhd4S5p6w',
  relayerUrl: 'https://relayer-falling-dust-5746.fly.dev',
});

// Relayer pays fees, your wallet stays hidden
const result = await client.pay({
  amount: 0.1,
  recipient: recipientAddress,
});
```

---

## Full Example

```typescript
import { DarkNullClient } from '@dark-null/sdk';
import { Connection, clusterApiUrl, Keypair } from '@solana/web3.js';

async function main() {
  // Setup
  const connection = new Connection(clusterApiUrl('devnet'));
  const wallet = Keypair.generate(); // Use your actual wallet
  
  const client = new DarkNullClient({
    connection,
    programId: '7niGgy3EBVZtFjY1Gjx2hoeNHzeiJER76sEVhd4S5p6w',
    relayerUrl: 'https://relayer-falling-dust-5746.fly.dev',
  });

  // 1. Shield
  console.log('Shielding 0.1 SOL...');
  const shield = await client.shield({
    amount: 0.1,
    wallet,
  });
  console.log('✅ Shield TX:', shield.signature);

  // 2. Wait for maturity
  console.log('Waiting for maturity...');
  await client.waitForMaturity(shield.commitment);
  console.log('✅ Maturity reached');

  // 3. Unshield to recipient
  const recipient = 'RECIPIENT_ADDRESS';
  console.log('Unshielding to', recipient);
  const unshield = await client.unshield({
    secret: shield.secret,
    recipient,
  });
  console.log('✅ Unshield TX:', unshield.signature);

  console.log('🎉 Private payment complete!');
}

main().catch(console.error);
```

---

## Next Steps

- [API Reference](./api-reference.md) — Full SDK documentation
- [Integration Guide](./integration-guide.md) — Add to your app
- [Architecture](./architecture.md) — How it works under the hood

---

## Need Help?

- **Discord**: [discord.gg/darknull](https://discord.gg/darknull)
- **Twitter**: [@DarkNullProtocol](https://twitter.com/DarkNullProtocol)
- **Email**: hello@parad0xlabs.com

---

**Privacy you can defend.** 🌑


