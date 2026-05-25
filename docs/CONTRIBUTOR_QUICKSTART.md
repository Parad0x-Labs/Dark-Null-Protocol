# Contributor Quickstart

This repo is MIT and contributor-facing now. Start with the actual code, not the pitch.

## 1. Bootstrap

```bash
sh scripts/bootstrap.sh
```

## 2. Know the Repo Lanes

- Rust core: [`../src`](../src)
- Circuits: [`../circuits`](../circuits)
- Python client: [`../client`](../client)
- JavaScript SDK: [`../sdk`](../sdk)
- Public interfaces: [`../idl`](../idl), [`../interfaces`](../interfaces)
- Historical harnesses: [`../tests`](../tests)

## 3. Run What You Can

```bash
npm run test:all
```

## 4. Keep the Bar High

- no placeholder audit language
- no private keys or local machine paths
- no build trash
- no contributor-hostile pitch-deck fluff
