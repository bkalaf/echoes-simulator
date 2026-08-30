import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { canonicalJson } from "../../src/core/serialization/canonical-json.js";
import { buildDynamicAtlasOverlayV1 } from "../../src/core/atlas/dynamic-overlay.js";
import { buildAtrocityWorldDefinitionsV1, validateAtrocityWorldDefinitionsV1, ATROCITY_INTEGRATION_FIXTURES_V1 } from "../../src/core/v5/atrocity-catalog.js";
import { appendRunAuthorityEpochV1, authorityEntriesAtYearV1, buildRunAuthoritySnapshotV1, requireRunAuthorityV1 } from "../../src/core/v5/authority-snapshot.js";
import { influenceControlAtPointV1, validateStateTerritoryTopologyV1, weightedBoundaryDistanceFromA } from "../../src/core/v5/dynamic-territory.js";
import { FEDERAL_VISION_PROFILES_V1 } from "../../src/core/v5/federal-vision.js";
import { legendaryRewardInventoryReadinessV1, materializeKeeperOfficesV1, succeedKeeperHolderV1, validateKeeperArchitectureV1 } from "../../src/core/v5/keepers.js";
import { advanceRefugeStockV1, advanceResourceStockV1, resourceAuthorityStatusV1, routeOutputThroughQuartermasterV1, selectResourceQuartermasterV1, validateQuartermasterFlowV1 } from "../../src/core/v5/logistics.js";
import { advanceProjectionWatermarkV1, commonProjectionReadBoundaryV1, initialProjectionWatermarkV1, markCommittedCausalYearV1, markProjectionFailureV1 } from "../../src/core/v5/projection-freshness.js";
import { buildRefugeGenesisV1, FOOD_SPECIFIC_SELECTORS_V1, FOOD_SPECIFIC_VALUES_V1, REFUGE_ELIGIBLE_FOOD_SPECIFIC_V1 } from "../../src/core/v5/refuge-genesis.js";
import { selectPantheonCenterDesignationV1, validateReligiousSiteCardinalityV1 } from "../../src/core/v5/religion.js";
import { NON_REFUGE_FOOD_SPECIFIC_V1, requireApprovedSustenancePoliciesV1, validateNonRefugeFoodSpecificAuthorityV1 } from "../../src/core/v5/sustenance.js";
import { assertWorldNeutralCausalEqualityV1, worldNeutralCausalHashV1 } from "../../src/core/v5/world-neutral.js";
import { V5_ATROCITY_OCCURRENCE_IDS } from "../../src/core/v5/types.js";
import { candidateGroupsForDerogatoryReviewV1, emptyDerogatoryTaxonomyReviewV1, validateApprovedDerogatoryTaxonomyV1 } from "../../src/core/v5/derogatory-taxonomy.js";
import { POI_RENAME_CONSEQUENCE_DIMENSIONS_V1, validatePoiRenameDecisionV1 } from "../../src/core/v5/poi-renames.js";
import { flattenTypedAuthorityValues, hydrateTypedAuthorityValues } from "../../src/persistence/typed-authority-values.js";

