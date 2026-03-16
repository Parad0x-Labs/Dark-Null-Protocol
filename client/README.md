# Dark Null Python Client

This directory now carries a **canonical root helper client**, not a toy-root transaction stub.

## Files

- `dark_client.py`: builds canonical proof inputs, Groth16 sections, and Anchor instruction payloads
- `proof_packer.py`: legacy packed-proof helper retained for historical material
- `nebula_core.py`: compression-related logic
- `nebula_v23_full.py`: historical Nebula snapshot
- `pie_cli.py`: CLI entrypoint
- `requirements.txt`: Python dependencies

## What `dark_client.py` Matches

- program ID `2stas3cZYnBiWpndcTXQDGLXwfQ7kjEYYrW52DsUAcxF`
- canonical network config from [`../NETWORKS.json`](../NETWORKS.json)
- canonical root circuit artifacts under [`../circuits`](../circuits)
- canonical root IDL semantics from [`../idl/paradox.json`](../idl/paradox.json)

## Limits

- this is still public source, not a third-party-audited SDK release
- it helps build and verify the canonical root proof path; it does not make the repo audited or mainnet-ready
- older client-side program references remain historical and are tracked in [`../docs/PROGRAM_IDS.md`](../docs/PROGRAM_IDS.md)
- root updates now require the canonical `root_authority` PDA and authorized signer path from [`../idl/paradox.json`](../idl/paradox.json)
