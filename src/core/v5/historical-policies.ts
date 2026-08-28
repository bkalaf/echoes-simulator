import { createHash } from "node:crypto";
import { canonicalJson } from "../serialization/canonical-json.js";
import type { BasisPoints, CivicInstitutionTypeV5, DerogatoryGroupIdV5, IndustryTypeV5, ResourceTypeV5, Score1000 } from "./types.js";

export const V5_HISTORICAL_POLICY_KEYS = [
  "RESOURCE_INDUSTRY",
  "CIVIC_INSTITUTION_SECURITY",
  "DIPLOMACY_CONFLICT",
  "DEROGATORY_MEMBERSHIP_SLICING",
  "PERSECUTION_DISPLACEMENT_ENCLAVE",
] as const;
export type HistoricalPolicyKeyV5 = (typeof V5_HISTORICAL_POLICY_KEYS)[number];

export interface ResourcePlacementRuleV5 {
  resourceType: ResourceTypeV5;
  broadTerrain: readonly string[];
  specificTerrain: readonly string[];
  renewable: boolean;
  scarcityDivisor: number;
  baseAccessDifficulty: Score1000;
}

export interface ResourceIndustryPolicyV1 {
  schemaVersion: "echoes-resource-industry-policy-v1";
  authorityStatus: "DIAGNOSTIC_CANDIDATE" | "OWNER_APPROVED";
  humanReadableName: string;
  placementRules: readonly ResourcePlacementRuleV5[];
  industryResourceDependencies: Partial<Record<IndustryTypeV5, readonly ResourceTypeV5[]>>;
  industryFormationMinimum: Score1000;
  industryInertiaBps: BasisPoints;
  guildFormationThreshold: Score1000;
  guildRequiredReviews: number;
  guildFormationMaximumChanceBps: BasisPoints;
}

export interface CivicInstitutionSecurityPolicyV1 {
  schemaVersion: "echoes-civic-institution-security-policy-v1";
  authorityStatus: "DIAGNOSTIC_CANDIDATE" | "OWNER_APPROVED";
  humanReadableName: string;
  supportedInstitutionTypes: readonly CivicInstitutionTypeV5[];
  institutionFormationMinimumPopulation: bigint;
  baseCapacityByType: Readonly<Record<CivicInstitutionTypeV5, Score1000>>;
  institutionFormationThreshold: Score1000;
  institutionRequiredReviews: number;
  capacityInertiaBps: BasisPoints;
  securityFormationThreshold: Score1000;
  suppressionUnrestReliefMaximum: Score1000;
  abusiveRepressionHostilityDelta: Score1000;
  commandDecapitationDamage: Score1000;
  commandRecoveryYears: number;
}

export interface DiplomacyConflictPolicyV1 {
  schemaVersion: "echoes-diplomacy-conflict-policy-v1";
  authorityStatus: "DIAGNOSTIC_CANDIDATE" | "OWNER_APPROVED";
  humanReadableName: string;
  stageThresholds: {
    dispute: Score1000;
    borderIncident: Score1000;
    skirmish: Score1000;
    sustainedSkirmish: Score1000;
    war: Score1000;
    peace: Score1000;
  };
  reviewIntervalYears: number;
  siegeMaximumMortalityBps: BasisPoints;
  siegeMaximumDisplacementBps: BasisPoints;
  embargoIndustryDamage: Score1000;
  piracyTradeDamage: Score1000;
  resourceSeizureGrievanceDelta: Score1000;
}

export interface DerogatoryMembershipPredicateV1 {
  groupId: DerogatoryGroupIdV5;
  status: "READY" | "NOT_READY";
  description: string;
  populationKinds?: readonly ("HUMAN" | "BEAST" | "MYTHOS" | "PET")[];
  terrainBroad?: readonly string[];
  terrainSpecific?: readonly string[];
  breedIds?: readonly string[];
  aggregateShareBps?: BasisPoints;
  authorityRef: string | null;
}

export interface DerogatoryMembershipSlicingPolicyV1 {
  schemaVersion: "echoes-derogatory-membership-slicing-policy-v1";
  authorityStatus: "DIAGNOSTIC_CANDIDATE" | "OWNER_APPROVED";
  humanReadableName: string;
  predicates: readonly DerogatoryMembershipPredicateV1[];
  conditionalOverlapSharesBps: Readonly<Record<string, BasisPoints>>;
  maximumMaterializedSlicesPerAggregate: number;
}

