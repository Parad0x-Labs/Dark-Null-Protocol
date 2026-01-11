# Dark Null Protocol IDL

## Interface Definition Language

This directory contains the public Interface Definition Language (IDL) for Dark Null Protocol.

---

## Files

| File | Description |
|------|-------------|
| `dark_null_v1.json` | V18 (Dark Null v1) interface |

---

## What is the IDL?

The IDL defines the complete interface for interacting with the on-chain program:

- **Instructions** — What actions can be performed
- **Accounts** — What data structures exist
- **Types** — Custom types and enums
- **Events** — What events are emitted
- **Errors** — What errors can occur

---

## Usage

### With Anchor

```typescript
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import IDL from "./dark_null_v1.json";

const program = new Program(IDL as any, provider);

// Call instructions
await program.methods
  .shieldV18(amount, commitment, auditTag)
  .accounts({ ... })
  .rpc();
```

### With @dark-null/sdk

```typescript
import { DarkNullClient } from "@dark-null/sdk";

// SDK handles IDL internally
const client = new DarkNullClient({ ... });
```

---

## Fetching from Chain

You can fetch the IDL directly from the deployed program:

```bash
anchor idl fetch 7niGgy3EBVZtFjY1Gjx2hoeNHzeiJER76sEVhd4S5p6w \
  --provider.cluster devnet
```

---

## Verification

Compare on-chain IDL to published IDL:

```bash
# Fetch from chain
anchor idl fetch 7niGgy3EBVZtFjY1Gjx2hoeNHzeiJER76sEVhd4S5p6w \
  --provider.cluster devnet > idl_from_chain.json

# Compare
diff idl_from_chain.json ./dark_null_v1.json
```

---

## Instructions Reference

| Instruction | Description |
|-------------|-------------|
| `initialize` | Initialize protocol state |
| `shieldV18` | Deposit funds into privacy pool |
| `updateRoot` | Update Merkle root |
| `unshieldV18` | Withdraw funds with ZK proof |
| `unshieldV18Relayed` | Relayer-paid withdrawal |
| `setMinDelay` | Admin: Set maturity delay |
| `setDenoms` | Admin: Set valid denominations |
| `pause` / `unpause` | Admin: Emergency controls |

---

## See Also

- [API Reference](../docs/api-reference.md)
- [Architecture](../docs/architecture.md)
- [VERIFICATION.md](../VERIFICATION.md)


