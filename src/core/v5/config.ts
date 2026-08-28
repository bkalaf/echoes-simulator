import { createHash } from "node:crypto";
import { canonicalJson } from "../serialization/canonical-json.js";
import type { BasisPoints, GovernmentFormId, Score1000, SocialClass, SocialTier, WorldKey } from "./types.js";
import type { ShockDefinitionV5 } from "./effects.js";

export const V5_MECHANICS_VERSION = "echoes-mechanics-v5.3.0";
export const V5_CAUSAL_DERIVATION_VERSION = "echoes-derived-metrics-v1.1.0";
export const V5_SCHEDULER_VERSION = "echoes-scheduler-v5.3.0";
export const V5_DURABLE_SCHEMA_VERSION = "echoes-world-state-v5";
export const V5_READ_MODEL_VERSION = "echoes-read-model-v1.1.0";

export interface MechanicsVariablesV1 {
  schemaVersion: "echoes-mechanics-variables-v1";
  initialPopulation: bigint;
  initialTierWeights: readonly [bigint, bigint, bigint];
  sovereignTieBreak: boolean;
  growthRatesPpm: { LOW: number; MEDIUM: number; HIGH: number };
  growthNonAlignmentDeductionPpm: number;
  structuralReviewIntervalYears: number;
  migrationReviewIntervalYears: number;

  migrationPushThreshold: Score1000;
  migrationPushWeights: { factionMismatch: BasisPoints; economicDisadvantage: BasisPoints; unrest: BasisPoints };
  migrationMaximumOutflowBps: BasisPoints;
  migrationMaximumHops: number;
  migrationDestinationMinimumAttractiveness: Score1000;
  migrationAttractivenessWeights: { opportunity: BasisPoints; faction: BasisPoints; stability: BasisPoints; terrain: BasisPoints };
  foundingRequiredReviews: number;
  foundingMinimumPopulation: bigint;
  foundingTerrainCompatibilityMinimum: Score1000;
  foundingSiteQualityFallback: Score1000;
  foundingSiteScoreWeights: { terrain: BasisPoints; quality: BasisPoints; distance: BasisPoints };
  industryInitialFallback: Score1000;

  tierProsperityInitial: Record<SocialTier, Score1000>;
  tierProsperityInertiaBps: BasisPoints;
  socialMobilityMaximumBps: BasisPoints;
  socialCapacityCoefficients: {
    highBase: Score1000;
    midBase: Score1000;
    prosperityToHigh: number;
    industryBreadthToMid: number;
    institutionalAccessToMid: number;
    inequalityToLow: number;
    economicStrainToLow: number;
  };
  mobilityScoreWeights: { prosperity: BasisPoints; opportunity: BasisPoints; access: BasisPoints; inverseUnrest: BasisPoints };

  industryInertiaBps: BasisPoints;
  sectorStrengthWeights: Record<string, { labor: BasisPoints; knowledge: BasisPoints; capital: BasisPoints; trade: BasisPoints; terrain: BasisPoints }>;

  stateFactionWeights: { population: BasisPoints; government: BasisPoints; rulingCoalition: BasisPoints; institutions: BasisPoints };
  stateFactionInertiaBps: BasisPoints;
  stateFactionSwitchMargin: Score1000;
  legitimacyInertiaBps: BasisPoints;
  legitimacyWeights: { governmentCompatibility: BasisPoints; rulingCoalition: BasisPoints; institutions: BasisPoints; inverseUnrest: BasisPoints; recentOutcome: BasisPoints };
  governmentTransitionWeights: { mismatch: BasisPoints; inverseLegitimacy: BasisPoints; unrest: BasisPoints; crisis: BasisPoints };
  governmentTransitionRequiredReviews: number;
  governmentTransitionCooldownYears: number;
  governmentTransitionThreshold: Score1000;
  governmentTransitionMaximumChanceBps: BasisPoints;

  familyFormationRequiredReviews: number;
  familyFormationThreshold: Score1000;
  familyScoreInertiaBps: BasisPoints;
  familyRelationRequiredReviews: number;
  familyRelationThreshold: Score1000;
  familyRelationMaximumChanceBps: BasisPoints;
  familyRelationInitialStrength: Score1000;

