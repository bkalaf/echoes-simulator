import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../../src/core/serialization/canonical-json.js";
import { diagnosticCandidateOwnerInputsV1, type CanonicalDataV5 } from "../../src/core/v5/config.js";
import {
  applySecurityCommandDecapitationV5,
  changeSecurityOrganizationControlV5,
  dissolveSecurityOrganizationV5,
  updateCivicInstitutionsAndSecurityV5,
  updateIndustriesAndGuildsV5,
  validateSecurityForceOrganizationIntegrityV5,
} from "../../src/core/v5/historical-dynamism.js";
import { restoreWorldStateV5, v5CheckpointHash } from "../../src/core/v5/persistence.js";
import { V5_SECURITY_FORCE_TYPES, type OrganizationV5, type OwnershipStakeV5, type WorldStateV5 } from "../../src/core/v5/types.js";

const canonical: CanonicalDataV5 = {
  schemaVersion: "echoes-canonical-data-v5", canonicalBundleHash: "security-integrity-fixture", breeds: [], sites: [], regions: [], governments: [], economicForms: [], physicalPois: [], routeCorridors: [],
  sovereigns: { CONCORD: { sovereignFaction: "CONCORD", breedId: "BREED", seizureTargetSiteId: "SITE" }, SCHISM: { sovereignFaction: "SCHISM", breedId: "BREED", seizureTargetSiteId: "SITE" }, RUIN: { sovereignFaction: "RUIN", breedId: "BREED", seizureTargetSiteId: "SITE" } },
  groupRegionAssignments: { CONCORD: {}, SCHISM: {}, RUIN: {} }, initialSettlements: [], canonicalLabels: {}, canonicalEvents: [],
};

const parentOrganizations: OrganizationV5[] = [
  { organizationId: "CORPORATION", type: "CORPORATION", sectorId: "MANUFACTURE", homeSettlementId: "SETTLEMENT", founderControllerType: "STATE", founderControllerId: "STATE", wealth: 800, influence: 700, status: "ACTIVE", belowSurvivalReviewCount: 0, formationYear: 0, dissolutionYear: null },
  { organizationId: "CRIME", type: "CRIME_ORGANIZATION", sectorId: "TRADE_AND_TRANSPORT", homeSettlementId: "SETTLEMENT", founderControllerType: "FAMILY", founderControllerId: "FAMILY", wealth: 800, influence: 700, status: "ACTIVE", belowSurvivalReviewCount: 0, formationYear: 0, dissolutionYear: null },
  { organizationId: "GUILD", type: "GUILD", sectorId: "MANUFACTURE", homeSettlementId: "SETTLEMENT", founderControllerType: "DIFFUSE", founderControllerId: "MEMBERS_GUILD", wealth: 800, influence: 700, status: "ACTIVE", belowSurvivalReviewCount: 0, formationYear: 0, dissolutionYear: null },
];
const parentStakes: OwnershipStakeV5[] = parentOrganizations.map((organization) => ({ stakeId: `STAKE_${organization.organizationId}`, organizationId: organization.organizationId, controllerType: organization.founderControllerType, controllerId: organization.founderControllerId, ownershipShareBps: 10_000, controlShareBps: 10_000, startYear: 0, endYear: null, sourceEventId: "FIXTURE" }));

function fixture(): WorldStateV5 {
  return {
    schemaVersion: "echoes-world-state-v5", worldKey: "CONCORD", year: 10,
    cohorts: [{ settlementId: "SETTLEMENT", breedId: "BREED", tiers: { HIGH: { population: 10_000n, prosperity: 700 }, MID: { population: 10_000n, prosperity: 500 }, LOW: { population: 10_000n, prosperity: 300 } } }],
    settlements: [{ settlementId: "SETTLEMENT", siteId: "SITE", regionId: "REGION", stateId: "STATE", foundedYear: 0, unrest: 0, sectorStrengths: { LAND_AND_FOOD: 700, EXTRACTION: 700, MANUFACTURE: 700, TRADE_AND_TRANSPORT: 700, KNOWLEDGE_AND_SERVICES: 700 } }],
    states: [{ stateId: "STATE", actualGovernment: "GOVERNMENT", factionAffinity: { CONCORD: 800, SCHISM: 100, RUIN: 100 }, dominantFaction: "CONCORD", legitimacy: 700, qualifyingGovernmentReviewCount: 0, lastGovernmentTransitionYear: 0, routineTransitionCooldownUntilYear: 0 }],
    families: [{ familyId: "FAMILY", homeSettlementId: "SETTLEMENT", founderBreedId: "BREED", factionAffinity: { CONCORD: 800, SCHISM: 100, RUIN: 100 }, wealth: 800, influence: 700, prestige: 600, status: "ACTIVE", foundingYear: 0, extinctionYear: null }],
    politicalPeople: [], personRelations: [], organizations: structuredClone(parentOrganizations),
    institutions: [{ institutionId: "CIVIC_CONCORD_SETTLEMENT_MILITARY_SECURITY", stateId: "STATE", institutionType: "MILITARY_SECURITY", jurisdictionSettlementId: "SETTLEMENT", capacity: 800, foundedYear: 0, dissolvedYear: null }, { institutionId: "CIVIC_CONCORD_SETTLEMENT_FAITH", stateId: "STATE", institutionType: "FAITH", jurisdictionSettlementId: "SETTLEMENT", capacity: 800, foundedYear: 0, dissolvedYear: null }],
    offices: [], officeTerms: [], ownershipStakes: structuredClone(parentStakes), familyRelations: [], borderRelations: [], timedConditions: [], activeConflicts: [], worldRoutes: [], resourceNodes: [], worldResourceStates: [], industries: [], securityForces: [], diplomaticRelations: [], diplomaticAgreements: [], conflictEpisodes: [], settlementControlTerms: [], populationSlices: [], derogatoryTargetSelections: [], localAtrocityResponses: [], forcedDisplacements: [], enclaves: [],
  };
}

