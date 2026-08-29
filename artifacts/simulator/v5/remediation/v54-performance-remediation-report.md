# ROOT CAUSES

The pushed V5.4 fixture performed a complete three-world clone in the annual path, repeatedly rescanned expanding collections inside Settlement and entity loops, ran non-causal divergence work annually, canonicalized checkpoints more than once, and compressed checkpoints at gzip level 9. SQLite also stored full event JSON plus a redundant replay index. The retained pushed run took 3,111,000 ms, persisted 586,982 events, and occupied 961,744,896 main-database bytes plus 38,678,592 WAL bytes.

# ENGINE HOT PATH

The runner now advances one per-world candidate at a time and commits only after all three worlds succeed. Committed state is deeply frozen, callbacks receive a runtime read-only view without another state clone, and a failed `PolicyAuthorityRequiredV5` year cannot mutate or persist the prior committed year.

Deterministic ephemeral annual indexes cover Settlements, States, Sites, Cohorts, populations, population slices, resources, Institutions, Organizations, offices, terms, SecurityForces, and routes. Civic/security, industry, chamber, derivation, social-mobility, family/Organization review, and migration paths use indexed lookups and stable identity ordering. The bounded year-240 to year-245 continuation completed in 16,986.45 ms. Its largest measured phases were migration, social mobility, audit validation, population-slice reconciliation, Organization review, and Family review.

# PERSISTENCE HOT PATH

Each three-world year is persisted in one SQLite transaction, including events, checkpoints, diagnostics, and the run marker. Partial or failed-year tails are rejected on resume. Event JSON is canonicalized once, reused for hashing, compressed with deflate level 1 for storage, and decoded before replay hashing; the canonical event contract is unchanged. The redundant replay index was removed.

The pushed run did not retain per-band phase telemetry, and the first completed remediated run's full timing sample array was overwritten during recovery from its initial post-verification timeout. The coordinator now preserves prior timing artifacts when a completed Stage A is resumed without new timing samples. `v54-phase-profile.json` therefore reports the bounded late-history engine profile; it does not claim unavailable full-run persistence-phase timing.

# EVENT VOLUME

The pushed fixture contains 586,982 events and 498,108,821 logical event-JSON bytes. The dominant records are `TierMobilityTransfer` (406,346; 321,341,726 JSON bytes), `FoundingTransfer` (160,234; 157,074,887 bytes), and `OfficeholderSelected` (7,856; 10,930,934 bytes). These were classified as required causal transitions and were not deleted or coalesced.

`CausalInvariantAuditPassed` is classified as diagnostic-only (855 records). Removing it would change `eventHistoryHash`, so that causal-boundary change was not implemented. The remediated correctness fixture persists 653,980 events because it adds explicit Security Organization/control transitions and exercises conquest/treaty integration; event count is not presented as a causal-equivalence comparison.

# CHECKPOINT OPTIMIZATION

Checkpoint creation now computes canonical bytes once, hashes those exact bytes, and compresses the same bytes. The state-hash contract is unchanged. On representative year-100 and year-285 states totaling 94,227,284 uncompressed bytes, gzip 3 took 418.93 ms and produced 6,331,693 bytes; gzip 9 took 1,841.52 ms and produced 5,054,559 bytes. Level 3 was selected: 22.75% of level-9 compression time for 125.27% of its size. Decompression restored byte-identical canonical state at every tested level. New and legacy-restored operational configuration defaults to level 3; compression and divergence cadence are excluded from the causal mechanics identity.

# SEGMENTED REPLAY

Stage B verified all 39 required checkpoint boundaries. Stage C exactly matched state hash, full event-history hash, incremental event-history hash, and population-partition hash for ten segments from year 0 through year 250. The 250-275 and 275-285 segments and the independent 100-150 multi-checkpoint chain were not completed before the 1,800,000 ms total acceptance budget. Stage C is FAIL, not PASS; Stages D-F remain pending. No second complete 0-285 history was run.

# CONQUEST / CHAMBER CORRECTION

The deterministic integration fixture passes. Occupation changes operational control while retaining legal State membership and the existing Conclave jurisdiction. Explicit conquest emits `StateMembershipChanged`, retires the prior Conclave seat, materializes the new State's seat, and creates a valid replacement term. A later selection/expiration cycle succeeds. Explicit treaty membership reverses legal membership, reactivates the prior seat, retires the replacement, and retains a valid aggregate source.