  organizationFormationRequiredReviews: number;
  corporationFormationThreshold: Score1000;
  crimeFormationThreshold: Score1000;
  organizationFormationMaximumChanceBps: BasisPoints;
  organizationFormationCooldownYears: number;
  maxActiveOrganizationsPerTypeSectorSettlement: number;
  organizationInitialWealth: Score1000;
  organizationInitialInfluence: Score1000;
  organizationScoreInertiaBps: BasisPoints;
  organizationSurvivalThreshold: Score1000;
  organizationDissolutionRequiredReviews: number;

  unrestInertiaBps: BasisPoints;
  protestThreshold: Score1000;
  crisisThreshold: Score1000;
  rebellionThreshold: Score1000;
  secessionFactionMismatchThreshold: Score1000;
  secessionMinimumPopulation: bigint;
  secessionPressureThreshold: Score1000;
  secessionRequiredReviews: number;
  secessionMaximumChanceBps: BasisPoints;
  secessionFormerStateGrievanceDelta: Score1000;

  borderTensionInertiaBps: BasisPoints;
  borderSkirmishThreshold: Score1000;
  borderWarThreshold: Score1000;
  borderPeaceThreshold: Score1000;
  borderSkirmishMaximumChanceBps: BasisPoints;
  borderWarMaximumChanceBps: BasisPoints;
  borderPeaceMaximumChanceBps: BasisPoints;
  borderSkirmishCooldownYears: number;
  conflictStatePopulationReference: bigint;
  warExhaustionIncrease: Score1000;
  peaceExhaustionRecovery: Score1000;

  politicalPersonFallbackActivationAge: readonly [number, number];
  politicalPersonFallbackRetirementAge: readonly [number, number];
  politicalPersonFallbackNaturalDeathAge: readonly [number, number];
  institutionContinuityMaturityYears: number;
}

const SECTOR_WEIGHTS = {
  LAND_AND_FOOD: { labor: 3000, knowledge: 500, capital: 1500, trade: 1000, terrain: 4000 },
  EXTRACTION: { labor: 2500, knowledge: 500, capital: 2500, trade: 1000, terrain: 3500 },
  MANUFACTURE: { labor: 2500, knowledge: 2000, capital: 3000, trade: 2000, terrain: 500 },
  TRADE_AND_TRANSPORT: { labor: 1500, knowledge: 1500, capital: 2500, trade: 4000, terrain: 500 },
  KNOWLEDGE_AND_SERVICES: { labor: 1000, knowledge: 4500, capital: 2500, trade: 1500, terrain: 500 },
} as const;

