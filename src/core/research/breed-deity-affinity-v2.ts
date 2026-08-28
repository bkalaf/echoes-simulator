import {
  AXIS_WEIGHTS,
  DEITIES,
  SCORE_AXES,
  type BreedEvidenceProfile,
  type CandidateAssessment,
  type Confidence,
  type DeityAuthorityRecord,
  type EvidenceFragment,
  type Pantheon,
  type ScoreAxis,
} from "./breed-deity-affinity.js";

export const BREED_DEITY_AFFINITY_V2_SCHEMA_VERSION = "echoes-breed-deity-affinity-v2" as const;
export const BREED_DEITY_V2_RULES_VERSION = "BREED_PRIMARY_DEITY_SEMANTIC_CALIBRATION_V2_2026-08-28" as const;

export type EvidenceTier = "DEFINING" | "STRONG" | "MODERATE" | "WEAK" | "CONTRADICTORY";

export interface SemanticSignalDefinition {
  clusterId: string;
  tier: EvidenceTier;
  terms: readonly string[];
  axes: readonly ScoreAxis[];
  rationale: string;
  calibrationRule: string;
}

export interface DeityEvidenceProfile {
  deityName: string;
  specificityReview: string;
  contradictoryEvidence: readonly string[];
  signals: readonly SemanticSignalDefinition[];
}

export interface PersonalityFamilyAffinity {
  deityName: string;
  family: string;
  v2Strength: number;
  tier: Exclude<EvidenceTier, "CONTRADICTORY">;
  semanticJustification: string;
}

export interface SignalFrequencyRow {
  deityName: string;
  semanticCluster: string;
  breedFrequency: number;
  corpusShare: number;
  specificityFactor: number;
  strongestTier: EvidenceTier;
  calibrationRules: string[];
}

export interface SemanticEvidenceCluster {
  sourceRecordId: string;
  sourceScope: EvidenceFragment["sourceScope"];
  fieldPath: string;
  sourceFactId: string;
  excerpt: string;
  semanticCluster: string;
  strongestTier: EvidenceTier;
  axesInformed: ScoreAxis[];
  rawLexicalMatches: string[];
  rawSemanticContribution: number;
  specificityFactor: number;
  authorityFactor: number;
  repeatedClusterFactor: number;
  crossFactConceptFactor: number;
  crossAxisFactors: Partial<Record<ScoreAxis, number>>;
  effectiveContributions: Partial<Record<ScoreAxis, number>>;
  effectiveScoredContribution: number;
  basis: string[];
  calibrationRules: string[];
  rationale: string;
}

export interface CandidateAssessmentV2 extends Omit<CandidateAssessment, "matchedEvidence"> {
  semanticEvidenceClusters: SemanticEvidenceCluster[];
  definingClusterCount: number;
  strongClusterCount: number;
  moderateClusterCount: number;
  contradictoryClusterCount: number;
  independentSemanticClusterCount: number;
  independentSourceFactCount: number;
  directBreedClusterCount: number;
  directBreedDefiningOrStrongCount: number;
  sourceFieldCount: number;
  singleFieldDependence: number;
  calibrationRules: string[];
}

export interface ConfidenceAssessmentV2 {
  suggestedConfidence: Confidence;
  confidence: Confidence;
  confidenceRationale: string;
  confidenceOverrideReason: string | null;
  evidenceQuality: "STRONG" | "MODERATE" | "WEAK";
  evidenceDirectness: "DEFINING" | "DIRECT" | "PARTIAL" | "INDIRECT";
  evidenceBreadth: number;
  evidenceConsistency: "CONVERGENT" | "MIXED" | "INSEPARABLE";
  missingEvidence: string[];
  confidenceInputs: {
    independentSemanticClusters: number;
    independentSourceFacts: number;
    definingClusters: number;
    strongClusters: number;
    directBreedClusters: number;
    directBreedDefiningOrStrong: number;
    sourceFields: number;
    singleFieldDependence: number;
    contradictoryClusters: number;
    topTwoMargin: number;
  };
}

const P = "PERSONALITY_ALIGNMENT" as const;
const B = "BEHAVIOR_ALIGNMENT" as const;
const E = "ECOLOGICAL_ALIGNMENT" as const;
const S = "SYMBOLIC_ALIGNMENT" as const;
const C = "CANONICAL_TEXT_SUPPORT" as const;
const ALL = [P, B, E, S, C] as const;
const BE = [B, E, S, C] as const;
const PS = [P, S, C] as const;

function signal(clusterId: string, tier: EvidenceTier, terms: string[], axes: readonly ScoreAxis[], rationale: string, calibrationRule: string): SemanticSignalDefinition {
  return { clusterId, tier, terms, axes, rationale, calibrationRule };
}

const CONTRADICTORY_EVIDENCE: Readonly<Record<string, readonly string[]>> = {
  Miren: ["deliberate cruelty", "abandons injured", "indifferent to suffering"],
  Darel: ["refuses to act from fear", "flees solely from fear"],
  Savael: ["immediate escalation", "retaliates immediately"],
  Elian: ["abandons rebuilding", "despairs after destruction"],
  Namiya: ["refuses reconciliation", "permanent vendetta"],
  Oren: ["deliberate deception", "lies for advantage", "false signal"],
  Tavai: ["ignores distress", "cannot recognize individuals"],
  Varek: ["abandons after failure", "gives up after setback"],
  Selen: ["suppresses play", "forbids celebration"],
  Solkar: ["avoids daylight", "strictly nocturnal"],
  Lunessa: ["strictly aperiodic", "no recurring cycle"],
  Vespera: ["cannot home", "random disorientation"],
  Voltar: ["electrically inert", "storm avoidance"],
  Marea: ["obligate terrestrial", "avoids open water"],
  Rillan: ["strictly arid", "avoids freshwater"],
  Damor: ["destroys habitat", "degrades ecosystem"],
  Sterna: ["strictly sedentary", "never disperses"],
  Scarabos: ["avoids carrion", "avoids detritus"],
  Sahrem: ["extinguishes fire", "heat avoidance"],
  Neressa: ["rigid form", "cannot adapt"],
  Kharad: ["unstable and weightless", "rapidly loses solidity"],
  Aveli: ["permanently confined", "cannot move through air"],
  Iskarn: ["heat-dependent rapid metabolism", "cannot enter dormancy"],
  Myrra: ["incapable of imagination", "only one possible form"],
  "Orun-IX": ["random timing", "nonrepeatable process"],
  Vhalen: ["cannot conceal", "permanent unavoidable presence"],
  Asteriel: ["chaotic fragmentation", "disintegrates coordination"],
};

function profile(deityName: string, specificityReview: string, signals: SemanticSignalDefinition[]): DeityEvidenceProfile {
  const contradictoryEvidence = CONTRADICTORY_EVIDENCE[deityName] ?? [];
  return {
    deityName,
    specificityReview,
    contradictoryEvidence,
    signals: [...signals, signal("contradictory_domain_evidence", "CONTRADICTORY", [...contradictoryEvidence], ALL, `Evidence directly opposes ${deityName}'s defining domain.`, `${deityName.toUpperCase().replaceAll("-", "_")}_CONTRADICTORY_EVIDENCE`)],
  };
}

