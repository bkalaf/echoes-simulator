import { createHash } from "node:crypto";
import type { Faction, WorldKey } from "../contracts/domain.js";
import { resolveSharedCalendar, type ResolvedEvent } from "../events/calendar.js";
import { buildConclaveSeats, isSenateElectionYear } from "../institutions/ledgers.js";
import { buildNamingJob, type NamingJob } from "../naming/naming.js";
import { RAW_DIMENSIONS, type EffectiveBreedSemantics } from "../research/v4-contract.js";
import type { Cohort } from "./cohort-engine.js";
import { executeDjtTransaction } from "./cohort-engine.js";
import { buildMigrationEdges } from "./flow-mechanics.js";
import { accrueGrowth, deriveEconomicForm, derivePoliticalForm, deriveSocialProjection, projectRawProperties, updateEpochLatch, wealthIncrement, type GrowthBand } from "./local-mechanics.js";

const WORLDS: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];
const POLITICAL_TRACKED = ["administrationMode", "legitimacyBasis", "authoritySource"] as const;
const ECONOMIC_TRACKED = ["ownershipMode", "allocationMode"] as const;

export interface CanonicalHistoryIdentity { breedId: string; populationKind: "HUMAN" | "BEAST" | "MYTHOS"; cultureId: string | null; }
export interface CanonicalHistorySite { siteId: string; regionId: string; currentSiteName: string; nameStatus: string; classification: string; attractivenessTier: string; poiIds?: string; poiCurrentLabels?: string; }
export interface CanonicalHistorySettlement {
  settlementId: string; siteId: string; regionId: string; stateId: string; name: string | null; nameSource: "OWNER_INPUT" | "WORKING" | "UNNAMED";
  foundedYear: number; cultureId: string | null; cultureState: "CALCULATED" | "NO_HUMAN_FOUNDING_CULTURE"; population: bigint;
  dominantFaction: Faction; politicalForm: string; economicForm: string; dominantBreed: string; dominantSpeciesKind: "HUMAN" | "BEAST" | "MYTHOS";
  propertyWinners: Record<string, string>; politicalLatch: string[]; economicLatch: string[];
}
export interface CanonicalHistoryWorld { world: WorldKey; year: number; cohorts: Cohort[]; settlements: CanonicalHistorySettlement[]; }
export interface CanonicalHistoryEvent { world: WorldKey; year: number; eventType: string; entityId: string; payload: Record<string, unknown>; }
export interface CanonicalHistoryResult {
  status: "WAITING_FOR_NAMING" | "COMPLETE";
  currentYear: number;
  worlds: CanonicalHistoryWorld[];
  events: CanonicalHistoryEvent[];
  checkpoints: { world: WorldKey; year: number; stateHash: string; cohortCount: number; population: string }[];
  migrations: { world: WorldKey; year: number; breedId: string; fromSettlementId: string; toSettlementId: string; population: string; retainedWealth: number; migrantWealth: 0; rateTwelfths: number }[];
  founding: { world: WorldKey; year: number; settlementId: string; movedPopulation: string; sourceSettlementIds: string[] }[];
  djt: { world: WorldKey; year: number; movements: number; populationBefore: string; populationAfter: string; quarantineUntil: number }[];
  governmentEpochs: { world: WorldKey; settlementId: string; startYear: number; politicalForm: string; dominantBreed: string }[];
  economicEpochs: { world: WorldKey; settlementId: string; startYear: number; economicForm: string; dominantBreed: string }[];
  social: { world: WorldKey; year: number; settlementId: string; tiers: Record<string, string>; classes: Record<string, string> }[];
  institutions: { world: WorldKey; year: number; type: string; rows: unknown[] }[];
  namingJobs: NamingJob[];
}
export interface CanonicalHistoryInput {
  runId: string; seed: string; yearEnd: number; worlds: CanonicalHistoryWorld[]; identities: CanonicalHistoryIdentity[]; semantics: EffectiveBreedSemantics[];
  sites: CanonicalHistorySite[]; adjacency: Record<string, string[]>; propertyMapping: Record<string, Record<Faction, string>>; politicalRows: Record<string, string>[]; economicRows: Record<string, string>[];
  growthPolicy: { matrix: Record<WorldKey, Record<Faction, GrowthBand>> }; sovereign: Record<WorldKey, { sovereignFaction: Faction; breedId: string; djtSeizureTarget: { siteId: string } }> & { innerwood: { siteId: string; regionId: string; stateName: string } };
  sharedEvents: { eventKey: string; nominalYear: number; jitter: boolean; kind: string; label: string }[];
  autoAcceptNaming: boolean; checkpointInterval?: number; onCheckpoint?: (world: CanonicalHistoryWorld) => void;
}

