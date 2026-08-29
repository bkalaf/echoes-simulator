import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_DIAGNOSTIC_CONFIG_V1, DEFAULT_MECHANICS_VARIABLES_V1, DEFAULT_OPERATIONAL_CONFIG_V1, diagnosticCandidateOwnerInputsV1, mechanicsVariablesHash, type CanonicalDataV5 } from "../../src/core/v5/config.js";
import { restoreMechanicsVariablesV1, restoreOperationalConfigV1 } from "../../src/core/v5/configuration.js";
import { buildEphemeralWorldIndexesV5 } from "../../src/core/v5/indexes.js";
import { applyTemporalEventsV5 } from "../../src/core/v5/engine.js";
import { applyCausalEffects } from "../../src/core/v5/effects.js";
import { ensurePopulationSlicesV5, reconcilePublicPopulationSlicesV5 } from "../../src/core/v5/population-slices.js";
import { canonicalJson } from "../../src/core/serialization/canonical-json.js";
import { reviewAllSettlementsSocialMobilityV5, reviewSettlementSocialMobility } from "../../src/core/v5/social.js";
import type { V5PerformanceTimingSample } from "../../src/core/v5/performance.js";
import { V5_EMPTY_EVENT_HISTORY_HASH } from "../../src/core/v5/persistence.js";
import { normalizeSeed } from "../../src/core/v5/random.js";
import { createDeepReadonlyViewV5, freezeCommittedCausalStateV5, runV5History } from "../../src/core/v5/runner.js";
import { shouldBuildDivergenceDiagnosticV5 } from "../../src/core/v5/service.js";
import type { WorldKey, WorldStateV5 } from "../../src/core/v5/types.js";
import { SimulatorStore } from "../../src/persistence/sqlite-store.js";

const canonical: CanonicalDataV5 = {
  schemaVersion: "echoes-canonical-data-v5", canonicalBundleHash: "performance-remediation-fixture",
  breeds: [{ breedId: "B1", populationKind: "HUMAN", groupId: "G", factionObject: { CONCORD: 1, SCHISM: 1, RUIN: 1 }, dominantFaction: ["CONCORD"], terrainBroad: ["FOREST"], terrainSpecific: ["WOODLAND"], ownershipMode: "COMMON", allocationMode: "MARKET" }],
  sites: [{ siteId: "SITE", regionId: "REGION", regionName: "Region", latitude: 0, longitude: 0, terrainBroad: ["FOREST"], terrainSpecific: ["WOODLAND"], quality: 500 }], regions: [{ regionId: "REGION", directedAdjacentRegionIds: [] }],
  governments: [{ governmentFormId: "GOV", doctrineVector: { CONCORD: 334, SCHISM: 333, RUIN: 333 }, administrationMode: "CIVIC", legitimacyBasis: "CIVIC", authoritySource: "CIVIC", franchiseBreadth: 500, requiredInstitutions: [{ institutionType: "GOVERNMENT", offices: [{ jurisdictionSettlementId: null, titleKey: "RULER", power: 1000, mandatory: true, apex: true, termYears: 10, selectionRule: { selectionMethod: "RULER_APPOINTMENT", scope: "STATE", requiresTrackedLineage: false, eligibleTiers: ["HIGH", "MID"], minimumFactionCompatibility: 0, stochasticTies: false, scoreWeights: { factionFit: 3500, classFit: 1000, localSupport: 3000, lineageFit: 1500, ruleSpecificFit: 1000 } } }] }] }],
  economicForms: [{ ownershipMode: "COMMON", allocationMode: "MARKET", economicForm: "MARKET" }], physicalPois: [], routeCorridors: [],
  sovereigns: { CONCORD: { sovereignFaction: "CONCORD", breedId: "B1", seizureTargetSiteId: "SITE" }, SCHISM: { sovereignFaction: "SCHISM", breedId: "B1", seizureTargetSiteId: "SITE" }, RUIN: { sovereignFaction: "RUIN", breedId: "B1", seizureTargetSiteId: "SITE" } },
  groupRegionAssignments: { CONCORD: { G: "REGION" }, SCHISM: { G: "REGION" }, RUIN: { G: "REGION" } }, initialSettlements: [{ worldKey: "CONCORD", settlementId: "S_CONCORD", siteId: "SITE", stateId: "STATE_CONCORD", governmentFormId: "GOV" }, { worldKey: "SCHISM", settlementId: "S_SCHISM", siteId: "SITE", stateId: "STATE_SCHISM", governmentFormId: "GOV" }, { worldKey: "RUIN", settlementId: "S_RUIN", siteId: "SITE", stateId: "STATE_RUIN", governmentFormId: "GOV" }], canonicalLabels: {}, canonicalEvents: [],
};

