# Simulation constants and variables inventory

Snapshot: current on-disk workspace on 2026-08-26, based on commit `b25db69` plus the existing uncommitted worktree changes.

This file inventories the constants, inputs, state variables, thresholds, formulas, tie-breaks, and guards that determine population, population growth, migration, founding, wealth, social tiers/classes, government/economic projections, DJT/Innerwood movement, and population-dependent institutions. It does not move or change any implementation.

## Scope and status labels

- Reviewed: 110 Markdown files and 137 source/test/script files, excluding dependencies and generated build output.
- `dist-electron/**` was checked as compiled output and is not listed separately because it mirrors the TypeScript source.
- Test-only fixture numbers are not presented as simulation determinants; tests were used to confirm boundaries and expected behavior only.
- The research/audit Markdown files were reviewed. They define data coverage and evidence requirements, but add no independent demographic formulas beyond the inputs listed below.
- `ACTIVE-CANONICAL`: executed by `runCanonicalHistory` or canonical bootstrap/resume.
- `ACTIVE-DIAGNOSTIC`: executed only by the synthetic diagnostic runner.
- `UTILITY`: implemented and tested, but not necessarily called by the current canonical history loop.
- `DECLARED`: specified by Markdown or policy data but not executed by the current canonical loop as written.
- `DERIVED`: calculated state that becomes an input to later mechanics.
- `GUARD`: invariant, validation, or conservation rule rather than a positive modifier.

## 1. Runtime authority and top-level simulation controls

| Name | Exact value / source | Status | Effect |
|---|---|---|---|
| `CANONICAL_POLICY_VERSION` | `eidolon-simulator-owner-policy-v1@2026-08-18+breed-dimension-balance-v1` | ACTIVE-CANONICAL | Checkpoints/runs with another policy version are rejected. `src/core/engine/canonical-authority.ts:1`; `src/core/engine/canonical-resume.ts:22-25,46-49` |
| `ENGINE_VERSION` | `canonical-cohort-engine-v4` | ACTIVE-CANONICAL | Written into replay checkpoints. `src/core/engine/canonical-runner.ts:18-19`; `src/core/engine/canonical-resume.ts:14-15` |
| `worlds` / `WORLDS` / `WORLD_KEYS` | `CONCORD`, `SCHISM`, `RUIN` | ACTIVE-CANONICAL + DIAGNOSTIC | Three independent world histories. `src/core/contracts/domain.ts:3-5`; `src/core/engine/canonical-history.ts:13`; `src/core/engine/diagnostic-runner.ts:11` |
| `yearStart` | `0` | ACTIVE-CANONICAL | Initial snapshot year. `src/core/contracts/domain.ts:42` |
| `yearEnd` | default `2000` | ACTIVE-CANONICAL | Inclusive final simulated year; caller can override `yearEnd` on resume. `src/core/contracts/domain.ts:43`; `src/core/engine/canonical-resume.ts:17,69` |
| `checkpointInterval` | default `5` years | ACTIVE-CANONICAL | Checkpoint when `year % interval === 0` or at `yearEnd`. `src/core/engine/canonical-history.ts:143,266-267,281`; `src/core/engine/canonical-resume.ts:69` |
| `seed` | caller/run input string | ACTIVE-CANONICAL + DIAGNOSTIC | Resolves shared-event jitter and year-0 seeded tie-breaks. It does not affect equal initial population allocation. `src/core/determinism/scoped-random.ts:14-29`; `src/core/engine/year0-readiness.ts:63-112` |
| PRNG | `sha256-counter-v1` | ACTIVE-CANONICAL | Hash material is normalized seed hash + world + year + purpose + entity ID + ordinal. `src/core/determinism/scoped-random.ts:4,14-39` |
| `autoAcceptNaming` | default `false` | ACTIVE-CANONICAL | If false, founding naming jobs stop history at `WAITING_FOR_NAMING`; if true, test fixture names are accepted. `src/core/engine/canonical-resume.ts:69`; `src/core/engine/canonical-history.ts:226-233,283` |

Current bundled authority is `V4_SIMULATION_READY_BALANCED_2026-08-26` with `buildReady: true`, `year0ReadinessStatus: PASS`, and Breed semantic ZIP `ECHOES_OF_EIDOLON_BREED_SEMANTICS_V4_SIMULATION_READY.zip`. The manifest is `resources/canonical/canonical_bundle_manifest.json`.

## 2. Core state variables carried by the simulation

### Population cohort

Every active cohort carries these causal variables (`src/core/engine/cohort-engine.ts:5-16`):

| Variable | Type / initial value | What it controls |
|---|---|---|
| `cohortId` | deterministic string | Stable ordering, merge provenance, migration/founding descendant IDs. |
| `worldKey` | world enum | World-specific policy priority and sovereign. |
| `settlementId` | string | Local faction, migration origin, migration edges, founding source, DJT location. |
| `breedId` | string | Breed semantics, population kind, culture, faction score, raw property values. |
| `population` | `bigint` | Growth base, migration/founding/DJT amounts, projection weights, social segment size. |
| `wealthScore` | integer; starts `0` | Wealth ranking/social tier; retained after ordinary retention; reset on moved descendants. |
| `createdYear` | number; starts `0` | Lineage metadata and merge state. |
| `originCohortId` | string or `null` | Transfer lineage. |
| `createdByEventId` | string | Transfer/growth provenance. |
| `outboundMigrationNotBeforeYear` | number or `null` | If `year < value`, ordinary outbound migration is skipped. Inbound movement remains possible. |

### Settlement-derived variables

The following are recalculated from resident cohorts and then feed later mechanics (`src/core/engine/canonical-history.ts:117-137`):

- `population`: exact sum of resident cohort populations.
- `propertyWinners`: winner for each of the 12 raw properties.
- `dominantFaction`: faction point winner across all raw-property values.
- `politicalForm`: mapping of `administrationMode + legitimacyBasis + authoritySource`.
- `economicForm`: mapping of `ownershipMode + allocationMode`.
- `politicalLatch`: remaining change keys `administrationMode`, `legitimacyBasis`, `authoritySource`.
- `economicLatch`: remaining change keys `ownershipMode`, `allocationMode`.
- `cultureId` / `cultureState`: founding Human culture or explicit no-Human state; then immutable.
- `dominantSpeciesKind`: current code chooses `HUMAN` whenever any Human residents exist; otherwise the largest population kind.
- `dominantBreed`: largest resident Breed within `dominantSpeciesKind`.
- `stateId`: current political membership; used for founding grouping and institution membership.
- `regionId`: physical location; used for migration adjacency and founding site selection.
- `foundedYear`: determines when culture may be calculated.

