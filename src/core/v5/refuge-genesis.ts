import { createHash } from "node:crypto";
import type { WorldKey } from "./types.js";
import { NON_REFUGE_FOOD_SPECIFIC_V1 } from "./sustenance.js";

export const FOOD_SPECIFIC_VALUES_V1 = [
  "AIR_WIND", "ALGAE_SEAWEED", "ANGER", "AQUATIC_PLANTS", "ARTHROPODS", "BAMBOO", "BERRIES", "BIRDS", "BLOOD", "BONE_MARROW", "BREAD_PORRIDGE", "CARRION", "COLD_ICE", "DAIRY", "DESIRE", "DETRITUS_COMPOST", "DREAMS", "EGGS", "ELECTRICITY_STORM", "EMOTION", "ESSENCE_OF_FAITH", "FEAR", "FERMENTED_DRINK", "FIRE", "FISH", "FLOWERS_POLLEN", "FRUIT", "FUNGI", "GLASS_SAND", "GRASSES", "GRIEF", "HERBS_SPICES", "HONEY", "INSECTS", "LEAVES", "LIGHT", "MAGIC", "MEMORY", "METAL_ORE", "MIXED_DIET", "MOLLUSKS", "MOONLIGHT", "MUSIC_ATTENTION", "NECROMANTIC_ESSENCE", "NECTAR", "NO_FEEDING", "NUTS", "OATHS_HONOR", "OIL_FUEL", "PLANKTON_KRILL", "PREPARED_MEALS", "RED_MEAT", "REPTILES_AMPHIBIANS", "ROOTS_TUBERS", "SALT", "SAP_RESIN", "SEEDS_GRAINS", "SHELLFISH_CRUSTACEANS", "SIN", "SMALL_GAME", "STONE_CLAY", "WATER", "WOODY_BIOMASS", "WORMS_LARVAE",
] as const;
export const FOOD_SPECIFIC_SELECTORS_V1 = ["MAGIC", "MIXED_DIET", "PREPARED_MEALS"] as const;
const excluded = new Set<string>([...NON_REFUGE_FOOD_SPECIFIC_V1, ...FOOD_SPECIFIC_SELECTORS_V1]);
export const REFUGE_ELIGIBLE_FOOD_SPECIFIC_V1 = FOOD_SPECIFIC_VALUES_V1.filter((value) => !excluded.has(value));

export interface RefugeGenesisPlacementAuthorityV1 { revisionId: string; status: "APPROVED" | "UNREVIEWED"; siteIdsByFoodSpecific: Readonly<Record<string, readonly string[]>> }
export interface RefugeGenesisNodeV1 { refugeId: string; worldKey: WorldKey; foodSpecific: string; genesisOrdinal: 1 | 2; siteId: string; placementAuthorityRevisionId: string }
export interface BreedFoodSpecificV1 { breedId: string; foodSpecific: readonly string[] }

export function refugeConsumerCountsV1(breeds: readonly BreedFoodSpecificV1[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = Object.fromEntries(REFUGE_ELIGIBLE_FOOD_SPECIFIC_V1.map((value) => [value, 0]));
  for (const breed of breeds) for (const value of new Set(breed.foodSpecific)) if (value in counts) counts[value] += 1;
  return counts;
}

export function buildRefugeGenesisV1(input: { worldKey: WorldKey; breeds: readonly BreedFoodSpecificV1[]; placementAuthority: RefugeGenesisPlacementAuthorityV1 }): RefugeGenesisNodeV1[] {
  if (FOOD_SPECIFIC_VALUES_V1.length !== 64 || REFUGE_ELIGIBLE_FOOD_SPECIFIC_V1.length !== 47) throw new Error("FoodSpecific authority must contain 61 terminals, 47 Refuge-eligible terminals, 14 non-Refuge terminals, and three selectors");
  if (input.placementAuthority.status !== "APPROVED") throw new Error("REFUGE_PLACEMENT_AUTHORITY_REQUIRED");
  const counts = refugeConsumerCountsV1(input.breeds);
  const result: RefugeGenesisNodeV1[] = [];
  for (const foodSpecific of REFUGE_ELIGIBLE_FOOD_SPECIFIC_V1) {
    const required = counts[foodSpecific]! > 100 ? 2 : 1;
    const sites = input.placementAuthority.siteIdsByFoodSpecific[foodSpecific] ?? [];
    if (sites.length < required || new Set(sites.slice(0, required)).size !== required) throw new Error(`Refuge placement authority needs ${required} unique Site IDs for ${foodSpecific}`);
    for (let ordinal = 1; ordinal <= required; ordinal += 1) result.push({ refugeId: `REFUGE_${createHash("sha256").update(`${foodSpecific}\0${ordinal}`).digest("hex").slice(0, 24)}`, worldKey: input.worldKey, foodSpecific, genesisOrdinal: ordinal as 1 | 2, siteId: sites[ordinal - 1]!, placementAuthorityRevisionId: input.placementAuthority.revisionId });
  }
  if (!result.some((node) => node.foodSpecific === "MOONLIGHT")) throw new Error("MOONLIGHT requires one Refuge");
  if (result.some((node) => FOOD_SPECIFIC_SELECTORS_V1.includes(node.foodSpecific as typeof FOOD_SPECIFIC_SELECTORS_V1[number]))) throw new Error("Selector values cannot become Refuges");
  return result;
}
