import { createHash } from "node:crypto";
import type { Faction, WorldKey } from "../contracts/domain.js";
import { RAW_DIMENSIONS, type EffectiveBreedSemantics } from "../research/v4-contract.js";
import { initializeCivicCohorts, type Cohort } from "./cohort-engine.js";
import { deriveEconomicForm, derivePoliticalForm, projectRawProperties } from "./local-mechanics.js";

const WORLDS: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];
const WORLD_PRIORITY: Record<WorldKey, readonly Faction[]> = { CONCORD: ["CONCORD", "SCHISM", "RUIN"], SCHISM: ["SCHISM", "RUIN", "CONCORD"], RUIN: ["RUIN", "CONCORD", "SCHISM"] };

export interface Year0Identity { breedId: string; populationKind: "HUMAN" | "BEAST" | "MYTHOS" | "PET"; groupId: string; cultureId: string | null; }
export interface Year0Assignment { groupId: string; regionId: string; }
export interface Year0Site { siteId: string; regionId: string; currentSiteName: string; }
export interface Year0ReadinessInput {
  seed: string;
  identities: Year0Identity[];
  effectiveBreeds: EffectiveBreedSemantics[];
  assignments: Year0Assignment[];
  foundingSites: Year0Site[];
  propertyMapping: Record<string, Record<Faction, string>>;
  politicalRows: Record<string, string>[];
  economicRows: Record<string, string>[];
}

export interface Year0SettlementWorld {
  world: WorldKey;
  year: 0;
  settlementId: string;
  siteId: string;
  regionId: string;
  currentName: string;
  population: string;
  humanPopulation: string;
  cultureId: string | null;
  cultureState: "CALCULATED" | "NO_HUMAN_FOUNDING_CULTURE";
  dominantFaction: Faction;
  politicalForm: string;
  economicForm: string;
  dominantBreed: string;
  dominantSpeciesKind: "HUMAN" | "BEAST" | "MYTHOS";
  propertyCoverage: Record<string, { resolvedPopulation: string; totalPopulation: string }>;
  criticalFailures: string[];
}

export interface Year0ReadinessReport {
  schemaVersion: "eidolon-v4-year0-readiness-v1";
  status: "PASS" | "FAIL";
  seed: string;
  worlds: 3;
  physicalSettlements: 24;
  settlementWorlds: 72;
  totalPopulationPerWorld: "2000000";
  propertyChecks: number;
  noResolvedPopulationIssues: number;
  nullDominantFaction: number;
  nullPoliticalForm: number;
  nullEconomicForm: number;
  nullDominantBreed: number;
  settlementWorldResults: Year0SettlementWorld[];
}

function camelProperty(name: string): string { return `${name[0]!.toLowerCase()}${name.slice(1)}`; }
function rank(world: WorldKey, faction: Faction): number { return WORLD_PRIORITY[world].indexOf(faction); }
function hashOrder(seed: string, parts: readonly string[]): string { return createHash("sha256").update([seed, ...parts].join("\0")).digest("hex"); }

function breedFaction(semantic: EffectiveBreedSemantics, world: WorldKey, mapping: Record<string, Record<Faction, string>>): Faction {
  const scores: Record<Faction, number> = { CONCORD: 0, SCHISM: 0, RUIN: 0 };
  for (const [property, values] of Object.entries(mapping)) {
    const value = semantic.dimensions[property as keyof EffectiveBreedSemantics["dimensions"]]?.value;
    for (const faction of WORLDS) if (values[faction] === value) scores[faction] += 1;
  }
  return [...WORLDS].sort((left, right) => scores[right] - scores[left] || rank(world, left) - rank(world, right))[0]!;
}

function selectCulture(seed: string, world: WorldKey, settlementId: string, humans: Cohort[], identityById: Map<string, Year0Identity>, semanticById: Map<string, EffectiveBreedSemantics>, mapping: Record<string, Record<Faction, string>>): string | null {
  const totals = new Map<string, bigint>();
  const aligned = new Map<string, bigint>();
  for (const cohort of humans) {
    const cultureId = identityById.get(cohort.breedId)?.cultureId;
    const semantic = semanticById.get(cohort.breedId);
    if (!cultureId || !semantic) continue;
    totals.set(cultureId, (totals.get(cultureId) ?? 0n) + cohort.population);
    if (breedFaction(semantic, world, mapping) === world) aligned.set(cultureId, (aligned.get(cultureId) ?? 0n) + cohort.population);
  }
  return [...totals.keys()].sort((left, right) => {
    const totalLeft = totals.get(left)!; const totalRight = totals.get(right)!;
    if (totalLeft !== totalRight) return totalLeft > totalRight ? -1 : 1;
    const alignedLeft = aligned.get(left) ?? 0n; const alignedRight = aligned.get(right) ?? 0n;
    if (alignedLeft !== alignedRight) return alignedLeft > alignedRight ? -1 : 1;
    return hashOrder(seed, [world, settlementId, "CULTURE", left]).localeCompare(hashOrder(seed, [world, settlementId, "CULTURE", right]));
  })[0] ?? null;
}