function state(worldKey: WorldKey = "CONCORD"): WorldStateV5 {
  return {
    schemaVersion: "echoes-world-state-v5", worldKey, year: 0,
    cohorts: [{ settlementId: "S1", breedId: "B1", tiers: { HIGH: { population: 3n, prosperity: 700 }, MID: { population: 5n, prosperity: 500 }, LOW: { population: 7n, prosperity: 300 } } }],
    settlements: [{ settlementId: "S1", siteId: "SITE", regionId: "REGION", stateId: "STATE", foundedYear: 0, unrest: 0, sectorStrengths: { LAND_AND_FOOD: 500, EXTRACTION: 500, MANUFACTURE: 500, TRADE_AND_TRANSPORT: 500, KNOWLEDGE_AND_SERVICES: 500 } }],
    states: [{ stateId: "STATE", actualGovernment: "GOV", factionAffinity: { CONCORD: 334, SCHISM: 333, RUIN: 333 }, dominantFaction: "CONCORD", legitimacy: 500, qualifyingGovernmentReviewCount: 0, lastGovernmentTransitionYear: 0, routineTransitionCooldownUntilYear: 0 }],
    families: [], politicalPeople: [], personRelations: [], organizations: [], institutions: [], offices: [], officeTerms: [], ownershipStakes: [], familyRelations: [], borderRelations: [], timedConditions: [], activeConflicts: [], worldRoutes: [],
    resourceNodes: [{ resourceNodeId: "RESOURCE", resourceType: "WOOD", siteId: "SITE", regionId: "REGION", quality: 500, capacityClass: "MODERATE", renewable: true, accessDifficulty: 100, placementAuthorityRef: "FIXTURE" }],
    worldResourceStates: [{ worldResourceStateId: "RESOURCE_STATE", resourceNodeId: "RESOURCE", controllerType: "STATE", controllerId: "STATE", discoveryYear: 0, availability: "AVAILABLE", seizedByEventId: null }],
    industries: [], securityForces: [], diplomaticRelations: [], diplomaticAgreements: [], conflictEpisodes: [], settlementControlTerms: [], populationSlices: [], derogatoryTargetSelections: [], localAtrocityResponses: [], forcedDisplacements: [], enclaves: [],
  };
}

