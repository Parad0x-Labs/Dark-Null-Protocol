# Dark Null FAQ

## What is Dark Null in this repo?

Dark Null is a public repository of privacy-settlement research materials for Solana: docs, IDL, interfaces, historical harnesses, and result artifacts.

## Is this a completed third-party-audited product repo?

No. See [`../AUDIT.md`](../AUDIT.md). The repo currently publishes internal review material and historical artifacts, not a completed external audit.

## Why did this repo look like larp before?

Because the public presentation sounded stronger than the public evidence bundle. The repo is being corrected toward explicit, verifiable claims.

## Where are the circuits, proving keys, and relayer source?

Circuit source is now published in [`../circuits`](../circuits), and the Rust core is now published in [`../src`](../src). Relayer operations are still not fully published in this repository.

## Is there a published npm SDK here?

Yes. The root package now exposes a public artifact SDK:

```bash
npm install @dark-null/protocol
```

For Anchor-backed helpers, also install `@coral-xyz/anchor` and `@solana/web3.js`.

## What should I install first?

```bash
sh scripts/bootstrap.sh
```

Then read:

- [`getting-started.md`](./getting-started.md)
- [`PROGRAM_IDS.md`](./PROGRAM_IDS.md)
- [`../VERIFICATION.md`](../VERIFICATION.md)

## How is this related to DNA x402?

Dark Null and DNA x402 are separate. DNA x402 is the fast payment rail; Dark Null is the privacy-settlement research lane.
