# Dark Null v1.22 — Fee Model

## Fee Structure

| Fee Type | Rate | Recipient |
|----------|------|-----------|
| **Protocol fee** | 0.3% | Treasury |
| **Relayer fee** | Configurable (min 0.0005 SOL) | Relayer |

## When Fees Are Applied

Fees are deducted at **finalize** from the unshielded amount.

```
recipient_receives = amount - protocol_fee - relayer_fee
```

## Who Pays?

The sender effectively pays fees, as the recipient receives the net amount after deductions.

| Destination | Amount |
|-------------|--------|
| Recipient | `amount - protocol_fee - relayer_fee` |
| Treasury | `protocol_fee` (0.3% of amount) |
| Relayer | `relayer_fee` (configured, min 0.0005 SOL) |

## Important: Small Transfer Economics

For small amounts, the **minimum relayer fee** dominates.

### Example: 0.01 SOL transfer

| Component | Amount |
|-----------|--------|
| Transfer amount | 0.01 SOL |
| Protocol fee (0.3%) | 0.00003 SOL |
| Relayer fee (minimum) | 0.0005 SOL |
| **Total fees** | 0.00053 SOL |
| **Recipient receives** | ~0.00947 SOL |

### Example: 1 SOL transfer

| Component | Amount |
|-----------|--------|
| Transfer amount | 1 SOL |
| Protocol fee (0.3%) | 0.003 SOL |
| Relayer fee (0.1%) | 0.001 SOL |
| **Total fees** | 0.004 SOL |
| **Recipient receives** | 0.996 SOL |

## Fee Safety

- `total_fee <= amount` is enforced on-chain
- All fee calculations use checked arithmetic
- Fees cannot exceed the transfer amount
- Minimum relayer fee prevents dust abuse
