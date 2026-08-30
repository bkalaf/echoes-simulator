import { createHash } from "node:crypto";
import { canonicalJson } from "../serialization/canonical-json.js";
import {
  CANDIDATE_CLASS_POLICY_V1,
  CANDIDATE_CONFLICT_PROFILE_V1,
  CANDIDATE_PEACE_EXHAUSTION_POLICY_V1,
  CANDIDATE_SKIRMISH_PROFILE_V1,
  CANDIDATE_TERRAIN_POLICY_V1,
} from "./config.js";
import { NON_REFUGE_FOOD_SPECIFIC_V1, type NonRefugeFoodSpecificV1 } from "./sustenance.js";

export type OwnerPolicyStatusV1 = "UNREVIEWED" | "APPROVED" | "REJECTED" | "SUPERSEDED";
export type OwnerPolicyReviewAuthorityV1 = "SEMANTIC" | "NUMERIC";
export type OwnerPolicyLifecycleV1 =
  | { kind: "GENESIS" }
  | { kind: "SCHEDULED_BARRIER"; defaultYear: number }
  | { kind: "ATOMIC_YEAR_BARRIER" };

export interface LockedOwnerAuthorityV1 {
  authorityId: string;
  domain: string;
  statement: string;
  causalConsumers: readonly string[];
}

export interface OwnerPolicyDefinitionV1 {
  policyId: string;
  humanName: string;
  domain: string;
  purpose: string;
  units: string;
  allowedRange: string;
  causalConsumers: readonly string[];
  reviewAuthority: OwnerPolicyReviewAuthorityV1;
  lifecycle: OwnerPolicyLifecycleV1;
  lockedAuthorityIds: readonly string[];
  candidateVersion: string;
  candidateContent: unknown;
  candidateRationale: string;
}

export interface OwnerPolicyRevisionV1 extends OwnerPolicyDefinitionV1 {
  revisionId: string;
  contentSha256: string;
  status: OwnerPolicyStatusV1;
  approvedBy: string | null;
  approvedAt: string | null;
  effectiveFromYear: number | null;
  supersededByRevisionId: string | null;
}

