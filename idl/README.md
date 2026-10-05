# Dark Null Protocol IDL

This directory contains the canonical public IDL for the promoted root program.

## Files

| File | Description |
|---|---|
| `paradox.json` | Canonical root IDL for program `35GMe13ExGB1JGp1wZGrEvHfQnENKADroDQApeziKuwV` |

The older docs-track IDL was moved to [`../historical/root-toy-prototype/idl`](../historical/root-toy-prototype/idl).

## Use It with Anchor

```typescript
import { AnchorProvider, Idl, Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import idl from "./paradox.json";

const program = new Program(
  idl as Idl,
  new PublicKey("35GMe13ExGB1JGp1wZGrEvHfQnENKADroDQApeziKuwV"),
  provider as AnchorProvider
);
```

## Notes

- this is the canonical public IDL in the repo
- the matching root manifest is [`../MANIFEST.json`](../MANIFEST.json)
- historical program IDs are still cataloged in [`../docs/PROGRAM_IDS.md`](../docs/PROGRAM_IDS.md)