### External data variables consumed by the active canonical runner

| Data | Fields that affect mechanics | Source |
|---|---|---|
| Breed identity | `breedId`, `populationKind`, `groupId`, `cultureId` | ZIP member `canonical_breed_identities.jsonl` |
| Breed semantics | `breedId`, `terrainBroad`, `terrainSpecific`, the 12 `dimensions.*.value` fields | ZIP member `effective_breed_semantics.jsonl` |
| Initial placement | `groupId -> regionId` | `resources/canonical/atlas/region_species_group_assignments.csv` |
| Founding sites | `siteId`, `regionId`, `currentSiteName` | `resources/canonical/atlas/founding_sites.csv` |
| Later site choice | `siteId`, `regionId`, `currentSiteName`, `nameStatus`, `classification`, `attractivenessTier` | `resources/canonical/atlas/sites_naming_master.csv` |
| Population/faction mapping | 12 raw properties mapped to three factions | `resources/canonical/reference/property_faction_mapping.json` |
| Political form | 27 exact three-field combinations | `resources/canonical/reference/political_form_mapping.json` |
| Economic form | 9 exact two-field combinations | `resources/canonical/reference/economic_form_mapping.json` |
| Growth | matrix only is read by the history loop | `resources/canonical/reference/growth_policy.json` |
| Migration graph | directed Region adjacency | `resources/canonical/reference/region_adjacency.json` |
| Sovereign/DJT | sovereign faction, sovereign Breed, target Site, R10 Site | `resources/canonical/reference/sovereign_and_djt.json` |
| Calendar | event key, nominal year, jitter flag, kind | `resources/canonical/reference/shared_event_skeleton.json` |

`resources/reference/**` contains byte-equivalent copies of the active reference JSON files listed above. The canonical runner reads `resources/canonical/reference/**` on canonical runs.

## 3. Initial population and placement

### Active canonical values and formula

| Name | Exact value / rule | Status |
|---|---|---|
| Initial population per world | `2_000_000n` | ACTIVE-CANONICAL. `src/core/engine/canonical-runner.ts:58-60`; `src/core/engine/year0-readiness.ts:128-130` |
| Civic participants | every Breed whose `populationKind !== "PET"` | ACTIVE-CANONICAL. `src/core/engine/cohort-engine.ts:40`; exact readiness guard requires `1,773`. `src/core/engine/year0-readiness.ts:116-120` |
| PET count | `283`; excluded | ACTIVE data/policy. `src/core/inputs/preflight.ts:73-76,113-114`; owner answer at `ECHOES_OF_EIDOLON_SIMULATOR_CODEX_IMPLEMENTATION_PACK_2026-08-18/OWNER_DECISIONS_REQUIRED.md:8` |
| Civic counts | HUMAN `631`, BEAST `961`, MYTHOS `181`; total `1,773` | ACTIVE data guard. `src/core/inputs/preflight.ts:73-76` |
| Allocation weight | `1n` for every sorted civic `breedId` | ACTIVE-CANONICAL. `src/core/engine/local-mechanics.ts:8-12` |
| Integer allocation | largest-remainder apportionment by ascending `breedId` | ACTIVE-CANONICAL. `src/core/math/exact.ts:37-46` |
| Result at 1,773 Breeds | first 56 IDs receive `1,129`; remaining 1,717 receive `1,128` | Mathematically implied and declared at `ECHOES_OF_EIDOLON_SIMULATOR_CODEX_IMPLEMENTATION_PACK_2026-08-18/CANONICAL_SIMULATION_CONTRACT.md:58-64` |
| Initial wealth | `0` | ACTIVE-CANONICAL. `src/core/engine/cohort-engine.ts:50-60` |
| Initial R10 population | none; all assignments/sites with `regionId === "R10"` are filtered out | ACTIVE-CANONICAL. `src/core/engine/cohort-engine.ts:42-43` |
| Initial settlements | 24, one per non-R10 Region | ACTIVE-CANONICAL guard. `src/core/engine/year0-readiness.ts:119-120` |
| Settlement ID | `SETTLEMENT_${world}_${siteId}` | ACTIVE-CANONICAL. `src/core/engine/cohort-engine.ts:51-54` |

Initial group placement map (R10 duplicates are excluded from year 0):

```text
R01 H02 B23 B06     R02 H06 B05 B08     R03 H24 M10 M07
R04 H08 B22 M24     R05 M11 M17 M03     R06 H12 M01 M05
R07 H21 M23 M21     R08 H09 B21 M09     R09 H10 M12 M08
R11 H01 H17 B07     R12 M15 M18 B19     R13 H13 M04 B01
R14 H11 B04 B11     R15 H20 H04 B16     R16 H14 H15 M06
R17 H23 H05 B15     R18 H22 B12 B17     R19 H18 B14 M20
R20 B03 B18 M19     R21 H07 M14 M13     R22 H03 B10 B13
R23 H19 B24 M16     R24 H16 B09 M02     R25 B02 B20 M22
R10 H12 H04 M05 H03 B10 B13 H01 H17 B07 (excluded at year 0)
```

The placement is taken from `resources/canonical/atlas/region_species_group_assignments.csv`; the code uses only `groupId` and `regionId`.

## 4. Growth

### Active rate constants

| Band | Exact rational rate | Percent |
|---|---:|---:|
| `LOW` | `1 / 200` | `0.5%` |
| `MEDIUM` | `1 / 100` | `1.0%` |
| `HIGH` | `3 / 200` | `1.5%` |

These rates are hardcoded in `GROWTH_RATES` at `src/core/engine/local-mechanics.ts:4-6`. The `rates` object in `resources/canonical/reference/growth_policy.json` is not read by `runCanonicalHistory`; the JSON `matrix` is read.

### Active growth-band matrix

Rows are the Settlement's prior completed `dominantFaction`; columns are the world's `sovereignFaction`:

| Settlement faction | CONCORD sovereign | SCHISM sovereign | RUIN sovereign |
|---|---|---|---|
| CONCORD | LOW | MEDIUM | HIGH |
| SCHISM | HIGH | LOW | MEDIUM |
| RUIN | MEDIUM | HIGH | LOW |

Source: `resources/canonical/reference/growth_policy.json`; use at `src/core/engine/canonical-history.ts:160-168`.

