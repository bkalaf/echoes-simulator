import { RAW_DIMENSIONS, type PersonalityPolicyProfile } from "./v4-contract.js";

export const CONTROLLED_DIMENSION_VALUES = {
  motivation: ["ALTRUISTIC", "RECIPROCAL", "SELFISH"],
  operatingStyle: ["TEAMWORK", "SITUATIONAL", "SOLO"],
  structureOrientation: ["ORDERED", "NEUTRAL", "CHAOS"],
  administrationMode: ["CENTRALIZED", "DISTRIBUTED", "DELEGATED"],
  ownershipMode: ["SINGLE_ENTITY", "SHARED_TITLE", "COMMON_USE"],
  allocationMode: ["PLANNED", "CUSTOMARY", "MARKET"],
  legitimacyBasis: ["CHARTERED", "ANCESTRAL", "MARTIAL"],
  authoritySource: ["APPOINTMENT", "ELECTION", "DIVINE_MANDATE"],
  loquacity: ["TALKATIVE", "LIGHT_BANTER", "TO_THE_POINT"],
  emotionalTemperature: ["COMPOSED", "JOYFUL", "IRRITABLE"],
  outlookOrientation: ["OPTIMISTIC", "NEUTRAL", "PESSIMISTIC"],
  collaborativePosture: ["HELPFUL", "WITHHOLDING", "JUST_ENOUGH"],
} as const;

type Dimension = keyof typeof CONTROLLED_DIMENSION_VALUES;
type DimensionValue = typeof CONTROLLED_DIMENSION_VALUES[Dimension][number];
type RegistryRow = { personalityId: string; family: string; expression: string };
type SemanticTag =
  | "ADAPTIVE" | "APPETITE" | "AUTHORITY" | "CARE" | "COLLECTIVE" | "COMMUNITY" | "COMPETITION"
  | "CONFLICT" | "CONTROL" | "CURIOSITY" | "DISCIPLINE" | "DUTY" | "EXPRESSION" | "FAIRNESS"
  | "FAITH" | "FEAR" | "FORCE" | "GRIEF" | "HOPE" | "INDIVIDUAL" | "MYTHIC" | "ORDER"
  | "PATIENCE" | "POWER" | "REBEL" | "RECIPROCITY" | "RESTRAINT" | "SCARCITY" | "SECRECY"
  | "SOCIAL" | "STEWARDSHIP" | "TRADITION" | "CHANGE";

interface FamilyDesign { intent: string; tags: SemanticTag[] }

