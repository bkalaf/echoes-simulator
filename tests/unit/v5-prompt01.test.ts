import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { selectableBreedCatalog, filterBreedCatalog } from "../../src/ui/breed-detail.js";
import { loadBundledCanonicalV5 } from "../../src/core/v5/canonical-adapter.js";
import { reconcileChamberAuthorityV5, selectAuthorizedSenateVacanciesV5 } from "../../src/core/v5/chambers.js";
import { DEFAULT_MECHANICS_VARIABLES_V1, V5_MECHANICS_VERSION, V5_SCHEDULER_VERSION, diagnosticCandidateOwnerInputsV1, type CanonicalDataV5 } from "../../src/core/v5/config.js";
import { causalStateHash } from "../../src/core/v5/engine.js";
import { fillMandatoryOfficeVacancies, selectHolderForAuthorizedOfficeVacancy } from "../../src/core/v5/politics.js";
import { normalizeSeed } from "../../src/core/v5/random.js";
import { buildRouteCoverageReadModel, buildNonCausalRouteNamingRequests } from "../../src/core/v5/routes.js";
import { effectiveRouteClassification, parseRouteClassificationAuthority, ROUTE_CLASSIFICATION_SCHEMA_VERSION, type RouteClassificationAuthorityV1 } from "../../src/core/v5/route-classification.js";
import type { WorldStateV5 } from "../../src/core/v5/types.js";

const selectionRule = (selectionMethod: "RULER_APPOINTMENT" | "POPULAR_ELECTION") => ({ selectionMethod, scope: "STATE" as const, requiresTrackedLineage: false, eligibleTiers: ["HIGH" as const, "MID" as const], minimumFactionCompatibility: 0, stochasticTies: false, scoreWeights: { factionFit: 3500, classFit: 1000, localSupport: 3000, lineageFit: 1500, ruleSpecificFit: 1000 } });
const government = (governmentFormId: string, selectionMethod: "RULER_APPOINTMENT" | "POPULAR_ELECTION") => ({ governmentFormId, doctrineVector: { CONCORD: 1000, SCHISM: 0, RUIN: 0 }, administrationMode: governmentFormId, legitimacyBasis: governmentFormId, authoritySource: governmentFormId, franchiseBreadth: 500, requiredInstitutions: [{ institutionType: "GOVERNMENT", offices: [{ jurisdictionSettlementId: null, titleKey: "RULER", power: 1000, mandatory: true, apex: true, termYears: 10, selectionRule: selectionRule(selectionMethod) }] }] });
const chamberCanonical: CanonicalDataV5 = {
  schemaVersion: "echoes-canonical-data-v5", canonicalBundleHash: "prompt01-chamber-fixture",
  breeds: [
    { breedId: "BRD_A", populationKind: "HUMAN", groupId: "H01", factionObject: { CONCORD: 10, SCHISM: 0, RUIN: 0 }, dominantFaction: ["CONCORD"], terrainBroad: ["FOREST"], terrainSpecific: ["WOODLAND"], ownershipMode: "COMMON_USE", allocationMode: "MARKET" },
    { breedId: "BRD_R", populationKind: "HUMAN", groupId: "H01", factionObject: { CONCORD: 0, SCHISM: 0, RUIN: 10 }, dominantFaction: ["RUIN"], terrainBroad: ["FOREST"], terrainSpecific: ["WOODLAND"], ownershipMode: "COMMON_USE", allocationMode: "MARKET" },
  ],
  sites: [1, 2, 3].map((ordinal) => ({ siteId: `SITE_${ordinal}`, regionId: "R01", regionName: "One", continent: "Raukaam", latitude: 0, longitude: ordinal, terrainBroad: ["FOREST"], terrainSpecific: ["WOODLAND"], quality: 700 })),
  regions: [{ regionId: "R01", directedAdjacentRegionIds: [] }], governments: [government("GOV_APPOINTED", "RULER_APPOINTMENT"), government("GOV_ELECTED", "POPULAR_ELECTION")],
  economicForms: [{ ownershipMode: "COMMON_USE", allocationMode: "MARKET", economicForm: "OPEN_BAZAAR" }], physicalPois: [], routeCorridors: [],
  sovereigns: { CONCORD: { sovereignFaction: "CONCORD", breedId: "BRD_A", seizureTargetSiteId: "SITE_1" }, SCHISM: { sovereignFaction: "SCHISM", breedId: "BRD_A", seizureTargetSiteId: "SITE_1" }, RUIN: { sovereignFaction: "RUIN", breedId: "BRD_A", seizureTargetSiteId: "SITE_1" } },
  groupRegionAssignments: { CONCORD: { H01: "R01" }, SCHISM: { H01: "R01" }, RUIN: { H01: "R01" } }, initialSettlements: [], canonicalLabels: {}, canonicalEvents: [],
};
const owner = diagnosticCandidateOwnerInputsV1({ GOV_APPOINTED: {}, GOV_ELECTED: {} });
const seed = normalizeSeed("prompt01-chamber-fixture");
const chamberState = (year: number): WorldStateV5 => ({
  schemaVersion: "echoes-world-state-v5", worldKey: "CONCORD", year,
  settlements: [1, 2, 3].map((ordinal) => ({ settlementId: `SETTLEMENT_${ordinal}`, siteId: `SITE_${ordinal}`, regionId: "R01", stateId: "STATE_1", foundedYear: ordinal === 1 ? 0 : ordinal === 2 ? 1 : 77, unrest: 0, sectorStrengths: { LAND_AND_FOOD: 500, EXTRACTION: 500, MANUFACTURE: 500, TRADE_AND_TRANSPORT: 500, KNOWLEDGE_AND_SERVICES: 500 } })),
  states: [{ stateId: "STATE_1", actualGovernment: "GOV_APPOINTED", factionAffinity: { CONCORD: 1000, SCHISM: 0, RUIN: 0 }, dominantFaction: "CONCORD", legitimacy: 500, qualifyingGovernmentReviewCount: 0, lastGovernmentTransitionYear: 0, routineTransitionCooldownUntilYear: 0 }],
  cohorts: [1, 2, 3].map((ordinal) => ({ settlementId: `SETTLEMENT_${ordinal}`, breedId: "BRD_A", tiers: { HIGH: { population: 1000n, prosperity: 700 }, MID: { population: 1000n, prosperity: 500 }, LOW: { population: 1000n, prosperity: 300 } } })),
  families: [], politicalPeople: [], personRelations: [], organizations: [], institutions: [], offices: [], officeTerms: [], ownershipStakes: [], familyRelations: [], borderRelations: [], timedConditions: [], activeConflicts: [], worldRoutes: [],
});

