export const BREED_DEITY_AFFINITY_SCHEMA_VERSION = "echoes-breed-deity-affinity-v1" as const;
export const BREED_DEITY_CLASSIFICATION_RULES_VERSION = "BREED_PRIMARY_DEITY_CLASSIFICATION_V1_2026-08-28" as const;

export const SCORE_AXES = [
  "PERSONALITY_ALIGNMENT",
  "BEHAVIOR_ALIGNMENT",
  "ECOLOGICAL_ALIGNMENT",
  "SYMBOLIC_ALIGNMENT",
  "CANONICAL_TEXT_SUPPORT",
] as const;

export type ScoreAxis = typeof SCORE_AXES[number];
export type PopulationKind = "HUMAN" | "BEAST" | "PET" | "MYTHOS";
export type Pantheon = "NINEFOLD_HEART" | "NINEFOLD_WILD" | "NINEFOLD_VEIL";
export type Confidence = "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW" | "REVIEW_REQUIRED";
export type ClassificationStatus = "CLASSIFIED" | "REVIEW_REQUIRED";
export type EvidenceScope = "BREED" | "SPECIES" | "CULTURE";

export const AXIS_WEIGHTS: Readonly<Record<ScoreAxis, number>> = {
  PERSONALITY_ALIGNMENT: 30,
  BEHAVIOR_ALIGNMENT: 25,
  ECOLOGICAL_ALIGNMENT: 20,
  SYMBOLIC_ALIGNMENT: 15,
  CANONICAL_TEXT_SUPPORT: 10,
};

export interface DeityAuthorityRecord {
  deityName: string;
  deityTitle: string;
  pantheon: Pantheon;
  domain: string;
  domainName: string;
  meaning: string;
  backstory: string;
}