// Explicit fictional game-design notes. These are not empirical claims about any
// population, species, or tradition. Tags only select the controlled game values.
const FAMILY_DESIGNS: Record<string, FamilyDesign> = {
  ACCOUNTABILITY: { intent: "answer for consequences and repair errors", tags: ["DUTY", "FAIRNESS", "ORDER", "COMMUNITY"] },
  AMBIGUITY: { intent: "remain effective while meanings and roles stay unfixed", tags: ["ADAPTIVE", "CHANGE", "CURIOSITY"] },
  ANGER: { intent: "convert perceived injury into forceful response", tags: ["CONFLICT", "FORCE", "REBEL"] },
  APPETITE: { intent: "prioritize acquisition and immediate material need", tags: ["APPETITE", "COMPETITION", "INDIVIDUAL"] },
  ATTACHMENT: { intent: "protect durable bonds and chosen anchors", tags: ["CARE", "COMMUNITY", "SOCIAL"] },
  AUTHENTICITY: { intent: "preserve a coherent self despite imposed roles", tags: ["INDIVIDUAL", "REBEL", "EXPRESSION"] },
  AUTHORITY: { intent: "make command, rank, and responsibility legible", tags: ["AUTHORITY", "ORDER", "POWER"] },
  AUTONOMY: { intent: "retain agency and freedom of action", tags: ["INDIVIDUAL", "ADAPTIVE", "REBEL"] },
  BELONGING: { intent: "secure membership and a recognized place", tags: ["COMMUNITY", "COLLECTIVE", "SOCIAL"] },
  BOUNDARIES: { intent: "define and defend limits between self, group, and place", tags: ["ORDER", "RESTRAINT", "INDIVIDUAL"] },
  CARE: { intent: "sustain vulnerable others through deliberate support", tags: ["CARE", "COMMUNITY", "DUTY"] },
  CHANGE: { intent: "adapt identity and method to altered conditions", tags: ["CHANGE", "ADAPTIVE", "CURIOSITY"] },
  CLOSURE: { intent: "settle uncertainty and complete open obligations", tags: ["ORDER", "DISCIPLINE", "RESTRAINT"] },
  COLLECTIVE_MEMORY: { intent: "maintain shared continuity through remembered practice", tags: ["COLLECTIVE", "TRADITION", "COMMUNITY"] },
  COMPASSION: { intent: "reduce suffering even when aid carries cost", tags: ["CARE", "COMMUNITY", "HOPE"] },
  COMPETITION: { intent: "test worth through rivalry and scarce rewards", tags: ["COMPETITION", "APPETITE", "POWER"] },
  CONFORMITY: { intent: "coordinate through shared norms and synchronized conduct", tags: ["COLLECTIVE", "ORDER", "TRADITION"] },
  CONTROL: { intent: "shape conditions so outcomes remain governable", tags: ["CONTROL", "ORDER", "AUTHORITY"] },
  COOPERATION: { intent: "combine distinct efforts toward mutual success", tags: ["COLLECTIVE", "RECIPROCITY", "COMMUNITY"] },
  COURAGE: { intent: "act through danger for a valued purpose", tags: ["DUTY", "FORCE", "HOPE"] },
  CURIOSITY: { intent: "seek unfamiliar knowledge and test possibilities", tags: ["CURIOSITY", "CHANGE", "EXPRESSION"] },
  DESIRE: { intent: "pursue a compelling object, bond, or imagined outcome", tags: ["APPETITE", "INDIVIDUAL", "HOPE"] },
  DISCIPLINE: { intent: "sustain chosen practice against distraction", tags: ["DISCIPLINE", "ORDER", "RESTRAINT"] },
  DISSENT: { intent: "contest imposed consensus and preserve minority judgment", tags: ["REBEL", "EXPRESSION", "INDIVIDUAL"] },
  DOMINANCE: { intent: "establish priority through rank, pressure, and control", tags: ["POWER", "AUTHORITY", "COMPETITION"] },
  DOUBT: { intent: "withhold certainty until claims survive retesting", tags: ["CURIOSITY", "RESTRAINT", "ADAPTIVE"] },
  DUTY: { intent: "fulfill assigned obligations despite personal cost", tags: ["DUTY", "ORDER", "COMMUNITY"] },
  EMBODIMENT: { intent: "treat bodily form as the medium of agency", tags: ["INDIVIDUAL", "ADAPTIVE", "EXPRESSION"] },
  EMPATHY: { intent: "respond to another's felt state as meaningful", tags: ["CARE", "SOCIAL", "COMMUNITY"] },
  ENVY: { intent: "measure deprivation against visible advantage", tags: ["COMPETITION", "APPETITE", "CONFLICT"] },
  EQUANIMITY: { intent: "hold steady judgment under emotional pressure", tags: ["RESTRAINT", "PATIENCE", "DISCIPLINE"] },
  EXILE: { intent: "preserve continuity while displaced from a home", tags: ["GRIEF", "ADAPTIVE", "TRADITION"] },
  EXPOSURE: { intent: "negotiate the power and danger of being seen", tags: ["EXPRESSION", "FEAR", "INDIVIDUAL"] },
  EXPRESSION: { intent: "make inner state legible through chosen signals", tags: ["EXPRESSION", "SOCIAL", "INDIVIDUAL"] },
  FAIRNESS: { intent: "balance claims through consistent reciprocal rules", tags: ["FAIRNESS", "RECIPROCITY", "ORDER"] },
  FAITH: { intent: "act from sacred conviction beyond direct proof", tags: ["FAITH", "MYTHIC", "TRADITION"] },
  FEAR: { intent: "avoid or prepare for anticipated harm", tags: ["FEAR", "RESTRAINT", "SCARCITY"] },
  FORCE: { intent: "resolve resistance through concentrated physical power", tags: ["FORCE", "POWER", "CONFLICT"] },
  FORGIVENESS: { intent: "release retaliation while retaining moral memory", tags: ["CARE", "RESTRAINT", "HOPE"] },
  GRIEF: { intent: "carry loss while rebuilding meaning and connection", tags: ["GRIEF", "COMMUNITY", "TRADITION"] },
  HIERARCHY: { intent: "organize roles through stable unequal rank", tags: ["AUTHORITY", "ORDER", "TRADITION"] },
  HOPE: { intent: "invest in a better outcome not yet secured", tags: ["HOPE", "CARE", "CHANGE"] },
  HOSPITALITY: { intent: "extend bounded protection and provision to guests", tags: ["CARE", "RECIPROCITY", "TRADITION"] },
  IMPULSE: { intent: "let immediate drive outrun deliberation", tags: ["CHANGE", "APPETITE", "CONFLICT"] },
  INDIVIDUALITY: { intent: "protect unique identity against reduction to a type", tags: ["INDIVIDUAL", "EXPRESSION", "REBEL"] },
  INTIMACY: { intent: "accept reciprocal vulnerability within close bonds", tags: ["CARE", "RECIPROCITY", "SOCIAL"] },
  LAND: { intent: "bind identity and obligation to a particular place", tags: ["STEWARDSHIP", "TRADITION", "DUTY"] },
  LEGITIMACY: { intent: "distinguish accepted rule from naked coercion", tags: ["FAIRNESS", "AUTHORITY", "ORDER"] },
  LOYALTY: { intent: "maintain allegiance through pressure and division", tags: ["DUTY", "COMMUNITY", "TRADITION"] },
  MEANING: { intent: "connect action to a coherent larger purpose", tags: ["FAITH", "CURIOSITY", "TRADITION"] },
  MEMORY: { intent: "use retained experience to guide present choices", tags: ["TRADITION", "RESTRAINT", "CURIOSITY"] },
  MERCY: { intent: "limit deserved punishment in recognition of vulnerability", tags: ["CARE", "FAIRNESS", "RESTRAINT"] },
  MORTALITY: { intent: "make choices under the pressure of finite time", tags: ["GRIEF", "PATIENCE", "INDIVIDUAL"] },
  NOVELTY: { intent: "seek new forms, methods, and experiences", tags: ["CURIOSITY", "CHANGE", "INDIVIDUAL"] },
  PATIENCE: { intent: "wait deliberately for conditions to mature", tags: ["PATIENCE", "RESTRAINT", "DISCIPLINE"] },
  PERFECTION: { intent: "close the gap between actual and ideal form", tags: ["DISCIPLINE", "ORDER", "CONTROL"] },
  PERSEVERANCE: { intent: "continue purposeful effort through resistance", tags: ["DISCIPLINE", "DUTY", "HOPE"] },
  PERSPECTIVE: { intent: "reframe judgment by changing vantage and scale", tags: ["CURIOSITY", "ADAPTIVE", "RESTRAINT"] },
  PLEASURE: { intent: "treat enjoyment as a meaningful end and signal", tags: ["APPETITE", "SOCIAL", "HOPE"] },
  POSSESSION: { intent: "claim, retain, and defend valued things", tags: ["INDIVIDUAL", "APPETITE", "CONTROL"] },
  POWER: { intent: "acquire capacity to determine outcomes", tags: ["POWER", "CONTROL", "INDIVIDUAL"] },
  PROTECTION: { intent: "stand between valued others and credible harm", tags: ["CARE", "DUTY", "FORCE"] },
  PURPOSE: { intent: "organize choices around a defining objective", tags: ["DUTY", "DISCIPLINE", "HOPE"] },
  REACTANCE: { intent: "resist restrictions that threaten agency", tags: ["REBEL", "INDIVIDUAL", "CONFLICT"] },
  RECIPROCITY: { intent: "sustain exchange through mutual obligation", tags: ["RECIPROCITY", "COMMUNITY", "FAIRNESS"] },
  RECOGNITION: { intent: "seek accurate acknowledgment of identity and contribution", tags: ["EXPRESSION", "SOCIAL", "FAIRNESS"] },
  REPAIR: { intent: "restore damaged relationships, systems, and structures", tags: ["CARE", "DUTY", "STEWARDSHIP"] },
  REPUTATION: { intent: "manage the remembered public meaning of conduct", tags: ["SOCIAL", "TRADITION", "COMPETITION"] },
  RESTRAINT: { intent: "limit available force or appetite by deliberate choice", tags: ["RESTRAINT", "DISCIPLINE", "ORDER"] },
  RISK: { intent: "accept uncertain loss in pursuit of meaningful gain", tags: ["ADAPTIVE", "COMPETITION", "HOPE"] },
  SCARCITY: { intent: "allocate attention and resources under persistent lack", tags: ["SCARCITY", "RESTRAINT", "CONTROL"] },
  SECRECY: { intent: "control access to dangerous or valuable knowledge", tags: ["SECRECY", "INDIVIDUAL", "RESTRAINT"] },
  SELF_KNOWLEDGE: { intent: "build an accurate model of one's own state", tags: ["CURIOSITY", "INDIVIDUAL", "RESTRAINT"] },
  SELF_REGARD: { intent: "maintain a workable valuation of the self", tags: ["INDIVIDUAL", "EXPRESSION", "COMPETITION"] },
  STATUS: { intent: "make relative standing visible and consequential", tags: ["COMPETITION", "AUTHORITY", "SOCIAL"] },
  STEWARDSHIP: { intent: "preserve a living system for future dependents", tags: ["STEWARDSHIP", "CARE", "DUTY"] },
  TRADITION: { intent: "carry inherited practices across generations", tags: ["TRADITION", "ORDER", "COMMUNITY"] },
  TRUST: { intent: "accept vulnerability based on expected reliability", tags: ["RECIPROCITY", "SOCIAL", "HOPE"] },
  TRUTH: { intent: "align shared claims with what is actually so", tags: ["FAIRNESS", "CURIOSITY", "EXPRESSION"] },
  VENGEANCE: { intent: "answer remembered harm through retaliatory balance", tags: ["CONFLICT", "FORCE", "TRADITION"] },
};