### Active formula and ordering

```text
band = growthPolicy.matrix[priorSettlementDominantFaction][sovereignFaction]
growth = ceil(population * numerator / denominator)
newPopulation = population + growth
```

- Arithmetic is exact `bigint`; `ceilDiv(0, d) = 0`. `src/core/math/exact.ts:18-20`.
- Growth is applied independently to each cohort every year before canonical regular migration, founding, and DJT. `src/core/engine/canonical-history.ts:157-170`.
- Growth is the only active world-population creation mechanism.
- No birth rate, fertility rate, death rate, mortality rate, carrying capacity, food supply, plague, atrocity loss, war loss, or resource limit modifies growth.

## 5. Raw-property, faction, government, and economic variables

### Twelve simulation-critical raw dimensions

```text
motivation
operatingStyle
structureOrientation
administrationMode
ownershipMode
allocationMode
legitimacyBasis
authoritySource
loquacity
emotionalTemperature
outlookOrientation
collaborativePosture
```

Source definition: `src/core/research/v4-contract.ts:3-8`.

### Exact raw value -> faction mapping

| Property | CONCORD | SCHISM | RUIN |
|---|---|---|---|
| `administrationMode` | CENTRALIZED | DISTRIBUTED | DELEGATED |
| `structureOrientation` | ORDERED | NEUTRAL | CHAOS |
| `operatingStyle` | TEAMWORK | SITUATIONAL | SOLO |
| `motivation` | ALTRUISTIC | RECIPROCAL | SELFISH |
| `authoritySource` | APPOINTMENT | ELECTION | DIVINE_MANDATE |
| `legitimacyBasis` | CHARTERED | ANCESTRAL | MARTIAL |
| `allocationMode` | PLANNED | CUSTOMARY | MARKET |
| `ownershipMode` | SINGLE_ENTITY | SHARED_TITLE | COMMON_USE |
| `loquacity` | TALKATIVE | LIGHT_BANTER | TO_THE_POINT |
| `emotionalTemperature` | COMPOSED | JOYFUL | IRRITABLE |
| `outlookOrientation` | OPTIMISTIC | NEUTRAL | PESSIMISTIC |
| `collaborativePosture` | HELPFUL | WITHHOLDING | JUST_ENOUGH |

Source: `resources/canonical/reference/property_faction_mapping.json`; same table declared at `ECHOES_OF_EIDOLON_SIMULATOR_CODEX_IMPLEMENTATION_PACK_2026-08-18/CANONICAL_SIMULATION_CONTRACT.md:121-139`.

### World tie priority

| World | Priority order |
|---|---|
| CONCORD | CONCORD > SCHISM > RUIN |
| SCHISM | SCHISM > RUIN > CONCORD |
| RUIN | RUIN > CONCORD > SCHISM |

This is hardcoded in `src/core/engine/local-mechanics.ts:6` and `src/core/engine/year0-readiness.ts:8`; the equivalent `resources/canonical/reference/world_faction_priority.json` is not loaded by the history loop.

### Settlement property projection

For each property and resident population (`src/core/engine/local-mechanics.ts:38-70`):

```text
resolvedPopulation = sum(population with a non-null raw value)
unresolvedPopulation = sum(population with no raw value)
share = populationForValue / resolvedPopulation

share < 30%      -> band LOW  -> 0 faction points
30% <= share <= 50% -> band MID  -> 1 faction point
share > 50%      -> band HIGH -> 2 faction points
```

- Exact boundaries are `3/10` and `1/2`, compared by cross multiplication. `src/core/engine/local-mechanics.ts:55-60`; `src/core/math/exact.ts:23-26`.
- Points are awarded for every populated raw value, not only the winning value.
- `propertyWinner` is the largest population value; an exact tie uses world priority.
- `dominantFaction` is the highest sum across all 12 property point results; a point tie uses world priority.
- Canonical settlement calculation throws if any property's `resolvedPopulation !== total settlement population`. `src/core/engine/canonical-history.ts:117-123`.

### Breed effective faction used by wealth and migration

Current history code does not read a standalone Breed faction. It counts, for each of the 12 fields, which faction's mapped value equals the Breed value:

```text
breedFactionPoints[faction] += 1 for each matching raw dimension
effectiveBreedFaction = highest count; tie -> current world's priority order
```

`src/core/engine/canonical-history.ts:58-62,146-148`.

### Political form inputs and complete output constants

Input keys: `administrationMode`, `legitimacyBasis`, `authoritySource`. Active lookup: `src/core/engine/local-mechanics.ts:128-132`.

```text
CENTRALIZED + MARTIAL   + ELECTION         = ACCLAIMED_IMPERATOR
CENTRALIZED + CHARTERED + APPOINTMENT      = APPOINTED_DIRECTORATE
CENTRALIZED + CHARTERED + DIVINE_MANDATE   = COVENANT_CROWN
CENTRALIZED + ANCESTRAL + DIVINE_MANDATE   = DIVINE_THRONE
CENTRALIZED + CHARTERED + ELECTION         = ELECTED_EXECUTIVE
CENTRALIZED + MARTIAL   + APPOINTMENT      = JUNTA
CENTRALIZED + MARTIAL   + DIVINE_MANDATE   = MILITANT_THEOCRACY
CENTRALIZED + ANCESTRAL + APPOINTMENT      = REGENT_THRONE
CENTRALIZED + ANCESTRAL + ELECTION         = ELECTIVE_CROWN
DELEGATED   + CHARTERED + APPOINTMENT      = APPOINTED_COMMISSION
DELEGATED   + MARTIAL   + ELECTION         = CAPTAINS_COUNCIL
DELEGATED   + CHARTERED + DIVINE_MANDATE   = CONSECRATED_REPUBLIC
DELEGATED   + ANCESTRAL + ELECTION         = ESTATES_DIET
DELEGATED   + ANCESTRAL + APPOINTMENT      = FEUDAL_ORDER
DELEGATED   + MARTIAL   + APPOINTMENT      = GARRISON_COMMAND
DELEGATED   + MARTIAL   + DIVINE_MANDATE   = MILITANT_ORDER
DELEGATED   + CHARTERED + ELECTION         = REPUBLIC
DELEGATED   + ANCESTRAL + DIVINE_MANDATE   = TEMPLE_HIERARCHY
DISTRIBUTED + ANCESTRAL + ELECTION         = CHIEFTAIN_COUNCIL
DISTRIBUTED + CHARTERED + DIVINE_MANDATE   = COVENANT_ASSEMBLY
DISTRIBUTED + CHARTERED + APPOINTMENT      = DELEGATE_LEAGUE
DISTRIBUTED + ANCESTRAL + APPOINTMENT      = ELDER_MOOT
DISTRIBUTED + MARTIAL   + ELECTION         = FREE_COMPANY
DISTRIBUTED + ANCESTRAL + DIVINE_MANDATE   = HALLOWED_CUSTOM
DISTRIBUTED + CHARTERED + ELECTION         = POPULAR_FEDERATION
DISTRIBUTED + MARTIAL   + APPOINTMENT      = RAIDER_CONFEDERACY
DISTRIBUTED + MARTIAL   + DIVINE_MANDATE   = ZEALOT_BANDS
```