function selectDominantSpeciesKind(seed: string, world: WorldKey, settlementId: string, residents: Cohort[], identityById: Map<string, Year0Identity>): "HUMAN" | "BEAST" | "MYTHOS" {
  const totals = new Map<"HUMAN" | "BEAST" | "MYTHOS", bigint>();
  for (const cohort of residents) {
    const kind = identityById.get(cohort.breedId)?.populationKind;
    if (kind && kind !== "PET") totals.set(kind, (totals.get(kind) ?? 0n) + cohort.population);
  }
  if ((totals.get("HUMAN") ?? 0n) > 0n) return "HUMAN";
  const selected = [...totals].sort(([leftKind, left], [rightKind, right]) => left !== right ? (left > right ? -1 : 1) : hashOrder(seed, [world, settlementId, "DOMINANT_SPECIES_KIND", leftKind]).localeCompare(hashOrder(seed, [world, settlementId, "DOMINANT_SPECIES_KIND", rightKind])))[0]?.[0];
  if (!selected) throw new Error(`${settlementId} has no civic population for dominant species-kind calculation`);
  return selected;
}

function selectDominantBreed(seed: string, world: WorldKey, settlementId: string, candidates: Cohort[], cultureId: string | null, identityById: Map<string, Year0Identity>, semanticById: Map<string, EffectiveBreedSemantics>, mapping: Record<string, Record<Faction, string>>): string | null {
  return [...candidates].sort((left, right) => {
    if (left.population !== right.population) return left.population > right.population ? -1 : 1;
    const cultureLeft = identityById.get(left.breedId)?.cultureId === cultureId ? 1 : 0; const cultureRight = identityById.get(right.breedId)?.cultureId === cultureId ? 1 : 0;
    if (cultureLeft !== cultureRight) return cultureRight - cultureLeft;
    const alignedLeft = breedFaction(semanticById.get(left.breedId)!, world, mapping) === world ? 1 : 0; const alignedRight = breedFaction(semanticById.get(right.breedId)!, world, mapping) === world ? 1 : 0;
    if (alignedLeft !== alignedRight) return alignedRight - alignedLeft;
    return hashOrder(seed, [world, settlementId, "DOMINANT_BREED", left.breedId]).localeCompare(hashOrder(seed, [world, settlementId, "DOMINANT_BREED", right.breedId]));
  })[0]?.breedId ?? null;
}