describe("V5.4 performance architecture contracts", () => {
  it("keeps compression and divergence cadence outside the causal mechanics identity", () => {
    const mechanics = restoreMechanicsVariablesV1(JSON.parse(canonicalJson(DEFAULT_MECHANICS_VARIABLES_V1)));
    expect(Object.hasOwn(mechanics, "checkpointCompressionLevel")).toBe(false);
    expect(Object.hasOwn(mechanics, "divergenceDiagnosticIntervalYears")).toBe(false);
    expect(mechanicsVariablesHash(mechanics)).toBe(mechanicsVariablesHash(DEFAULT_MECHANICS_VARIABLES_V1));
    const legacyOperational = structuredClone(DEFAULT_OPERATIONAL_CONFIG_V1) as Partial<typeof DEFAULT_OPERATIONAL_CONFIG_V1>;
    delete legacyOperational.checkpointCompressionLevel;
    delete legacyOperational.divergenceDiagnosticIntervalYears;
    expect(restoreOperationalConfigV1(legacyOperational)).toMatchObject({ checkpointCompressionLevel: 3, divergenceDiagnosticIntervalYears: 25 });
  });

  it("gives atomic-year callbacks a runtime read-only view without cloning or alias mutation", () => {
    let callbackMutationBlocked = false;
    const result = runV5History({ canonical, ownerInputs: diagnosticCandidateOwnerInputsV1({}), mechanics: DEFAULT_MECHANICS_VARIABLES_V1, operational: DEFAULT_OPERATIONAL_CONFIG_V1, diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1, normalizedSeed: normalizeSeed("READ_ONLY_CALLBACK"), mode: "DIAGNOSTIC", throughYear: 0, onBootstrap: (snapshot) => {
      try { (snapshot.states.CONCORD as WorldStateV5).year = 99; } catch { callbackMutationBlocked = true; }
    } });
    expect(callbackMutationBlocked).toBe(true);
    expect(result.states.CONCORD.year).toBe(0);
    const source = { nested: { values: [1, 2, 3] } };
    const view = createDeepReadonlyViewV5(source);
    expect(() => (view.nested.values as number[]).push(4)).toThrow(/read-only/i);
    expect(source.nested.values).toEqual([1, 2, 3]);
  });

  it("freezes the complete committed causal graph so later candidates cannot mutate prior-year aliases", () => {
    const committed = state(); freezeCommittedCausalStateV5(committed); const before = canonicalJson(committed);
    expect(Object.isFrozen(committed)).toBe(true); expect(Object.isFrozen(committed.cohorts)).toBe(true); expect(Object.isFrozen(committed.cohorts[0]!.tiers.LOW)).toBe(true);
    expect(() => { committed.cohorts[0]!.tiers.LOW.population += 1n; }).toThrow();
    expect(canonicalJson(committed)).toBe(before);
  });

  it("builds deterministic non-persisted indexes for required annual lookups", () => {
    const indexes = buildEphemeralWorldIndexesV5(state());
    expect(indexes.settlementById.get("S1")?.siteId).toBe("SITE");
    expect(indexes.settlementsByState.get("STATE")?.map((row) => row.settlementId)).toEqual(["S1"]);
    expect(indexes.settlementBySite.get("SITE")?.settlementId).toBe("S1");
    expect(indexes.cohortsBySettlement.get("S1")).toHaveLength(1);
    expect(indexes.populationBySettlement.get("S1")).toBe(15n);
    expect(indexes.populationByState.get("STATE")).toBe(15n);
    expect(indexes.resourceNodesBySite.get("SITE")?.map((row) => row.resourceNodeId)).toEqual(["RESOURCE"]);
    expect(indexes.resourceStateByNodeId.get("RESOURCE")?.availability).toBe("AVAILABLE");
    expect(indexes.availableResourcesBySite.get("SITE")?.map((row) => row.resourceNodeId)).toEqual(["RESOURCE"]);
  });

  it("canonical-serializes a checkpoint exactly once while preserving its hash", () => {
    const directory = mkdtempSync(join(tmpdir(), "echoes-v54-checkpoint-once-")); const store = new SimulatorStore(join(directory, "fixture.sqlite"));
    try {
      store.createRun({ runId: "CHECKPOINT_ONCE", mode: "DIAGNOSTIC", status: "RUNNING", seed: "fixture", seedHash: "f".repeat(64), policyVersion: "fixture", currentYear: 0 });
      const timings: V5PerformanceTimingSample[] = [];
      const saved = store.saveV5Checkpoint("CHECKPOINT_ONCE", state(), V5_EMPTY_EVENT_HISTORY_HASH, (sample) => timings.push(sample));
      const restored = store.loadLatestV5Checkpoint("CHECKPOINT_ONCE", "CONCORD")!;
      expect(restored.stateHash).toBe(saved.stateHash);
      expect(timings.filter((sample) => sample.phase === "CHECKPOINT_CANONICAL_SERIALIZATION")).toHaveLength(1);
      expect(timings.some((sample) => sample.phase === "CHECKPOINT_HASH_SERIALIZATION" || sample.phase === "CHECKPOINT_COMPRESSION_SERIALIZATION")).toBe(false);
    } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
  });

  it("runs divergence only on cadence, target, explicit, or decision-barrier years", () => {
    const base = { intervalYears: 25, targetYear: 285, explicitYears: new Set<number>() };
    expect(shouldBuildDivergenceDiagnosticV5({ ...base, year: 24, decisionBarrier: false })).toBe(false);
    expect(shouldBuildDivergenceDiagnosticV5({ ...base, year: 25, decisionBarrier: false })).toBe(true);
    expect(shouldBuildDivergenceDiagnosticV5({ ...base, year: 285, decisionBarrier: false })).toBe(true);
    expect(shouldBuildDivergenceDiagnosticV5({ ...base, year: 42, explicitYears: new Set([42]), decisionBarrier: false })).toBe(true);
    expect(shouldBuildDivergenceDiagnosticV5({ ...base, year: 15, decisionBarrier: true })).toBe(true);
  });

  it("preserves exact population-slice state when using the complete positive fast path", () => {
    const initialized = ensurePopulationSlicesV5(state(), canonical);
    const grown = { ...initialized, cohorts: initialized.cohorts.map((cell) => ({ ...cell, tiers: { ...cell.tiers, LOW: { ...cell.tiers.LOW, population: cell.tiers.LOW.population + 3n } } })) };
    const reference = reconcilePublicPopulationSlicesV5(grown, canonical);
    const optimized = reconcilePublicPopulationSlicesV5(grown, canonical, { populationSlicesComplete: true, populationsRemainPositive: true });
    expect(canonicalJson(optimized)).toBe(canonicalJson(reference));
  });

  it("matches the prior generic death effect while retaining retirement and expiration semantics", () => {
    const initial: WorldStateV5 = { ...state(), year: 10,
      politicalPeople: [
        { personId: "DEAD", familyId: null, breedId: "B1", originSettlementId: "S1", sourceTier: "HIGH", sourceClass: null, birthYear: -30, activeFromYear: 0, plannedRetirementYear: null, actualRetirementYear: null, naturalDeathYear: 10, actualDeathYear: null, disqualifiedFromYear: null, requalifiedYear: null },
        { personId: "RETIRED", familyId: null, breedId: "B1", originSettlementId: "S1", sourceTier: "MID", sourceClass: null, birthYear: -30, activeFromYear: 0, plannedRetirementYear: 10, actualRetirementYear: null, naturalDeathYear: 30, actualDeathYear: null, disqualifiedFromYear: null, requalifiedYear: null },
      ],
      offices: [{ officeId: "OFFICE_DEATH", institutionId: "I", jurisdictionSettlementId: null, titleKey: "D", power: 1, mandatory: false, apex: false, termYears: null, selectionRule: { selectionMethod: "RULER_APPOINTMENT", scope: "STATE", requiresTrackedLineage: false, eligibleTiers: ["HIGH"], minimumFactionCompatibility: 0, stochasticTies: false, scoreWeights: { factionFit: 1, classFit: 1, localSupport: 1, lineageFit: 1, ruleSpecificFit: 1 } } }, { officeId: "OFFICE_RETIRE", institutionId: "I", jurisdictionSettlementId: null, titleKey: "R", power: 1, mandatory: false, apex: false, termYears: null, selectionRule: { selectionMethod: "RULER_APPOINTMENT", scope: "STATE", requiresTrackedLineage: false, eligibleTiers: ["MID"], minimumFactionCompatibility: 0, stochasticTies: false, scoreWeights: { factionFit: 1, classFit: 1, localSupport: 1, lineageFit: 1, ruleSpecificFit: 1 } } }, { officeId: "OFFICE_EXPIRE", institutionId: "I", jurisdictionSettlementId: null, titleKey: "E", power: 1, mandatory: false, apex: false, termYears: 10, selectionRule: { selectionMethod: "RULER_APPOINTMENT", scope: "STATE", requiresTrackedLineage: false, eligibleTiers: ["HIGH"], minimumFactionCompatibility: 0, stochasticTies: false, scoreWeights: { factionFit: 1, classFit: 1, localSupport: 1, lineageFit: 1, ruleSpecificFit: 1 } } }],
      officeTerms: [
        { officeTermId: "TERM_DEATH", officeId: "OFFICE_DEATH", personId: "DEAD", startYear: 0, endYear: null, terminationReason: null, selectionEventId: "S", selectorType: "STATE", selectorId: "STATE" },
        { officeTermId: "TERM_RETIRE", officeId: "OFFICE_RETIRE", personId: "RETIRED", startYear: 0, endYear: null, terminationReason: null, selectionEventId: "S", selectorType: "STATE", selectorId: "STATE" },
        { officeTermId: "TERM_EXPIRE", officeId: "OFFICE_EXPIRE", personId: "RETIRED", startYear: 0, endYear: 10, terminationReason: null, selectionEventId: "S", selectorType: "STATE", selectorId: "STATE" },
      ],
    };
    const death = applyCausalEffects(initial, [{ type: "POLITICAL_PERSON_DEATH", effectId: "EFFECT_CONCORD_10_NATURAL_DEATHS", sourceEventId: "EVT_CONCORD_10_NATURAL_DEATHS", personIds: ["DEAD"] }]);
    const expectedPeople = death.state.politicalPeople.map((person) => person.personId === "RETIRED" ? { ...person, actualRetirementYear: 10 } : person);
    const expectedTerms = death.state.officeTerms.map((term) => term.personId === "RETIRED" && term.endYear === null ? { ...term, endYear: 10, terminationReason: "RETIREMENT" as const } : term).map((term) => term.endYear === 10 && term.terminationReason === null ? { ...term, terminationReason: "TERM_EXPIRED" as const } : term);
    const optimized = applyTemporalEventsV5(initial);
    expect(canonicalJson(optimized.state.politicalPeople)).toBe(canonicalJson(expectedPeople));
    expect(canonicalJson(optimized.state.officeTerms)).toBe(canonicalJson(expectedTerms));
    expect(optimized.events.map((event) => event.eventType)).toEqual(["PoliticalPeopleDied", "PoliticalPeopleRetired", "OfficeTermsExpired"]);
  });

  it("matches sequential pre-index social mobility state and events", () => {
    const initial = state(); const second = { ...initial.settlements[0]!, settlementId: "S2", siteId: "SITE2" };
    const multi: WorldStateV5 = { ...initial, settlements: [initial.settlements[0]!, second], cohorts: [...initial.cohorts, { ...initial.cohorts[0]!, settlementId: "S2", tiers: { HIGH: { population: 1n, prosperity: 200 }, MID: { population: 2n, prosperity: 300 }, LOW: { population: 20n, prosperity: 100 } } }] };
    const inputs = Object.fromEntries(multi.settlements.map((settlement) => [settlement.settlementId, { localOpportunity: 700, institutionalAccess: 600, inequality: 500, economicStrain: 300 }]));
    let sequentialState = multi; const sequentialEvents = [] as ReturnType<typeof reviewSettlementSocialMobility>["events"];
    for (const settlement of [...multi.settlements].sort((left, right) => left.settlementId.localeCompare(right.settlementId))) { const reviewed = reviewSettlementSocialMobility(sequentialState, settlement, 700, 600, 500, 300, DEFAULT_MECHANICS_VARIABLES_V1); sequentialState = reviewed.state; sequentialEvents.push(...reviewed.events); }
    const indexes = buildEphemeralWorldIndexesV5(multi, undefined, { includePopulationSlices: false });
    const batched = reviewAllSettlementsSocialMobilityV5(multi, multi.settlements, inputs, indexes.cohortsBySettlement, DEFAULT_MECHANICS_VARIABLES_V1);
    expect(canonicalJson(batched.state.cohorts)).toBe(canonicalJson(sequentialState.cohorts));
    expect(canonicalJson(batched.events)).toBe(canonicalJson(sequentialEvents));
  });
});