function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item)).digest("hex"); }
function camel(name: string): string { return `${name[0]!.toLowerCase()}${name.slice(1)}`; }
function total(cohorts: readonly Cohort[]): bigint { return cohorts.reduce((sum, cohort) => sum + cohort.population, 0n); }
function breedFaction(semantic: EffectiveBreedSemantics, mapping: Record<string, Record<Faction, string>>, world: WorldKey): Faction {
  const points: Record<Faction, number> = { CONCORD: 0, SCHISM: 0, RUIN: 0 };
  for (const [field, values] of Object.entries(mapping)) for (const faction of WORLDS) if (values[faction] === semantic.dimensions[field as keyof EffectiveBreedSemantics["dimensions"]]?.value) points[faction] += 1;
  return [...WORLDS].sort((left, right) => points[right] - points[left] || (left === world ? -1 : right === world ? 1 : left.localeCompare(right)))[0]!;
}
function mergeCohorts(cohorts: readonly Cohort[], year: number): Cohort[] {
  const groups = new Map<string, Cohort[]>();
  for (const cohort of cohorts.filter((row) => row.population > 0n)) { const key = `${cohort.worldKey}\0${cohort.settlementId}\0${cohort.breedId}`; groups.set(key, [...(groups.get(key) ?? []), cohort]); }
  return [...groups.values()].map((rows) => {
    const population = total(rows); const wealth = rows.reduce((sum, row) => sum + BigInt(row.wealthScore) * row.population, 0n) / population;
    const first = [...rows].sort((left, right) => left.cohortId.localeCompare(right.cohortId))[0]!;
    return { ...first, cohortId: `COHORT_${first.worldKey}_${digest([first.settlementId, first.breedId]).slice(0, 20)}`, population, wealthScore: Number(wealth), createdYear: Math.min(...rows.map((row) => row.createdYear)), originCohortId: rows.length === 1 ? first.originCohortId : `MERGED_${year}`, createdByEventId: rows.length === 1 ? first.createdByEventId : `EVENT_${first.worldKey}_${year}_COHORT_MERGE` };
  }).sort((left, right) => left.cohortId.localeCompare(right.cohortId));
}

function groupResidents(cohorts: readonly Cohort[]): Map<string, Cohort[]> {
  const grouped = new Map<string, Cohort[]>();
  for (const cohort of cohorts) if (cohort.population > 0n) grouped.set(cohort.settlementId, [...(grouped.get(cohort.settlementId) ?? []), cohort]);
  return grouped;
}

