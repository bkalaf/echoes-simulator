import type { CausalEventV5, WorldStateV5 } from "./types.js";
import { causalPopulationTotalsV5 } from "./population-slices.js";
import { publicEnclaveProjectionV5 } from "./enclaves.js";

export interface HistoricalExportV54 {
  schemaVersion: "echoes-v5.4-private-history-v1" | "echoes-v5.4-public-history-v1";
  audience: "PRIVATE_OPERATOR" | "PUBLIC";
  worldKey: WorldStateV5["worldKey"];
  yearStart: 0;
  yearEnd: number;
  population: { publicPopulation: string; enclavePopulation?: string; causalTotalPopulation?: string };
  resources: unknown[];
  industries: unknown[];
  institutions: unknown[];
  securityForces: unknown[];
  diplomacy: unknown[];
  conflicts: unknown[];
  derogatorySelections: unknown[];
  atrocities: unknown[];
  displacement: unknown[];
  enclaves: unknown[];
  populationSlices?: unknown[];
}

const stringifyBigInts = <T>(value: T): T => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item)) as T;

export function buildPrivateHistoricalExportV54(state: WorldStateV5, events: readonly CausalEventV5[]): HistoricalExportV54 {
  const totals = causalPopulationTotalsV5(state);
  return stringifyBigInts({ schemaVersion: "echoes-v5.4-private-history-v1", audience: "PRIVATE_OPERATOR", worldKey: state.worldKey, yearStart: 0, yearEnd: state.year, population: { publicPopulation: totals.publicPopulation.toString(), enclavePopulation: totals.enclavePopulation.toString(), causalTotalPopulation: totals.causalTotalPopulation.toString() }, resources: [{ physicalNodes: state.resourceNodes ?? [], worldStatus: state.worldResourceStates ?? [] }], industries: state.industries ?? [], institutions: state.institutions, securityForces: state.securityForces ?? [], diplomacy: [{ relations: state.diplomaticRelations ?? [], agreements: state.diplomaticAgreements ?? [] }], conflicts: [{ episodes: state.conflictEpisodes ?? [], controlTerms: state.settlementControlTerms ?? [] }], derogatorySelections: state.derogatoryTargetSelections ?? [], atrocities: events.filter((event) => event.eventType === "AtrocityOccurrenceResolved"), displacement: state.forcedDisplacements ?? [], enclaves: state.enclaves ?? [], populationSlices: state.populationSlices ?? [] });
}

function publicAtrocityEvent(event: CausalEventV5, suppressTargetIdentity: boolean): Record<string, unknown> {
  const payload = { ...event.payload }; delete payload.targetSliceIds; delete payload.enclavePopulationAfter; delete payload.causalTotalPopulationAfter;
  if (suppressTargetIdentity) { delete payload.targetGroupId; delete payload.selectionId; }
  if (Array.isArray(payload.typedEffects)) payload.typedEffects = payload.typedEffects.map((effect) => {
    if (!effect || typeof effect !== "object") return effect; const sanitized = { ...(effect as Record<string, unknown>) }; delete sanitized.enclaveId; delete sanitized.displaced; return sanitized;
  });
  return { eventId: event.eventId, year: event.year, eventType: event.eventType, entityType: event.entityType, entityId: event.entityId, causeEventIds: event.causeEventIds, payload };
}

export function buildPublicHistoricalExportV54(state: WorldStateV5, events: readonly CausalEventV5[]): HistoricalExportV54 {
  const totals = causalPopulationTotalsV5(state); const secretEnclaves = (state.enclaves ?? []).filter((row) => row.secrecyState === "HIDDEN" || row.secrecyState === "RUMORED"); const suppressTargetIdentity = secretEnclaves.length > 0;
  return stringifyBigInts({ schemaVersion: "echoes-v5.4-public-history-v1", audience: "PUBLIC", worldKey: state.worldKey, yearStart: 0, yearEnd: state.year, population: { publicPopulation: totals.publicPopulation.toString() }, resources: [{ physicalNodes: state.resourceNodes ?? [], worldStatus: state.worldResourceStates ?? [] }], industries: state.industries ?? [], institutions: state.institutions, securityForces: (state.securityForces ?? []).map(({ seniorOfficerPersonIds: _privateOfficers, loyalty: _privateLoyalty, ...force }) => force), diplomacy: [{ relations: state.diplomaticRelations ?? [], agreements: state.diplomaticAgreements ?? [] }], conflicts: [{ episodes: state.conflictEpisodes ?? [], controlTerms: state.settlementControlTerms ?? [] }], derogatorySelections: suppressTargetIdentity ? [] : state.derogatoryTargetSelections ?? [], atrocities: events.filter((event) => event.eventType === "AtrocityOccurrenceResolved").map((event) => publicAtrocityEvent(event, suppressTargetIdentity)), displacement: [], enclaves: publicEnclaveProjectionV5(state) });
}

export function assertNoSecretEnclaveLeakV54(state: WorldStateV5, publicExport: HistoricalExportV54): void {
  const serialized = JSON.stringify(publicExport);
  for (const enclave of state.enclaves ?? []) if (enclave.secrecyState === "HIDDEN" || enclave.secrecyState === "RUMORED") {
    if (serialized.includes(enclave.enclaveId) || serialized.includes(enclave.targetGroupId)) throw new Error(`Public history leaks secret Enclave identity ${enclave.enclaveId}`);
    for (const slice of state.populationSlices ?? []) if (slice.locationType === "ENCLAVE" && slice.locationId === enclave.enclaveId && serialized.includes(slice.populationSliceId)) throw new Error(`Public history leaks secret Enclave slice ${slice.populationSliceId}`);
  }
}
