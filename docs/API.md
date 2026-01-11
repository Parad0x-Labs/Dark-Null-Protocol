# 🌑 Dark Null Protocol - API Reference

> **Complete API documentation for developers**

**Base URL:** `https://api.parad0xlabs.com`

**Network:** Solana Devnet (Mainnet coming soon)

---

## Authentication

Currently no authentication required for devnet. Mainnet will require API keys.

---

## Core Endpoints (v1)

### Health Check

```http
GET /health
```

**Response:**
```json
{
  "ok": true,
  "cluster": "devnet",
  "programId": "7niGgy3EBVZtFjY1Gjx2hoeNHzeiJER76sEVhd4S5p6w",
  "relayerPubkey": "CsfAbvMGrYK4Ex9rKA5vFEbRR2hMBdbzjVyjjExds2d2",
  "relayerBalance": 9886935960,
  "version": "1.0.0",
  "uptime": 507.576
}
```

---

### Protocol Info

```http
GET /info
```

**Response:**
```json
{
  "protocol": "dark-null",
  "version": "1.0.0",
  "programId": "7niGgy3EBVZtFjY1Gjx2hoeNHzeiJER76sEVhd4S5p6w",
  "treasury": "9vDnXsPonRJa7yAmvwRGMAdxt8W13Qbm7HZuvauM3Ya3",
  "relayerPubkey": "CsfAbvMGrYK4Ex9rKA5vFEbRR2hMBdbzjVyjjExds2d2",
  "supportedAmounts": ["any"],
  "fees": {
    "relayerFeeBps": 10,
    "minFee": 1000
  }
}
```

---

### Shield (Privacy Deposit)

Deposit SOL into the privacy pool.

```http
POST /v1/shield
```

