import type { WorldKey } from "../contracts/domain.js";

export type { WorldKey };
export const V5_TIERS = ["HIGH", "MID", "LOW"] as const;
export type SocialTier = (typeof V5_TIERS)[number];
export type Score1000 = number;
export type CenteredScore1000 = number;
export type BasisPoints = number;
export type PartsPerMillion = number;
export type PopulationInt = bigint;
export type FactionVector = Record<WorldKey, Score1000>;
export type GovernmentFormId = string;
export type SectorId = "LAND_AND_FOOD" | "EXTRACTION" | "MANUFACTURE" | "TRADE_AND_TRANSPORT" | "KNOWLEDGE_AND_SERVICES";
export const V5_SECTORS: readonly SectorId[] = ["LAND_AND_FOOD", "EXTRACTION", "MANUFACTURE", "TRADE_AND_TRANSPORT", "KNOWLEDGE_AND_SERVICES"];

export const V5_RESOURCE_TYPES = [
  "WOOD", "STONE", "MARBLE", "IRON_ORE", "COPPER_ORE", "TIN_ORE", "COAL", "PRECIOUS_METAL", "GEMS", "CLAY", "SALT", "SAND",
  "FRESH_WATER", "FISHERY", "FARMLAND", "GRAZING_LAND", "HORSES", "PACK_ANIMALS", "FIBER", "SILK", "LEATHER", "INK_INPUT", "PAPER_INPUT", "MAGIC",
] as const;
export type ResourceTypeV5 = (typeof V5_RESOURCE_TYPES)[number];

export const V5_INDUSTRY_TYPES = [
  "AGRICULTURE", "ANIMAL_HUSBANDRY", "FISHING", "FORESTRY", "MINING", "QUARRYING", "METALWORKING", "CONSTRUCTION", "TEXTILES", "GARMENTS",
  "LEATHERWORK", "PAPERMAKING", "PRINTING", "INKMAKING", "FOOD_PROCESSING", "BREWING", "TAVERNS_INNS", "TRANSPORT", "SHIPPING", "TOURISM", "BANKING",
  "MONEY_LENDING", "PRECIOUS_GOODS", "MAGICAL_SERVICES", "ENTERTAINMENT", "PERFORMING_ARTS", "HEALTH_CARE", "EDUCATION", "LEGAL_SERVICES", "ADMINISTRATION",
  "SECURITY", "MERCENARY_SERVICES", "SEX_TRADE", "SLAVE_LABOR", "INDENTURED_LABOR", "GLADIATORIAL_ENTERTAINMENT", "FIGHTING_PITS", "ORGANIZED_CRIME",
  "PROTECTION_RACKETS", "SMUGGLING",
] as const;
export type IndustryTypeV5 = (typeof V5_INDUSTRY_TYPES)[number];

export const V5_CIVIC_INSTITUTION_TYPES = ["BUREAUCRACY", "FAITH", "EDUCATION", "HEALTH_CARE", "NEWSPAPER_PRESS", "PROPAGANDA", "LAW", "COURTS", "PRISON", "BANKING", "GUILD", "MILITARY_SECURITY"] as const;
export type CivicInstitutionTypeV5 = (typeof V5_CIVIC_INSTITUTION_TYPES)[number];

export const V5_SECURITY_FORCE_TYPES = ["CITY_WATCH", "STATE_GUARD", "FAMILY_GUARD", "CORPORATE_SECURITY", "RELIGIOUS_GUARD", "MERCENARIES", "CRIMINAL_ENFORCERS"] as const;
export type SecurityForceTypeV5 = (typeof V5_SECURITY_FORCE_TYPES)[number];

export const V5_DEROGATORY_GROUP_IDS = [
  "homosexual", "bisexual", "transgender", "black-skinned", "white-skinned", "birds", "reptiles", "amphibians", "fish", "demons", "angels", "woodland mythos",
  "unborn", "soulless", "beasts", "mythos", "humans", "cave dwellers", "tree dwellers", "cold blooded", "carnivores", "herbivores", "multi-litters", "egg layers",
  "undead", "elves", "dwarves", "insects",
] as const;
export type DerogatoryGroupIdV5 = (typeof V5_DEROGATORY_GROUP_IDS)[number];