export const DEITIES: readonly DeityAuthorityRecord[] = [
  { deityName: "Miren", deityTitle: "the Open Hand", pantheon: "NINEFOLD_HEART", domain: "COMPASSION", domainName: "Compassion", meaning: "Compassion through meaningful personal cost, generosity, care, protection, mercy, feeding and supporting others, and concern for suffering.", backstory: "Miren fed strangers during famine after her own household began rationing food; her doctrine makes costly compassion sacred." },
  { deityName: "Darel", deityTitle: "the Unshaken", pantheon: "NINEFOLD_HEART", domain: "COURAGE", domainName: "Courage", meaning: "Acting despite fear; bravery is willingness to proceed while afraid rather than absence of fear.", backstory: "Darel openly feared battle but repeatedly acted while afraid, making courage the mastery of fear." },
  { deityName: "Savael", deityTitle: "the Long Breath", pantheon: "NINEFOLD_HEART", domain: "PATIENCE", domainName: "Patience", meaning: "Active endurance, reconciliation over long periods, restraint, persistence without escalation, and willingness to wait and continue.", backstory: "Savael spent decades reconciling communities trapped in an inherited feud; patience is active endurance." },
  { deityName: "Elian", deityTitle: "the Returning Light", pantheon: "NINEFOLD_HEART", domain: "HOPE", domainName: "Hope", meaning: "Rebuilding after destruction, optimism after catastrophe, renewed effort, and belief in future possibility.", backstory: "Elian rebuilt the same destroyed settlement three times and refused to call any rebuilding wasted." },
  { deityName: "Namiya", deityTitle: "the Unclosed Door", pantheon: "NINEFOLD_HEART", domain: "FORGIVENESS", domainName: "Forgiveness", meaning: "Reconciliation after genuine injury without erasing harm or accountability.", backstory: "Namiya reconciled with the person responsible for her family's ruin without pretending the wrong had never occurred." },
  { deityName: "Oren", deityTitle: "the Clear Voice", pantheon: "NINEFOLD_HEART", domain: "HONESTY", domainName: "Honesty", meaning: "Truthfulness when personally costly, candor, transparency, integrity, and resistance to convenient deception.", backstory: "Oren exposed a lie that benefited his own people and lost his reputation for doing so." },
  { deityName: "Tavai", deityTitle: "Who Listens Twice", pantheon: "NINEFOLD_HEART", domain: "EMPATHY", domainName: "Empathy", meaning: "Accurate perspective-taking, social perception, mediation, emotional attunement, and understanding another viewpoint.", backstory: "Tavai mediated by stating an opponent's grievance so accurately that the opponent felt understood before negotiation." },
  { deityName: "Varek", deityTitle: "the Last Standing", pantheon: "NINEFOLD_HEART", domain: "RESOLVE", domainName: "Resolve", meaning: "Perseverance through repeated failure, tenacity, duty, grit, and refusal to abandon meaningful work.", backstory: "Varek repeatedly failed at the work for which he is remembered, but failure never made the work cease to matter." },
  { deityName: "Selen", deityTitle: "the Laughing Flame", pantheon: "NINEFOLD_HEART", domain: "JOY", domainName: "Joy", meaning: "Celebration, affection, humor, music, festivals, pleasure, play, communal happiness, and reasons for living.", backstory: "Selen taught that survival is insufficient if people forget why survival matters." },
  { deityName: "Solkar", deityTitle: "the First Warmth", pantheon: "NINEFOLD_WILD", domain: "SUN_AND_DAYLIGHT", domainName: "Sun & Daylight", meaning: "Daylight, warmth, solar activity, diurnal life, exposure, illumination, awakening, and life-giving heat.", backstory: "Solkar carried the first spark of dawn through the motionless night and restored daylight." },
  { deityName: "Lunessa", deityTitle: "the Many-Faced", pantheon: "NINEFOLD_WILD", domain: "THE_MOONS_AND_THEIR_PHASES", domainName: "The Moons & Their Phases", meaning: "Cycles, waxing and waning, nocturnal rhythms, periodic transformation, return after disappearance, and moon-linked activity.", backstory: "Lunessa taught the darkened moons that disappearance is part of returning." },
  { deityName: "Vespera", deityTitle: "the Thousand-Eyed", pantheon: "NINEFOLD_WILD", domain: "STARS_AND_NAVIGATION", domainName: "Stars & Navigation", meaning: "Orientation, wayfinding, celestial navigation, migration guidance, homing, and long-distance spatial awareness.", backstory: "Vespera scattered reflected lights across darkness so migrating creatures could find home." },
  { deityName: "Voltar", deityTitle: "the Sudden Current", pantheon: "NINEFOLD_WILD", domain: "STORMS_AND_LIGHTNING", domainName: "Storms & Lightning", meaning: "Electricity, violent atmospheric energy, thunder, storms, charged activity, disruption, and abrupt natural force.", backstory: "Voltar awakened the stagnant atmosphere with the first violent discharge." },
  { deityName: "Marea", deityTitle: "the Deep Singer", pantheon: "NINEFOLD_WILD", domain: "OCEAN_AND_TIDES", domainName: "Ocean & Tides", meaning: "Open ocean, marine depth, tides, long marine movement, sea navigation, and deep-water life.", backstory: "Marea sang until the seas remembered the pull of the moons." },
  { deityName: "Rillan", deityTitle: "the Returning River", pantheon: "NINEFOLD_WILD", domain: "RIVERS_RAIN_AND_FRESH_WATER", domainName: "Rivers, Rain & Fresh Water", meaning: "Freshwater systems, rivers, rainfall, upstream movement, lakes, streams, and wet freshwater ecology.", backstory: "Rillan travelled upstream carrying water and reopened the world's rivers one by one." },
  { deityName: "Damor", deityTitle: "the World-Builder", pantheon: "NINEFOLD_WILD", domain: "WETLANDS_FOREST_RENEWAL_AND_HABITAT", domainName: "Wetlands, Forest Renewal & Habitat", meaning: "Habitat engineering, ecosystem construction, environmental modification, wetlands, forest renewal, and creating conditions for other life.", backstory: "Damor changed rivers rather than merely living beside them, making creatures participants in nature." },
  { deityName: "Sterna", deityTitle: "the Long Journey", pantheon: "NINEFOLD_WILD", domain: "SEASONS_AND_MIGRATION", domainName: "Seasons & Migration", meaning: "Seasonal cycles, long-distance migration, annual movement, dispersal, seasonal return, and travel tied to life cycles.", backstory: "Sterna flew until the frozen sky followed her and created the procession of seasons." },
  { deityName: "Scarabos", deityTitle: "the Buried Seed", pantheon: "NINEFOLD_WILD", domain: "DECAY_SOIL_AND_RENEWAL", domainName: "Decay, Soil & Renewal", meaning: "Decomposition, detritus, soil creation, carrion cycles, burial, nutrient renewal, and death feeding new life.", backstory: "Scarabos buried the first dead thing and returned to find new life above it." },
  { deityName: "Sahrem", deityTitle: "the First Hunger", pantheon: "NINEFOLD_VEIL", domain: "FIRE_AND_HEAT", domainName: "Fire & Heat", meaning: "Fire, combustion, consuming transformation, furnaces, burning, and destructive or creative thermal change.", backstory: "Sahrem demanded that existence be allowed to consume and transform itself; flame was his argument made physical." },
  { deityName: "Neressa", deityTitle: "the Yielding Deep", pantheon: "NINEFOLD_VEIL", domain: "WATER_AND_FLOW", domainName: "Water & Flow", meaning: "Fluidity, adaptation, yielding without losing identity, elemental water, and flowing transformation.", backstory: "Neressa created something that survives through yielding and reshapes itself without losing its nature." },
  { deityName: "Kharad", deityTitle: "the Foundation", pantheon: "NINEFOLD_VEIL", domain: "EARTH_AND_STONE", domainName: "Earth & Stone", meaning: "Solidity, mountains, stone, physical foundations, permanence, weight, stability, and resistance to change.", backstory: "Kharad established solidity, weight, and foundations against constant change." },
  { deityName: "Aveli", deityTitle: "the Unheld", pantheon: "NINEFOLD_VEIL", domain: "AIR_AND_BREATH", domainName: "Air & Breath", meaning: "Air, wind, flight, breath, freedom of movement, diffusion, and motion that resists confinement.", backstory: "Aveli created motion that could never be permanently imprisoned; breath is their smallest miracle." },
  { deityName: "Iskarn", deityTitle: "the Still World", pantheon: "NINEFOLD_VEIL", domain: "ICE_PRESERVATION_AND_STILLNESS", domainName: "Ice, Preservation & Stillness", meaning: "Cold, ice, suspended change, preservation, dormancy, winter, stillness, and slowed processes.", backstory: "Iskarn demonstrated that change could be suspended without being destroyed." },
  { deityName: "Myrra", deityTitle: "Behind the Eyes", pantheon: "NINEFOLD_VEIL", domain: "DREAMING_AND_POSSIBILITY", domainName: "Dreaming & Possibility", meaning: "Dreams, imagination, illusion, uncertainty, potential realities, shape-changing possibility, and things that might exist.", backstory: "Myrra created dreams so existence could contain things that might be, not only things that are." },
  { deityName: "Orun-IX", deityTitle: "the Measured Hand", pantheon: "NINEFOLD_VEIL", domain: "TIME_SEQUENCE_AND_CAUSALITY", domainName: "Time, Sequence & Causality", meaning: "Order of events, precise timing, repetitive sequence, mechanisms, clocks, causality, synchronization, and predictable process.", backstory: "Orun-IX divided existence into before and after so creation no longer occurred simultaneously." },
  { deityName: "Vhalen", deityTitle: "the Last Shadow", pantheon: "NINEFOLD_VEIL", domain: "SHADOW_ABSENCE_AND_ENDINGS", domainName: "Shadow, Absence & Endings", meaning: "Darkness, disappearance, emptiness, boundaries, death, endings, absence, concealment, and things defined by what is missing.", backstory: "Vhalen introduced absence so creation could possess boundaries and distinct things could exist." },
  { deityName: "Asteriel", deityTitle: "the Turning Eye", pantheon: "NINEFOLD_VEIL", domain: "AETHER_LIGHT_AND_COSMIC_ORDER", domainName: "Aether, Light & Cosmic Order", meaning: "Cosmic structure, higher-order organization, radiant energy, celestial geometry, universal balance, and coherent integration of conflicting forces.", backstory: "Asteriel gathered conflicting elements into a universe that could coexist." },
] as const;

