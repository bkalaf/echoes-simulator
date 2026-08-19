import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import registry from "../../resources/personality/personality-expression-registry-v3.json" with { type: "json" };

interface FieldObservation { locator: string; boundedContext: string; sourceFact: string }
interface Observation {
  batchId: string;
  researchUnitId: string;
  query: string;
  searchResultChosen: string;
  actualOpenedUrl: string;
  title: string;
  organization: string;
  publisher: string;
  personalityId: string;
  personalityBridge: string;
  terrainBroad: string[];
  terrainSpecific: string[];
  fields: { personalityId: FieldObservation; terrainBroad: FieldObservation; terrainSpecific: FieldObservation };
}

const TERRAIN_BROAD = new Set(["MOUNTAIN", "FOREST", "WETLAND", "COASTAL", "OCEAN", "FRESHWATER", "DESERT", "GRASSLAND", "SUBTERRANEAN", "POLAR_ICE", "BUILT_ENVIRONMENT", "GENERALIST"]);
const TERRAIN_SPECIFIC = new Set(["ALPINE", "BOG", "BOREAL_FOREST", "BURROW", "CANOPY", "CANYON", "CASTLE", "CAVE", "CITY", "CLIFF", "CLOUD_FOREST", "COASTAL_CLIFF", "CORAL_REEF", "DELTA", "DUNES", "ESTUARY", "FARMLAND", "FJORD", "FLOODPLAIN", "FLOWERING_HABITAT", "FOREST_EDGE", "FOREST_FLOOR", "GENERALIST", "GLACIER", "HOT_DESERT", "ISLAND", "KARST", "KELP_FOREST", "LAKE", "MANGROVE", "MARSH", "MEADOW", "MINE", "MONTANE_FOREST", "MUDFLAT", "OASIS", "OLD_GROWTH_FOREST", "PACK_ICE", "PELAGIC", "PLATEAU", "POND", "PRAIRIE", "RAIN_FOREST", "RIVER", "ROAD", "RUINS", "SAVANNA", "SCRUBLAND", "SEAGRASS_BED", "SOIL", "STEPPE", "SWAMP", "TEMPLE", "TUNDRA", "TUNNEL", "VILLAGE", "VOLCANIC", "WOODLAND", "WORKSHOP"]);

const encoded = process.argv[2];
if (!encoded) throw new Error("Expected one hex-encoded observation argument");
const observation = JSON.parse(Buffer.from(encoded, "hex").toString("utf8")) as Observation;
if (observation.batchId !== "R01_B01") throw new Error("This recorder invocation is scoped to R01_B01");
if (!new Set(registry.map((row) => row.personalityId)).has(observation.personalityId)) throw new Error(`Invalid Personality Expression ${observation.personalityId}`);
if (!observation.terrainBroad.length || observation.terrainBroad.some((value) => !TERRAIN_BROAD.has(value))) throw new Error("Invalid terrainBroad");
if (!observation.terrainSpecific.length || observation.terrainSpecific.some((value) => !TERRAIN_SPECIFIC.has(value))) throw new Error("Invalid terrainSpecific");
new URL(observation.actualOpenedUrl);

const directory = resolve("artifacts/research-v4/batches", observation.batchId);
const journalPath = resolve(directory, "research_journal.jsonl");
const decisionsPath = resolve(directory, "research_decisions.jsonl");
const existingDecisions = readFileSync(decisionsPath, "utf8");
if (existingDecisions.includes(`\"researchUnitId\":\"${observation.researchUnitId}\"`)) throw new Error(`Duplicate research decision ${observation.researchUnitId}`);
const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const journalEntryIds: Record<string, string> = {};
for (const field of ["personalityId", "terrainBroad", "terrainSpecific"] as const) {
  const suffix = field.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();
  const journalEntryId = `JRN_${observation.batchId}_${observation.researchUnitId}_${suffix}_001`;
  journalEntryIds[field] = journalEntryId;
  const entry = {
    journalEntryId, batchId: observation.batchId, timestamp, query: observation.query,
    searchResultChosen: observation.searchResultChosen, actualOpenedUrl: observation.actualOpenedUrl,
    title: observation.title, organization: observation.organization, publisher: observation.publisher,
    locator: observation.fields[field].locator, boundedContext: observation.fields[field].boundedContext,
    sourceFact: observation.fields[field].sourceFact, targetUnitId: observation.researchUnitId,
    targetField: field, accepted: true, rejectionReason: null, sourceOpened: true,
  };
  appendFileSync(journalPath, `${JSON.stringify(entry)}\n`);
}
appendFileSync(decisionsPath, `${JSON.stringify({
  batchId: observation.batchId, researchUnitId: observation.researchUnitId,
  personalityId: observation.personalityId, personalityBridge: observation.personalityBridge,
  terrainBroad: observation.terrainBroad, terrainSpecific: observation.terrainSpecific,
  journalEntryIds, status: "SIMULATION_READY",
})}\n`);
console.log(JSON.stringify({ status: "RECORDED", researchUnitId: observation.researchUnitId, timestamp }));
