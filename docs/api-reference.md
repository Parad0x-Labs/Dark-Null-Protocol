# Public Interface Reference

This is the public interface index for the current canonical root.

## Install

```bash
npm install @dark-null/protocol
```

For Anchor-backed helpers:

```bash
npm install @dark-null/protocol @coral-xyz/anchor @solana/web3.js
```

## SDK Surface

- `getSdkMetadata()`
- `getIdl()`
- `listInstructionNames()`
- `getInstructionDefinition(name)`
- `getCanonicalArtifacts()`
- `getProofEncoding()`
- `getProgramIdManifest()`
- `findProgramIdEntry(value)`
- `resolveProgramId(value)`
- `resolveNetworkConfig(options)`
- `deriveCanonicalPdas(options)`
- `normalizeBytes32(input)`
- `bytes32ToHex(input)`
- `hexToBytes32(input)`
- `encodeU64PublicInput(value)`
- `encodeBytes32PublicInputParts(input, label)`
- `encodeWithdrawV2PublicInputs(options)`
- `createAnchorProgram(options)`
- `createConnection(rpcUrl)`

## Canonical Integration Surface

- [`../MANIFEST.json`](../MANIFEST.json)
- [`../idl/paradox.json`](../idl/paradox.json)
- [`../src/lib.rs`](../src/lib.rs)
- [`../client/dark_client.py`](../client/dark_client.py)

## Program Setup

```typescript
import {
  createAnchorProgram,
  deriveCanonicalPdas,
  encodeWithdrawV2PublicInputs,
  getProofEncoding,
  resolveNetworkConfig,
  resolveProgramId,
} from "@dark-null/protocol";

const network = resolveNetworkConfig("localnet");
const programId = resolveProgramId("canonicalDevnet");
const proofEncoding = getProofEncoding();
const pdas = await deriveCanonicalPdas();
const withdrawV2Inputs = encodeWithdrawV2PublicInputs({
  commitment,
  nullifier,
  root,
  amount,
  receiverToken,
  mint,
});
const program = await createAnchorProgram({
  anchor,
  provider,
  programId,
});
```

## Canonical Instruction Index

- `initialize`
- `rotate_root_authority`
- `deposit_wsol_and_whisper`
- `update_root`
- `prepare_phantom_withdraw`
- `prepare_phantom_withdraw_v2`
- `burn_and_whisper`

`update_root` in the current source now requires the dedicated `root_authority` PDA and authorized signer path published in [`../idl/paradox.json`](../idl/paradox.json).

`prepare_phantom_withdraw` is intentionally fail-closed because the legacy three-signal proof shape does not bind withdrawal amount or recipient semantics.

`prepare_phantom_withdraw_v2` is the promoted payout-bound instruction shape. Its public inputs are `[commitment, nullifier, root, amount, receiver_token_part_0, receiver_token_part_1, mint_part_0, mint_part_1]`; `amount` is encoded as 24 zero bytes plus `u64_be`, and each token account pubkey is split into two 16-byte chunks left-padded to 32 bytes. The instruction verifies the v2 proof, checks the vault/receiver token accounts, records the nullifier, and transfers from the vault token account.

Historical IDs are still cataloged in [`PROGRAM_IDS.md`](./PROGRAM_IDS.md). Do not hardcode one old ID across every document in the repo.