Source: `resources/canonical/reference/political_form_mapping.json`.

### Economic form inputs and complete output constants

Input keys: `ownershipMode`, `allocationMode`. Active lookup: `src/core/engine/local-mechanics.ts:134-138`.

```text
SINGLE_ENTITY + PLANNED    = COMMAND_DEMESNE
COMMON_USE    + PLANNED    = COMMUNE_PLAN
COMMON_USE    + CUSTOMARY  = FOLK_COMMONS
SHARED_TITLE  + CUSTOMARY  = GUILD_COMPACT
SINGLE_ENTITY + MARKET     = MONOPOLY_ESTATE
COMMON_USE    + MARKET     = OPEN_BAZAAR
SHARED_TITLE  + MARKET     = SHAREHOLDER_BOURSE
SHARED_TITLE  + PLANNED    = SYNDICATE_CARTEL
SINGLE_ENTITY + CUSTOMARY  = TRIBUTARY_DEMESNE
```

Source: `resources/canonical/reference/economic_form_mapping.json`.

Economic form is a derived label. It does not currently feed population growth, migration rate, or wealth increment.

### Epoch latch constants

- Political tracked keys: `administrationMode`, `legitimacyBasis`, `authoritySource`.
- Economic tracked keys: `ownershipMode`, `allocationMode`.
- A key is permanently consumed during an epoch the first time its winner changes. The epoch triggers when no keys remain, then refills. `src/core/engine/local-mechanics.ts:140-144`; `src/core/engine/canonical-history.ts:14-15,257-264`.

## 6. Wealth

### Active base matrix

Rows are effective Breed faction; columns are controlling faction:

| Breed faction | CONCORD control | RUIN control | SCHISM control |
|---|---:|---:|---:|
| CONCORD | `+3` | `+2` | `+1` |
| SCHISM | `+2` | `+1` | `+3` |
| RUIN | `+1` | `+3` | `+2` |

This matrix is hardcoded in `src/core/engine/local-mechanics.ts:180-193`. `resources/canonical/reference/wealth_policy.json` contains the same matrix but is not loaded by the canonical runner.

### Control inputs and concentration modifiers

Declared control layers are Settlement, political State, and Sovereign/world. The active helper accepts all three:

```text
base = matrix[breedFaction][settlementFaction]
     + matrix[breedFaction][stateFaction]
     + matrix[breedFaction][sovereignFaction]
```

Concentration modifier:

| Control distribution | Breed relationship | Modifier |
|---|---|---:|
| All three controls same | Breed matches holder | `+4` |
| All three controls same | Breed does not match | `-2` |
| All three controls different | any Breed | `-1` |
| Two controls same | Breed matches double holder | `+2` |
| Two controls same | Breed matches single holder | `+1` |
| Two controls same | Breed matches absent faction | `-2` |

Annual increment is `base + modifier`, added to `wealthScore`. `src/core/engine/local-mechanics.ts:180-194`.

### Active call-site behavior

The current canonical loop calls:

```text
wealthIncrement(
  breedEffectiveFaction,
  priorSettlementDominantFaction,
  priorSettlementDominantFaction, // used as state faction too
  sovereignFaction
)
```

`src/core/engine/canonical-history.ts:163-169`.

Therefore, in current execution:

- there is no independent State faction in wealth accrual; the Settlement faction is counted twice;
- wealth is accrued in the growth phase, before that year's migration/founding/DJT and before final projections;
- ordinary retained population keeps accumulated wealth;
- ordinary migrant and founder descendant cohorts start at `0` wealth (`src/core/engine/canonical-history.ts:194,217`);
- DJT-moved descendants start at `0`; a Sovereign cohort already in the seized target retains wealth (`src/core/engine/cohort-engine.ts:149-171`);
- cohort coalescing calculates the population-weighted wealth average and floors integer division (`src/core/engine/canonical-history.ts:63-79`). The merge key is world + Settlement + Breed and does not include wealth.

No currency, price, tax, wage, income, property value, trade, employment, or resource variable contributes to `wealthScore`.

## 7. Social tiers and classes

### Active tier constants

For each Settlement projection (`src/core/engine/local-mechanics.ts:146-177`):

```text
HIGH = floor(totalPopulation * 33 / 100)
MID  = floor(totalPopulation * 33 / 100)
LOW  = totalPopulation - HIGH - MID
```

- If `totalPopulation >= 3`, HIGH and MID are each forced to at least `1` when their floor would be zero.
- Cohort segments are sorted by `wealth` descending, then `breedId`, then `cohortId`.
- A cohort may split across tier boundaries.
- Tier population is conserved exactly.

### Active class constants

Each tier segment is split as:

```text
first  = ceil(segmentPopulation / 2) = (population + 1) / 2
second = floor(segmentPopulation / 2) = population / 2

HIGH -> NOBILITY(first) + INTELLECTUAL(second)
MID  -> INTELLECTUAL(first) + WORKER(second)
LOW  -> WORKER(first) + WANDERER(second)
```

Odd-person remainders therefore go to NOBILITY for HIGH, INTELLECTUAL for MID, and WORKER for LOW.

### Active timing

In the canonical loop, social projection is calculated after annual growth/wealth accrual but before regular migration, founding, DJT, and final same-year recalculation. `src/core/engine/canonical-history.ts:163-179,181-264`.

## 8. Canonical regular migration

### Destination graph

- Every occupied Settlement in a Region listed in the origin Region's adjacency array becomes a distinct destination edge.
- Edges are directed and sorted by origin ID then destination ID.
- Same-Region Settlements are not migration destinations unless the Region is explicitly self-adjacent (none are).
- R10 contributes no edge until it has a Settlement.
- Active builder: `src/core/engine/flow-mechanics.ts:30-32`.

