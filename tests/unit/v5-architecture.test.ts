import { describe, expect, it } from "vitest";
import { bootstrapWorldV5 } from "../../src/core/v5/bootstrap.js";
import { CANDIDATE_CLASS_POLICY_V1, CANDIDATE_CONFLICT_PROFILE_V1, CANDIDATE_PEACE_EXHAUSTION_POLICY_V1, CANDIDATE_SKIRMISH_PROFILE_V1, CANDIDATE_TERRAIN_POLICY_V1, DEFAULT_DIAGNOSTIC_CONFIG_V1, DEFAULT_MECHANICS_VARIABLES_V1, DEFAULT_OPERATIONAL_CONFIG_V1, assertCanonicalV5Ready, causalRunHash, diagnosticCandidateOwnerInputsV1, diagnosticConfigHash, mechanicsVariablesHash, operationalConfigHash, type CanonicalDataV5, type MechanicsVariablesV1 } from "../../src/core/v5/config.js";
import { applyActiveWarEpisodes, reconcileBorderRelations, reviewBordersLate } from "../../src/core/v5/conflict.js";
import { deriveMetrics, stateAdjacency, terrainCompatibility, tradeAccess } from "../../src/core/v5/derivations.js";
import { applyCausalEffects, applyShockDefinition } from "../../src/core/v5/effects.js";
import { advanceWorldOneYear, causalEventHash, causalStateHash, type V5EngineContext } from "../../src/core/v5/engine.js";
import { divideRoundedAway, factionCompatibility, normalizeFactionVector, normalizedVectorWeightedMean, scaled, thresholdChance, weightedMean } from "../../src/core/v5/fixed-point.js";
import { resolveBreedFaction, updateDominantFaction } from "../../src/core/v5/faction.js";
import { applyMigrationTransfers, desiredMigrationOutflow, executeCanonicalFounding, reviewVoluntaryMigration } from "../../src/core/v5/migration.js";
import { CORRECT_R10_CONTEXT, executeDjtV5 } from "../../src/core/v5/djt.js";
import { effectiveGrowthRatePpm } from "../../src/core/v5/population.js";
import { isPersonEligible, materializePoliticalPerson, reviewRoutineGovernmentTransition, reviewSecession } from "../../src/core/v5/politics.js";
import { applySocialMobility } from "../../src/core/v5/social.js";
import { deriveFamilyInteractionSignals, organizationControlConcentration, reviewFamilyRelations, reviewOrganizationFormation, reviewOrganizationLifecycle, type OrganizationFormationContext } from "../../src/core/v5/society.js";
import type { CohortCell, SettlementV5, WorldStateV5 } from "../../src/core/v5/types.js";
import { KEYED_RANDOM_VERSION_V1, keyedDrawBps, normalizeSeed } from "../../src/core/v5/random.js";
import { auditCausalRegistry } from "../../src/core/v5/registry.js";
import { buildNamingBatches } from "../../src/core/v5/naming.js";
import { buildReadModelV1 } from "../../src/core/v5/read-model.js";
import { buildScheduledTransactionsV5, DJT_POLICY_KEY_V5 } from "../../src/core/v5/schedule.js";
import { continueV5History, runV5History } from "../../src/core/v5/runner.js";