export const LOCKED_OWNER_AUTHORITIES_V56: readonly LockedOwnerAuthorityV1[] = [
  { authorityId: "FEDERAL_VISION_DIRECTIONALITY", domain: "Federal Vision", statement: "Concord → Crown / Church; Ruin → Intellectual Elite / Hereditary Elite; Schism → Corporate Actors / Wealth Elite.", causalConsumers: ["Federal Vision decisions"] },
  { authorityId: "REFUGE_CLASSIFICATION_STRUCTURE", domain: "Sustenance", statement: "Exactly 47 terminal FoodSpecific values are base Refuge-eligible, exactly 14 are non-Refuge classifications, and every eligible value used by more than 100 canonical Breeds receives a second Refuge.", causalConsumers: ["Refuge genesis"] },
  { authorityId: "NON_REFUGE_SUSTENANCE_STRUCTURE", domain: "Sustenance", statement: "The 14 non-Refuge classifications receive no physical Refuge. BLOOD is sourced from the living. NO_FEEDING requires no sustenance. FEAR supports a peaceful/calm penalty and war/unrest availability behavior; detailed meanings and formulas remain unresolved.", causalConsumers: ["Dynamic sustenance"] },
  { authorityId: "INFLUENCE_BOUNDARY_STRUCTURE", domain: "Influence / Territory", statement: "Influence uses normalized geodesic distance. Radii 25:15 divide a contested span 5/8:3/8 with deterministic ties.", causalConsumers: ["Territory", "control"] },
  { authorityId: "INFLUENCE_CONTRIBUTOR_STRUCTURE", domain: "Influence / Territory", statement: "Structural contributors are population/Settlement size, economy, tourism, political power, university prominence, cultural institutions, corporation prominence, Family/dynasty prominence, regional-capital status, political victories, military victories, defeats, catastrophe damage, and atrocity damage. Route centrality is not locked.", causalConsumers: ["Settlement influence"] },
  { authorityId: "ATROCITY_IDENTITY_AND_ACCOUNTING", domain: "Atrocity Impact", statement: "All definitions reference one common harm-share revision; unique harmed is counted once; Book/Witness identifiers remain distinct from Atrocity identifiers.", causalConsumers: ["All 54 atrocity definitions"] },
  { authorityId: "ATROCITY_PRIMARY_HARM_ACCOUNTING", domain: "Atrocity Impact", statement: "Each primary harm profile allocates exactly 100% of uniqueHarmed among mutually exclusive primary outcomes. Secondary consequences may overlap but never increase uniqueHarmed.", causalConsumers: ["Atrocity execution"] },
  { authorityId: "ATROCITY_SPILLOVER_ACCOUNTING", domain: "Atrocity Impact", statement: "DIRECT_HARM_SPILLOVER redistributes the same unique-harmed budget across Settlements/cohorts. SECONDARY_CONSEQUENCE_SPILLOVER changes non-victim consequences and never adds unique harmed. Direct victims cannot be double-counted.", causalConsumers: ["Atrocity execution", "neighbor effects"] },
  { authorityId: "ATROCITY_17_A_INHERITED_SCHEDULE", domain: "Event Triggers", statement: "ATROCITY_17_A inherits the approved year-50 ATROCITY_17 schedule authority.", causalConsumers: ["Atrocity scheduler"] },
  { authorityId: "ATROCITY_HISTORY_APPEND_ONLY", domain: "Atrocity Impact", statement: "Historical events and scar records are append-only. Their current mechanical effects may decay, strengthen, reactivate, or interact with later history under approved policy.", causalConsumers: ["Historical scars"] },
  { authorityId: "RELIGIOUS_SITE_CARDINALITY", domain: "Religion", statement: "At most one Shrine and one Temple may exist per Deity/world.", causalConsumers: ["Religious-site placement"] },
  { authorityId: "PANTHEON_CENTER_SELECTION_STRUCTURE", domain: "Religion", statement: "Pantheon-center selection considers eligible site-hosting Settlements, maximizes site count by State, chooses the smallest eligible Settlement, resolves State-count ties across tied States by smallest eligible Settlement, then uses stable Settlement ID.", causalConsumers: ["Pantheon-center designation"] },
] as const;

function hash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function lockedOwnerAuthorityByIdV56(authorityId: string): LockedOwnerAuthorityV1 {
  const authority = LOCKED_OWNER_AUTHORITIES_V56.find((candidate) => candidate.authorityId === authorityId);
  if (!authority) throw new Error(`Unknown locked owner authority ${authorityId}`);
  return authority;
}

export function materializeOwnerPolicyCandidateV1(definition: OwnerPolicyDefinitionV1): OwnerPolicyRevisionV1 {
  const contentSha256 = hash(definition.candidateContent);
  return { ...structuredClone(definition), revisionId: `${definition.policyId}_${definition.candidateVersion}_${contentSha256.slice(0, 16)}`, contentSha256, status: "UNREVIEWED", approvedBy: null, approvedAt: null, effectiveFromYear: null, supersededByRevisionId: null };
}

export function approveOwnerPolicyRevisionV1(revision: OwnerPolicyRevisionV1, input: { approvedBy: string; approvedAt: string; effectiveFromYear: number }): OwnerPolicyRevisionV1 {
  if (revision.status !== "UNREVIEWED") throw new Error(`Only UNREVIEWED policy revisions may be approved, not ${revision.status}`);
  if (hash(revision.candidateContent) !== revision.contentSha256) throw new Error(`Policy ${revision.policyId} changed after review hash generation`);
  if (!input.approvedBy.trim() || !input.approvedAt.trim() || !Number.isInteger(input.effectiveFromYear) || input.effectiveFromYear < 0) throw new Error("Derived approval provenance and effective year are required");
  return { ...revision, status: "APPROVED", approvedBy: input.approvedBy.trim(), approvedAt: input.approvedAt, effectiveFromYear: input.effectiveFromYear };
}

const unresolvedValues = (fields: readonly string[]) => ({ status: "OWNER_VALUES_REQUIRED", unresolvedFields: fields });
const genesis = { kind: "GENESIS" } as const;
const nextBarrier = { kind: "ATOMIC_YEAR_BARRIER" } as const;
function policy(input: OwnerPolicyDefinitionV1): OwnerPolicyDefinitionV1 { return input; }

