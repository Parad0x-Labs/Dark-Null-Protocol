# Contributing to Dark Null Protocol

Thanks for contributing. Keep the repo more rigorous and more reproducible than you found it.

## Contribution Areas

PRs are welcome for:

- Rust core code in [`src/`](./src)
- Circom source in [`circuits/`](./circuits)
- Python clients in [`client/`](./client)
- docs, IDL, and interface clarity
- reproducibility tooling
- repo consistency checks

## Current Repo Boundary

This public tree now includes real core source, but it still does **not** include every operational layer or every historical app wrapper that existed outside the repo.

If future relayer, wallet, or extension source drops happen, they should land as real source with cleanup, not as mystery archives or build trash.

## Local Setup

```bash
sh scripts/bootstrap.sh
```

## Validation

Run what is available in your environment:

```bash
npm test
python3 -m py_compile client/*.py
cargo test
```

If your machine does not have the Rust or Python dependencies needed for the last two commands, say so in the PR or commit notes instead of claiming they passed.

If you touch docs that reference deployments, also update:

- [`docs/PROGRAM_IDS.md`](./docs/PROGRAM_IDS.md)

## PR Rules

1. Keep claims defensible from the public repo.
2. Do not add placeholder audit language.
3. Do not add local machine paths, secrets, or private infrastructure details.
4. Do not commit build outputs, key material, `target/`, or `node_modules/`.
5. Update docs when behavior or repo scope changes.

## Commit Style

Use concise commit messages that explain the actual change:

- `docs: tighten public verification guide`
- `chore: add public repo consistency checks`
- `feat: publish recovered rust core`
