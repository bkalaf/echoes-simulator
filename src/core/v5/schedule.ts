import type { CanonicalDataV5, CausalOwnerInputsV1 } from "./config.js";
import type { ScheduledTransactionV5 } from "./engine.js";
import { resolveSharedCalendar } from "../events/calendar.js";
import type { WorldKey } from "./types.js";

const WORLDS: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];
export const DJT_POLICY_KEY_V5 = "DJT_INNERWOOD_V5";

export interface DjtOwnerPolicyAuthorityV5 {
  schemaVersion: "echoes-djt-owner-policy-v5";
  eventId: string;
  year: number;
  r10SiteId: string;
  innerwoodStateIdByWorld: Record<WorldKey, string>;
  quarantineYears: number;
}

function isDjtPolicy(value: unknown): value is DjtOwnerPolicyAuthorityV5 {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<DjtOwnerPolicyAuthorityV5>;
  return row.schemaVersion === "echoes-djt-owner-policy-v5"
    && typeof row.eventId === "string"
    && Number.isSafeInteger(row.year)
    && typeof row.r10SiteId === "string"
    && Number.isSafeInteger(row.quarantineYears)
    && row.quarantineYears! >= 0
    && WORLDS.every((world) => typeof row.innerwoodStateIdByWorld?.[world] === "string");
}

/**
 * The bundled authority still marks the DJT year as unresolved. Diagnostic
 * fixtures explicitly opt into its nominal year; canonical runs must supply an
 * approved owner policy in CausalOwnerInputsV1 instead.
 */
export function buildDiagnosticDjtPolicyV5(canonical: CanonicalDataV5): DjtOwnerPolicyAuthorityV5 | null {
  const event = canonical.canonicalEvents.find((candidate) => candidate.eventId === "DJT_SEIZURE_INNERWOOD");
  const r10 = canonical.sites.find((site) => site.regionId === "R10");
  if (!event || !r10) return null;
  return {
    schemaVersion: "echoes-djt-owner-policy-v5",
    eventId: event.eventId,
    year: event.year,
    r10SiteId: r10.siteId,
    innerwoodStateIdByWorld: Object.fromEntries(WORLDS.map((world) => [world, `STATE_${world}_R10`])) as Record<WorldKey, string>,
    quarantineYears: 5,
  };
}