export interface EvidenceFragment {
  sourceRecordId: string;
  sourceScope: EvidenceScope;
  fieldPath: string;
  text: string;
  authorityWeight: number;
  basis: string;
}

export interface BreedEvidenceProfile {
  breedId: string;
  breedName: string;
  speciesId: string;
  speciesName: string | null;
  populationKind: PopulationKind;
  cultureId: string | null;
  cultureName: string | null;
  groupId: string;
  groupName: string | null;
  personalityId: string | null;
  personalityFamily: string | null;
  dimensions: Record<string, string | null>;
  primitiveBehavior: Record<string, number>;
  terrainBroad: string[];
  terrainSpecific: string[];
  foodBroad: string[];
  foodSpecific: string[];
  text: string;
  traits: string[];
  fragments: Record<ScoreAxis, EvidenceFragment[]>;
  ecologyAvailable: boolean;
}

export interface MatchedEvidence {
  axis: ScoreAxis;
  sourceRecordId: string;
  sourceScope: EvidenceScope;
  fieldPath: string;
  excerpt: string;
  signal: string;
  contribution: number;
  basis: string;
}

export interface CandidateAssessment {
  deityName: string;
  deityTitle: string;
  pantheon: Pantheon;
  domain: string;
  domainName: string;
  componentScores: Record<ScoreAxis, number>;
  axisAvailability: Record<ScoreAxis, boolean>;
  effectiveWeights: Record<ScoreAxis, number>;
  weightedScoreExact: number;
  score: number;
  matchedEvidence: MatchedEvidence[];
}

interface Signal {
  term: string;
  weight: number;
}

interface DomainSignals {
  families: Record<string, number>;
  personality: Signal[];
  behavior: Signal[];
  ecology: Signal[];
  symbolic: Signal[];
  dimensions?: Record<string, Record<string, number>>;
  behaviorVector?: Partial<Record<string, number>>;
}

const s = (...terms: string[]): Signal[] => terms.map((term) => ({ term: term.toLowerCase(), weight: term.trim().includes(" ") ? 26 : 17 }));
const w = (term: string, weight: number): Signal => ({ term: term.toLowerCase(), weight });