export const DEFAULT_MECHANICS_VARIABLES_V1: MechanicsVariablesV1 = {
  schemaVersion: "echoes-mechanics-variables-v1",
  initialPopulation: 2_000_000n,
  initialTierWeights: [1n, 1n, 1n],
  sovereignTieBreak: true,
  growthRatesPpm: { LOW: 1985, MEDIUM: 2185, HIGH: 2385 },
  growthNonAlignmentDeductionPpm: 200,
  structuralReviewIntervalYears: 5,
  migrationReviewIntervalYears: 5,
  migrationPushThreshold: 200,
  migrationPushWeights: { factionMismatch: 4000, economicDisadvantage: 3500, unrest: 2500 },
  migrationMaximumOutflowBps: 500,
  migrationMaximumHops: 3,
  migrationDestinationMinimumAttractiveness: 500,
  migrationAttractivenessWeights: { opportunity: 3500, faction: 3000, stability: 2000, terrain: 1500 },
  foundingRequiredReviews: 2,
  foundingMinimumPopulation: 1000n,
  foundingTerrainCompatibilityMinimum: 500,
  foundingSiteQualityFallback: 500,
  foundingSiteScoreWeights: { terrain: 5000, quality: 3000, distance: 2000 },
  industryInitialFallback: 500,
  tierProsperityInitial: { HIGH: 650, MID: 500, LOW: 350 },
  tierProsperityInertiaBps: 7500,
  socialMobilityMaximumBps: 300,
  socialCapacityCoefficients: { highBase: 333, midBase: 333, prosperityToHigh: 180, industryBreadthToMid: 180, institutionalAccessToMid: 140, inequalityToLow: 180, economicStrainToLow: 180 },
  mobilityScoreWeights: { prosperity: 4000, opportunity: 2500, access: 2000, inverseUnrest: 1500 },
  industryInertiaBps: 8000,
  sectorStrengthWeights: SECTOR_WEIGHTS,
  stateFactionWeights: { population: 5000, government: 2500, rulingCoalition: 1500, institutions: 1000 },
  stateFactionInertiaBps: 8000,
  stateFactionSwitchMargin: 50,
  legitimacyInertiaBps: 8000,
  legitimacyWeights: { governmentCompatibility: 3000, rulingCoalition: 2000, institutions: 2000, inverseUnrest: 2000, recentOutcome: 1000 },
  governmentTransitionWeights: { mismatch: 3500, inverseLegitimacy: 3000, unrest: 2500, crisis: 1000 },
  governmentTransitionRequiredReviews: 2,
  governmentTransitionCooldownYears: 20,
  governmentTransitionThreshold: 650,
  governmentTransitionMaximumChanceBps: 8000,
  familyFormationRequiredReviews: 2,
  familyFormationThreshold: 650,
  familyScoreInertiaBps: 8000,
  familyRelationRequiredReviews: 2,
  familyRelationThreshold: 600,
  familyRelationMaximumChanceBps: 7000,
  familyRelationInitialStrength: 400,
  organizationFormationRequiredReviews: 2,
  corporationFormationThreshold: 400,
  crimeFormationThreshold: 250,
  organizationFormationMaximumChanceBps: 7000,
  organizationFormationCooldownYears: 20,
  maxActiveOrganizationsPerTypeSectorSettlement: 2,
  organizationInitialWealth: 400,
  organizationInitialInfluence: 250,
  organizationScoreInertiaBps: 7500,
  organizationSurvivalThreshold: 250,
  organizationDissolutionRequiredReviews: 2,
  unrestInertiaBps: 8000,
  protestThreshold: 500,
  crisisThreshold: 650,
  rebellionThreshold: 800,
  secessionFactionMismatchThreshold: 500,
  secessionMinimumPopulation: 100_000n,
  secessionPressureThreshold: 700,
  secessionRequiredReviews: 2,
  secessionMaximumChanceBps: 7000,
  secessionFormerStateGrievanceDelta: 300,
  borderTensionInertiaBps: 8000,
  borderSkirmishThreshold: 600,
  borderWarThreshold: 750,
  borderPeaceThreshold: 600,
  borderSkirmishMaximumChanceBps: 6000,
  borderWarMaximumChanceBps: 5000,
  borderPeaceMaximumChanceBps: 7000,
  borderSkirmishCooldownYears: 10,
  conflictStatePopulationReference: 10_000_000n,
  warExhaustionIncrease: 80,
  peaceExhaustionRecovery: 40,
  politicalPersonFallbackActivationAge: [20, 40],
  politicalPersonFallbackRetirementAge: [55, 80],
  politicalPersonFallbackNaturalDeathAge: [50, 95],
  institutionContinuityMaturityYears: 50,
};

export interface OperationalConfigV1 {
  schemaVersion: "echoes-operational-config-v1";
  checkpointIntervalYears: number;
  compression: "NONE" | "GZIP_JSON_V1";
  auditDetailRetention: "FULL" | "SUMMARIZED";
  expandedTransferArchive: boolean;
  workerCount: number;
  cacheMode: "OFF" | "EXACT_DEPENDENCY_HASH";
  namingBatchSize: number;
  interactiveNamingEnabled: boolean;
  namingBatchFlushIntervalYears: number;
  namingBatchMaximum: number;
}

export const DEFAULT_OPERATIONAL_CONFIG_V1: OperationalConfigV1 = {
  schemaVersion: "echoes-operational-config-v1", checkpointIntervalYears: 5, compression: "GZIP_JSON_V1", auditDetailRetention: "FULL",
  expandedTransferArchive: true, workerCount: 1, cacheMode: "OFF", namingBatchSize: 50,
  interactiveNamingEnabled: false, namingBatchFlushIntervalYears: 25, namingBatchMaximum: 50,
};

export interface DiagnosticConfigV1 {
  schemaVersion: "echoes-diagnostic-config-v1";
  endingPopulationGoal: bigint;
  divergenceTargetsBps: { identical: BasisPoints; similar: BasisPoints; material: BasisPoints };
  migrationNotabilityThresholdBps: BasisPoints;
  foundingNotabilityThreshold: bigint;
  populationToleranceBps: BasisPoints;
  benchmarkMaximumMilliseconds: number;
}

export const DEFAULT_DIAGNOSTIC_CONFIG_V1: DiagnosticConfigV1 = {
  schemaVersion: "echoes-diagnostic-config-v1", endingPopulationGoal: 125_000_000n,
  divergenceTargetsBps: { identical: 6500, similar: 2500, material: 1000 }, migrationNotabilityThresholdBps: 100,
  foundingNotabilityThreshold: 10_000n, populationToleranceBps: 1500, benchmarkMaximumMilliseconds: 900_000,
};