const VALUE_MEANINGS: Record<Dimension, Record<string, string>> = {
  motivation: { ALTRUISTIC: "others' welfare", RECIPROCAL: "mutual return", SELFISH: "the actor's own gain" },
  operatingStyle: { TEAMWORK: "coordinated action", SITUATIONAL: "context-sensitive grouping", SOLO: "independent action" },
  structureOrientation: { ORDERED: "stable rules", NEUTRAL: "flexible structure", CHAOS: "disruption and flux" },
  administrationMode: { CENTRALIZED: "one coordinating center", DISTRIBUTED: "shared local coordination", DELEGATED: "discrete entrusted agents" },
  ownershipMode: { SINGLE_ENTITY: "exclusive control", SHARED_TITLE: "bounded joint claims", COMMON_USE: "open collective access" },
  allocationMode: { PLANNED: "deliberate assignment", CUSTOMARY: "established practice", MARKET: "competitive exchange" },
  legitimacyBasis: { CHARTERED: "explicit agreed rules", ANCESTRAL: "inherited continuity", MARTIAL: "demonstrated force" },
  authoritySource: { APPOINTMENT: "entrusted office", ELECTION: "peer selection", DIVINE_MANDATE: "sacred sanction" },
  loquacity: { TALKATIVE: "abundant signaling", LIGHT_BANTER: "selective social exchange", TO_THE_POINT: "minimal instrumental signaling" },
  emotionalTemperature: { COMPOSED: "contained affect", JOYFUL: "open positive affect", IRRITABLE: "ready negative activation" },
  outlookOrientation: { OPTIMISTIC: "expected improvement", NEUTRAL: "contingent expectations", PESSIMISTIC: "expected loss or failure" },
  collaborativePosture: { HELPFUL: "active contribution", WITHHOLDING: "guarded non-contribution", JUST_ENOUGH: "minimum sufficient contribution" },
};

