# Echoes Simulator Master Remediation Final Report

## OPERATIONAL BLOCKERS

PostgreSQL preflight: **NOT_CONFIGURED** (DATABASE_URL_NOT_CONFIGURED). V5.6 causal creation is PostgreSQL-only and resume/replay uses immutable snapshotted typed content. SQLite commits survive projection failure and the idempotent catch-up runner advances the common watermark only after an atomic projected year succeeds.

The carried-forward repo-wide cutover gate is **not complete**:

- electron/main.ts still exposes the legacy V4 canonical runner and its bundled canonical filesystem loader
- src/core/canonical/bundled-canonical.ts remains a production V4 filesystem authority loader
- src/core/engine/canonical-runner.ts and canonical-resume.ts still load domain JSON/CSV/ZIP files
- src/core/v5/canonical-adapter.ts remains available for explicit import/test provenance but has zero V5 production call sites

## OWNER POLICY CENTER

27 typed candidate revisions are available with values, hashes, units, ranges, consumers, provenance, effective boundaries, and review actions. No candidate was silently approved.

## BREED / DEITY

The positional V3 vector is rejected. Audit history identifies 2,063 positional values for 2,062 Breed identities and no stable-ID V3 evidence corpus. Production requires Breed.primaryDeityId → Deity.deityId, exact 2,062/2,062 decision provenance, FK validation, and NOT NULL. The terminal external reconstruction remains unresolved; no assignments were fabricated.

## THREE-WORLD GENESIS

Structural equality and world-neutral hash normalization are implemented. Refuge audit proves 47 base types plus 18 corpus-derived second nodes = 65 per world. Live genesis remains blocked by PostgreSQL/Breed authority; Resource absence remains RESOURCE_AUTHORITY_REQUIRED rather than an empty canon.

## FEDERAL VISION

Concord → Crown/Church, Ruin → Intellectual Elite/Hereditary Elite, and Schism → Corporate Actors/Wealth Elite are locked structural inputs. Numeric weights remain candidates. WorldKey cannot salt causal RNG.

## STATES / DYNAMIC ATLAS

Explicit Settlement membership events are the only writers of Settlement.stateId. Influence drives dynamic territory and control. The 25:15 boundary, deterministic ties, topology validators, selected-year overlay schema, freshness, and stable hashes are implemented. Sibling consumption remains outstanding.

## REFUGES / RESOURCES / ROUTES / POIs

All 47 eligible terminals, MOONLIGHT, selector exclusions, all 14 non-Refuge classifications, approval-gated sustenance, Refuge production/replenishment, Resource yield/depletion, Quartermaster intake/storage/throughput/loss/delivery, deterministic assignment terms, noncausal Prompt-01 routes, dynamic POI control, alias-preserving rename decisions, and ten typed political/history consequence dimensions are represented. Missing inventories and policies fail closed only at their consumers.

## UI REMEDIATION

The complete stable-ID Breed selector and Owner Policy Center are wired. Normal operator rows render typed human-readable fields; raw serialized payloads are restricted to developer/audit context. Rendered immutable-snapshot and no-database blocker evidence passed; live PostgreSQL-backed rendered acceptance still requires a READY database.

## DEROGATORY GROUPS

Three neutral canonical grouping structures and explicit membership review are implemented without collapsing the domain to three groups. Legacy taxonomy stays LEGACY_UNTRUSTED_TARGET_TAXONOMY. The atomic 63-decision protocol and cadence remain independent and immutable.

## ATROCITY SYSTEM

Exactly 18 structural identifiers and 54 world definitions are present, each with narrative/downstream and numeric-policy forms. Book/Witness identity is separate. Poisoned-well and Ruin-literacy fixtures are present but numeric execution correctly waits for approved policies.

## RELIGION

Settlement worship derives only through Breed.primaryDeityId. Per-Deity/world Temple and Shrine cardinality and the approved Pantheon-center structural selection algorithm are implemented under PantheonCenterDesignation; Pantheon Seat remains provisional.

