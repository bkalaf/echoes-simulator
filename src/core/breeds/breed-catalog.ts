import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { openValidatedZip, parseJsonLines } from "../inputs/importer.js";

export interface BreedCatalogEntry {
  breedId: string;
  name: string;
  populationKind: string;
  speciesId: string | null;
  speciesName: string | null;
  scientificName: string | null;
  groupId: string | null;
  cultureId: string | null;
  factionObject: Record<"CONCORD" | "SCHISM" | "RUIN", number>;
  dominantFaction: ("CONCORD" | "SCHISM" | "RUIN")[];
}

type SpeciesIdentity = { name: string | null; scientificName: string | null };
type BreedIdentity = { breedId: string; name: string; populationKind: string; speciesId?: string | null; groupId?: string | null; cultureId?: string | null };
type BreedFactionProjection = { breedId: string; factionObject: BreedCatalogEntry["factionObject"]; dominantFaction: BreedCatalogEntry["dominantFaction"] };

function derivedScientificName(speciesId: string | null | undefined): string | null {
  if (!speciesId?.startsWith("SPC_")) return null;
  const words = speciesId.slice(4).split("_").filter(Boolean);
  if (words.length < 2) return null;
  return words.map((word, index) => index === 0 ? `${word[0]}${word.slice(1).toLowerCase()}` : word.toLowerCase()).join(" ");
}

async function loadSpeciesIdentities(canonicalDirectory: string): Promise<Map<string, SpeciesIdentity>> {
  const filename = resolve(canonicalDirectory, "research-corpus/IMPORT_LEDGER.jsonl");
  const result = new Map<string, SpeciesIdentity>();
  if (!existsSync(filename)) return result;
  const lines = createInterface({ input: createReadStream(filename, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.includes('"recordType":"SPECIES"')) continue;
    const row = JSON.parse(line) as { recordId?: string; canonicalPayload?: { name?: string | null; scientificName?: string | null } };
    if (row.recordId) result.set(row.recordId, { name: row.canonicalPayload?.name ?? null, scientificName: row.canonicalPayload?.scientificName ?? null });
  }
  return result;
}

export async function loadBreedCatalog(canonicalDirectory: string): Promise<BreedCatalogEntry[]> {
  const manifest = JSON.parse(readFileSync(resolve(canonicalDirectory, "canonical_bundle_manifest.json"), "utf8")) as { breedSemanticFilename: string };
  const archive = openValidatedZip(resolve(canonicalDirectory, "breeds", manifest.breedSemanticFilename));
  const bytes = archive.entries[`${archive.prefix}canonical_breed_identities.jsonl`];
  if (!bytes) throw new Error("Canonical Breed catalog is missing canonical_breed_identities.jsonl");
  const breeds = parseJsonLines(bytes) as BreedIdentity[];
  const civicBytes = archive.entries[`${archive.prefix}effective_breed_semantics.jsonl`];
  const petBytes = archive.entries[`${archive.prefix}pet_policy_semantics.jsonl`];
  if (!civicBytes || !petBytes) throw new Error("Canonical Breed catalog is missing persisted faction projections");
  const factionByBreed = new Map([...parseJsonLines(civicBytes), ...parseJsonLines(petBytes)].map((row) => [String(row.breedId), row as unknown as BreedFactionProjection]));
  if (factionByBreed.size !== breeds.length) throw new Error("Canonical Breed faction projection coverage is incomplete");
  const species = await loadSpeciesIdentities(canonicalDirectory);
  return breeds.map((breed) => {
    const speciesId = breed.speciesId ?? null;
    const speciesIdentity = speciesId ? species.get(speciesId) : undefined;
    const faction = factionByBreed.get(breed.breedId);
    if (!faction) throw new Error(`Canonical Breed faction projection is missing ${breed.breedId}`);
    return {
      breedId: breed.breedId,
      name: breed.name,
      populationKind: breed.populationKind,
      speciesId,
      speciesName: speciesIdentity?.name ?? null,
      scientificName: speciesIdentity?.scientificName ?? derivedScientificName(speciesId),
      groupId: breed.groupId ?? null,
      cultureId: breed.cultureId ?? null,
      factionObject: faction.factionObject,
      dominantFaction: faction.dominantFaction,
    };
  }).sort((left, right) => left.name.localeCompare(right.name) || left.breedId.localeCompare(right.breedId));
}