export const V5_DEROGATORY_TARGETING_SCOPES = [
  "SOVEREIGN_SCAPEGOAT", "SOVEREIGN_FOCUS_OF_IRE", "SOVEREIGN_ANTI_INSURGENCY", "SOVEREIGN_CRUELTY_FOCUS",
  "FIRST_PILLAR_SCAPEGOAT", "FIRST_PILLAR_FOCUS_OF_IRE", "FIRST_PILLAR_TROUBLEMAKER", "FIRST_PILLAR_ANTI_SOVEREIGN_FOCUS", "FIRST_PILLAR_CRUELTY_FOCUS",
  "SECOND_PILLAR_SCAPEGOAT", "SECOND_PILLAR_FOCUS_OF_IRE", "SECOND_PILLAR_TROUBLEMAKER", "SECOND_PILLAR_ANTI_SOVEREIGN_FOCUS", "SECOND_PILLAR_CRUELTY_FOCUS",
  "SOVEREIGN_OPPOSITION_SCAPEGOAT", "SOVEREIGN_OPPOSITION_FOCUS_OF_IRE", "SOVEREIGN_OPPOSITION_TROUBLEMAKER", "SOVEREIGN_OPPOSITION_CRUELTY_FOCUS",
  "SOVEREIGN_OPPOSITION_INTERNAL_CONFLICT_SCAPEGOAT", "SOVEREIGN_OPPOSITION_INTERNAL_CONFLICT_TROUBLEMAKER", "SOVEREIGN_OPPOSITION_INTERNAL_CRUELTY_FOCUS",
] as const;
export type DerogatoryTargetingScopeV5 = (typeof V5_DEROGATORY_TARGETING_SCOPES)[number];

export interface TierState {
  population: PopulationInt;
  prosperity: Score1000;
}

export interface CohortCell {
  settlementId: string;
  breedId: string;
  tiers: Record<SocialTier, TierState>;
}

export interface SettlementV5 {
  settlementId: string;
  siteId: string;
  regionId: string;
  stateId: string;
  foundedYear: number;
  unrest: Score1000;
  sectorStrengths: Record<SectorId, Score1000>;
}

export type RoutePrimaryMode = "LAND" | "SEA" | "AIR" | "NONE" | "UNRESOLVED";
export type RouteInfrastructureClass = "ROAD" | "HIGHWAY" | "SEA_ROUTE" | "AIRSHIP_ROUTE" | "UNRESOLVED";
export interface WorldRouteV5 {
  routeId: string;
  corridorId: string;
  primaryMode: RoutePrimaryMode;
  infrastructureClass: RouteInfrastructureClass;
  tradeDesignation: boolean;
  establishedYear: number;
}

export interface StateV5 {
  stateId: string;
  actualGovernment: GovernmentFormId;
  factionAffinity: FactionVector;
  dominantFaction: WorldKey;
  legitimacy: Score1000;
  qualifyingGovernmentReviewCount: number;
  lastGovernmentTransitionYear: number;
  routineTransitionCooldownUntilYear: number;
}

export type FamilyStatus = "ACTIVE" | "EXTINCT";
export interface FamilyV5 {
  familyId: string;
  homeSettlementId: string;
  founderBreedId: string;
  factionAffinity: FactionVector;
  wealth: Score1000;
  influence: Score1000;
  prestige: Score1000;
  status: FamilyStatus;
  foundingYear: number;
  extinctionYear: number | null;
}

export interface PoliticalPersonV5 {
  personId: string;
  familyId: string | null;
  breedId: string;
  originSettlementId: string;
  sourceTier: SocialTier;
  sourceClass: SocialClass | null;
  birthYear: number;
  activeFromYear: number;
  plannedRetirementYear: number | null;
  actualRetirementYear: number | null;
  naturalDeathYear: number;
  actualDeathYear: number | null;
  disqualifiedFromYear: number | null;
  requalifiedYear: number | null;
}

export type PersonRelationType = "PARENT_CHILD" | "SIBLING" | "COUSIN" | "SPOUSE" | "HEIR" | "PROTEGE";
export interface PersonRelationV5 {
  relationId: string;
  personAId: string;
  personBId: string;
  relationType: PersonRelationType;
  startYear: number;
  endYear: number | null;
  sourceEventId: string;
}