describe("Prompt 01 complete Breed accessibility and continent authority", () => {
  it("keeps every canonical Breed reachable, including early, middle, and final alphabetic selections", () => {
    const catalog = Array.from({ length: 2_062 }, (_, index) => ({ breedId: `BRD_${String(index).padStart(4, "0")}`, name: `Breed ${String(index).padStart(4, "0")}`, populationKind: "BEAST", speciesId: `SPC_${index}`, speciesName: `Species ${index}`, scientificName: `Genus species${index}`, groupId: "G01", cultureId: null, factionObject: { CONCORD: 1, SCHISM: 0, RUIN: 0 }, dominantFaction: ["CONCORD" as const], primaryDeity: "Deity", provisionalDeity: null, deityClassificationStatus: "CLASSIFIED" as const }));
    expect(catalog).toHaveLength(2062);
    const selectable = selectableBreedCatalog(catalog, "", null);
    expect(new Set(selectable.map((breed) => breed.breedId))).toEqual(new Set(catalog.map((breed) => breed.breedId)));
    for (const breed of [catalog[0]!, catalog[Math.floor(catalog.length / 2)]!, catalog.at(-1)!]) {
      expect(selectable.some((candidate) => candidate.breedId === breed.breedId)).toBe(true);
      expect(selectableBreedCatalog(catalog, "no such breed query", breed.breedId).at(-1)?.breedId).toBe(breed.breedId);
    }
  });

  it("searches every required canonical identity dimension", () => {
    const row = { breedId: "BRD_ID", name: "Name", populationKind: "MYTHOS", speciesId: "SPC_ID", speciesName: "Species", scientificName: "Genus species", groupId: "G01", cultureId: "C01", factionObject: { CONCORD: 1, SCHISM: 0, RUIN: 0 }, dominantFaction: ["CONCORD" as const], primaryDeity: null, provisionalDeity: null, deityClassificationStatus: "CLASSIFIED" as const };
    for (const query of ["name", "genus", "brd_id", "spc_id", "species", "g01", "c01", "mythos"]) expect(filterBreedCatalog([row], query)).toEqual([row]);
  });

  it("loads only the official continent names in canonical fields", () => {
    const canonical = loadBundledCanonicalV5(resolve("resources/canonical"));
    const byRegion = Object.fromEntries(canonical.sites.map((site) => [site.regionId, site.continent]));
    for (let region = 1; region <= 8; region += 1) expect(byRegion[`R${String(region).padStart(2, "0")}`]).toBe("Raukaam");
    for (let region = 9; region <= 16; region += 1) expect(byRegion[`R${String(region).padStart(2, "0")}`]).toBe("Morgenland");
    for (let region = 17; region <= 25; region += 1) expect(byRegion[`R${String(region).padStart(2, "0")}`]).toBe("Valdmere");
  });
});

