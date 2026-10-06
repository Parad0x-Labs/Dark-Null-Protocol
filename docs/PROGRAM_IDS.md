# Program ID Manifest

The repo has one **canonical root** program ID.

## Canonical Root

| Label | Program ID | Where it appears | Notes |
|---|---|---|---|
| Canonical promoted devnet root | `35GMe13ExGB1JGp1wZGrEvHfQnENKADroDQApeziKuwV` | [`../Anchor.toml`](../Anchor.toml), [`../src/lib.rs`](../src/lib.rs), [`../idl/paradox.json`](../idl/paradox.json), [`../MANIFEST.json`](../MANIFEST.json) | Root integration target |

## Historical References

| Label | Program ID | Where it appears | Notes |
|---|---|---|---|
| Python client snapshot | `3hYWUSYmNCzrHNgsE6xo3jKT9GjCFxCpPWXj4Q4imToz` | old client-era references in history | Historical client-side program reference |

## How to Use This File

1. If you are integrating today, use the canonical root ID.
2. If you are validating historical evidence, use the matching historical ID instead of guessing.
3. Do not claim all IDs are interchangeable.