const DOMAIN_SIGNALS: Readonly<Record<string, DomainSignals>> = {
  Miren: { families: { COMPASSION: 95, CARE: 88, MERCY: 80, HOSPITALITY: 72, RECIPROCITY: 68, PROTECTION: 62, ATTACHMENT: 58, BELONGING: 45, LOYALTY: 40 }, personality: [...s("compassion", "care", "mercy", "provisioning", "food sharing", "rescue", "guardian", "injury aid"), w("altruistic", 16)], behavior: s("care for", "caregiving", "provisioning", "feeding others", "food sharing", "rescue", "aid", "protect young", "alloparent", "adoption", "cooperative breeding", "shelter others"), ecology: s("alloparent", "cooperative breeding", "cleaning mutualism", "food sharing", "nurse", "provision young"), symbolic: s("compassion", "sacrifice", "generosity", "mercy", "care", "guardian", "refuge", "support others"), dimensions: { motivation: { ALTRUISTIC: 14 }, collaborativePosture: { HELPFUL: 10 }, operatingStyle: { TEAMWORK: 6 } }, behaviorVector: { parental: 3, social: 2, nesting: 1, aggression: -1 } },
  Darel: { families: { COURAGE: 98, RISK: 76, FEAR: 66, REACTANCE: 55, PROTECTION: 48, COMPETITION: 45, POWER: 38 }, personality: s("courage", "resistance courage", "risk", "leap", "dive", "danger", "fear", "bravery", "defense"), behavior: s("despite fear", "defends", "confronts", "bold", "brave", "danger", "risk", "leap", "dive", "mobbing", "stand ground", "feigned injury"), ecology: s("exposed foraging", "dangerous crossing", "predator defense", "cliff leap", "high risk"), symbolic: s("courage", "bravery", "fear", "resistance", "defiance", "stand against", "risk"), dimensions: { outlookOrientation: { OPTIMISTIC: 6 }, collaborativePosture: { HELPFUL: 4 } }, behaviorVector: { aggression: 2, parental: 1, intelligence: 1 } },
  Savael: { families: { PATIENCE: 98, EQUANIMITY: 86, RESTRAINT: 82, DISCIPLINE: 68, CLOSURE: 45, TRADITION: 44 }, personality: s("patience", "waiting", "restraint", "equanimity", "low reactivity", "composure", "ambush patience", "stalking patience", "vigil"), behavior: s("waits", "waiting", "patient", "ambush", "stalk", "restraint", "low reactivity", "slow persistence", "without escalation", "tolerates"), ecology: s("ambush predator", "sit and wait", "long incubation", "slow growing", "delayed maturity"), symbolic: s("patience", "endurance", "restraint", "reconciliation", "long breath", "waiting", "continuance"), dimensions: { emotionalTemperature: { COMPOSED: 12 }, structureOrientation: { ORDERED: 5 }, allocationMode: { PLANNED: 5 } }, behaviorVector: { aggression: -2, intelligence: 1 } },
  Elian: { families: { HOPE: 98, REPAIR: 85, NOVELTY: 60, PERSEVERANCE: 58, CHANGE: 52, FAITH: 58, MEANING: 48 }, personality: s("hope", "repair", "rebuild", "future", "optimistic", "renew", "juvenile investment", "new beginning"), behavior: s("rebuild", "recovers", "returns after", "renews", "restores", "tries again", "regenerates", "recolonizes"), ecology: s("regeneration", "regrowth", "recolonization", "pioneer species", "recovery after", "resprout", "renewal"), symbolic: s("hope", "renewal", "rebirth", "future possibility", "rebuilding", "returning light", "new beginning"), dimensions: { outlookOrientation: { OPTIMISTIC: 16 }, emotionalTemperature: { JOYFUL: 5 } } },
  Namiya: { families: { FORGIVENESS: 98, MERCY: 86, CLOSURE: 65, REPAIR: 62, FAIRNESS: 48 }, personality: s("forgiveness", "reconciliation", "conditional release", "mercy", "harm", "community split", "grooming reconciliation"), behavior: s("reconcile", "reconciliation", "release after", "submission response", "grooming", "repair relationship", "restore bond"), ecology: s("reconciliation grooming", "post-conflict", "submission response"), symbolic: s("forgiveness", "reconciliation", "accountability", "release", "unclosed door", "restore relationship"), dimensions: { motivation: { ALTRUISTIC: 8 }, collaborativePosture: { HELPFUL: 8 }, emotionalTemperature: { COMPOSED: 5 } }, behaviorVector: { social: 2, aggression: -1 } },
  Oren: { families: { TRUTH: 98, AUTHENTICITY: 88, ACCOUNTABILITY: 78, DOUBT: 62, TRUST: 55, SELF_KNOWLEDGE: 52, REPUTATION: 50, INDIVIDUALITY: 46 }, personality: s("truth", "honest signal", "authenticity", "accountability", "error correction", "retesting", "fraud", "deception", "official denial"), behavior: s("honest signal", "truthful", "transparent", "reliable signal", "exposes", "detects deception", "error correction", "retests"), ecology: s("honest signaling", "reliable signal", "warning signal"), symbolic: s("truth", "honesty", "candor", "integrity", "authenticity", "expose lie", "clear voice") },
  Tavai: { families: { EMPATHY: 98, PERSPECTIVE: 90, INTIMACY: 72, COOPERATION: 66, FAIRNESS: 58, TRUST: 52, BELONGING: 55 }, personality: s("empathy", "perspective", "consolation", "distress response", "cooperation", "social", "understanding", "listens"), behavior: s("consolation", "distress response", "perspective taking", "mediation", "cooperative", "social learning", "recognizes", "attuned", "grooming intimacy"), ecology: s("cooperative hunting", "group defense", "social learning", "mutualism"), symbolic: s("empathy", "understanding", "perspective", "mediation", "attunement", "listens", "solidarity"), dimensions: { operatingStyle: { TEAMWORK: 10 }, collaborativePosture: { HELPFUL: 12 }, motivation: { ALTRUISTIC: 6 } }, behaviorVector: { social: 3, intelligence: 2, parental: 1 } },
  Varek: { families: { PERSEVERANCE: 98, DUTY: 91, DISCIPLINE: 80, LOYALTY: 66, PURPOSE: 65, RESTRAINT: 50, TRADITION: 50, COMPETITION: 35 }, personality: s("perseverance", "duty", "discipline", "persistent", "endurance", "last guardian", "vigil", "survival persistence", "method switching"), behavior: s("persists", "persistent", "endures", "repeated failure", "refuses to abandon", "continues", "duty", "vigil", "long pursuit", "survives hardship"), ecology: s("drought endurance", "cold endurance", "persistent pursuit", "extreme endurance", "survival persistence"), symbolic: s("resolve", "perseverance", "duty", "tenacity", "grit", "last standing", "meaningful work"), dimensions: { structureOrientation: { ORDERED: 6 }, allocationMode: { PLANNED: 5 }, emotionalTemperature: { COMPOSED: 5 } } },
  Selen: { families: { PLEASURE: 98, EXPRESSION: 72, DESIRE: 66, RECOGNITION: 58, INTIMACY: 52, NOVELTY: 45, SELF_REGARD: 50, STATUS: 45, REPUTATION: 40 }, personality: s("joy", "pleasure", "play", "joy bringer", "courtship display", "vocal expression", "visual expression", "celebration", "affection"), behavior: s("play", "playful", "celebration", "dance", "song", "sings", "courtship display", "affection", "humor", "festival", "social play"), ecology: s("object play", "social play", "courtship dance", "courtship song", "display lek"), symbolic: s("joy", "celebration", "music", "laughter", "pleasure", "play", "affection", "festival", "reasons for living"), dimensions: { emotionalTemperature: { JOYFUL: 18 }, outlookOrientation: { OPTIMISTIC: 8 }, loquacity: { TALKATIVE: 6 } }, behaviorVector: { social: 1, intelligence: 1 } },
  Solkar: { families: { EXPOSURE: 64, PLEASURE: 42 }, personality: s("basking", "exposure", "daylight", "warmth", "solar"), behavior: s("diurnal", "basks", "basking", "sun exposed", "day-active", "awakens at dawn"), ecology: s("diurnal", "sunlight", "daylight", "basking", "solar", "warmth", "heat associated with life", "dawn"), symbolic: s("sun", "daylight", "illumination", "awakening", "first warmth", "dawn", "radiant warmth") },
  Lunessa: { families: { CHANGE: 72, AMBIGUITY: 48, MEMORY: 40 }, personality: s("molting", "developmental plasticity", "between states", "ritual return", "cycle", "nocturnal"), behavior: s("nocturnal", "night-active", "waxing", "waning", "periodic", "returns after", "metamorphosis", "molt", "cycles"), ecology: s("nocturnal", "lunar", "moon", "tide-linked", "metamorphosis", "molting", "periodic emergence", "night activity"), symbolic: s("moon", "phases", "cycle", "return after disappearance", "many faced", "waxing", "waning", "periodic transformation") },
  Vespera: { families: { PURPOSE: 70, MEMORY: 45, PERSPECTIVE: 42, EXILE: 38 }, personality: s("navigation", "homing", "orientation", "migration purpose", "route", "visual vantage"), behavior: s("navigate", "navigation", "homing", "returns home", "wayfinding", "orients", "celestial compass", "magnetic compass", "spatial memory"), ecology: s("navigation", "homing", "wayfinding", "celestial", "stars", "magnetic orientation", "long-distance orientation", "migration guidance"), symbolic: s("stars", "navigation", "orientation", "wayfinding", "find home", "thousand eyed", "celestial guidance") },
  Voltar: { families: { FORCE: 70, IMPULSE: 62, ANGER: 55, POWER: 48, DOMINANCE: 40 }, personality: s("electric", "sudden", "strike first", "catastrophic threshold", "rage powered", "contained power", "charge"), behavior: s("electric discharge", "shock", "sudden strike", "thunder", "storm", "abrupt", "violent burst", "charge"), ecology: s("electric", "electrogenic", "lightning", "thunderstorm", "storm", "charged atmosphere"), symbolic: s("lightning", "storm", "thunder", "sudden current", "disruption", "violent energy", "charged", "charge") },
  Marea: { families: { EXPRESSION: 38, EXILE: 32 }, personality: s("deep", "song", "long journey", "ocean"), behavior: s("deep dive", "marine migration", "sea navigation", "ocean crossing", "tidal", "pelagic", "whale song"), ecology: s("ocean", "marine", "pelagic", "deep sea", "deep water", "tide", "tidal", "seabed", "open sea", "saltwater", "coastal"), symbolic: s("ocean", "tides", "deep singer", "sea", "marine depth", "unfinished song") },
  Rillan: { families: { CHANGE: 42, EXILE: 32 }, personality: s("returning river", "upstream", "flow", "rain"), behavior: s("upstream", "river migration", "freshwater", "rainfall", "returns to river", "stream dwelling"), ecology: s("freshwater", "fresh water", "river", "stream", "lake", "rain", "rainfall", "wet freshwater", "upstream", "floodplain"), symbolic: s("river", "rain", "fresh water", "returning river", "upstream", "flowing water") },
  Damor: { families: { STEWARDSHIP: 98, CONTROL: 76, CARE: 48, REPAIR: 45 }, personality: s("habitat engineering", "environment engineering", "seed dispersal", "living system", "realm keeper", "waste recycling", "stewardship"), behavior: s("builds habitat", "habitat engineer", "modifies environment", "ecosystem engineer", "constructs", "burrows shelter", "creates refuge", "seed dispersal"), ecology: s("habitat engineering", "ecosystem engineer", "wetland", "forest renewal", "seed dispersal", "environmental modification", "creates habitat", "dam building", "soil aeration", "pollination"), symbolic: s("world builder", "habitat", "stewardship", "creates conditions", "forest renewal", "living system", "ecosystem construction"), dimensions: { motivation: { ALTRUISTIC: 6 }, collaborativePosture: { HELPFUL: 5 } }, behaviorVector: { intelligence: 2, nesting: 2 } },
  Sterna: { families: { EXILE: 88, CHANGE: 70, PURPOSE: 62, NOVELTY: 52 }, personality: s("migration", "nomadic continuity", "diaspora", "two home", "seasonal", "dispersal", "long journey"), behavior: s("migrates", "migration", "seasonal return", "long-distance travel", "annual movement", "dispersal", "nomadic", "journey"), ecology: s("seasonal migration", "long-distance migration", "annual migration", "dispersal", "seasonal return", "seasons", "overwinter", "breeding migration", "nomadic"), symbolic: s("long journey", "seasons", "migration", "return", "travel tied to life cycle", "diaspora") },
  Scarabos: { families: { STEWARDSHIP: 62, MORTALITY: 58, REPAIR: 42 }, personality: s("waste recycling", "decay", "buried", "renewal", "mortality", "living memorial"), behavior: s("scavenges", "carrion", "buries", "decomposes", "detritus", "dung", "recycles nutrients", "soil creation"), ecology: s("decomposition", "detritus", "carrion", "dung", "soil", "nutrient cycling", "burial", "decay", "saprophytic", "coprophag", "necrophag"), symbolic: s("buried seed", "death feeds life", "renewal", "decay", "soil", "burial", "new life") },
  Sahrem: { families: { ANGER: 70, APPETITE: 68, FORCE: 28, POWER: 52, IMPULSE: 45, DOMINANCE: 46 }, personality: s("hunger", "rage", "burning", "heat", "consume", "fire", "destructive transformation"), behavior: s("burns", "combustion", "consumes", "heat", "fiery", "erupts", "incinerates", "furnace"), ecology: s("fire", "heat", "thermal", "combustion", "volcanic", "burning", "furnace", "wildfire", "geothermal"), symbolic: s("fire", "flame", "hunger", "consuming transformation", "burning", "first hunger", "creative destruction") },
  Neressa: { families: { CHANGE: 82, AMBIGUITY: 58, AUTONOMY: 38 }, personality: s("adaptive surrender", "form surrender", "developmental plasticity", "fluid", "yielding", "flow", "adaptation"), behavior: s("flows", "fluid", "adapts", "reshapes", "yields", "flexible form", "changes form"), ecology: s("water", "aquatic", "fluid", "flow", "current", "amphibious", "liquid", "adaptation", "reshapes"), symbolic: s("yielding", "flow", "water", "adaptation", "without losing identity", "fluidity", "transformation") },
  Kharad: { families: { LAND: 92, BOUNDARIES: 64, CONTROL: 48, DISCIPLINE: 40, POSSESSION: 48, AUTHORITY: 42 }, personality: s("land", "rootedness", "foundation", "stone", "domain bound", "stability", "form maintenance", "territorial marking"), behavior: s("holds ground", "immovable", "burrows", "rock dwelling", "rooted", "resists change", "territorial marking"), ecology: s("mountain", "stone", "rock", "earth", "cliff", "cave", "subterranean", "burrow", "bedrock", "geologic"), symbolic: s("foundation", "permanence", "solidity", "weight", "stability", "earth", "stone", "resistance to change", "territorial boundary") },
  Aveli: { families: { AUTONOMY: 92, EXILE: 48, EXPOSURE: 38, RISK: 35, INDIVIDUALITY: 55, REACTANCE: 58 }, personality: s("freedom", "isolation", "flight", "unheld", "air", "breath", "dispersal", "escape confinement"), behavior: s("flies", "flight", "aerial", "soaring", "gliding", "wind borne", "airborne", "free movement", "disperses"), ecology: s("aerial", "flight", "soaring", "gliding", "air", "wind", "breath", "high altitude", "arboreal to aerial", "airborne"), symbolic: s("unheld", "freedom", "air", "breath", "wind", "motion", "resists confinement", "diffusion") },
  Iskarn: { families: { SCARCITY: 80, EQUANIMITY: 62, RESTRAINT: 50, PERSEVERANCE: 45 }, personality: s("metabolic slowing", "cold endurance", "stillness", "preservation", "dormancy", "winter", "low reactivity"), behavior: s("hibernates", "torpor", "dormant", "metabolic suppression", "freezes", "remains still", "cold adapted"), ecology: s("ice", "glacier", "polar", "cold", "winter", "frozen", "permafrost", "hibernation", "torpor", "dormancy", "cryogenic"), symbolic: s("still world", "preservation", "suspended change", "stillness", "ice", "winter", "slowed processes") },
  Myrra: { families: { AMBIGUITY: 94, NOVELTY: 74, AUTHENTICITY: 58, DESIRE: 52, DOUBT: 48, SELF_KNOWLEDGE: 42, CURIOSITY: 70, INDIVIDUALITY: 46, ENVY: 36 }, personality: s("unfixed form", "between states", "shape without self", "dream", "possibility", "illusion", "wish", "reinvention", "contextual form", "curiosity", "problem solving"), behavior: s("shape shifts", "shapeshift", "mimic", "illusion", "dream", "unpredictable form", "imagines", "changes appearance", "problem solving"), ecology: s("metamorphosis", "plasticity", "mimicry", "shape changing", "variable form"), symbolic: s("dream", "possibility", "imagination", "illusion", "potential reality", "might exist", "shape changing", "uncertainty", "curiosity") },
  "Orun-IX": { families: { CONFORMITY: 82, DISCIPLINE: 74, PERFECTION: 66, DUTY: 52, CONTROL: 48, COLLECTIVE_MEMORY: 42, AUTHORITY: 55, TRADITION: 48, FAIRNESS: 38 }, personality: s("synchrony", "sequence", "mechanism", "timing", "ritual action", "error correction", "order", "predictable"), behavior: s("synchronized", "sequence", "precise timing", "repetitive", "clockwork", "mechanism", "scheduled", "ordered process"), ecology: s("synchronous emergence", "periodic sequence", "timed emergence", "circadian timing", "repetitive cycle"), symbolic: s("time", "sequence", "causality", "measured", "clock", "synchronization", "before and after", "predictable process"), dimensions: { structureOrientation: { ORDERED: 10 }, allocationMode: { PLANNED: 8 }, administrationMode: { CENTRALIZED: 4 } } },
  Vhalen: { families: { MORTALITY: 90, GRIEF: 84, SECRECY: 74, CLOSURE: 64, BOUNDARIES: 48, EXILE: 40, VENGEANCE: 48 }, personality: s("death", "undead", "grief", "shadow", "absence", "ending", "disappearance", "secrecy", "haunted", "remains"), behavior: s("nocturnal concealment", "vanishes", "disappears", "conceals", "death", "kills", "guards remains", "cryptic"), ecology: s("death", "carrion", "darkness", "cave darkness", "nocturnal concealment", "cryptic", "absence"), symbolic: s("shadow", "absence", "ending", "death", "darkness", "emptiness", "concealment", "boundary", "last shadow") },
  Asteriel: { families: { HIERARCHY: 90, PERFECTION: 76, COLLECTIVE_MEMORY: 60, MEANING: 50, PERSPECTIVE: 48, LEGITIMACY: 58, AUTHORITY: 50, STATUS: 50, FAITH: 40 }, personality: s("cosmic order", "hierarchy", "symmetry", "perfect", "god s eye", "universal", "higher order", "integration"), behavior: s("complex organization", "organized colony", "coordinated whole", "geometric", "symmetry", "integrates"), ecology: s("eusocial", "superorganism", "geometric structure", "radiant", "bioluminescent", "celestial"), symbolic: s("cosmic order", "aether", "radiant", "celestial geometry", "universal balance", "coherent whole", "turning eye", "integration") },
};

