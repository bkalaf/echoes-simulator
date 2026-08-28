import { createHash } from "node:crypto";
import type { CanonicalDataV5 } from "./config.js";
import type { PersecutionDisplacementEnclavePolicyV1 } from "./historical-policies.js";
import { causalPopulationTotalsV5, transferTargetedPopulationV5, validatePopulationPartitionV5 } from "./population-slices.js";
import type { DerogatoryGroupIdV5, EnclaveFormV5, EnclaveSecrecyStateV5, EnclaveV5, ForcedDisplacementRecordV5, WorldStateV5 } from "./types.js";
import { divideRoundedAway } from "./fixed-point.js";

function digest(parts: readonly string[]): string { return createHash("sha256").update(parts.join("\u0000"), "utf8").digest("hex").slice(0, 24); }

export interface EnclaveFoundingAuthorizationV5 {
  targetingSelectionId: string;
  persecutionOrDisplacementEventId: string;
  sanctuaryResponseId: string;
  authorizationRef: string;
}

function validateForm(hostSettlementId: string, form: EnclaveFormV5, state: WorldStateV5, canonical: CanonicalDataV5, policy: PersecutionDisplacementEnclavePolicyV1): void {
  const settlement = state.settlements.find((row) => row.settlementId === hostSettlementId); if (!settlement) throw new Error(`Unknown Enclave host Settlement ${hostSettlementId}`);
  const site = canonical.sites.find((row) => row.siteId === settlement.siteId); if (!site) throw new Error(`Unknown host Site ${settlement.siteId}`);
  const tags = [...site.terrainBroad, ...site.terrainSpecific];
  const permitted = form === "CAVERN" ? policy.cavernTerrain.some((tag) => tags.includes(tag)) : form === "UNDERWATER" ? policy.underwaterTerrain.some((tag) => tags.includes(tag)) : form === "FLOATING_UNDERSIDE" ? policy.floatingUndersideTerrain.some((tag) => tags.includes(tag)) : false;
  if (!permitted) throw new Error(`Enclave form ${form} is unsupported at ${hostSettlementId}`);
}

export function foundEnclaveV5(input: { state: WorldStateV5; canonical: CanonicalDataV5; policy: PersecutionDisplacementEnclavePolicyV1; hostSettlementId: string; targetGroupId: DerogatoryGroupIdV5; form: EnclaveFormV5; secrecyState: EnclaveSecrecyStateV5; sourceEventId: string; authorization: EnclaveFoundingAuthorizationV5 }): { state: WorldStateV5; enclave: EnclaveV5 } {
  for (const [key, value] of Object.entries(input.authorization)) if (!value.trim()) throw new Error(`Enclave founding lacks ${key}`);
  if (!(input.state.derogatoryTargetSelections ?? []).some((row) => row.selectionId === input.authorization.targetingSelectionId && row.selectedGroupId === input.targetGroupId)) throw new Error("Enclave founding lacks the cited active targeting selection");
  if (!(input.state.localAtrocityResponses ?? []).some((row) => row.responseId === input.authorization.sanctuaryResponseId && ["SANCTUARY", "SECURITY_PROTECTION", "RESETTLEMENT"].includes(row.responseType))) throw new Error("Enclave founding lacks the cited sanctuary/protection response");
  validateForm(input.hostSettlementId, input.form, input.state, input.canonical, input.policy);
  const enclaveId = `ENCLAVE_${input.state.worldKey}_${digest([input.hostSettlementId, input.targetGroupId, input.sourceEventId])}`;
  if ((input.state.enclaves ?? []).some((row) => row.enclaveId === enclaveId)) throw new Error(`Enclave ${enclaveId} already exists`);
  const enclave: EnclaveV5 = { enclaveId, hostSettlementId: input.hostSettlementId, targetGroupId: input.targetGroupId, foundedYear: input.state.year, foundedByEventId: input.sourceEventId, foundingCause: "ATROCITY_REFUGE", enclaveForm: input.form, secrecyState: input.secrecyState, status: "ACTIVE", supportBurden: 0 };
  return { state: { ...input.state, enclaves: [...(input.state.enclaves ?? []), enclave].sort((a, b) => a.enclaveId.localeCompare(b.enclaveId)) }, enclave };
}

export function recomputeEnclaveSupportBurdensV5(state: WorldStateV5, policy: PersecutionDisplacementEnclavePolicyV1): WorldStateV5 {
  const enclaves = (state.enclaves ?? []).map((enclave) => {
    if (enclave.status !== "ACTIVE") return { ...enclave, supportBurden: 0 };
    const enclavePopulation = (state.populationSlices ?? []).filter((slice) => slice.locationType === "ENCLAVE" && slice.locationId === enclave.enclaveId).reduce((sum, slice) => sum + slice.population, 0n);
    const hostPopulation = state.cohorts.filter((cell) => cell.settlementId === enclave.hostSettlementId).reduce((sum, cell) => sum + cell.tiers.HIGH.population + cell.tiers.MID.population + cell.tiers.LOW.population, 0n);
    const combined = hostPopulation + enclavePopulation;
    const hiddenPopulationShare = combined === 0n ? 0 : Number(enclavePopulation * 1000n / combined);
    const secrecyProtection = enclave.secrecyState === "HIDDEN" ? 1000 : enclave.secrecyState === "RUMORED" ? 600 : enclave.secrecyState === "EXPOSED" ? 200 : 0;
    const accessDifficulty = enclave.enclaveForm === "FLOATING_UNDERSIDE" ? 900 : enclave.enclaveForm === "UNDERWATER" ? 800 : 700;
    const institutionCapacity = Math.min(1000, state.institutions.filter((row) => row.jurisdictionSettlementId === enclave.hostSettlementId && row.dissolvedYear === null).reduce((sum, row) => sum + (row.capacity ?? 0), 0));
    const metrics = { hiddenPopulationShare, secrecyProtection, accessDifficulty, inverseInstitutionCapacity: 1000 - institutionCapacity };
    const weighted = Object.entries(policy.enclaveSupportBurdenWeights).reduce((sum, [key, weight]) => sum + metrics[key as keyof typeof metrics] * weight, 0);
    return { ...enclave, supportBurden: Math.max(0, Math.min(1000, Number(divideRoundedAway(BigInt(weighted), 10_000n)))) };
  });
  return { ...state, enclaves };
}

