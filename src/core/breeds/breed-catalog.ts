import { getDomainDatabase } from "../../persistence/postgres-domain.js";
import { loadPostgresCanonicalV5 } from "../../persistence/postgres-canonical.js";

export type BreedDeityAffinityStatus = "CLASSIFIED" | "REVIEW_REQUIRED";

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
  primaryDeity: string;
  provisionalDeity: null;
  deityClassificationStatus: BreedDeityAffinityStatus;
}

function dominantFaction(concord: number, schism: number, ruin: number): BreedCatalogEntry["dominantFaction"] {
  const maximum = Math.max(concord, schism, ruin);
  const scores = { CONCORD: concord, SCHISM: schism, RUIN: ruin };
  return (["CONCORD", "SCHISM", "RUIN"] as const).filter((world) => scores[world] === maximum);
}

/** Production Breed identity and primary-Deity authority is PostgreSQL-only. */
export async function loadBreedCatalog(_legacyCanonicalDirectory?: string): Promise<BreedCatalogEntry[]> {
  const [{ canonical }, deities] = await Promise.all([loadPostgresCanonicalV5(), getDomainDatabase().deity.findMany({ select: { deityId: true, acceptedName: true } })]);
  const deityNames = new Map(deities.map((deity) => [deity.deityId, deity.acceptedName]));
  const rows = [...canonical.breeds].sort((left, right) => (left.acceptedName ?? left.breedId).localeCompare(right.acceptedName ?? right.breedId) || left.breedId.localeCompare(right.breedId));
  const uniqueBreedIds = new Set(rows.map((row) => row.breedId));
  if (rows.length !== 2_062 || uniqueBreedIds.size !== 2_062) throw new Error(`BREED_PRIMARY_DEITY_AUTHORITY_REQUIRED expected=2062 observed=${rows.length} unique=${uniqueBreedIds.size}; open Owner Policy Center > Breed primary Deity reconstruction`);
  return rows.map((row) => ({
    breedId: row.breedId,
    name: row.acceptedName ?? row.breedId,
    populationKind: row.populationKind,
    speciesId: null,
    speciesName: null,
    scientificName: null,
    groupId: row.groupId,
    cultureId: null,
    factionObject: row.factionObject,
    dominantFaction: dominantFaction(row.factionObject.CONCORD, row.factionObject.SCHISM, row.factionObject.RUIN),
    primaryDeity: deityNames.get(row.primaryDeityId!) ?? row.primaryDeityId!,
    provisionalDeity: null,
    deityClassificationStatus: "CLASSIFIED",
  }));
}
