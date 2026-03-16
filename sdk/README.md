# Dark Null JavaScript SDK Surface

The root npm package now targets the **canonical promoted root track** first.

## Install

```bash
npm install @dark-null/protocol
```

If you want the Anchor helpers too:

```bash
npm install @coral-xyz/anchor @solana/web3.js
```

## What It Exposes

- canonical root IDL access
- canonical and historical program ID manifest helpers
- canonical devnet/localnet config helpers
- canonical vault / root-authority PDA helpers
- instruction metadata helpers
- bytes32 normalization helpers
- optional Anchor and web3 connection helpers

## Default Program ID

The canonical manifest key is `canonicalDevnet`, which resolves to:

`2stas3cZYnBiWpndcTXQDGLXwfQ7kjEYYrW52DsUAcxF`

## Start Here

- [`../README.md`](../README.md)
- [`../MANIFEST.json`](../MANIFEST.json)
- [`../NETWORKS.json`](../NETWORKS.json)
- [`../SECURITY_MODEL.md`](../SECURITY_MODEL.md)
- [`../docs/getting-started.md`](../docs/getting-started.md)