function compactWhitespace(value: string): string { return value.replace(/\s+/g, " ").trim(); }
function lower(value: string): string { return compactWhitespace(value.replaceAll("_", " ").replace(/[’]/g, "'")).toLowerCase(); }
function clamp(value: number): number { return Math.max(0, Math.min(100, value)); }
function rounded(value: number, places = 3): number { const scale = 10 ** places; return Math.round(value * scale) / scale; }

function includesSignal(text: string, term: string): boolean {
  const normalized = lower(text);
  const candidate = lower(term);
  if (!candidate) return false;
  if (candidate.length <= 3) return new RegExp(`(?:^|\\b)${candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\b|$)`, "i").test(normalized);
  return normalized.includes(candidate);
}

function signalMatches(axis: ScoreAxis, fragments: readonly EvidenceFragment[], signals: readonly Signal[], limit: number): { score: number; matches: MatchedEvidence[] } {
  const bestBySignal = new Map<string, MatchedEvidence>();
  for (const fragment of fragments) for (const signal of signals) {
    if (!includesSignal(fragment.text, signal.term)) continue;
    const contribution = rounded(signal.weight * fragment.authorityWeight);
    const match = { axis, sourceRecordId: fragment.sourceRecordId, sourceScope: fragment.sourceScope, fieldPath: fragment.fieldPath, excerpt: compactWhitespace(fragment.text).slice(0, 320), signal: signal.term, contribution, basis: fragment.basis };
    const current = bestBySignal.get(signal.term);
    if (!current || contribution > current.contribution || contribution === current.contribution && `${match.sourceRecordId}\0${match.fieldPath}`.localeCompare(`${current.sourceRecordId}\0${current.fieldPath}`) < 0) bestBySignal.set(signal.term, match);
  }
  const matches = [...bestBySignal.values()];
  matches.sort((a, b) => b.contribution - a.contribution || a.sourceRecordId.localeCompare(b.sourceRecordId) || a.fieldPath.localeCompare(b.fieldPath) || a.signal.localeCompare(b.signal));
  return { score: Math.min(limit, matches.reduce((sum, match) => sum + match.contribution, 0)), matches };
}