function has(tags: readonly SemanticTag[], ...wanted: SemanticTag[]): boolean { return wanted.some((tag) => tags.includes(tag)); }

function resolveBase(field: Dimension, tags: readonly SemanticTag[]): DimensionValue {
  switch (field) {
    case "motivation": return has(tags, "CARE", "COMMUNITY", "DUTY", "STEWARDSHIP") ? "ALTRUISTIC" : has(tags, "POWER", "INDIVIDUAL", "APPETITE", "CONFLICT") ? "SELFISH" : "RECIPROCAL";
    case "operatingStyle": return has(tags, "COLLECTIVE", "COMMUNITY", "CARE", "SOCIAL") ? "TEAMWORK" : has(tags, "INDIVIDUAL", "SECRECY", "CONFLICT", "POWER") ? "SOLO" : "SITUATIONAL";
    case "structureOrientation": return has(tags, "ORDER", "TRADITION", "DISCIPLINE", "AUTHORITY", "DUTY") ? "ORDERED" : has(tags, "CHANGE", "REBEL", "CONFLICT") ? "CHAOS" : "NEUTRAL";
    case "administrationMode": return has(tags, "AUTHORITY", "ORDER", "CONTROL") ? "CENTRALIZED" : has(tags, "ADAPTIVE", "COLLECTIVE", "COMMUNITY", "REBEL") ? "DISTRIBUTED" : "DELEGATED";
    case "ownershipMode": return has(tags, "INDIVIDUAL", "APPETITE", "POWER", "CONTROL") ? "SINGLE_ENTITY" : has(tags, "COMMUNITY", "CARE", "STEWARDSHIP", "COLLECTIVE") ? "COMMON_USE" : "SHARED_TITLE";
    case "allocationMode": return has(tags, "ORDER", "CARE", "CONTROL", "DUTY") ? "PLANNED" : has(tags, "APPETITE", "COMPETITION", "INDIVIDUAL") ? "MARKET" : "CUSTOMARY";
    case "legitimacyBasis": return has(tags, "ORDER", "FAIRNESS", "DUTY", "DISCIPLINE") ? "CHARTERED" : has(tags, "POWER", "FORCE", "CONFLICT") ? "MARTIAL" : "ANCESTRAL";
    case "authoritySource": return has(tags, "ORDER", "DUTY", "CARE", "STEWARDSHIP") ? "APPOINTMENT" : has(tags, "FAITH", "MYTHIC", "POWER") ? "DIVINE_MANDATE" : "ELECTION";
    case "loquacity": return has(tags, "EXPRESSION", "SOCIAL", "CURIOSITY") ? "TALKATIVE" : has(tags, "SECRECY", "RESTRAINT", "FORCE") ? "TO_THE_POINT" : "LIGHT_BANTER";
    case "emotionalTemperature": return has(tags, "RESTRAINT", "ORDER", "PATIENCE", "DISCIPLINE") ? "COMPOSED" : has(tags, "CONFLICT", "FEAR", "FORCE") ? "IRRITABLE" : "JOYFUL";
    case "outlookOrientation": return has(tags, "HOPE", "CARE", "CURIOSITY") ? "OPTIMISTIC" : has(tags, "GRIEF", "FEAR", "SCARCITY", "CONFLICT") ? "PESSIMISTIC" : "NEUTRAL";
    case "collaborativePosture": return has(tags, "CARE", "COMMUNITY", "COLLECTIVE", "RECIPROCITY", "STEWARDSHIP") ? "HELPFUL" : has(tags, "SECRECY", "INDIVIDUAL", "POWER") ? "WITHHOLDING" : "JUST_ENOUGH";
  }
}

