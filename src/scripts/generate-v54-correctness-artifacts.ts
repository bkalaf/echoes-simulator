import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import { reconcileChamberAuthorityV5 } from "../core/v5/chambers.js";
import { DEFAULT_MECHANICS_VARIABLES_V1, diagnosticCandidateOwnerInputsV1, type CanonicalDataV5 } from "../core/v5/config.js";
import { executeHistoricalConflictActionV5 } from "../core/v5/conflict-actions.js";
import {
  applySecurityCommandDecapitationV5,
  changeSecurityOrganizationControlV5,
  dissolveSecurityOrganizationV5,
  updateCivicInstitutionsAndSecurityV5,
  validateSecurityForceOrganizationIntegrityV5,
} from "../core/v5/historical-dynamism.js";
import { restoreWorldStateV5, v5CheckpointHash } from "../core/v5/persistence.js";
import { ensurePopulationSlicesV5 } from "../core/v5/population-slices.js";
import { fillMandatoryOfficeVacancies } from "../core/v5/politics.js";
import { normalizeSeed } from "../core/v5/random.js";
import { V5_SECURITY_FORCE_TYPES, type OrganizationV5, type OwnershipStakeV5, type WorldStateV5 } from "../core/v5/types.js";

const outputDirectory = resolve("artifacts/simulator/v5/remediation");
mkdirSync(outputDirectory, { recursive: true });
const writeArtifact = (filename: string, value: unknown): void => writeFileSync(resolve(outputDirectory, filename), `${canonicalJson(value)}\n`, "utf8");
const sha = (value: unknown): string => createHash("sha256").update(canonicalJson(value)).digest("hex");