function dimensionContribution(profile: BreedEvidenceProfile, signals: DomainSignals): { score: number; matches: MatchedEvidence[] } {
  const matches: MatchedEvidence[] = [];
  let score = 0;
  for (const [field, values] of Object.entries(signals.dimensions ?? {})) {
    const value = profile.dimensions[field];
    if (!value) continue;
    const contribution = values[value] ?? 0;
    if (!contribution) continue;
    score += contribution;
    matches.push({ axis: "PERSONALITY_ALIGNMENT", sourceRecordId: profile.breedId, sourceScope: "BREED", fieldPath: `v4Effective.dimensions.${field}.value`, excerpt: `${field}=${value}`, signal: `${field}:${value}`, contribution, basis: "PERSONALITY" });
  }
  return { score: Math.min(20, score), matches };
}

function behaviorVectorContribution(profile: BreedEvidenceProfile, signals: DomainSignals): { score: number; matches: MatchedEvidence[] } {
  let score = 0;
  const matches: MatchedEvidence[] = [];
  for (const [field, coefficient] of Object.entries(signals.behaviorVector ?? {})) {
    const value = profile.primitiveBehavior[field];
    if (value === undefined) continue;
    const centered = coefficient! >= 0 ? value : 4 - value;
    const contribution = Math.max(0, centered * Math.abs(coefficient!));
    if (contribution <= 0) continue;
    score += contribution;
    matches.push({ axis: "BEHAVIOR_ALIGNMENT", sourceRecordId: profile.breedId, sourceScope: "BREED", fieldPath: `canonicalPayload.primitiveBehavior.${field}.score`, excerpt: `${field}=${value}/4`, signal: `${field} behavior profile`, contribution, basis: "BEHAVIOR" });
  }
  return { score: Math.min(18, score), matches };
}

