import { getDomainDatabase } from "../../persistence/postgres-domain.js";
import { BREED_CATALOG_AUTHORITY_ID } from "../../persistence/canonical-domain-reconciliation.js";
import { hydrateTypedAuthorityValues, type TypedAuthorityValue } from "../../persistence/typed-authority-values.js";

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
  primaryDeity: string | null;
  provisionalDeity: null;
  deityClassificationStatus: BreedDeityAffinityStatus;
}

function dominantFaction(concord: number, schism: number, ruin: number): BreedCatalogEntry["dominantFaction"] {
  const maximum = Math.max(concord, schism, ruin);
  const scores = { CONCORD: concord, SCHISM: schism, RUIN: ruin };
  return (["CONCORD", "SCHISM", "RUIN"] as const).filter((world) => scores[world] === maximum);
}

type MigratedBreedCatalog = {
  schemaVersion: "echoes-breed-catalog-v5";
  breeds: Array<{
    breedId: string;
    name: string;
    populationKind: string;
    speciesId: string | null;
    groupId: string | null;
    cultureId: string | null;
    factionObject: Record<"CONCORD" | "SCHISM" | "RUIN", number>;
    dominantFaction: ("CONCORD" | "SCHISM" | "RUIN")[];
  }>;
};

/** Production Breed browsing reads its independently reconciled PostgreSQL authority. */
export async function loadBreedCatalog(_legacyCanonicalDirectory?: string): Promise<BreedCatalogEntry[]> {
  const database = getDomainDatabase();
  const [revision, breedAuthorities, deities] = await Promise.all([
    database.canonicalAuthorityRevision.findFirst({
      where: { authorityId: BREED_CATALOG_AUTHORITY_ID, status: "APPROVED", migrationReconciliation: { is: { status: "RECONCILED", unexplainedDifferenceCount: 0 } } },
      include: { values: { orderBy: { valuePath: "asc" } } },
      orderBy: [{ effectiveFromYear: "desc" }, { approvedAt: "desc" }, { revisionId: "desc" }],
    }),
    database.breed.findMany({ select: { breedId: true, primaryDeityId: true } }),
    database.deity.findMany({ select: { deityId: true, acceptedName: true } }),
  ]);
  if (!revision) throw new Error("BREED_CATALOG_RECONCILIATION_REQUIRED: run the deterministic canonical-domain reconciliation");
  const catalog = hydrateTypedAuthorityValues(revision.values as TypedAuthorityValue[]) as MigratedBreedCatalog;
  if (catalog.schemaVersion !== "echoes-breed-catalog-v5" || !Array.isArray(catalog.breeds)) throw new Error("BREED_CATALOG_SCHEMA_MISMATCH");
  const primaryDeityByBreed = new Map(breedAuthorities.map((row) => [row.breedId, row.primaryDeityId]));
  const deityNames = new Map(deities.map((deity) => [deity.deityId, deity.acceptedName]));
  const rows = [...catalog.breeds].sort((left, right) => left.name.localeCompare(right.name) || left.breedId.localeCompare(right.breedId));
  const uniqueBreedIds = new Set(rows.map((row) => row.breedId));
  if (rows.length !== 2_062 || uniqueBreedIds.size !== 2_062) throw new Error(`BREED_CATALOG_STABLE_ID_AUDIT_FAILED expected=2062 observed=${rows.length} unique=${uniqueBreedIds.size}`);
  return rows.map((row) => {
    const primaryDeityId = primaryDeityByBreed.get(row.breedId) ?? null;
    return {
      breedId: row.breedId,
      name: row.name,
      populationKind: row.populationKind,
      speciesId: row.speciesId,
      speciesName: null,
      scientificName: null,
      groupId: row.groupId,
      cultureId: row.cultureId,
      factionObject: row.factionObject,
      dominantFaction: row.dominantFaction.length > 0 ? row.dominantFaction : dominantFaction(row.factionObject.CONCORD, row.factionObject.SCHISM, row.factionObject.RUIN),
      primaryDeity: primaryDeityId ? deityNames.get(primaryDeityId) ?? primaryDeityId : null,
      provisionalDeity: null,
      deityClassificationStatus: primaryDeityId && deityNames.has(primaryDeityId) ? "CLASSIFIED" : "REVIEW_REQUIRED",
    };
  });
}