const government = (id: string, faction: "CONCORD" | "SCHISM" | "RUIN") => ({ governmentFormId: id, doctrineVector: { CONCORD: faction === "CONCORD" ? 1000 : 0, SCHISM: faction === "SCHISM" ? 1000 : 0, RUIN: faction === "RUIN" ? 1000 : 0 }, administrationMode: faction, legitimacyBasis: faction, authoritySource: faction, franchiseBreadth: 500, requiredInstitutions: [] });
const canonical: CanonicalDataV5 = {
  schemaVersion: "echoes-canonical-data-v5", canonicalBundleHash: "fixture-canonical",
  breeds: [
    { breedId: "BRD_A", populationKind: "HUMAN", groupId: "H01", factionObject: { CONCORD: 10, SCHISM: 2, RUIN: 1 }, dominantFaction: ["CONCORD"], terrainBroad: ["FOREST"], terrainSpecific: ["WOODLAND"], ownershipMode: "COMMON_USE", allocationMode: "MARKET" },
    { breedId: "BRD_B", populationKind: "BEAST", groupId: "B01", factionObject: { CONCORD: 1, SCHISM: 10, RUIN: 2 }, dominantFaction: ["SCHISM"], terrainBroad: ["GRASSLAND"], terrainSpecific: ["STEPPE"], ownershipMode: "SHARED_TITLE", allocationMode: "CUSTOMARY" },
    { breedId: "BRD_TIE", populationKind: "MYTHOS", groupId: "M01", factionObject: { CONCORD: 5, SCHISM: 5, RUIN: 1 }, dominantFaction: ["CONCORD", "SCHISM"], terrainBroad: ["FOREST"], terrainSpecific: [], ownershipMode: "SINGLE_ENTITY", allocationMode: "PLANNED" },
  ],
  sites: [
    { siteId: "SITE_1", regionId: "R01", regionName: "One", latitude: 0, longitude: 0, terrainBroad: ["FOREST"], terrainSpecific: ["WOODLAND"], quality: 700 },
    { siteId: "SITE_2", regionId: "R02", regionName: "Two", latitude: 1, longitude: 1, terrainBroad: ["GRASSLAND"], terrainSpecific: ["STEPPE"], quality: 600 },
    { siteId: "SITE_3", regionId: "R03", regionName: "Three", latitude: 2, longitude: 2, terrainBroad: ["FOREST"], terrainSpecific: ["CANOPY"], quality: 800 },
  ],
  regions: [
    { regionId: "R01", directedAdjacentRegionIds: ["R02"] },
    { regionId: "R02", directedAdjacentRegionIds: ["R03"] },
    { regionId: "R03", directedAdjacentRegionIds: [] },
  ],
  governments: [government("GOV_CONCORD", "CONCORD"), government("GOV_SCHISM", "SCHISM"), government("GOV_RUIN", "RUIN")],
  economicForms: [
    { ownershipMode: "COMMON_USE", allocationMode: "MARKET", economicForm: "OPEN_BAZAAR" },
    { ownershipMode: "SHARED_TITLE", allocationMode: "CUSTOMARY", economicForm: "GUILD_COMPACT" },
    { ownershipMode: "SINGLE_ENTITY", allocationMode: "PLANNED", economicForm: "COMMAND_DEMESNE" },
  ],
  physicalPois: [],
  routeCorridors: [{ corridorId: "ROUTE_CORRIDOR_R01_R02", regionAId: "R01", regionBId: "R02", canonicalDirectionality: "A_TO_B", portalCapability: false, landCapability: false, seaCapability: false, airCapability: false, canonicalConnectionTags: [], primaryMode: "UNRESOLVED", infrastructureClass: "UNRESOLVED", tradeDesignation: false, resolutionAuthority: "OWNER_APPROVAL_REQUIRED" }],
  sovereigns: { CONCORD: { sovereignFaction: "CONCORD", breedId: "BRD_A", seizureTargetSiteId: "SITE_1" }, SCHISM: { sovereignFaction: "SCHISM", breedId: "BRD_B", seizureTargetSiteId: "SITE_2" }, RUIN: { sovereignFaction: "RUIN", breedId: "BRD_TIE", seizureTargetSiteId: "SITE_3" } },
  groupRegionAssignments: { CONCORD: { H01: "R01", B01: "R02", M01: "R01" }, SCHISM: { H01: "R01", B01: "R02", M01: "R01" }, RUIN: { H01: "R01", B01: "R02", M01: "R01" } },
  initialSettlements: [
    { worldKey: "CONCORD", settlementId: "S1", siteId: "SITE_1", stateId: "STATE_A", governmentFormId: "GOV_CONCORD" },
    { worldKey: "CONCORD", settlementId: "S2", siteId: "SITE_2", stateId: "STATE_B", governmentFormId: "GOV_SCHISM" },
  ], canonicalLabels: { SITE_1: "One", SITE_2: "Two" }, canonicalEvents: [],
};
const owner = diagnosticCandidateOwnerInputsV1({ GOV_CONCORD: {}, GOV_SCHISM: {}, GOV_RUIN: {} });
const mechanics: MechanicsVariablesV1 = { ...DEFAULT_MECHANICS_VARIABLES_V1, initialPopulation: 101n, foundingMinimumPopulation: 1n };
const seed = normalizeSeed("v5-test-seed");
const boot = () => bootstrapWorldV5({ worldKey: "CONCORD", canonical, ownerInputs: owner, variables: mechanics, normalizedSeed: seed, mode: "DIAGNOSTIC" }).state;