export type OrganizationType = "CORPORATION" | "CRIME_ORGANIZATION" | "GUILD";
export type OrganizationStatus = "ACTIVE" | "DECLINING" | "DISSOLVED";
export interface OrganizationV5 {
  organizationId: string;
  type: OrganizationType;
  sectorId: SectorId;
  homeSettlementId: string;
  founderControllerType: ControllerType;
  founderControllerId: string;
  wealth: Score1000;
  influence: Score1000;
  status: OrganizationStatus;
  belowSurvivalReviewCount: number;
  formationYear: number;
  dissolutionYear: number | null;
}

export interface InstitutionV5 {
  institutionId: string;
  stateId: string;
  institutionType: string;
  jurisdictionSettlementId?: string | null;
  capacity?: Score1000;
  foundedYear: number;
  dissolvedYear: number | null;
}

export interface SelectionRuleV5 {
  selectionMethod: "HEREDITARY" | "RULER_APPOINTMENT" | "COUNCIL_APPOINTMENT" | "ESTATE_SELECTION" | "ELITE_FRANCHISE" | "POPULAR_ELECTION" | "MILITARY_SELECTION" | "RELIGIOUS_SELECTION";
  scope: "SETTLEMENT" | "STATE";
  requiresTrackedLineage: boolean;
  eligibleTiers: readonly SocialTier[];
  eligibleClasses?: readonly SocialClass[];
  minimumFactionCompatibility: Score1000;
  stochasticTies: boolean;
  scoreWeights: {
    factionFit: BasisPoints;
    classFit: BasisPoints;
    localSupport: BasisPoints;
    lineageFit: BasisPoints;
    ruleSpecificFit: BasisPoints;
  };
}

export interface OfficeV5 {
  officeId: string;
  institutionId: string;
  jurisdictionSettlementId: string | null;
  titleKey: string;
  power: Score1000;
  mandatory: boolean;
  apex: boolean;
  termYears: number | null;
  selectionRule: SelectionRuleV5;
}

export interface OfficeTermV5 {
  officeTermId: string;
  officeId: string;
  personId: string;
  startYear: number;
  endYear: number | null;
  selectionEventId: string;
  selectorType: "PERSON" | "FAMILY" | "INSTITUTION" | "STATE" | "ELECTORATE" | "MILITARY" | "RELIGIOUS_BODY" | "SUCCESSION";
  selectorId: string | null;
  terminationReason: "TERM_EXPIRED" | "DEATH" | "RETIREMENT" | "REMOVAL" | "GOVERNMENT_CHANGE" | "INSTITUTION_REFORM" | null;
}

export type ControllerType = "FAMILY" | "PERSON" | "INSTITUTION" | "STATE" | "ORGANIZATION" | "DIFFUSE";
export interface OwnershipStakeV5 {
  stakeId: string;
  organizationId: string;
  controllerType: ControllerType;
  controllerId: string;
  ownershipShareBps: BasisPoints;
  controlShareBps: BasisPoints;
  startYear: number;
  endYear: number | null;
  sourceEventId: string;
}

export type FamilyRelationType = "ALLIANCE" | "RIVALRY";
export interface FamilyRelationV5 {
  familyRelationId: string;
  familyAId: string;
  familyBId: string;
  relationType: FamilyRelationType;
  strength: Score1000;
  qualifyingReviewCount: number;
  startYear: number;
  endYear: number | null;
  sourceEventId: string;
}

export interface BorderRelationV5 {
  borderRelationId: string;
  stateAId: string;
  stateBId: string;
  activeBorder: boolean;
  tension: Score1000;
  exhaustion: Score1000;
  grievance: Score1000;
  territorialClaim: Score1000;
  status: "PEACE" | "SKIRMISH_COOLDOWN" | "WAR";
  warDeclaredYear: number | null;
  warEndedYear: number | null;
  cooldownUntilYear: number | null;
}

