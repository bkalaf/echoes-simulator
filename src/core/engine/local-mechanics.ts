import type { Faction, WorldKey } from "../contracts/domain.js";
import { apportionLargestRemainder, ceilDiv, compareRatio } from "../math/exact.js";

export type GrowthBand = "LOW" | "MEDIUM" | "HIGH";
const GROWTH_RATES: Record<GrowthBand, readonly [bigint, bigint]> = { LOW: [1n, 200n], MEDIUM: [1n, 100n], HIGH: [3n, 200n] };
const WORLD_PRIORITY: Record<WorldKey, readonly Faction[]> = { CONCORD: ["CONCORD", "SCHISM", "RUIN"], SCHISM: ["SCHISM", "RUIN", "CONCORD"], RUIN: ["RUIN", "CONCORD", "SCHISM"] };

export function allocateEqualPopulation(breedIds: readonly string[], total: bigint): Map<string, bigint> {
  const sorted = [...breedIds].sort();
  const weights = sorted.map(() => 1n);
  return new Map(sorted.map((id, index) => [id, apportionLargestRemainder(total, weights, sorted)[index]!]));
}

export function accrueGrowth(population: bigint, band: GrowthBand): bigint {
  const [numerator, denominator] = GROWTH_RATES[band];
  return ceilDiv(population * numerator, denominator);
}

interface CohortProjectionInput { breedId: string; population: bigint; }
type BreedProperties = Map<string, Record<string, string | null>>;
interface PropertyMapping { [property: string]: Record<Faction, string>; }

export interface ValueProjection { population: bigint; numerator: bigint; denominator: bigint; band: "LOW" | "MID" | "HIGH"; points: number; faction: Faction; }
export interface PropertyProjection { resolvedPopulation: bigint; unresolvedPopulation: bigint; winner: string | null; values: Record<string, ValueProjection>; tieBreak: string | null; }
export interface ResearchPropertyProjection extends PropertyProjection { terminalNullPopulation: bigint; invalidUnresearchedPopulation: bigint; }
export interface ProjectionBlocker {
  issueCode: "NO_RESOLVED_POPULATION_FOR_PROPERTY" | "INVALID_OR_UNRESEARCHED_PROPERTY_POPULATION";
  worldKey: WorldKey;
  year: number;
  entityType: "SETTLEMENT" | "STATE";
  entityId: string;
  property: string;
  affectedPopulation: bigint;
}

function priorityIndex(world: WorldKey, faction: Faction): number { return WORLD_PRIORITY[world].indexOf(faction); }

export function projectRawProperties(cohorts: readonly CohortProjectionInput[], breeds: BreedProperties, world: WorldKey, mapping: PropertyMapping): { properties: Record<string, PropertyProjection>; dominantFaction: Faction; factionPoints: Record<Faction, number> } {
  const properties: Record<string, PropertyProjection> = {};
  const factionPoints: Record<Faction, number> = { CONCORD: 0, SCHISM: 0, RUIN: 0 };
  for (const [property, factionValues] of Object.entries(mapping)) {
    const valueToFaction = new Map(Object.entries(factionValues).map(([faction, value]) => [value, faction as Faction]));
    const populations = new Map<string, bigint>();
    let unresolvedPopulation = 0n;
    for (const cohort of cohorts) {
      const value = breeds.get(cohort.breedId)?.[property] ?? null;
      if (!value) unresolvedPopulation += cohort.population;
      else populations.set(value, (populations.get(value) ?? 0n) + cohort.population);
    }
    const resolvedPopulation = [...populations.values()].reduce((sum, value) => sum + value, 0n);
    const values: Record<string, ValueProjection> = {};
    for (const [value, population] of populations) {
      const faction = valueToFaction.get(value);
      if (!faction) throw new Error(`Unknown ${property} value ${value}`);
      const versus30 = resolvedPopulation === 0n ? -1 : compareRatio(population, resolvedPopulation, 3n, 10n);
      const versus50 = resolvedPopulation === 0n ? -1 : compareRatio(population, resolvedPopulation, 1n, 2n);
      const band = versus30 < 0 ? "LOW" : versus50 <= 0 ? "MID" : "HIGH";
      const points = band === "LOW" ? 0 : band === "MID" ? 1 : 2;
      factionPoints[faction] += points;
      values[value] = { population, numerator: population, denominator: resolvedPopulation, band, points, faction };
    }
    const candidates = [...populations.entries()].sort(([valueA, popA], [valueB, popB]) => {
      if (popA !== popB) return popA > popB ? -1 : 1;
      return priorityIndex(world, valueToFaction.get(valueA)!) - priorityIndex(world, valueToFaction.get(valueB)!);
    });
    const tied = candidates.length > 1 && candidates[0]![1] === candidates[1]![1];
    properties[property] = { resolvedPopulation, unresolvedPopulation, winner: candidates[0]?.[0] ?? null, values, tieBreak: tied ? `WORLD_PRIORITY_${world}` : null };
  }
  const dominantFaction = (["CONCORD", "SCHISM", "RUIN"] as Faction[]).sort((a, b) => factionPoints[b] - factionPoints[a] || priorityIndex(world, a) - priorityIndex(world, b))[0]!;
  return { properties, dominantFaction, factionPoints };
}