export function admitTargetedPopulationToEnclaveV5(input: { state: WorldStateV5; policy: PersecutionDisplacementEnclavePolicyV1; enclaveId: string; sourceSettlementId: string; groupId: DerogatoryGroupIdV5; shareBps: number; sourceEventId: string; cause: ForcedDisplacementRecordV5["cause"] }): { state: WorldStateV5; displacement: ForcedDisplacementRecordV5 } {
  const enclave = input.state.enclaves?.find((row) => row.enclaveId === input.enclaveId && row.status === "ACTIVE"); if (!enclave) throw new Error(`Unknown active Enclave ${input.enclaveId}`);
  if (enclave.targetGroupId !== input.groupId) throw new Error("Enclave admission target group mismatch");
  const moved = transferTargetedPopulationV5({ state: input.state, groupId: input.groupId, sourceLocationType: "PUBLIC_SETTLEMENT", sourceLocationId: input.sourceSettlementId, destinationLocationType: "ENCLAVE", destinationLocationId: input.enclaveId, shareBps: input.shareBps, sourceEventId: input.sourceEventId });
  const admittedBreeds = new Set((moved.state.populationSlices ?? []).filter((slice) => slice.locationType === "ENCLAVE" && slice.locationId === input.enclaveId).map((slice) => slice.breedId));
  if (admittedBreeds.size > input.policy.enclaveMaximumBreedsAtFounding) throw new Error(`Enclave founding admits ${admittedBreeds.size} Breeds, exceeding the approved maximum ${input.policy.enclaveMaximumBreedsAtFounding}`);
  const displacement: ForcedDisplacementRecordV5 = { displacementId: `DISPLACEMENT_${digest([input.sourceEventId, input.sourceSettlementId, input.enclaveId])}`, sourceEventId: input.sourceEventId, sourceLocationType: "PUBLIC_SETTLEMENT", sourceLocationId: input.sourceSettlementId, destinationLocationType: "ENCLAVE", destinationLocationId: input.enclaveId, populationSliceId: moved.transferredSliceIds.join(","), population: moved.transferred, year: input.state.year, cause: input.cause };
  const state = recomputeEnclaveSupportBurdensV5({ ...moved.state, forcedDisplacements: [...(moved.state.forcedDisplacements ?? []), displacement] }, input.policy); validatePopulationPartitionV5(state); return { state, displacement };
}

export function integrateEnclaveV5(state: WorldStateV5, enclaveId: string, sourceEventId: string): WorldStateV5 {
  const enclave = state.enclaves?.find((row) => row.enclaveId === enclaveId && row.status === "ACTIVE"); if (!enclave) throw new Error(`Unknown active Enclave ${enclaveId}`);
  const moved = transferTargetedPopulationV5({ state, groupId: enclave.targetGroupId, sourceLocationType: "ENCLAVE", sourceLocationId: enclaveId, destinationLocationType: "PUBLIC_SETTLEMENT", destinationLocationId: enclave.hostSettlementId, shareBps: 10_000, sourceEventId });
  const next = { ...moved.state, enclaves: moved.state.enclaves!.map((row) => row.enclaveId === enclaveId ? { ...row, secrecyState: "INTEGRATED" as const, status: "DISSOLVED" as const } : row) }; validatePopulationPartitionV5(next); return next;
}

export function publicEnclaveProjectionV5(state: WorldStateV5): Array<{ enclaveId: string | null; hostSettlementId: string; secrecyState: "RUMORED" | "EXPOSED" | "INTEGRATED"; targetGroupId?: DerogatoryGroupIdV5; population?: string }> {
  const result: Array<{ enclaveId: string | null; hostSettlementId: string; secrecyState: "RUMORED" | "EXPOSED" | "INTEGRATED"; targetGroupId?: DerogatoryGroupIdV5; population?: string }> = [];
  for (const enclave of state.enclaves ?? []) {
    if (enclave.secrecyState === "HIDDEN") continue;
    if (enclave.secrecyState === "RUMORED") { result.push({ enclaveId: null, hostSettlementId: enclave.hostSettlementId, secrecyState: "RUMORED" }); continue; }
    const population = (state.populationSlices ?? []).filter((slice) => slice.locationType === "ENCLAVE" && slice.locationId === enclave.enclaveId).reduce((sum, slice) => sum + slice.population, 0n);
    result.push({ enclaveId: enclave.enclaveId, hostSettlementId: enclave.hostSettlementId, secrecyState: enclave.secrecyState, targetGroupId: enclave.targetGroupId, population: population.toString() });
  }
  return result;
}

export function enclavePopulationInvariantV5(state: WorldStateV5): void {
  validatePopulationPartitionV5(state); const totals = causalPopulationTotalsV5(state);
  if (totals.causalTotalPopulation !== totals.publicPopulation + totals.enclavePopulation) throw new Error("Causal population does not equal public plus Enclave population");
}