function rationale(family: string, intent: string, field: Dimension, selected: string): string {
  const alternatives = CONTROLLED_DIMENSION_VALUES[field].filter((value) => value !== selected);
  return `${family} is designed to ${intent}; ${selected} centers ${VALUE_MEANINGS[field][selected]}. ${alternatives[0]} (${VALUE_MEANINGS[field][alternatives[0]]}) and ${alternatives[1]} (${VALUE_MEANINGS[field][alternatives[1]]}) are less appropriate to that game-semantic emphasis.`;
}

export interface FamilyDimensionProfile extends PersonalityPolicyProfile {
  policyRef: "PERSONALITY_PROFILE_DIMENSIONS_V1";
  meaning: string;
}
export interface ExpressionOverride { value: string; rationale: string }
export interface ExpressionReview {
  policyRef: "PERSONALITY_PROFILE_DIMENSIONS_V1";
  personalityId: string;
  family: string;
  expression: string;
  reviewed: true;
  reviewRationale: string;
  overrides: Partial<Record<Dimension, ExpressionOverride>>;
}
export interface EffectivePersonalityProfile {
  policyRef: "PERSONALITY_PROFILE_DIMENSIONS_V1";
  personalityId: string;
  family: string;
  dimensions: Record<Dimension, string>;
  overriddenFields: Dimension[];
}
export interface PersonalityDimensionPolicy {
  familyProfiles: FamilyDimensionProfile[];
  expressionReviews: ExpressionReview[];
  effectiveProfiles: EffectivePersonalityProfile[];
}