Exact directed Region adjacency:

```text
R01 -> R03 R04 R05
R02 -> R03 R08 R07
R03 -> R02 R01 R07
R04 -> R01 R15 R09
R05 -> R01 R18 R19
R06 -> R19 R11 R20
R07 -> R02 R03 R08
R08 -> R02 R07 R17
R09 -> R04 R15 R10
R10 -> R15 R09 R11
R11 -> R10 R06 R12
R12 -> R11 R14 R16
R13 -> R14 R22 R16
R14 -> R12 R13 R16
R15 -> R04 R09 R10
R16 -> R14 R12 R13
R17 -> R08 R18 R24
R18 -> R05 R17 R19
R19 -> R05 R18 R06 R20
R20 -> R19 R06 R22
R21 -> R24 R23 R25
R22 -> R20 R25 R13
R23 -> R24 R21 R25
R24 -> R17 R21 R23
R25 -> R21 R23 R22
```

Source: `resources/canonical/reference/region_adjacency.json`.

### Active rate variables and formula

For each origin cohort and each destination (`src/core/engine/canonical-history.ts:133-138,181-198`):

```text
propertyComparison = sum across 12 raw dimensions:
  +1 when destination.propertyWinner[field] == breed.dimension[field]
  -1 otherwise
// range: -12 through +12

factionAdjustment =
  0 if breedEffectiveFaction == destination.dominantFaction
  2 else if breedEffectiveFaction == sovereignFaction
  1 otherwise

rateTwelfths = clamp(0, 60,
  12 + propertyComparison + (factionAdjustment * 12)
)

proposed = floor(cohortPopulation * rateTwelfths / 1200)
```

Interpretation: base `12/1200 = 1%`; each raw-property comparison contributes `1/1200` of population; faction adjustments contribute `0%`, `2%`, or `1%`; final per-destination rate is clamped to `0%..5%`.

### Active outbound cap and application

```text
proposedTotal = sum(proposed for every destination)
outgoingTotal = min(proposedTotal, cohortPopulation)
retained = cohortPopulation - outgoingTotal
```

- If `proposedTotal <= population`, every proposal is applied as-is.
- If it exceeds population, each destination except the last receives `floor(population * proposal / proposedTotal)`; the last sorted destination receives the remaining population. `src/core/engine/canonical-history.ts:187-193`.
- This active path does not use largest-remainder apportionment, although the separate `applySimultaneousTransfers` utility does. `src/core/engine/flow-mechanics.ts:13-27`.
- Migrants receive `wealthScore = 0`; retained origin wealth is preserved. `src/core/engine/canonical-history.ts:189-195`.
- All same-year proposals are calculated before the merged result replaces the source cohort list.
- If `outboundMigrationNotBeforeYear !== null && year < value`, all regular outbound proposals are skipped. `src/core/engine/canonical-history.ts:184-186`.
- The active canonical migration rate does not use terrain, food, current wealth, social tier, political State faction, origin Settlement faction, population density, or destination capacity.
- The Markdown wealthiest-Breed suppression rule (`75%`/`50%` proposal multipliers) is not called in the active canonical history loop.

### Migration wealth-suppression constants declared in policy/docs

`DECLARED`, not active in `runCanonicalHistory`:

- If another Breed is at least `75%` of maximum wealth, multiply wealthiest proposed migration by `75%` (a 25% reduction).
- If nobody else reaches `75%`, multiply sole-wealthiest migration by `50%`.
- Tied wealthiest Breeds use the `75%` multiplier branch.

Sources: `ECHOES_OF_EIDOLON_SIMULATOR_CODEX_IMPLEMENTATION_PACK_2026-08-18/CANONICAL_SIMULATION_CONTRACT.md:352-367`; `ECHOES_OF_EIDOLON_SIMULATOR_CODEX_IMPLEMENTATION_PACK_2026-08-18/prompts/03_MIGRATION_FOUNDING_DJT_STATE.md:114-120`; `resources/canonical/reference/wealth_policy.json`.

## 9. Terrain suitability

The implemented utility accepts four arrays: Breed broad terrain, Breed specific terrain, Site broad terrain, Site specific terrain (`src/core/engine/flow-mechanics.ts:3-9`).

```text
if Breed broad or Breed specific is empty -> UNKNOWN
else if no Breed broad value intersects Site broad -> BROAD
else if no Breed specific value intersects Site specific -> SPECIFIC
else -> NONE
```

Status: `UTILITY`. `runCanonicalHistory` does not call `terrainSuitability`; terrain does not currently alter active migration or founding.

Declared owner policy says food is disabled and terrain only is considered (`ECHOES_OF_EIDOLON_SIMULATOR_CODEX_IMPLEMENTATION_PACK_2026-08-18/OWNER_DECISIONS_REQUIRED.md:9`; `resources/canonical/policies/owner_policy.json`), but the active canonical founding implementation also does not use terrain.

## 10. Canonical founding

### Active event years

Founding runs at the resolved calendar years of event keys matching `FOUNDING_WAVE_2` through `FOUNDING_WAVE_5`. `src/core/engine/canonical-history.ts:140,149-153,202-234`.

| Event | Nominal year | Jitter |
|---|---:|---|
| `FOUNDING_WAVE_2` | `1` | fixed `0` |
| `FOUNDING_WAVE_3` | `75` | integer `-2..+2` |
| `FOUNDING_WAVE_4` | `125` | integer `-2..+2` |
| `FOUNDING_WAVE_5` | `175` | integer `-2..+2` |

### Active site and transfer variables

For every current `stateId` at each founding wave:

1. `members` = all Settlements currently in that political State.
2. `regionId` = physical Region of `members[0]`.
3. Candidates = unused Sites with exactly that `regionId`.
4. Site order = numeric `attractivenessTier` descending, then `siteId` ascending.
5. If no candidate exists, the State is skipped.
6. Every cohort in every member Settlement sends `floor(cohort.population / 10)` to the new Settlement.
7. Total new population is the sum of those 10% cohort floors.
8. Moved descendants reset wealth to `0`; retained populations keep wealth.
9. The new Settlement is recalculated from its residents and produces a naming barrier.

Active code: `src/core/engine/canonical-history.ts:202-233`.

`classification` is loaded for a Site but not used in active canonical site sorting. Terrain, social tier, wealth, population kind, culture uniqueness, faction match, and the owner `EVERY_BROAD_UNHAPPY_FOUND_OR_JOIN_V1` strategy do not select active founders.

