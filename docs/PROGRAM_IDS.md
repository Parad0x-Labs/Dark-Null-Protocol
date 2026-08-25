# Program ID Manifest

Dark Null still contains historical devnet evidence, but the repo now has one **canonical root** program ID.

## Canonical Root

| Label | Program ID | Where it appears | Notes |
|---|---|---|---|
| Canonical promoted devnet root | `35GMe13ExGB1JGp1wZGrEvHfQnENKADroDQApeziKuwV` | [`../Anchor.toml`](../Anchor.toml), [`../src/lib.rs`](../src/lib.rs), [`../idl/paradox.json`](../idl/paradox.json), [`../MANIFEST.json`](../MANIFEST.json) | Root integration target |

| Legacy promoted root (superseded) | `2stas3cZYnBiWpndcTXQDGLXwfQ7kjEYYrW52DsUAcxF` | historical evidence branches | Superseded by the canonical root above |

## Historical References

| Label | Program ID | Where it appears | Notes |
|---|---|---|---|
| V20 optimistic claim prototype | `AeinEiBRodoCLJwdiXNd2fWXM49cByxhCsLW8DyRqCVe` | [`../tx/devnet_links.md`](../tx/devnet_links.md), [`../CHANGELOG.md`](../CHANGELOG.md) | Historical v1.22 claim-window materials |
| V17 historical deployment | `Ajdw9GaNN39P9mj6uqiAxAnYRS4wC1rQh2C7wguvJArB` | [`../env.example.txt`](../env.example.txt), [`../CHANGELOG.md`](../CHANGELOG.md) | Legacy reference |
| V18 interface/docs track | `7niGgy3EBVZtFjY1Gjx2hoeNHzeiJER76sEVhd4S5p6w` | archived docs-track materials | Historical interface-oriented references |
| January 11, 2026 full-cycle artifact bundle | `33Uw9kiVRrn6wVmR439gA9QWh4MLv87N97taj2sLrkE4` | [`../LIVE_TEST_RESULTS.md`](../LIVE_TEST_RESULTS.md), [`../full_cycle_results.json`](../full_cycle_results.json), full-cycle harnesses | Historical full-cycle evidence bundle |
| Python client snapshot | `3hYWUSYmNCzrHNgsE6xo3jKT9GjCFxCpPWXj4Q4imToz` | old client-era references in history | Historical client-side program reference |

## How to Use This File

1. If you are integrating today, use the canonical root ID.
2. If you are validating historical evidence, use the matching historical ID instead of guessing.
3. Do not claim all IDs are interchangeable.
