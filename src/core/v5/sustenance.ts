import { createHash } from "node:crypto";
import { canonicalJson } from "../serialization/canonical-json.js";

export const NON_REFUGE_FOOD_SPECIFIC_V1 = [
  "ANGER", "BLOOD", "DESIRE", "DREAMS", "EMOTION", "ESSENCE_OF_FAITH", "FEAR", "GRIEF", "MEMORY", "MUSIC_ATTENTION", "NECROMANTIC_ESSENCE", "NO_FEEDING", "OATHS_HONOR", "SIN",
] as const;
export type NonRefugeFoodSpecificV1 = (typeof NON_REFUGE_FOOD_SPECIFIC_V1)[number];

export interface DynamicSustenanceSemanticRevisionV1 {
  revisionId: string;
  foodSpecific: NonRefugeFoodSpecificV1;
  sourceMetricIds: readonly string[];
  semanticDescription: string;
  contentSha256: string;
  status: "UNREVIEWED" | "APPROVED" | "REJECTED" | "SUPERSEDED";
}

export interface DynamicSustenanceNumericRevisionV1 {
  revisionId: string;
  foodSpecific: NonRefugeFoodSpecificV1;
  productionRatePpm: number;
  availabilityRatePpm: number;
  consumptionRatePpm: number;
  decayRatePpm: number;
  scarcityThresholdPpm: number;
  satisfactionPerConsumedUnitPpm: number;
  contentSha256: string;
  status: "UNREVIEWED" | "APPROVED" | "REJECTED" | "SUPERSEDED";
}

export interface DynamicSustenanceTermV1 {
  sustenanceTermId: string;
  worldKey: string;
  settlementId: string;
  foodSpecific: NonRefugeFoodSpecificV1;
  year: number;
  availableQuantity: bigint;
  demandedQuantity: bigint;
  semanticRevisionId: string;
  numericRevisionId: string;
  sourceEventIds: readonly string[];
}

function hash(value: unknown): string { return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex"); }

export function validateNonRefugeFoodSpecificAuthorityV1(values: readonly string[]): void {
  const normalized = [...values].sort(); const expected = [...NON_REFUGE_FOOD_SPECIFIC_V1].sort();
  if (canonicalJson(normalized) !== canonicalJson(expected)) throw new Error(`Non-Refuge FoodSpecific authority must contain exactly ${expected.length} approved classifications`);
}

export function requireApprovedSustenancePoliciesV1(foodSpecific: NonRefugeFoodSpecificV1, semantic: DynamicSustenanceSemanticRevisionV1 | null, numeric: DynamicSustenanceNumericRevisionV1 | null): { semantic: DynamicSustenanceSemanticRevisionV1; numeric: DynamicSustenanceNumericRevisionV1 } {
  if (!semantic || semantic.foodSpecific !== foodSpecific || semantic.status !== "APPROVED") throw new Error(`Dynamic sustenance semantic policy needs approval for ${foodSpecific}`);
  if (!numeric || numeric.foodSpecific !== foodSpecific || numeric.status !== "APPROVED") throw new Error(`Dynamic sustenance numeric policy needs approval for ${foodSpecific}`);
  const semanticContent = { foodSpecific: semantic.foodSpecific, sourceMetricIds: semantic.sourceMetricIds, semanticDescription: semantic.semanticDescription };
  const numericContent = { foodSpecific: numeric.foodSpecific, productionRatePpm: numeric.productionRatePpm, availabilityRatePpm: numeric.availabilityRatePpm, consumptionRatePpm: numeric.consumptionRatePpm, decayRatePpm: numeric.decayRatePpm, scarcityThresholdPpm: numeric.scarcityThresholdPpm, satisfactionPerConsumedUnitPpm: numeric.satisfactionPerConsumedUnitPpm };
  for (const key of ["productionRatePpm", "availabilityRatePpm", "consumptionRatePpm", "decayRatePpm", "scarcityThresholdPpm", "satisfactionPerConsumedUnitPpm"] as const) {
    const value = numericContent[key];
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Dynamic sustenance numeric policy has invalid ${key} for ${foodSpecific}`);
  }
  if (hash(semanticContent) !== semantic.contentSha256 || hash(numericContent) !== numeric.contentSha256) throw new Error(`Dynamic sustenance policy content changed after approval for ${foodSpecific}`);
  return { semantic, numeric };
}
