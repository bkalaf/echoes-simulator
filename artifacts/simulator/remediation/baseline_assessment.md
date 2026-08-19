# Independent remediation baseline

Date: 2026-08-18  
Workspace: `/home/bobby/echoes-simulator` (standalone; not a Git repository)

## Authority and placement

The live Notion `SIMULATOR` page fetched during this run identifies the product as a **standalone external Electron producer**, not a subsystem inside the main application. This agrees with the owner's explicit instruction that the simulator must not be implemented in the monorepo. The remediation pack's `apps/simulator` placement instruction is therefore superseded and will not be executed.

The main repository was inspected read-only at `b503f48a39c6be823fa295c8f2bfb305107e25ef` on branch `main`. It had extensive unrelated modified/untracked work and no `apps/simulator` directory. No repository file was changed.

## Remediation pack integrity

All 12 entries listed in `PACK_MANIFEST.json` match their exact byte counts and SHA-256 values. `PRIOR_CODEX_OUTPUTS.zip` and `echoes_of_eidolon_breed_research_2026-08-17.zip` both pass ZIP integrity testing.

Prior output ZIP SHA-256: `c30b148a1e9b9ddf6ae8afa845f7adaad79904d232a58a9fb438f3d6f777ed5c`.

## Prior implementation reproduced findings

- Eleven test files were present, recording 23 passing tests.
- The prior real preflight reported 2,056 Breeds, 1,773 civic Breeds, 283 PET Breeds, 175 Sites, and 92 POIs.
- It incorrectly treated August 18 remediation plus the legacy CSV as competing/mergeable Breed authority and emitted 233 identity conflicts.
- It reported only 251/1,773 civic personality IDs and zero values for six core governance/economic dimensions.
- It used aggregate/synthetic diagnostic transfers, fixture government/economic forms, aggregate checkpoint digests, an artifact-backed UI, and empty/minimal export datasets.
- Electron E2E did not run and packaging did not complete.
- The prior delivery's own `KNOWN_MISTAKES_FOR_REVIEW.md` confirms these defects and its completion claim is rejected.

## August 17 Breed checkpoint recomputation

- 2,056 unique Breed IDs.
- Population kinds: 631 HUMAN, 961 BEAST, 181 MYTHOS, 283 PET.
- Statuses: 285 `RESOLVED_IMPORTABLE`, 283 `IMPORTABLE_WITH_OPTIONAL_GAPS`, 1,488 `REVIEW_REQUIRED`.
- 7,146 evidence records, 14,522 citations, 23 source records, and 338 trait-research records.
- Its Breed rows contain identity/classification, Traits, and Personality only. They do not contain ecology or the twelve simulator dimensions.
- The status labels are a starting checkpoint, not proof of semantic correctness or research completion.

## Current compatibility registries

- Current personality registry: 369 rows.
- Snapshot SHA-256: `f9a74e1563babc15d86121b5f43246e6d666b6a51736610629acca26d6b7fb38`.
- Current compact Breed-group registry exists at `apps/web/src/data/breed-groups-v3.json` in the read-only application repository.
- Species/Culture identities must be validated from the supplied canonical research registries and current live authority; no legacy semantic value may overwrite V3 research.

## Baseline verdict

The prior implementation is salvageable source only and is not complete. The August 17 checkpoint is the sole starting Breed-values authority, while the August 18 archive is restricted to source leads and the legacy CSV to explicit metadata. Canonical execution is prohibited until a replacement V3 pack passes the adversarial evidence gate and every active initial projection has a nonzero resolved denominator.
