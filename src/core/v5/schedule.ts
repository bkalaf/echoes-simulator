import type { CanonicalDataV5, CausalOwnerInputsV1 } from "./config.js";
import type { ScheduledTransactionV5 } from "./engine.js";
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
): Record<WorldKey, ScheduledTransactionV5[]> {
  const schedule = { CONCORD: [], SCHISM: [], RUIN: [] } as Record<WorldKey, ScheduledTransactionV5[]>;
  const authority = ownerInputs.canonicalPolicies[DJT_POLICY_KEY_V5];
  if (authority === undefined) return schedule;
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
  return schedule;
}