### Declared founding variables not executed by the current loop

The Markdown/current owner policy declares these additional inputs and constants:

- Founder cardinality: every `BROAD`-unhappy Breed should found or join a city with matching terrain. `ECHOES_OF_EIDOLON_SIMULATOR_CODEX_IMPLEMENTATION_PACK_2026-08-18/OWNER_DECISIONS_REQUIRED.md:11`.
- Motive eligibility: HIGH wealth/social tier = HAPPY; LOW = UNHAPPY; MIXED uses HIGH + LOW; MID is not selected solely by motive. `ECHOES_OF_EIDOLON_SIMULATOR_CODEX_IMPLEMENTATION_PACK_2026-08-18/OWNER_DECISIONS_REQUIRED.md:12`; `resources/canonical/policies/owner_policy.json`.
- Human founder contingent: transfer exactly `20%` of eligible Human Culture population in the State, proportionally across sources. `ECHOES_OF_EIDOLON_SIMULATOR_CODEX_IMPLEMENTATION_PACK_2026-08-18/CANONICAL_SIMULATION_CONTRACT.md:390-402`.
- Accompanying BEAST/MYTHOS: transfer `25%` when Breed faction does not match the origin Settlement faction. `ECHOES_OF_EIDOLON_SIMULATOR_CODEX_IMPLEMENTATION_PACK_2026-08-18/CANONICAL_SIMULATION_CONTRACT.md:404-411`.
- No matching new Site but matching existing Settlement: allow `100%` structural move. `ECHOES_OF_EIDOLON_SIMULATOR_CODEX_IMPLEMENTATION_PACK_2026-08-18/CANONICAL_SIMULATION_CONTRACT.md:382-388`.
- Site fallback: attractiveness tier descending, then `CITY > TOWN > VILLAGE > HAMLET`, then stable `siteId`. `ECHOES_OF_EIDOLON_SIMULATOR_CODEX_IMPLEMENTATION_PACK_2026-08-18/CANONICAL_SIMULATION_CONTRACT.md:413-421`.
- Culture uniqueness: global. `ECHOES_OF_EIDOLON_SIMULATOR_CODEX_IMPLEMENTATION_PACK_2026-08-18/OWNER_DECISIONS_REQUIRED.md:13`.

## 11. DJT / Innerwood and secession

### Exact active Sovereign constants

| World | Sovereign faction | Sovereign Breed | Initial capital | DJT seizure target |
|---|---|---|---|---|
| CONCORD | CONCORD | `BRD_LION` | R02 / `SITE-008` | R06 / `SITE-036` |
| SCHISM | SCHISM | `BRD_HAMADRYAS_BABOON` | R15 / `SITE-099` | R22 / `SITE-148` |
| RUIN | RUIN | `BRD_PEACOCK_SPIDER` | R25 / `SITE-169` | R11 / `SITE-071` |

Innerwood constants: State label `Innerwood`, physical Region `R10`, Site `SITE-064`, Settlement name requires naming. Source: `resources/canonical/reference/sovereign_and_djt.json`.

### Active DJT timing and movement

- Event nominal year: `500`, with shared `-2..+2` jitter. Fallback if event is missing: `500`. `src/core/engine/canonical-history.ts:151`.
- `quarantineYears`: `5`. `src/core/engine/canonical-history.ts:240-243`.
- `quarantineUntil = eventYear + quarantineYears`. Ordinary outbound is blocked while `year < quarantineUntil`. `src/core/engine/cohort-engine.ts:138-171`.
- Every nonzero Sovereign-Breed cohort outside the target is moved in full to the target.
- A Sovereign-Breed cohort already at the target stays and retains wealth, but receives the outbound restriction.
- Every non-Sovereign cohort at the target is moved in full to R10/Innerwood.
- Moved descendants reset wealth to `0`.
- Other cohorts do not move.
- Exact world population before and after must match. `src/core/engine/cohort-engine.ts:175-177`.

The current annual order performs regular migration before DJT, so DJT-moved cohorts cannot exercise the event-year migration restriction until later years. With the condition `year < eventYear + 5`, outbound becomes possible at exactly `eventYear + 5`.

### Active 505/525 state membership variables

- `secessionYear`: resolved `INNERWOOD_SECESSION_505`, fallback `505`.
- Candidate Regions hardcoded to `R15`, `R09`, `R11`.
- Candidate Settlement must not be the DJT target and must have `dominantFaction !== sovereignFaction`.
- Sort by `siteId`, take at most `2`, assign to `STATE_${world}_R10`.
- Physical `regionId` and population do not change.
- `rebalanceYear`: resolved `INNERWOOD_REBALANCE_525`, fallback `525`; current action is a zero-population-effect disabled marker.

`src/core/engine/canonical-history.ts:152-153,246-255`.

## 12. Culture and dominance variables

### Year-0 readiness behavior

- Culture candidates: Human cohorts only, grouped by `cultureId`.
- Largest Human population wins.
- Culture tie: larger population whose Breed effective faction equals the world wins; remaining tie uses seed hash.
- `dominantSpeciesKind`: forced to HUMAN whenever Human population is nonzero; otherwise largest kind with seed-hash tie.
- `dominantBreed`: population descending, then culture match, then world-faction alignment, then seed hash.

`src/core/engine/year0-readiness.ts:65-113,131-155`.

### Active history recalculation behavior

- Culture on a newly founded Settlement: largest Human `cultureId`; exact population tie uses lexicographic `cultureId`.
- Once `cultureState === CALCULATED`, culture is preserved.
- `dominantSpeciesKind`: HUMAN if any Human cohort exists, regardless of whether Humans are the largest kind; otherwise population descending and kind-name lexicographic tie.
- `dominantBreed`: largest population Breed within chosen kind; tie uses lexicographic `breedId`.

`src/core/engine/canonical-history.ts:117-130`.

These derived values affect naming/governance displays. `dominantFaction` affects next-year growth and current migration; Breed effective faction affects migration and wealth.

## 13. Population-dependent institutions

### Conclave

- Before year `90`, the utility creates one CITY seat per Settlement if called.
- At/after year `90`, each State gets two CITY seat slots plus one UNINCORPORATED seat.
- CITY selection: Settlement population descending; tie by `siteId` ascending.
- Capacity after reform: `72`; after any R10 Settlement exists: `75`.
- Missing city seats are vacant rather than fabricated.
- Current canonical loop emits Conclave rows only at exact year `90` and at `yearEnd`, not annually and not at the jittered shared reform year.