**Request Body:**
```json
{
  "amountLamports": "100000000",
  "commitment": "91cb3a3ae2daf5d02338466f9b303ed703f666eede8078bd5b19658cc8de78dd"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `amountLamports` | string | Amount in lamports (1 SOL = 1,000,000,000) |
| `commitment` | string | 64-char hex hash of (secret + nullifier) |

**Response:**
```json
{
  "success": true,
  "sig": "2r6KfAtCGWyjyY2z...",
  "explorerUrl": "https://explorer.solana.com/tx/..."
}
```

---

### Unshield (Private Withdrawal)

Withdraw from privacy pool with ZK proof.

```http
POST /v1/unshield
```

**Request Body:**
```json
{
  "amountLamports": "100000000",
  "recipient": "F6Fr2Sn6jLMbpLMcg7ezrwNLZxs9MM8RYyifUAvP72BY",
  "proof": {
    "pi_a": ["123...", "456..."],
    "pi_b": [["123...", "456..."], ["789...", "012..."]],
    "pi_c": ["123...", "456..."]
  },
  "publicSignals": ["nullifier", "root", "recipient", "amount"]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `amountLamports` | string | Amount to withdraw |
| `recipient` | string | Destination wallet address |
| `proof` | object | Groth16 ZK proof |
| `publicSignals` | array | Public inputs for verification |

**Response:**
```json
{
  "success": true,
  "sig": "JEu866e7A3NpTPEG...",
  "explorerUrl": "https://explorer.solana.com/tx/..."
}
```

---

### Private Pay

Send private payment directly.

```http
POST /v1/pay
```

**Request Body:**
```json
{
  "amountLamports": "10000000",
  "recipient": "F6Fr2Sn6jLMbpLMcg7ezrwNLZxs9MM8RYyifUAvP72BY",
  "proof": { ... },
  "publicSignals": [ ... ]
}
```

---

### Job Status

Check async job status.

```http
GET /v1/jobs/:id
```

**Response:**
```json
{
  "id": "abc123",
  "status": "completed",
  "result": { ... },
  "createdAt": "2026-01-09T22:00:00Z",
  "completedAt": "2026-01-09T22:00:02Z"
}
```

---

## Micropayment Endpoints (v2)

### Create Payment Intent (PIE)

Submit off-chain payment intent for batching.

```http
POST /v2/intent
```

**Request Body:**
```json
{
  "amountLamports": "1000000",
  "recipientBlinded": "merchant_001"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `amountLamports` | string | Payment amount |
| `recipientBlinded` | string | Blinded recipient identifier |

**Response:**
```json
{
  "success": true,
  "intentId": "68dc78f519129739ed29655026d87a52",
  "windowId": "2026-01-09T22:12:18.994Z",
  "position": 1,
  "estimatedSettlement": "2026-01-09T22:13:18.994Z",
  "instantCreditGranted": true,
  "message": "Payment intent batched for settlement"
}
```

---

### Pool Status (PIP)

Get current batching pool status.

```http
GET /v2/pool
```

**Response:**
```json
{
  "success": true,
  "pool": {
    "windowId": "2026-01-09T22:12:18.994Z",
    "status": "collecting",
    "intentCount": 3,
    "totalVolume": "4000000",
    "windowEnd": "2026-01-09T22:13:18.994Z"
  },
  "message": "Pool active"
}
```

---

### Force Settlement (PAP)

Trigger immediate pool settlement.

```http
POST /v2/pool/settle
```

**Response:**
```json
{
  "success": true,
  "settlementId": "...",
  "intentsSettled": 3,
  "totalVolume": "4000000",
  "txSignature": "..."
}
```

---

### Instant Credit Ledger (QIL)

Get recipient's instant credit balance.

```http
GET /v2/ledger/:pubkey
```

**Response:**
```json
{
  "success": true,
  "ledger": {
    "pubkey": "merchant_001",
    "pendingCredits": "1000000",
    "pendingDebits": "0",
    "netBalance": "1000000",
    "trustScore": 50,
    "pendingIntents": 1
  }
}
```

---

### Settlement History

Get historical pool settlements.

```http
GET /v2/pools/history
```

**Response:**
```json
{
  "success": true,
  "count": 2,
  "pools": [
    {
      "windowId": "2026-01-09T22:03:32.670Z",
      "intentCount": 1,
      "totalVolume": "1000000",
      "status": "settled"
    }
  ]
}
```

---

### Create Streaming Channel

Create pay-per-second payment channel.

```http
POST /v2/stream
```

**Request Body:**
```json
{
  "recipient": "content_creator_001",
  "depositLamports": "10000000",
  "ratePerSec": "1000"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `recipient` | string | Stream recipient |
| `depositLamports` | string | Total deposit |
| `ratePerSec` | string | Lamports per second |

**Response:**
```json
{
  "success": true,
  "channelId": "b8b0f704-7e57-47e9-b144-42a9bac727a8",
  "config": {
    "recipient": "content_creator_001",
    "depositLamports": "10000000",
    "ratePerSec": "1000"
  },
  "message": "Stream channel created"
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

| Code | Description |
|------|-------------|
| `INVALID_REQUEST` | Malformed request body |
| `INSUFFICIENT_BALANCE` | Not enough SOL |
| `INVALID_PROOF` | ZK proof verification failed |
| `NULLIFIER_USED` | Double-spend attempt |
| `ROOT_EXPIRED` | Merkle root no longer valid |
| `MATURITY_NOT_MET` | Deposit not mature yet |

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `/health`, `/info` | 100/min |
| `/v1/*` | 20/min |
| `/v2/*` | 50/min |

---

## Code Examples

### JavaScript (Node.js)

```javascript
const https = require('https');

// Shield 0.1 SOL
const shield = async () => {
  const data = JSON.stringify({
    amountLamports: '100000000',
    commitment: 'a'.repeat(64)
  });
  
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.parad0xlabs.com',
      path: '/v1/shield',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.write(data);
    req.end();
  });
};

// Create micropayment intent
const createIntent = async () => {
  const data = JSON.stringify({
    amountLamports: '1000000',
    recipientBlinded: 'merchant_001'
  });
  
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.parad0xlabs.com',
      path: '/v2/intent',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.write(data);
    req.end();
  });
};
```

### Python

```python
import requests

BASE_URL = 'https://api.parad0xlabs.com'

# Health check
health = requests.get(f'{BASE_URL}/health').json()
print(health)

# Shield
shield = requests.post(f'{BASE_URL}/v1/shield', json={
    'amountLamports': '100000000',
    'commitment': 'a' * 64
}).json()
print(shield)

# Create micropayment intent
intent = requests.post(f'{BASE_URL}/v2/intent', json={
    'amountLamports': '1000000',
    'recipientBlinded': 'merchant_001'
}).json()
print(intent)
```

### cURL

```bash
# Health check
curl https://api.parad0xlabs.com/health

# Shield
curl -X POST https://api.parad0xlabs.com/v1/shield \
  -H "Content-Type: application/json" \
  -d '{"amountLamports":"100000000","commitment":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'

# Create intent
curl -X POST https://api.parad0xlabs.com/v2/intent \
  -H "Content-Type: application/json" \
  -d '{"amountLamports":"1000000","recipientBlinded":"merchant_001"}'

# Check pool
curl https://api.parad0xlabs.com/v2/pool

# Check ledger
curl https://api.parad0xlabs.com/v2/ledger/merchant_001
```

---

## Use Cases

### 1. AI Agent Payments
```javascript
// AI agent receives micropayment for API call
await createIntent({
  amountLamports: '500000',  // $0.10
  recipientBlinded: 'ai_agent_gpt'
});
```

### 2. Content Creator Streaming
```javascript
// Pay creator per second of content viewed
await createStream({
  recipient: 'creator_123',
  depositLamports: '10000000',  // 0.01 SOL pool
  ratePerSec: '1000'  // ~$0.0002/sec
});
```

### 3. E-commerce Privacy
```javascript
// Private purchase
await shield({ amountLamports: '1000000000' });  // Shield 1 SOL
// ... later ...
await unshield({ recipient: 'merchant_wallet', proof: zkProof });
```

### 4. High-Volume Micropayments
```javascript
// Batch 10,000 API calls into single TX
for (let i = 0; i < 10000; i++) {
  await createIntent({
    amountLamports: '1000',
    recipientBlinded: `service_${i % 100}`
  });
}
// All settled in ONE on-chain TX
```

---

## Support

- **Technical:** hello@parad0xlabs.com
- **Security:** security@parad0xlabs.com
- **Website:** https://parad0xlabs.com

---

*© 2026 Parad0x Labs - Dark Null Protocol*