export interface PersecutionDisplacementEnclavePolicyV1 {
  schemaVersion: "echoes-persecution-displacement-enclave-policy-v1";
  authorityStatus: "DIAGNOSTIC_CANDIDATE" | "OWNER_APPROVED";
  humanReadableName: string;
  responseScoreWeights: {
    faction: BasisPoints;
    government: BasisPoints;
    institutionCapacity: BasisPoints;
    targetPresence: BasisPoints;
    sovereignRelationship: BasisPoints;
    unrest: BasisPoints;
    security: BasisPoints;
    wealthIncentive: BasisPoints;
  };
  enclaveSupportBurdenWeights: {
    hiddenPopulationShare: BasisPoints;
    secrecyProtection: BasisPoints;
    accessDifficulty: BasisPoints;
    inverseInstitutionCapacity: BasisPoints;
  };
  enclaveMaximumBreedsAtFounding: 2;
  cavernTerrain: readonly string[];
  underwaterTerrain: readonly string[];
  floatingUndersideTerrain: readonly string[];
}

export interface HistoricalDynamismPolicySetV1 {
  RESOURCE_INDUSTRY: ResourceIndustryPolicyV1;
  CIVIC_INSTITUTION_SECURITY: CivicInstitutionSecurityPolicyV1;
  DIPLOMACY_CONFLICT: DiplomacyConflictPolicyV1;
  DEROGATORY_MEMBERSHIP_SLICING: DerogatoryMembershipSlicingPolicyV1;
  PERSECUTION_DISPLACEMENT_ENCLAVE: PersecutionDisplacementEnclavePolicyV1;
}

export interface CausalPolicyBlockerV5 {
  schemaVersion: "echoes-v5-causal-policy-blocker-v1";
  policyKey: string;
  policySha256: string;
  policyDocument: unknown;
  humanReadablePolicy: string;
  causalOperation: string;
  worldKey: string;
  year: number;
  entityType: string;
  entityId: string;
  requiredApproval: string;
}

export class PolicyAuthorityRequiredV5 extends Error {
  readonly blocker: CausalPolicyBlockerV5;

  constructor(blocker: CausalPolicyBlockerV5) {
    super(`V5 policy authority required at point of use: ${blocker.policyKey} for ${blocker.causalOperation} ${blocker.worldKey}/${blocker.year}/${blocker.entityType}/${blocker.entityId}`);
    this.name = "PolicyAuthorityRequiredV5";
    this.blocker = blocker;
  }
}