function scoreCandidate(profile: BreedEvidenceProfile, deity: DeityAuthorityRecord, canonicalIndex: number): CandidateAssessment & { canonicalIndex: number } {
  const signals = DOMAIN_SIGNALS[deity.deityName];
  if (!signals) throw new Error(`Missing classifier signals for ${deity.deityName}`);
  const familyStrength = profile.personalityFamily ? signals.families[profile.personalityFamily] ?? 0 : 0;
  const personalityLexical = signalMatches("PERSONALITY_ALIGNMENT", profile.fragments.PERSONALITY_ALIGNMENT, signals.personality, 34);
  const dimensions = dimensionContribution(profile, signals);
  const familyMatches: MatchedEvidence[] = familyStrength > 0 && profile.personalityId ? [{
    axis: "PERSONALITY_ALIGNMENT", sourceRecordId: profile.breedId, sourceScope: "BREED", fieldPath: "v4Effective.personalityId", excerpt: profile.personalityId,
    signal: `personality family ${profile.personalityFamily}`, contribution: rounded(familyStrength * 0.78), basis: "PERSONALITY",
  }] : [];
  const personalityScore = profile.personalityId ? clamp(5 + familyStrength * 0.78 + personalityLexical.score + dimensions.score) : 0;

  const behaviorLexical = signalMatches("BEHAVIOR_ALIGNMENT", profile.fragments.BEHAVIOR_ALIGNMENT, signals.behavior, 77);
  const behaviorVector = behaviorVectorContribution(profile, signals);
  const behaviorScore = clamp(5 + behaviorLexical.score + behaviorVector.score);

  const ecologyLexical = signalMatches("ECOLOGICAL_ALIGNMENT", profile.fragments.ECOLOGICAL_ALIGNMENT, signals.ecology, 95);
  const ecologyScore = profile.ecologyAvailable ? clamp(5 + ecologyLexical.score) : 0;

  const symbolicLexical = signalMatches("SYMBOLIC_ALIGNMENT", profile.fragments.SYMBOLIC_ALIGNMENT, signals.symbolic, 95);
  const symbolicScore = clamp(5 + symbolicLexical.score);

  const textSignals = [...signals.behavior, ...signals.ecology, ...signals.symbolic];
  const textLexical = signalMatches("CANONICAL_TEXT_SUPPORT", profile.fragments.CANONICAL_TEXT_SUPPORT, textSignals, 95);
  const textScore = clamp(5 + textLexical.score);

  const componentScores: Record<ScoreAxis, number> = {
    PERSONALITY_ALIGNMENT: Math.round(personalityScore),
    BEHAVIOR_ALIGNMENT: Math.round(behaviorScore),
    ECOLOGICAL_ALIGNMENT: Math.round(ecologyScore),
    SYMBOLIC_ALIGNMENT: Math.round(symbolicScore),
    CANONICAL_TEXT_SUPPORT: Math.round(textScore),
  };
  const axisAvailability: Record<ScoreAxis, boolean> = {
    PERSONALITY_ALIGNMENT: Boolean(profile.personalityId),
    BEHAVIOR_ALIGNMENT: profile.fragments.BEHAVIOR_ALIGNMENT.length > 0,
    ECOLOGICAL_ALIGNMENT: profile.ecologyAvailable,
    SYMBOLIC_ALIGNMENT: profile.fragments.SYMBOLIC_ALIGNMENT.length > 0,
    CANONICAL_TEXT_SUPPORT: profile.fragments.CANONICAL_TEXT_SUPPORT.length > 0,
  };
  const availableWeight = SCORE_AXES.filter((axis) => axisAvailability[axis]).reduce((sum, axis) => sum + AXIS_WEIGHTS[axis], 0);
  if (availableWeight <= 0) throw new Error(`${profile.breedId} has no scoreable evidence axes`);
  const effectiveWeights = Object.fromEntries(SCORE_AXES.map((axis) => [axis, axisAvailability[axis] ? rounded(AXIS_WEIGHTS[axis] / availableWeight, 6) : 0])) as Record<ScoreAxis, number>;
  const weightedScoreExact = rounded(SCORE_AXES.reduce((sum, axis) => sum + componentScores[axis] * effectiveWeights[axis], 0));
  const matchedEvidence = [...familyMatches, ...dimensions.matches, ...personalityLexical.matches, ...behaviorVector.matches, ...behaviorLexical.matches, ...ecologyLexical.matches, ...symbolicLexical.matches, ...textLexical.matches]
    .sort((a, b) => b.contribution - a.contribution || SCORE_AXES.indexOf(a.axis) - SCORE_AXES.indexOf(b.axis) || a.fieldPath.localeCompare(b.fieldPath))
    .slice(0, 16);
  return { ...deity, componentScores, axisAvailability, effectiveWeights, weightedScoreExact, score: Math.round(weightedScoreExact), matchedEvidence, canonicalIndex };
}

function candidateOrder(left: CandidateAssessment & { canonicalIndex: number }, right: CandidateAssessment & { canonicalIndex: number }): number {
  if (right.weightedScoreExact !== left.weightedScoreExact) return right.weightedScoreExact - left.weightedScoreExact;
  for (const axis of SCORE_AXES) if (right.componentScores[axis] !== left.componentScores[axis]) return right.componentScores[axis] - left.componentScores[axis];
  return left.canonicalIndex - right.canonicalIndex;
}