describe("Prompt 01 chamber authority", () => {
  it("materializes pre-90 seats, explicitly reforms them at 90, and remains idempotent", () => {
    const at50 = reconcileChamberAuthorityV5(chamberState(50), chamberCanonical);
    expect(at50.state.offices.filter((office) => office.officeId.startsWith("CONCLAVE_"))).toHaveLength(3);
    const populated = fillMandatoryOfficeVacancies(at50.state, chamberCanonical, owner, DEFAULT_MECHANICS_VARIABLES_V1, seed, "FIXTURE_50");
    expect(populated.state.officeTerms).toHaveLength(3);
    expect(populated.events.every((event) => event.payload.appliedSelectionRule && event.payload.sourceGovernmentFormId === "GOV_APPOINTED")).toBe(true);
    const at89 = reconcileChamberAuthorityV5({ ...populated.state, year: 89 }, chamberCanonical);
    expect(at89.state.institutions.filter((institution) => institution.institutionType === "CONCLAVE_PRE90" && institution.dissolvedYear === null)).toHaveLength(1);
    const at90 = reconcileChamberAuthorityV5({ ...at89.state, year: 90 }, chamberCanonical);
    expect(at90.state.institutions.find((institution) => institution.institutionType === "CONCLAVE_PRE90")?.dissolvedYear).toBe(90);
    expect(at90.state.officeTerms.every((term) => term.endYear !== null && term.endYear <= 90)).toBe(true);
    expect(at90.state.offices.filter((office) => office.institutionId.includes("POST90"))).toHaveLength(3);
    const repeated = reconcileChamberAuthorityV5(at90.state, chamberCanonical);
    expect(repeated.events).toEqual([]); expect(causalStateHash(repeated.state)).toBe(causalStateHash(at90.state));
  });

  it("activates Senate A at 275 and B at 280, preserves vacancies off-cycle, and snapshots changing rules", () => {
    let state = reconcileChamberAuthorityV5(chamberState(274), chamberCanonical).state;
    expect(state.offices.some((office) => office.officeId.startsWith("SENATE_"))).toBe(false);
    state = reconcileChamberAuthorityV5({ ...state, year: 275 }, chamberCanonical).state;
    let selected = selectAuthorizedSenateVacanciesV5(state, chamberCanonical, owner, DEFAULT_MECHANICS_VARIABLES_V1, seed); state = selected.state;
    const seatA = state.offices.find((office) => office.officeId.endsWith("_A"))!;
    const firstATerm = state.officeTerms.find((term) => term.officeId === seatA.officeId)!;
    expect(firstATerm).toMatchObject({ startYear: 275, endYear: 285 });
    const firstEvidence = selected.events.find((event) => event.eventType === "OfficeholderSelected")!.payload;
    expect((firstEvidence.appliedSelectionRule as { selectionMethod: string }).selectionMethod).toBe("RULER_APPOINTMENT");
    state = reconcileChamberAuthorityV5({ ...state, year: 280 }, chamberCanonical).state;
    selected = selectAuthorizedSenateVacanciesV5(state, chamberCanonical, owner, DEFAULT_MECHANICS_VARIABLES_V1, seed); state = selected.state;
    expect(state.officeTerms.find((term) => term.officeId.endsWith("_B"))).toMatchObject({ startYear: 280, endYear: 290 });
    state = { ...state, year: 278, officeTerms: state.officeTerms.map((term) => term.officeTermId === firstATerm.officeTermId ? { ...term, endYear: 278, terminationReason: "REMOVAL" } : term) };
    const generic = fillMandatoryOfficeVacancies(state, chamberCanonical, owner, DEFAULT_MECHANICS_VARIABLES_V1, seed, "FIXTURE_278");
    expect(generic.state.officeTerms.filter((term) => term.officeId === seatA.officeId)).toHaveLength(1);
    for (const year of [279, 280, 281, 282, 283, 284]) expect(selectAuthorizedSenateVacanciesV5({ ...generic.state, year }, chamberCanonical, owner, DEFAULT_MECHANICS_VARIABLES_V1, seed).events).toEqual([]);
    state = { ...generic.state, year: 285, states: generic.state.states.map((row) => ({ ...row, actualGovernment: "GOV_ELECTED" })) };
    const replacement = selectAuthorizedSenateVacanciesV5(state, chamberCanonical, owner, DEFAULT_MECHANICS_VARIABLES_V1, seed);
    const replacementEvidence = replacement.events.find((event) => event.eventType === "OfficeholderSelected")!.payload;
    expect((replacementEvidence.appliedSelectionRule as { selectionMethod: string }).selectionMethod).toBe("POPULAR_ELECTION");
    expect((firstEvidence.appliedSelectionRule as { selectionMethod: string }).selectionMethod).toBe("RULER_APPOINTMENT");
  });

  it("separates Ruin constituency, Concord appointing authority, and explicit representative alignment", () => {
    const prepare = (governmentId: "GOV_APPOINTED" | "GOV_ELECTED") => {
      let state = chamberState(50);
      state = { ...state, states: state.states.map((row) => ({ ...row, actualGovernment: governmentId })) };
      state = reconcileChamberAuthorityV5(state, chamberCanonical).state;
      const office = state.offices.find((row) => row.jurisdictionSettlementId !== null)!;
      const constituencyId = office.jurisdictionSettlementId!;
      const person = (personId: string, breedId: "BRD_A" | "BRD_R", faction: "CONCORD" | "RUIN") => ({
        personId, familyId: null, breedId, originSettlementId: constituencyId, sourceTier: "HIGH" as const, sourceClass: null,
        birthYear: 0, activeFromYear: 20, plannedRetirementYear: null, actualRetirementYear: null, naturalDeathYear: 100,
        actualDeathYear: null, disqualifiedFromYear: null, requalifiedYear: null,
        factionAffinity: { CONCORD: faction === "CONCORD" ? 1000 : 0, SCHISM: 0, RUIN: faction === "RUIN" ? 1000 : 0 },
        factionAlignmentEffectiveFromYear: 20, factionAlignmentSourceEventId: `ALIGN_${personId}`,
      });
      const ruinCell = { settlementId: constituencyId, breedId: "BRD_R", tiers: { HIGH: { population: 9000n, prosperity: 700 }, MID: { population: 0n, prosperity: 500 }, LOW: { population: 0n, prosperity: 300 } } };
      return { office, state: { ...state, cohorts: [...state.cohorts, ruinCell], politicalPeople: [person("PERSON_CONCORD", "BRD_A", "CONCORD"), person("PERSON_RUIN", "BRD_R", "RUIN")] } };
    };
    const appointedInput = prepare("GOV_APPOINTED");
    const appointed = selectHolderForAuthorizedOfficeVacancy(appointedInput.state, appointedInput.office.officeId, chamberCanonical, owner, DEFAULT_MECHANICS_VARIABLES_V1, seed, "APPOINTED", 0);
    expect(appointed.officeTerm?.personId).toBe("PERSON_CONCORD");
    expect(appointed.officeTerm).toMatchObject({ selectorType: "STATE", selectorId: "STATE_1" });
    expect(appointed.events[0]!.payload).toMatchObject({
      sourceSettlementId: appointedInput.office.jurisdictionSettlementId,
      constituencyFactionAffinity: { CONCORD: 250, SCHISM: 0, RUIN: 750 },
      representativeFactionAffinity: { CONCORD: 1000, SCHISM: 0, RUIN: 0 },
      selectionAuthorityFactionAffinity: { CONCORD: 1000, SCHISM: 0, RUIN: 0 },
    });

    const electedInput = prepare("GOV_ELECTED");
    const elected = selectHolderForAuthorizedOfficeVacancy(electedInput.state, electedInput.office.officeId, chamberCanonical, owner, DEFAULT_MECHANICS_VARIABLES_V1, seed, "ELECTED", 0);
    expect(elected.officeTerm?.personId).toBe("PERSON_RUIN");
    expect(elected.events[0]!.payload).toMatchObject({
      constituencyFactionAffinity: { CONCORD: 250, SCHISM: 0, RUIN: 750 },
      representativeFactionAffinity: { CONCORD: 0, SCHISM: 0, RUIN: 1000 },
      selectionAuthorityFactionAffinity: { CONCORD: 250, SCHISM: 0, RUIN: 750 },
    });
    expect(selectHolderForAuthorizedOfficeVacancy(electedInput.state, electedInput.office.officeId, chamberCanonical, owner, DEFAULT_MECHANICS_VARIABLES_V1, seed, "ELECTED", 0).officeTerm).toEqual(elected.officeTerm);
  });
});

