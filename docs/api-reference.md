# API Reference

## Dark Null Protocol SDK

Complete API documentation for `@dark-null/sdk`.

---

## Installation

```bash
npm install @dark-null/sdk
```

---

## DarkNullClient

Main client for interacting with Dark Null Protocol.

### Constructor

```typescript
new DarkNullClient(options: DarkNullClientOptions)
```

#### Options

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `connection` | `Connection` | Yes | Solana connection |
| `programId` | `string` | Yes | Dark Null program ID |
| `relayerUrl` | `string` | No | Relayer API URL for fee sponsorship |
| `commitment` | `Commitment` | No | Transaction commitment level |

#### Example

```typescript
import { DarkNullClient } from '@dark-null/sdk';
import { Connection } from '@solana/web3.js';

const client = new DarkNullClient({
  connection: new Connection('https://api.devnet.solana.com'),
  programId: '7niGgy3EBVZtFjY1Gjx2hoeNHzeiJER76sEVhd4S5p6w',
  relayerUrl: 'https://relayer-falling-dust-5746.fly.dev',
});
```

---

## Methods

### shield()

Deposit funds into the privacy pool.

```typescript
shield(options: ShieldOptions): Promise<ShieldResult>
```

#### ShieldOptions

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `amount` | `number` | Yes | Amount in SOL |
| `wallet` | `WalletAdapter` | Yes | Wallet to sign transaction |
| `auditTag` | `Uint8Array` | No | Optional compliance tag |

#### ShieldResult

| Property | Type | Description |
|----------|------|-------------|
| `signature` | `string` | Transaction signature |
| `commitment` | `string` | Commitment hash (hex) |
| `secret` | `string` | Secret for withdrawal (hex) |
| `leafIndex` | `number` | Merkle tree leaf index |
| `depositSlot` | `number` | Slot of deposit |

#### Example

```typescript
const result = await client.shield({
  amount: 0.1,
  wallet: myWallet,
});

// IMPORTANT: Save the secret!
localStorage.setItem('dark-null-secret', result.secret);
```

---

### unshield()

Withdraw funds privately.

```typescript
unshield(options: UnshieldOptions): Promise<UnshieldResult>
```

#### UnshieldOptions

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `secret` | `string` | Yes | Secret from shield |
| `recipient` | `string` | Yes | Recipient public key |
| `useRelayer` | `boolean` | No | Use relayer for fees (default: true if relayerUrl set) |

#### UnshieldResult

| Property | Type | Description |
|----------|------|-------------|
| `signature` | `string` | Transaction signature |
| `amount` | `number` | Amount withdrawn (SOL) |
| `fee` | `number` | Protocol fee (SOL) |
| `ipfsProof` | `string` | IPFS hash of ZK proof |
| `ipfsReceipt` | `string` | IPFS hash of receipt |

#### Example

```typescript
const secret = localStorage.getItem('dark-null-secret');

const result = await client.unshield({
  secret,
  recipient: 'RECIPIENT_PUBKEY',
});

console.log('Withdrew:', result.amount, 'SOL');
```

---

### pay()

One-step private payment (shield + unshield via relayer).

```typescript
pay(options: PayOptions): Promise<PayResult>
```

#### PayOptions

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `amount` | `number` | Yes | Amount in SOL |
| `recipient` | `string` | Yes | Recipient public key |
| `wallet` | `WalletAdapter` | Yes | Wallet to sign |

#### PayResult

| Property | Type | Description |
|----------|------|-------------|
| `jobId` | `string` | Relayer job ID |
| `status` | `string` | Job status |
| `signature` | `string` | Final transaction signature |
| `receiptHash` | `string` | SHA256 of receipt |

#### Example

```typescript
// Simple private payment
const result = await client.pay({
  amount: 0.05,
  recipient: 'BOB_PUBKEY',
  wallet: myWallet,
});
```

---

### waitForMaturity()

Wait for deposit maturity.

```typescript
waitForMaturity(commitment: string): Promise<void>
```

#### Example

```typescript
await client.waitForMaturity(shieldResult.commitment);
console.log('Ready to withdraw!');
```

---

### getBalance()

Get shielded balance (from stored notes).

```typescript
getBalance(wallet: WalletAdapter): Promise<BalanceResult>
```

#### BalanceResult

| Property | Type | Description |
|----------|------|-------------|
| `total` | `number` | Total shielded SOL |
| `available` | `number` | Mature (withdrawable) SOL |
| `pending` | `number` | Immature SOL |
| `notes` | `Note[]` | Individual notes |

---

### getProof()

Generate ZK proof for withdrawal.

```typescript
getProof(secret: string): Promise<Proof>
```

#### Proof

| Property | Type | Description |
|----------|------|-------------|
| `proofA` | `Uint8Array` | G1 point (64 bytes) |
| `proofB` | `Uint8Array` | G2 point (128 bytes) |
| `proofC` | `Uint8Array` | G1 point (64 bytes) |
| `publicInputs` | `bigint[]` | Public inputs |

---

## Types

### Denomination

```typescript
type Denomination = 
  | 0.001  // Micro
  | 0.01   // Mini
  | 0.1    // Standard
  | 0.5    // Medium
  | 1      // Large
  | 10;    // Whale
```

### Note

```typescript
interface Note {
  commitment: string;
  amount: number;
  depositSlot: number;
  mature: boolean;
  spent: boolean;
}
```

### JobStatus

```typescript
type JobStatus = 
  | 'pending'
  | 'processing'
  | 'shielded'
  | 'proving'
  | 'unshielded'
  | 'completed'
  | 'failed';
```

---

## Error Handling

```typescript
import { DarkNullError, ErrorCode } from '@dark-null/sdk';

try {
  await client.unshield({ ... });
} catch (error) {
  if (error instanceof DarkNullError) {
    switch (error.code) {
      case ErrorCode.MaturityNotReached:
        console.log('Wait for maturity');
        break;
      case ErrorCode.InvalidProof:
        console.log('Proof verification failed');
        break;
      case ErrorCode.DoubleSpend:
        console.log('Already withdrawn');
        break;
    }
  }
}
```

### Error Codes

| Code | Name | Description |
|------|------|-------------|
| 6000 | InvalidRoot | Merkle root not found |
| 6001 | InvalidDenomination | Invalid amount tier |
| 6002 | MaturityNotReached | Deposit not mature |
| 6003 | DoubleSpend | Nullifier already used |
| 6004 | PageFull | Nullifier storage full |
| 6005 | InvalidProof | ZK proof invalid |
| 6006 | ProtocolPaused | Protocol is paused |

---

## Events

### Listening to Events

```typescript
client.on('shield', (event) => {
  console.log('Shield:', event.amount, event.commitment);
});

client.on('unshield', (event) => {
  console.log('Unshield:', event.amount, event.recipient);
});
```

---

## Constants

```typescript
import { 
  PROGRAM_ID_DEVNET,
  PROGRAM_ID_MAINNET,
  RELAYER_URL_DEVNET,
  DENOMINATIONS,
  DEFAULT_MATURITY_SLOTS,
} from '@dark-null/sdk';
```

| Constant | Value |
|----------|-------|
| `PROGRAM_ID_DEVNET` | `7niGgy3EBVZtFjY1Gjx2hoeNHzeiJER76sEVhd4S5p6w` |
| `RELAYER_URL_DEVNET` | `https://relayer-falling-dust-5746.fly.dev` |
| `DEFAULT_MATURITY_SLOTS` | `40` |

---

## See Also

- [Getting Started](./getting-started.md)
- [Integration Guide](./integration-guide.md)
- [Architecture](./architecture.md)


