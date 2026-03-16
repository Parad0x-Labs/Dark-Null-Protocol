# Getting Started with the Canonical Dark Null Root

This guide assumes you want the current root path, not a historical side branch.

## 1. Bootstrap the Repo

```bash
sh scripts/bootstrap.sh
```

That installs npm dependencies and runs the public checks.

## 2. Read the Canonical Binding First

- [`../MANIFEST.json`](../MANIFEST.json)
- [`../NETWORKS.json`](../NETWORKS.json)
- [`PROGRAM_IDS.md`](./PROGRAM_IDS.md)

Those three files tell you which program ID, network map, and artifact set the root actually uses.

## 3. Resolve the Canonical Network Config

```bash
npm run config:devnet
```

If you are working against a local validator instead:

```bash
npm run config:localnet
```

## 4. Review the Root Program

- [`../Anchor.toml`](../Anchor.toml)
- [`../Cargo.toml`](../Cargo.toml)
- [`../src/lib.rs`](../src/lib.rs)
- [`../src/verifying_key.rs`](../src/verifying_key.rs)

## 5. Review the Root Circuit Artifacts

- [`../circuits/null_proof.circom`](../circuits/null_proof.circom)
- [`../circuits/null_proof_final.zkey`](../circuits/null_proof_final.zkey)
- [`../circuits/null_proof_js/null_proof.wasm`](../circuits/null_proof_js/null_proof.wasm)
- [`../circuits/vk.json`](../circuits/vk.json)

## 6. Use the npm SDK

```bash
npm install @dark-null/protocol @coral-xyz/anchor @solana/web3.js
```

```typescript
import {
  createAnchorProgram,
  deriveCanonicalPdas,
  getInstructionDefinition,
  resolveNetworkConfig,
  resolveProgramId,
} from "@dark-null/protocol";

const program = await createAnchorProgram({
  anchor,
  provider,
  manifestKey: "canonicalDevnet",
});

const withdraw = getInstructionDefinition("prepare_phantom_withdraw");
const programId = resolveProgramId("canonicalDevnet");
const network = resolveNetworkConfig("devnet");
const pdas = await deriveCanonicalPdas();
```

`prepare_phantom_withdraw` still exists in the public IDL, but the current canonical source now fails closed before payout until the proof bundle binds withdrawal amount and recipient semantics.

## 7. Or Use the Public IDL Directly

```typescript
import { AnchorProvider, Idl, Program } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import idl from "../idl/paradox.json";

const connection = new Connection("https://api.devnet.solana.com");
const provider = new AnchorProvider(connection, wallet, {});
const program = new Program(
  idl as Idl,
  new PublicKey("2stas3cZYnBiWpndcTXQDGLXwfQ7kjEYYrW52DsUAcxF"),
  provider
);
```

## 8. Run the Canonical Checks

```bash
npm test
npm run test:python:unit
cargo test --offline
```

## 9. Keep the Boundary Straight

- the root repo now has a real Groth16 verifier path and a canonical circuit bundle
- root updates in the current source require the `root_authority` PDA and authorized signer
- bounded root / leaf / nullifier windows now fail closed instead of overwriting silently
- the public root no longer releases payout from proof-unbound `amount` / recipient instruction arguments
- the repo still does **not** prove a completed audit or a mainnet release
- historical result bundles are still useful, but they are not the root integration target