describe("Prompt 01 non-causal Route classification overlay", () => {
  it("keeps all 38 corridors unresolved without owner authority and changes no durable Route row", () => {
    const canonical = loadBundledCanonicalV5(resolve("resources/canonical"));
    const empty = parseRouteClassificationAuthority({ schemaVersion: ROUTE_CLASSIFICATION_SCHEMA_VERSION, authorityVersion: "empty", authorityStatus: "NO_OWNER_DECISIONS", approvedAt: null, classifications: [] });
    const read = buildRouteCoverageReadModel(canonical, {}, {}, {}, empty);
    expect(read.rows).toHaveLength(38); expect(read.rows.every((row) => row.semanticReadiness === "NOT_READY")).toBe(true);
  });

  it("makes only one approved corridor nameable and supports PORTAL_ONLY without durable NONE fields", () => {
    const canonical = loadBundledCanonicalV5(resolve("resources/canonical")); const corridor = canonical.routeCorridors[0]!;
    const authority: RouteClassificationAuthorityV1 = parseRouteClassificationAuthority({ schemaVersion: ROUTE_CLASSIFICATION_SCHEMA_VERSION, authorityVersion: "owner-test-v1", authorityStatus: "OWNER_APPROVED_NONCAUSAL_OVERLAY", approvedAt: "2026-08-27T00:00:00Z", classifications: [{ corridorId: corridor.corridorId, ownerDecisionStatus: "OWNER_VALUES", ownerPrimaryMode: "PORTAL_ONLY", ownerInfrastructureClass: "PORTAL_ONLY", ownerPortalCapability: true, ownerTradeDesignation: false, ownerEvidenceRef: "OWNER_TEST" }] }, new Set(canonical.routeCorridors.map((row) => row.corridorId)));
    const persistentRoute = { routeId: `WORLD_ROUTE_CONCORD_${corridor.corridorId}`, corridorId: corridor.corridorId, primaryMode: "UNRESOLVED" as const, infrastructureClass: "UNRESOLVED" as const, tradeDesignation: false, establishedYear: 0 };
    const endpointSites = canonical.sites.filter((site) => site.regionId === corridor.regionAId || site.regionId === corridor.regionBId).slice(0, 2);
    const state: WorldStateV5 = { ...chamberState(100), states: chamberState(100).states.map((row) => ({ ...row, actualGovernment: canonical.governments[0]!.governmentFormId })), settlements: endpointSites.map((site, index) => ({ ...chamberState(100).settlements[index]!, settlementId: `ROUTE_SETTLEMENT_${index}`, siteId: site.siteId, regionId: site.regionId })), cohorts: [], worldRoutes: [persistentRoute] };
    const before = causalStateHash(state); const requests = buildNonCausalRouteNamingRequests(state, canonical, authority, diagnosticCandidateOwnerInputsV1(Object.fromEntries(canonical.governments.map((row) => [row.governmentFormId, {}]))), DEFAULT_MECHANICS_VARIABLES_V1);
    expect(requests).toHaveLength(1); expect(requests[0]).toMatchObject({ behavior: "BATCHED", entityId: persistentRoute.routeId, namingComparisonGroupId: `WORLD_ROUTE:${corridor.corridorId}`, context: { effectivePrimaryMode: "NONE", effectiveInfrastructureClass: "NONE", portalCapability: true } });
    expect(causalStateHash(state)).toBe(before); expect(state.worldRoutes[0]).toEqual(persistentRoute);
    expect(canonical.routeCorridors.filter((row) => effectiveRouteClassification(row, authority).semanticReadiness === "READY")).toHaveLength(1);
  });

  it("rejects ambiguous generic approval", () => {
    expect(() => parseRouteClassificationAuthority({ schemaVersion: ROUTE_CLASSIFICATION_SCHEMA_VERSION, authorityVersion: "bad", authorityStatus: "OWNER_APPROVED_NONCAUSAL_OVERLAY", approvedAt: "2026-08-27", classifications: [{ corridorId: "X", ownerDecisionStatus: "APPROVED" }] })).toThrow(/OWNER_VALUES or APPROVE_RECOMMENDATION/);
  });
});

it("preserves Prompt 01 behavior under the next repository causal identity", () => {
  expect(V5_SCHEDULER_VERSION).toBe("echoes-scheduler-v5.6.0");
  expect(V5_MECHANICS_VERSION).toBe("echoes-mechanics-v5.6.0");
});