const context = { canonical, ownerInputs: diagnosticCandidateOwnerInputsV1({ GOVERNMENT: {} }), mode: "DIAGNOSTIC" as const };

describe("V5.4 SecurityForce Organization integrity", () => {
  it("forms all seven force types as real, controlled Organizations with external naming requests", () => {
    const result = updateCivicInstitutionsAndSecurityV5(fixture(), context);
    expect({ stateHash: v5CheckpointHash(result.state), eventHash: createHash("sha256").update(canonicalJson(result.events)).digest("hex"), namingHash: createHash("sha256").update(canonicalJson(result.namingRequests)).digest("hex") }).toEqual({ stateHash: "b0b408957330e53740cb4d6cf9f64f76434b8e499736e05a74b0ea3fbf302fc5", eventHash: "1614a5668c66650b2d43d758f70989e10acf8380968db1630df2db1fd86d056a", namingHash: "27dabb02212fea0558afb10a20c591b51b8b4617cdbdf94e482b329e5098237c" });
    expect(result.state.securityForces?.map((force) => force.forceType).sort()).toEqual([...V5_SECURITY_FORCE_TYPES].sort());
    expect(result.state.securityForces).toHaveLength(7);
    expect(result.namingRequests).toHaveLength(7);
    expect(result.namingRequests.every((request) => request.entityType === "ORGANIZATION" && request.acceptedLabel === null)).toBe(true);
    for (const force of result.state.securityForces ?? []) {
      const organization = result.state.organizations.find((row) => row.organizationId === force.organizationId);
      expect(organization).toBeDefined();
      expect(force.organizationId).not.toBe(force.securityForceId);
      expect(result.state.ownershipStakes.some((stake) => stake.organizationId === force.organizationId && stake.endYear === null)).toBe(true);
    }
    expect(() => validateSecurityForceOrganizationIntegrityV5(result.state)).not.toThrow();
  });

  it("matches the frozen pre-index industry fixture", () => {
    const initial = fixture();
    const resourceTypes = ["WOOD", "FRESH_WATER", "IRON_ORE", "COAL"] as const;
    const withResources: WorldStateV5 = { ...initial,
      timedConditions: [{ conditionId: "COND_GUILD_FORESTRY", type: "GUILD_FORMATION_CANDIDATE", targetType: "SETTLEMENT", targetId: "SETTLEMENT", magnitude: 700, startYear: 5, endYear: null, sourceEventId: "FIXTURE", key: "GUILD_CONCORD_SETTLEMENT_FORESTRY/CANDIDATE", qualifyingReviewCount: 1 }],
      resourceNodes: resourceTypes.map((resourceType, index) => ({ resourceNodeId: `RESOURCE_${resourceType}`, resourceType, siteId: "SITE", regionId: "REGION", quality: 650 + index * 10, capacityClass: "MODERATE" as const, renewable: resourceType === "WOOD" || resourceType === "FRESH_WATER", accessDifficulty: 100, placementAuthorityRef: "FIXTURE" })),
      worldResourceStates: resourceTypes.map((resourceType) => ({ worldResourceStateId: `RESOURCE_STATE_${resourceType}`, resourceNodeId: `RESOURCE_${resourceType}`, controllerType: "STATE" as const, controllerId: "STATE", discoveryYear: 0, availability: "AVAILABLE" as const, seizedByEventId: null })),
    };
    const result = updateIndustriesAndGuildsV5(withResources, context);
    expect({ stateHash: v5CheckpointHash(result.state), eventHash: createHash("sha256").update(canonicalJson(result.events)).digest("hex"), namingHash: createHash("sha256").update(canonicalJson(result.namingRequests)).digest("hex") }).toEqual({ stateHash: "163d508ecac6019383bfc159142c3ddaf4fa56b47d061cb509cd4133fcbe1ce7", eventHash: "a339dda94faaf375f7bbdc942c7de88872bac813022ed92f46603f65cf050e2f", namingHash: "296274bc036beb6f38e15fb7df1d6e5775c363431ff59664389e5410b329a8a3" });
    expect(result.state.industries).toHaveLength(40);
  });

  it("fails causal validation on a dangling Organization or controller identity", () => {
    const state = updateCivicInstitutionsAndSecurityV5(fixture(), context).state;
    const danglingOrganization = { ...state, organizations: state.organizations.filter((organization) => organization.organizationId !== state.securityForces![0]!.organizationId) };
    expect(() => validateSecurityForceOrganizationIntegrityV5(danglingOrganization)).toThrow(/unknown Organization/);
    const danglingController = { ...state, securityForces: state.securityForces!.map((force, index) => index === 0 ? { ...force, controllerType: "FAMILY" as const, controllerId: "MISSING_FAMILY" } : force) };
    expect(() => validateSecurityForceOrganizationIntegrityV5(danglingController)).toThrow(/unknown FAMILY/);
  });

  it("traces command decapitation, control change, and dissolution without erasing Organization identity", () => {
    const formed = updateCivicInstitutionsAndSecurityV5(fixture(), context).state;
    const force = formed.securityForces!.find((row) => row.forceType === "FAMILY_GUARD")!;
    const commanded = { ...formed, politicalPeople: [{ personId: "OFFICER", familyId: "FAMILY", breedId: "BREED", originSettlementId: "SETTLEMENT", sourceTier: "HIGH" as const, sourceClass: null, birthYear: -30, activeFromYear: 0, plannedRetirementYear: null, actualRetirementYear: null, naturalDeathYear: 80, actualDeathYear: null, disqualifiedFromYear: null, requalifiedYear: null }], securityForces: formed.securityForces!.map((row) => row.securityForceId === force.securityForceId ? { ...row, seniorOfficerPersonIds: ["OFFICER"] } : row) };
    const decapitated = applySecurityCommandDecapitationV5(commanded, force.securityForceId, ["OFFICER"], "DECAPITATION");
    expect(decapitated.state.securityForces!.find((row) => row.securityForceId === force.securityForceId)).toMatchObject({ seniorOfficerPersonIds: [], status: "DEGRADED" });
    expect(decapitated.state.organizations.some((organization) => organization.organizationId === force.organizationId)).toBe(true);
    const changed = changeSecurityOrganizationControlV5(decapitated.state, force.organizationId, { controllerType: "STATE", controllerId: "STATE" }, "DEFECTION");
    expect(changed.state.securityForces!.find((row) => row.securityForceId === force.securityForceId)).toMatchObject({ controllerType: "STATE", controllerId: "STATE", status: "DEFECTED" });
    expect(changed.events.map((event) => event.eventType)).toContain("SecurityOrganizationControlChanged");
    const dissolved = dissolveSecurityOrganizationV5(changed.state, force.organizationId, "DISSOLUTION");
    expect(dissolved.state.organizations.find((organization) => organization.organizationId === force.organizationId)).toMatchObject({ status: "DISSOLVED", dissolutionYear: 10 });
    expect(dissolved.state.securityForces!.find((row) => row.securityForceId === force.securityForceId)).toMatchObject({ personnel: 0n, status: "DISSOLVED" });
    expect(dissolved.events.map((event) => event.eventType)).toContain("SecurityOrganizationDissolved");
  });

  it("preserves Organization and force identity through checkpoint restoration", () => {
    const state = updateCivicInstitutionsAndSecurityV5(fixture(), context).state;
    const restored = restoreWorldStateV5(JSON.parse(JSON.stringify(state, (_key, value) => typeof value === "bigint" ? value.toString() : value)));
    expect(v5CheckpointHash(restored)).toBe(v5CheckpointHash(state));
    expect(canonicalJson(restored.organizations)).toBe(canonicalJson(state.organizations));
    expect(canonicalJson(restored.securityForces)).toBe(canonicalJson(state.securityForces));
    expect(() => validateSecurityForceOrganizationIntegrityV5(restored)).not.toThrow();
  });
});