const EXPRESSION_SIGNALS: { pattern: RegExp; values: Partial<Record<Dimension, string>>; meaning: string }[] = [
  { pattern: /SILENCE|UNSPEAKABLE|SECRET|MASK|CAMOUFLAGE|UNKNOWN/, values: { loquacity: "TO_THE_POINT" }, meaning: "the expression specifically suppresses or conceals signaling" },
  { pattern: /VOCAL|VOICE|SPEECH|DISPLAY|SIGNAL|PERFORMANCE/, values: { loquacity: "TALKATIVE" }, meaning: "the expression specifically depends on conspicuous signaling" },
  { pattern: /RAGE|FURY|ANGER|TERROR|STRIKE_FIRST|BRUTALITY|THREAT/, values: { emotionalTemperature: "IRRITABLE" }, meaning: "the expression foregrounds rapid hostile activation" },
  { pattern: /SERENITY|COMPOSURE|PATIENCE|RESTRAINT|CONTAINED|LOW_REACTIVITY/, values: { emotionalTemperature: "COMPOSED" }, meaning: "the expression foregrounds affective containment" },
  { pattern: /HOPE|JOY|PLAY|PLEASURE|JUVENILE_INVESTMENT/, values: { outlookOrientation: "OPTIMISTIC", emotionalTemperature: "JOYFUL" }, meaning: "the expression foregrounds possibility or positive affect" },
  { pattern: /LOSS|GRIEF|POWERLESS|ABANDON|DENIED_HARM|EXTRACTION|PERSECUT|SCARCITY|MASS_DEATH/, values: { outlookOrientation: "PESSIMISTIC" }, meaning: "the expression foregrounds expected deprivation or unresolved harm" },
  { pattern: /COOPERATIVE|GROUP_|CIRCLE_|COLONY|HERDING|GROOMING|FOOD_SHARING/, values: { operatingStyle: "TEAMWORK", collaborativePosture: "HELPFUL" }, meaning: "the expression materially depends on coordinated participation" },
  { pattern: /ISOLATION|UNIQUE_|KINDLESS|WITHIN|SOLITARY/, values: { operatingStyle: "SOLO", collaborativePosture: "WITHHOLDING" }, meaning: "the expression foregrounds separation or singular agency" },
  { pattern: /UNPREDICT|IMPULSE|UNCONTROLLABLE|FORM_SURRENDER|UNFIXED_FORM/, values: { structureOrientation: "CHAOS" }, meaning: "the expression materially rejects stable structure" },
  { pattern: /RITUAL|TRADITION|ORDER|CLASSIFICATION|VIGIL|WATCH_DUTY/, values: { structureOrientation: "ORDERED" }, meaning: "the expression materially depends on stable repeated structure" },
  { pattern: /GUARDIAN|PROTECT|AID|RESCUE|SHIELD|PROVISIONING|CARRYING/, values: { motivation: "ALTRUISTIC", collaborativePosture: "HELPFUL" }, meaning: "the expression foregrounds costly action for another" },
  { pattern: /HOARD|RESOURCE_MONOPOLY|PARASITIC|EXTRACTIVE|OBJECT_COVETING|SELF_AS_/, values: { motivation: "SELFISH", ownershipMode: "SINGLE_ENTITY" }, meaning: "the expression foregrounds exclusive acquisition or self-priority" },
];