describe("V5.6 immutable authority and projection contracts", () => {
  it("round-trips canonical typed values without JSON/JSONB bags", () => {
    const value = { empty: [], values: [1, 2.5, 7n, true, null, { key: "value" }] };
    expect(hydrateTypedAuthorityValues(flattenTypedAuthorityValues(value))).toEqual(value);
  });
  it("round-trips stable-ID object keys without changing their identity", () => {
    const value = { canonicalLabelAuthority: { "SITE-001": "Origin", "POI/02": { "name with space": "Harbor" } } };
    const rows = flattenTypedAuthorityValues(value);
    expect(rows.some((row) => row.valuePath.includes("SITE-001"))).toBe(true);
    expect(hydrateTypedAuthorityValues(rows)).toEqual(value);
  });
  it("pins typed content and adopts later revisions only after an explicit barrier", () => {
    const mutable = { threshold: 10 };
    const initial = buildRunAuthoritySnapshotV1([{ authorityId: "AUTH", revisionId: "R1", authorityType: "POLICY", schemaVersion: "v1", approvedBy: "owner", approvedAt: "2026-08-29T00:00:00Z", effectiveFromYear: 0, content: mutable }]);
    mutable.threshold = 99;
    expect(requireRunAuthorityV1(initial, "AUTH", 25).content).toEqual({ threshold: 10 });
    const next = appendRunAuthorityEpochV1(initial, { barrierYear: 25, causeEventId: "EVT_REVIEW_25", entries: [{ authorityId: "AUTH", revisionId: "R2", authorityType: "POLICY", schemaVersion: "v1", approvedBy: "owner", approvedAt: "2026-08-29T01:00:00Z", effectiveFromYear: 26, content: { threshold: 20 } }] });
    expect(authorityEntriesAtYearV1(next, 25)[0]!.revisionId).toBe("R1");
    expect(authorityEntriesAtYearV1(next, 26)[0]!.revisionId).toBe("R2");
  });

  it("keeps causal progress after projection failure and exposes one common stale read year", () => {
    const committed = markCommittedCausalYearV1(initialProjectionWatermarkV1("RUN", "CONCORD"), 1);
    const stale = markProjectionFailureV1(committed, new Error("database unavailable"));
    expect(stale).toMatchObject({ runCurrentYear: 1, projectedThroughYear: 0, freshness: "STALE", failureCode: "POSTGRES_PROJECTION_FAILED" });
    const ruin = advanceProjectionWatermarkV1(markCommittedCausalYearV1(initialProjectionWatermarkV1("RUN", "RUIN"), 1), 1);
    expect(commonProjectionReadBoundaryV1([stale, ruin], 1)).toEqual({ runCurrentYear: 1, commonProjectedThroughYear: 0, selectedDataYear: 0, freshness: "STALE", mixedYearReadsAllowed: false });
  });
});

describe("V5.6 three-world structural contracts", () => {
  it("normalizes identity-only world IDs but preserves semantic divergence", () => {
    const concord = { worldKey: "CONCORD", eventId: "EVT_CONCORD_1", payload: { routeId: "ROUTE_CONCORD_A", account: 4 } };
    const ruin = { worldKey: "RUIN", eventId: "EVT_RUIN_1", payload: { routeId: "ROUTE_RUIN_A", account: 4 } };
    expect(assertWorldNeutralCausalEqualityV1([concord, ruin])).toMatch(/^[a-f0-9]{64}$/);
    expect(worldNeutralCausalHashV1({ ...concord, payload: { ...concord.payload, narrative: "Concord favored the Crown" } })).not.toBe(worldNeutralCausalHashV1({ ...ruin, payload: { ...ruin.payload, narrative: "Ruin favored the Intellectual Elite" } }));
  });

  it("locks Federal Vision directionality without canonizing weights", () => {
    expect(FEDERAL_VISION_PROFILES_V1.CONCORD).toMatchObject({ primaryPillar: "CROWN", counterPillar: "CHURCH" });
    expect(FEDERAL_VISION_PROFILES_V1.RUIN).toMatchObject({ primaryPillar: "INTELLECTUAL_ELITE", counterPillar: "HEREDITARY_ELITE" });
    expect(FEDERAL_VISION_PROFILES_V1.SCHISM).toMatchObject({ primaryPillar: "CORPORATE_ACTORS", counterPillar: "WEALTH_ELITE" });
  });
});