export type TimedConditionType = "RECENT_MIGRATION" | "GOVERNMENT_CRISIS" | "FAMILY_PROMOTION_CANDIDATE" | "ORGANIZATION_FORMATION_CANDIDATE" | "ORGANIZATION_FORMATION_COOLDOWN" | "GUILD_FORMATION_CANDIDATE" | "FAMILY_RELATION_CANDIDATE" | "FOUNDING_CANDIDATE" | "SECESSION_CANDIDATE" | "QUARANTINE" | "RESTRICTION" | "REPRESSION" | "SCANDAL" | "TRAUMA" | "OUTCOME";
export interface TimedConditionV5 {
  conditionId: string;
  type: TimedConditionType;
  targetType: "SETTLEMENT" | "STATE" | "FAMILY" | "ORGANIZATION" | "BORDER" | "COHORT_CELL";
  targetId: string;
  magnitude: Score1000;
  startYear: number;
  endYear: number | null;
  sourceEventId: string;
  key: string;
  qualifyingReviewCount: number;
}

export interface ActiveConflictV5 {
  conflictId: string;
  borderRelationId: string;
  attackerStateId: string;
  defenderStateId: string;
  declaredYear: number;
  activeFromYear: number;
  endedYear: number | null;
}

export type ResourceAvailabilityV5 = "AVAILABLE" | "DISRUPTED" | "OCCUPIED" | "DENIED" | "DEPLETED" | "DESTROYED";
export interface ResourceNodeV5 {
  resourceNodeId: string;
  resourceType: ResourceTypeV5;
  siteId: string;
  regionId: string;
  quality: Score1000;
  capacityClass: "MINOR" | "MODERATE" | "MAJOR";
  renewable: boolean;
  accessDifficulty: Score1000;
  placementAuthorityRef: string;
}

export interface WorldResourceStateV5 {
  worldResourceStateId: string;
  resourceNodeId: string;
  controllerType: ControllerType;
  controllerId: string;
  discoveryYear: number;
  availability: ResourceAvailabilityV5;
  seizedByEventId: string | null;
}

export interface IndustryStateV5 {
  industryStateId: string;
  settlementId: string;
  industryType: IndustryTypeV5;
  strength: Score1000;
  employment: Score1000;
  dependency: Score1000;
  coercion: Score1000;
  disruptedUntilYear: number | null;
  supportingResourceNodeIds: string[];
  supportingInstitutionIds: string[];
  sourcePolicyRef: string;
}

export interface SecurityForceV5 {
  securityForceId: string;
  forceType: SecurityForceTypeV5;
  controllerType: ControllerType;
  controllerId: string;
  jurisdictionType: "SETTLEMENT" | "STATE" | "ORGANIZATION" | "ROUTE";
  jurisdictionId: string;
  organizationId: string;
  personnel: bigint;
  seniorOfficerPersonIds: string[];
  loyalty: FactionVector;
  training: Score1000;
  equipment: Score1000;
  morale: Score1000;
  cohesion: Score1000;
  commandQuality: Score1000;
  suppressionCapacity: Score1000;
  combatCapacity: Score1000;
  status: "ACTIVE" | "DEGRADED" | "DEFECTED" | "FRAGMENTED" | "DISSOLVED";
  foundedYear: number;
  recoveryUntilYear: number | null;
}

export type DiplomaticActionV5 = "NEGOTIATION" | "TREATY" | "NON_AGGRESSION" | "ALLIANCE" | "TRADE_AGREEMENT" | "EMBARGO" | "SANCTIONS" | "ULTIMATUM" | "RESOURCE_AGREEMENT" | "BORDER_SETTLEMENT" | "CEASEFIRE" | "PEACE";
export interface DiplomaticRelationV5 {
  diplomaticRelationId: string;
  stateAId: string;
  stateBId: string;
  trust: Score1000;
  hostility: Score1000;
  tradeDependence: Score1000;
  territorialDispute: Score1000;
  resourceCompetition: Score1000;
  ideologicalConflict: Score1000;
  recentViolence: Score1000;
  diplomaticEngagement: Score1000;
  warExhaustion: Score1000;
  lastReviewedYear: number;
}

export interface DiplomaticAgreementV5 {
  agreementId: string;
  action: DiplomaticActionV5;
  stateAId: string;
  stateBId: string;
  startYear: number;
  endYear: number | null;
  sourceEventId: string;
  terms: Record<string, string | number | boolean | null>;
}