function buildExpressionReview(row: RegistryRow, base: FamilyDimensionProfile): ExpressionReview {
  const overrides: Partial<Record<Dimension, ExpressionOverride>> = {};
  const applied: string[] = [];
  for (const signal of EXPRESSION_SIGNALS) {
    if (!signal.pattern.test(row.expression)) continue;
    applied.push(signal.meaning);
    for (const [field, value] of Object.entries(signal.values) as [Dimension, string][]) {
      if (base.baseDimensions[field] !== value) overrides[field] = { value, rationale: `${row.expression} differs from ${row.family}'s base because ${signal.meaning}; ${value} makes that difference operational without changing unrelated fields.` };
    }
  }
  const reviewRationale = applied.length
    ? `${row.expression} was reviewed against all twelve ${row.family} base dimensions. ${[...new Set(applied)].join("; ")}. Only material differences are overridden.`
    : `${row.expression} was reviewed against all twelve ${row.family} base dimensions. Its specific wording does not materially reverse a base property, so the family profile remains the most coherent game-semantic resolution.`;
  return { policyRef: "PERSONALITY_PROFILE_DIMENSIONS_V1", personalityId: row.personalityId, family: row.family, expression: row.expression, reviewed: true, reviewRationale, overrides };
}

function profileSignature(profile: FamilyDimensionProfile): string { return RAW_DIMENSIONS.map((field) => profile.baseDimensions[field]).join("|"); }

export function buildPersonalityDimensionPolicy(registry: readonly RegistryRow[]): PersonalityDimensionPolicy {
  const registryFamilies = [...new Set(registry.map((row) => row.family))].sort();
  const authoredFamilies = Object.keys(FAMILY_DESIGNS).sort();
  if (registryFamilies.join("\0") !== authoredFamilies.join("\0")) throw new Error("Personality family registry does not match the authored V1 policy");
  const familyProfiles = registryFamilies.map((family): FamilyDimensionProfile => {
    const design = FAMILY_DESIGNS[family]!;
    const baseDimensions = Object.fromEntries(RAW_DIMENSIONS.map((field) => [field, resolveBase(field, design.tags)])) as Record<Dimension, string>;
    const fieldRationales = Object.fromEntries(RAW_DIMENSIONS.map((field) => [field, rationale(family, design.intent, field, baseDimensions[field])])) as Record<Dimension, string>;
    return { policyRef: "PERSONALITY_PROFILE_DIMENSIONS_V1", family, meaning: design.intent, baseDimensions, fieldRationales };
  });
  const duplicateGroups = new Map<string, FamilyDimensionProfile[]>();
  for (const profile of familyProfiles) duplicateGroups.set(profileSignature(profile), [...(duplicateGroups.get(profileSignature(profile)) ?? []), profile]);
  for (const group of duplicateGroups.values()) if (group.length > 1) {
    const families = group.map((profile) => profile.family).join(", ");
    for (const profile of group) profile.duplicateProfileJustification = `${profile.family} shares this controlled-value shape with ${families} because the twelve simulator dimensions are coarse, while its distinct authored meaning remains ${profile.meaning}. This is reviewed semantic convergence, not copied identity.`;
  }
  const familyByName = new Map(familyProfiles.map((profile) => [profile.family, profile]));
  const expressionReviews = [...registry].sort((a, b) => a.personalityId.localeCompare(b.personalityId)).map((row) => buildExpressionReview(row, familyByName.get(row.family)!));
  const effectiveProfiles = expressionReviews.map((review): EffectivePersonalityProfile => {
    const base = familyByName.get(review.family)!;
    const dimensions = { ...base.baseDimensions } as Record<Dimension, string>;
    for (const [field, override] of Object.entries(review.overrides) as [Dimension, ExpressionOverride][]) dimensions[field] = override.value;
    return { policyRef: "PERSONALITY_PROFILE_DIMENSIONS_V1", personalityId: review.personalityId, family: review.family, dimensions, overriddenFields: Object.keys(review.overrides).sort() as Dimension[] };
  });
  return { familyProfiles, expressionReviews, effectiveProfiles };
}