export const DEITY_EVIDENCE_PROFILES_V2: Readonly<Record<string, DeityEvidenceProfile>> = Object.freeze({
  Miren: profile("Miren", "Costly compassion, mercy, and concern for suffering define the domain. Ordinary parenting and sociality remain contextual support.", [
    signal("costly_compassion", "DEFINING", ["personal cost", "at personal cost", "self-sacrifice", "self sacrifice", "sacrifices itself", "despite personal loss", "risks itself to protect", "gives up food", "feeds unrelated"], ALL, "Aid or protection is undertaken despite material cost to the actor.", "MIREN_COSTLY_COMPASSION"),
    signal("mercy_and_suffering", "STRONG", ["mercy", "concern for suffering", "aids injured", "injury aid", "rescues others", "rescue behavior", "protects the vulnerable", "cares for unrelated"], [P, B, S, C], "The fact directly concerns mercy or another's suffering.", "MIREN_MERCY_SUFFERING"),
    signal("caregiving", "MODERATE", ["caregiving", "provisioning", "food sharing", "alloparent", "alloparental", "cooperative breeding", "adoption", "protect young", "parental care", "nursing young"], ALL, "Care is real but does not itself establish costly or universal compassion.", "MIREN_CARE_SUPPORT_ONLY"),
    signal("generic_prosociality", "WEAK", ["helpful", "altruistic", "social", "pair bond", "pair-bond", "refuge", "cooperative", "guardian", "parental"], [P, B, S], "Generic prosociality is contextual rather than defining compassion.", "MIREN_GENERIC_PROSOCIAL_CAP"),
  ]),
  Darel: profile("Darel", "Courage requires action in the presence of danger or fear. Aggression, threat, or combat without that relation is not courage.", [
    signal("action_despite_fear", "DEFINING", ["despite fear", "while afraid", "in spite of fear", "faces fear", "acts while afraid", "fear but continues", "knowingly enters danger"], ALL, "The actor proceeds while fear or danger is explicitly present.", "DAREL_ACTION_DESPITE_FEAR"),
    signal("protective_danger", "STRONG", ["risks injury to defend", "defends against predator", "mobbing predators", "feigned injury", "stands ground against", "dangerous rescue", "protective defense"], BE, "Protective action exposes the actor to meaningful danger.", "DAREL_PROTECTIVE_DANGER"),
    signal("risk_taking", "MODERATE", ["bold", "brave", "high-risk", "high risk", "dangerous crossing", "exposed foraging", "cliff leap", "defiance"], [P, B, E, S], "Risk is present, but fear and chosen action are not both explicit.", "DAREL_RISK_SUPPORT"),
    signal("aggression_not_courage", "WEAK", ["aggression", "combat", "threat display", "dominant", "attack", "fight"], [P, B], "Aggression or combat is not equivalent to courage.", "DAREL_AGGRESSION_CAP"),
  ]),
  Savael: profile("Savael", "Active waiting, restraint, and long non-escalatory endurance define patience; mere slowness is contextual.", [
    signal("active_long_restraint", "DEFINING", ["without escalation", "decades of reconciliation", "long-term restraint", "waits for years", "patiently persists", "active endurance", "continues without retaliating"], ALL, "The fact combines duration with restraint or reconciliation.", "SAVAEL_ACTIVE_ENDURANCE"),
    signal("patient_strategy", "STRONG", ["sit-and-wait", "sit and wait", "ambush patience", "stalking patience", "waits motionless", "long incubation", "delayed maturity"], BE, "Waiting is a central, active life strategy.", "SAVAEL_PATIENT_STRATEGY"),
    signal("restraint_composure", "MODERATE", ["patience", "restraint", "equanimity", "low reactivity", "composed", "tolerates", "de-escalation"], [P, B, S, C], "Restraint supports patience without proving long endurance.", "SAVAEL_RESTRAINT_SUPPORT"),
    signal("mere_slowness", "WEAK", ["slow", "sedentary", "low activity", "long-lived"], [B, E], "Slowness alone does not embody active patience.", "SAVAEL_SLOWNESS_CAP"),
  ]),
  Elian: profile("Elian", "Hope is renewal after loss or destruction, not generic optimism alone.", [
    signal("rebuild_after_loss", "DEFINING", ["rebuilds after destruction", "returns after catastrophe", "recovers after collapse", "restores after loss", "recolonizes disturbed", "regrows after fire", "tries again after failure"], ALL, "Renewed effort follows explicit destruction, loss, or failure.", "ELIAN_REBUILD_AFTER_LOSS"),
    signal("renewal_recovery", "STRONG", ["regeneration", "regrowth", "recolonization", "pioneer species", "ecological recovery", "rebirth", "restoration"], BE, "The life strategy materially restores what was lost.", "ELIAN_RENEWAL"),
    signal("future_optimism", "MODERATE", ["hope", "optimistic", "future possibility", "new beginning", "renewed effort"], PS, "Future orientation supports hope but may lack prior catastrophe.", "ELIAN_OPTIMISM_SUPPORT"),
    signal("novelty_only", "WEAK", ["novelty", "curious", "exploration"], [P, S], "Novelty is not by itself hope.", "ELIAN_NOVELTY_CAP"),
  ]),
  Namiya: profile("Namiya", "Forgiveness requires repair after genuine injury with accountability preserved.", [
    signal("accountable_reconciliation", "DEFINING", ["reconciles after harm", "forgives without forgetting", "accountability and reconciliation", "restores relationship after injury", "post-conflict reconciliation", "repair after betrayal"], ALL, "The fact contains both real injury and restored relationship or release.", "NAMIYA_ACCOUNTABLE_RECONCILIATION"),
    signal("post_conflict_repair", "STRONG", ["post-conflict grooming", "post conflict grooming", "reconciliation grooming", "repairs social bond", "reconcile", "forgiveness"], [P, B, S, C], "A relationship is repaired after conflict.", "NAMIYA_POST_CONFLICT_REPAIR"),
    signal("mercy_release", "MODERATE", ["mercy", "release after submission", "accepts submission", "conditional release", "restores bond"], [P, B, S], "Merciful release supports forgiveness without full injury context.", "NAMIYA_MERCY_SUPPORT"),
    signal("ordinary_grooming", "WEAK", ["grooming", "social bonding", "tolerant"], [B, E], "Ordinary affiliative behavior does not establish forgiveness.", "NAMIYA_SOCIALITY_CAP"),
  ]),
  Oren: profile("Oren", "Honesty is truthful signaling or correction, especially when costly; generic communication is insufficient.", [
    signal("costly_truth", "DEFINING", ["truth at personal cost", "exposes a lie despite", "costly honesty", "reveals wrongdoing", "truthful despite penalty", "corrects its own error"], ALL, "Truth is maintained despite a cost or contrary incentive.", "OREN_COSTLY_TRUTH"),
    signal("reliable_honest_signal", "STRONG", ["honest signal", "honest signaling", "reliable signal", "truthful", "transparent", "candor", "detects deception", "error correction", "retesting"], [P, B, E, S, C], "The fact directly concerns signal reliability, truth, or correction.", "OREN_HONEST_SIGNAL"),
    signal("integrity_accountability", "MODERATE", ["integrity", "accountability", "authenticity", "fact-check", "verification"], PS, "Integrity supports honesty without an explicit costly truth act.", "OREN_INTEGRITY_SUPPORT"),
    signal("communication_only", "WEAK", ["communicates", "vocal", "signal", "talkative"], [P, B], "Communication volume is not truthfulness.", "OREN_COMMUNICATION_CAP"),
  ]),
  Tavai: profile("Tavai", "Empathy requires perspective-taking, emotional inference, mediation, or attunement; teamwork is contextual.", [
    signal("perspective_taking", "DEFINING", ["perspective-taking", "perspective taking", "understands another viewpoint", "infers emotional state", "theory of mind", "accurately reads distress", "mediates between"], ALL, "The fact directly demonstrates understanding another mind or viewpoint.", "TAVAI_PERSPECTIVE_TAKING"),
    signal("emotional_attunement", "STRONG", ["consolation", "distress response", "emotional attunement", "responds to distress", "social perception", "empathetic", "empathy"], [P, B, S, C], "Behavior is tuned to another's emotional state.", "TAVAI_ATTUNEMENT"),
    signal("social_learning", "MODERATE", ["social learning", "recognizes individuals", "learns from others", "cooperative coordination", "mediation"], [P, B, E], "Social cognition supports empathy but is not perspective-taking by itself.", "TAVAI_SOCIAL_COGNITION"),
    signal("generic_teamwork", "WEAK", ["social", "teamwork", "cooperative", "group living", "helpful", "herd", "colony"], [P, B, E], "Generic sociality or teamwork is weak empathy evidence.", "TAVAI_TEAMWORK_CAP"),
  ]),
  Varek: profile("Varek", "Resolve requires persistence through setback, failure, adversity, or duty; the word persistent alone is weak.", [
    signal("perseverance_through_failure", "DEFINING", ["repeated failure", "after repeated failure", "fails but continues", "refuses to abandon", "despite setbacks", "tries again", "duty despite adversity", "continues after defeat"], ALL, "Meaningful effort continues through explicit setback or failure.", "VAREK_FAILURE_PERSEVERANCE"),
    signal("extreme_endurance", "STRONG", ["survives repeated hardship", "persistent pursuit", "extreme endurance", "drought endurance", "cold endurance", "long pursuit", "holds vigil", "last guardian"], [P, B, E, S], "Sustained duty or endurance occurs under material adversity.", "VAREK_ADVERSITY_ENDURANCE"),
    signal("duty_tenacity", "MODERATE", ["perseverance", "tenacity", "grit", "duty", "discipline", "continues", "endures"], [P, B, S, C], "Duty or tenacity supports resolve without explicit failure.", "VAREK_DUTY_SUPPORT"),
    signal("persistent_word_only", "WEAK", ["persistent", "persistence", "long-lived", "durable"], [P, B, E], "Generic persistence is weak unless adversity is stated.", "VAREK_PERSISTENT_CAP"),
  ]),
  Selen: profile("Selen", "Joy is play, celebration, affection, music, humor, or communal pleasure; display without pleasure is supporting.", [
    signal("communal_joy", "DEFINING", ["communal celebration", "celebrates together", "festival", "shared joy", "laughter", "humor", "music-making", "reasons for living"], ALL, "Joy is explicitly shared or celebrated.", "SELEN_COMMUNAL_JOY"),
    signal("play_affection_music", "STRONG", ["social play", "object play", "playful", "affection", "courtship song", "sings", "dance", "music", "pleasure", "joy"], [P, B, E, S, C], "Play, affection, music, or pleasure is a characteristic expression.", "SELEN_PLAY_EXPRESSION"),
    signal("expressive_display", "MODERATE", ["courtship display", "display lek", "vocal display", "visual display", "joyful", "talkative"], [P, B, E], "Expressive display supports joy but may serve reproduction rather than pleasure.", "SELEN_DISPLAY_SUPPORT"),
    signal("social_only", "WEAK", ["social", "gregarious", "group living"], [B, E], "Sociality alone does not establish joy.", "SELEN_SOCIALITY_CAP"),
  ]),
  Solkar: profile("Solkar", "Daylight-linked activity and life-giving solar warmth are central; generic heat belongs weakly here unless solar or vital.", [
    signal("solar_life_cycle", "DEFINING", ["sun-dependent", "solar activity", "awakens at dawn", "tracks the sun", "sunlight essential", "photosynthetic", "daylight-dependent"], ALL, "The life strategy is explicitly governed by solar light or dawn.", "SOLKAR_SOLAR_DEPENDENCE"),
    signal("diurnal_basking", "STRONG", ["diurnal", "day-active", "day active", "basking", "basks in sun", "dawn activity", "sun exposed"], [B, E, S, C], "Daylight or solar warmth structures activity.", "SOLKAR_DIURNAL_WARMTH"),
    signal("illumination_warmth", "MODERATE", ["sunlight", "daylight", "solar", "dawn", "life-giving warmth", "illumination"], [E, S, C], "Solar illumination or warmth is present without a full life-cycle dependency.", "SOLKAR_LIGHT_SUPPORT"),
    signal("generic_warm", "WEAK", ["warm", "heat tolerant", "hot climate"], [E], "Ambient warmth is contextual, not necessarily solar embodiment.", "SOLKAR_WARMTH_CAP"),
  ]),
  Lunessa: profile("Lunessa", "Periodic transformation, disappearance and return, and recurring nocturnal rhythms define phase symbolism; nocturnality alone is moderate.", [
    signal("phase_return_cycle", "DEFINING", ["return after disappearance", "periodic disappearance", "waxing and waning", "waxing", "waning", "phase-linked", "phase linked", "cyclic transformation", "recurring nocturnal rhythm"], ALL, "The fact directly embodies phases or disappearance and return.", "LUNESSA_PHASE_RETURN"),
    signal("periodic_transformation", "STRONG", ["periodic emergence", "metamorphosis cycle", "seasonal molt", "molting cycle", "moulting cycle", "recurring transformation", "developmental cycle", "lunar rhythm", "moon-linked"], [P, B, E, S, C], "A recurring cycle changes form or visibility.", "LUNESSA_PERIODIC_TRANSFORMATION"),
    signal("nocturnal_rhythm", "MODERATE", ["nocturnal", "night-active", "night active", "night activity", "crepuscular cycle", "circadian night"], [B, E, S, C], "Nocturnality supports the domain but does not alone prove phase embodiment.", "LUNESSA_NOCTURNAL_SUPPORT"),
    signal("change_only", "WEAK", ["change", "molting", "moulting", "between states"], [P, B, E], "Unstructured change is weak phase evidence.", "LUNESSA_CHANGE_CAP"),
  ]),
  Vespera: profile("Vespera", "Orientation, wayfinding, homing, and navigation define the domain; migration without navigation is supporting.", [
    signal("celestial_wayfinding", "DEFINING", ["celestial navigation", "navigates by stars", "star compass", "sun compass", "magnetic compass", "celestial compass"], ALL, "Long-distance orientation uses a celestial or equivalent compass.", "VESPERA_CELESTIAL_WAYFINDING"),
    signal("homing_orientation", "STRONG", ["homing", "returns home", "wayfinding", "spatial navigation", "magnetic orientation", "long-distance orientation", "route memory"], [P, B, E, S, C], "The Breed has a characteristic orientation or homing capacity.", "VESPERA_HOMING"),
    signal("spatial_awareness", "MODERATE", ["navigation", "orients", "spatial memory", "migration guidance", "finds route"], [P, B, E], "Spatial awareness supports navigation without a defining mechanism.", "VESPERA_ORIENTATION_SUPPORT"),
    signal("travel_only", "WEAK", ["migration", "travels", "dispersal", "journey"], [B, E], "Movement alone is not navigation.", "VESPERA_TRAVEL_CAP"),
  ]),
  Voltar: profile("Voltar", "Electric discharge, storms, thunder, and abrupt charged force define the domain; generic force or anger does not.", [
    signal("electric_discharge", "DEFINING", ["electric discharge", "electrogenic", "lightning", "bioelectric shock", "electric shock", "charged atmosphere"], ALL, "The fact directly concerns electricity or lightning.", "VOLTAR_ELECTRICITY"),
    signal("storm_thunder", "STRONG", ["thunderstorm", "violent storm", "thunder", "storm-driven", "storm linked", "storm-linked"], [B, E, S, C], "Violent atmospheric energy structures the fact.", "VOLTAR_STORM"),
    signal("abrupt_disruption", "MODERATE", ["sudden strike", "abrupt burst", "violent burst", "sudden current", "catastrophic threshold", "disruptive force"], [P, B, S], "Abrupt force supports Voltar without explicit electricity.", "VOLTAR_DISRUPTION_SUPPORT"),
    signal("force_anger_only", "WEAK", ["force", "anger", "rage", "power", "dominance", "aggression"], [P, B], "Generic force, anger, and dominance are not storms or lightning.", "VOLTAR_FORCE_CAP"),
  ]),
  Marea: profile("Marea", "Open-ocean depth, tides, and long marine movement are strong; merely coastal or aquatic habitat is supporting.", [
    signal("deep_ocean_life", "DEFINING", ["deep-sea", "deep sea", "abyssal", "pelagic migration", "open-ocean migration", "open ocean migration", "ocean crossing", "deep dive"], ALL, "The life strategy is bound to open-ocean depth or long marine movement.", "MAREA_DEEP_OCEAN"),
    signal("tidal_marine_cycle", "STRONG", ["tidal", "tide-linked", "tide linked", "sea navigation", "marine migration", "pelagic", "open sea"], [B, E, S, C], "Tides or substantial marine movement structure behavior.", "MAREA_TIDES_MOVEMENT"),
    signal("marine_habitat", "MODERATE", ["ocean", "marine", "saltwater", "seabed", "deep water"], [E, S, C], "Marine habitat supports Marea without proving depth or tides.", "MAREA_MARINE_SUPPORT"),
    signal("coastal_only", "WEAK", ["coastal", "shore", "estuary"], [E], "Coastal occurrence alone is weak open-ocean evidence.", "MAREA_COAST_CAP"),
  ]),
  Rillan: profile("Rillan", "Freshwater-dependent cycles, upstream return, rainfall, and river movement outrank simple freshwater occupancy.", [
    signal("upstream_return_cycle", "DEFINING", ["upstream migration", "returns upstream", "returns to river", "freshwater-dependent cycle", "freshwater dependent cycle", "river migration", "anadromous"], ALL, "A life cycle depends on return or movement through freshwater systems.", "RILLAN_UPSTREAM_RETURN"),
    signal("rain_river_process", "STRONG", ["seasonal flooding", "rainfall cycle", "river dispersal", "stream spawning", "riverine migration", "flood pulse", "rain-triggered"], [B, E, S, C], "Freshwater flow or rain actively structures behavior or reproduction.", "RILLAN_FRESHWATER_PROCESS"),
    signal("freshwater_habitat", "MODERATE", ["freshwater", "fresh water", "river", "stream", "lake", "rainfall", "floodplain"], [E, S, C], "Freshwater occupancy supports but does not by itself embody return or flow.", "RILLAN_HABITAT_SUPPORT"),
    signal("water_generic", "WEAK", ["water", "aquatic", "wet"], [E], "Generic water association does not distinguish freshwater systems.", "RILLAN_WATER_CAP"),
  ]),
  Damor: profile("Damor", "Habitat engineering, renewal, and creating conditions for other life define the domain; terrain occupancy is weak.", [
    signal("ecosystem_engineering", "DEFINING", ["ecosystem engineer", "habitat engineer", "engineers habitat", "modifies environment", "environmental modification", "dam building", "creates habitat", "constructs wetland"], ALL, "The Breed materially constructs or modifies an ecosystem.", "DAMOR_ECOSYSTEM_ENGINEERING"),
    signal("renewal_for_others", "STRONG", ["forest renewal", "seed dispersal", "pollination", "soil aeration", "creates refuge", "creates conditions for", "ecosystem construction", "nutrient redistribution"], [B, E, S, C], "Activity renews habitat or enables other life.", "DAMOR_RENEWAL_FOR_OTHERS"),
    signal("habitat_construction", "MODERATE", ["burrow system", "nest construction", "builds shelter", "stewardship", "wetland restoration"], [P, B, E, S], "Construction or stewardship affects habitat on a limited scale.", "DAMOR_CONSTRUCTION_SUPPORT"),
    signal("habitat_occupancy", "WEAK", ["forest", "wetland", "habitat", "woodland", "swamp", "refuge", "nesting"], [E], "Living in associated terrain is not ecosystem engineering.", "DAMOR_OCCUPANCY_CAP"),
  ]),
  Sterna: profile("Sterna", "Seasonal, annual, and life-cycle travel define the domain; ordinary movement and dispersal are supporting.", [
    signal("seasonal_long_migration", "DEFINING", ["long-distance migration", "long distance migration", "annual migration", "seasonal migration", "seasonal return", "transcontinental migration", "breeding migration"], ALL, "Long travel recurs as part of a seasonal or reproductive life cycle.", "STERNA_SEASONAL_MIGRATION"),
    signal("nomadic_life_cycle", "STRONG", ["nomadic continuity", "overwinter", "migration route", "seasonal movement", "diaspora", "two-home", "two home"], [P, B, E, S, C], "Recurring movement materially structures life history.", "STERNA_LIFE_CYCLE_TRAVEL"),
    signal("dispersal_journey", "MODERATE", ["migration", "migrates", "dispersal", "long journey", "nomadic"], [P, B, E, S], "Travel is important but seasonality or recurrence is not explicit.", "STERNA_TRAVEL_SUPPORT"),
    signal("movement_only", "WEAK", ["moves", "wanders", "travels"], [B, E], "Generic movement is weak migration evidence.", "STERNA_MOVEMENT_CAP"),
  ]),
  Scarabos: profile("Scarabos", "Decomposition, burial, soil formation, carrion, and death feeding renewal define the domain; soil habitat alone is weak.", [
    signal("death_feeds_renewal", "DEFINING", ["death feeds life", "carrion nutrient cycle", "decomposition creates soil", "buries dead", "nutrient renewal", "recycles carcass", "decay supports new growth"], ALL, "Death or waste is directly transformed into renewed life.", "SCARABOS_DEATH_RENEWAL"),
    signal("decomposition_detritus", "STRONG", ["decomposition", "detritus", "carrion", "dung burial", "coprophag", "necrophag", "saprophytic", "nutrient cycling"], [B, E, S, C], "The life strategy directly processes decay, waste, or carrion.", "SCARABOS_DECOMPOSITION"),
    signal("soil_burial", "MODERATE", ["soil creation", "burial", "buries", "dung", "detritivore", "scavenges"], [B, E, S], "Burial or detritus supports the renewal cycle.", "SCARABOS_SOIL_SUPPORT"),
    signal("subterranean_only", "WEAK", ["soil", "underground", "subterranean", "burrow"], [E], "Being underground is not decay or renewal.", "SCARABOS_SUBTERRANEAN_CAP"),
  ]),
  Sahrem: profile("Sahrem", "Combustion and consuming thermal transformation define the domain; appetite, anger, and ambient warmth are weak analogues.", [
    signal("combustive_transformation", "DEFINING", ["combustion", "consuming fire", "burning transformation", "incinerates", "furnace", "wildfire regeneration", "creative destruction by fire"], ALL, "Fire consumes and materially transforms its subject.", "SAHREM_COMBUSTIVE_TRANSFORMATION"),
    signal("fire_volcanic_heat", "STRONG", ["fire", "flame", "burning", "volcanic", "geothermal", "erupts", "thermal vent", "fiery"], [B, E, S, C], "Literal fire or intense thermal process is characteristic.", "SAHREM_FIRE_HEAT"),
    signal("thermal_adaptation", "MODERATE", ["extreme heat", "heat tolerant", "thermal", "hot spring", "furnace heat"], [B, E, S], "Heat is functional but combustion is not explicit.", "SAHREM_THERMAL_SUPPORT"),
    signal("appetite_anger", "WEAK", ["hunger", "appetite", "consumes", "rage", "anger", "force", "power"], [P, B], "Appetite, anger, and force are metaphorical only without thermal change.", "SAHREM_METAPHOR_CAP"),
  ]),
  Neressa: profile("Neressa", "Yielding adaptation and flowing transformation define the domain; generic adaptation and aquatic habitat alone are weak.", [
    signal("yielding_identity", "DEFINING", ["yields without losing identity", "changes form without losing", "adaptive surrender", "form surrender", "fluid identity", "flows around obstacles"], ALL, "The subject adapts through yielding while retaining identity.", "NERESSA_YIELDING_IDENTITY"),
    signal("fluid_transformation", "STRONG", ["fluid transformation", "reshapes itself", "developmental plasticity", "flexible form", "flowing transformation", "water flow"], [P, B, E, S, C], "Fluidity or plasticity is an active transformation strategy.", "NERESSA_FLUID_TRANSFORMATION"),
    signal("flow_yielding_support", "MODERATE", ["fluid", "flow", "current", "yielding", "flows around", "amphibious transition"], [P, B, E, S], "Functional flow or yielding supports the domain without establishing preserved identity.", "NERESSA_FLOW_SUPPORT"),
    signal("generic_adaptation", "WEAK", ["adapts", "adaptation", "adaptive", "flexible", "amphibious"], [P, B, E], "Generic adaptation is weak without yielding or fluid transformation.", "NERESSA_ADAPTATION_CAP"),
    signal("aquatic_only", "WEAK", ["water", "aquatic", "marine", "freshwater"], [E], "Living in water is not the same as embodying yielding flow.", "NERESSA_AQUATIC_CAP"),
  ]),
  Kharad: profile("Kharad", "Stone, solidity, foundations, weight, permanence, and resistance to change define the domain. Territorial boundaries do not.", [
    signal("physical_foundation", "DEFINING", ["physical foundation", "living stone", "made of stone", "bedrock", "immovable foundation", "bears immense weight", "geological permanence"], ALL, "The fact directly concerns foundation, stone, weight, or permanence.", "KHARAD_FOUNDATION"),
    signal("stone_stability", "STRONG", ["stone", "rock dwelling", "mountain", "geologic", "resists change", "immovable", "rooted", "solidity", "permanence"], [P, B, E, S, C], "Physical stability or stone is characteristic.", "KHARAD_STONE_STABILITY"),
    signal("earth_subterranean", "MODERATE", ["earth", "cave", "subterranean", "underground", "burrow", "cliff", "heavy"], [B, E, S], "Earth association supports but does not prove foundational permanence.", "KHARAD_EARTH_SUPPORT"),
    signal("territory_boundaries", "WEAK", ["territorial", "territorial marking", "boundary", "boundaries", "domain bound", "land"], [P, B, E], "Territoriality and generic boundaries are not direct Earth-and-Stone evidence.", "KHARAD_TERRITORY_CAP"),
  ]),
  Aveli: profile("Aveli", "Flight-dominant freedom, wind, breath, diffusion, and movement resisting confinement define the domain; wings alone do not.", [
    signal("unconfined_aerial_life", "DEFINING", ["flight-dominant", "flight dominant", "never lands", "resists confinement", "wind-borne dispersal", "wind borne dispersal", "lives entirely aloft", "freedom of movement"], ALL, "Aerial mobility or unconfined motion fundamentally structures life.", "AVELI_UNCONFINED_AERIAL"),
    signal("flight_wind_breath", "STRONG", ["soaring", "gliding", "aerial", "airborne", "wind-borne", "wind borne", "breath", "high-altitude flight", "high altitude flight"], [P, B, E, S, C], "Flight, wind, or breath is a characteristic functional strategy.", "AVELI_FLIGHT_WIND"),
    signal("mobility_freedom", "MODERATE", ["flight", "flies", "wind", "disperses", "escape confinement", "autonomy", "free movement"], [P, B, E, S], "Mobility or freedom supports the concept without dominance.", "AVELI_MOBILITY_SUPPORT"),
    signal("wings_only", "WEAK", ["wing", "wings", "feathered", "arboreal"], [E, S], "Possessing wings or living above ground is weak evidence.", "AVELI_WINGS_CAP"),
  ]),
  Iskarn: profile("Iskarn", "Cold-linked preservation, dormancy, metabolic suppression, and suspended change define the domain; white appearance does not.", [
    signal("preserved_suspended_change", "DEFINING", ["suspended change", "metabolic suppression", "freezes without dying", "cryogenic preservation", "preserved in ice", "survives by dormancy", "winter dormancy"], ALL, "Survival depends on preservation or arrested process.", "ISKARN_PRESERVATION"),
    signal("cold_dormancy", "STRONG", ["hibernates", "hibernation", "torpor", "dormant", "ice adapted", "ice-adapted", "permafrost", "glacier", "polar winter"], [B, E, S, C], "Cold, dormancy, or metabolic slowing is a core strategy.", "ISKARN_COLD_DORMANCY"),
    signal("cold_stillness", "MODERATE", ["cold adapted", "cold-adapted", "frozen", "winter", "stillness", "remains still", "metabolic slowing"], [P, B, E, S], "Cold or stillness supports preservation without a full strategy.", "ISKARN_STILLNESS_SUPPORT"),
    signal("appearance_cold", "WEAK", ["white fur", "white plumage", "snow-colored", "snow covered", "cold climate"], [E, S], "Appearance or climate alone is weak evidence.", "ISKARN_APPEARANCE_CAP"),
  ]),
  Myrra: profile("Myrra", "Dreams, imagination, illusion, unreal potential, and shape-changing possibility define the domain. Curiosity, intelligence, and ambiguity are clues only.", [
    signal("dream_unreal_possibility", "DEFINING", ["dream", "dreaming", "imagines possible", "potential reality", "might exist", "wish made real", "unreal possibility", "alternate possibility"], ALL, "The fact directly concerns dreams or unreal potential.", "MYRRA_DREAM_POSSIBILITY"),
    signal("illusion_shape_possibility", "STRONG", ["illusion", "shapeshift", "shape-shift", "shape changing", "unfixed form", "contextual form", "unpredictable form", "mimics appearance"], [P, B, E, S, C], "Form or perception opens multiple possible realities.", "MYRRA_ILLUSION_SHAPE"),
    signal("ambiguity_potential", "MODERATE", ["between states", "uncertainty", "ambiguity", "reinvention", "variable form", "metamorphosis", "possibility"], [P, B, E, S], "Ambiguity or transformation suggests possibility without directly invoking dreams.", "MYRRA_AMBIGUITY_SUPPORT"),
    signal("curiosity_intelligence", "WEAK", ["curiosity", "curious", "intelligence", "problem solving", "problem-solving", "novelty"], [P, B], "Curiosity and intelligence are not near-equivalents of dreaming.", "MYRRA_CURIOSITY_CAP"),
  ]),
  "Orun-IX": profile("Orun-IX", "Timing, sequence, synchronization, mechanism, and causal order define the domain. Planned or centralized organization is supporting only.", [
    signal("causal_sequence", "DEFINING", ["causal sequence", "before and after", "cause and effect", "ordered sequence", "clockwork mechanism", "precise timing", "synchronized mechanism"], ALL, "The fact directly concerns causality, sequence, or mechanism.", "ORUN_CAUSAL_SEQUENCE"),
    signal("timed_synchrony", "STRONG", ["synchronized", "synchrony", "timed emergence", "circadian timing", "repetitive sequence", "periodic sequence", "scheduled", "mechanism"], [P, B, E, S, C], "Predictable timing or synchronization structures behavior.", "ORUN_TIMING_SYNCHRONY"),
    signal("predictable_process", "MODERATE", ["predictable process", "repetitive", "ritual sequence", "error correction", "measured", "routine"], [P, B, E, S], "Order is procedural rather than merely hierarchical.", "ORUN_PROCESS_SUPPORT"),
    signal("generic_order", "WEAK", ["ordered", "centralized", "planned", "discipline", "hierarchy", "organized"], [P, B, S], "Generic order, planning, or centralization is not time and causality.", "ORUN_GENERIC_ORDER_CAP"),
  ]),
  Vhalen: profile("Vhalen", "Absence, disappearance, endings, death, concealment, and shadow define the domain; nocturnality alone is weak.", [
    signal("ending_absence", "DEFINING", ["defined by absence", "final ending", "ceases to exist", "erased from", "returns to nothing", "boundary through absence", "death and disappearance"], ALL, "The fact directly embodies ending, emptiness, or defining absence.", "VHALEN_ENDING_ABSENCE"),
    signal("death_shadow_disappearance", "STRONG", ["undead", "death", "shadow", "vanishes", "disappears", "haunted", "specter", "wraith", "concealment", "emptiness"], [P, B, E, S, C], "Death, shadow, or disappearance is characteristic.", "VHALEN_SHADOW_DEATH"),
    signal("cryptic_boundary", "MODERATE", ["cryptic", "darkness", "secrecy", "ending", "absence", "guards remains", "cave darkness"], [P, B, E, S], "Concealment or darkness supports the domain.", "VHALEN_CONCEALMENT_SUPPORT"),
    signal("nocturnal_only", "WEAK", ["nocturnal", "night-active", "kills", "boundary", "black"], [B, E, S], "Night activity, predation, or coloration is not absence or endings.", "VHALEN_NIGHT_CAP"),
  ]),
  Asteriel: profile("Asteriel", "Cosmic structure, radiant order, universal balance, and coherent integration define the domain. Hierarchy alone is weak.", [
    signal("cosmic_integration", "DEFINING", ["cosmic order", "universal balance", "celestial geometry", "integrates conflicting forces", "coherent whole", "higher-order cosmic", "higher order cosmic"], ALL, "Conflicting elements are integrated into a coherent cosmic structure.", "ASTERIEL_COSMIC_INTEGRATION"),
    signal("radiant_higher_order", "STRONG", ["aether", "radiant order", "celestial structure", "geometric structure", "superorganism", "coordinated whole", "universal structure"], [P, B, E, S, C], "Higher-order or radiant organization is explicit.", "ASTERIEL_HIGHER_ORDER"),
    signal("complex_integration", "MODERATE", ["complex organization", "integrates", "symmetry", "geometric", "system balance", "eusocial coordination"], [P, B, E, S], "Complex integration supports but may not be cosmic.", "ASTERIEL_INTEGRATION_SUPPORT"),
    signal("hierarchy_only", "WEAK", ["hierarchy", "hierarchical", "authority", "centralized", "organized colony", "status"], [P, B, S], "Hierarchy alone is not cosmic order.", "ASTERIEL_HIERARCHY_CAP"),
  ]),
});