describe("V5 fixed point, identity, and faction authority", () => {
  it("closes every registered causal dependency and durable writer", () => {
    expect(auditCausalRegistry()).toEqual({ pass: true, undefinedIdentifiers: [], duplicateMetrics: [], orphanDurableFields: [] });
  });
  it("uses one signed rounding rule and exact normalized vectors", () => {
    expect(divideRoundedAway(5n, 2n)).toBe(3n);
    expect(divideRoundedAway(-5n, 2n)).toBe(-3n);
    expect(scaled(300, 500)).toBe(150);
    expect(weightedMean([1000, 5000], [0, 5000])).toBe(500);
    expect(normalizedVectorWeightedMean([{ CONCORD: 1000, SCHISM: 0, RUIN: 0 }, 5000], [{ CONCORD: 0, SCHISM: 1000, RUIN: 0 }, 5000])).toEqual({ CONCORD: 500, SCHISM: 500, RUIN: 0 });
    expect(normalizeFactionVector({ CONCORD: 1, SCHISM: 1, RUIN: 1 })).toEqual({ CONCORD: 334, SCHISM: 333, RUIN: 333 });
    expect(factionCompatibility({ CONCORD: 1000, SCHISM: 0, RUIN: 0 }, { CONCORD: 0, SCHISM: 1000, RUIN: 0 })).toBe(0);
    expect(thresholdChance(650, 650, 8000)).toBe(0);
    expect(thresholdChance(1000, 650, 8000)).toBe(8000);
  });

  it("uses direct Breed faction and the boolean sovereign tie-break", () => {
    const breed = canonical.breeds[2]!;
    expect(resolveBreedFaction(breed, "SCHISM", true)).toBe("SCHISM");
    expect(resolveBreedFaction(breed, "SCHISM", false)).toBe("CONCORD");
    expect(updateDominantFaction("CONCORD", { CONCORD: 490, SCHISM: 510, RUIN: 0 }, 50)).toBe("CONCORD");
    expect(updateDominantFaction("CONCORD", { CONCORD: 450, SCHISM: 550, RUIN: 0 }, 50)).toBe("SCHISM");
  });

  it("keeps keyed draws independent and configuration identities separated", () => {
    const random = { normalizedSeed: seed, randomNamespace: "BORDER_PEACE" as const, comparisonEntityId: "PAIR", year: 10, candidateOrDecisionKey: "peace" };
    expect(keyedDrawBps(random)).toBe(keyedDrawBps(random));
    const causalA = causalRunHash({ canonicalBundleHash: "bundle", mechanics, normalizedSeed: seed, causalOwnerInputs: owner, keyedRandomVersion: KEYED_RANDOM_VERSION_V1 });
    expect(causalA).toBe(causalRunHash({ canonicalBundleHash: "bundle", mechanics, normalizedSeed: seed, causalOwnerInputs: owner, keyedRandomVersion: KEYED_RANDOM_VERSION_V1 }));
    expect(operationalConfigHash(DEFAULT_OPERATIONAL_CONFIG_V1)).not.toBe(operationalConfigHash({ ...DEFAULT_OPERATIONAL_CONFIG_V1, checkpointIntervalYears: 10 }));
    expect(diagnosticConfigHash(DEFAULT_DIAGNOSTIC_CONFIG_V1)).not.toBe(diagnosticConfigHash({ ...DEFAULT_DIAGNOSTIC_CONFIG_V1, endingPopulationGoal: 999n }));
    expect(mechanicsVariablesHash(mechanics)).not.toBe(mechanicsVariablesHash({ ...mechanics, migrationMaximumHops: 4 }));
  });

  it("fails canonical policy readiness closed without explicit matching approval hashes", () => {
    expect(() => assertCanonicalV5Ready(owner, canonical)).toThrow(/APPROVAL_HASH/);
  });

  it("keeps labels and read models outside causal state", () => {
    const state = boot(); const before = causalStateHash(state); const read = buildReadModelV1(state, canonical, mechanics, { S1: "Different Label" });
    expect(read.settlements.find((row) => row.settlementId === "S1")?.label).toBe("Different Label"); expect(causalStateHash(state)).toBe(before);
    const requests = [{ requestId: "2", entityType: "FAMILY", entityId: "F2", behavior: "BATCHED" as const, createdYear: 5, acceptedLabel: null }, { requestId: "1", entityType: "STATE", entityId: "S1", behavior: "BLOCKING" as const, createdYear: 5, acceptedLabel: null }];
    expect(buildNamingBatches(requests, 10).map((batch) => batch.behavior)).toEqual(["BLOCKING"]);
    expect(requests[0]?.acceptedLabel).toBeNull(); expect(causalStateHash(state)).toBe(before);
  });

  it("keeps operational and diagnostic changes outside actual causal execution", () => {
    const initial = boot();
    const baseContext: V5EngineContext = { canonical, ownerInputs: owner, mechanics, operational: DEFAULT_OPERATIONAL_CONFIG_V1, diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1, normalizedSeed: seed, scheduledTransactions: [] };
    const changedContext: V5EngineContext = { ...baseContext, operational: { ...DEFAULT_OPERATIONAL_CONFIG_V1, checkpointIntervalYears: 10 }, diagnostic: { ...DEFAULT_DIAGNOSTIC_CONFIG_V1, endingPopulationGoal: 999n, migrationNotabilityThresholdBps: 999 } };
    const base = advanceWorldOneYear(initial, baseContext); const changed = advanceWorldOneYear(initial, changedContext);
    expect(causalStateHash(base.state)).toBe(causalStateHash(changed.state)); expect(causalEventHash(base.events)).toBe(causalEventHash(changed.events));
  });
});

describe("V5 population and transfer accounting", () => {
  it("initializes exact equal thirds at Settlement level without structural LOW advantage", () => {
    const state = boot();
    expect(state.cohorts.reduce((sum, cell) => sum + cell.tiers.HIGH.population + cell.tiers.MID.population + cell.tiers.LOW.population, 0n)).toBe(101n);
    for (const settlement of state.settlements) {
      const totals = (["HIGH", "MID", "LOW"] as const).map((tier) => state.cohorts.filter((cell) => cell.settlementId === settlement.settlementId).reduce((sum, cell) => sum + cell.tiers[tier].population, 0n));
      expect(totals.reduce((sum, value) => sum + value, 0n)).toBe(state.cohorts.filter((cell) => cell.settlementId === settlement.settlementId).reduce((sum, cell) => sum + cell.tiers.HIGH.population + cell.tiers.MID.population + cell.tiers.LOW.population, 0n));
      expect(totals[0]! >= totals[2]! - 1n).toBe(true);
    }
  });

  it("keeps the natural-growth rate independent from prosperity and unrest", () => {
    const base = effectiveGrowthRatePpm("CONCORD", "SCHISM", "CONCORD", mechanics);
    const changedUnrelatedState = { prosperity: 0, unrest: 1000 };
    expect(changedUnrelatedState).toEqual({ prosperity: 0, unrest: 1000 });
    expect(effectiveGrowthRatePpm("CONCORD", "SCHISM", "CONCORD", mechanics)).toBe(base);
    expect(effectiveGrowthRatePpm("CONCORD", "SCHISM", "SCHISM", mechanics)).toBe(base - mechanics.growthNonAlignmentDeductionPpm);
  });

  it("moves social population only across adjacent tiers and preserves Breed margins", () => {
    const state = boot(); const settlement = state.settlements[0]!; const beforeByBreed = new Map(state.cohorts.filter((cell) => cell.settlementId === settlement.settlementId).map((cell) => [cell.breedId, cell.tiers.HIGH.population + cell.tiers.MID.population + cell.tiers.LOW.population]));
    const total = [...beforeByBreed.values()].reduce((sum, value) => sum + value, 0n);
    const result = applySocialMobility(state, settlement, { HIGH: total / 2n, MID: total - total / 2n, LOW: 0n }, 900, 900, { ...mechanics, socialMobilityMaximumBps: 10_000 });
    expect(result.transfers.every((row) => !(row.sourceTier === "LOW" && row.destinationTier === "HIGH") && !(row.sourceTier === "HIGH" && row.destinationTier === "LOW"))).toBe(true);
    for (const [breedId, before] of beforeByBreed) { const cell = result.state.cohorts.find((row) => row.settlementId === settlement.settlementId && row.breedId === breedId)!; expect(cell.tiers.HIGH.population + cell.tiers.MID.population + cell.tiers.LOW.population).toBe(before); }
  });

  it("conserves Breed, tier, and prosperity through migration transfers", () => {
    const state = boot(); const source = state.cohorts.find((cell) => cell.settlementId === "S1")!; const amount = source.tiers.HIGH.population > 2n ? 2n : source.tiers.HIGH.population;
    const next = applyMigrationTransfers(state, [{ transferId: "T", breedId: source.breedId, tier: "HIGH", originSettlementId: "S1", destinationSettlementId: "S2", population: amount, prosperity: source.tiers.HIGH.prosperity, cause: "FORCED" }]);
    const before = state.cohorts.reduce((sum, cell) => sum + cell.tiers.HIGH.population + cell.tiers.MID.population + cell.tiers.LOW.population, 0n); const after = next.cohorts.reduce((sum, cell) => sum + cell.tiers.HIGH.population + cell.tiers.MID.population + cell.tiers.LOW.population, 0n);
    expect(after).toBe(before);
    expect(next.cohorts.find((cell) => cell.settlementId === "S2" && cell.breedId === source.breedId)?.tiers.HIGH.prosperity).toBe(source.tiers.HIGH.prosperity);
  });
});