`src/core/institutions/ledgers.ts:3-22`; `src/core/engine/canonical-history.ts:269-272`.

### Senate

- Starts in code when `year >= 275`.
- Two seat identities: `A` and `B`.
- Term length: `10` years.
- Seat A election when `year % 10 === 5`; seat B when `year % 10 === 0`.
- Current rows use Settlement membership/state IDs; Senate selection does not feed back into population or wealth.

`src/core/institutions/ledgers.ts:25-26`; `src/core/engine/canonical-history.ts:273`.

## 14. Shared calendar constants with possible structural effects

All jittered events use one deterministic integer from `[-2, -1, 0, 1, 2]`, resolved once from the shared seed and reused in all worlds. `src/core/events/calendar.ts:3-10`.

| Event key | Nominal year | Jitter | Mechanical status |
|---|---:|---|---|
| FOUNDING | 0 | fixed | initial snapshot |
| FOUNDING_WAVE_2 | 1 | fixed | founding transfer |
| ATROCITY_01 | 50 | yes | marker only; effect 0 |
| FOUNDING_WAVE_3 | 75 | yes | founding transfer |
| CONCLAVE_72_REFORM | 90 | yes | declared reform; active loop uses exact year 90 |
| ATROCITY_02 | 100 | yes | marker only |
| FOUNDING_WAVE_4 | 125 | yes | founding transfer |
| ATROCITY_03 | 150 | yes | marker only |
| FOUNDING_WAVE_5 | 175 | yes | founding transfer |
| ATROCITY_04 | 200 | yes | marker only |
| JUSTICE_DEPARTMENT_FOUNDED | 225 | yes | marker only |
| ATROCITY_05 | 250 | yes | marker only |
| SENATE_FOUNDED | 275 | yes | declared; active loop uses exact threshold 275 |
| ATROCITY_06 | 300 | yes | marker only |
| ATROCITY_07 | 350 | yes | marker only |
| ATROCITY_09 | 400 | yes | marker only; 08 intentionally absent |
| DJT_SEIZURE_INNERWOOD | 500 | yes | DJT structural movement |
| INNERWOOD_SECESSION_505 | 505 | yes | membership only |
| INNERWOOD_REBALANCE_525 | 525 | yes | disabled marker, effect 0 |
| ATROCITY_10 | 550 | yes | marker only |
| ATROCITY_11 | 600 | yes | marker only |
| ATROCITY_12 | 650 | yes | marker only |
| ATROCITY_13 | 700 | yes | marker only |
| ATROCITY_14 | 750 | yes | marker only |
| ATROCITY_15 | 800 | yes | marker only |
| ATROCITY_16 | 850 | yes | marker only |
| ATROCITY_17 | 900 | yes | marker only |
| ATROCITY_18 | 950 | yes | marker only |
| GUIDES_DEPART | 1000 | yes | marker only |
| CONJUNCTION_ERA_BOUNDARY | 2000 | fixed | final boundary |

Atrocity and general history markers explicitly emit `populationEffect: "0"`; no mortality, destruction, plague, migration, wealth, or government effect is applied. `src/core/engine/canonical-history.ts:274`; `ECHOES_OF_EIDOLON_SIMULATOR_CODEX_IMPLEMENTATION_PACK_2026-08-18/OPEN_DECISIONS_AND_FAIL_CLOSED_POLICY.md:239-249`.

## 15. Exact arithmetic, ordering, and conservation guards

- Population is nonnegative `bigint` and serializes as an unsigned base-10 string with no leading zero except `0`. `src/core/math/exact.ts:1-10`.
- Growth rounds up with exact rational `ceilDiv`.
- Ordinary migration proposal rounds down.
- Active proportional over-cap migration rounds down for all but the last destination, which receives the exact remainder.
- Equal initial allocation and the utility simultaneous-transfer cap use largest-remainder apportionment, remainder ties by stable key. `src/core/math/exact.ts:37-46`.
- Founding transfer rounds down per cohort (`population / 10`).
- Social HIGH/MID allocations round down; LOW is the exact remainder.
- Social class first category gets an odd-person remainder.
- Cohort transfer and DJT functions assert population before equals population after. `src/core/engine/cohort-engine.ts:111-116,175-177`.
- Canonical settlement projections require every raw property's resolved population to equal the Settlement population. `src/core/engine/canonical-history.ts:122`.
- Initial population must equal `2,000,000` in every world. `src/core/engine/year0-readiness.ts:128-130`.
- Negative cohort/social population throws. `src/core/engine/cohort-engine.ts:71,112,144`; `src/core/engine/local-mechanics.ts:149`.

## 16. Synthetic diagnostic-only constants

These values do not describe the canonical cohort engine. They are active only in `runDiagnosticHistory` (`src/core/engine/diagnostic-runner.ts`).

| Variable | Exact diagnostic behavior |
|---|---|
| Worlds/final year | 3 worlds, years `0..2000` |
| Initial population | `2_000_000` per world, equally divided across 24 founding Sites rather than 1,773 Breeds |
| Initial State count | `24` |
| Capitals | CONCORD `SITE-008`; SCHISM `SITE-099`; RUIN `SITE-169` |
| Seizure targets | CONCORD `SITE-036`; SCHISM `SITE-148`; RUIN `SITE-071` |
| Site class priority | METROPOLIS `5`, CITY `4`, TOWN `3`, VILLAGE `2`, HAMLET `1` |
| Growth | always `LOW` (`0.5%`, rounded up) on total world population |
| Growth recipient | current federal-capital Settlement, otherwise first Settlement |
| Founding | at four resolved waves, choose per original Region by attractiveness tier, class priority, Site ID; transfer `1%` (`source.population / 100`) from the first Settlement in that Region, or all when division would be zero |
| DJT/R10 | at resolved DJT year, transfer `1%` of every Settlement into `SITE-064`; State count becomes `25`; capital changes to the world's seizure target |
| Diagnostic regular migration | every `25` years, move `100` people (or all remaining if below 100) from `settlements[0]` to `settlements[1]` |
| Diagnostic social input | one aggregate cohort with `wealth = year` and population = world total |
| Diagnostic wealth summary | every 5 years: `aggregateWealthScore = totalPopulation * year` |
| Diagnostic checkpoints | every `5` years plus initial/final bookkeeping |
| Diagnostic government/economy | fixture labels by world, not raw-property history calculations |