const FAMILY_AFFINITY_OVERRIDES: Readonly<Record<string, Readonly<Record<string, Omit<PersonalityFamilyAffinity, "deityName" | "family">>>>> = {
  Miren: { COMPASSION: { v2Strength: 62, tier: "STRONG", semanticJustification: "The family directly names compassion, but a family label does not prove costly compassion." }, CARE: { v2Strength: 40, tier: "MODERATE", semanticJustification: "Care supports compassion but may be ordinary parental or in-group care." }, MERCY: { v2Strength: 48, tier: "MODERATE", semanticJustification: "Mercy is close to compassion but may fit forgiveness more specifically." } },
  Darel: { COURAGE: { v2Strength: 58, tier: "STRONG", semanticJustification: "The family directly names courage, while the expression must still show action despite fear." }, RISK: { v2Strength: 30, tier: "MODERATE", semanticJustification: "Risk is supporting context, not courage without chosen action despite danger." }, FEAR: { v2Strength: 18, tier: "WEAK", semanticJustification: "Fear alone is not courage." } },
  Savael: { PATIENCE: { v2Strength: 60, tier: "STRONG", semanticJustification: "Patience is direct family support but not a substitute for active endurance." }, EQUANIMITY: { v2Strength: 38, tier: "MODERATE", semanticJustification: "Composure supports restraint but not duration." }, RESTRAINT: { v2Strength: 38, tier: "MODERATE", semanticJustification: "Restraint supports patience but may be situational." } },
  Elian: { HOPE: { v2Strength: 60, tier: "STRONG", semanticJustification: "Hope is direct family support; catastrophe and rebuilding remain defining." }, REPAIR: { v2Strength: 42, tier: "MODERATE", semanticJustification: "Repair supports renewal but may be routine maintenance." } },
  Namiya: { FORGIVENESS: { v2Strength: 62, tier: "STRONG", semanticJustification: "Forgiveness is direct support, while injury and accountability remain defining." }, MERCY: { v2Strength: 38, tier: "MODERATE", semanticJustification: "Mercy supports forgiveness without necessarily restoring a relationship." } },
  Oren: { TRUTH: { v2Strength: 62, tier: "STRONG", semanticJustification: "Truth is direct support, but costly candor remains defining." }, AUTHENTICITY: { v2Strength: 40, tier: "MODERATE", semanticJustification: "Authenticity supports honesty without proving truthful disclosure." }, ACCOUNTABILITY: { v2Strength: 38, tier: "MODERATE", semanticJustification: "Accountability supports correction and integrity." } },
  Tavai: { EMPATHY: { v2Strength: 62, tier: "STRONG", semanticJustification: "Empathy is direct family support, while observable perspective-taking remains defining." }, PERSPECTIVE: { v2Strength: 58, tier: "STRONG", semanticJustification: "Perspective strongly narrows the domain but can describe vantage rather than another mind." }, COOPERATION: { v2Strength: 20, tier: "WEAK", semanticJustification: "Teamwork is not equivalent to empathy." } },
  Varek: { PERSEVERANCE: { v2Strength: 52, tier: "MODERATE", semanticJustification: "Perseverance is close, but Varek requires setback, failure, or adversity." }, DUTY: { v2Strength: 46, tier: "MODERATE", semanticJustification: "Duty supports resolve when maintained through adversity." }, DISCIPLINE: { v2Strength: 30, tier: "MODERATE", semanticJustification: "Discipline alone does not prove persistence through failure." } },
  Selen: { PLEASURE: { v2Strength: 58, tier: "STRONG", semanticJustification: "Pleasure directly supports joy but may be individual rather than communal." }, EXPRESSION: { v2Strength: 34, tier: "MODERATE", semanticJustification: "Expression supports joy only when playful, affectionate, or celebratory." } },
  Lunessa: { CHANGE: { v2Strength: 28, tier: "MODERATE", semanticJustification: "Change is a phase clue, not evidence of recurrence by itself." }, AMBIGUITY: { v2Strength: 16, tier: "WEAK", semanticJustification: "Ambiguity is not necessarily cyclical." } },
  Damor: { STEWARDSHIP: { v2Strength: 54, tier: "MODERATE", semanticJustification: "Stewardship supports habitat creation but does not guarantee ecosystem engineering." } },
  Kharad: { LAND: { v2Strength: 30, tier: "MODERATE", semanticJustification: "Land affinity supports Earth, but does not itself establish stone, weight, or permanence." }, BOUNDARIES: { v2Strength: 12, tier: "WEAK", semanticJustification: "Territorial boundaries are not physical foundations." } },
  Aveli: { AUTONOMY: { v2Strength: 34, tier: "MODERATE", semanticJustification: "Autonomy supports freedom but is not air, breath, or flight-dominant ecology." }, REACTANCE: { v2Strength: 20, tier: "WEAK", semanticJustification: "Resistance to control is contextual freedom evidence." } },
  Myrra: { AMBIGUITY: { v2Strength: 28, tier: "MODERATE", semanticJustification: "Ambiguity is an affinity clue, not a direct equivalence to dreaming or possibility." }, CURIOSITY: { v2Strength: 16, tier: "WEAK", semanticJustification: "Curiosity and problem-solving are not dreaming." }, NOVELTY: { v2Strength: 18, tier: "WEAK", semanticJustification: "Novelty does not itself imply unreal potential." } },
  "Orun-IX": { CONFORMITY: { v2Strength: 24, tier: "WEAK", semanticJustification: "Conformity is generic order, not timing or causality." }, DISCIPLINE: { v2Strength: 22, tier: "WEAK", semanticJustification: "Discipline supports repeatability without proving sequence." }, PERFECTION: { v2Strength: 22, tier: "WEAK", semanticJustification: "Perfection may imply precision but not causal ordering." } },
  Vhalen: { MORTALITY: { v2Strength: 54, tier: "MODERATE", semanticJustification: "Mortality closely supports endings but does not always embody absence." }, GRIEF: { v2Strength: 38, tier: "MODERATE", semanticJustification: "Grief reflects an absence left by ending." }, SECRECY: { v2Strength: 28, tier: "MODERATE", semanticJustification: "Secrecy supports concealment but not death or endings." } },
  Asteriel: { HIERARCHY: { v2Strength: 18, tier: "WEAK", semanticJustification: "Hierarchy alone is not coherent cosmic integration." }, PERFECTION: { v2Strength: 30, tier: "MODERATE", semanticJustification: "Perfection supports ideal order without proving cosmic structure." }, COLLECTIVE_MEMORY: { v2Strength: 24, tier: "WEAK", semanticJustification: "Collective memory is organized continuity, not necessarily cosmic order." } },
};

