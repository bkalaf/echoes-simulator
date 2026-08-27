import type { BreedAuthorityV5, GovernmentPrototypeV5, MechanicsVariablesV1 } from "./config.js";
import { factionCompatibility, normalizeFactionVector, normalizedVectorWeightedMean } from "./fixed-point.js";
import type { FactionVector, WorldKey } from "./types.js";

export const STRUCTURAL_FACTION_ORDER: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];

export function breedFactionVector(breed: BreedAuthorityV5): FactionVector {
  return normalizeFactionVector(breed.factionObject);
}

export function resolveBreedFaction(breed: BreedAuthorityV5, sovereignFaction: WorldKey, sovereignTieBreak: boolean): WorldKey {
  const candidates = [...new Set(breed.dominantFaction)].filter((candidate): candidate is WorldKey => STRUCTURAL_FACTION_ORDER.includes(candidate));
  if (candidates.length === 0) {
    const vector = breedFactionVector(breed);
    const maximum = Math.max(...STRUCTURAL_FACTION_ORDER.map((key) => vector[key]));
    return STRUCTURAL_FACTION_ORDER.find((key) => vector[key] === maximum)!;
  }
  if (candidates.length === 1) return candidates[0]!;
  if (sovereignTieBreak && candidates.includes(sovereignFaction)) return sovereignFaction;
  return STRUCTURAL_FACTION_ORDER.find((key) => candidates.includes(key))!;
}

export function dominantFaction(vector: FactionVector): WorldKey {
  const maximum = Math.max(...STRUCTURAL_FACTION_ORDER.map((key) => vector[key]));
  return STRUCTURAL_FACTION_ORDER.find((key) => vector[key] === maximum)!;
}

export function updateDominantFaction(incumbent: WorldKey, vector: FactionVector, switchMargin: number): WorldKey {
  const challenger = dominantFaction(vector);
  if (challenger === incumbent) return incumbent;
  return vector[challenger] >= vector[incumbent] + switchMargin ? challenger : incumbent;
}

export function governmentDoctrineVector(government: GovernmentPrototypeV5): FactionVector {
  return normalizeFactionVector(government.doctrineVector);
}

export function stateFactionTarget(
  population: FactionVector,
  government: FactionVector,
  rulingCoalition: FactionVector,
  institutions: FactionVector,
  variables: MechanicsVariablesV1,
): FactionVector {
  const weights = variables.stateFactionWeights;
  return normalizedVectorWeightedMean(
    [population, weights.population], [government, weights.government], [rulingCoalition, weights.rulingCoalition], [institutions, weights.institutions],
  );
}

export { factionCompatibility };
