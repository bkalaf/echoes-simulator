# Echoes of Eidolon simulator Breed-research remediation report

Status: **PARTIAL / CANONICAL EXECUTION BLOCKED**

## Outcome

The implementation remains a standalone product at `/home/bobby/echoes-simulator`. The monorepo was read only and was not modified.

The supplied remediation pack and both embedded ZIPs were independently hashed and validated. The August 17 archive is now the only Breed identity/research starting authority; the August 18 archive is source leads only; the legacy CSV is metadata only. The false competing-authority merge behavior was removed.

An executable V3 queue was generated for all 2,056 Breeds and all 18 required research fields:

- 37,008 total tasks;
- 3,679 PET policy nulls;
- 33,329 initially unresolved tasks;
- 13 fresh terminal regression results backed by newly opened sources;
- 33,316 unresolved tasks remain after those partial results.

The August 18 source-lead archive was independently rejected as semantic authority: 2,053/2,056 rows are `REVIEW_REQUIRED`, 20,427/24,672 dimension rows are unresolved, 849 are authored inference, and 35,889/35,889 citations lack a bounded-context field.

## Implemented remediation

- V3 field/disposition contract and exact 37,008-task queue.
- Systemic adversarial audit and mandatory-regression census.
- Fresh source-backed corrections for goat, sheep, Flowerhorn, Iranian terrain breadth, Malayan tapir, aardvark, Australian lungfish, banded mongoose, African manatee, and Alpine ibex cases.
- Exact 1,773-civic-Breed, 2,000,000-person world initializer with PET and R10 exclusion.
- Per-cohort BigInt growth.
- Simultaneous capped transfers with migrant-only wealth reset and retained-cohort wealth preservation.
- Whole-Sovereign-Breed DJT relocation, seized-city displacement, conservation, and five-year quarantine metadata.
- Wealth-ranked, population-weighted Social Tier/Class segmentation with boundary cohort splits.
- Projection separation of resolved, terminal-null, and invalid/unresearched population plus exact zero-denominator blockers.
- Full-state hash-verified replay checkpoint helpers.
- SQLite checkpoint persistence, restart-safe naming barriers, rejected-attempt preservation, and exactly-once atomic name acceptance/resume.
- File-relative Vite assets and Electron `loadFile` startup, preventing the production `file://` blank-page failure.
- Electron launch E2E specification.

## Verification

`pnpm verify` passes: 32 unit tests, 5 integration tests, both TypeScript checks, deterministic-randomness scan, Node build, and renderer build.

Electron launch E2E passes outside the restricted Chromium sandbox. Linux directory packaging also passes and produces `dist/linux-unpacked`.

## Canonical decision

Canonical execution was correctly refused. A diagnostic run was not substituted. No canonical export was generated. See `KNOWN_REMAINING_BLOCKERS.md` for the exact incomplete scope.