## FAMILIES

Normalized Family power dimensions and deterministic causal surfaces are present. A READY canonical run is still needed for bounded live acceptance.

## MIGRATION / INTERMINGLING

Typed transfer and selected-year intermingling contracts require exact conservation. Live non-neutral evidence remains blocked by missing causal authority.

## CROSS-WORLD DIVERGENCE

Normalized neutral equality strips identity-only world keys/IDs. A non-neutral fixture proves semantic differences remain divergent. Live migration/route divergence acceptance is pending a READY run and approved policies.

## TEST RESULTS

The artifact generator validated 54 atrocity definitions, the 25:15 split, deterministic control ties, closed topology, deterministic Atlas hashing, 2,062 Breed food rows, 18 data-derived second Refuge nodes, neutral equality, and non-neutral semantic divergence. Bounded repository verification passed Prisma format/validate/generate, V5 architecture audit, typecheck, production build, 226 unit tests, and 126 runnable integration tests; 3 PostgreSQL integration tests were skipped because DATABASE_URL is absent. The five focused Electron scenarios passed across the final no-database/snapshot evidence runs; no broad calibration was run.

## OWNER ACTIONS STILL REQUIRED

1. **PostgreSQL authority activation**
   - What needs approval/action: configure the intended PostgreSQL database, apply additive migrations, import canonical typed values, and explicitly approve their exact revisions.
   - Exact candidates: SIMULATOR_CANONICAL_V5 and BREED_PRIMARY_DEITY typed revisions; current database state is NOT_CONFIGURED.
   - Why it matters: new V5 causal runs may consume only snapshotted PostgreSQL authority.
   - If unapproved: new V5 causal run creation remains disabled; existing immutable runs remain readable from snapshots.
   - Exact action: run `pnpm db:bootstrap`, then `pnpm db:doctor`; in the Owner Policy Center approve only reviewed candidate revisions.

2. **Breed → Deity terminal reconstruction**
   - What needs approval/action: complete the external stable-ID semantic-decision workflow for exactly 2,062 Breed IDs and approve the returned revision.
   - Exact candidates: no local assignments are proposed; each audit-listed Breed requires exactly one valid Deity stable ID plus provider, model, request, response, and evidence hashes.
   - Why it matters: religion and new causal run genesis require the direct Breed.primaryDeityId FK.
   - If unapproved: Breed/Deity preflight remains SEED_REQUIRED and dependent causal operations do not start.
   - Exact action: export the stable-ID batch with `pnpm audit:breed-deity`, complete the authorized external workflow, import the reviewed response, then rerun the audit and approve BREED_PRIMARY_DEITY.

3. **Resource and Legendary Reward inventories**
   - What needs approval/action: import actual approved inventories; do not approve an empty placeholder.
   - Exact candidates: Resource = no local inventory candidate; LegendaryRewardItem = no local item or holder candidate. Quartermaster assignment candidate requires eligibility, control/jurisdiction, route/access, capacity priority, reassignment, and stable-ID final tie-break.
   - Why it matters: Resource genesis/logistics and Keeper offices require real durable identities.
   - If unapproved: Resource consumers report RESOURCE_AUTHORITY_REQUIRED; Keeper creation reports LEGENDARY_REWARD_INVENTORY_REQUIRED; unrelated subsystems continue.
   - Exact action: import the approved inventories, then Owner Policy Center → RESOURCE_QUARTERMASTER_ASSIGNMENT_POLICY → EDIT AS NEW REVISION → fill every rule → APPROVE.