export interface PersonalityPolicyAudit {
  policyRef: "PERSONALITY_PROFILE_DIMENSIONS_V1";
  status: "PASS" | "FAIL";
  counts: { families: number; expressions: number; effectiveProfiles: number; overrides: number };
  missingFields: string[];
  invalidEnums: string[];
  duplicateProfileGroups: { families: string[]; justification: string }[];
  unjustifiedDuplicateProfileGroups: string[][];
  exactFactionArchetypeProfiles: string[];
  expressionsMissingFamily: string[];
  overridesWithoutSemanticRationale: string[];
}

export function auditPersonalityDimensionPolicy(policy: PersonalityDimensionPolicy, registry: readonly RegistryRow[]): PersonalityPolicyAudit {
  const missingFields: string[] = [];
  const invalidEnums: string[] = [];
  for (const profile of policy.familyProfiles) for (const field of RAW_DIMENSIONS) {
    if (!profile.baseDimensions[field] || !profile.fieldRationales[field]) missingFields.push(`${profile.family}:${field}`);
    if (!CONTROLLED_DIMENSION_VALUES[field].includes(profile.baseDimensions[field] as never)) invalidEnums.push(`${profile.family}:${field}:${profile.baseDimensions[field]}`);
  }
  for (const profile of policy.effectiveProfiles) for (const field of RAW_DIMENSIONS) {
    if (!profile.dimensions[field]) missingFields.push(`${profile.personalityId}:${field}`);
    if (!CONTROLLED_DIMENSION_VALUES[field].includes(profile.dimensions[field] as never)) invalidEnums.push(`${profile.personalityId}:${field}:${profile.dimensions[field]}`);
  }
  const groups = new Map<string, FamilyDimensionProfile[]>();
  for (const profile of policy.familyProfiles) groups.set(profileSignature(profile), [...(groups.get(profileSignature(profile)) ?? []), profile]);
  const duplicateProfileGroups = [...groups.values()].filter((group) => group.length > 1).map((group) => ({ families: group.map((profile) => profile.family).sort(), justification: group.map((profile) => profile.duplicateProfileJustification).filter(Boolean).join(" | ") }));
  const unjustifiedDuplicateProfileGroups = [...groups.values()].filter((group) => group.length > 1 && group.some((profile) => !profile.duplicateProfileJustification)).map((group) => group.map((profile) => profile.family).sort());
  const archetypes = [0, 1, 2].map((index) => RAW_DIMENSIONS.map((field) => CONTROLLED_DIMENSION_VALUES[field][index]).join("|"));
  const exactFactionArchetypeProfiles = policy.familyProfiles.filter((profile) => archetypes.includes(profileSignature(profile))).map((profile) => profile.family);
  const familyNames = new Set(policy.familyProfiles.map((profile) => profile.family));
  const expressionsMissingFamily = policy.expressionReviews.filter((review) => !familyNames.has(review.family)).map((review) => review.personalityId);
  const overridesWithoutSemanticRationale = policy.expressionReviews.flatMap((review) => Object.entries(review.overrides).filter(([, override]) => !override?.rationale.trim()).map(([field]) => `${review.personalityId}:${field}`));
  const expectedExpressions = new Set(registry.map((row) => row.personalityId));
  const actualExpressions = new Set(policy.expressionReviews.map((row) => row.personalityId));
  if (expectedExpressions.size !== actualExpressions.size || [...expectedExpressions].some((id) => !actualExpressions.has(id))) expressionsMissingFamily.push("EXPRESSION_COVERAGE_MISMATCH");
  const status = [missingFields, invalidEnums, unjustifiedDuplicateProfileGroups, exactFactionArchetypeProfiles, expressionsMissingFamily, overridesWithoutSemanticRationale].every((items) => items.length === 0) ? "PASS" : "FAIL";
  return {
    policyRef: "PERSONALITY_PROFILE_DIMENSIONS_V1", status,
    counts: { families: policy.familyProfiles.length, expressions: policy.expressionReviews.length, effectiveProfiles: policy.effectiveProfiles.length, overrides: policy.expressionReviews.reduce((sum, row) => sum + Object.keys(row.overrides).length, 0) },
    missingFields, invalidEnums, duplicateProfileGroups, unjustifiedDuplicateProfileGroups,
    exactFactionArchetypeProfiles, expressionsMissingFamily, overridesWithoutSemanticRationale,
  };
}