type ResearchValueDisposition = "VERIFIED_VALUE" | "INHERITED_VERIFIED_VALUE" | "POLICY_DEFAULT" | "POLICY_NULL" | "RESOLVED_NULL" | "UNRESOLVED" | "REVIEW_REQUIRED";
type ResearchBreedProperties = Map<string, Record<string, { value: string | null; disposition: ResearchValueDisposition }>>;
const RESOLVED_VALUE_DISPOSITIONS = new Set<ResearchValueDisposition>(["VERIFIED_VALUE", "INHERITED_VERIFIED_VALUE", "POLICY_DEFAULT"]);
const TERMINAL_NULL_DISPOSITIONS = new Set<ResearchValueDisposition>(["POLICY_NULL", "RESOLVED_NULL"]);

export function projectResearchProperties(
  cohorts: readonly CohortProjectionInput[],
  breeds: ResearchBreedProperties,
  world: WorldKey,
  mapping: PropertyMapping,
  context: { worldKey: WorldKey; year: number; entityType: "SETTLEMENT" | "STATE"; entityId: string },
): { properties: Record<string, ResearchPropertyProjection>; dominantFaction: Faction | null; factionPoints: Record<Faction, number>; blockers: ProjectionBlocker[] } {
  const properties: Record<string, ResearchPropertyProjection> = {};
  const blockers: ProjectionBlocker[] = [];
  const factionPoints: Record<Faction, number> = { CONCORD: 0, SCHISM: 0, RUIN: 0 };
  for (const [property, factionValues] of Object.entries(mapping)) {
    const valueToFaction = new Map(Object.entries(factionValues).map(([faction, value]) => [value, faction as Faction]));
    const populations = new Map<string, bigint>();
    let terminalNullPopulation = 0n;
    let invalidUnresearchedPopulation = 0n;
    for (const cohort of cohorts) {
      const researched = breeds.get(cohort.breedId)?.[property];
      if (!researched || ![...RESOLVED_VALUE_DISPOSITIONS, ...TERMINAL_NULL_DISPOSITIONS].includes(researched.disposition)) {
        invalidUnresearchedPopulation += cohort.population;
      } else if (TERMINAL_NULL_DISPOSITIONS.has(researched.disposition)) {
        terminalNullPopulation += cohort.population;
      } else if (RESOLVED_VALUE_DISPOSITIONS.has(researched.disposition) && researched.value !== null) {
        if (!valueToFaction.has(researched.value)) throw new Error(`Unknown ${property} value ${researched.value}`);
        populations.set(researched.value, (populations.get(researched.value) ?? 0n) + cohort.population);
      } else {
        invalidUnresearchedPopulation += cohort.population;
      }
    }
    const resolvedPopulation = [...populations.values()].reduce((sum, value) => sum + value, 0n);
    const values: Record<string, ValueProjection> = {};
    for (const [value, population] of populations) {
      const faction = valueToFaction.get(value)!;
      const versus30 = compareRatio(population, resolvedPopulation, 3n, 10n);
      const versus50 = compareRatio(population, resolvedPopulation, 1n, 2n);
      const band = versus30 < 0 ? "LOW" : versus50 <= 0 ? "MID" : "HIGH";
      const points = band === "LOW" ? 0 : band === "MID" ? 1 : 2;
      factionPoints[faction] += points;
      values[value] = { population, numerator: population, denominator: resolvedPopulation, band, points, faction };
    }
    const candidates = [...populations.entries()].sort(([valueA, popA], [valueB, popB]) => popA !== popB ? (popA > popB ? -1 : 1) : priorityIndex(world, valueToFaction.get(valueA)!) - priorityIndex(world, valueToFaction.get(valueB)!));
    const tied = candidates.length > 1 && candidates[0]![1] === candidates[1]![1];
    properties[property] = { resolvedPopulation, terminalNullPopulation, invalidUnresearchedPopulation, unresolvedPopulation: invalidUnresearchedPopulation, winner: candidates[0]?.[0] ?? null, values, tieBreak: tied ? `WORLD_PRIORITY_${world}` : null };
    if (invalidUnresearchedPopulation > 0n) blockers.push({ issueCode: "INVALID_OR_UNRESEARCHED_PROPERTY_POPULATION", ...context, property, affectedPopulation: invalidUnresearchedPopulation });
    if (resolvedPopulation === 0n) blockers.push({ issueCode: "NO_RESOLVED_POPULATION_FOR_PROPERTY", ...context, property, affectedPopulation: terminalNullPopulation + invalidUnresearchedPopulation });
  }
  const hasResolved = Object.values(properties).some((projection) => projection.resolvedPopulation > 0n);
  const dominantFaction = hasResolved ? (["CONCORD", "SCHISM", "RUIN"] as Faction[]).sort((a, b) => factionPoints[b] - factionPoints[a] || priorityIndex(world, a) - priorityIndex(world, b))[0]! : null;
  return { properties, dominantFaction, factionPoints, blockers };
}