export type ConflictStageV5 = "TENSION" | "DISPUTE" | "BORDER_INCIDENT" | "SKIRMISH" | "SUSTAINED_SKIRMISH" | "WAR" | "SIEGE" | "OCCUPATION" | "CEASEFIRE" | "PEACE";
export interface ConflictEpisodeV5 {
  conflictEpisodeId: string;
  relationId: string;
  participantStateIds: string[];
  stage: ConflictStageV5;
  startYear: number;
  endYear: number | null;
  causeCodes: string[];
  causeEventIds: string[];
  affectedSettlementIds: string[];
  affectedResourceNodeIds: string[];
  casualties: bigint;
  displaced: bigint;
  outcome: string | null;
}

export interface SettlementControlTermV5 {
  settlementControlTermId: string;
  settlementId: string;
  controllerStateId: string;
  legalStateId: string;
  controlType: "LEGAL" | "OCCUPATION" | "CONQUEST";
  startYear: number;
  endYear: number | null;
  sourceEventId: string;
}

export type PopulationLocationTypeV5 = "PUBLIC_SETTLEMENT" | "ENCLAVE";
export interface TargetedPopulationSliceV5 {
  populationSliceId: string;
  locationType: PopulationLocationTypeV5;
  locationId: string;
  breedId: string;
  tier: SocialTier;
  population: bigint;
  membershipSignature: DerogatoryGroupIdV5[];
  factionOpinion: FactionVector;
  growthModifierPpm: number;
  growthModifierUntilYear: number | null;
  confiscationScore: Score1000;
  restrictionKeys: string[];
  provenanceRefs: string[];
}

export interface DerogatoryGroupV5 {
  groupId: DerogatoryGroupIdV5;
  predicateStatus: "READY" | "NOT_READY";
  predicateAuthorityRef: string | null;
  predicateDescription: string;
}

export interface DerogatoryTargetSelectionV5 {
  selectionId: string;
  worldKey: WorldKey;
  scope: DerogatoryTargetingScopeV5;
  reviewYear: number;
  action: "SELECT" | "KEEP" | "REPLACE";
  priorGroupId: DerogatoryGroupIdV5 | null;
  selectedGroupId: DerogatoryGroupIdV5;
  effectiveFromYear: number;
  effectiveUntilYear: number | null;
  decisionBatchId: string;
  responseSha256: string;
  provenanceRef: string;
}

export const V5_ATROCITY_OCCURRENCE_IDS = [
  "ATROCITY_WITNESS_17", "ATROCITY_WITNESS_16_A", "ATROCITY_WITNESS_16_B", "ATROCITY_WITNESS_15", "ATROCITY_WITNESS_14", "ATROCITY_WITNESS_13",
  "ATROCITY_WITNESS_12", "ATROCITY_WITNESS_11", "ATROCITY_WITNESS_10", "ATROCITY_WITNESS_09", "ATROCITY_WITNESS_08", "ATROCITY_WITNESS_07",
  "ATROCITY_WITNESS_06", "ATROCITY_WITNESS_05", "ATROCITY_WITNESS_04", "ATROCITY_WITNESS_03", "ATROCITY_WITNESS_02", "ATROCITY_WITNESS_01",
] as const;
export type AtrocityOccurrenceIdV5 = (typeof V5_ATROCITY_OCCURRENCE_IDS)[number];
export interface AtrocityOccurrenceSlotV5 {
  occurrenceId: AtrocityOccurrenceIdV5;
  witness: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17;
  witnessOccurrence: "ONLY" | "A" | "B";
  status: "NOT_CONFIGURED" | "CONFIGURED";
  triggerYear: number | null;
  targetScope: DerogatoryTargetingScopeV5 | null;
  shockDefinitionId: string | null;
  authorityRef: string;
}

export type LocalAtrocityResponseTypeV5 = "SUPPORT_REPRESSION" | "CURFEW" | "SEGREGATION_GHETTOIZATION" | "PROPERTY_SEIZURE" | "IMPRISONMENT" | "EXPULSION" | "NEUTRAL_COMPLIANCE" | "PROTEST" | "REFUSAL" | "SANCTUARY" | "NEW_IDENTITY_PAPERS" | "PROPERTY_PROTECTION" | "RESETTLEMENT" | "SECURITY_PROTECTION" | "SECESSION_PRESSURE";
export interface LocalAtrocityResponseV5 {
  responseId: string;
  occurrenceId: AtrocityOccurrenceIdV5;
  settlementId: string;
  stateId: string;
  targetGroupId: DerogatoryGroupIdV5;
  responseType: LocalAtrocityResponseTypeV5;
  intensity: Score1000;
  sourceEventId: string;
}