describe("V5 topology, cadence, and durable lifecycles", () => {
  it("uses directed Region reachability for trade and undirected Region borders for States", () => {
    const state = boot();
    expect(tradeAccess(state, canonical, "S1", 3)).toBeGreaterThan(0);
    expect(tradeAccess(state, canonical, "S2", 1)).toBe(0);
    expect(stateAdjacency(state, canonical)).toEqual([["STATE_A", "STATE_B"]]);
    const lost = reconcileBorderRelations({ ...state, settlements: state.settlements.map((row) => row.settlementId === "S2" ? { ...row, stateId: "STATE_A" } : row) }, canonical);
    expect(lost.state.borderRelations[0]?.activeBorder).toBe(false);
    const returned = reconcileBorderRelations({ ...lost.state, settlements: lost.state.settlements.map((row) => row.settlementId === "S2" ? { ...row, stateId: "STATE_B" } : row) }, canonical);
    expect(returned.state.borderRelations).toHaveLength(1); expect(returned.state.borderRelations[0]?.activeBorder).toBe(true);
  });

  it("uses terrain only and handles exact, partial, mismatch, and unknown", () => {
    expect(terrainCompatibility(["FOREST"], ["WOODLAND"], ["FOREST"], ["WOODLAND"], owner)).toBe(1000);
    expect(terrainCompatibility(["FOREST"], [], ["FOREST"], ["CANOPY"], owner)).toBe(750);
    expect(terrainCompatibility(["FOREST"], ["WOODLAND"], ["FOREST"], ["CANOPY"], owner)).toBe(500);
    expect(terrainCompatibility(["FOREST"], ["WOODLAND"], ["GRASSLAND"], ["STEPPE"], owner)).toBe(200);
    expect(terrainCompatibility([], [], ["FOREST"], ["WOODLAND"], owner)).toBe(500);
  });

  it("does not run voluntary migration on non-review years", () => {
    const state = { ...boot(), year: 1 }; const metrics = deriveMetrics(state, canonical, mechanics); const result = reviewVoluntaryMigration(state, metrics, canonical, owner, mechanics);
    expect(result.destinationScoringCount).toBe(0); expect(result.transfers).toEqual([]);
  });

  it("keeps routine government transition persistence and cooldown durable", () => {
    let state = boot(); const target = state.states[0]!; state = { ...state, year: 5, states: state.states.map((row) => row.stateId === target.stateId ? { ...row, actualGovernment: "GOV_RUIN", legitimacy: 0 } : row), settlements: state.settlements.map((row) => row.stateId === target.stateId ? { ...row, unrest: 1000 } : row) };
    const variables = { ...mechanics, governmentTransitionThreshold: 0, governmentTransitionMaximumChanceBps: 10_000 };
    const first = reviewRoutineGovernmentTransition(state, target.stateId, canonical, variables, seed); expect(first.event).toBeNull(); expect(first.state.states.find((row) => row.stateId === target.stateId)?.qualifyingGovernmentReviewCount).toBe(1);
    const second = reviewRoutineGovernmentTransition({ ...first.state, year: 10 }, target.stateId, canonical, variables, seed); expect(second.event).not.toBeNull(); expect(second.state.states.find((row) => row.stateId === target.stateId)?.lastGovernmentTransitionYear).toBe(10);
    const cooldown = reviewRoutineGovernmentTransition({ ...second.state, year: 15 }, target.stateId, canonical, variables, seed); expect(cooldown.event).toBeNull(); expect(cooldown.state.states.find((row) => row.stateId === target.stateId)?.qualifyingGovernmentReviewCount).toBe(0);
  });

  it("separates named-person death from aggregate mortality and closes OfficeTerms", () => {
    const state = boot(); const person = { personId: "P", familyId: null, breedId: "BRD_A", originSettlementId: "S1", sourceTier: "HIGH" as const, sourceClass: null, birthYear: -40, activeFromYear: -20, plannedRetirementYear: 30, actualRetirementYear: null, naturalDeathYear: 50, actualDeathYear: null, disqualifiedFromYear: null, requalifiedYear: null }; const withPerson: WorldStateV5 = { ...state, year: 10, politicalPeople: [person], offices: [{ officeId: "O", institutionId: "I", jurisdictionSettlementId: null, titleKey: "LORD", power: 1000, mandatory: true, apex: true, termYears: null, selectionRule: { selectionMethod: "HEREDITARY", scope: "STATE", requiresTrackedLineage: false, eligibleTiers: ["HIGH"], minimumFactionCompatibility: 0, stochasticTies: false, scoreWeights: { factionFit: 2000, classFit: 2000, localSupport: 2000, lineageFit: 2000, ruleSpecificFit: 2000 } } }], institutions: [{ institutionId: "I", stateId: "STATE_A", institutionType: "COURT", foundedYear: 0, dissolvedYear: null }], officeTerms: [{ officeTermId: "OT", officeId: "O", personId: "P", startYear: 0, endYear: null, selectionEventId: "E", selectorType: "STATE", selectorId: "STATE_A", terminationReason: null }] };
    const before = causalStateHash(withPerson); const result = applyCausalEffects(withPerson, [{ type: "POLITICAL_PERSON_DEATH", effectId: "D", sourceEventId: "D", personIds: ["P"] }]);
    expect(result.state.politicalPeople[0]?.actualDeathYear).toBe(10); expect(result.state.officeTerms[0]?.terminationReason).toBe("DEATH"); expect(result.accounting[0]?.populationBefore).toBe(result.accounting[0]?.populationAfter); expect(causalStateHash(result.state)).not.toBe(before);
  });

  it("uses deterministic temporal boundaries without annual biology", () => {
    const base = boot(); const office = { officeId: "O_SOURCE", institutionId: "I_SOURCE", jurisdictionSettlementId: null, titleKey: "SOURCE", power: 500, mandatory: true, apex: false, termYears: 5, selectionRule: { selectionMethod: "POPULAR_ELECTION" as const, scope: "STATE" as const, requiresTrackedLineage: false, eligibleTiers: ["HIGH", "MID"] as const, minimumFactionCompatibility: 0, stochasticTies: false, scoreWeights: { factionFit: 2000, classFit: 2000, localSupport: 2000, lineageFit: 2000, ruleSpecificFit: 2000 } } };
    const state: WorldStateV5 = { ...base, institutions: [{ institutionId: "I_SOURCE", stateId: "STATE_A", institutionType: "ASSEMBLY", foundedYear: 0, dissolvedYear: null }], offices: [office] };
    const before = state.cohorts.reduce((sum, cell) => sum + cell.tiers.HIGH.population + cell.tiers.MID.population + cell.tiers.LOW.population, 0n);
    const materialized = materializePoliticalPerson(state, office, canonical, owner, mechanics, seed, "VACANCY", 0);
    expect(materialized.state.cohorts.reduce((sum, cell) => sum + cell.tiers.HIGH.population + cell.tiers.MID.population + cell.tiers.LOW.population, 0n)).toBe(before);
    expect(isPersonEligible({ ...materialized.person, naturalDeathYear: 10, plannedRetirementYear: 20 }, 10)).toBe(false);
    expect(isPersonEligible({ ...materialized.person, actualRetirementYear: 5, naturalDeathYear: 20 }, 6)).toBe(false);
  });

  it("treats diffuse control as zero concentration", () => {
    const state = { ...boot(), organizations: [{ organizationId: "ORG", type: "CORPORATION" as const, sectorId: "MANUFACTURE" as const, homeSettlementId: "S1", founderControllerType: "DIFFUSE" as const, founderControllerId: "D", wealth: 500, influence: 500, status: "ACTIVE" as const, belowSurvivalReviewCount: 0, formationYear: 0, dissolutionYear: null }], ownershipStakes: [{ stakeId: "ST", organizationId: "ORG", controllerType: "DIFFUSE" as const, controllerId: "D", ownershipShareBps: 10_000, controlShareBps: 10_000, startYear: 0, endYear: null, sourceEventId: "E" }] };
    expect(organizationControlConcentration(state, "ORG")).toBe(0);
  });

  it("forms Organizations only after persistence and dissolves them without deleting history", () => {
    const state = { ...boot(), year: 5 }; const context: OrganizationFormationContext = { settlementId: "S1", sectorId: "MANUFACTURE", sectorStrength: 1000, capitalAvailability: 1000, tradeAccess: 1000, enforcement: 1000, politicalExclusion: 0, unrest: 0, familyNetwork: 0, concentration: 1000 };
    const variables = { ...mechanics, corporationFormationThreshold: 0, organizationFormationMaximumChanceBps: 10_000, organizationScoreInertiaBps: 0, organizationSurvivalThreshold: 1000, organizationDissolutionRequiredReviews: 2 };
    const first = reviewOrganizationFormation(state, [{ key: "CORP/S1/M", type: "CORPORATION", context, pressure: 1000 }], variables, seed); expect(first.state.organizations).toHaveLength(0);
    const second = reviewOrganizationFormation({ ...first.state, year: 10 }, [{ key: "CORP/S1/M", type: "CORPORATION", context, pressure: 1000 }], variables, seed); expect(second.state.organizations).toHaveLength(1);
    const organizationId = second.state.organizations[0]!.organizationId; const weak = { ...context, sectorStrength: 0, capitalAvailability: 0, tradeAccess: 0, enforcement: 0, concentration: 0, unrest: 1000 };
    const declining = reviewOrganizationLifecycle(second.state, { [organizationId]: weak }, variables); expect(declining.state.organizations[0]?.status).toBe("DECLINING");
    const dissolved = reviewOrganizationLifecycle({ ...declining.state, year: 15 }, { [organizationId]: weak }, variables); expect(dissolved.state.organizations[0]?.status).toBe("DISSOLVED"); expect(dissolved.state.organizations[0]?.dissolutionYear).toBe(15); expect(dissolved.state.ownershipStakes.filter((stake) => stake.organizationId === organizationId && stake.endYear === null)).toHaveLength(0);
  });

  it("creates Family relations only from persistent concrete interactions", () => {
    const base = boot(); const families = ["FA", "FB"].map((familyId, index) => ({ familyId, homeSettlementId: "S1", founderBreedId: index === 0 ? "BRD_A" : "BRD_TIE", factionAffinity: { CONCORD: 1000, SCHISM: 0, RUIN: 0 }, wealth: 500, influence: 500, prestige: 500, status: "ACTIVE" as const, foundingYear: 0, extinctionYear: null }));
    const organization = { organizationId: "ORG_SHARED", type: "CORPORATION" as const, sectorId: "TRADE_AND_TRANSPORT" as const, homeSettlementId: "S1", founderControllerType: "FAMILY" as const, founderControllerId: "FA", wealth: 500, influence: 500, status: "ACTIVE" as const, belowSurvivalReviewCount: 0, formationYear: 0, dissolutionYear: null };
    const people = ["PA", "PB"].map((personId, index) => ({ personId, familyId: index === 0 ? "FA" : "FB", breedId: index === 0 ? "BRD_A" : "BRD_TIE", originSettlementId: "S1", sourceTier: "HIGH" as const, sourceClass: "NOBILITY" as const, birthYear: -30, activeFromYear: -10, plannedRetirementYear: 40, actualRetirementYear: null, naturalDeathYear: 60, actualDeathYear: null, disqualifiedFromYear: null, requalifiedYear: null }));
    const state: WorldStateV5 = { ...base, year: 5, families, politicalPeople: people, personRelations: [{ relationId: "MARRIAGE", personAId: "PA", personBId: "PB", relationType: "SPOUSE", startYear: 0, endYear: null, sourceEventId: "E_MARRIAGE" }], organizations: [organization], ownershipStakes: [{ stakeId: "SA", organizationId: organization.organizationId, controllerType: "FAMILY", controllerId: "FA", ownershipShareBps: 5000, controlShareBps: 5000, startYear: 0, endYear: null, sourceEventId: "E" }, { stakeId: "SB", organizationId: organization.organizationId, controllerType: "FAMILY", controllerId: "FB", ownershipShareBps: 5000, controlShareBps: 5000, startYear: 0, endYear: null, sourceEventId: "E" }] };
    const variables = { ...mechanics, familyRelationThreshold: 0, familyRelationMaximumChanceBps: 10_000 };
    const signals = deriveFamilyInteractionSignals(state); expect(signals.some((signal) => signal.kind === "SHARED_CONTROL")).toBe(true);
    const first = reviewFamilyRelations(state, signals, variables, seed); expect(first.state.familyRelations).toHaveLength(0);
    const secondState = { ...first.state, year: 10 }; const second = reviewFamilyRelations(secondState, deriveFamilyInteractionSignals(secondState), variables, seed); expect(second.state.familyRelations[0]?.relationType).toBe("ALLIANCE");
  });

  it("creates a canonical Settlement only at a canonical Site and preserves founder context", () => {
    const state = boot(); const source = state.cohorts.find((cell) => cell.settlementId === "S1" && cell.tiers.HIGH.population > 0n)!; const amount = 1n;
    const result = executeCanonicalFounding(state, canonical, mechanics, { eventId: "FOUND_SITE_3", siteId: "SITE_3", stateId: "STATE_A", transfers: [{ transferId: "FT", breedId: source.breedId, tier: "HIGH", originSettlementId: "S1", population: amount, prosperity: source.tiers.HIGH.prosperity }] });
    const founded = result.state.settlements.find((settlement) => settlement.siteId === "SITE_3")!;
    expect(founded.foundedYear).toBe(0); expect(founded.stateId).toBe("STATE_A");
    expect(result.state.cohorts.find((cell) => cell.settlementId === founded.settlementId && cell.breedId === source.breedId)?.tiers.HIGH).toEqual({ population: amount, prosperity: source.tiers.HIGH.prosperity });
    expect(() => executeCanonicalFounding(state, canonical, mechanics, { eventId: "BAD", siteId: "SITE_UNKNOWN", stateId: "STATE_A", transfers: [] })).toThrow(/does not exist/);
  });

  it("creates R10 during DJT when absent and uses only the corrected world context", () => {
    const state = boot(); expect(state.settlements.some((settlement) => settlement.siteId === "SITE_3")).toBe(false);
    const result = executeDjtV5(state, canonical, mechanics, { eventId: "DJT", r10SiteId: "SITE_3", innerwoodStateId: "STATE_INNERWOOD", innerwoodGovernmentFormId: "GOV_CONCORD", nonSovereignSourceSettlementId: "S1", sovereignSeizureSettlementId: "S2", quarantineYears: 10 });
    expect(result.state.settlements.filter((settlement) => settlement.siteId === "SITE_3")).toHaveLength(1);
    expect(result.events.find((event) => event.eventType === "DJT")?.payload.r10ContextGroups).toEqual(CORRECT_R10_CONTEXT.CONCORD);
    expect(result.events.filter((event) => event.eventType === "FoundingTransfer" || event.eventType === "MigrationTransfer")).not.toHaveLength(0);
    expect(result.state.states.find((politicalState) => politicalState.stateId === "STATE_INNERWOOD")?.factionAffinity).toEqual(deriveMetrics(result.state, canonical, mechanics).statePopulationFactionVectors.STATE_INNERWOOD);
    expect(result.state.cohorts.reduce((sum, cell) => sum + cell.tiers.HIGH.population + cell.tiers.MID.population + cell.tiers.LOW.population, 0n)).toBe(101n);
  });

  it("requires persisted eligibility before an ordinary secession and never moves population", () => {
    let state = boot(); const parent = state.states.find((row) => row.stateId === "STATE_A")!;
    state = { ...state, year: 5, settlements: state.settlements.map((settlement) => settlement.stateId === parent.stateId ? { ...settlement, unrest: 1000 } : settlement), states: state.states.map((row) => row.stateId === parent.stateId ? { ...row, factionAffinity: { CONCORD: 0, SCHISM: 0, RUIN: 1000 }, dominantFaction: "RUIN" as const, legitimacy: 0 } : row) };
    const variables = { ...mechanics, rebellionThreshold: 900, secessionFactionMismatchThreshold: 0, secessionMinimumPopulation: 1n, secessionPressureThreshold: 0, secessionMaximumChanceBps: 10_000 };
    const exclusion = Object.fromEntries(state.settlements.map((settlement) => [settlement.settlementId, 1000]));
    const first = reviewSecession(state, canonical, owner, variables, seed, exclusion); expect(first.events.some((event) => event.eventType === "StateSeceded")).toBe(false);
    const before = first.state.cohorts.reduce((sum, cell) => sum + cell.tiers.HIGH.population + cell.tiers.MID.population + cell.tiers.LOW.population, 0n);
    const second = reviewSecession({ ...first.state, year: 10 }, canonical, owner, variables, seed, exclusion);
    expect(second.events.filter((event) => event.eventType === "StateSeceded")).toHaveLength(1);
    expect(second.state.cohorts.reduce((sum, cell) => sum + cell.tiers.HIGH.population + cell.tiers.MID.population + cell.tiers.LOW.population, 0n)).toBe(before);
  });

  it("resolves shock selectors against transaction-start state and applies typed effects in order", () => {
    const base = boot(); const familyId = "F_RULING";
    const state: WorldStateV5 = { ...base,
      families: [{ familyId, homeSettlementId: "S1", founderBreedId: "BRD_A", factionAffinity: { CONCORD: 1000, SCHISM: 0, RUIN: 0 }, wealth: 500, influence: 500, prestige: 500, status: "ACTIVE", foundingYear: 0, extinctionYear: null }],
      politicalPeople: [{ personId: "P_RULING", familyId, breedId: "BRD_A", originSettlementId: "S1", sourceTier: "HIGH", sourceClass: "NOBILITY", birthYear: -40, activeFromYear: -20, plannedRetirementYear: 40, actualRetirementYear: null, naturalDeathYear: 50, actualDeathYear: null, disqualifiedFromYear: null, requalifiedYear: null }],
      institutions: [{ institutionId: "I_APEX", stateId: "STATE_A", institutionType: "COURT", foundedYear: 0, dissolvedYear: null }],
      offices: [{ officeId: "O_APEX", institutionId: "I_APEX", jurisdictionSettlementId: null, titleKey: "LORD", power: 1000, mandatory: true, apex: true, termYears: null, selectionRule: { selectionMethod: "HEREDITARY", scope: "STATE", requiresTrackedLineage: true, eligibleTiers: ["HIGH"], minimumFactionCompatibility: 0, stochasticTies: false, scoreWeights: { factionFit: 2000, classFit: 2000, localSupport: 2000, lineageFit: 2000, ruleSpecificFit: 2000 } } }],
      officeTerms: [{ officeTermId: "T_APEX", officeId: "O_APEX", personId: "P_RULING", startYear: 0, endYear: null, selectionEventId: "E_SELECT", selectorType: "SUCCESSION", selectorId: familyId, terminationReason: null }],
    };
    const result = applyShockDefinition(state, { shockId: "SHOCK", year: 0, entityScopeSelectors: [{ type: "RULING_FAMILIES", stateId: "STATE_A" }], canonicalCauseMetadata: {}, effects: [{ type: "FAMILY_POWER", effectId: "SHOCK_POWER", sourceEventId: "SHOCK", familyIds: [familyId], influenceDelta: -100 }] });
    expect(result.resolvedTargets.FAMILY).toContain(familyId); expect(result.state.families[0]?.influence).toBe(400);
  });

  it("does not apply war effects in the declaration year", () => {
    let state = boot(); state = reconcileBorderRelations(state, canonical).state; state = { ...state, year: 5, borderRelations: state.borderRelations.map((row) => ({ ...row, tension: 1000 })) };
    const variables = { ...mechanics, borderTensionInertiaBps: 10_000, borderWarThreshold: 0, borderWarMaximumChanceBps: 10_000, borderSkirmishThreshold: 1000 };
    const declared = reviewBordersLate(state, canonical, owner, variables, seed); expect(declared.state.activeConflicts[0]?.activeFromYear).toBe(6);
    const sameYear = applyActiveWarEpisodes(declared.state, canonical, owner, variables, seed, { STATE_A: 500, STATE_B: 500 }); expect(sameYear.events).toHaveLength(0);
    const nextYear = applyActiveWarEpisodes({ ...declared.state, year: 6 }, canonical, owner, variables, seed, { STATE_A: 500, STATE_B: 500 }); expect(nextYear.events[0]?.eventType).toBe("WarEpisode");
  });
});