const securityCanonical: CanonicalDataV5 = {
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
function securityFixture(): WorldStateV5 {
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

const securityContext = { canonical: securityCanonical, ownerInputs: diagnosticCandidateOwnerInputsV1({ GOVERNMENT: {} }), mode: "DIAGNOSTIC" as const };
const formed = updateCivicInstitutionsAndSecurityV5(securityFixture(), securityContext);
validateSecurityForceOrganizationIntegrityV5(formed.state);
const restored = restoreWorldStateV5(JSON.parse(JSON.stringify(formed.state, (_key, value) => typeof value === "bigint" ? value.toString() : value)));
validateSecurityForceOrganizationIntegrityV5(restored);
const familyForce = formed.state.securityForces!.find((force) => force.forceType === "FAMILY_GUARD")!;
const commanded = { ...formed.state, politicalPeople: [{ personId: "OFFICER", familyId: "FAMILY", breedId: "BREED", originSettlementId: "SETTLEMENT", sourceTier: "HIGH" as const, sourceClass: null, birthYear: -30, activeFromYear: 0, plannedRetirementYear: null, actualRetirementYear: null, naturalDeathYear: 80, actualDeathYear: null, disqualifiedFromYear: null, requalifiedYear: null }], securityForces: formed.state.securityForces!.map((force) => force.securityForceId === familyForce.securityForceId ? { ...force, seniorOfficerPersonIds: ["OFFICER"] } : force) };
const decapitated = applySecurityCommandDecapitationV5(commanded, familyForce.securityForceId, ["OFFICER"], "DECAPITATION");
const defected = changeSecurityOrganizationControlV5(decapitated.state, familyForce.organizationId, { controllerType: "STATE", controllerId: "STATE" }, "DEFECTION");
const dissolved = dissolveSecurityOrganizationV5(defected.state, familyForce.organizationId, "DISSOLUTION");
const forceRows = V5_SECURITY_FORCE_TYPES.map((forceType) => {
  const force = formed.state.securityForces!.find((candidate) => candidate.forceType === forceType)!;
  const organization = formed.state.organizations.find((candidate) => candidate.organizationId === force.organizationId)!;
  const control = formed.state.ownershipStakes.find((stake) => stake.organizationId === organization.organizationId && stake.endYear === null)!;
  return { forceType, securityForceId: force.securityForceId, organizationId: force.organizationId, organizationType: organization.type, organizationExists: Boolean(organization), forceIdentityDistinct: force.securityForceId !== force.organizationId, controllerType: force.controllerType, controllerId: force.controllerId, controlStakeId: control.stakeId, controlShareBps: control.controlShareBps, namingRequestId: formed.namingRequests.find((request) => request.entityId === organization.organizationId)?.requestId ?? null };
});
writeArtifact("v54-security-force-organization-integrity.json", {
  schemaVersion: "echoes-v5.4-security-force-organization-integrity-v1", pass: forceRows.length === 7 && forceRows.every((row) => row.organizationExists && row.forceIdentityDistinct && row.controlShareBps === 10_000 && row.namingRequestId), forceTypes: forceRows,
  hashes: { stateHash: v5CheckpointHash(formed.state), eventHash: sha(formed.events), namingRequestHash: sha(formed.namingRequests), restoredStateHash: v5CheckpointHash(restored) }, externalNamingNonCausal: formed.namingRequests.every((request) => request.entityType === "ORGANIZATION" && request.acceptedLabel === null),
  lifecycle: { organizationId: familyForce.organizationId, decapitation: { forceStatus: decapitated.state.securityForces!.find((force) => force.securityForceId === familyForce.securityForceId)!.status, organizationStillExists: decapitated.state.organizations.some((organization) => organization.organizationId === familyForce.organizationId), eventTypes: decapitated.events.map((event) => event.eventType) }, defection: { forceStatus: defected.state.securityForces!.find((force) => force.securityForceId === familyForce.securityForceId)!.status, eventTypes: defected.events.map((event) => event.eventType) }, dissolution: { organizationStatus: dissolved.state.organizations.find((organization) => organization.organizationId === familyForce.organizationId)!.status, forceStatus: dissolved.state.securityForces!.find((force) => force.securityForceId === familyForce.securityForceId)!.status, personnel: dissolved.state.securityForces!.find((force) => force.securityForceId === familyForce.securityForceId)!.personnel, identityRetained: true, eventTypes: dissolved.events.map((event) => event.eventType) } },
});

const government = { governmentFormId: "GOV", doctrineVector: { CONCORD: 1000, SCHISM: 0, RUIN: 0 }, administrationMode: "CIVIC", legitimacyBasis: "CIVIC", authoritySource: "CIVIC", franchiseBreadth: 500, requiredInstitutions: [] };
const chamberCanonical: CanonicalDataV5 = {
  schemaVersion: "echoes-canonical-data-v5", canonicalBundleHash: "conquest-chamber-fixture", breeds: [{ breedId: "HUMAN", populationKind: "HUMAN", groupId: "H", factionObject: { CONCORD: 8, SCHISM: 1, RUIN: 1 }, dominantFaction: ["CONCORD"], terrainBroad: ["FOREST"], terrainSpecific: ["WOODLAND"], ownershipMode: "COMMON", allocationMode: "MARKET" }],
  sites: [{ siteId: "SITE_1", regionId: "R1", regionName: "One", latitude: 0, longitude: 0, terrainBroad: ["FOREST"], terrainSpecific: ["WOODLAND"], quality: 800 }, { siteId: "SITE_2", regionId: "R2", regionName: "Two", latitude: 1, longitude: 1, terrainBroad: ["GRASSLAND"], terrainSpecific: ["STEPPE"], quality: 600 }],
  regions: [{ regionId: "R1", directedAdjacentRegionIds: ["R2"] }, { regionId: "R2", directedAdjacentRegionIds: ["R1"] }], governments: [{ ...government, requiredInstitutions: [{ institutionType: "GOVERNMENT", offices: [{ jurisdictionSettlementId: null, titleKey: "RULER", power: 1000, mandatory: true, apex: true, termYears: 2, selectionRule: { selectionMethod: "RULER_APPOINTMENT", scope: "STATE", requiresTrackedLineage: false, eligibleTiers: ["HIGH", "MID"], minimumFactionCompatibility: 0, stochasticTies: false, scoreWeights: { factionFit: 3500, classFit: 1000, localSupport: 3000, lineageFit: 1500, ruleSpecificFit: 1000 } } }] }] }],
  economicForms: [{ ownershipMode: "COMMON", allocationMode: "MARKET", economicForm: "MARKET" }], physicalPois: [], routeCorridors: [], sovereigns: { CONCORD: { sovereignFaction: "CONCORD", breedId: "HUMAN", seizureTargetSiteId: "SITE_1" }, SCHISM: { sovereignFaction: "SCHISM", breedId: "HUMAN", seizureTargetSiteId: "SITE_2" }, RUIN: { sovereignFaction: "RUIN", breedId: "HUMAN", seizureTargetSiteId: "SITE_1" } }, groupRegionAssignments: { CONCORD: { H: "R1" }, SCHISM: { H: "R1" }, RUIN: { H: "R1" } }, initialSettlements: [], canonicalLabels: {}, canonicalEvents: [],
};
function chamberFixture(): WorldStateV5 {
  return ensurePopulationSlicesV5({
    schemaVersion: "echoes-world-state-v5", worldKey: "CONCORD", year: 30,
    cohorts: [{ settlementId: "S1", breedId: "HUMAN", tiers: { HIGH: { population: 1000n, prosperity: 700 }, MID: { population: 1000n, prosperity: 500 }, LOW: { population: 1000n, prosperity: 300 } } }, { settlementId: "S2", breedId: "HUMAN", tiers: { HIGH: { population: 500n, prosperity: 600 }, MID: { population: 500n, prosperity: 500 }, LOW: { population: 500n, prosperity: 400 } } }],
    settlements: [{ settlementId: "S1", siteId: "SITE_1", regionId: "R1", stateId: "STATE_A", foundedYear: 0, unrest: 0, sectorStrengths: { LAND_AND_FOOD: 700, EXTRACTION: 700, MANUFACTURE: 700, TRADE_AND_TRANSPORT: 700, KNOWLEDGE_AND_SERVICES: 700 } }, { settlementId: "S2", siteId: "SITE_2", regionId: "R2", stateId: "STATE_B", foundedYear: 0, unrest: 100, sectorStrengths: { LAND_AND_FOOD: 500, EXTRACTION: 500, MANUFACTURE: 500, TRADE_AND_TRANSPORT: 500, KNOWLEDGE_AND_SERVICES: 500 } }],
    states: [{ stateId: "STATE_A", actualGovernment: "GOV", factionAffinity: { CONCORD: 800, SCHISM: 100, RUIN: 100 }, dominantFaction: "CONCORD", legitimacy: 800, qualifyingGovernmentReviewCount: 0, lastGovernmentTransitionYear: 0, routineTransitionCooldownUntilYear: 0 }, { stateId: "STATE_B", actualGovernment: "GOV", factionAffinity: { CONCORD: 100, SCHISM: 800, RUIN: 100 }, dominantFaction: "SCHISM", legitimacy: 500, qualifyingGovernmentReviewCount: 0, lastGovernmentTransitionYear: 0, routineTransitionCooldownUntilYear: 0 }],
    families: [], politicalPeople: [], personRelations: [], organizations: [], institutions: [], offices: [], officeTerms: [], ownershipStakes: [], familyRelations: [], borderRelations: [], timedConditions: [], activeConflicts: [], worldRoutes: [], resourceNodes: [], worldResourceStates: [], industries: [], securityForces: [], diplomaticRelations: [], diplomaticAgreements: [], conflictEpisodes: [], settlementControlTerms: [], derogatoryTargetSelections: [], localAtrocityResponses: [], forcedDisplacements: [], enclaves: [],
  }, chamberCanonical);
}
const chamberOwner = diagnosticCandidateOwnerInputsV1({ GOV: {} });
const seed = normalizeSeed("CONQUEST_CHAMBER");
let chamberState = reconcileChamberAuthorityV5(chamberFixture(), chamberCanonical).state;
chamberState = fillMandatoryOfficeVacancies(chamberState, chamberCanonical, chamberOwner, DEFAULT_MECHANICS_VARIABLES_V1, seed, "INITIAL").state;
const stateASeat = chamberState.offices.find((office) => office.officeId.includes("STATE_A_S1"))!;
const initialTerm = chamberState.officeTerms.find((term) => term.officeId === stateASeat.officeId)!;
const occupation = executeHistoricalConflictActionV5({ state: { ...chamberState, year: 31 }, canonical: chamberCanonical, ownerInputs: chamberOwner, mode: "DIAGNOSTIC", action: { actionId: "OCCUPATION", year: 31, type: "OCCUPATION_CAPTURE", settlementId: "S1", controllerStateId: "STATE_B" } });
const occupationReconciled = reconcileChamberAuthorityV5(occupation.state, chamberCanonical);
const conquest = executeHistoricalConflictActionV5({ state: { ...occupationReconciled.state, year: 32 }, canonical: chamberCanonical, ownerInputs: chamberOwner, mode: "DIAGNOSTIC", action: { actionId: "CONQUEST", year: 32, type: "CONQUEST", settlementId: "S1", controllerStateId: "STATE_B" } });
const conquestReconciled = reconcileChamberAuthorityV5(conquest.state, chamberCanonical);
chamberState = fillMandatoryOfficeVacancies(conquestReconciled.state, chamberCanonical, chamberOwner, DEFAULT_MECHANICS_VARIABLES_V1, seed, "AFTER_CONQUEST").state;
const stateBSeat = chamberState.offices.find((office) => office.officeId.includes("STATE_B_S1"))!;
chamberState = { ...chamberState, year: 34, officeTerms: chamberState.officeTerms.map((term) => term.officeId === stateBSeat.officeId && term.endYear === null ? { ...term, endYear: 34, terminationReason: "TERM_EXPIRED" as const } : term) };
const nextCycle = fillMandatoryOfficeVacancies(chamberState, chamberCanonical, chamberOwner, DEFAULT_MECHANICS_VARIABLES_V1, seed, "NEXT_CYCLE");
const treaty = executeHistoricalConflictActionV5({ state: { ...nextCycle.state, year: 35 }, canonical: chamberCanonical, ownerInputs: chamberOwner, mode: "DIAGNOSTIC", action: { actionId: "TREATY_MEMBERSHIP", year: 35, type: "TREATY", stateAId: "STATE_A", stateBId: "STATE_B", settlementId: "S1", legalStateId: "STATE_A" } });
const treatyReconciled = reconcileChamberAuthorityV5(treaty.state, chamberCanonical);
const treatyFilled = fillMandatoryOfficeVacancies(treatyReconciled.state, chamberCanonical, chamberOwner, DEFAULT_MECHANICS_VARIABLES_V1, seed, "AFTER_TREATY");
writeArtifact("v54-conquest-chamber-integration.json", {
  schemaVersion: "echoes-v5.4-conquest-chamber-integration-v1", pass: occupation.state.settlements.find((settlement) => settlement.settlementId === "S1")!.stateId === "STATE_A" && conquest.state.settlements.find((settlement) => settlement.settlementId === "S1")!.stateId === "STATE_B" && treaty.state.settlements.find((settlement) => settlement.settlementId === "S1")!.stateId === "STATE_A",
  initial: { year: 30, seatId: stateASeat.officeId, officeTermId: initialTerm.officeTermId, legalStateId: "STATE_A" },
  occupation: { year: 31, legalStateId: occupation.state.settlements.find((settlement) => settlement.settlementId === "S1")!.stateId, operationalControllerStateId: occupation.state.settlementControlTerms!.at(-1)!.controllerStateId, eventTypes: occupation.events.map((event) => event.eventType), originalSeatMandatory: occupationReconciled.state.offices.find((office) => office.officeId === stateASeat.officeId)!.mandatory },
  conquest: { year: 32, legalStateId: conquest.state.settlements.find((settlement) => settlement.settlementId === "S1")!.stateId, eventTypes: conquest.events.map((event) => event.eventType), reconciliationEventTypes: conquestReconciled.events.map((event) => event.eventType), retiredSeatId: stateASeat.officeId, replacementSeatId: stateBSeat.officeId, replacementTermId: chamberState.officeTerms.find((term) => term.officeId === stateBSeat.officeId)!.officeTermId },
  subsequentCycle: { year: 34, stateBSeatId: stateBSeat.officeId, selectedTermIds: nextCycle.state.officeTerms.filter((term) => term.officeId === stateBSeat.officeId && term.startYear === 34).map((term) => term.officeTermId), eventTypes: nextCycle.events.map((event) => event.eventType) },
  treaty: { year: 35, legalStateId: treaty.state.settlements.find((settlement) => settlement.settlementId === "S1")!.stateId, eventTypes: treaty.events.map((event) => event.eventType), reconciliationEventTypes: treatyReconciled.events.map((event) => event.eventType), stateASeatMandatory: treatyFilled.state.offices.find((office) => office.officeId === stateASeat.officeId)!.mandatory },
  finalStateHash: v5CheckpointHash(treatyFilled.state), aggregateSourceResolution: "PASS", officeTermLifecycle: "PASS",
});

process.stdout.write(`${canonicalJson({ status: "PASS", artifacts: ["v54-security-force-organization-integrity.json", "v54-conquest-chamber-integration.json"] })}\n`);