export interface ClassPolicyV1 {
  schemaVersion: "echoes-class-policy-v1";
  tierWeights: Record<SocialTier, Record<SocialClass, number>>;
  contextModifiers: Record<string, Partial<Record<SocialClass, number>>>;
}

export const CANDIDATE_CLASS_POLICY_V1: ClassPolicyV1 = {
  schemaVersion: "echoes-class-policy-v1",
  tierWeights: {
    HIGH: { NOBILITY: 700, INTELLECTUAL: 200, WORKER: 80, WANDERER: 20 },
    MID: { NOBILITY: 100, INTELLECTUAL: 400, WORKER: 450, WANDERER: 50 },
    LOW: { NOBILITY: 0, INTELLECTUAL: 100, WORKER: 700, WANDERER: 200 },
  },
  contextModifiers: {},
};

export interface TerrainCompatibilityPolicyV1 {
  schemaVersion: "echoes-terrain-compatibility-v1";
  exactSpecificMatch: Score1000;
  broadMatchNoSpecificConflict: Score1000;
  broadMatchSpecificMismatch: Score1000;
  broadMismatch: Score1000;
  unknown: Score1000;
}

export const CANDIDATE_TERRAIN_POLICY_V1: TerrainCompatibilityPolicyV1 = {
  schemaVersion: "echoes-terrain-compatibility-v1", exactSpecificMatch: 1000, broadMatchNoSpecificConflict: 750,
  broadMatchSpecificMismatch: 500, broadMismatch: 200, unknown: 500,
};

export interface ConflictEpisodeProfileV1 {
  schemaVersion: "echoes-conflict-episode-profile-v1";
  maximumMortalityBps: BasisPoints;
  maximumDisplacementBps: BasisPoints;
  maximumProsperityDamage: Score1000;
  maximumIndustryDamage: Score1000;
  maximumUnrestDelta: Score1000;
  maximumLegitimacyDelta: Score1000;
  maximumGrievanceDelta: Score1000;
  maximumExhaustionDelta: Score1000;
}

export const CANDIDATE_CONFLICT_PROFILE_V1: ConflictEpisodeProfileV1 = {
  schemaVersion: "echoes-conflict-episode-profile-v1", maximumMortalityBps: 20, maximumDisplacementBps: 100,
  maximumProsperityDamage: 40, maximumIndustryDamage: 50, maximumUnrestDelta: 80, maximumLegitimacyDelta: 60,
  maximumGrievanceDelta: 100, maximumExhaustionDelta: 100,
};

export interface SkirmishProfileV1 {
  schemaVersion: "echoes-skirmish-profile-v1";
  tensionDelta: Score1000;
  grievanceDelta: Score1000;
  exhaustionDelta: Score1000;
  prosperityDamage: Score1000;
  mortalityBps: BasisPoints;
}

export const CANDIDATE_SKIRMISH_PROFILE_V1: SkirmishProfileV1 = {
  schemaVersion: "echoes-skirmish-profile-v1", tensionDelta: 40, grievanceDelta: 50, exhaustionDelta: 30, prosperityDamage: 10, mortalityBps: 1,
};

export interface PeaceExhaustionPolicyV1 {
  schemaVersion: "echoes-peace-exhaustion-policy-v1";
  warExhaustionIncrease: Score1000;
  peacefulExhaustionRecovery: Score1000;
  postWarCooldownYears: number;
}

export const CANDIDATE_PEACE_EXHAUSTION_POLICY_V1: PeaceExhaustionPolicyV1 = {
  schemaVersion: "echoes-peace-exhaustion-policy-v1", warExhaustionIncrease: 80, peacefulExhaustionRecovery: 40, postWarCooldownYears: 20,
};

export interface CausalOwnerInputsV1 {
  schemaVersion: "echoes-causal-owner-inputs-v1";
  classPolicy: ClassPolicyV1 | null;
  terrainCompatibilityPolicy: TerrainCompatibilityPolicyV1 | null;
  conflictEpisodeProfile: ConflictEpisodeProfileV1 | null;
  skirmishProfile: SkirmishProfileV1 | null;
  peaceExhaustionPolicy: PeaceExhaustionPolicyV1 | null;
  governmentMappings: Record<GovernmentFormId, unknown>;
  canonicalShockDefinitions: readonly ShockDefinitionV5[];
  canonicalPolicies: Record<string, unknown>;
  approvedPolicyHashes: {
    classPolicy: string | null;
    terrainCompatibilityPolicy: string | null;
    conflictEpisodeProfile: string | null;
    skirmishProfile: string | null;
    peaceExhaustionPolicy: string | null;
  };
  diagnosticCandidatePoliciesAccepted: boolean;
}