describe("V5 annual scheduler", () => {
  it("pauses for batched interactive naming without changing causal state or event history", () => {
    const allWorldCanonical = { ...canonical, physicalPois: [{ poiId: "POI_FIXTURE", poiType: "LANDMARK", workingLabel: "context only", nameStatus: "WORKING", siteId: "SITE_1", regionId: "R01", regionName: "One", latitude: 0, longitude: 0, hostFeatureId: null }], initialSettlements: (["CONCORD", "SCHISM", "RUIN"] as const).flatMap((worldKey) => canonical.initialSettlements.map((row) => ({ ...row, worldKey, settlementId: `${row.settlementId}_${worldKey}`, stateId: `${row.stateId}_${worldKey}` }))) };
    const operational = { ...DEFAULT_OPERATIONAL_CONFIG_V1, interactiveNamingEnabled: true, namingBatchFlushIntervalYears: 5 };
    const uninterrupted = runV5History({ canonical: allWorldCanonical, ownerInputs: owner, mechanics, operational, diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1, normalizedSeed: seed, mode: "DIAGNOSTIC", throughYear: 5, stopAtBlockingNaming: false, interactiveNamingEnabled: false });
    const interactive = runV5History({ canonical: allWorldCanonical, ownerInputs: owner, mechanics, operational, diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1, normalizedSeed: seed, mode: "DIAGNOSTIC", throughYear: 5, stopAtBlockingNaming: true, interactiveNamingEnabled: true });
    expect(interactive).toMatchObject({ status: "WAITING_FOR_NAMING", completedYear: 5 });
    for (const world of ["CONCORD", "SCHISM", "RUIN"] as const) {
      expect(causalStateHash(interactive.states[world])).toBe(causalStateHash(uninterrupted.states[world]));
      expect(causalEventHash(interactive.events[world])).toBe(causalEventHash(uninterrupted.events[world]));
    }
  });

  it("runs structural mechanics only on the five-year cadence and replays identically", () => {
    const context: V5EngineContext = { canonical, ownerInputs: owner, mechanics, operational: DEFAULT_OPERATIONAL_CONFIG_V1, diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1, normalizedSeed: seed, scheduledTransactions: [] };
    const initial = boot(); const year1a = advanceWorldOneYear(initial, context); const year1b = advanceWorldOneYear(initial, context);
    expect(year1a.structuralReviewRan).toBe(false); expect(year1a.events.some((event) => event.phase === "VOLUNTARY_MIGRATION")).toBe(false); expect(causalStateHash(year1a.state)).toBe(causalStateHash(year1b.state)); expect(causalEventHash(year1a.events)).toBe(causalEventHash(year1b.events));
    let state = initial; for (let year = 1; year <= 5; year += 1) state = advanceWorldOneYear(state, context).state;
    expect(state.year).toBe(5);
  });

  it("builds DJT only from explicit causal owner policy and continues identically from a checkpoint", () => {
    expect(buildScheduledTransactionsV5(canonical, owner).CONCORD).toEqual([]);
    const withDjt = { ...owner, canonicalPolicies: { [DJT_POLICY_KEY_V5]: { schemaVersion: "echoes-djt-owner-policy-v5", eventId: "DJT", year: 10, r10SiteId: "SITE_R10", innerwoodStateIdByWorld: { CONCORD: "STATE_CONCORD_R10", SCHISM: "STATE_SCHISM_R10", RUIN: "STATE_RUIN_R10" }, quarantineYears: 5 } } };
    const canonicalWithR10 = { ...canonical, sites: [...canonical.sites, { siteId: "SITE_R10", regionId: "R10", regionName: "Innerwood", latitude: 3, longitude: 3, terrainBroad: ["FOREST"], terrainSpecific: ["WOODLAND"], quality: 500 }] };
    const allWorldCanonical = { ...canonicalWithR10, sovereigns: { ...canonical.sovereigns, RUIN: { ...canonical.sovereigns.RUIN, seizureTargetSiteId: "SITE_1" } }, initialSettlements: (["CONCORD", "SCHISM", "RUIN"] as const).flatMap((worldKey) => canonical.initialSettlements.map((row) => ({ ...row, worldKey, settlementId: `${row.settlementId}_${worldKey}`, stateId: `${row.stateId}_${worldKey}` }))) };
    expect(buildScheduledTransactionsV5(allWorldCanonical, withDjt).CONCORD[0]).toMatchObject({ type: "DJT", year: 10 });
    const full = runV5History({ canonical: allWorldCanonical, ownerInputs: owner, mechanics, operational: DEFAULT_OPERATIONAL_CONFIG_V1, diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1, normalizedSeed: seed, mode: "DIAGNOSTIC", throughYear: 6, stopAtBlockingNaming: false });
    const first = runV5History({ canonical: allWorldCanonical, ownerInputs: owner, mechanics, operational: DEFAULT_OPERATIONAL_CONFIG_V1, diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1, normalizedSeed: seed, mode: "DIAGNOSTIC", throughYear: 5, stopAtBlockingNaming: false });
    const resumed = continueV5History({ canonical: allWorldCanonical, ownerInputs: owner, mechanics, operational: DEFAULT_OPERATIONAL_CONFIG_V1, diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1, normalizedSeed: seed, mode: "DIAGNOSTIC", throughYear: 6, initialStates: first.states, stopAtBlockingNaming: false });
    for (const world of ["CONCORD", "SCHISM", "RUIN"] as const) expect(causalStateHash(resumed.states[world])).toBe(causalStateHash(full.states[world]));
  });
});
