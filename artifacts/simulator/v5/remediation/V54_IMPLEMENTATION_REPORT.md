# Echoes Simulator V5.4 Implementation Report

## Implementation status

The V5.4 historical-dynamism implementation is present in the working tree with `echoes-scheduler-v5.4.0`, `echoes-mechanics-v5.4.0`, and `echoes-read-model-v1.2.0`. `echoes-derived-metrics-v1.1.0` is unchanged because this pass did not alter the existing canonical serialization, checkpoint/event hashing, derivation formula, or derivation-registry contract.

Implemented areas include point-of-use candidate-policy blocking, exact targeted population partitions, the 63-decision SELECT/KEEP/REPLACE protocol, resource geography, 40 bounded industries, Guilds, civic capacity, unified security forces, diplomacy and typed conflict actions, occupation distinct from legal membership, the ordered 18-slot Witness registry, typed atrocity effects, local responses, forced displacement, Enclaves, private/public historical exports, SQLite decision authority, v5.3 read-only compatibility projection, and the six historical operator surfaces.

The complete pre-V5.4 dirty-tree inventory is preserved in `v54-preimplementation-dirty-worktree.json`. No reset, stash, commit, push, PR, live-database migration, or production naming/Derogatory decision was performed.

## Verification status

- PASS: TypeScript typecheck.
- PASS: static V5 closure/naming/registry audit; 45 causal files and 43 durable writers inspected with zero audit failures.
- PASS: 25 focused V5.4 fixtures and 11 SQLite authority fixtures, 36/36 tests.
- PASS: complete integration suite, 42 files and 121/121 tests.
- PASS: production build.
- PASS: targeted Electron/Playwright operator test, including all new V5.4 views and the Witness slots.
- PASS: `git diff --check` at the last completed check.
- BLOCKED OUTSIDE V5.4: the full unit suite and `pnpm verify` stop on four read paths because the Git-clean V3 Breed-deity authority declares `breedCount: 2062` but contains 2,063 `assignmentDeityIndex` entries. The fail-closed loader was not weakened and canonical authority was not edited.
- FAIL: the bounded year-285 acceptance harness. Its persisted temporary-database execution reached `COMPLETE/285`, but the monolithic uninterrupted/replay comparison did not finish within two hours and exposed no phase telemetry. It was terminated with exit 130 at owner direction. State, event-history, decision-stream, and population-partition equality therefore remain unproven by that run. See `v54-integration-acceptance.json`.
- NOT CLAIMED: live main/WAL/SHM non-mutation fingerprint equality. The terminated harness had not yet written its before/after evidence artifact, so this report does not convert the implementation's temporary-path isolation into a completed fingerprint proof.

## CANONICAL DATA GAPS

- The V3 Breed-deity authority count mismatch must be resolved by its owner: 2,062 declared Breeds versus 2,063 assignment indices.
- Structured predicates marked `NOT_READY` require canonical predicate authority before they can be selected.
- All five V5.4 candidate policy documents remain diagnostic candidates, not owner-approved canon.
- Canonical Witness shock definitions and trigger years have not been supplied; all 18 structural slots remain `NOT_CONFIGURED` by default.

## EXTERNAL LLM DECISIONS

- Canonical histories require complete immutable 63-decision batches at years 15, 150, 250, 350, and later century reviews as reached.
- Year 15 requires `SELECT`; later reviews require `KEEP` or a different-group `REPLACE`.
- The year-15/150/250 responses used by the failed acceptance were isolated fixtures and are not historical authority.
- Optional Enclave, Guild, and other production names remain external `BATCHED` decisions; no local names were synthesized.

## HISTORICAL CONTENT

- No missing atrocity was configured or invented. The year-20 Witness 17 shock used in acceptance was an isolated fixture only.
- The embargo and siege used in acceptance were isolated mechanics fixtures, not canonical historical claims.
- No canonical Derogatory selection, historical persecution program, war, conquest, treaty, Enclave, or naming response was created by this pass.

## MECHANICS POLICY

- Candidate resource/industry, civic/security, diplomacy/conflict, Derogatory slicing, and persecution/displacement/Enclave documents are individually opt-in for diagnostic runs and fail closed at point of use for canonical runs.
- Policy blockers retain the full policy document and values, SHA-256, operation, world/year/entity context, and approval mechanism. The interrupted year is not persisted.
- Forced displacement remains separate from voluntary migration and does not alter the accepted voluntary-migration threshold or the 65/25/10 diagnostic target.
- The failed acceptance harness must be replaced before rerun with checkpoint-segment verification, explicit per-phase/year telemetry, resumable stages, and a hard runtime budget. It must not block operator use while replay evidence is calculated.
