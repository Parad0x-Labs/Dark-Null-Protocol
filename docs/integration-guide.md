# Integration Guide

## Integrating Dark Null Protocol Into Your Application

---

## Choose Your Integration Method

| Method | Best For | Complexity |
|--------|----------|------------|
| [SDK](#sdk-integration) | Full control, custom flows | Medium |
| [x402 Middleware](#x402-middleware) | API monetization | Low |
| [Jupiter Hook](#jupiter-hook) | Private DEX swaps | Low |
| [MCP Tools](#mcp-tools) | AI agent payments | Low |
| [Direct API](#direct-api) | Backend services | Medium |

---

## SDK Integration

### Installation

```bash
npm install @dark-null/sdk
```

### Basic Setup

```typescript
import { DarkNullClient } from '@dark-null/sdk';
import { Connection } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';

// In your React component
function PaymentComponent() {
  const { publicKey, signTransaction } = useWallet();
  
  const client = new DarkNullClient({
    connection: new Connection('https://api.devnet.solana.com'),
    programId: '7niGgy3EBVZtFjY1Gjx2hoeNHzeiJER76sEVhd4S5p6w',
    relayerUrl: 'https://relayer-falling-dust-5746.fly.dev',
  });

  const handlePayment = async () => {
    const result = await client.pay({
      amount: 0.1,
      recipient: 'RECIPIENT_ADDRESS',
      wallet: { publicKey, signTransaction },
    });
    
    console.log('Payment complete:', result.signature);
  };

  return <button onClick={handlePayment}>Pay Privately</button>;
}
```

---

## x402 Middleware

Monetize your API with HTTP 402 payments.

### Installation

```bash
npm install @dark-null/x402-middleware
```

### Server Setup (Express)

```typescript
import express from 'express';
import { darkNull402 } from '@dark-null/x402-middleware';

const app = express();

// Protect endpoints with payment requirement
app.use('/api/premium', darkNull402({
  price: 0.001,  // SOL per request
  recipient: 'YOUR_WALLET_ADDRESS',
  relayerUrl: 'https://relayer-falling-dust-5746.fly.dev',
}));

app.get('/api/premium/data', (req, res) => {
  // Only reached after payment verified
  res.json({ secret: 'Premium content!' });
});

app.listen(3000);
```

### Client Usage

```typescript
import { payAndFetch } from '@dark-null/x402-middleware';

// Automatically handles 402 → pay → retry
const response = await payAndFetch({
  url: 'https://api.example.com/api/premium/data',
  relayerUrl: 'https://relayer-falling-dust-5746.fly.dev',
  wallet: yourWallet,
});

const data = await response.json();
```

### Flow

```
1. Client → GET /api/premium/data
2. Server → 402 Payment Required
   {
     "price": 0.001,
     "recipient": "...",
     "paymentUrl": "..."
   }
3. Client → Dark Null Payment
4. Client → GET /api/premium/data + X-Dark-Null-Receipt header
5. Server → 200 OK + data
```

---

## Jupiter Hook

Private token swaps via Jupiter aggregator.

### Installation

```bash
npm install @dark-null/jupiter-hook
```

### Usage

```typescript
import { JupiterPrivateSwap } from '@dark-null/jupiter-hook';

const jupiter = new JupiterPrivateSwap({
  relayerUrl: 'https://relayer-falling-dust-5746.fly.dev',
});

// Private swap SOL → USDC
const result = await jupiter.swap({
  inputMint: 'So11111111111111111111111111111111111111112', // SOL
  outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  amount: 1.0,  // 1 SOL
  wallet: yourWallet,
  useStealthRecipient: true, // Receive to stealth address
});

console.log('Swap TX:', result.swapSignature);
console.log('Output received at:', result.stealthAddress);
```

### Flow

```
1. Shield SOL into Dark Null
2. Wait for maturity
3. Unshield to stealth address
4. Swap via Jupiter (from stealth)
5. Optionally re-shield output
```

---

## MCP Tools

AI agent native payments (Claude, GPT, etc.).

### Installation

```bash
npm install @dark-null/mcp-tools
```

### Start MCP Server

```bash
npx @dark-null/mcp-tools
```

### Available Tools

| Tool | Description |
|------|-------------|
| `dark_null_shield` | Deposit funds into privacy pool |
| `dark_null_unshield` | Withdraw funds privately |
| `dark_null_balance` | Check shielded balance |
| `dark_null_pay` | One-step private payment |

### Claude Desktop Configuration

```json
{
  "mcpServers": {
    "dark-null": {
      "command": "npx",
      "args": ["@dark-null/mcp-tools"],
      "env": {
        "SOLANA_RPC_URL": "https://api.devnet.solana.com",
        "RELAYER_URL": "https://relayer-falling-dust-5746.fly.dev"
      }
    }
  }
}
```

### Example Prompts

```
"Pay 0.1 SOL privately to address ABC..."
"Check my shielded balance"
"Shield 1 SOL for later use"
```

---

## Direct API

For backend services that don't use the SDK.

### Endpoints

Base URL: `https://relayer-falling-dust-5746.fly.dev`

#### POST /v1/pay

```bash
curl -X POST https://relayer-falling-dust-5746.fly.dev/v1/pay \
  -H "Content-Type: application/json" \
  -d '{
    "amountLamports": "100000000",
    "recipientPubkey": "RECIPIENT_ADDRESS"
  }'
```

Response:
```json
{
  "jobId": "job_abc123",
  "status": "pending"
}
```

#### GET /v1/job/:id

```bash
curl https://relayer-falling-dust-5746.fly.dev/v1/job/job_abc123
```

Response:
```json
{
  "jobId": "job_abc123",
  "status": "completed",
  "shieldSig": "...",
  "unshieldSig": "...",
  "receiptHash": "...",
  "ipfsProofUrl": "ipfs://...",
  "ipfsReceiptUrl": "ipfs://..."
}
```

#### GET /health

```bash
curl https://relayer-falling-dust-5746.fly.dev/health
```

---

## Best Practices

### 1. Error Handling

```typescript
import { DarkNullError, ErrorCode } from '@dark-null/sdk';

try {
  await client.pay({ ... });
} catch (error) {
  if (error instanceof DarkNullError) {
    if (error.code === ErrorCode.MaturityNotReached) {
      // Wait and retry
    }
  }
}
```

### 2. Storing Secrets

```typescript
// NEVER store secrets in plain localStorage in production
// Use encrypted storage or server-side

// Development only:
localStorage.setItem('note', JSON.stringify(shieldResult));

// Production: Send to your backend
await fetch('/api/notes', {
  method: 'POST',
  body: JSON.stringify(shieldResult),
});
```

### 3. Receipt Verification

```typescript
// Verify receipt before providing service
import { verifyReceipt } from '@dark-null/sdk';

const isValid = await verifyReceipt({
  receiptHash: req.headers['x-dark-null-receipt'],
  expectedAmount: 0.001,
  expectedRecipient: 'YOUR_WALLET',
});

if (!isValid) {
  return res.status(402).json({ error: 'Invalid receipt' });
}
```

### 4. Webhook Integration

```typescript
// Configure webhook for job completion
const result = await client.pay({
  amount: 0.1,
  recipient: 'BOB',
  wallet,
  webhookUrl: 'https://your-api.com/webhook/payment',
});

// Your webhook receives:
// POST /webhook/payment
// { jobId, status, signature, receipt }
```

---

## Testing

### Devnet Testing

```typescript
const client = new DarkNullClient({
  connection: new Connection('https://api.devnet.solana.com'),
  programId: '7niGgy3EBVZtFjY1Gjx2hoeNHzeiJER76sEVhd4S5p6w',
  relayerUrl: 'https://relayer-falling-dust-5746.fly.dev',
});

// Get devnet SOL
// solana airdrop 2 YOUR_WALLET --url devnet
```

### Local Testing

```bash
# Start local validator
solana-test-validator

# Deploy program locally
anchor deploy

# Run local relayer
cd infra/relayer && npm start
```

---

## Support

- **Discord**: [discord.gg/darknull](https://discord.gg/darknull)
- **Email**: hello@parad0xlabs.com
- **GitHub Issues**: For SDK bugs

---

**Happy building!** 🌑