# SECURITY FORCE / ORGANIZATION INTEGRITY

All seven force types are modeled by distinct durable Organization types and covered by formation, control, naming, checkpoint, command-decapitation, defection, dissolution, and zero-personnel lifecycle fixtures. The year-285 persisted checkpoints contain 2,065 Organizations and 931 SecurityForces. All 931 forces reference existing, type-compatible Organizations; all Organization, ownership-stake, force-controller, jurisdiction, and officer references pass validation. Dangling Organization references: 0. Invalid controller references: 0. Organization identity remains after force degradation or dissolution.

# 285-YEAR PERFORMANCE

The single persisted three-world year-285 run reached the final persisted callback in 886,318.289502 ms (14 minutes 46.318 seconds), passing the 900,000 ms target. The pushed fixture took 3,111,000 ms (51 minutes 51 seconds), so measured elapsed time fell 71.51%. Post-execution verification took an additional 32,004.09 ms and is reported separately.

# STORAGE

The remediated temporary database is 692,011,008 bytes with a zero-byte closed WAL, compared with 1,000,423,488 pushed main-plus-WAL bytes, a 30.83% reduction. It contains 286,169,500 compressed event-payload bytes, 46,613,865 checkpoint bytes, and 441,235 diagnostic bytes. This is 2,428,108.8 database bytes per simulated year, 1,058.15 database bytes per causal event, and 971,122.19 payload bytes per checkpoint. No historical event was deleted to obtain this reduction. Live database fingerprints match byte-for-byte before and after remediation evidence collection.

# CAUSAL EQUIVALENCE

Industry, social-mobility, population-slice, temporal-event, callback, rollback, and checkpoint tests compare optimized results against pre-index/reference behavior. The year-240 to year-245 profile reproduced the previously recorded state and incremental event hashes for all three worlds. Ten replay segments through year 250 matched state, event-history, decision-stream continuation, and population partitions.

No complete pushed-versus-remediated final hash equality is claimed because the required SecurityForce/Organization and conquest/treaty corrections intentionally add causal state and events. The retained performance run also predates the final loader-boundary correction that removed two non-causal configuration keys accidentally placed in its mechanics object. Those keys were not read by mechanics, so state/event evidence remains valid, but its persisted `causalRunHash` is explicitly marked interim; a final normalized year-285 causal-run hash was not re-executed.

# BREED-DEITY BLOCKER

The fail-closed loader remains unchanged. Canonical Breed count is 2,062 with no duplicate Breed IDs. The positional assignment array has 2,063 entries. The first divergence is the unbound extra assignment at zero-based position 2,062, deity index 25 (`Vhalen`). The authority has no per-assignment Breed IDs, so no evidence identifies which assignment an owner should remove. The diagnostic reports `EXTRA_ASSIGNMENT`, no catalog-order mismatch, and `NOT_AUTHORIZED` for removal.

# TEST RESULTS

- `pnpm typecheck`: PASS.
- `pnpm audit:v5`: PASS; 47 causal files, 43 durable writers, no failures, no local naming synthesis.
- Focused remediation, Organization, conquest, callback/rollback, short multiworld, SQLite, persistence, and export tests: 88/88 PASS.
- Short V5 architecture, Prompt-00, Prompt-01, and persisted-export pass: 43 PASS, 1 expected FAIL from the independent Breed-Deity authority mismatch.
- `pnpm canonical:verify`: PASS for the canonical bundle (6,039 records; 2,062 Breeds).
- `git diff --check`: PASS.
- Playwright: not run because no renderer behavior changed.
- Full segmented historical acceptance: FAIL due total runtime budget; stages A and B PASS, C FAIL after ten exact segments, D-F pending.

# REMAINING ISSUES

The complete segmented acceptance does not meet the 30-minute target. Two replay segments, the independent chain, export/redaction, final storage-stage execution, and coordinator live-fingerprint Stage F remain incomplete. The full persisted run's phase samples were not retained, so only bounded late-history engine timings and separate checkpoint-compression measurements are available. The final normalized `causalRunHash` has not been proven by another year-285 persisted run. The Breed-Deity positional authority requires owner/source evidence. No 2,000-year benchmark was run.
