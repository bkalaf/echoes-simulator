# Echoes of Eidolon Historical Simulator

Standalone, local-first Electron application for deterministic three-world historical simulation. It does not connect to production services or require an LLM API.

## Development

Requires Node 22 and pnpm 10.

```sh
pnpm install
pnpm verify
pnpm electron:dev
```

Runtime databases live in Electron's per-user `userData` directory. Imported owner artifacts remain external inputs; generated mutable databases and exports are not source files.

Canonical runs fail closed while any required Breed dimension, policy, or naming blocker remains. Complete synthetic runs are always labeled `DIAGNOSTIC`.

## Current verified status

- Standalone product root: `/home/bobby/echoes-simulator`
- Real input structure: PASS
- Canonical readiness: BLOCKED by source identity and raw-dimension/ecology coverage
- Supplemental August 17 Breed research: provenance-only; it does not contain the missing raw simulator dimensions
- Synthetic diagnostic: complete through year 2000 for CONCORD, SCHISM, and RUIN
- Verified export and final evidence: `artifacts/implementation/final-verification/`

The source monorepo is an input/provenance source only. This simulator does not install into or modify it.