function sustenancePolicies(foodSpecific: NonRefugeFoodSpecificV1): OwnerPolicyDefinitionV1[] {
  const lockedAuthorityIds = ["NON_REFUGE_SUSTENANCE_STRUCTURE"] as const;
  const semanticLocked = foodSpecific === "BLOOD" ? "BLOOD is sourced from the living; the precise permitted source metrics remain unresolved."
    : foodSpecific === "NO_FEEDING" ? "NO_FEEDING requires no sustenance; the behavior of demand and satisfaction records remains unresolved."
      : foodSpecific === "FEAR" ? "FEAR supports lower availability or a penalty in peaceful/calm conditions and greater availability during war/unrest; detailed mapping remains unresolved."
        : "No detailed meaning may be inferred from the classification name.";
  return [
    policy({ policyId: `SUSTENANCE_${foodSpecific}_SEMANTICS`, humanName: `${foodSpecific} semantic source mapping`, domain: "Population / Demography", purpose: `Defines the permitted causal source metrics and meaning for ${foodSpecific}.`, units: "typed semantic mapping", allowedRange: "Explicit permitted metrics and interpretation", causalConsumers: [`dynamic sustenance:${foodSpecific}`], reviewAuthority: "SEMANTIC", lifecycle: genesis, lockedAuthorityIds, candidateVersion: "v1", candidateContent: unresolvedValues(["sourceMetricIds", "semanticDescription", semanticLocked]), candidateRationale: `No detailed ${foodSpecific} causal source mapping has been approved.` }),
    policy({ policyId: `SUSTENANCE_${foodSpecific}_NUMERIC`, humanName: `${foodSpecific} production and demand`, domain: "Population / Demography", purpose: `Controls production/availability, consumption/demand, scarcity/satisfaction, and decay where applicable for ${foodSpecific}.`, units: "aggregate quantity/year and parts per million", allowedRange: "Non-negative; conservation-valid; classification semantics respected", causalConsumers: [`dynamic sustenance:${foodSpecific}`], reviewAuthority: "NUMERIC", lifecycle: genesis, lockedAuthorityIds, candidateVersion: "v1", candidateContent: unresolvedValues(["productionAvailability", "consumptionDemand", "scarcitySatisfaction", "decayIfApplicable"]), candidateRationale: `No numeric ${foodSpecific} sustenance formula has been approved.` }),
  ];
}