describe("V5.6 Refuges, sustenance, Resources, and logistics", () => {
  it("creates 47 base Refuges plus a data-derived second node for each >100-consumer value", () => {
    expect(FOOD_SPECIFIC_VALUES_V1).toHaveLength(64);
    expect(FOOD_SPECIFIC_SELECTORS_V1).toEqual(["MAGIC", "MIXED_DIET", "PREPARED_MEALS"]);
    expect(NON_REFUGE_FOOD_SPECIFIC_V1).toHaveLength(14);
    expect(REFUGE_ELIGIBLE_FOOD_SPECIFIC_V1).toHaveLength(47);
    const highUse = REFUGE_ELIGIBLE_FOOD_SPECIFIC_V1.slice(0, 18);
    const breeds = Array.from({ length: 101 }, (_, index) => ({ breedId: `BRD_${index}`, foodSpecific: highUse }));
    const siteIdsByFoodSpecific = Object.fromEntries(REFUGE_ELIGIBLE_FOOD_SPECIFIC_V1.map((food) => [food, [`SITE_${food}_1`, `SITE_${food}_2`]]));
    const nodes = buildRefugeGenesisV1({ worldKey: "CONCORD", breeds, placementAuthority: { revisionId: "REFUGE_PLACEMENT_R1", status: "APPROVED", siteIdsByFoodSpecific } });
    expect(nodes).toHaveLength(65);
    expect(nodes.filter((node) => node.foodSpecific === "MOONLIGHT")).toHaveLength(highUse.includes("MOONLIGHT") ? 2 : 1);
    expect(nodes.some((node) => FOOD_SPECIFIC_SELECTORS_V1.includes(node.foodSpecific as typeof FOOD_SPECIFIC_SELECTORS_V1[number]))).toBe(false);
  });

  it("preserves all 14 non-Refuge classifications but fails closed without both policy revisions", () => {
    expect(() => validateNonRefugeFoodSpecificAuthorityV1(NON_REFUGE_FOOD_SPECIFIC_V1)).not.toThrow();
    expect(() => requireApprovedSustenancePoliciesV1("SIN", null, null)).toThrow(/semantic policy needs approval/);
  });

  it("distinguishes unknown Resource authority and requires an approved deterministic Quartermaster assignment", () => {
    expect(resourceAuthorityStatusV1({ authorityRevisionId: null, approvedNodeCount: null })).toMatchObject({ status: "RESOURCE_AUTHORITY_REQUIRED", resourceNodeCount: null });
    const quartermasters = [
      { quartermasterId: "QM_B", worldKey: "CONCORD" as const, settlementId: "S1", controllingOrganizationId: null, activeFromYear: 0, activeToYear: null, capacity: 100n, storedQuantity: 10n, status: "ACTIVE" as const },
      { quartermasterId: "QM_A", worldKey: "CONCORD" as const, settlementId: "S1", controllingOrganizationId: null, activeFromYear: 0, activeToYear: null, capacity: 100n, storedQuantity: 10n, status: "ACTIVE" as const },
    ];
    const context = { resourceNodeId: "RESOURCE_1", controllingStateId: "STATE_1", controllingSettlementId: "S1", controllingOrganizationId: null, eligibleQuartermasterIds: ["QM_A", "QM_B"], routeAccessibleQuartermasterIds: ["QM_A", "QM_B"] };
    expect(() => selectResourceQuartermasterV1({ worldKey: "CONCORD", year: 1, policy: null, context, quartermasters, stateBySettlementId: { S1: "STATE_1" } })).toThrow(/needs approval/);
    const selected = selectResourceQuartermasterV1({ worldKey: "CONCORD", year: 1, policy: { policyRevisionId: "QM_POLICY_R1", orderedCriteria: ["SAME_SETTLEMENT", "AVAILABLE_CAPACITY", "STABLE_QUARTERMASTER_ID"], allowCrossState: false, requireActiveRoute: true, status: "APPROVED" }, context, quartermasters, stateBySettlementId: { S1: "STATE_1" } });
    expect(selected.quartermasterId).toBe("QM_A");
    expect(() => validateQuartermasterFlowV1({ flowId: "FLOW", worldKey: "CONCORD", quartermasterId: "QM_A", sourceType: "RESOURCE_NODE", sourceId: "RESOURCE_1", year: 1, producedQuantity: 100n, acceptedQuantity: 90n, lostQuantity: 10n, deliveredQuantity: 70n, retainedQuantity: 10n, policyRevisionIds: ["YIELD_R1", "LOSS_R1"] })).not.toThrow();
    const refuge = advanceRefugeStockV1({ stock: { refugeId: "REFUGE_1", worldKey: "CONCORD", capacity: 1_000n, availableStock: 500n, year: 0 }, outputPolicy: { policyRevisionId: "REFUGE_OUTPUT_R1", formula: "LINEAR_AVAILABLE_STOCK_PPM_V1", outputRatePpm: 100_000, status: "APPROVED" }, replenishmentPolicy: { policyRevisionId: "REFUGE_REPLENISHMENT_R1", formula: "LINEAR_MISSING_CAPACITY_PPM_V1", replenishmentRatePpm: 200_000, status: "APPROVED" } });
    expect(refuge).toMatchObject({ producedQuantity: 60n, replenishedQuantity: 100n });
    const resource = advanceResourceStockV1({ stock: { resourceNodeId: "RESOURCE_1", worldKey: "CONCORD", capacity: 1_000n, availableStock: 500n, renewable: true, year: 0 }, policy: { policyRevisionId: "RESOURCE_YIELD_R1", formula: "LINEAR_STOCK_FLOW_PPM_V1", yieldRatePpm: 100_000, depletionPerYieldPpm: 1_000_000, renewableRecoveryPpm: 100_000, status: "APPROVED" } });
    expect(resource).toMatchObject({ producedQuantity: 50n, depletedQuantity: 50n, recoveredQuantity: 55n });
    const routed = routeOutputThroughQuartermasterV1({ flowId: "REFUGE_FLOW", sourceType: "REFUGE", sourceId: "REFUGE_1", year: 1, producedQuantity: refuge.producedQuantity, quartermaster: quartermasters[0]!, policy: { policyRevisionId: "QM_LOSS_R1", formula: "CAPACITY_THROUGHPUT_LOSS_PPM_V1", throughputPpmOfCapacity: 1_000_000, lossPpm: 100_000, deliveryPpmAfterLoss: 500_000, status: "APPROVED" }, upstreamPolicyRevisionIds: refuge.policyRevisionIds });
    expect(routed.flow.lostQuantity + routed.flow.deliveredQuantity + routed.flow.retainedQuantity).toBe(routed.flow.acceptedQuantity);
    expect(routed.quartermaster.storedQuantity).toBe(37n);
  });
});

