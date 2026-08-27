import { WORLD_KEYS, type WorldKey } from "../contracts/domain.js";
import { RAW_DIMENSIONS } from "./v4-contract.js";

export const BREED_FACTION_PROJECTION_POLICY = "BREED_FACTION_PROJECTION_V1" as const;
export const BREED_FACTION_POINTS_PER_ATTRIBUTE = 1 as const;
export const BREED_DOMINANT_FACTION_TOLERANCE = 1 as const;

export type BreedFactionObject = Record<WorldKey, number>;
export interface BreedFactionProjection {
  factionObject: BreedFactionObject;
  dominantFaction: WorldKey[];
}
type DimensionValues = Record<string, { value: string }>;
type PropertyMapping = Record<string, Record<WorldKey, string>>;

export interface BreedFactionProjectionReport {
  schemaVersion: "eidolon-breed-faction-projection-report-v1";
  policyRef: typeof BREED_FACTION_PROJECTION_POLICY;
  totalCivicBreeds: number;
  attributesPerBreed: number;
  pointsPerAttribute: typeof BREED_FACTION_POINTS_PER_ATTRIBUTE;
  pointsPerBreed: number;
  dominantFactionTolerance: typeof BREED_DOMINANT_FACTION_TOLERANCE;
  factionPointTotals: BreedFactionObject;
  dominantFactionMembershipCounts: BreedFactionObject;
  dominantFactionCombinationCounts: Record<string, number>;
  factionScoreDistribution: Record<WorldKey, Record<string, number>>;
  multipleDominantFactionBreeds: number;
}

function mappingKey(field: string): string {
  return `${field[0]!.toUpperCase()}${field.slice(1)}`;
}

export function dominantFactionsWithinTolerance(factionObject: BreedFactionObject, tolerance: number): WorldKey[] {
  if (!Number.isInteger(tolerance) || tolerance < 0) throw new Error("Dominant-faction tolerance must be a non-negative integer");
  for (const faction of WORLD_KEYS) if (!Number.isInteger(factionObject[faction]) || factionObject[faction] < 0) throw new Error(`${faction} faction score must be a non-negative integer`);
  const maximum = Math.max(...WORLD_KEYS.map((faction) => factionObject[faction]));
  return WORLD_KEYS.filter((faction) => maximum - factionObject[faction] <= tolerance);
}

export function projectBreedFaction(dimensions: DimensionValues, propertyMapping: PropertyMapping): BreedFactionProjection {
  const factionObject: BreedFactionObject = { CONCORD: 0, SCHISM: 0, RUIN: 0 };
  for (const field of RAW_DIMENSIONS) {
    const value = dimensions[field]?.value;
    const values = propertyMapping[mappingKey(field)];
    const faction = WORLD_KEYS.find((candidate) => values?.[candidate] === value);
    if (!faction) throw new Error(`${field} has uncontrolled faction value ${String(value)}`);
    factionObject[faction] += BREED_FACTION_POINTS_PER_ATTRIBUTE;
  }
  return {
    factionObject,
    dominantFaction: dominantFactionsWithinTolerance(factionObject, BREED_DOMINANT_FACTION_TOLERANCE),
  };
}

export function applyBreedFactionProjection<T extends { breedId: string; dimensions: DimensionValues }>(
  input: readonly T[],
  propertyMapping: PropertyMapping,
): { rows: (T & BreedFactionProjection)[]; report: BreedFactionProjectionReport } {
  const rows = [...input]
    .sort((left, right) => left.breedId.localeCompare(right.breedId))
    .map((row) => ({ ...row, ...projectBreedFaction(row.dimensions, propertyMapping) }));
  const factionPointTotals: BreedFactionObject = { CONCORD: 0, SCHISM: 0, RUIN: 0 };
  const dominantFactionMembershipCounts: BreedFactionObject = { CONCORD: 0, SCHISM: 0, RUIN: 0 };
  const dominantFactionCombinationCounts: Record<string, number> = {};
  const factionScoreDistribution = Object.fromEntries(WORLD_KEYS.map((faction) => [faction, {}])) as Record<WorldKey, Record<string, number>>;
  for (const row of rows) {
    for (const faction of WORLD_KEYS) {
      const score = row.factionObject[faction];
      factionPointTotals[faction] += score;
      factionScoreDistribution[faction][String(score)] = (factionScoreDistribution[faction][String(score)] ?? 0) + 1;
      if (row.dominantFaction.includes(faction)) dominantFactionMembershipCounts[faction] += 1;
    }
    const combination = row.dominantFaction.join("+");
    dominantFactionCombinationCounts[combination] = (dominantFactionCombinationCounts[combination] ?? 0) + 1;
  }
  return {
    rows,
    report: {
      schemaVersion: "eidolon-breed-faction-projection-report-v1",
      policyRef: BREED_FACTION_PROJECTION_POLICY,
      totalCivicBreeds: rows.length,
      attributesPerBreed: RAW_DIMENSIONS.length,
      pointsPerAttribute: BREED_FACTION_POINTS_PER_ATTRIBUTE,
      pointsPerBreed: RAW_DIMENSIONS.length * BREED_FACTION_POINTS_PER_ATTRIBUTE,
      dominantFactionTolerance: BREED_DOMINANT_FACTION_TOLERANCE,
      factionPointTotals,
      dominantFactionMembershipCounts,
      dominantFactionCombinationCounts: Object.fromEntries(Object.entries(dominantFactionCombinationCounts).sort(([left], [right]) => left.localeCompare(right))),
      factionScoreDistribution,
      multipleDominantFactionBreeds: rows.filter((row) => row.dominantFaction.length > 1).length,
    },
  };
}
