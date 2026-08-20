import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { parse as parseCsvSync } from "csv-parse/sync";
import type { Faction, WorldKey } from "../contracts/domain.js";
import { checkpointDigest } from "../checkpoints/checkpoint.js";
import { stableEventId } from "../events/event-store.js";
import { resolveSharedCalendar, type ResolvedEvent } from "../events/calendar.js";
import { accrueGrowth, allocateEqualPopulation, deriveSocialProjection } from "./local-mechanics.js";
import { buildConclaveSeats } from "../institutions/ledgers.js";

const WORLDS = ["CONCORD", "SCHISM", "RUIN"] as const;
const SEIZURE_TARGET: Record<WorldKey, string> = { CONCORD: "SITE-036", SCHISM: "SITE-148", RUIN: "SITE-071" };
const CAPITAL: Record<WorldKey, string> = { CONCORD: "SITE-008", SCHISM: "SITE-099", RUIN: "SITE-169" };
const CLASS_PRIORITY: Record<string, number> = { METROPOLIS: 5, CITY: 4, TOWN: 3, VILLAGE: 2, HAMLET: 1 };

export interface DiagnosticSettlement {
  settlementId: string; siteId: string; regionId: string; stateId: string; foundedYear: number; name: string; dominantFaction: Faction; population: bigint;
}
export interface DiagnosticEvent { eventId: string; worldKey: WorldKey; year: number; eventType: string; entityId: string; payload: unknown; }
export interface DiagnosticWorld {
  worldKey: WorldKey; finalYear: 2000; initialSettlementCount: 24; stateCount: number; finalPopulation: bigint; totalPopulation: bigint;
  federalCapitalSiteId: string; settlements: DiagnosticSettlement[]; events: DiagnosticEvent[]; annual: { year: number; totalPopulation: bigint; settlementCount: number; stateCount: number }[];
  states: { stateId: string; memberSettlementIds: string[] }[]; conclaveSeats: unknown[]; senateSeats: unknown[]; names: unknown[]; families: unknown[];
  annualStates: unknown[]; stateMembershipEvents: unknown[]; governmentEpochs: unknown[]; economicEpochs: unknown[]; socialSummaries: unknown[]; wealthSummaries: unknown[];
  populationCheckpoints: unknown[]; populationDeltas: unknown[]; conclaveSnapshots: unknown[]; renames: unknown[]; namingJobs: unknown[];
}
export interface DiagnosticResult {
  runId: string; mode: "DIAGNOSTIC"; seed: string; policyVersion: string; finalYear: 2000; djtYear: number; sharedEvents: ResolvedEvent[];
  worlds: Record<WorldKey, DiagnosticWorld>; checkpointCount: number; namingJobCount: number; contentDigest: string;
  audit: { negativePopulationCount: number; conservationFailures: number; socialConservationFailures: number };
}

function loadCsv(filename: string): Record<string, string>[] {
  return parseCsvSync(readFileSync(filename), { bom: true, columns: true, skip_empty_lines: true }) as Record<string, string>[];
}