export function historicalPolicyHashV5(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function requireHistoricalPolicyV5<K extends HistoricalPolicyKeyV5>(input: {
  mode: "CANONICAL" | "DIAGNOSTIC";
  policies: Partial<HistoricalDynamismPolicySetV1> | undefined;
  approvedHashes: Partial<Record<HistoricalPolicyKeyV5, string | null>> | undefined;
  diagnosticCandidateOptIns: readonly HistoricalPolicyKeyV5[] | undefined;
  policyKey: K;
  causalOperation: string;
  worldKey: string;
  year: number;
  entityType: string;
  entityId: string;
}): HistoricalDynamismPolicySetV1[K] {
  const policy = input.policies?.[input.policyKey];
  const policySha256 = historicalPolicyHashV5(policy ?? null);
  const approved = Boolean(policy && input.approvedHashes?.[input.policyKey] === policySha256);
  const diagnosticOptIn = input.mode === "DIAGNOSTIC" && Boolean(policy && input.diagnosticCandidateOptIns?.includes(input.policyKey));
  if (approved || diagnosticOptIn) return policy as HistoricalDynamismPolicySetV1[K];
  const humanReadablePolicy = policy && typeof policy === "object" && "humanReadableName" in policy ? String(policy.humanReadableName) : `${input.policyKey} policy is absent`;
  throw new PolicyAuthorityRequiredV5({
    schemaVersion: "echoes-v5-causal-policy-blocker-v1",
    policyKey: input.policyKey,
    policySha256,
    policyDocument: policy ?? null,
    humanReadablePolicy,
    causalOperation: input.causalOperation,
    worldKey: input.worldKey,
    year: input.year,
    entityType: input.entityType,
    entityId: input.entityId,
    requiredApproval: `Supply the exact policy SHA-256 ${policySha256} as approved authority for ${input.policyKey}`,
  });
}

const placement = (resourceType: ResourceTypeV5, broadTerrain: readonly string[], specificTerrain: readonly string[], renewable: boolean, scarcityDivisor: number, baseAccessDifficulty: Score1000): ResourcePlacementRuleV5 => ({ resourceType, broadTerrain, specificTerrain, renewable, scarcityDivisor, baseAccessDifficulty });

export const CANDIDATE_RESOURCE_INDUSTRY_POLICY_V1: ResourceIndustryPolicyV1 = {
  schemaVersion: "echoes-resource-industry-policy-v1",
  authorityStatus: "DIAGNOSTIC_CANDIDATE",
  humanReadableName: "V5.4 diagnostic candidate resource geography, lightweight industry, and Guild formation policy",
  placementRules: [
    placement("WOOD", ["FOREST"], ["WOODLAND", "RAINFOREST", "MONTANE_FOREST"], true, 2, 250),
    placement("STONE", ["MOUNTAIN", "DESERT"], ["CLIFF", "CAVERN", "ROCKY"], false, 2, 350),
    placement("MARBLE", ["MOUNTAIN"], ["CLIFF", "ROCKY"], false, 7, 500),
    placement("IRON_ORE", ["MOUNTAIN"], ["CAVERN", "ROCKY"], false, 4, 550),
    placement("COPPER_ORE", ["MOUNTAIN", "DESERT"], ["CAVERN", "ROCKY"], false, 5, 500),
    placement("TIN_ORE", ["MOUNTAIN"], ["CAVERN", "ROCKY"], false, 7, 550),
    placement("COAL", ["MOUNTAIN", "SWAMP"], ["CAVERN", "PEATLAND"], false, 6, 600),
    placement("PRECIOUS_METAL", ["MOUNTAIN", "RIVER"], ["CAVERN", "ROCKY", "RIVERBANK"], false, 11, 700),
    placement("GEMS", ["MOUNTAIN", "DESERT"], ["CAVERN", "ROCKY"], false, 13, 750),
    placement("CLAY", ["RIVER", "WETLAND", "COASTAL"], ["RIVERBANK", "MARSH"], true, 3, 200),
    placement("SALT", ["COASTAL", "DESERT"], ["SALT_FLAT", "SHORE"], true, 4, 300),
    placement("SAND", ["DESERT", "COASTAL"], ["DUNE", "BEACH"], true, 2, 150),
    placement("FRESH_WATER", ["RIVER", "WETLAND", "MOUNTAIN"], ["LAKE", "SPRING", "RIVERBANK"], true, 1, 100),
    placement("FISHERY", ["OCEAN", "COASTAL", "RIVER", "WETLAND"], ["LAKE", "SHORE", "REEF"], true, 2, 250),
    placement("FARMLAND", ["PLAINS", "GRASSLAND", "RIVER"], ["MEADOW", "FLOODPLAIN"], true, 2, 150),
    placement("GRAZING_LAND", ["PLAINS", "GRASSLAND", "MOUNTAIN"], ["MEADOW", "ALPINE"], true, 2, 150),
    placement("HORSES", [], [], true, 17, 350),
    placement("PACK_ANIMALS", [], [], true, 13, 300),
    placement("FIBER", ["PLAINS", "GRASSLAND"], ["MEADOW"], true, 5, 250),
    placement("SILK", ["FOREST"], ["WOODLAND"], true, 11, 400),
    placement("LEATHER", ["PLAINS", "GRASSLAND"], ["MEADOW"], true, 5, 250),
    placement("INK_INPUT", ["FOREST", "COASTAL"], ["WOODLAND", "SHORE"], true, 7, 300),
    placement("PAPER_INPUT", ["FOREST", "RIVER"], ["WOODLAND", "RIVERBANK"], true, 5, 300),
    placement("MAGIC", [], [], true, 19, 800),
  ],
  industryResourceDependencies: {
    AGRICULTURE: ["FARMLAND", "FRESH_WATER"], ANIMAL_HUSBANDRY: ["GRAZING_LAND"], FISHING: ["FISHERY"], FORESTRY: ["WOOD"], MINING: ["IRON_ORE", "COPPER_ORE", "TIN_ORE", "COAL", "PRECIOUS_METAL", "GEMS"], QUARRYING: ["STONE", "MARBLE"],
    METALWORKING: ["IRON_ORE", "COPPER_ORE", "TIN_ORE", "COAL"], CONSTRUCTION: ["WOOD", "STONE", "CLAY", "SAND"], TEXTILES: ["FIBER", "SILK"], GARMENTS: ["FIBER", "SILK", "LEATHER"], LEATHERWORK: ["LEATHER"], PAPERMAKING: ["PAPER_INPUT", "FRESH_WATER"], PRINTING: ["PAPER_INPUT", "INK_INPUT"], INKMAKING: ["INK_INPUT"], TRANSPORT: ["HORSES", "PACK_ANIMALS"], SHIPPING: ["WOOD"], PRECIOUS_GOODS: ["PRECIOUS_METAL", "GEMS"], MAGICAL_SERVICES: ["MAGIC"],
  },
  industryFormationMinimum: 250,
  industryInertiaBps: 8000,
  guildFormationThreshold: 600,
  guildRequiredReviews: 2,
  guildFormationMaximumChanceBps: 5000,
};

export const CANDIDATE_CIVIC_INSTITUTION_SECURITY_POLICY_V1: CivicInstitutionSecurityPolicyV1 = {
  schemaVersion: "echoes-civic-institution-security-policy-v1", authorityStatus: "DIAGNOSTIC_CANDIDATE",
  humanReadableName: "V5.4 diagnostic candidate civic Institution capacity and unified security-force policy",
  supportedInstitutionTypes: ["BUREAUCRACY", "FAITH", "EDUCATION", "HEALTH_CARE", "NEWSPAPER_PRESS", "PROPAGANDA", "LAW", "COURTS", "PRISON", "BANKING", "GUILD", "MILITARY_SECURITY"],
  institutionFormationMinimumPopulation: 25_000n,
  baseCapacityByType: { BUREAUCRACY: 600, FAITH: 500, EDUCATION: 450, HEALTH_CARE: 450, NEWSPAPER_PRESS: 350, PROPAGANDA: 350, LAW: 550, COURTS: 500, PRISON: 400, BANKING: 450, GUILD: 500, MILITARY_SECURITY: 550 },
  institutionFormationThreshold: 550, institutionRequiredReviews: 2, capacityInertiaBps: 8000, securityFormationThreshold: 600,
  suppressionUnrestReliefMaximum: 60, abusiveRepressionHostilityDelta: 80, commandDecapitationDamage: 500, commandRecoveryYears: 10,
};

export const CANDIDATE_DIPLOMACY_CONFLICT_POLICY_V1: DiplomacyConflictPolicyV1 = {
  schemaVersion: "echoes-diplomacy-conflict-policy-v1", authorityStatus: "DIAGNOSTIC_CANDIDATE",
  humanReadableName: "V5.4 diagnostic candidate diplomacy, conflict escalation, siege, embargo, piracy, and resource-seizure policy",
  stageThresholds: { dispute: 400, borderIncident: 550, skirmish: 600, sustainedSkirmish: 675, war: 750, peace: 300 }, reviewIntervalYears: 5,
  siegeMaximumMortalityBps: 20, siegeMaximumDisplacementBps: 100, embargoIndustryDamage: 60, piracyTradeDamage: 50, resourceSeizureGrievanceDelta: 120,
};

const notReadyPredicate = (groupId: DerogatoryGroupIdV5): DerogatoryMembershipPredicateV1 => ({ groupId, status: "NOT_READY", description: "No approved structured predicate is present in the current canonical adapter", authorityRef: null });
export const CANDIDATE_DEROGATORY_MEMBERSHIP_SLICING_POLICY_V1: DerogatoryMembershipSlicingPolicyV1 = {
  schemaVersion: "echoes-derogatory-membership-slicing-policy-v1", authorityStatus: "DIAGNOSTIC_CANDIDATE",
  humanReadableName: "V5.4 diagnostic candidate fail-closed Derogatory Group membership and exact aggregate slicing policy",
  predicates: [
    notReadyPredicate("homosexual"), notReadyPredicate("bisexual"), notReadyPredicate("transgender"), notReadyPredicate("black-skinned"), notReadyPredicate("white-skinned"),
    notReadyPredicate("birds"), notReadyPredicate("reptiles"), notReadyPredicate("amphibians"), notReadyPredicate("fish"), notReadyPredicate("demons"), notReadyPredicate("angels"), notReadyPredicate("woodland mythos"), notReadyPredicate("unborn"), notReadyPredicate("soulless"),
    { groupId: "beasts", status: "READY", description: "Canonical populationKind is BEAST", populationKinds: ["BEAST"], authorityRef: "CANONICAL_BREED_IDENTITY:populationKind" },
    { groupId: "mythos", status: "READY", description: "Canonical populationKind is MYTHOS", populationKinds: ["MYTHOS"], authorityRef: "CANONICAL_BREED_IDENTITY:populationKind" },
    { groupId: "humans", status: "READY", description: "Canonical populationKind is HUMAN", populationKinds: ["HUMAN"], authorityRef: "CANONICAL_BREED_IDENTITY:populationKind" },
    { groupId: "cave dwellers", status: "READY", description: "Canonical Breed terrain includes an approved cave or cavern tag", terrainSpecific: ["CAVE", "CAVERN"], authorityRef: "CANONICAL_BREED_SEMANTICS:terrainSpecific" },
    { groupId: "tree dwellers", status: "READY", description: "Canonical Breed terrain includes an approved woodland, canopy, or tree tag", terrainSpecific: ["WOODLAND", "CANOPY", "TREE"], authorityRef: "CANONICAL_BREED_SEMANTICS:terrainSpecific" },
    notReadyPredicate("cold blooded"), notReadyPredicate("carnivores"), notReadyPredicate("herbivores"), notReadyPredicate("multi-litters"), notReadyPredicate("egg layers"), notReadyPredicate("undead"), notReadyPredicate("elves"), notReadyPredicate("dwarves"), notReadyPredicate("insects"),
  ],
  conditionalOverlapSharesBps: {},
  maximumMaterializedSlicesPerAggregate: 32,
};

export const CANDIDATE_PERSECUTION_DISPLACEMENT_ENCLAVE_POLICY_V1: PersecutionDisplacementEnclavePolicyV1 = {
  schemaVersion: "echoes-persecution-displacement-enclave-policy-v1", authorityStatus: "DIAGNOSTIC_CANDIDATE",
  humanReadableName: "V5.4 diagnostic candidate local atrocity response, forced displacement, and Enclave support-burden policy",
  responseScoreWeights: { faction: 2000, government: 1500, institutionCapacity: 1500, targetPresence: 1500, sovereignRelationship: 1000, unrest: 1000, security: 1000, wealthIncentive: 500 },
  enclaveSupportBurdenWeights: { hiddenPopulationShare: 4000, secrecyProtection: 2500, accessDifficulty: 1500, inverseInstitutionCapacity: 2000 },
  enclaveMaximumBreedsAtFounding: 2,
  cavernTerrain: ["CAVE", "CAVERN", "UNDERGROUND"], underwaterTerrain: ["OCEAN", "COASTAL", "RIVER", "WETLAND", "LAKE", "REEF"], floatingUndersideTerrain: ["FLOATING_ISLAND", "SKYLAND", "AIRBORNE"],
};

export const CANDIDATE_HISTORICAL_DYNAMISM_POLICIES_V1: HistoricalDynamismPolicySetV1 = {
  RESOURCE_INDUSTRY: CANDIDATE_RESOURCE_INDUSTRY_POLICY_V1,
  CIVIC_INSTITUTION_SECURITY: CANDIDATE_CIVIC_INSTITUTION_SECURITY_POLICY_V1,
  DIPLOMACY_CONFLICT: CANDIDATE_DIPLOMACY_CONFLICT_POLICY_V1,
  DEROGATORY_MEMBERSHIP_SLICING: CANDIDATE_DEROGATORY_MEMBERSHIP_SLICING_POLICY_V1,
  PERSECUTION_DISPLACEMENT_ENCLAVE: CANDIDATE_PERSECUTION_DISPLACEMENT_ENCLAVE_POLICY_V1,
};