export function calibratePersonalityFamily(deityName: string, family: string, v1Strength: number): PersonalityFamilyAffinity {
  const override = FAMILY_AFFINITY_OVERRIDES[deityName]?.[family];
  if (override) return { deityName, family, ...override };
  const v2Strength = v1Strength >= 90 ? 52 : v1Strength >= 75 ? 40 : v1Strength >= 60 ? 30 : v1Strength >= 45 ? 22 : 14;
  const tier: PersonalityFamilyAffinity["tier"] = v2Strength >= 55 ? "STRONG" : v2Strength >= 28 ? "MODERATE" : "WEAK";
  return {
    deityName,
    family,
    v2Strength,
    tier,
    semanticJustification: `${family} is calibrated as ${tier.toLowerCase()} personality context for ${deityName}; the family label narrows concepts but cannot replace direct Breed behavior or text.`,
  };
}

function compact(value: string): string { return value.replace(/\s+/g, " ").trim(); }
function normalized(value: string): string { return compact(value.replaceAll("_", " ").replace(/[’]/g, "'")).toLowerCase(); }
function rounded(value: number, places = 3): number { const scale = 10 ** places; return Math.round(value * scale) / scale; }
function clamp(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, value)); }
function tierRank(tier: EvidenceTier): number { return ({ CONTRADICTORY: -1, WEAK: 1, MODERATE: 2, STRONG: 3, DEFINING: 4 })[tier]; }
function tierBase(tier: EvidenceTier): number { return ({ DEFINING: 88, STRONG: 66, MODERATE: 38, WEAK: 16, CONTRADICTORY: -45 })[tier]; }