function calculateSettlement(world: WorldKey, year: number, settlement: CanonicalHistorySettlement, residents: readonly Cohort[], identities: Map<string, CanonicalHistoryIdentity>, propertyValues: Map<string, Record<string, string | null>>, mapping: Record<string, Record<Faction, string>>, politicalRows: Record<string, string>[], economicRows: Record<string, string>[]): CanonicalHistorySettlement {
  const population = total(residents);
  if (population === 0n) return { ...settlement, population };
  const projection = projectRawProperties(residents, propertyValues, world, mapping);
  const winners = Object.fromEntries(Object.entries(projection.properties).map(([field, row]) => [field, row.winner!])) as Record<string, string>;
  if (Object.values(projection.properties).some((row) => row.resolvedPopulation !== population)) throw new Error(`NO_RESOLVED_POPULATION_FOR_PROPERTY:${settlement.settlementId}:${year}`);
  const kindTotals = new Map<string, bigint>(); for (const row of residents) { const kind = identities.get(row.breedId)!.populationKind; kindTotals.set(kind, (kindTotals.get(kind) ?? 0n) + row.population); }
  const humans = residents.filter((row) => identities.get(row.breedId)!.populationKind === "HUMAN");
  const dominantSpeciesKind = (humans.length > 0 ? "HUMAN" : [...kindTotals].sort(([leftKind, left], [rightKind, right]) => left === right ? leftKind.localeCompare(rightKind) : left > right ? -1 : 1)[0]![0]) as CanonicalHistorySettlement["dominantSpeciesKind"];
  const candidates = residents.filter((row) => identities.get(row.breedId)!.populationKind === dominantSpeciesKind).sort((left, right) => left.population === right.population ? left.breedId.localeCompare(right.breedId) : left.population > right.population ? -1 : 1);
  const dominantBreed = candidates[0]!.breedId;
  const cultureTotals = new Map<string, bigint>(); for (const row of humans) { const culture = identities.get(row.breedId)!.cultureId; if (culture) cultureTotals.set(culture, (cultureTotals.get(culture) ?? 0n) + row.population); }
  const cultureId = settlement.foundedYear < year || settlement.cultureState === "CALCULATED" ? settlement.cultureId : [...cultureTotals].sort(([leftId, left], [rightId, right]) => left === right ? leftId.localeCompare(rightId) : left > right ? -1 : 1)[0]?.[0] ?? null;
  return { ...settlement, population, cultureId, cultureState: cultureId ? "CALCULATED" : "NO_HUMAN_FOUNDING_CULTURE", dominantFaction: projection.dominantFaction, politicalForm: derivePoliticalForm(winners, politicalRows), economicForm: deriveEconomicForm(winners, economicRows), dominantBreed, dominantSpeciesKind, propertyWinners: winners };
}

function migrationRate(cohort: Cohort, destination: CanonicalHistorySettlement, semantic: EffectiveBreedSemantics, mapping: Record<string, Record<Faction, string>>, world: WorldKey, sovereignFaction: Faction): number {
  let comparison = 0;
  for (const field of RAW_DIMENSIONS) comparison += destination.propertyWinners[field] === semantic.dimensions[field].value ? 1 : -1;
  const faction = breedFaction(semantic, mapping, world);
  const factionAdjustment = faction === destination.dominantFaction ? 0 : faction === sovereignFaction ? 2 : 1;
  return Math.max(0, Math.min(60, 12 + comparison + factionAdjustment * 12));
}

function resolveFoundingYears(calendar: ResolvedEvent[]): Set<number> { return new Set(calendar.filter((event) => /^FOUNDING_WAVE_[2-5]$/.test(event.eventKey)).map((event) => event.resolvedYear)); }

