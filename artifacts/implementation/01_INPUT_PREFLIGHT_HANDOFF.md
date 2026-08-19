# Tranche 01 — Input and Readiness Handoff

## Import contract

- Validates all six pack artifacts by exact SHA-256.
- Rejects ZIP traversal and verifies every remediation-internal checksum before parsing.
- Requires 2,056 unique one-to-one Breed IDs.
- Remediated semantic fields win even when null/empty; legacy input is whitelisted to metadata only.
- Loads 175 Sites, 92 POIs, 175 rollups, 72 non-R10 B/H/M group assignments, and preserves R10 as physical-only at year 0.
- Owner decision policy is versioned separately at `resources/policies/owner-policy-2026-08-18-v1.json`.
- Current 369-row Personality Expression registry is snapshotted with SHA/source provenance; runtime does not require the source repository.

## New supplemental research ZIP

- File: `echoes_of_eidolon_breed_research_2026-08-17.zip`
- Bytes: 1,101,481
- SHA-256: `7d6b1651472a504ce861bf031f89a582df3a8ad06b3417a7d38436bcae7a9033`
- Internal files/checksums: 15/15 pass.
- Breed rows: 2,056.
- Raw property dimensions/ecology fields: zero; provenance-only.
- It contains 256 personality values, but 191 of those were rejected/null in the newer August 18 semantic remediation and 53 overlapping values changed. It therefore does not overwrite the remediated source.

## Actual real-data readiness

- Structural import: PASS.
- Civic Breeds: 1,773; PET identities: 283, excluded from civic divisor by owner policy.
- `personalityId`: 251 resolved / 1,522 unresolved (retained for provenance; faction policy now derives from complete raw property values when available).
- `terrainBroad` and `terrainSpecific`: 291 resolved / 1,482 unresolved each.
- `structureOrientation`, `administrationMode`, `ownershipMode`, `allocationMode`, `legitimacyBasis`, `authoritySource`: 0 resolved / 1,773 unresolved each.
- Cross-source conflicts: 231 `groupId` and 2 `cultureId`; surfaced as `BREED_IDENTITY_CONFLICT`, never silently overwritten.
- CANONICAL readiness: BLOCKED by identity conflicts, raw-dimension coverage, and terrain coverage.
- DIAGNOSTIC initialization total under owner PET decision: exactly 2,000,000 per world.

The machine-readable report is `artifacts/implementation/real-input-preflight.json`.

## TDD evidence

- RED: importer/preflight test modules absent (2 failing suites).
- First GREEN candidate correctly exposed 231 previously undocumented group identity conflicts instead of hiding them.
- GREEN: merge/safety and full real preflight — 2 files, 3 tests passed.
- Both renderer and Node TypeScript configurations pass after importer implementation.
