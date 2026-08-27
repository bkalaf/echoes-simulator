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

export type OrganizationType = "CORPORATION" | "CRIME_ORGANIZATION";
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
  terminationReason: "TERM_EXPIRED" | "DEATH" | "RETIREMENT" | "REMOVAL" | "GOVERNMENT_CHANGE" | null;
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

export type TimedConditionType = "RECENT_MIGRATION" | "GOVERNMENT_CRISIS" | "FAMILY_PROMOTION_CANDIDATE" | "ORGANIZATION_FORMATION_CANDIDATE" | "ORGANIZATION_FORMATION_COOLDOWN" | "FAMILY_RELATION_CANDIDATE" | "FOUNDING_CANDIDATE" | "SECESSION_CANDIDATE" | "QUARANTINE" | "RESTRICTION" | "REPRESSION" | "SCANDAL" | "TRAUMA" | "OUTCOME";
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

export type V5Phase = "SCHEDULED_CANONICAL" | "TEMPORAL" | "ACTIVE_WAR" | "DEMOGRAPHY" | "INDUSTRY" | "PROSPERITY" | "SOCIAL_MOBILITY" | "VOLUNTARY_MIGRATION" | "ROUTE_INFRASTRUCTURE" | "FAMILY" | "ORGANIZATION" | "STATE_FACTION" | "UNREST" | "LEGITIMACY" | "GOVERNMENT" | "TRIGGERED" | "OFFICE_SELECTION" | "LATE_BORDER" | "AUDIT";

export type NamingBehavior = "BLOCKING" | "BATCHED" | "AUTOMATIC_REUSE" | "NO_NAME_REQUIRED";
export interface NamingRequestV5 {
  requestId: string;
  entityType: string;
  entityId: string;
  behavior: NamingBehavior;
  createdYear: number;
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