export function diagnosticCandidateOwnerInputsV1(governmentMappings: Record<GovernmentFormId, unknown> = {}): CausalOwnerInputsV1 {
  return {
    schemaVersion: "echoes-causal-owner-inputs-v1",
    classPolicy: CANDIDATE_CLASS_POLICY_V1,
    terrainCompatibilityPolicy: CANDIDATE_TERRAIN_POLICY_V1,
    conflictEpisodeProfile: CANDIDATE_CONFLICT_PROFILE_V1,
    skirmishProfile: CANDIDATE_SKIRMISH_PROFILE_V1,
    peaceExhaustionPolicy: CANDIDATE_PEACE_EXHAUSTION_POLICY_V1,
    governmentMappings,
    canonicalShockDefinitions: [],
    canonicalPolicies: {},
    approvedPolicyHashes: { classPolicy: null, terrainCompatibilityPolicy: null, conflictEpisodeProfile: null, skirmishProfile: null, peaceExhaustionPolicy: null },
    diagnosticCandidatePoliciesAccepted: true,
  };
}

export interface CanonicalPolicyReadiness {
  ready: boolean;
  missing: string[];
}

function approvedPolicy(inputs: CausalOwnerInputsV1, key: keyof CausalOwnerInputsV1["approvedPolicyHashes"], value: unknown): boolean {
  return value !== null && inputs.approvedPolicyHashes[key] === hash(value);
}

export function canonicalPolicyReadiness(inputs: CausalOwnerInputsV1, requiredGovernmentIds: readonly string[] = []): CanonicalPolicyReadiness {
  const missing: string[] = [];
  if (!approvedPolicy(inputs, "classPolicy", inputs.classPolicy)) missing.push("CLASS_POLICY_APPROVAL_HASH");
  if (!approvedPolicy(inputs, "terrainCompatibilityPolicy", inputs.terrainCompatibilityPolicy)) missing.push("TERRAIN_COMPATIBILITY_POLICY_APPROVAL_HASH");
  if (!approvedPolicy(inputs, "conflictEpisodeProfile", inputs.conflictEpisodeProfile)) missing.push("CONFLICT_EPISODE_PROFILE_APPROVAL_HASH");
  if (!approvedPolicy(inputs, "skirmishProfile", inputs.skirmishProfile)) missing.push("SKIRMISH_PROFILE_APPROVAL_HASH");
  if (!approvedPolicy(inputs, "peaceExhaustionPolicy", inputs.peaceExhaustionPolicy)) missing.push("PEACE_EXHAUSTION_POLICY_APPROVAL_HASH");
  const missingGovernments = requiredGovernmentIds.filter((governmentId) => !(governmentId in inputs.governmentMappings));
  if (Object.keys(inputs.governmentMappings).length === 0 || missingGovernments.length > 0) missing.push(`GOVERNMENT_MAPPINGS${missingGovernments.length ? `:${missingGovernments.join(",")}` : ""}`);
  return { ready: missing.length === 0, missing };
}

export function assertCanonicalV5Ready(inputs: CausalOwnerInputsV1, canonical?: CanonicalDataV5): void {
  const readiness = canonicalPolicyReadiness(inputs, canonical?.governments.map((government) => government.governmentFormId) ?? []);
  if (!readiness.ready) throw new Error(`Canonical V5 policy approval required: ${readiness.missing.join(", ")}`);
}

