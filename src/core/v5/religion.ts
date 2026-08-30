import type { WorldKey } from "./types.js";

export type ReligiousSiteKindV1 = "TEMPLE" | "SHRINE";
export interface ReligiousSiteV1 { religiousSiteId: string; worldKey: WorldKey; deityId: string; pantheonId: string; settlementId: string; stateId: string; siteKind: ReligiousSiteKindV1; qualifyingPopulation: bigint }
export interface PantheonCenterDesignationV1 { designationId: string; worldKey: WorldKey; pantheonId: string; stateId: string; settlementId: string; effectiveFromYear: number; presentationLabel: string }

export function validateReligiousSiteCardinalityV1(sites: readonly ReligiousSiteV1[]): void {
  const seen = new Set<string>();
  for (const site of sites) {
    const key = `${site.worldKey}\0${site.deityId}\0${site.siteKind}`;
    if (seen.has(key)) throw new Error(`A Deity may have at most one ${site.siteKind} per world: ${site.deityId} ${site.worldKey}`);
    seen.add(key);
  }
}

/** Applies the approved structural algorithm to already-qualified sites. */
export function selectPantheonCenterDesignationV1(input: { worldKey: WorldKey; pantheonId: string; effectiveFromYear: number; qualifyingSites: readonly ReligiousSiteV1[]; presentationLabel?: string }): PantheonCenterDesignationV1 | null {
  const eligible = input.qualifyingSites.filter((site) => site.worldKey === input.worldKey && site.pantheonId === input.pantheonId);
  if (eligible.length === 0) return null;
  const siteCountByState = new Map<string, number>();
  for (const site of eligible) siteCountByState.set(site.stateId, (siteCountByState.get(site.stateId) ?? 0) + 1);
  const maximum = Math.max(...siteCountByState.values());
  const tiedStates = new Set([...siteCountByState].filter(([, count]) => count === maximum).map(([stateId]) => stateId));
  const settlementCandidates = new Map<string, { stateId: string; qualifyingPopulation: bigint }>();
  for (const site of eligible.filter((candidate) => tiedStates.has(candidate.stateId))) {
    const prior = settlementCandidates.get(site.settlementId);
    if (!prior || site.qualifyingPopulation < prior.qualifyingPopulation) settlementCandidates.set(site.settlementId, { stateId: site.stateId, qualifyingPopulation: site.qualifyingPopulation });
  }
  const selected = [...settlementCandidates].sort((left, right) => left[1].qualifyingPopulation < right[1].qualifyingPopulation ? -1 : left[1].qualifyingPopulation > right[1].qualifyingPopulation ? 1 : left[0].localeCompare(right[0]))[0]!;
  return { designationId: `PANTHEON_CENTER_${input.worldKey}_${input.pantheonId}`, worldKey: input.worldKey, pantheonId: input.pantheonId, stateId: selected[1].stateId, settlementId: selected[0], effectiveFromYear: input.effectiveFromYear, presentationLabel: input.presentationLabel ?? "Pantheon Center" };
}