export function calculateYear0Readiness(input: Year0ReadinessInput): Year0ReadinessReport {
  const civic = input.identities.filter((row) => row.populationKind !== "PET");
  if (civic.length !== 1773 || input.effectiveBreeds.length !== 1773) throw new Error("Year 0 requires exactly 1,773 civic identities and effective semantics");
  const sites = input.foundingSites.filter((row) => row.regionId !== "R10").sort((left, right) => left.regionId.localeCompare(right.regionId));
  if (sites.length !== 24 || new Set(sites.map((row) => row.regionId)).size !== 24) throw new Error("Year 0 requires one founding Settlement in every non-R10 Region");
  const mapping = Object.fromEntries(Object.entries(input.propertyMapping).map(([property, values]) => [camelProperty(property), values]));
  if (Object.keys(mapping).length !== RAW_DIMENSIONS.length) throw new Error("Year 0 requires mappings for all twelve raw properties");
  const identityById = new Map(input.identities.map((row) => [row.breedId, row]));
  const semanticById = new Map(input.effectiveBreeds.map((row) => [row.breedId, row]));
  const breedProperties = new Map(input.effectiveBreeds.map((row) => [row.breedId, Object.fromEntries(RAW_DIMENSIONS.map((field) => [field, row.dimensions[field].value]))]));
  const settlementWorldResults: Year0SettlementWorld[] = [];

  for (const world of WORLDS) {
    const cohorts = initializeCivicCohorts(world, civic, input.assignments, sites, 2_000_000n);
    if (cohorts.reduce((sum, cohort) => sum + cohort.population, 0n) !== 2_000_000n) throw new Error(`${world} initial population is not conserved`);
    for (const site of sites) {
      const settlementId = `SETTLEMENT_${world}_${site.siteId}`;
      const residents = cohorts.filter((cohort) => cohort.settlementId === settlementId);
      const population = residents.reduce((sum, cohort) => sum + cohort.population, 0n);
      const humans = residents.filter((cohort) => identityById.get(cohort.breedId)?.populationKind === "HUMAN");
      const humanPopulation = humans.reduce((sum, cohort) => sum + cohort.population, 0n);
      const projection = projectRawProperties(residents, breedProperties, world, mapping);
      const winners = Object.fromEntries(Object.entries(projection.properties).map(([property, value]) => [property, value.winner!]));
      const politicalForm = derivePoliticalForm(winners, input.politicalRows);
      const economicForm = deriveEconomicForm(winners, input.economicRows);
      const cultureId = selectCulture(input.seed, world, settlementId, humans, identityById, semanticById, mapping);
      const dominantSpeciesKind = selectDominantSpeciesKind(input.seed, world, settlementId, residents, identityById);
      const dominantCandidates = residents.filter((cohort) => identityById.get(cohort.breedId)?.populationKind === dominantSpeciesKind);
      const dominantBreed = selectDominantBreed(input.seed, world, settlementId, dominantCandidates, cultureId, identityById, semanticById, mapping);
      const criticalFailures: string[] = [];
      const propertyCoverage = Object.fromEntries(Object.entries(projection.properties).map(([property, value]) => {
        if (value.resolvedPopulation !== population) criticalFailures.push(`NO_RESOLVED_POPULATION_FOR_PROPERTY:${property}`);
        return [property, { resolvedPopulation: value.resolvedPopulation.toString(), totalPopulation: population.toString() }];
      }));
      if (!projection.dominantFaction) criticalFailures.push("NULL_DOMINANT_FACTION");
      if (!politicalForm) criticalFailures.push("NULL_POLITICAL_FORM");
      if (!economicForm) criticalFailures.push("NULL_ECONOMIC_FORM");
      if (!dominantBreed) criticalFailures.push("NULL_DOMINANT_BREED");
      if (humanPopulation > 0n && !cultureId) criticalFailures.push("NULL_HUMAN_CULTURE");
      settlementWorldResults.push({ world, year: 0, settlementId, siteId: site.siteId, regionId: site.regionId, currentName: site.currentSiteName, population: population.toString(), humanPopulation: humanPopulation.toString(), cultureId, cultureState: cultureId ? "CALCULATED" : "NO_HUMAN_FOUNDING_CULTURE", dominantFaction: projection.dominantFaction, politicalForm, economicForm, dominantBreed: dominantBreed!, dominantSpeciesKind, propertyCoverage, criticalFailures });
    }
  }
  const noResolvedPopulationIssues = settlementWorldResults.reduce((sum, row) => sum + row.criticalFailures.filter((failure) => failure.startsWith("NO_RESOLVED_POPULATION_FOR_PROPERTY")).length, 0);
  const nullDominantFaction = settlementWorldResults.filter((row) => row.criticalFailures.includes("NULL_DOMINANT_FACTION")).length;
  const nullPoliticalForm = settlementWorldResults.filter((row) => row.criticalFailures.includes("NULL_POLITICAL_FORM")).length;
  const nullEconomicForm = settlementWorldResults.filter((row) => row.criticalFailures.includes("NULL_ECONOMIC_FORM")).length;
  const nullDominantBreed = settlementWorldResults.filter((row) => row.criticalFailures.includes("NULL_DOMINANT_BREED")).length;
  return { schemaVersion: "eidolon-v4-year0-readiness-v1", status: settlementWorldResults.every((row) => row.criticalFailures.length === 0) ? "PASS" : "FAIL", seed: input.seed, worlds: 3, physicalSettlements: 24, settlementWorlds: 72, totalPopulationPerWorld: "2000000", propertyChecks: settlementWorldResults.length * RAW_DIMENSIONS.length, noResolvedPopulationIssues, nullDominantFaction, nullPoliticalForm, nullEconomicForm, nullDominantBreed, settlementWorldResults };
}