function hash(value: unknown): string { return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex"); }
export function mechanicsVariablesHash(value: MechanicsVariablesV1): string { return hash(value); }
export function operationalConfigHash(value: OperationalConfigV1): string { return hash(value); }
export function diagnosticConfigHash(value: DiagnosticConfigV1): string { return hash(value); }
export function causalOwnerInputsHash(value: CausalOwnerInputsV1): string { return hash(value); }

export interface V5CausalIdentityInput {
  canonicalBundleHash: string;
  mechanics: MechanicsVariablesV1;
  normalizedSeed: string;
  causalOwnerInputs: CausalOwnerInputsV1;
  keyedRandomVersion: string;
}

export function causalRunHash(input: V5CausalIdentityInput): string {
  return hash({
    durableStateSchemaVersion: V5_DURABLE_SCHEMA_VERSION,
    mechanicsVersion: V5_MECHANICS_VERSION,
    causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION,
    schedulerVersion: V5_SCHEDULER_VERSION,
    keyedRandomVersion: input.keyedRandomVersion,
    canonicalBundleHash: input.canonicalBundleHash,
    mechanicsVariables: input.mechanics,
    normalizedSeed: input.normalizedSeed,
    causalOwnerInputs: input.causalOwnerInputs,
  });
}

export interface BreedAuthorityV5 {
  breedId: string;
  populationKind: "HUMAN" | "BEAST" | "MYTHOS" | "PET";
  groupId: string;
  factionObject: Record<WorldKey, number>;
  dominantFaction: WorldKey[];
  terrainBroad: readonly string[];
  terrainSpecific: readonly string[];
  ownershipMode: string;
  allocationMode: string;
  temporalAuthority?: { activationAge: readonly [number, number]; retirementAge: readonly [number, number] | null; naturalDeathAge: readonly [number, number] };
}

export interface SiteAuthorityV5 {
  siteId: string;
  regionId: string;
  regionName: string;
  continent?: string | null;
  currentName?: string | null;
  nameStatus?: string;
  namingAuthorityRef?: string | null;
  latitude: number;
  longitude: number;
  terrainBroad: readonly string[];
  terrainSpecific: readonly string[];
  quality: Score1000 | null;
  sectorTerrainFit?: Partial<Record<string, Score1000>>;
  prohibitedFounding?: boolean;
}

export interface RegionAuthorityV5 { regionId: string; directedAdjacentRegionIds: readonly string[]; }
export interface EconomicFormAuthorityV5 { ownershipMode: string; allocationMode: string; economicForm: string; }
export interface PhysicalPoiAuthorityV5 {
  poiId: string;
  poiType: string;
  workingLabel: string;
  nameStatus: string;
  siteId: string;
  regionId: string;
  regionName: string;
  continent?: string | null;
  canonicalLabel?: string | null;
  namingAuthorityRef?: string | null;
  latitude: number;
  longitude: number;
  hostFeatureId: string | null;
}
export interface RouteCorridorAuthorityV1 {
  corridorId: string;
  regionAId: string;
  regionBId: string;
  canonicalDirectionality: "BIDIRECTIONAL" | "A_TO_B" | "B_TO_A";
  portalCapability: boolean;
  landCapability: boolean;
  seaCapability: boolean;
  airCapability: boolean;
  canonicalConnectionTags: readonly string[];
  primaryMode: import("./types.js").RoutePrimaryMode;
  infrastructureClass: import("./types.js").RouteInfrastructureClass;
  tradeDesignation: boolean;
  resolutionAuthority: "CANONICAL_FACT" | "DETERMINISTIC_INFERENCE" | "OWNER_APPROVAL_REQUIRED";
}
export interface GovernmentPrototypeV5 {
  governmentFormId: GovernmentFormId;
  doctrineVector: Record<WorldKey, number>;
  administrationMode: string;
  legitimacyBasis: string;
  authoritySource: string;
  franchiseBreadth: Score1000;
  requiredInstitutions: readonly { institutionType: string; offices: readonly Omit<import("./types.js").OfficeV5, "officeId" | "institutionId">[] }[];
}

export interface CanonicalDataV5 {
  schemaVersion: "echoes-canonical-data-v5";
  canonicalBundleHash: string;
  breeds: BreedAuthorityV5[];
  sites: SiteAuthorityV5[];
  regions: RegionAuthorityV5[];
  governments: GovernmentPrototypeV5[];
  economicForms: EconomicFormAuthorityV5[];
  physicalPois: PhysicalPoiAuthorityV5[];
  routeCorridors: RouteCorridorAuthorityV1[];
  sovereigns: Record<WorldKey, { sovereignFaction: WorldKey; breedId: string; seizureTargetSiteId: string }>;
  groupRegionAssignments: Record<WorldKey, Record<string, string>>;
  initialSettlements: readonly { worldKey: WorldKey; settlementId: string; siteId: string; stateId: string; governmentFormId: string; populationWeight?: bigint }[];
  canonicalLabels: Record<string, string>;
  canonicalLabelAuthority?: Record<string, string>;
  canonicalEvents: readonly {
    eventId: string;
    year: number;
    nominalYear?: number;
    jitter?: boolean;
    eventType: string;
    label?: string;
    payload: Record<string, unknown>;
  }[];
}