export function runDiagnosticHistory(seed: string, resourceDirectory = resolve("resources")): DiagnosticResult {
  const skeleton = JSON.parse(readFileSync(resolve(resourceDirectory, "reference/shared_event_skeleton.json"), "utf8")) as { events: Parameters<typeof resolveSharedCalendar>[1] };
  const sharedEvents = resolveSharedCalendar(seed, skeleton.events);
  const djtYear = sharedEvents.find((event) => event.eventKey === "DJT_SEIZURE_INNERWOOD")!.resolvedYear;
  const sites = loadCsv(resolve(resourceDirectory, "inputs/sites_naming_master.csv"));
  const founding = loadCsv(resolve(resourceDirectory, "reference/founding_sites.csv")).filter((site) => site.regionId !== "R10");
  const siteById = new Map(sites.map((site) => [site.siteId, site]));
  const waveEvents = ["FOUNDING_WAVE_2", "FOUNDING_WAVE_3", "FOUNDING_WAVE_4", "FOUNDING_WAVE_5"].map((key) => sharedEvents.find((event) => event.eventKey === key)!);
  const worlds = {} as Record<WorldKey, DiagnosticWorld>;
  let checkpointCount = 0;
  let namingJobCount = 0;
  let negativePopulationCount = 0;
  let conservationFailures = 0;
  let socialConservationFailures = 0;

  for (const world of WORLDS) {
    let totalPopulation = 2_000_000n;
    let stateCount = 24;
    let federalCapitalSiteId = CAPITAL[world];
    const initialShares = allocateEqualPopulation(founding.map((site) => site.siteId), totalPopulation);
    const settlements: DiagnosticSettlement[] = founding.map((site, index) => ({
      settlementId: `SETTLEMENT_${world}_${site.siteId}`, siteId: site.siteId, regionId: site.regionId, stateId: `STATE_${world}_${site.regionId}`,
      foundedYear: 0, name: site.currentSiteName, dominantFaction: WORLDS[(index + WORLDS.indexOf(world)) % 3], population: initialShares.get(site.siteId)!,
    }));
    const events: DiagnosticEvent[] = settlements.map((settlement, index) => ({ eventId: stableEventId("DIAGNOSTIC_RUN", world, 0, "INITIAL_SETTLEMENT_CREATED", settlement.settlementId, index), worldKey: world, year: 0, eventType: "INITIAL_SETTLEMENT_CREATED", entityId: settlement.settlementId, payload: { siteId: settlement.siteId, regionId: settlement.regionId, nameSource: "OWNER_INPUT" } }));
    const annual: DiagnosticWorld["annual"] = [{ year: 0, totalPopulation, settlementCount: settlements.length, stateCount }];
    const populationCheckpoints: unknown[] = [{ year: 0, totalPopulation, settlementPopulationDigest: checkpointDigest(settlements.map(({ settlementId, population }) => ({ settlementId, population }))) }];
    const populationDeltas: unknown[] = [];
    const socialSummaries: unknown[] = [];
    const wealthSummaries: unknown[] = [];
    const governmentEpochs: unknown[] = founding.map((site) => ({ stateId: `STATE_${world}_${site.regionId}`, startYear: 0, politicalForm: world === "CONCORD" ? "DEMOCRATIC" : world === "SCHISM" ? "MONARCHIC" : "OTHER", strategy: "DIAGNOSTIC_MAPPING_FIXTURE_V1" }));
    const economicEpochs: unknown[] = founding.map((site) => ({ stateId: `STATE_${world}_${site.regionId}`, startYear: 0, economicForm: world === "CONCORD" ? "COMMUNAL" : world === "SCHISM" ? "MARKET" : "TRADITIONAL", latched: true, strategy: "DIAGNOSTIC_MAPPING_FIXTURE_V1" }));
    const names: unknown[] = settlements.map((settlement) => ({ entityId: settlement.settlementId, effectiveYear: 0, name: settlement.name, provenance: "OWNER_INPUT" }));
    namingJobCount += 1;
    const occupied = new Set(settlements.map((settlement) => settlement.siteId));
    let previousPopulation = totalPopulation;

    for (let year = 1; year <= 2000; year += 1) {
      const growth = accrueGrowth(totalPopulation, "LOW");
      totalPopulation += growth;
      const growthRecipient = settlements.find((settlement) => settlement.siteId === federalCapitalSiteId) ?? settlements[0]!;
      growthRecipient.population += growth;
      populationDeltas.push({ year, deltaType: "GROWTH", settlementId: growthRecipient.settlementId, amount: growth });
      events.push({ eventId: stableEventId("DIAGNOSTIC_RUN", world, year, "GROWTH_APPLIED", world, 0), worldKey: world, year, eventType: "GROWTH_APPLIED", entityId: world, payload: { priorPopulation: previousPopulation, growth, population: totalPopulation } });
      if (totalPopulation !== previousPopulation + growth) conservationFailures += 1;
      previousPopulation = totalPopulation;

      const wave = waveEvents.find((event) => event.resolvedYear === year);
      if (wave) {
        for (const original of founding) {
          const candidates = sites.filter((site) => site.regionId === original.regionId && !occupied.has(site.siteId)).sort((a, b) => Number(b.attractivenessTier) - Number(a.attractivenessTier) || (CLASS_PRIORITY[b.classification] ?? 0) - (CLASS_PRIORITY[a.classification] ?? 0) || a.siteId.localeCompare(b.siteId));
          const site = candidates[0];
          if (!site) continue;
          occupied.add(site.siteId);
          const source = settlements.filter((settlement) => settlement.regionId === site.regionId).sort((a, b) => a.settlementId.localeCompare(b.settlementId))[0]!;
          const transfer = source.population / 100n > 0n ? source.population / 100n : source.population;
          source.population -= transfer;
          const settlement: DiagnosticSettlement = { settlementId: `SETTLEMENT_${world}_${site.siteId}`, siteId: site.siteId, regionId: site.regionId, stateId: `STATE_${world}_${site.regionId}`, foundedYear: year, name: `Diagnostic ${world} ${site.siteId}`, dominantFaction: world, population: transfer };
          settlements.push(settlement);
          events.push({ eventId: stableEventId("DIAGNOSTIC_RUN", world, year, "SETTLEMENT_FOUNDED", settlement.settlementId, settlements.length), worldKey: world, year, eventType: "SETTLEMENT_FOUNDED", entityId: settlement.settlementId, payload: { siteId: site.siteId, policy: "EVERY_BROAD_UNHAPPY_FOUND_OR_JOIN_V1", transferNetWorldPopulation: "0" } });
          populationDeltas.push({ year, deltaType: "FOUNDER_TRANSFER", fromSettlementId: source.settlementId, toSettlementId: settlement.settlementId, amount: transfer });
          names.push({ entityId: settlement.settlementId, effectiveYear: year, name: settlement.name, provenance: "SYNTHETIC_NAMING_FIXTURE" });
        }
        namingJobCount += 1;
      }
      if (year === djtYear) {
        const site = siteById.get("SITE-064")!;
        let innerwoodPopulation = 0n;
        for (const source of settlements) { const transfer = source.population / 100n; source.population -= transfer; innerwoodPopulation += transfer; populationDeltas.push({ year, deltaType: "DJT_TRANSFER", fromSettlementId: source.settlementId, toSettlementId: `SETTLEMENT_${world}_SITE-064`, amount: transfer }); }
        const settlement: DiagnosticSettlement = { settlementId: `SETTLEMENT_${world}_SITE-064`, siteId: "SITE-064", regionId: "R10", stateId: `STATE_${world}_INNERWOOD`, foundedYear: year, name: `Diagnostic ${world} Innerwood City`, dominantFaction: world, population: innerwoodPopulation };
        settlements.push(settlement); occupied.add("SITE-064"); stateCount = 25; federalCapitalSiteId = SEIZURE_TARGET[world];
        for (const type of ["DJT_SOVEREIGN_BREED_CONSOLIDATED", "DJT_POPULATION_DISPLACED", "STATE_CREATED", "FEDERAL_CAPITAL_CHANGED"] as const) events.push({ eventId: stableEventId("DIAGNOSTIC_RUN", world, year, type, settlement.settlementId, 0), worldKey: world, year, eventType: type, entityId: settlement.settlementId, payload: { targetSiteId: federalCapitalSiteId, r10SiteId: "SITE-064", populationConserved: true, outboundRestrictionYears: 5 } });
        names.push({ entityId: settlement.settlementId, effectiveYear: year, name: settlement.name, provenance: "SYNTHETIC_NAMING_FIXTURE" });
        namingJobCount += 1;
        governmentEpochs.push({ stateId: `STATE_${world}_INNERWOOD`, startYear: year, politicalForm: "OTHER", strategy: "DJT_SOVEREIGN_FIXTURE_V1" });
        economicEpochs.push({ stateId: `STATE_${world}_INNERWOOD`, startYear: year, economicForm: "TRADITIONAL", latched: true, strategy: "DJT_SOVEREIGN_FIXTURE_V1" });
      }
      const secession = sharedEvents.find((event) => event.eventKey === "INNERWOOD_SECESSION_505");
      if (secession?.resolvedYear === year) {
        const candidates = settlements.filter((settlement) => ["R15", "R09", "R11"].includes(settlement.regionId) && settlement.siteId !== federalCapitalSiteId && settlement.dominantFaction !== world).sort((a, b) => a.siteId.localeCompare(b.siteId)).slice(0, 2);
        for (const settlement of candidates) {
          const fromStateId = settlement.stateId; settlement.stateId = `STATE_${world}_INNERWOOD`;
          events.push({ eventId: stableEventId("DIAGNOSTIC_RUN", world, year, "STATE_MEMBERSHIP_CHANGED", settlement.settlementId, 0), worldKey: world, year, eventType: "STATE_MEMBERSHIP_CHANGED", entityId: settlement.settlementId, payload: { fromStateId, toStateId: settlement.stateId, regionIdUnchanged: settlement.regionId } });
        }
      }
      for (const shared of sharedEvents.filter((event) => event.resolvedYear === year && event.kind !== "FOUNDING_WAVE" && event.eventKey !== "DJT_SEIZURE_INNERWOOD" && event.eventKey !== "INNERWOOD_SECESSION_505")) events.push({ eventId: stableEventId("DIAGNOSTIC_RUN", world, year, shared.kind === "ATROCITY" ? "ATROCITY_MARKER" : "HISTORICAL_MARKER", shared.eventKey, 0), worldKey: world, year, eventType: shared.kind === "ATROCITY" ? "ATROCITY_MARKER" : "HISTORICAL_MARKER", entityId: shared.eventKey, payload: { nominalYear: shared.nominalYear, resolvedYear: shared.resolvedYear, populationEffect: "0" } });
      if (year % 25 === 0 && settlements.length > 1) {
        const from = settlements[0]!, to = settlements[1]!;
        const transfer = from.population >= 100n ? 100n : from.population;
        from.population -= transfer; to.population += transfer;
        events.push({ eventId: stableEventId("DIAGNOSTIC_RUN", world, year, "MIGRATION_APPLIED", from.settlementId, 0), worldKey: world, year, eventType: "MIGRATION_APPLIED", entityId: from.settlementId, payload: { toSettlementId: to.settlementId, amount: transfer, strategy: "OWNER_MIGRATION_V1", transferNetWorldPopulation: "0" } });
        populationDeltas.push({ year, deltaType: "MIGRATION", fromSettlementId: from.settlementId, toSettlementId: to.settlementId, amount: transfer });
      }
      const social = deriveSocialProjection([{ cohortId: world, breedId: world, wealth: year, population: totalPopulation }]);
      if (social.tiers.HIGH + social.tiers.MID + social.tiers.LOW !== totalPopulation || Object.values(social.classes).reduce((sum, value) => sum + value, 0n) !== totalPopulation) socialConservationFailures += 1;
      if (totalPopulation < 0n) negativePopulationCount += 1;
      if (settlements.reduce((sum, settlement) => sum + settlement.population, 0n) !== totalPopulation) conservationFailures += 1;
      annual.push({ year, totalPopulation, settlementCount: settlements.length, stateCount });
      if (year % 5 === 0) {
        checkpointCount += 1;
        populationCheckpoints.push({ year, totalPopulation, settlementPopulationDigest: checkpointDigest(settlements.map(({ settlementId, population }) => ({ settlementId, population }))) });
        socialSummaries.push({ year, ...social });
        wealthSummaries.push({ year, totalPopulation, aggregateWealthScore: totalPopulation * BigInt(year) });
      }
    }
    checkpointCount += 1;
    const stateIds = [...new Set(settlements.map((settlement) => settlement.stateId))].sort();
    const states = stateIds.map((stateId) => ({ stateId, memberSettlementIds: settlements.filter((settlement) => settlement.stateId === stateId).map((settlement) => settlement.settlementId).sort() }));
    const conclaveSeats = buildConclaveSeats(world, 2000, states.map((state) => ({ stateId: state.stateId, settlements: state.memberSettlementIds.map((id) => { const settlement = settlements.find((item) => item.settlementId === id)!; return { settlementId: id, siteId: settlement.siteId, population: settlement.population }; }) })), true);
    const senateSeats = states.flatMap((state) => (["A", "B"] as const).map((seat) => ({ seatId: `SENATE_${world}_${state.stateId}_${seat}`, stateId: state.stateId, termYears: 10, electionSuffix: seat === "A" ? 5 : 0, policy: "TWO_PER_STATE_STAGGERED_10_YEAR_TERMS_50_AFTER_INNERWOOD" })));
    const stateMembershipEvents = events.filter((event) => event.eventType === "STATE_MEMBERSHIP_CHANGED");
    worlds[world] = { worldKey: world, finalYear: 2000, initialSettlementCount: 24, stateCount, finalPopulation: totalPopulation, totalPopulation, federalCapitalSiteId, settlements, events, annual, annualStates: [], states, stateMembershipEvents, governmentEpochs, economicEpochs, socialSummaries, wealthSummaries, populationCheckpoints, populationDeltas, conclaveSeats, conclaveSnapshots: [{ year: 2000, seatCount: conclaveSeats.length }], senateSeats, names, renames: [], namingJobs: [{ namingJobId: `NAMING_${world}_DIAGNOSTIC`, status: "ACCEPTED", requestCount: names.length, fixture: true }], families: [] };
  }
  const contentDigest = checkpointDigest({ seed, policyVersion: "OWNER_POLICY_2026_08_18_V1", sharedEvents, worlds });
  return { runId: "DIAGNOSTIC_2026_08_18", mode: "DIAGNOSTIC", seed, policyVersion: "OWNER_POLICY_2026_08_18_V1", finalYear: 2000, djtYear, sharedEvents, worlds, checkpointCount, namingJobCount, contentDigest, audit: { negativePopulationCount, conservationFailures, socialConservationFailures } };
}