const basePolicies: OwnerPolicyDefinitionV1[] = [
  policy({ policyId: "CLASS_POLICY", humanName: "Class distribution policy", domain: "Population / Demography", purpose: "Maps tier populations into causal social-class distributions.", units: "basis points", allowedRange: "Each tier distribution sums exactly to 10000", causalConsumers: ["classDistribution", "office eligibility"], reviewAuthority: "NUMERIC", lifecycle: genesis, lockedAuthorityIds: [], candidateVersion: "v2", candidateContent: CANDIDATE_CLASS_POLICY_V1, candidateRationale: "Corrected from a 1,000-scale representation to basis points without approving the values." }),
  policy({ policyId: "TERRAIN_COMPATIBILITY_POLICY", humanName: "Terrain compatibility policy", domain: "Influence / Territory", purpose: "Controls compatibility between population ecology and physical sites.", units: "score 0..1000", allowedRange: "0..1000", causalConsumers: ["founding", "migration"], reviewAuthority: "NUMERIC", lifecycle: genesis, lockedAuthorityIds: [], candidateVersion: "v1", candidateContent: CANDIDATE_TERRAIN_POLICY_V1, candidateRationale: "Existing numeric review blocker carried forward." }),
  policy({ policyId: "CONFLICT_EPISODE_PROFILE", humanName: "Conflict episode profile", domain: "Conflict / Security", purpose: "Controls aggregate causal effects of conflict episodes.", units: "typed fixed-point values", allowedRange: "Per-field schema limits", causalConsumers: ["conflict"], reviewAuthority: "NUMERIC", lifecycle: nextBarrier, lockedAuthorityIds: [], candidateVersion: "v1", candidateContent: CANDIDATE_CONFLICT_PROFILE_V1, candidateRationale: "Existing numeric review blocker carried forward." }),
  policy({ policyId: "SKIRMISH_PROFILE", humanName: "Skirmish profile", domain: "Conflict / Security", purpose: "Controls bounded skirmish effects.", units: "typed fixed-point values", allowedRange: "Per-field schema limits", causalConsumers: ["border skirmish"], reviewAuthority: "NUMERIC", lifecycle: nextBarrier, lockedAuthorityIds: [], candidateVersion: "v1", candidateContent: CANDIDATE_SKIRMISH_PROFILE_V1, candidateRationale: "Existing numeric review blocker carried forward." }),
  policy({ policyId: "PEACE_EXHAUSTION_POLICY", humanName: "Peace and exhaustion policy", domain: "Conflict / Security", purpose: "Controls war exhaustion and peaceful recovery.", units: "score/year", allowedRange: "Per-field schema limits", causalConsumers: ["peace review"], reviewAuthority: "NUMERIC", lifecycle: nextBarrier, lockedAuthorityIds: [], candidateVersion: "v1", candidateContent: CANDIDATE_PEACE_EXHAUSTION_POLICY_V1, candidateRationale: "Existing numeric review blocker carried forward." }),
  policy({ policyId: "FEDERAL_VISION_WEIGHTS", humanName: "Federal Vision decision weights", domain: "Federal Vision", purpose: "Weights the locked Concord, Ruin, and Schism directionality in shared decisions.", units: "basis points", allowedRange: "Each decision profile sums to 10000", causalConsumers: ["executive actions", "appointments", "routes", "institutions"], reviewAuthority: "NUMERIC", lifecycle: genesis, lockedAuthorityIds: ["FEDERAL_VISION_DIRECTIONALITY"], candidateVersion: "v1", candidateContent: unresolvedValues(["per-consumer weights", "normalization", "caps"]), candidateRationale: "Directionality is locked; its numeric weights remain unresolved." }),
  policy({ policyId: "SETTLEMENT_INFLUENCE", humanName: "Settlement influence policy", domain: "Influence / Territory", purpose: "Transforms locked contributors into a geodesic influence radius.", units: "distance and fixed-point weights", allowedRange: "Positive bounded radius; saturating transforms", causalConsumers: ["territory", "POI/Refuge/Resource/route control"], reviewAuthority: "NUMERIC", lifecycle: genesis, lockedAuthorityIds: ["INFLUENCE_BOUNDARY_STRUCTURE", "INFLUENCE_CONTRIBUTOR_STRUCTURE"], candidateVersion: "v2", candidateContent: unresolvedValues(["normalization by contributor", "saturation", "caps", "weights", "radius formula", "whether and how route centrality contributes"]), candidateRationale: "Contributor categories and boundary geometry are locked; exact formulas and proposed route centrality remain candidates." }),
  policy({ policyId: "ROUTE_DECISION", humanName: "Dynamic route decision policy", domain: "Routes", purpose: "Controls opening, capacity, degradation, closure, and control of physical corridors.", units: "typed weights and thresholds", allowedRange: "Per-field schema limits", causalConsumers: ["route lifecycle"], reviewAuthority: "SEMANTIC", lifecycle: genesis, lockedAuthorityIds: [], candidateVersion: "v1", candidateContent: unresolvedValues(["causal route classification", "status transitions", "control and access semantics"]), candidateRationale: "Prompt-01 classification remains noncausal until separately promoted." }),
  policy({ policyId: "ATROCITY_HARM_SHARE", humanName: "Common atrocity harm share", domain: "Atrocity Impact", purpose: "Sets the shared proportion of current world population uniquely harmed by each occurrence.", units: "parts per million of world population", allowedRange: "0..1000000 ppm", causalConsumers: ["all 54 atrocity definitions"], reviewAuthority: "NUMERIC", lifecycle: { kind: "SCHEDULED_BARRIER", defaultYear: 50 }, lockedAuthorityIds: ["ATROCITY_IDENTITY_AND_ACCOUNTING"], candidateVersion: "v1", candidateContent: { targetHarmSharePpm: 100_000 }, candidateRationale: "The packet's 10 percent example remains a numeric candidate." }),
  policy({ policyId: "ATROCITY_PRIMARY_HARM_PROFILES", humanName: "Atrocity primary harm profiles", domain: "Atrocity Impact", purpose: "Allocates uniqueHarmed among mutually exclusive primary outcomes.", units: "basis points of uniqueHarmed", allowedRange: "Every profile sums exactly to 10000", causalConsumers: ["atrocity execution", "migration", "population"], reviewAuthority: "NUMERIC", lifecycle: { kind: "SCHEDULED_BARRIER", defaultYear: 50 }, lockedAuthorityIds: ["ATROCITY_IDENTITY_AND_ACCOUNTING", "ATROCITY_PRIMARY_HARM_ACCOUNTING"], candidateVersion: "v1", candidateContent: unresolvedValues(["mortality", "forced displacement", "detention/forced labor", "civic exclusion", "service/access denial", "asset/property seizure", "growth/reproductive suppression", "other explicitly modeled primary harm"]), candidateRationale: "The two conflicting primary-allocation policies were collapsed; no profile values are approved." }),
  policy({ policyId: "ATROCITY_CONCENTRATION", humanName: "Atrocity target concentration", domain: "Atrocity Impact", purpose: "Controls how the common unique-harmed budget is concentrated among approved target cohorts.", units: "basis points and fixed-point concentration", allowedRange: "0..10000; exact population conservation", causalConsumers: ["atrocity execution", "population slicing"], reviewAuthority: "NUMERIC", lifecycle: { kind: "SCHEDULED_BARRIER", defaultYear: 50 }, lockedAuthorityIds: ["ATROCITY_IDENTITY_AND_ACCOUNTING"], candidateVersion: "v1", candidateContent: unresolvedValues(["target concentration formula", "cohort caps", "stable remainder allocation"]), candidateRationale: "No concentration formula has been approved." }),
  policy({ policyId: "ATROCITY_SPILLOVER", humanName: "Atrocity direct and secondary spillover", domain: "Atrocity Impact", purpose: "Separately controls direct-victim redistribution and overlapping non-victim consequences.", units: "basis points and typed fixed-point effects", allowedRange: "Direct allocation conserves uniqueHarmed; secondary effects add zero uniqueHarmed", causalConsumers: ["atrocity execution", "neighbor effects", "migration"], reviewAuthority: "NUMERIC", lifecycle: { kind: "SCHEDULED_BARRIER", defaultYear: 50 }, lockedAuthorityIds: ["ATROCITY_SPILLOVER_ACCOUNTING"], candidateVersion: "v2", candidateContent: { DIRECT_HARM_SPILLOVER: unresolvedValues(["redistribution share", "eligible neighboring Settlements/cohorts", "distance/route attenuation"]), SECONDARY_CONSEQUENCE_SPILLOVER: unresolvedValues(["reputation", "fear", "grievance", "propaganda", "migration pressure", "diplomacy", "religion", "Family reaction"]) }, candidateRationale: "Direct-victim and secondary-consequence layers are structurally separate; all magnitudes remain unresolved." }),
  policy({ policyId: "ATROCITY_PERSISTENCE", humanName: "Atrocity persistence and historical scars", domain: "Atrocity Impact", purpose: "Controls current mechanical effects of append-only atrocity and scar history.", units: "years and fixed-point effects", allowedRange: "Per-field schema limits", causalConsumers: ["historical scars", "reputation", "group safety", "paired pillars"], reviewAuthority: "NUMERIC", lifecycle: { kind: "SCHEDULED_BARRIER", defaultYear: 50 }, lockedAuthorityIds: ["ATROCITY_HISTORY_APPEND_ONLY"], candidateVersion: "v2", candidateContent: unresolvedValues(["decay", "strengthening", "reactivation", "later-history interactions", "effect caps and durations"]), candidateRationale: "Append-only records do not imply permanently constant numeric effects." }),
  policy({ policyId: "ATROCITY_17_B_SCHEDULE", humanName: "ATROCITY_17_B trigger year", domain: "Event Triggers", purpose: "Sets only the newly proposed ATROCITY_17_B trigger year.", units: "simulation year", allowedRange: "Integer greater than 50", causalConsumers: ["atrocity scheduler"], reviewAuthority: "NUMERIC", lifecycle: { kind: "SCHEDULED_BARRIER", defaultYear: 75 }, lockedAuthorityIds: ["ATROCITY_17_A_INHERITED_SCHEDULE"], candidateVersion: "v1", candidateContent: { ATROCITY_17_B: 75 }, candidateRationale: "ATROCITY_17_A=50 is inherited locked authority; only the proposed year 75 needs review." }),
  policy({ policyId: "TEMPLE_THRESHOLD", humanName: "Temple worshipper threshold", domain: "Religion", purpose: "Determines when a Deity becomes eligible for its single world Temple.", units: "worshippers", allowedRange: ">= 1", causalConsumers: ["religious-site eligibility"], reviewAuthority: "NUMERIC", lifecycle: genesis, lockedAuthorityIds: ["RELIGIOUS_SITE_CARDINALITY", "PANTHEON_CENTER_SELECTION_STRUCTURE"], candidateVersion: "v1", candidateContent: { minimumWorshippers: 100000 }, candidateRationale: "The 100,000 threshold remains a numeric candidate." }),
  policy({ policyId: "SHRINE_THRESHOLD", humanName: "Shrine settlement-share threshold", domain: "Religion", purpose: "Determines when a Deity becomes eligible for its single world Shrine.", units: "parts per million of Settlement population", allowedRange: "0..1000000 ppm", causalConsumers: ["religious-site eligibility"], reviewAuthority: "NUMERIC", lifecycle: genesis, lockedAuthorityIds: ["RELIGIOUS_SITE_CARDINALITY", "PANTHEON_CENTER_SELECTION_STRUCTURE"], candidateVersion: "v1", candidateContent: { minimumSettlementSharePpm: 800_000 }, candidateRationale: "The 80 percent threshold remains a numeric candidate." }),
  policy({ policyId: "RELIGIOUS_SIMILARITY", humanName: "Religious similarity policy", domain: "Religion", purpose: "Defines and weights Deity/Pantheon relationship effects.", units: "typed semantics and fixed-point weights", allowedRange: "Per-field 0..1000", causalConsumers: ["cohesion", "migration", "sanctuary", "alliances"], reviewAuthority: "SEMANTIC", lifecycle: genesis, lockedAuthorityIds: [], candidateVersion: "v1", candidateContent: unresolvedValues(["same-Deity effect", "same-Pantheon/different-Deity effect", "different-Pantheon effect", "corresponding weights"]), candidateRationale: "Detailed relationship behavior and weights remain unresolved." }),
  policy({ policyId: "DEROGATORY_TAXONOMY", humanName: "Derogatory Group canonical structures", domain: "Derogatory Groups", purpose: "Reconciles each legacy candidate Group before recording membership in three canonical structures.", units: "typed review decisions", allowedRange: "KEEP or REJECT for every legacy Group; three membership decisions only for KEEP Groups", causalConsumers: ["Derogatory predicate readiness", "atrocity target selection"], reviewAuthority: "SEMANTIC", lifecycle: genesis, lockedAuthorityIds: [], candidateVersion: "v2", candidateContent: unresolvedValues(["three canonical structure names", "KEEP or REJECT for each legacy candidate Group", "for each KEEP Group: MEMBER or NOT_MEMBER in each structure"]), candidateRationale: "All-NOT_MEMBER cannot implicitly preserve a legacy Group; the atomic 63-decision targeting protocol remains separate." }),
  policy({ policyId: "REFUGE_OUTPUT", humanName: "Refuge output policy", domain: "Resources", purpose: "Controls aggregate Refuge output entering local logistics.", units: "aggregate stock/year", allowedRange: "Non-negative", causalConsumers: ["Quartermaster intake"], reviewAuthority: "NUMERIC", lifecycle: genesis, lockedAuthorityIds: ["REFUGE_CLASSIFICATION_STRUCTURE"], candidateVersion: "v1", candidateContent: unresolvedValues(["production formula", "capacity", "quality modifiers"]), candidateRationale: "No numeric output formula has been approved." }),
  policy({ policyId: "REFUGE_REPLENISHMENT", humanName: "Refuge replenishment policy", domain: "Resources", purpose: "Controls recovery and replenishment of Refuge output.", units: "aggregate stock/year", allowedRange: "Non-negative and capacity bounded", causalConsumers: ["Refuge stock"], reviewAuthority: "NUMERIC", lifecycle: genesis, lockedAuthorityIds: ["REFUGE_CLASSIFICATION_STRUCTURE"], candidateVersion: "v1", candidateContent: unresolvedValues(["replenishment rate", "damage response", "capacity bound"]), candidateRationale: "No numeric replenishment formula has been approved." }),
  policy({ policyId: "RESOURCE_YIELD_DEPLETION", humanName: "Resource yield and depletion policy", domain: "Resources", purpose: "Controls aggregate ResourceNode yield, regeneration, depletion, and recovery.", units: "aggregate stock/year", allowedRange: "Non-negative and capacity bounded", causalConsumers: ["ResourceNode stock"], reviewAuthority: "NUMERIC", lifecycle: genesis, lockedAuthorityIds: [], candidateVersion: "v1", candidateContent: unresolvedValues(["yield", "regeneration", "depletion", "recovery"]), candidateRationale: "No numeric Resource formula has been approved." }),
  policy({ policyId: "QUARTERMASTER_CAPACITY_LOSS", humanName: "Quartermaster capacity and loss policy", domain: "Resources", purpose: "Controls intake, storage, throughput, disruption, spoilage, and delivery loss.", units: "aggregate stock/year and basis points", allowedRange: "Non-negative; loss 0..10000 bps", causalConsumers: ["logistics flow"], reviewAuthority: "NUMERIC", lifecycle: genesis, lockedAuthorityIds: [], candidateVersion: "v1", candidateContent: unresolvedValues(["intake capacity", "storage", "throughput", "disruption", "spoilage", "delivery loss"]), candidateRationale: "No numeric capacity or loss formula has been approved." }),
  policy({ policyId: "RESOURCE_QUARTERMASTER_ASSIGNMENT_POLICY", humanName: "Resource-to-Quartermaster assignment", domain: "Resources", purpose: "Deterministically selects the Quartermaster serving each ResourceNode/logistics flow.", units: "ordered semantic rules", allowedRange: "Complete deterministic ordering with stable-ID tie-break", causalConsumers: ["ResourceNode logistics"], reviewAuthority: "SEMANTIC", lifecycle: genesis, lockedAuthorityIds: [], candidateVersion: "v1", candidateContent: unresolvedValues(["eligible Quartermasters", "control/jurisdiction", "route/access", "capacity priority", "reassignment", "stable-ID tie-break"]), candidateRationale: "The assignment authority is required but its ordering is unresolved." }),
  policy({ policyId: "POI_RENAME_CONSEQUENCES", humanName: "POI rename consequence policy", domain: "Naming / Political Rename Cost", purpose: "Controls political and historical consequences of KEEP and REQUEST_RENAME decisions.", units: "typed deltas and durations", allowedRange: "Per-field schema limits", causalConsumers: ["POI naming rights"], reviewAuthority: "NUMERIC", lifecycle: nextBarrier, lockedAuthorityIds: [], candidateVersion: "v1", candidateContent: unresolvedValues(["legitimacy", "acceptance/grievance", "historical erasure", "group safety/migration", "pillar and Family reputation", "propaganda", "diplomatic claims", "conflict risk", "durable cultural memory"]), candidateRationale: "Consequence categories are structural; magnitudes remain unresolved." }),
];

export const OWNER_POLICY_DEFINITIONS_V56: readonly OwnerPolicyDefinitionV1[] = [
  ...basePolicies,
  ...NON_REFUGE_FOOD_SPECIFIC_V1.flatMap(sustenancePolicies),
].sort((left, right) => left.policyId.localeCompare(right.policyId));

export function initialOwnerPolicyCenterV56(): OwnerPolicyRevisionV1[] {
  return OWNER_POLICY_DEFINITIONS_V56.map(materializeOwnerPolicyCandidateV1);
}
