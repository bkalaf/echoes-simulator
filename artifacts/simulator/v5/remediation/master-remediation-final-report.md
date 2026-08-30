# Echoes Simulator Master Remediation Final Report

## OPERATIONAL BLOCKERS

PostgreSQL infrastructure preflight: **READY** (DOMAIN_DATABASE_READY). The discovered connection is **Echoes shared PostgreSQL**; shared canonical database reuse is confirmed, manual DATABASE_URL configuration is not required, and no second canonical database was created.

Canonical-domain migration is **READY** with 0 unexplained values. Database infrastructure, canonical migration/reconciliation, and causal authority readiness are separate state machines. SQLite remains the causal event/checkpoint/history store; snapshotted histories do not consult mutable PostgreSQL authority while continuing.

The carried-forward repo-wide cutover gate is **not complete**:

- electron/main.ts still exposes the legacy V4 canonical runner and its bundled canonical filesystem loader
- src/core/canonical/bundled-canonical.ts remains a production V4 filesystem authority loader
- src/core/engine/canonical-runner.ts and canonical-resume.ts still load domain JSON/CSV/ZIP files
- src/core/v5/canonical-adapter.ts remains available for explicit import/test provenance but has zero V5 production call sites

## OWNER POLICY CENTER

52 typed candidate revisions remain independently reviewable. Locked owner structure is displayed without reapproval. Pending policies do not alter database health and block only their first causal consumer.

## BREED / DEITY

The reconciled **BREED_CATALOG_V5** authority exposes all 2,062 stable Breed identities independently of deity assignment. Breed.primaryDeityId reconstruction remains a capability-specific requirement for deity-dependent genesis and religion; it does not hide Breed browsing or Atlas browsing. No assignment was fabricated.

## THREE-WORLD GENESIS

Structural equality and world-neutral hash normalization are implemented. Refuge audit proves 47 base types plus 18 corpus-derived second nodes = 65 per world. Resource absence remains RESOURCE_AUTHORITY_REQUIRED only for Resource-dependent initialization and use.

## FEDERAL VISION

Concord → Crown/Church, Ruin → Intellectual Elite/Hereditary Elite, and Schism → Corporate Actors/Wealth Elite are locked structural inputs. Numeric weights remain candidates. WorldKey cannot salt causal RNG.

## STATES / DYNAMIC ATLAS

Explicit Settlement membership events are the only writers of Settlement.stateId. Influence drives dynamic territory and control. The shared PostgreSQL Atlas inventory is independently available; sibling overlay consumption remains outstanding.

## REFUGES / RESOURCES / ROUTES / POIs

All 47 eligible terminals, MOONLIGHT, selector exclusions, all 14 non-Refuge classifications, approval-gated sustenance, logistics, noncausal Prompt-01 routes, dynamic POI control, aliases, and rename-consequence dimensions are represented. Missing inventories and policies fail closed only at their consumers.

## UI REMEDIATION

Normal startup shows **Canonical Database — Connected — Echoes shared PostgreSQL** and **Database — READY**. Breed Detail and Atlas are available from their independent reconciled/shared authorities. Capability rows disclose unresolved authority and their point-of-use scope; there is no blanket SIMULATOR_CANONICAL_V5 approval blocker and no SEED action that manufactures another review barrier.

## DEROGATORY GROUPS

Three neutral canonical grouping structures and explicit membership review remain separate from the immutable atomic 63-decision protocol. Unreconciled taxonomy blocks taxonomy consumers only.

## ATROCITY SYSTEM

Exactly 18 structural identifiers and 54 world definitions are present. Numeric revisions remain point-of-use candidates; Book/Witness identity remains distinct.

## RELIGION

Settlement worship derives through Breed.primaryDeityId. Religion execution waits for that capability when first consumed; unrelated browsing and mechanics remain available.

## FAMILIES

Normalized Family power dimensions and deterministic causal surfaces are present. Pending Family-related numeric policy is point-of-use authority, not database readiness.

## MIGRATION / INTERMINGLING

Typed transfer and selected-year intermingling contracts require exact conservation. Existing persisted SQLite history remains readable independently of PostgreSQL availability.

## CROSS-WORLD DIVERGENCE

Normalized neutral equality strips identity-only world keys/IDs. Non-neutral fixtures preserve causal divergence without WorldKey RNG salting.

## TEST RESULTS

Shared database discovery: PASS. Database infrastructure: READY. Deterministic accepted-source reconciliation: READY. Unexplained migrated values: 0. Prisma validation, canonical verification, static V5 audit, typecheck, production build, 240 unit tests, and 131 integration tests passed. All 11 rendered Electron scenarios passed, including bounded startup, pre-V5.6 immutable SQLite history, independently available Breed/Atlas pages, Owner Policy Center, live worker responsiveness, and invalid legacy-bundle isolation.

## OWNER ACTIONS STILL REQUIRED

1. **Breed → Deity terminal reconstruction** — complete the authorized external stable-ID workflow for 2,062 assignments. Until then, deity-dependent genesis/religion reports BREED_PRIMARY_DEITY authority unavailable at its first consumer; Breed and Atlas browsing remain available.
2. **Resource and Legendary Reward inventories** — import actual approved identities. Until then only Resource logistics and Keeper creation report their inventory-specific requirements.
3. **Derogatory taxonomy** — decide KEEP/REJECT and memberships in all three structures. The separate 63-decision protocol remains unchanged.
4. **Numeric and semantic policies** — review only revisions needed by the intended horizon. The exact candidates and independent bulk actions are in owner-policy-review.md/json; approval identity, hash, provenance, and default boundary metadata are automatic.
5. **Sibling Atlas consumer** — implement the versioned overlay contract in a separately authorized safe sibling task.