4. **Derogatory taxonomy**
   - What needs approval/action: name all three canonical grouping structures and decide every candidate Group's membership in every structure.
   - Exact candidates: three neutral slots CANONICAL_STRUCTURE_1, CANONICAL_STRUCTURE_2, CANONICAL_STRUCTURE_3; each of 28 listed Group IDs needs MEMBER or NOT_MEMBER. No names or memberships are locally proposed.
   - Why it matters: target predicates cannot rely on the untrusted legacy taxonomy.
   - If unapproved: taxonomy-dependent targeting waits; the independent 63-decision protocol and accepted history remain unchanged.
   - Exact action: Owner Policy Center → DEROGATORY_TAXONOMY → EDIT AS NEW REVISION → enter three names and all memberships → APPROVE.

5. **Numeric and semantic policies**
   - What needs approval/action: review every candidate actually needed by the intended causal horizon.
   - Exact candidates:
- ATROCITY_17_AB_SCHEDULE: {"ATROCITY_17_A":50,"ATROCITY_17_B":75}
   - ATROCITY_CONCENTRATION: {"status":"OWNER_VALUES_REQUIRED","structuralConstraints":["one common approved harm-share revision","unique harmed is counted once"]}
   - ATROCITY_HARM_PROFILES: {"status":"OWNER_VALUES_REQUIRED","structuralConstraints":["all shares are of unique harmed","each profile sums to 100 percent","secondary effects cannot inflate unique harmed"]}
   - ATROCITY_HARM_SHARE: {"targetHarmSharePpm":100000}
   - ATROCITY_MORTALITY_DISPLACEMENT: {"status":"OWNER_VALUES_REQUIRED","structuralConstraints":["mortality and displacement are not synonyms for total harm","overlapping secondary effects are tracked separately"]}
   - ATROCITY_PERSISTENCE: {"status":"OWNER_VALUES_REQUIRED","structuralConstraints":["fear/compliance remains separate from grievance/unrest","durable cultural memory is append-only"]}
   - ATROCITY_SPILLOVER: {"status":"OWNER_VALUES_REQUIRED","structuralConstraints":["scapegoating remains distinct from direct harm","secondary overlaps do not inflate unique harmed"]}
   - CLASS_POLICY: {"contextModifiers":{},"schemaVersion":"echoes-class-policy-v1","tierWeights":{"HIGH":{"INTELLECTUAL":200,"NOBILITY":700,"WANDERER":20,"WORKER":80},"LOW":{"INTELLECTUAL":100,"NOBILITY":0,"WANDERER":200,"WORKER":700},"MID":{"INTELLECTUAL":400,"NOBILITY":100,"WANDERER":50,"WORKER":450}}}
   - CONFLICT_EPISODE_PROFILE: {"maximumDisplacementBps":100,"maximumExhaustionDelta":100,"maximumGrievanceDelta":100,"maximumIndustryDamage":50,"maximumLegitimacyDelta":60,"maximumMortalityBps":20,"maximumProsperityDamage":40,"maximumUnrestDelta":80,"schemaVersion":"echoes-conflict-episode-profile-v1"}
   - DEROGATORY_TAXONOMY: {"status":"OWNER_VALUES_REQUIRED","structuralConstraints":["legacy taxonomy status is LEGACY_UNTRUSTED_TARGET_TAXONOMY","three structure names","explicit membership decision for every Group in every structure","no local synthesis"]}
   - DYNAMIC_SUSTENANCE_NUMERIC: {"status":"OWNER_VALUES_REQUIRED","structuralConstraints":["no physical Refuge for these classifications"]}
   - DYNAMIC_SUSTENANCE_SEMANTICS: {"status":"OWNER_VALUES_REQUIRED","structuralConstraints":["14 owner-authorized non-Refuge classifications","no mapping inferred from a classification name"]}
   - FEDERAL_VISION_WEIGHTS: {"status":"OWNER_VALUES_REQUIRED","structuralConstraints":["Concord uses Crown/Church","Ruin uses Intellectual/Hereditary","Schism uses Corporate/Wealth"]}
   - PEACE_EXHAUSTION_POLICY: {"peacefulExhaustionRecovery":40,"postWarCooldownYears":20,"schemaVersion":"echoes-peace-exhaustion-policy-v1","warExhaustionIncrease":80}
   - POI_RENAME_CONSEQUENCES: {"status":"OWNER_VALUES_REQUIRED","structuralConstraints":["legitimacy","acceptance/grievance","history rewriting","group safety/migration","reputation","claims/conflict","cultural memory"]}
   - QUARTERMASTER_CAPACITY_LOSS: {"status":"OWNER_VALUES_REQUIRED","structuralConstraints":["all applicable node output enters logistics through a Quartermaster"]}
   - REFUGE_OUTPUT: {"status":"OWNER_VALUES_REQUIRED","structuralConstraints":["Quartermaster is the local logistics entry point"]}
   - REFUGE_REPLENISHMENT: {"status":"OWNER_VALUES_REQUIRED","structuralConstraints":["replenishment cannot exceed approved capacity"]}
   - RELIGIOUS_SIMILARITY: {"status":"OWNER_VALUES_REQUIRED","structuralConstraints":["same Deity","same Pantheon different Deity","different Pantheon","different Pantheon is not automatic hostility"]}
   - RESOURCE_QUARTERMASTER_ASSIGNMENT_POLICY: {"status":"OWNER_VALUES_REQUIRED","structuralConstraints":["eligibility","control/jurisdiction","route/access","capacity priority","reassignment","stable Quartermaster ID final tie-break"]}
   - RESOURCE_YIELD_DEPLETION: {"status":"OWNER_VALUES_REQUIRED","structuralConstraints":["requires approved Resource inventory"]}
   - ROUTE_DECISION: {"status":"OWNER_VALUES_REQUIRED","structuralConstraints":["Prompt-01 classification remains noncausal until separately promoted","WorldKey cannot force route divergence"]}
   - SETTLEMENT_INFLUENCE: {"status":"OWNER_VALUES_REQUIRED","structuralConstraints":["normalized distance = geodesic distance / approved radius","25:15 contested span resolves 5/8:3/8"]}
   - SHRINE_THRESHOLD: {"minimumSettlementSharePpm":800000}
   - SKIRMISH_PROFILE: {"exhaustionDelta":30,"grievanceDelta":50,"mortalityBps":1,"prosperityDamage":10,"schemaVersion":"echoes-skirmish-profile-v1","tensionDelta":40}
   - TEMPLE_THRESHOLD: {"minimumWorshippers":100000}
   - TERRAIN_COMPATIBILITY_POLICY: {"broadMatchNoSpecificConflict":750,"broadMatchSpecificMismatch":500,"broadMismatch":200,"exactSpecificMatch":1000,"schemaVersion":"echoes-terrain-compatibility-v1","unknown":500}
   - Why it matters: these values control causal formulas and meanings; packet examples are not authority.
   - If unapproved: the simulator pauses only at the first causal consumer requiring that revision and deep-links the policy row.
   - Exact action: Owner Policy Center → select each policy ID → inspect consumers and typed values → EDIT AS NEW REVISION if needed → enter Owner ID/effective year/provenance → APPROVE exact hash.

6. **Sibling Atlas consumer**
   - What needs approval/action: implement and verify the overlay consumer in the dirty echoes-of-eidolon checkout in a separately authorized safe task.
   - Exact candidates: contract echoes-dynamic-atlas-overlay-v1; layers STATE_TERRITORY, SETTLEMENT_INFLUENCE, REFUGE, RESOURCE, POI_CONTROL, ROUTE, RELIGIOUS_CENTER, INSTITUTION, CONFLICT.
   - Why it matters: simulator production alone does not complete the two-repository Atlas.
   - If unapproved/unimplemented: simulator overlays remain available, but the sibling presentation does not render them.
   - Exact action: follow ECHOES_OF_EIDOLON_DYNAMIC_ATLAS_HANDOFF.md in a clean or explicitly authorized sibling task; no action was taken in that checkout here.