function grouped<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) { const value = key(row); const group = result.get(value) ?? []; group.push(row); result.set(value, group); }
  return result;
}

const termPatternCache = new Map<string, RegExp | string>();
function includesTerm(text: string, term: string): boolean {
  const candidate = normalized(term);
  if (!candidate) return false;
  let matcher = termPatternCache.get(candidate);
  if (!matcher) {
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    matcher = !/[\s'-]/.test(candidate) ? new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`, "i") : candidate;
    termPatternCache.set(candidate, matcher);
  }
  return typeof matcher === "string" ? text.includes(matcher) : matcher.test(text);
}

function factHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

interface CanonicalFact {
  sourceRecordId: string;
  sourceScope: EvidenceFragment["sourceScope"];
  fieldPath: string;
  sourceFactId: string;
  text: string;
  normalizedText: string;
  authorityWeight: number;
  axes: ScoreAxis[];
  basis: string[];
}

function canonicalFacts(profileValue: BreedEvidenceProfile): CanonicalFact[] {
  const facts = new Map<string, CanonicalFact>();
  for (const axis of SCORE_AXES) for (const fragment of profileValue.fragments[axis]) {
    const text = compact(fragment.text);
    const key = `${fragment.sourceRecordId}\0${fragment.fieldPath}\0${normalized(text)}`;
    const found = facts.get(key);
    if (found) {
      if (!found.axes.includes(axis)) found.axes.push(axis);
      if (!found.basis.includes(fragment.basis)) found.basis.push(fragment.basis);
      found.authorityWeight = Math.max(found.authorityWeight, fragment.authorityWeight);
      continue;
    }
    facts.set(key, {
      sourceRecordId: fragment.sourceRecordId,
      sourceScope: fragment.sourceScope,
      fieldPath: fragment.fieldPath,
      sourceFactId: `${fragment.sourceRecordId}:${fragment.fieldPath}:${factHash(normalized(text))}`,
      text,
      normalizedText: normalized(text),
      authorityWeight: fragment.authorityWeight,
      axes: [axis],
      basis: [fragment.basis],
    });
  }
  return [...facts.values()].sort((left, right) => left.sourceFactId.localeCompare(right.sourceFactId));
}

interface RawUnit {
  fact: CanonicalFact;
  clusterId: string;
  tier: EvidenceTier;
  axes: ScoreAxis[];
  rawLexicalMatches: string[];
  rawContribution: number;
  rationale: string;
  calibrationRules: string[];
}

function rawUnits(profileValue: BreedEvidenceProfile, deityProfile: DeityEvidenceProfile, familyAffinity?: PersonalityFamilyAffinity): RawUnit[] {
  const facts = canonicalFacts(profileValue);
  const units = new Map<string, RawUnit>();
  for (const fact of facts) {
    if (fact.fieldPath === "v4Effective.personalityId") continue;
    for (const definition of deityProfile.signals) {
      const matches = definition.terms.filter((term) => includesTerm(fact.normalizedText, term));
      if (!matches.length) continue;
      const axes = definition.axes.filter((axis) => fact.axes.includes(axis));
      if (!axes.length) continue;
      const contextOnly = /canonicalPayload\.(?:terrain|food)(?:Broad|Specific)/.test(fact.fieldPath) || fact.basis.includes("INHERITED_CONTEXT");
      const effectiveTier = contextOnly && tierRank(definition.tier) > tierRank("MODERATE") ? "MODERATE" : definition.tier;
      const key = `${fact.sourceFactId}\0${definition.clusterId}`;
      const existing = units.get(key);
      if (existing) {
        existing.rawLexicalMatches = [...new Set([...existing.rawLexicalMatches, ...matches])].sort();
        existing.axes = [...new Set([...existing.axes, ...axes])].sort((a, b) => SCORE_AXES.indexOf(a) - SCORE_AXES.indexOf(b));
        if (tierRank(effectiveTier) > tierRank(existing.tier)) { existing.tier = effectiveTier; existing.rawContribution = tierBase(effectiveTier); existing.rationale = definition.rationale; }
        existing.calibrationRules = [...new Set([...existing.calibrationRules, definition.calibrationRule])].sort();
      } else {
        units.set(key, { fact, clusterId: definition.clusterId, tier: effectiveTier, axes: [...axes], rawLexicalMatches: [...matches].sort(), rawContribution: tierBase(effectiveTier), rationale: definition.rationale, calibrationRules: [definition.calibrationRule, ...(contextOnly ? ["CONTEXT_FIELD_TIER_CAP"] : [])] });
      }
    }
  }
  if (familyAffinity && profileValue.personalityId && profileValue.personalityFamily === familyAffinity.family) {
    const fact = facts.find((row) => row.fieldPath === "v4Effective.personalityId") ?? {
      sourceRecordId: profileValue.breedId, sourceScope: "BREED" as const, fieldPath: "v4Effective.personalityId",
      sourceFactId: `${profileValue.breedId}:v4Effective.personalityId:${factHash(profileValue.personalityId)}`,
      text: profileValue.personalityId, normalizedText: normalized(profileValue.personalityId), authorityWeight: 1,
      axes: [P, S], basis: ["PERSONALITY"],
    };
    units.set(`${fact.sourceFactId}\0personality_family_affinity`, {
      fact,
      clusterId: "personality_family_affinity",
      tier: familyAffinity.tier,
      axes: [P, S].filter((axis) => fact.axes.includes(axis)),
      rawLexicalMatches: [profileValue.personalityFamily, profileValue.personalityId],
      rawContribution: familyAffinity.v2Strength,
      rationale: familyAffinity.semanticJustification,
      calibrationRules: [`PERSONALITY_FAMILY_${profileValue.personalityFamily}_${deityProfile.deityName}`],
    });
  }
  const result = [...units.values()];
  const strongestByFact = new Map<string, number>();
  for (const unit of result) strongestByFact.set(unit.fact.sourceFactId, Math.max(strongestByFact.get(unit.fact.sourceFactId) ?? -1, tierRank(unit.tier)));
  return result.filter((unit) => unit.tier !== "WEAK" || (strongestByFact.get(unit.fact.sourceFactId) ?? 0) <= tierRank("WEAK"));
}

export type PersonalityCalibrationLookup = ReadonlyMap<string, PersonalityFamilyAffinity>;
export type SignalFrequencyLookup = ReadonlyMap<string, SignalFrequencyRow>;

function affinityKey(deityName: string, family: string): string { return `${deityName}\0${family}`; }
function frequencyKey(deityName: string, clusterId: string): string { return `${deityName}\0${clusterId}`; }

export function buildSignalFrequencyAudit(profiles: readonly BreedEvidenceProfile[], calibrations: PersonalityCalibrationLookup): SignalFrequencyRow[] {
  const counts = new Map<string, Set<string>>();
  for (const profileValue of profiles) for (const deity of DEITIES) {
    const deityProfile = DEITY_EVIDENCE_PROFILES_V2[deity.deityName];
    const family = profileValue.personalityFamily ? calibrations.get(affinityKey(deity.deityName, profileValue.personalityFamily)) : undefined;
    for (const unit of rawUnits(profileValue, deityProfile, family)) {
      const key = frequencyKey(deity.deityName, unit.clusterId);
      const breeds = counts.get(key) ?? new Set<string>(); breeds.add(profileValue.breedId); counts.set(key, breeds);
    }
  }
  const total = profiles.length;
  return DEITIES.flatMap((deity) => {
    const deityProfile = DEITY_EVIDENCE_PROFILES_V2[deity.deityName];
    const clusterIds = [...new Set([...deityProfile.signals.map((row) => row.clusterId), "personality_family_affinity"])].sort();
    return clusterIds.map((semanticCluster) => {
      const frequency = counts.get(frequencyKey(deity.deityName, semanticCluster))?.size ?? 0;
      const idf = Math.log((total + 1) / (frequency + 1)) / Math.log(total + 1);
      const definitions = deityProfile.signals.filter((row) => row.clusterId === semanticCluster);
      const strongestTier = semanticCluster === "personality_family_affinity" ? "MODERATE" : definitions.sort((a, b) => tierRank(b.tier) - tierRank(a.tier))[0]?.tier ?? "WEAK";
      const lowerBound = strongestTier === "DEFINING" || strongestTier === "STRONG" ? 0.85 : 0.72;
      return {
        deityName: deity.deityName,
        semanticCluster,
        breedFrequency: frequency,
        corpusShare: rounded(frequency / total, 6),
        specificityFactor: rounded(clamp(0.72 + 0.53 * idf, lowerBound, 1.25), 6),
        strongestTier,
        calibrationRules: semanticCluster === "personality_family_affinity" ? ["PERSONALITY_FAMILY_CALIBRATION_V2"] : [...new Set(definitions.map((row) => row.calibrationRule))].sort(),
      };
    });
  });
}

function axisAvailability(profileValue: BreedEvidenceProfile): Record<ScoreAxis, boolean> {
  return {
    PERSONALITY_ALIGNMENT: Boolean(profileValue.personalityId),
    BEHAVIOR_ALIGNMENT: profileValue.fragments.BEHAVIOR_ALIGNMENT.length > 0,
    ECOLOGICAL_ALIGNMENT: profileValue.ecologyAvailable,
    SYMBOLIC_ALIGNMENT: profileValue.fragments.SYMBOLIC_ALIGNMENT.length > 0,
    CANONICAL_TEXT_SUPPORT: profileValue.fragments.CANONICAL_TEXT_SUPPORT.length > 0,
  };
}

function evidenceClusters(units: RawUnit[], deityName: string, frequencies: SignalFrequencyLookup): SemanticEvidenceCluster[] {
  const positiveUnits = units.filter((unit) => unit.tier !== "CONTRADICTORY");
  const factConceptOrder = new Map<string, number>();
  for (const [factId, factUnits] of grouped(positiveUnits, (unit) => unit.fact.sourceFactId)) {
    factUnits.sort((a, b) => b.rawContribution - a.rawContribution || a.clusterId.localeCompare(b.clusterId));
    factUnits.forEach((unit, index) => factConceptOrder.set(`${factId}\0${unit.clusterId}`, index));
  }
  const clusterOrder = new Map<string, number>();
  for (const [clusterId, clusterUnits] of grouped(positiveUnits, (unit) => unit.clusterId)) {
    clusterUnits.sort((a, b) => b.rawContribution * b.fact.authorityWeight - a.rawContribution * a.fact.authorityWeight || a.fact.sourceFactId.localeCompare(b.fact.sourceFactId));
    clusterUnits.forEach((unit, index) => clusterOrder.set(`${clusterId}\0${unit.fact.sourceFactId}`, index));
  }
  const repeatedFactors = [1, 0.65, 0.4, 0.25, 0.15];
  const factConceptFactors = [1, 0.7, 0.45, 0.3, 0.2];
  const axisFactors = [1, 0.55, 0.32, 0.18, 0.1];
  return units.map((unit) => {
    const specificityFactor = frequencies.get(frequencyKey(deityName, unit.clusterId))?.specificityFactor ?? 1;
    const clusterIndex = clusterOrder.get(`${unit.clusterId}\0${unit.fact.sourceFactId}`) ?? 0;
    const factConceptIndex = factConceptOrder.get(`${unit.fact.sourceFactId}\0${unit.clusterId}`) ?? 0;
    const repeatedClusterFactor = unit.tier === "CONTRADICTORY" ? 1 : repeatedFactors[Math.min(clusterIndex, repeatedFactors.length - 1)]!;
    const crossFactConceptFactor = unit.tier === "CONTRADICTORY" ? 1 : factConceptFactors[Math.min(factConceptIndex, factConceptFactors.length - 1)]!;
    const orderedAxes = [...unit.axes].sort((left, right) => AXIS_WEIGHTS[right] - AXIS_WEIGHTS[left] || SCORE_AXES.indexOf(left) - SCORE_AXES.indexOf(right));
    const crossAxisFactors: Partial<Record<ScoreAxis, number>> = {};
    const effectiveContributions: Partial<Record<ScoreAxis, number>> = {};
    orderedAxes.forEach((axis, index) => {
      const crossAxisFactor = axisFactors[Math.min(index, axisFactors.length - 1)]!;
      crossAxisFactors[axis] = crossAxisFactor;
      effectiveContributions[axis] = rounded(unit.rawContribution * specificityFactor * unit.fact.authorityWeight * repeatedClusterFactor * crossFactConceptFactor * crossAxisFactor);
    });
    return {
      sourceRecordId: unit.fact.sourceRecordId,
      sourceScope: unit.fact.sourceScope,
      fieldPath: unit.fact.fieldPath,
      sourceFactId: unit.fact.sourceFactId,
      excerpt: unit.fact.text.slice(0, 360),
      semanticCluster: unit.clusterId,
      strongestTier: unit.tier,
      axesInformed: orderedAxes,
      rawLexicalMatches: unit.rawLexicalMatches,
      rawSemanticContribution: unit.rawContribution,
      specificityFactor,
      authorityFactor: unit.fact.authorityWeight,
      repeatedClusterFactor,
      crossFactConceptFactor,
      crossAxisFactors,
      effectiveContributions,
      effectiveScoredContribution: rounded(Object.values(effectiveContributions).reduce((sum, value) => sum + (value ?? 0), 0)),
      basis: unit.fact.basis,
      calibrationRules: unit.calibrationRules,
      rationale: unit.rationale,
    };
  }).sort((a, b) => b.effectiveScoredContribution - a.effectiveScoredContribution || a.sourceFactId.localeCompare(b.sourceFactId) || a.semanticCluster.localeCompare(b.semanticCluster));
}

function componentScore(axis: ScoreAxis, clusters: readonly SemanticEvidenceCluster[]): number {
  const positiveByCluster = new Map<string, number>();
  let contradiction = 0;
  for (const cluster of clusters) {
    const contribution = cluster.effectiveContributions[axis] ?? 0;
    if (cluster.strongestTier === "CONTRADICTORY") contradiction += Math.abs(contribution);
    else positiveByCluster.set(cluster.semanticCluster, Math.min(100, (positiveByCluster.get(cluster.semanticCluster) ?? 0) + contribution));
  }
  const positive = 100 * (1 - [...positiveByCluster.values()].reduce((remaining, value) => remaining * (1 - Math.min(95, value) / 100), 1));
  return rounded(clamp(positive - Math.min(40, contradiction), 0, 100));
}

export function assessAllDeitiesV2(profileValue: BreedEvidenceProfile, frequencies: SignalFrequencyLookup, calibrations: PersonalityCalibrationLookup): CandidateAssessmentV2[] {
  if (DEITIES.length !== 27) throw new Error(`Canonical deity count must be 27; found ${DEITIES.length}`);
  const pantheons = new Map<Pantheon, number>();
  for (const deity of DEITIES) pantheons.set(deity.pantheon, (pantheons.get(deity.pantheon) ?? 0) + 1);
  if ([...pantheons.values()].some((count) => count !== 9)) throw new Error("The frozen deity authority must contain nine deities in each pantheon");
  const availability = axisAvailability(profileValue);
  const availableWeight = SCORE_AXES.filter((axis) => availability[axis]).reduce((sum, axis) => sum + AXIS_WEIGHTS[axis], 0);
  if (!availableWeight) throw new Error(`${profileValue.breedId} has no scoreable evidence axes`);
  const effectiveWeights = Object.fromEntries(SCORE_AXES.map((axis) => [axis, availability[axis] ? rounded(AXIS_WEIGHTS[axis] / availableWeight, 6) : 0])) as Record<ScoreAxis, number>;
  return DEITIES.map((deity, canonicalIndex) => {
    const deityProfile = DEITY_EVIDENCE_PROFILES_V2[deity.deityName];
    if (!deityProfile) throw new Error(`Missing V2 evidence profile for ${deity.deityName}`);
    const family = profileValue.personalityFamily ? calibrations.get(affinityKey(deity.deityName, profileValue.personalityFamily)) : undefined;
    const clusters = evidenceClusters(rawUnits(profileValue, deityProfile, family), deity.deityName, frequencies);
    const componentScores = Object.fromEntries(SCORE_AXES.map((axis) => [axis, availability[axis] ? componentScore(axis, clusters) : 0])) as Record<ScoreAxis, number>;
    const weightedScoreExact = rounded(SCORE_AXES.reduce((sum, axis) => sum + componentScores[axis] * effectiveWeights[axis], 0));
    const positive = clusters.filter((cluster) => cluster.strongestTier !== "CONTRADICTORY" && cluster.effectiveScoredContribution >= 4);
    const direct = positive.filter((cluster) => cluster.sourceScope === "BREED");
    const directStrong = direct.filter((cluster) => cluster.strongestTier === "DEFINING" || cluster.strongestTier === "STRONG");
    const fields = new Set(positive.map((cluster) => `${cluster.sourceRecordId}\0${cluster.fieldPath}`));
    const perField = [...grouped(positive, (cluster) => `${cluster.sourceRecordId}\0${cluster.fieldPath}`).values()].map((rows) => rows.reduce((sum, row) => sum + row.effectiveScoredContribution, 0));
    const totalContribution = perField.reduce((sum, value) => sum + value, 0);
    return {
      ...deity,
      componentScores,
      axisAvailability: { ...availability },
      effectiveWeights: { ...effectiveWeights },
      weightedScoreExact,
      score: Math.round(weightedScoreExact),
      semanticEvidenceClusters: clusters,
      definingClusterCount: new Set(positive.filter((cluster) => cluster.strongestTier === "DEFINING").map((cluster) => cluster.semanticCluster)).size,
      strongClusterCount: new Set(positive.filter((cluster) => cluster.strongestTier === "STRONG").map((cluster) => cluster.semanticCluster)).size,
      moderateClusterCount: new Set(positive.filter((cluster) => cluster.strongestTier === "MODERATE").map((cluster) => cluster.semanticCluster)).size,
      contradictoryClusterCount: new Set(clusters.filter((cluster) => cluster.strongestTier === "CONTRADICTORY").map((cluster) => cluster.semanticCluster)).size,
      independentSemanticClusterCount: new Set(positive.map((cluster) => cluster.semanticCluster)).size,
      independentSourceFactCount: new Set(positive.map((cluster) => cluster.sourceFactId)).size,
      directBreedClusterCount: new Set(direct.map((cluster) => cluster.semanticCluster)).size,
      directBreedDefiningOrStrongCount: new Set(directStrong.map((cluster) => cluster.semanticCluster)).size,
      sourceFieldCount: fields.size,
      singleFieldDependence: rounded(totalContribution ? Math.max(0, ...perField) / totalContribution : 1, 6),
      calibrationRules: [...new Set(clusters.flatMap((cluster) => cluster.calibrationRules))].sort(),
      canonicalIndex,
    };
  }).sort((left, right) => right.weightedScoreExact - left.weightedScoreExact || SCORE_AXES.map((axis) => right.componentScores[axis] - left.componentScores[axis]).find((difference) => difference !== 0) || left.canonicalIndex - right.canonicalIndex)
    .map(({ canonicalIndex: _canonicalIndex, ...candidate }) => candidate);
}

function confidenceBand(score: number, margin: number): Confidence {
  if (score >= 75 && margin >= 18) return "VERY_HIGH";
  if (score >= 60 && margin >= 10) return "HIGH";
  if (score >= 42 && margin >= 5) return "MEDIUM";
  return "LOW";
}

export function judgeConfidenceV2(profileValue: BreedEvidenceProfile, candidates: readonly CandidateAssessmentV2[]): ConfidenceAssessmentV2 {
  const winner = candidates[0]; const runner = candidates[1];
  if (!winner || !runner) throw new Error(`${profileValue.breedId} lacks two candidates`);
  const margin = rounded(winner.weightedScoreExact - runner.weightedScoreExact);
  const inputs = {
    independentSemanticClusters: winner.independentSemanticClusterCount,
    independentSourceFacts: winner.independentSourceFactCount,
    definingClusters: winner.definingClusterCount,
    strongClusters: winner.strongClusterCount,
    directBreedClusters: winner.directBreedClusterCount,
    directBreedDefiningOrStrong: winner.directBreedDefiningOrStrongCount,
    sourceFields: winner.sourceFieldCount,
    singleFieldDependence: winner.singleFieldDependence,
    contradictoryClusters: winner.contradictoryClusterCount,
    topTwoMargin: margin,
  };
  const hasDefining = inputs.definingClusters > 0;
  const strongOrDefining = inputs.definingClusters + inputs.strongClusters;
  const dependent = inputs.singleFieldDependence >= 0.72;
  const directness: ConfidenceAssessmentV2["evidenceDirectness"] = hasDefining && inputs.directBreedDefiningOrStrong > 0 ? "DEFINING" : inputs.directBreedDefiningOrStrong > 0 ? "DIRECT" : inputs.directBreedClusters >= 2 ? "PARTIAL" : "INDIRECT";
  const quality: ConfidenceAssessmentV2["evidenceQuality"] = strongOrDefining >= 2 && inputs.independentSourceFacts >= 3 ? "STRONG" : strongOrDefining >= 1 || inputs.independentSemanticClusters >= 3 ? "MODERATE" : "WEAK";
  const consistency: ConfidenceAssessmentV2["evidenceConsistency"] = margin < 1.5 ? "INSEPARABLE" : inputs.contradictoryClusters > 0 || margin < 4 ? "MIXED" : "CONVERGENT";
  const suggestedConfidence = confidenceBand(winner.weightedScoreExact, margin);
  const missingEvidence: string[] = [];
  const definingEvidenceRequired = new Set(["Miren", "Darel", "Tavai", "Varek"]).has(winner.deityName);
  const onlyWeakEvidence = strongOrDefining === 0 && winner.moderateClusterCount === 0;
  if (!inputs.directBreedClusters) missingEvidence.push("No direct Breed-level semantic cluster materially supports the leader.");
  if (!strongOrDefining) missingEvidence.push("No STRONG or DEFINING evidence cluster supports the leader.");
  if (definingEvidenceRequired && !strongOrDefining) missingEvidence.push(`${winner.deityName}'s generic supporting cues cannot independently become accepted authority without STRONG or DEFINING domain evidence.`);
  if (onlyWeakEvidence) missingEvidence.push("The leader is supported only by WEAK contextual evidence.");
  if (inputs.independentSemanticClusters < 2) missingEvidence.push("The leader depends on fewer than two independent semantic clusters.");
  if (dependent) missingEvidence.push(`The leader depends ${(inputs.singleFieldDependence * 100).toFixed(1)}% on one source field.`);
  if (margin < 1.5) missingEvidence.push(`The top-two margin is only ${margin.toFixed(3)} points.`);
  if (!profileValue.personalityId) missingEvidence.push("No canonical V4 personality assignment exists for this PET Breed.");

  let confidence: Confidence;
  if (!inputs.directBreedClusters || winner.weightedScoreExact < 8 || margin < 1.5 && !hasDefining || margin < 0.75 || definingEvidenceRequired && !strongOrDefining || onlyWeakEvidence) confidence = "REVIEW_REQUIRED";
  else if (hasDefining && inputs.independentSemanticClusters >= 4 && inputs.independentSourceFacts >= 4 && inputs.sourceFields >= 3 && !dependent && margin >= 14 && !inputs.contradictoryClusters) confidence = "VERY_HIGH";
  else if (strongOrDefining >= 2 && inputs.independentSemanticClusters >= 3 && inputs.independentSourceFacts >= 3 && inputs.sourceFields >= 2 && !dependent && margin >= 7) confidence = "HIGH";
  else if (strongOrDefining >= 1 && inputs.independentSemanticClusters >= 2 && inputs.independentSourceFacts >= 2 && margin >= 3 && inputs.singleFieldDependence < 0.86) confidence = "MEDIUM";
  else confidence = "LOW";

  const confidenceRationale = confidence === "REVIEW_REQUIRED"
    ? `Canonical evidence does not resolve ${winner.deityName} over ${runner.deityName}: ${missingEvidence.join(" ")}`
    : `${quality.toLowerCase()} ${directness.toLowerCase()} evidence contains ${inputs.independentSemanticClusters} independent semantic clusters across ${inputs.independentSourceFacts} source facts and ${inputs.sourceFields} source fields; ${winner.deityName} leads ${runner.deityName} by ${margin.toFixed(3)} points with ${(inputs.singleFieldDependence * 100).toFixed(1)}% maximum single-field dependence.`;
  const confidenceOverrideReason = confidence === suggestedConfidence ? null : `Numeric guidance suggested ${suggestedConfidence}, but evidence-cluster judgment requires ${confidence}: ${confidenceRationale}`;
  return { suggestedConfidence, confidence, confidenceRationale, confidenceOverrideReason, evidenceQuality: quality, evidenceDirectness: directness, evidenceBreadth: inputs.independentSemanticClusters, evidenceConsistency: consistency, missingEvidence, confidenceInputs: inputs };
}

export function deityReferenceV2(candidate: CandidateAssessmentV2): DeityAuthorityRecord {
  const authority = DEITIES.find((deity) => deity.deityName === candidate.deityName);
  if (!authority) throw new Error(`Unknown deity ${candidate.deityName}`);
  return { ...authority };
}

export function calibrationLookup(rows: readonly PersonalityFamilyAffinity[]): Map<string, PersonalityFamilyAffinity> {
  return new Map(rows.map((row) => [affinityKey(row.deityName, row.family), row]));
}

export function frequencyLookup(rows: readonly SignalFrequencyRow[]): Map<string, SignalFrequencyRow> {
  return new Map(rows.map((row) => [frequencyKey(row.deityName, row.semanticCluster), row]));
}