Line references: `src/core/engine/diagnostic-runner.ts:11-14,37-80,84-112,123-151`.

## 17. Declared current owner-policy variables

`resources/canonical/policies/owner_policy.json` records these named policy values. Some are only partially reflected in current history code:

```text
populationParticipation = CIVIC_BHM_ONLY_PETS_EXCLUDED_V1
foodSuitability = DISABLED_V1
breedFactionPreference = RAW_PROPERTY_FACTION_POINTS_V1
migration = OWNER_MIGRATION_1_PERCENT_MEAN_PROPERTY_V1
foundingCardinality = EVERY_BROAD_UNHAPPY_FOUND_OR_JOIN_V1
foundingMotive = WEALTH_SOCIAL_TIER_V1
cultureFounderScope = GLOBAL_UNIQUE
cultureTie = HUMAN_BREED_FACTION_POPULATION_THEN_SEEDED_RANDOM_V1
djtNominalYear = 500
djtFiveYearOutboundScope = DISPLACED_R10_AND_CONSOLIDATED_SOVEREIGN_BREED
secession505 = ADJACENT_CITY_FACTION_DIFFERS_FROM_STATE_UP_TO_TWO_V1
rebalance525 = DISABLED_INITIAL_VERSION
conclavePre90 = ONE_SEAT_PER_CITY_V1
senate = TWO_PER_STATE_STAGGERED_10_YEAR_TERMS_50_AFTER_INNERWOOD
atrocityEffects = MARKERS_ONLY_NO_MECHANICAL_EFFECT
guideCausality = OUT_OF_SCOPE
```

The canonical history loader does not load `resources/canonical/policies/owner_policy.json` directly. It separately loads growth, mappings, adjacency, sovereign/DJT, and shared-event JSON. `src/core/engine/canonical-resume.ts:50-69`.

## 18. Important documentation/code mismatches

These are inventory findings, not code changes:

| Subject | Markdown/policy says | Current canonical code does |
|---|---|---|
| Founding population | 20% eligible Human Culture plus 25% nonmatching Beast/Mythos; owner policy uses terrain and wealth/social motive | moves 10% of every cohort in every member Settlement |
| Founding cardinality | every BROAD-unhappy Breed founds or joins compatible terrain | one new Settlement per current State per wave, when a same-Region Site exists |
| Founding site ranking | terrain, then attractiveness, then class priority, then Site ID | same Region as first State member; attractiveness then Site ID only |
| Migration wealth suppression | reduce wealthiest proposals to 75% or 50% | not applied |
| Wealth State layer | independent political State dominant faction | passes Settlement dominant faction as both Settlement and State controls |
| Wealth timing | accrue after final annual Settlement/State projections | accrues with growth from prior Settlement faction, before movement |
| Social timing | derive after final movement/wealth | derives before migration/founding/DJT |
| Cohort coalescing | do not coalesce different wealth/restriction state | merge key omits wealth/restriction and floors a population-weighted wealth average |
| Dominant species after year 0 | largest population kind; tie retains prior | any Human presence forces HUMAN; otherwise largest with lexical tie |
| Dominant Breed ties | culture, faction priority, then seeded random | population then lexical Breed ID in history loop |
| Culture ties | Breed-faction population then seeded random | lexical Culture ID in history loop after founding |
| Conclave timing | annual; reform at resolved ~90 | emitted only at exact 90 and final year |
| Senate timing | founded at resolved ~275 | hard threshold `year >= 275` |
| DJT five full years | block both affected groups for five full outbound years | `year < eventYear + 5`, with event-year migration already completed |
| Canonical migration cap | documented deterministic largest-remainder cap | active history gives rounding remainder to last sorted destination |

## 19. Explicit non-factors and deferred mechanics

The current Markdown/code review found no active variables for:

- births versus deaths as separate rates;
- fertility, age, sex, lifespan, mortality, disease, plague, war, or atrocity casualties;
- carrying capacity, overcrowding, housing, employment, wages, tax, prices, currency, debt, trade, production, consumption, or resource stocks;
- food availability (explicitly disabled);
- technology affecting population, migration, growth, or wealth;
- political/economic form directly modifying growth, migration, or wealth;
- Conclave/Senate representation feeding back into demographic/economic mechanics;
- post-2000 Conjunction mechanics.

Atrocity effects are explicitly deferred and population effect is zero. The implementation pack says no population loss may be applied until later owner rules exist (`ECHOES_OF_EIDOLON_SIMULATOR_CODEX_IMPLEMENTATION_PACK_2026-08-18/OPEN_DECISIONS_AND_FAIL_CLOSED_POLICY.md:239-249`).

## 20. Primary Markdown definitions reviewed

The consolidated requirements above come primarily from:

- `ECHOES_OF_EIDOLON_SIMULATOR_CODEX_IMPLEMENTATION_PACK_2026-08-18/CANONICAL_SIMULATION_CONTRACT.md:35-548`
- `ECHOES_OF_EIDOLON_SIMULATOR_CODEX_IMPLEMENTATION_PACK_2026-08-18/prompts/02_POPULATION_GOVERNANCE_WEALTH_SOCIAL.md:50-306`
- `ECHOES_OF_EIDOLON_SIMULATOR_CODEX_IMPLEMENTATION_PACK_2026-08-18/prompts/03_MIGRATION_FOUNDING_DJT_STATE.md:40-319`
- `ECHOES_OF_EIDOLON_SIMULATOR_CODEX_IMPLEMENTATION_PACK_2026-08-18/prompts/04_SHARED_TIMELINE_CONCLAVE_SENATE.md:35-210`
- `ECHOES_OF_EIDOLON_SIMULATOR_CODEX_IMPLEMENTATION_PACK_2026-08-18/OWNER_DECISIONS_REQUIRED.md:7-23`
- `ECHOES_OF_EIDOLON_SIMULATOR_CODEX_IMPLEMENTATION_PACK_2026-08-18/OPEN_DECISIONS_AND_FAIL_CLOSED_POLICY.md:59-249`
- `KNOWN_MISTAKES_FOR_REVIEW.md:23-29`

`ECHOES_OF_EIDOLON_SIMULATOR_CODEX_IMPLEMENTATION_PACK_2026-08-18/ALL_PROMPTS.md` repeats the prompt files as a consolidated copy; duplicate definitions were de-duplicated rather than counted as separate mechanics.