describe("V5.6 territory, religion, Keepers, atrocities, and Atlas", () => {
  it("keeps legacy Derogatory taxonomy untrusted until all three owner-named structures have explicit memberships", () => {
    const draft = emptyDerogatoryTaxonomyReviewV1();
    expect(candidateGroupsForDerogatoryReviewV1()).toHaveLength(28);
    expect(() => validateApprovedDerogatoryTaxonomyV1(draft)).toThrow(/needs review/);
    const dispositionByGroupId = Object.fromEntries(candidateGroupsForDerogatoryReviewV1().map(({ groupId }) => [groupId, "KEEP"]));
    const structures = draft.structures.map((structure, index) => ({ ...structure, acceptedName: `Owner Structure ${index + 1}`, membershipByGroupId: Object.fromEntries(candidateGroupsForDerogatoryReviewV1().map(({ groupId }) => [groupId, index === 0 ? "MEMBER" : "NOT_MEMBER"])) }));
    const authorityRevisionId = "DEROGATORY_TAXONOMY_R1";
    const content = { schemaVersion: draft.schemaVersion, authorityRevisionId, dispositionByGroupId, structures };
    const approved = { ...draft, status: "APPROVED" as const, authorityRevisionId, dispositionByGroupId, structures, contentSha256: createHash("sha256").update(canonicalJson(content)).digest("hex") };
    expect(validateApprovedDerogatoryTaxonomyV1(approved)).toBe(approved.contentSha256);
  });

  it("persists POI name choice semantics but blocks political/history magnitudes until owner approval", () => {
    const decision = { decisionId: "RENAME_1", worldKey: "CONCORD" as const, poiId: "POI_1", year: 10, decision: "REQUEST_RENAME" as const, priorAcceptedName: "Old Name", externalNamingRequestId: "NAME_REQUEST_1", acceptedReplacementName: null, aliasPreserved: true as const, consequencePolicyRevisionId: "POI_POLICY_R1" };
    expect(() => validatePoiRenameDecisionV1(decision, null)).toThrow(/needs approval/);
    const magnitudeByDimension = Object.fromEntries(POI_RENAME_CONSEQUENCE_DIMENSIONS_V1.map((dimension) => [dimension, 0])) as Record<typeof POI_RENAME_CONSEQUENCE_DIMENSIONS_V1[number], number>;
    expect(validatePoiRenameDecisionV1(decision, { revisionId: "POI_POLICY_R1", status: "APPROVED", magnitudeByDimension })).toHaveLength(10);
  });
  it("uses geodesic normalized influence with deterministic ties and the approved 25:15 split", () => {
    expect(weightedBoundaryDistanceFromA(40, 25, 15)).toBe(25);
    const settlements = [
      { settlementId: "S_A", siteId: "A", regionId: "R", stateId: "STATE_A", foundedYear: 0, unrest: 0, sectorStrengths: { LAND_AND_FOOD: 0, EXTRACTION: 0, MANUFACTURE: 0, TRADE_AND_TRANSPORT: 0, KNOWLEDGE_AND_SERVICES: 0 } },
      { settlementId: "S_B", siteId: "B", regionId: "R", stateId: "STATE_B", foundedYear: 0, unrest: 0, sectorStrengths: { LAND_AND_FOOD: 0, EXTRACTION: 0, MANUFACTURE: 0, TRADE_AND_TRANSPORT: 0, KNOWLEDGE_AND_SERVICES: 0 } },
    ];
    const terms = settlements.map((settlement, index) => ({ influenceTermId: `I_${index}`, settlementId: settlement.settlementId, effectiveFromYear: 0, effectiveToYear: null, latitude: 0, longitude: index === 0 ? -1 : 1, effectiveRadiusKm: 200, policyRevisionId: "INFLUENCE_R1", sourceEventId: "EVT" }));
    expect(influenceControlAtPointV1({ point: { latitude: 0, longitude: 0 }, settlements, terms, year: 1 }).settlementId).toBe("S_A");
    const ring = [{ longitude: 0, latitude: 0 }, { longitude: 1, latitude: 0 }, { longitude: 1, latitude: 1 }, { longitude: 0, latitude: 0 }];
    expect(validateStateTerritoryTopologyV1([{ territoryCellId: "CELL", worldKey: "CONCORD", stateId: "STATE_A", controllingSettlementId: "S_A", effectiveFromYear: 1, effectiveToYear: null, ring, status: "CLAIMED" }])).toMatchObject({ valid: true, claimedCount: 1 });
  });

  it("keeps Pantheon terminology provisional while preserving the structural selection algorithm", () => {
    const sites = [
      { religiousSiteId: "R1", worldKey: "CONCORD" as const, deityId: "D1", pantheonId: "P", settlementId: "S_LARGE", stateId: "STATE_A", siteKind: "TEMPLE" as const, qualifyingPopulation: 500n },
      { religiousSiteId: "R2", worldKey: "CONCORD" as const, deityId: "D2", pantheonId: "P", settlementId: "S_SMALL", stateId: "STATE_A", siteKind: "SHRINE" as const, qualifyingPopulation: 100n },
      { religiousSiteId: "R3", worldKey: "CONCORD" as const, deityId: "D3", pantheonId: "P", settlementId: "S_OTHER", stateId: "STATE_B", siteKind: "SHRINE" as const, qualifyingPopulation: 10n },
    ];
    expect(() => validateReligiousSiteCardinalityV1(sites)).not.toThrow();
    expect(selectPantheonCenterDesignationV1({ worldKey: "CONCORD", pantheonId: "P", effectiveFromYear: 10, qualifyingSites: sites })).toMatchObject({ stateId: "STATE_A", settlementId: "S_SMALL", presentationLabel: "Pantheon Center" });
  });

  it("does not fabricate Legendary Rewards and preserves one durable vacant/succession-capable office per item/world", () => {
    expect(legendaryRewardInventoryReadinessV1([], null)).toEqual({ status: "LEGENDARY_REWARD_INVENTORY_REQUIRED", itemCount: null });
    const items = [{ legendaryRewardItemId: "ITEM_AUTH_1", canonicalName: "Approved item", canonicalDescription: "From approved fixture authority", authorityRevisionId: "ITEM_REV_1", sourceAuthorityRef: "TEST_AUTHORITY", active: true }];
    const offices = materializeKeeperOfficesV1(items, "ITEM_REV_1");
    expect(offices).toHaveLength(3);
    validateKeeperArchitectureV1(items, offices, []);
    let terms = succeedKeeperHolderV1({ office: offices[0]!, terms: [], holderPersonId: "PERSON_1", year: 10, selectionEventId: "EVT_APPOINT_1", authorityRevisionId: "APPOINT_REV_1" });
    terms = succeedKeeperHolderV1({ office: offices[0]!, terms, holderPersonId: "PERSON_2", year: 20, selectionEventId: "EVT_APPOINT_2", authorityRevisionId: "APPOINT_REV_2" });
    expect(terms.map((term) => [term.holderPersonId, term.effectiveFromYear, term.effectiveToYear])).toEqual([["PERSON_1", 10, 20], ["PERSON_2", 20, null]]);
    validateKeeperArchitectureV1(items, offices, terms);
  });

  it("provides 54 complete atrocity definitions in the separate identifier domain with shared harm authority", () => {
    const definitions = buildAtrocityWorldDefinitionsV1();
    expect(() => validateAtrocityWorldDefinitionsV1(definitions)).not.toThrow();
    expect(V5_ATROCITY_OCCURRENCE_IDS).toHaveLength(18);
    expect(definitions).toHaveLength(54);
    expect(new Set(definitions.map((definition) => definition.numericPolicy.harmSharePolicyId))).toEqual(new Set(["ATROCITY_HARM_SHARE"]));
    expect(definitions.every((definition) => !/WITNESS|SEAL|HARNESS|RING|MANTLE|LOOM|PATCHWORK/.test(definition.definitionId))).toBe(true);
    expect(ATROCITY_INTEGRATION_FIXTURES_V1.map((fixture) => fixture.fixtureId)).toEqual(["POISONED_WELL", "RUIN_LITERACY_CREDENTIAL"]);
  });

  it("builds a deterministic selected-year Atlas overlay without mixed-year data", () => {
    const boundary = { runCurrentYear: 12, commonProjectedThroughYear: 10, selectedDataYear: 10, freshness: "STALE" as const, mixedYearReadsAllowed: false as const };
    const features = [{ featureId: "STATE_CELL", layer: "STATE_TERRITORY" as const, geometryType: "POLYGON" as const, coordinates: [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }, { latitude: 1, longitude: 1 }, { latitude: 0, longitude: 0 }], controllerId: "STATE_A", status: "CLAIMED", acceptedLabel: null, sourceIdentityId: "CELL_A", evidenceRef: "TERRITORY_TERM_10" }];
    const first = buildDynamicAtlasOverlayV1({ runId: "RUN", worldKey: "CONCORD", boundary, features });
    const second = buildDynamicAtlasOverlayV1({ runId: "RUN", worldKey: "CONCORD", boundary, features });
    expect(second.contentSha256).toBe(first.contentSha256);
    expect(first).toMatchObject({ runYear: 12, commonProjectedThroughYear: 10, selectedDataYear: 10, freshness: "STALE", mixedYearReadsAllowed: false });
  });
});
