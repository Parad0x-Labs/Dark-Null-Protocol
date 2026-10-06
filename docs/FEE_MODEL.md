# Dark Null v1.22 — Fee Model

## Fee Structure

| Fee Type | Rate | Recipient |
|----------|------|-----------|
| **Protocol fee** | 0% | none (Parad0x takes no protocol fee on Dark Null transfers) |
| **Relayer fee** | Configurable (min 0.0005 SOL) | Relayer |

Parad0x's only fee across its stack is the DNA x402 protocol fee of 0.05% (5 bps) on x402
settlements. Dark Null transfers carry no Parad0x fee.

## When Fees Are Applied

The relayer fee is deducted at **finalize** from the unshielded amount.

```
recipient_receives = amount - relayer_fee
```

## Who Pays?

The sender effectively pays the relayer fee, as the recipient receives the net amount.

| Destination | Amount |
|-------------|--------|
| Recipient | `amount - relayer_fee` |
| Relayer | `relayer_fee` (configured, min 0.0005 SOL) |

## Important: Small Transfer Economics

For small amounts, the **minimum relayer fee** dominates.

### Example: 0.01 SOL transfer

| Component | Amount |
|-----------|--------|
| Transfer amount | 0.01 SOL |
| Protocol fee | 0 SOL |
| Relayer fee (minimum) | 0.0005 SOL |
| **Total fees** | 0.0005 SOL |
| **Recipient receives** | 0.0095 SOL |

### Example: 1 SOL transfer

| Component | Amount |
|-----------|--------|
| Transfer amount | 1 SOL |
| Protocol fee | 0 SOL |
| Relayer fee (0.1%) | 0.001 SOL |
| **Total fees** | 0.001 SOL |
| **Recipient receives** | 0.999 SOL |

## Fee Safety

- `total_fee <= amount` is enforced on-chain
- All fee calculations use checked arithmetic
- Fees cannot exceed the transfer amount
- Minimum relayer fee prevents dust abuse