export function assessAllDeities(profile: BreedEvidenceProfile): CandidateAssessment[] {
  if (DEITIES.length !== 27) throw new Error(`Canonical deity count must be 27; found ${DEITIES.length}`);
  const counts = new Map<Pantheon, number>();
  for (const deity of DEITIES) counts.set(deity.pantheon, (counts.get(deity.pantheon) ?? 0) + 1);
  for (const pantheon of ["NINEFOLD_HEART", "NINEFOLD_WILD", "NINEFOLD_VEIL"] as const) if (counts.get(pantheon) !== 9) throw new Error(`${pantheon} must contain exactly nine deities`);
  return DEITIES.map((deity, index) => scoreCandidate(profile, deity, index)).sort(candidateOrder).map(({ canonicalIndex: _canonicalIndex, ...candidate }) => candidate);
}

export interface ConfidenceAssessment {
  suggestedConfidence: Confidence;
  confidence: Confidence;
  confidenceRationale: string;
  confidenceOverrideReason: string | null;
  evidenceQuality: "STRONG" | "MODERATE" | "WEAK";
  evidenceDirectness: "DIRECT" | "PARTIAL" | "INDIRECT";
  evidenceBreadth: number;
  evidenceConsistency: "CONVERGENT" | "MIXED" | "INSEPARABLE";
  missingEvidence: string[];
}

function confidenceBand(score: number, margin: number): Confidence {
  if (score >= 85 && margin >= 15) return "VERY_HIGH";
  if (score >= 75 && margin >= 10) return "HIGH";
  if (score >= 60 && margin >= 5) return "MEDIUM";
  return "LOW";
}

export function judgeConfidence(profile: BreedEvidenceProfile, candidates: readonly CandidateAssessment[]): ConfidenceAssessment {
  const winner = candidates[0]; const runner = candidates[1];
  if (!winner || !runner) throw new Error(`${profile.breedId} lacks two deity candidates`);
  const margin = rounded(winner.weightedScoreExact - runner.weightedScoreExact);
  const direct = winner.matchedEvidence.filter((item) => item.sourceScope === "BREED" && item.contribution >= 10);
  const directFields = new Set(direct.map((item) => `${item.fieldPath}:${item.signal}`));
  const evidenceBreadth = SCORE_AXES.filter((axis) => winner.axisAvailability[axis] && winner.componentScores[axis] >= 35).length;
  const personalityDirect = winner.matchedEvidence.some((item) => item.fieldPath === "v4Effective.personalityId" && item.contribution >= 35);
  const textDirect = winner.matchedEvidence.some((item) => (item.fieldPath === "canonicalPayload.text" || item.fieldPath.startsWith("canonicalPayload.traits")) && item.contribution >= 12);
  const evidenceQuality: ConfidenceAssessment["evidenceQuality"] = directFields.size >= 4 && evidenceBreadth >= 3 ? "STRONG" : directFields.size >= 2 && evidenceBreadth >= 2 ? "MODERATE" : "WEAK";
  const evidenceDirectness: ConfidenceAssessment["evidenceDirectness"] = personalityDirect || textDirect ? "DIRECT" : directFields.size >= 2 ? "PARTIAL" : "INDIRECT";
  const evidenceConsistency: ConfidenceAssessment["evidenceConsistency"] = margin < 2 ? "INSEPARABLE" : margin < 5 || evidenceBreadth < 2 ? "MIXED" : "CONVERGENT";
  const suggestedConfidence = confidenceBand(winner.score, margin);
  let confidence: Confidence;
  const missingEvidence: string[] = [];
  if (directFields.size === 0) missingEvidence.push("No direct Breed-level canonical field materially distinguishes the leading deity.");
  if (evidenceBreadth < 2) missingEvidence.push("Fewer than two evidence dimensions provide substantial support for the leading deity.");
  if (margin < 2) missingEvidence.push(`The top two candidates are effectively inseparable at a ${margin.toFixed(3)}-point margin.`);
  if (!profile.personalityId) missingEvidence.push("No canonical V4 personality assignment exists for this PET Breed.");

  if (directFields.size === 0 || margin < 2) confidence = "REVIEW_REQUIRED";
  else if (evidenceQuality === "WEAK" || evidenceDirectness === "INDIRECT" || evidenceBreadth < 2 || margin < 5) confidence = "LOW";
  else if (evidenceQuality === "STRONG" && evidenceDirectness === "DIRECT" && evidenceBreadth >= 4 && winner.score >= 82 && margin >= 15) confidence = "VERY_HIGH";
  else if (evidenceQuality === "STRONG" && evidenceDirectness === "DIRECT" && evidenceBreadth >= 3 && winner.score >= 70 && margin >= 10) confidence = "HIGH";
  else if (winner.score >= 55) confidence = "MEDIUM";
  else confidence = "LOW";

  const confidenceRationale = confidence === "REVIEW_REQUIRED"
    ? `Canonical evidence does not resolve ${winner.deityName} over ${runner.deityName}: ${missingEvidence.join(" ")}`
    : `${evidenceQuality.toLowerCase()} ${evidenceDirectness.toLowerCase()} evidence spans ${evidenceBreadth} substantial axes; ${winner.deityName} leads ${runner.deityName} by ${margin.toFixed(3)} points.`;
  const confidenceOverrideReason = confidence === suggestedConfidence ? null
    : `Numeric guidance suggested ${suggestedConfidence}, but evidence judgment requires ${confidence}: ${confidenceRationale}`;
  return { suggestedConfidence, confidence, confidenceRationale, confidenceOverrideReason, evidenceQuality, evidenceDirectness, evidenceBreadth, evidenceConsistency, missingEvidence };
}

export function deityReference(candidate: CandidateAssessment): DeityAuthorityRecord {
  return { deityName: candidate.deityName, deityTitle: candidate.deityTitle, pantheon: candidate.pantheon, domain: candidate.domain, domainName: candidate.domainName, meaning: DEITIES.find((deity) => deity.deityName === candidate.deityName)!.meaning, backstory: DEITIES.find((deity) => deity.deityName === candidate.deityName)!.backstory };
}