export function derivePoliticalForm(winners: Record<string, string>, rows: readonly Record<string, string>[]): string {
  const match = rows.find((row) => row.administrationMode === winners.administrationMode && row.legitimacyBasis === winners.legitimacyBasis && row.authoritySource === winners.authoritySource);
  if (!match) throw new Error("No Political Form mapping");
  return match.politicalForm!;
}

export function deriveEconomicForm(winners: Record<string, string>, rows: readonly Record<string, string>[]): string {
  const match = rows.find((row) => row.ownershipMode === winners.ownershipMode && row.allocationMode === winners.allocationMode);
  if (!match) throw new Error("No Economic Form mapping");
  return match.economicForm!;
}

export function updateEpochLatch(remaining: readonly string[], previous: Record<string, string>, current: Record<string, string>): { remaining: string[]; consumed: string[]; triggered: boolean } {
  const consumed = remaining.filter((key) => previous[key] !== current[key]);
  const next = remaining.filter((key) => !consumed.includes(key));
  return { remaining: next, consumed, triggered: next.length === 0 };
}

interface SocialInput { cohortId: string; breedId: string; wealth: number; population: bigint; }
interface SocialSegment { cohortId: string; breedId: string; wealth: number; tier: "HIGH" | "MID" | "LOW"; population: bigint; }
export function deriveSocialProjection(inputs: readonly SocialInput[]): { tiers: Record<"HIGH" | "MID" | "LOW", bigint>; classes: Record<"NOBILITY" | "WORKER" | "INTELLECTUAL" | "WANDERER", bigint>; segments: SocialSegment[] } {
  if (inputs.some((input) => input.population < 0n)) throw new Error("Social projection cannot use negative population");
  const total = inputs.reduce((sum, input) => sum + input.population, 0n);
  let high = total * 33n / 100n;
  let mid = total * 33n / 100n;
  if (total >= 3n) { if (high === 0n) high = 1n; if (mid === 0n) mid = 1n; }
  const low = total - high - mid;
  const tiers = { HIGH: high, MID: mid, LOW: low };
  const classes = { NOBILITY: 0n, WORKER: 0n, INTELLECTUAL: 0n, WANDERER: 0n };
  const segments: SocialSegment[] = [];
  const remainingByTier: Record<"HIGH" | "MID" | "LOW", bigint> = { ...tiers };
  const ordered = [...inputs].sort((a, b) => b.wealth - a.wealth || a.breedId.localeCompare(b.breedId) || a.cohortId.localeCompare(b.cohortId));
  for (const input of ordered) {
    let remaining = input.population;
    for (const tier of ["HIGH", "MID", "LOW"] as const) {
      const assigned = remaining < remainingByTier[tier] ? remaining : remainingByTier[tier];
      if (assigned > 0n) segments.push({ ...input, tier, population: assigned });
      remaining -= assigned;
      remainingByTier[tier] -= assigned;
    }
    if (remaining !== 0n) throw new Error(`Social segmentation failed for ${input.cohortId}`);
  }
  const split = (value: bigint): [bigint, bigint] => [(value + 1n) / 2n, value / 2n];
  for (const segment of segments) {
    const [first, second] = split(segment.population);
    if (segment.tier === "HIGH") { classes.NOBILITY += first; classes.INTELLECTUAL += second; }
    else if (segment.tier === "MID") { classes.INTELLECTUAL += first; classes.WORKER += second; }
    else { classes.WORKER += first; classes.WANDERER += second; }
  }
  return { tiers, classes, segments };
}

export function wealthIncrement(breedFaction: Faction, settlementFaction: Faction, stateFaction: Faction, sovereignFaction: Faction): number {
  const matrix: Record<Faction, Record<Faction, number>> = { CONCORD: { CONCORD: 3, RUIN: 2, SCHISM: 1 }, SCHISM: { CONCORD: 2, RUIN: 1, SCHISM: 3 }, RUIN: { CONCORD: 1, RUIN: 3, SCHISM: 2 } };
  const controls = [settlementFaction, stateFaction, sovereignFaction];
  let modifier: number;
  const counts = new Map<Faction, number>();
  for (const faction of controls) counts.set(faction, (counts.get(faction) ?? 0) + 1);
  if (counts.size === 1) modifier = breedFaction === controls[0] ? 4 : -2;
  else if (counts.size === 3) modifier = -1;
  else {
    const double = [...counts].find(([, count]) => count === 2)![0];
    const single = [...counts].find(([, count]) => count === 1)![0];
    modifier = breedFaction === double ? 2 : breedFaction === single ? 1 : -2;
  }
  return controls.reduce((sum, faction) => sum + matrix[breedFaction][faction], 0) + modifier;
}
