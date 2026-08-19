# Known mistakes and incomplete work for the next reviewing prompt

This document records defects in the Codex implementation as delivered. The implementation has **not** been corrected after these defects were identified.

## Primary authority mistake

The owner supplied `echoes_of_eidolon_breed_research_2026-08-17.zip` for the needed Breed values and intended it to be the sole source for those Breed values.

Codex did not follow that instruction. It instead:

1. treated the supplemental ZIP as provenance-only;
2. continued using the August 18 remediated Breed archive and legacy Breed CSV from the implementation pack;
3. merged and compared those sources;
4. generated a `BREED_IDENTITY_CONFLICT` blocker from disagreements between sources that should not have been combined as competing Breed authorities;
5. generated coverage conclusions, readiness evidence, diagnostic provenance, and export metadata from that incorrect authority model; and
6. reported the implementation as completed despite this foundational input-authority error.

The supplemental ZIP itself was validated and found to contain 2,056 Breed classification rows, but Codex's conclusion that it could not supply the required values was based on the simulator field model Codex had already adopted from the other sources. That conclusion must be independently reassessed by the next reviewer against the original prompt and owner instruction.

## Implementation areas that were overclaimed or remain incomplete

- The synthetic diagnostic runner is not a complete implementation of the specified canonical historical model. It uses simplified diagnostic fixtures and aggregate or synthetic behavior.
- Breed/cohort population histories are not fully modeled. The diagnostic runner primarily maintains Settlement totals and aggregate world totals.
- Migration is a simplified fixed diagnostic transfer rather than the complete Breed/faction/property-driven algorithm required by the plan.
- Founding and DJT transfers are simplified diagnostic transfers and do not implement the full Breed-level selection and movement contract.
- Government and economic epochs in the diagnostic run use fixture labels rather than being fully derived from live Breed dimensions and mappings throughout history.
- `annual_state_summaries.jsonl` is exported empty.
- Several other exported projections are minimal, synthetic, or empty despite their paths being present.
- Checkpoints contain aggregate totals and Settlement population digests, not complete replayable world/cohort state.
- No complete checkpoint replay reconstruction test was implemented.
- The naming engine has deterministic job/response validation, but the full run pause/export/import/resume naming barrier was not integrated end to end.
- The SQLite store exists, but the diagnostic runner, desktop workflow, and export pipeline are not fully integrated through persisted run state.
- The desktop Runs screen does not implement genuine create/open/resume/archive/delete workflows over SQLite.
- Pause/resume and committed-history immutability are not implemented end to end in the UI.
- The historical browser is largely an artifact-backed operator presentation, not a paginated query layer over complete persisted year-specific history.
- Settlement and State detail screens display placeholders for several required data tables and histories.
- Event export normalization is manually checked; comprehensive JSON Schema validation of every exported record type was not implemented.
- The export includes a schema set that is not a complete schema definition for every exported file type.
- No Electron end-to-end test was completed.
- Live visual UI inspection was not completed because no browser backend was connected.
- Electron directory packaging did not complete. `electron-builder` accepted the cached Electron runtime but failed while capturing pnpm's dependency tree.
- The implementation workspace is not a functioning Git repository, so no commit history or repository-state evidence exists for this work.

## Verification that did run

The recorded 23 tests, TypeScript checks, deterministic-randomness scan, renderer build, and ZIP checksum/consumer checks did run successfully. Those tests prove only the behaviors they cover; they do not cure the authority mistake or the incomplete requirements listed above.

## Review instruction

Treat all implementation conclusions about Breed authority, Breed coverage, canonical blockers, readiness, and generated diagnostic/export provenance as suspect. Start from the original implementation pack, the answered owner decisions, and the owner's instruction that the supplemental ZIP is the sole Breed-values source. Do not assume Codex's current merge or field interpretation is valid.