export interface ForcedDisplacementRecordV5 {
  displacementId: string;
  sourceEventId: string;
  sourceLocationType: PopulationLocationTypeV5;
  sourceLocationId: string;
  destinationLocationType: PopulationLocationTypeV5;
  destinationLocationId: string;
  populationSliceId: string;
  population: bigint;
  year: number;
  cause: "CONFLICT" | "ATROCITY" | "EXILE" | "PERSECUTION" | "RESOURCE_DENIAL";
}

export type EnclaveFoundingCauseV5 = "ATROCITY_REFUGE" | "EXILE_REFUGE" | "PERSECUTION_REFUGE" | "FORCED_DISPLACEMENT_REFUGE";
export type EnclaveFormV5 = "CAVERN" | "UNDERWATER" | "FLOATING_UNDERSIDE" | "HIDDEN_SUBSTRUCTURE" | "OTHER_OWNER_AUTHORIZED";
export type EnclaveSecrecyStateV5 = "HIDDEN" | "RUMORED" | "EXPOSED" | "INTEGRATED";
export type EnclaveStatusV5 = "ACTIVE" | "EVACUATED" | "DESTROYED" | "DISSOLVED";
export interface EnclaveV5 {
  enclaveId: string;
  hostSettlementId: string;
  targetGroupId: DerogatoryGroupIdV5;
  foundedYear: number;
  foundedByEventId: string;
  foundingCause: EnclaveFoundingCauseV5;
  enclaveForm: EnclaveFormV5;
  secrecyState: EnclaveSecrecyStateV5;
  status: EnclaveStatusV5;
  supportBurden: Score1000;
}

export interface WorldStateV5 {
  schemaVersion: "echoes-world-state-v5";
  worldKey: WorldKey;
  year: number;
  cohorts: CohortCell[];
  settlements: SettlementV5[];
  states: StateV5[];
  families: FamilyV5[];
  politicalPeople: PoliticalPersonV5[];
  personRelations: PersonRelationV5[];
  organizations: OrganizationV5[];
  institutions: InstitutionV5[];
  offices: OfficeV5[];
  officeTerms: OfficeTermV5[];
  ownershipStakes: OwnershipStakeV5[];
  familyRelations: FamilyRelationV5[];
  borderRelations: BorderRelationV5[];
  timedConditions: TimedConditionV5[];
  activeConflicts: ActiveConflictV5[];
  worldRoutes: WorldRouteV5[];
  resourceNodes?: ResourceNodeV5[];
  worldResourceStates?: WorldResourceStateV5[];
  industries?: IndustryStateV5[];
  securityForces?: SecurityForceV5[];
  diplomaticRelations?: DiplomaticRelationV5[];
  diplomaticAgreements?: DiplomaticAgreementV5[];
  conflictEpisodes?: ConflictEpisodeV5[];
  settlementControlTerms?: SettlementControlTermV5[];
  populationSlices?: TargetedPopulationSliceV5[];
  derogatoryTargetSelections?: DerogatoryTargetSelectionV5[];
  localAtrocityResponses?: LocalAtrocityResponseV5[];
  forcedDisplacements?: ForcedDisplacementRecordV5[];
  enclaves?: EnclaveV5[];
}

export type SocialClass = "NOBILITY" | "INTELLECTUAL" | "WORKER" | "WANDERER";
export type ClassDistribution = Record<SocialClass, PopulationInt>;

export interface DerivedMetricsV1 {
  schemaVersion: "echoes-derived-metrics-v1";
  year: number;
  settlementPopulationFactionVectors: Record<string, FactionVector>;
  settlementDominantFactions: Record<string, WorldKey>;
  statePopulationFactionVectors: Record<string, FactionVector>;
  stateAdjacency: readonly [string, string][];
  stateUnrest: Record<string, Score1000>;
  settlementProsperity: Record<string, Score1000>;
  settlementHighProsperity: Record<string, Score1000>;
  institutionalAccess: Record<string, Score1000>;
  localOpportunity: Record<string, Score1000>;
  tradeAccess: Record<string, Score1000>;
  disruptionPressure: Record<string, Score1000>;
  supportedEconomicForms: Record<string, { economicForm: string; denominator: string; ownershipTotals: Record<string, string>; allocationTotals: Record<string, string> }>;
}