export function buildScheduledTransactionsV5(
  canonical: CanonicalDataV5,
  ownerInputs: CausalOwnerInputsV1,
  normalizedSeed: string,
): Record<WorldKey, ScheduledTransactionV5[]> {
  const schedule = { CONCORD: [], SCHISM: [], RUIN: [] } as Record<WorldKey, ScheduledTransactionV5[]>;
  if (!normalizedSeed) throw new Error("V5 scheduled transactions require the run seed");
  const calendar = resolveSharedCalendar(normalizedSeed, canonical.canonicalEvents.map((event) => ({
    eventKey: event.eventId,
    nominalYear: event.nominalYear ?? event.year,
    jitter: event.jitter ?? false,
    kind: event.eventType,
    label: event.label ?? (typeof event.payload.label === "string" ? event.payload.label : event.eventId),
  })));
  const foundingWaves = calendar.filter((event) => /^FOUNDING_WAVE_[2-5]$/.test(event.eventKey)).sort((left, right) => left.resolvedYear - right.resolvedYear || left.eventKey.localeCompare(right.eventKey));
  if (foundingWaves.length !== 0 && foundingWaves.length !== 4) throw new Error(`V5 requires all four canonical founding waves when founding authority is present; found ${foundingWaves.length}`);

  const siteById = new Map(canonical.sites.map((site) => [site.siteId, site]));
  for (const world of foundingWaves.length === 0 ? [] : WORLDS) {
    const initial = canonical.initialSettlements.filter((settlement) => settlement.worldKey === world).sort((left, right) => left.stateId.localeCompare(right.stateId));
    const stateIds = new Set(initial.map((settlement) => settlement.stateId));
    if (initial.length !== 24 || stateIds.size !== 24) throw new Error(`Canonical founding requires 24 original ${world} States; found ${stateIds.size}`);
    const usedSiteIds = new Set(initial.map((settlement) => settlement.siteId));
    const originalRegionByState = new Map(initial.map((settlement) => {
      const site = siteById.get(settlement.siteId);
      if (!site) throw new Error(`Initial Settlement ${settlement.settlementId} references missing Site ${settlement.siteId}`);
      if (site.regionId === "R10") throw new Error("R10 cannot be part of the Year-0 founding skeleton");
      return [settlement.stateId, site.regionId] as const;
    }));
    for (const wave of foundingWaves) {
      const ordinalWithinRegion = Number(wave.eventKey.at(-1)) as 2 | 3 | 4 | 5;
      for (const stateId of [...stateIds].sort()) {
        const regionId = originalRegionByState.get(stateId)!;
        const candidates = canonical.sites
          .filter((site) => site.regionId === regionId && site.regionId !== "R10" && !site.prohibitedFounding && !usedSiteIds.has(site.siteId))
          .sort((left, right) => (right.quality ?? 0) - (left.quality ?? 0) || left.siteId.localeCompare(right.siteId));
        const selected = candidates[0];
        if (!selected) throw new Error(`Canonical founding ${wave.eventKey} cannot resolve ${world}/${stateId}/${regionId}`);
        usedSiteIds.add(selected.siteId);
        schedule[world].push({
          type: "CANONICAL_FOUNDING",
          transactionId: `TX_${world}_${wave.eventKey}_${stateId}`,
          year: wave.resolvedYear,
          foundingWaveId: wave.eventKey,
          ordinalWithinRegion,
          sourceStateId: stateId,
          regionId,
          targetSiteId: selected.siteId,
          settlementId: `SETTLEMENT_${world}_${selected.siteId}`,
          transferPolicyVersion: "CANONICAL_FOUNDING_TEN_PERCENT_PER_CELL_V1",
        });
      }
    }
  }
  const authority = ownerInputs.canonicalPolicies[DJT_POLICY_KEY_V5];
  if (authority === undefined) return Object.fromEntries(WORLDS.map((world) => [world, schedule[world].sort((left, right) => left.year - right.year || left.transactionId.localeCompare(right.transactionId))])) as Record<WorldKey, ScheduledTransactionV5[]>;
  if (!isDjtPolicy(authority)) throw new Error(`${DJT_POLICY_KEY_V5} is not a valid DJT owner policy`);
  if (!canonical.sites.some((site) => site.siteId === authority.r10SiteId && site.regionId === "R10")) throw new Error("DJT owner policy must target the canonical R10 Site");

  for (const world of WORLDS) {
    const seizureSiteId = canonical.sovereigns[world].seizureTargetSiteId;
    const seizure = canonical.initialSettlements.find((settlement) => settlement.worldKey === world && settlement.siteId === seizureSiteId);
    if (!seizure) throw new Error(`DJT seizure target ${world}/${seizureSiteId} is not an initial Settlement`);
    schedule[world].push({
      type: "DJT",
      transactionId: `TX_${world}_${authority.eventId}`,
      year: authority.year,
      policy: {
        eventId: `EVT_${world}_${authority.year}_${authority.eventId}`,
        r10SiteId: authority.r10SiteId,
        innerwoodStateId: authority.innerwoodStateIdByWorld[world],
        innerwoodGovernmentFormId: seizure.governmentFormId,
        nonSovereignSourceSettlementId: seizure.settlementId,
        sovereignSeizureSettlementId: seizure.settlementId,
        quarantineYears: authority.quarantineYears,
      },
    });
  }
  return Object.fromEntries(WORLDS.map((world) => [world, schedule[world].sort((left, right) => left.year - right.year || left.transactionId.localeCompare(right.transactionId))])) as Record<WorldKey, ScheduledTransactionV5[]>;
}