export function runCanonicalHistory(input: CanonicalHistoryInput): CanonicalHistoryResult {
  const interval = input.checkpointInterval ?? 5;
  const identityById = new Map(input.identities.map((row) => [row.breedId, row]));
  const semanticById = new Map(input.semantics.map((row) => [row.breedId, row]));
  const propertyValues = new Map(input.semantics.map((semantic) => [semantic.breedId, Object.fromEntries(RAW_DIMENSIONS.map((field) => [field, semantic.dimensions[field].value]))]));
  const mapping = Object.fromEntries(Object.entries(input.propertyMapping).map(([key, value]) => [camel(key), value]));
  const calendar = resolveSharedCalendar(input.seed, input.sharedEvents);
  const foundingYears = resolveFoundingYears(calendar);
  const djtYear = calendar.find((event) => event.eventKey === "DJT_SEIZURE_INNERWOOD")?.resolvedYear ?? 500;
  const secessionYear = calendar.find((event) => event.eventKey === "INNERWOOD_SECESSION_505")?.resolvedYear ?? 505;
  const rebalanceYear = calendar.find((event) => event.eventKey === "INNERWOOD_REBALANCE_525")?.resolvedYear ?? 525;
  const events: CanonicalHistoryEvent[] = [], migrations: CanonicalHistoryResult["migrations"] = [], founding: CanonicalHistoryResult["founding"] = [], djt: CanonicalHistoryResult["djt"] = [], governmentEpochs: CanonicalHistoryResult["governmentEpochs"] = [], economicEpochs: CanonicalHistoryResult["economicEpochs"] = [], social: CanonicalHistoryResult["social"] = [], institutions: CanonicalHistoryResult["institutions"] = [], namingJobs: NamingJob[] = [], checkpoints: CanonicalHistoryResult["checkpoints"] = [];
  const worlds = input.worlds.map((world) => ({ ...world, cohorts: [...world.cohorts], settlements: world.settlements.map((row) => ({ ...row, propertyWinners: { ...row.propertyWinners }, politicalLatch: [...row.politicalLatch], economicLatch: [...row.economicLatch] })) }));

  for (let year = Math.min(...worlds.map((world) => world.year)) + 1; year <= input.yearEnd; year += 1) {
    for (const state of worlds) {
      const sovereign = input.sovereign[state.world];
      const before = total(state.cohorts);
      state.cohorts = state.cohorts.map((cohort) => {
        const settlement = state.settlements.find((row) => row.settlementId === cohort.settlementId)!;
        const band = input.growthPolicy.matrix[settlement.dominantFaction][sovereign.sovereignFaction];
        const growth = accrueGrowth(cohort.population, band);
        const faction = breedFaction(semanticById.get(cohort.breedId)!, mapping, state.world);
        return { ...cohort, population: cohort.population + growth, wealthScore: cohort.wealthScore + wealthIncrement(faction, settlement.dominantFaction, settlement.dominantFaction, sovereign.sovereignFaction) };
      });
      events.push({ world: state.world, year, eventType: "ANNUAL_GROWTH", entityId: state.world, payload: { priorPopulation: before.toString(), population: total(state.cohorts).toString(), growth: (total(state.cohorts) - before).toString() } });

      let residentsBySettlement = groupResidents(state.cohorts);
      state.settlements = state.settlements.map((settlement) => calculateSettlement(state.world, year, settlement, residentsBySettlement.get(settlement.settlementId) ?? [], identityById, propertyValues, mapping, input.politicalRows, input.economicRows));
      for (const settlement of state.settlements) {
        const residents = residentsBySettlement.get(settlement.settlementId) ?? [];
        const projection = deriveSocialProjection(residents.map((cohort) => ({ cohortId: cohort.cohortId, breedId: cohort.breedId, wealth: cohort.wealthScore, population: cohort.population })));
        social.push({ world: state.world, year, settlementId: settlement.settlementId, tiers: Object.fromEntries(Object.entries(projection.tiers).map(([key, value]) => [key, value.toString()])), classes: Object.fromEntries(Object.entries(projection.classes).map(([key, value]) => [key, value.toString()])) });
      }

      const edges = buildMigrationEdges(state.settlements, input.adjacency);
      const edgesByOrigin = new Map<string, typeof edges>(); for (const edge of edges) edgesByOrigin.set(edge.originId, [...(edgesByOrigin.get(edge.originId) ?? []), edge]);
      const retained: Cohort[] = []; const migrants: Cohort[] = [];
      for (const cohort of state.cohorts) {
        if (cohort.outboundMigrationNotBeforeYear !== null && year < cohort.outboundMigrationNotBeforeYear) { retained.push(cohort); continue; }
        const destinations = edgesByOrigin.get(cohort.settlementId) ?? [];
        const proposals = destinations.map((edge) => { const destination = state.settlements.find((row) => row.settlementId === edge.destinationId)!; const rateTwelfths = migrationRate(cohort, destination, semanticById.get(cohort.breedId)!, mapping, state.world, sovereign.sovereignFaction); return { destination, rateTwelfths, proposed: cohort.population * BigInt(rateTwelfths) / 1200n }; });
        const proposed = proposals.reduce((sum, row) => sum + row.proposed, 0n); const scale = proposed > cohort.population ? cohort.population : proposed;
        retained.push({ ...cohort, population: cohort.population - scale });
        let applied = 0n;
        for (let index = 0; index < proposals.length; index += 1) {
          const proposal = proposals[index]!; const amount = proposed <= cohort.population ? proposal.proposed : index === proposals.length - 1 ? cohort.population - applied : cohort.population * proposal.proposed / proposed;
          applied += amount; if (amount === 0n) continue;
          migrants.push({ ...cohort, cohortId: `${cohort.cohortId}__MIGRATION_${year}_${proposal.destination.settlementId}`, settlementId: proposal.destination.settlementId, population: amount, wealthScore: 0, createdYear: year, originCohortId: cohort.cohortId, createdByEventId: `EVENT_${state.world}_${year}_MIGRATION`, outboundMigrationNotBeforeYear: null });
          migrations.push({ world: state.world, year, breedId: cohort.breedId, fromSettlementId: cohort.settlementId, toSettlementId: proposal.destination.settlementId, population: amount.toString(), retainedWealth: cohort.wealthScore, migrantWealth: 0, rateTwelfths: proposal.rateTwelfths });
        }
      }
      state.cohorts = mergeCohorts([...retained, ...migrants], year);

      if (foundingYears.has(year)) {
        const states = [...new Set(state.settlements.map((row) => row.stateId))].sort();
        for (const stateId of states) {
          const members = state.settlements.filter((row) => row.stateId === stateId);
          const regionId = members[0]!.regionId;
          const used = new Set(state.settlements.map((row) => row.siteId));
          const site = input.sites.filter((row) => row.regionId === regionId && !used.has(row.siteId)).sort((left, right) => Number(right.attractivenessTier) - Number(left.attractivenessTier) || left.siteId.localeCompare(right.siteId))[0];
          if (!site) continue;
          const settlementId = `SETTLEMENT_${state.world}_${site.siteId}`;
          const sourceIds = members.map((row) => row.settlementId);
          let moved = 0n;
          const added: Cohort[] = [];
          state.cohorts = state.cohorts.map((cohort) => {
            if (!sourceIds.includes(cohort.settlementId)) return cohort;
            const amount = cohort.population / 10n; moved += amount;
            if (amount > 0n) added.push({ ...cohort, cohortId: `${cohort.cohortId}__FOUNDING_${year}_${site.siteId}`, settlementId, population: amount, wealthScore: 0, createdYear: year, originCohortId: cohort.cohortId, createdByEventId: `EVENT_${state.world}_${year}_FOUNDING_${site.siteId}` });
            return { ...cohort, population: cohort.population - amount };
          });
          state.cohorts = mergeCohorts([...state.cohorts, ...added], year);
          const shell: CanonicalHistorySettlement = { settlementId, siteId: site.siteId, regionId, stateId, name: site.currentSiteName || null, nameSource: site.nameStatus === "CANONICAL" ? "OWNER_INPUT" : "UNNAMED", foundedYear: year, cultureId: null, cultureState: "NO_HUMAN_FOUNDING_CULTURE", population: moved, dominantFaction: state.world, politicalForm: "", economicForm: "", dominantBreed: "", dominantSpeciesKind: "HUMAN", propertyWinners: {}, politicalLatch: [...POLITICAL_TRACKED], economicLatch: [...ECONOMIC_TRACKED] };
          residentsBySettlement = groupResidents(state.cohorts);
          const calculated = calculateSettlement(state.world, year, shell, residentsBySettlement.get(settlementId) ?? [], identityById, propertyValues, mapping, input.politicalRows, input.economicRows);
          state.settlements.push(calculated); founding.push({ world: state.world, year, settlementId, movedPopulation: moved.toString(), sourceSettlementIds: sourceIds });
          events.push({ world: state.world, year, eventType: "SETTLEMENT_FOUNDED", entityId: settlementId, payload: { movedPopulation: moved.toString(), sourceSettlementIds: sourceIds } });
          const job = buildNamingJob({ runId: input.runId, world: state.world, year, reason: "FOUNDING_WAVE", settlement: { settlementId, siteId: site.siteId, currentName: calculated.name, nameSource: calculated.nameSource, dominantFaction: calculated.dominantFaction, cultureId: calculated.cultureId, cultureState: calculated.cultureState, politicalForm: calculated.politicalForm, economicForm: calculated.economicForm, dominantBreed: calculated.dominantBreed, population: calculated.population.toString() }, unnamedPois: [] });
          namingJobs.push(job);
          if (input.autoAcceptNaming) {
            calculated.name = `TEST_FIXTURE_${state.world}_${site.siteId}_${year}`;
            calculated.nameSource = "WORKING";
            events.push({ world: state.world, year, eventType: "TEST_FIXTURE_NAMING_ACCEPTED", entityId: job.namingJobId, payload: { testOnly: true, acceptedSettlementName: calculated.name } });
          }
        }
      }

      if (year === djtYear) {
        const target = state.settlements.find((row) => row.siteId === sovereign.djtSeizureTarget.siteId); if (!target) throw new Error(`DJT target ${sovereign.djtSeizureTarget.siteId} missing`);
        let innerwood = state.settlements.find((row) => row.siteId === input.sovereign.innerwood.siteId);
        if (!innerwood) { innerwood = { ...target, settlementId: `SETTLEMENT_${state.world}_${input.sovereign.innerwood.siteId}`, siteId: input.sovereign.innerwood.siteId, regionId: input.sovereign.innerwood.regionId, stateId: `STATE_${state.world}_R10`, name: null, nameSource: "UNNAMED", foundedYear: year, cultureId: null, cultureState: "NO_HUMAN_FOUNDING_CULTURE", population: 0n }; state.settlements.push(innerwood); }
        const beforeDjt = total(state.cohorts); const moved = executeDjtTransaction(state.cohorts, { sovereignBreedId: sovereign.breedId, seizedSettlementId: target.settlementId, innerwoodSettlementId: innerwood.settlementId, year, quarantineYears: 5, eventId: `EVENT_${state.world}_${year}_DJT` });
        state.cohorts = mergeCohorts(moved.cohorts, year); const afterDjt = total(state.cohorts); if (beforeDjt !== afterDjt) throw new Error("DJT population conservation failed");
        djt.push({ world: state.world, year, movements: moved.movements.length, populationBefore: beforeDjt.toString(), populationAfter: afterDjt.toString(), quarantineUntil: year + 5 });
        events.push({ world: state.world, year, eventType: "DJT_INNERWOOD", entityId: target.settlementId, payload: { movements: moved.movements.length, populationConserved: true, quarantineUntil: year + 5 } });
      }

      if (year === secessionYear) {
        const innerwoodStateId = `STATE_${state.world}_R10`;
        const candidates = state.settlements.filter((settlement) => ["R15", "R09", "R11"].includes(settlement.regionId) && settlement.siteId !== sovereign.djtSeizureTarget.siteId && settlement.dominantFaction !== sovereign.sovereignFaction).sort((left, right) => left.siteId.localeCompare(right.siteId)).slice(0, 2);
        for (const settlement of candidates) {
          const fromStateId = settlement.stateId;
          settlement.stateId = innerwoodStateId;
          events.push({ world: state.world, year, eventType: "STATE_MEMBERSHIP_CHANGED", entityId: settlement.settlementId, payload: { fromStateId, toStateId: innerwoodStateId, regionIdUnchanged: settlement.regionId, policy: "ADJACENT_FACTION_SECESSION_505" } });
        }
      }
      if (year === rebalanceYear) events.push({ world: state.world, year, eventType: "STATE_MEMBERSHIP_REBALANCE_DISABLED", entityId: state.world, payload: { policy: "REBALANCE_525_DISABLED", populationEffect: "0" } });

      residentsBySettlement = groupResidents(state.cohorts);
      state.settlements = state.settlements.map((settlement) => {
        const recalculated = calculateSettlement(state.world, year, settlement, residentsBySettlement.get(settlement.settlementId) ?? [], identityById, propertyValues, mapping, input.politicalRows, input.economicRows);
        const political = updateEpochLatch(settlement.politicalLatch, settlement.propertyWinners, recalculated.propertyWinners); const economic = updateEpochLatch(settlement.economicLatch, settlement.propertyWinners, recalculated.propertyWinners);
        if (political.triggered) governmentEpochs.push({ world: state.world, settlementId: settlement.settlementId, startYear: year, politicalForm: recalculated.politicalForm, dominantBreed: recalculated.dominantBreed });
        if (economic.triggered) economicEpochs.push({ world: state.world, settlementId: settlement.settlementId, startYear: year, economicForm: recalculated.economicForm, dominantBreed: recalculated.dominantBreed });
        return { ...recalculated, politicalLatch: political.triggered ? [...POLITICAL_TRACKED] : political.remaining, economicLatch: economic.triggered ? [...ECONOMIC_TRACKED] : economic.remaining };
      });
      state.year = year;
      if (year % interval === 0 || year === input.yearEnd) {
        checkpoints.push({ world: state.world, year, stateHash: digest({ settlements: state.settlements, cohorts: state.cohorts }), cohortCount: state.cohorts.length, population: total(state.cohorts).toString() });
        input.onCheckpoint?.(state);
      }
      if (year === 90 || year === input.yearEnd) {
        const states = [...new Set(state.settlements.map((row) => row.stateId))].map((stateId) => ({ stateId, settlements: state.settlements.filter((row) => row.stateId === stateId).map((row) => ({ settlementId: row.settlementId, siteId: row.siteId, population: row.population })) }));
        institutions.push({ world: state.world, year, type: "CONCLAVE", rows: buildConclaveSeats(state.world, year, states, state.settlements.some((row) => row.regionId === "R10")) });
      }
      if (year >= 275 && (isSenateElectionYear("A", year) || isSenateElectionYear("B", year))) institutions.push({ world: state.world, year, type: "SENATE", rows: state.settlements.map((row) => ({ stateId: row.stateId, seat: isSenateElectionYear("A", year) ? "A" : "B", termStart: year, termEnd: year + 10 })) });
      for (const marker of calendar.filter((event) => event.resolvedYear === year && !/^FOUNDING_WAVE_[2-5]$/.test(event.eventKey) && !["DJT_SEIZURE_INNERWOOD", "INNERWOOD_SECESSION_505", "INNERWOOD_REBALANCE_525"].includes(event.eventKey))) events.push({ world: state.world, year, eventType: marker.kind === "ATROCITY" ? "ATROCITY_MARKER" : "HISTORICAL_MARKER", entityId: marker.eventKey, payload: { nominalYear: marker.nominalYear, resolvedYear: marker.resolvedYear, populationEffect: "0", label: marker.label } });
    }
    if (!input.autoAcceptNaming && namingJobs.length > 0) return { status: "WAITING_FOR_NAMING", currentYear: year, worlds, events, checkpoints, migrations, founding, djt, governmentEpochs, economicEpochs, social, institutions, namingJobs };
  }
  return { status: "COMPLETE", currentYear: input.yearEnd, worlds, events, checkpoints, migrations, founding, djt, governmentEpochs, economicEpochs, social, institutions, namingJobs };
}