export interface ReadModelV1 {
  schemaVersion: "echoes-read-model-v1";
  worldKey: WorldKey;
  year: number;
  totalPopulation: string;
  settlements: { settlementId: string; label: string; stateId: string; population: string; dominantFaction: WorldKey; prosperity: Score1000; unrest: Score1000; supportedEconomicForm: string }[];
  states: { stateId: string; label: string; population: string; actualGovernment: string; supportedGovernment: string | null; dominantFaction: WorldKey; legitimacy: Score1000 }[];
}

export interface CausalMutationV5 {
  mutationType: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
}

export interface CausalEventV5 {
  schemaVersion: "echoes-causal-event-v5";
  eventId: string;
  worldKey: WorldKey;
  year: number;
  phase: V5Phase;
  sequence: number;
  eventType: string;
  entityType: string;
  entityId: string;
  causeEventIds: string[];
  mechanicsVersion: string;
  causalDerivationVersion: string;
  keyedDecisionIdentity: string | null;
  mutations: CausalMutationV5[];
  payload: Record<string, unknown>;
}

export type V5Phase = "SCHEDULED_CANONICAL" | "TEMPORAL" | "RESOURCE_GEOGRAPHY" | "INSTITUTION_CAPACITY" | "SECURITY" | "DIPLOMACY" | "ACTIVE_WAR" | "TARGETING_RESPONSE" | "DEMOGRAPHY" | "INDUSTRY" | "PROSPERITY" | "SOCIAL_MOBILITY" | "VOLUNTARY_MIGRATION" | "ROUTE_INFRASTRUCTURE" | "FAMILY" | "ORGANIZATION" | "STATE_FACTION" | "UNREST" | "LEGITIMACY" | "GOVERNMENT" | "TRIGGERED" | "OFFICE_SELECTION" | "LATE_BORDER" | "AUDIT";

export type NamingBehavior = "BLOCKING" | "BATCHED" | "AUTOMATIC_REUSE" | "NO_NAME_REQUIRED";
export type AcceptedLabelSourceV5 = "CANONICAL_EXISTING" | "OWNER_INPUT" | "LLM_NAMING_RESPONSE" | "AUTOMATIC_REUSE" | "TEST_FIXTURE";
export type TrustedAcceptedLabelSourceV5 = Exclude<AcceptedLabelSourceV5, "TEST_FIXTURE">;
export type NamingComparisonAuditStatusV5 = "COMPARISON_AWARE" | "UNCOORDINATED" | "LEGACY_UNTRUSTED";

export interface AcceptedLabelLedgerEntryV5 {
  ledgerEntryId: string;
  runId: string;
  worldKey: WorldKey | null;
  entityType: string;
  entityId: string;
  label: string;
  source: AcceptedLabelSourceV5;
  sourceRequestId: string | null;
  sourceAuthorityRef: string | null;
  sourceBatchId: string | null;
  sourceResponseAttemptId: string | null;
  nameEffectiveFromYear: number;
  acceptanceYear: number;
  reusedFromEntityId: string | null;
  reusedFromLedgerEntryId: string | null;
  namingComparisonGroupId: string | null;
  comparisonAuthorityRef: string | null;
}

export interface NamingRequestV5 {
  requestId: string;
  entityType: string;
  entityId: string;
  behavior: NamingBehavior;
  createdYear: number;
  nameEffectiveFromYear?: number;
  worldKey?: WorldKey | null;
  namingComparisonGroupId?: string | null;
  comparisonAuthorityRef?: string | null;
  comparisonGroupingVersion?: "echoes-naming-comparison-groups-v1";
  acceptedLabel: string | null;
  context?: Record<string, unknown>;
}

export interface V5RunResult {
  state: WorldStateV5;
  events: CausalEventV5[];
  namingRequests: NamingRequestV5[];
  stateHash: string;
  causalEventHash: string;
}
