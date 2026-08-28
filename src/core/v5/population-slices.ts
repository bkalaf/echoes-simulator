import { createHash } from "node:crypto";
import type { BreedAuthorityV5, CanonicalDataV5, MechanicsVariablesV1 } from "./config.js";
import type { DerogatoryMembershipPredicateV1, DerogatoryMembershipSlicingPolicyV1 } from "./historical-policies.js";
import type { BasisPoints, DerogatoryGroupIdV5, FactionVector, SocialTier, TargetedPopulationSliceV5, WorldKey, WorldStateV5 } from "./types.js";
import { V5_TIERS } from "./types.js";
import { divideRoundedAway } from "./fixed-point.js";
import { effectiveGrowthRatePpm } from "./population.js";
import { resolveBreedFaction } from "./faction.js";

const WORLDS: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];

function id(parts: readonly (string | number)[]): string {
  return `POP_SLICE_${createHash("sha256").update(parts.join("\u0000"), "utf8").digest("hex").slice(0, 24)}`;
}

function normalizedOpinion(breed: BreedAuthorityV5): FactionVector {
  const total = WORLDS.reduce((sum, world) => sum + Math.max(0, breed.factionObject[world] ?? 0), 0);
  if (total <= 0) return { CONCORD: 334, SCHISM: 333, RUIN: 333 };
  const floors = Object.fromEntries(WORLDS.map((world) => [world, Math.floor(Math.max(0, breed.factionObject[world] ?? 0) * 1000 / total)])) as FactionVector;
  let remaining = 1000 - WORLDS.reduce((sum, world) => sum + floors[world], 0);
  for (const world of WORLDS) { if (remaining-- <= 0) break; floors[world] += 1; }
  return floors;
}

function aggregateKey(locationType: "PUBLIC_SETTLEMENT" | "ENCLAVE", locationId: string, breedId: string, tier: SocialTier): string {
  return `${locationType}\u0000${locationId}\u0000${breedId}\u0000${tier}`;
}

function newPublicSlice(state: WorldStateV5, breed: BreedAuthorityV5, settlementId: string, tier: SocialTier, population: bigint): TargetedPopulationSliceV5 {
  const breedId = breed.breedId;
  return { populationSliceId: id([state.worldKey, settlementId, breedId, tier, "BASE"]), locationType: "PUBLIC_SETTLEMENT", locationId: settlementId, breedId, tier, population, membershipSignature: [], factionOpinion: normalizedOpinion(breed), growthModifierPpm: 0, growthModifierUntilYear: null, confiscationScore: 0, restrictionKeys: [], provenanceRefs: ["V5.4_PUBLIC_AGGREGATE_PARTITION"] };
}

export function ensurePopulationSlicesV5(state: WorldStateV5, canonical: CanonicalDataV5): WorldStateV5 {
  const slices = [...(state.populationSlices ?? [])];
  const breedsById = new Map(canonical.breeds.map((breed) => [breed.breedId, breed]));
  const existing = new Set(slices.filter((slice) => slice.locationType === "PUBLIC_SETTLEMENT").map((slice) => aggregateKey(slice.locationType, slice.locationId, slice.breedId, slice.tier)));
  let added = false;
  for (const cell of state.cohorts) for (const tier of V5_TIERS) {
    const key = aggregateKey("PUBLIC_SETTLEMENT", cell.settlementId, cell.breedId, tier);
    const breed = breedsById.get(cell.breedId);
    if (!breed) throw new Error(`Unknown Breed ${cell.breedId} while constructing population partition`);
    if (!existing.has(key) && cell.tiers[tier].population > 0n) { slices.push(newPublicSlice(state, breed, cell.settlementId, tier, cell.tiers[tier].population)); added = true; }
  }
  return added || state.populationSlices === undefined ? { ...state, populationSlices: compactPopulationSlicesV5(slices) } : state;
}

function apportion(total: bigint, weighted: readonly { key: string; weight: bigint }[]): Map<string, bigint> {
  const result = new Map<string, bigint>();
  if (weighted.length === 0) return result;
  const weightTotal = weighted.reduce((sum, row) => sum + row.weight, 0n);
  if (weightTotal === 0n) {
    const base = total / BigInt(weighted.length); let remainder = total % BigInt(weighted.length);
    for (const row of [...weighted].sort((a, b) => a.key.localeCompare(b.key))) { result.set(row.key, base + (remainder > 0n ? 1n : 0n)); if (remainder > 0n) remainder -= 1n; }
    return result;
  }
  const ranked = weighted.map((row) => ({ ...row, floor: total * row.weight / weightTotal, remainder: total * row.weight % weightTotal }));
  let unassigned = total - ranked.reduce((sum, row) => sum + row.floor, 0n);
  ranked.sort((a, b) => a.remainder === b.remainder ? a.key.localeCompare(b.key) : a.remainder > b.remainder ? -1 : 1);
  for (const row of ranked) { result.set(row.key, row.floor + (unassigned > 0n ? 1n : 0n)); if (unassigned > 0n) unassigned -= 1n; }
  return result;
}

export function reconcilePublicPopulationSlicesV5(state: WorldStateV5, canonical: CanonicalDataV5): WorldStateV5 {
  const initialized = ensurePopulationSlicesV5(state, canonical);
  const slices = [...initialized.populationSlices!];
  const slicesByAggregate = new Map<string, TargetedPopulationSliceV5[]>();
  const currentTotals = new Map<string, bigint>();
  for (const slice of slices) {
    if (slice.locationType !== "PUBLIC_SETTLEMENT") continue;
    const key = aggregateKey(slice.locationType, slice.locationId, slice.breedId, slice.tier);
    const aggregate = slicesByAggregate.get(key) ?? [];
    aggregate.push(slice);
    slicesByAggregate.set(key, aggregate);
    currentTotals.set(key, (currentTotals.get(key) ?? 0n) + slice.population);
  }
  const mismatched = initialized.cohorts.flatMap((cell) => V5_TIERS.map((tier) => ({ cell, tier, key: aggregateKey("PUBLIC_SETTLEMENT", cell.settlementId, cell.breedId, tier) }))).filter(({ cell, tier, key }) => (currentTotals.get(key) ?? 0n) !== cell.tiers[tier].population);
  if (mismatched.length === 0) return initialized;
  const populationBySliceId = new Map<string, bigint>();
  for (const { cell, tier, key } of mismatched) {
    const matches = slicesByAggregate.get(key) ?? [];
    const allocations = apportion(cell.tiers[tier].population, matches.map((slice) => ({ key: slice.populationSliceId, weight: slice.population })));
    for (const [sliceId, population] of allocations) populationBySliceId.set(sliceId, population);
  }
  return { ...initialized, populationSlices: compactPopulationSlicesV5(slices.map((slice) => populationBySliceId.has(slice.populationSliceId) ? { ...slice, population: populationBySliceId.get(slice.populationSliceId)! } : slice)) };
}

function matchesWholePredicate(predicate: DerogatoryMembershipPredicateV1, breed: BreedAuthorityV5, state: WorldStateV5, slice: TargetedPopulationSliceV5, canonical: CanonicalDataV5): boolean {
  if (predicate.populationKinds?.includes(breed.populationKind)) return true;
  const siteId = slice.locationType === "PUBLIC_SETTLEMENT" ? state.settlements.find((row) => row.settlementId === slice.locationId)?.siteId : state.settlements.find((row) => row.settlementId === state.enclaves?.find((enclave) => enclave.enclaveId === slice.locationId)?.hostSettlementId)?.siteId;
  const site = canonical.sites.find((row) => row.siteId === siteId);
  if (predicate.breedIds?.includes(breed.breedId)) return true;
  if (predicate.terrainBroad?.some((terrain) => breed.terrainBroad.includes(terrain) || site?.terrainBroad.includes(terrain))) return true;
  if (predicate.terrainSpecific?.some((terrain) => breed.terrainSpecific.includes(terrain) || site?.terrainSpecific.includes(terrain))) return true;
  return false;
}

function splitSlice(slice: TargetedPopulationSliceV5, groupId: DerogatoryGroupIdV5, shareBps: BasisPoints, provenance: string): TargetedPopulationSliceV5[] {
  if (shareBps < 0 || shareBps > 10_000 || !Number.isSafeInteger(shareBps)) throw new Error(`Invalid membership share ${shareBps}`);
  if (shareBps === 0) return [slice];
  if (shareBps === 10_000) return [{ ...slice, membershipSignature: [...new Set([...slice.membershipSignature, groupId])].sort(), provenanceRefs: [...slice.provenanceRefs, provenance] }];
  const target = slice.population * BigInt(shareBps) / 10_000n;
  const remainder = slice.population - target;
  return [
    { ...slice, populationSliceId: id([slice.populationSliceId, groupId, "TARGET"]), population: target, membershipSignature: [...new Set([...slice.membershipSignature, groupId])].sort(), provenanceRefs: [...slice.provenanceRefs, provenance] },
    { ...slice, populationSliceId: id([slice.populationSliceId, groupId, "REMAINDER"]), population: remainder },
  ].filter((row) => row.population > 0n);
}

export function materializeDerogatoryMembershipV5(state: WorldStateV5, canonical: CanonicalDataV5, policy: DerogatoryMembershipSlicingPolicyV1, groupId: DerogatoryGroupIdV5): WorldStateV5 {
  const predicate = policy.predicates.find((row) => row.groupId === groupId);
  if (!predicate || predicate.status !== "READY") throw new Error(`Derogatory predicate ${groupId} is NOT_READY`);
  const initialized = ensurePopulationSlicesV5(state, canonical);
  const breedsById = new Map(canonical.breeds.map((breed) => [breed.breedId, breed]));
  const next: TargetedPopulationSliceV5[] = [];
  for (const slice of initialized.populationSlices!) {
    if (slice.membershipSignature.includes(groupId)) { next.push(slice); continue; }
    const breed = breedsById.get(slice.breedId);
    if (!breed) throw new Error(`Unknown Breed ${slice.breedId}`);
    if (matchesWholePredicate(predicate, breed, initialized, slice, canonical)) { next.push(...splitSlice(slice, groupId, 10_000, predicate.authorityRef ?? policy.schemaVersion)); continue; }
    if (predicate.aggregateShareBps === undefined) { next.push(slice); continue; }
    let share = predicate.aggregateShareBps;
    if (slice.membershipSignature.length > 0) {
      const overlapKey = [...slice.membershipSignature, groupId].sort().join("&");
      const conditional = policy.conditionalOverlapSharesBps[overlapKey];
      if (conditional === undefined) throw new Error(`Approved conditional overlap share required for ${overlapKey}`);
      share = conditional;
    }
    next.push(...splitSlice(slice, groupId, share, predicate.authorityRef ?? policy.schemaVersion));
  }
  const result = { ...initialized, populationSlices: compactPopulationSlicesV5(next) };
  if (result.populationSlices!.length > state.cohorts.length * V5_TIERS.length * policy.maximumMaterializedSlicesPerAggregate) throw new Error("Population slice materialization bound exceeded");
  validatePopulationPartitionV5(result);
  return result;
}

export function compactPopulationSlicesV5(slices: readonly TargetedPopulationSliceV5[]): TargetedPopulationSliceV5[] {
  const merged = new Map<string, TargetedPopulationSliceV5>();
  for (const slice of slices.filter((row) => row.population > 0n)) {
    const key = [slice.locationType, slice.locationId, slice.breedId, slice.tier, slice.membershipSignature.join(","), ...WORLDS.map((world) => slice.factionOpinion[world]), slice.growthModifierPpm, slice.growthModifierUntilYear ?? "", slice.confiscationScore ?? 0, slice.restrictionKeys.join(",")].join("\u0000");
    const prior = merged.get(key);
    if (prior) merged.set(key, { ...prior, population: prior.population + slice.population, provenanceRefs: [...new Set([...prior.provenanceRefs, ...slice.provenanceRefs])].sort() });
    else merged.set(key, { ...slice, membershipSignature: [...slice.membershipSignature].sort(), restrictionKeys: [...slice.restrictionKeys].sort(), provenanceRefs: [...new Set(slice.provenanceRefs)].sort() });
  }
  return [...merged.values()].sort((a, b) => a.locationType.localeCompare(b.locationType) || a.locationId.localeCompare(b.locationId) || a.breedId.localeCompare(b.breedId) || a.tier.localeCompare(b.tier) || a.populationSliceId.localeCompare(b.populationSliceId));
}

export function validatePopulationPartitionV5(state: WorldStateV5): void {
  const slices = state.populationSlices ?? [];
  const publicTotals = new Map<string, bigint>();
  for (const slice of slices) {
    if (slice.population < 0n) throw new Error(`Negative population slice ${slice.populationSliceId}`);
    if (slice.locationType === "PUBLIC_SETTLEMENT") {
      const key = aggregateKey(slice.locationType, slice.locationId, slice.breedId, slice.tier);
      publicTotals.set(key, (publicTotals.get(key) ?? 0n) + slice.population);
    } else if (!state.enclaves?.some((enclave) => enclave.enclaveId === slice.locationId)) throw new Error(`Population slice ${slice.populationSliceId} references unknown Enclave`);
  }
  for (const cell of state.cohorts) for (const tier of V5_TIERS) {
    const key = aggregateKey("PUBLIC_SETTLEMENT", cell.settlementId, cell.breedId, tier);
    if ((publicTotals.get(key) ?? 0n) !== cell.tiers[tier].population) throw new Error(`Population partition mismatch for ${cell.settlementId}/${cell.breedId}/${tier}`);
  }
}

export function causalPopulationTotalsV5(state: WorldStateV5): { publicPopulation: bigint; enclavePopulation: bigint; causalTotalPopulation: bigint } {
  const publicPopulation = state.cohorts.reduce((sum, cell) => sum + V5_TIERS.reduce((tierSum, tier) => tierSum + cell.tiers[tier].population, 0n), 0n);
  const enclavePopulation = (state.populationSlices ?? []).filter((slice) => slice.locationType === "ENCLAVE").reduce((sum, slice) => sum + slice.population, 0n);
  return { publicPopulation, enclavePopulation, causalTotalPopulation: publicPopulation + enclavePopulation };
}

export function applyTargetedMortalityV5(state: WorldStateV5, groupId: DerogatoryGroupIdV5, mortalityBps: BasisPoints, sourceEventId: string): { state: WorldStateV5; deaths: bigint } {
  if (!Number.isSafeInteger(mortalityBps) || mortalityBps < 0 || mortalityBps > 10_000) throw new Error("Invalid targeted mortality basis points");
  const eligible = (state.populationSlices ?? []).filter((slice) => slice.membershipSignature.includes(groupId));
  const eligiblePopulation = eligible.reduce((sum, slice) => sum + slice.population, 0n);
  const deaths = eligiblePopulation * BigInt(mortalityBps) / 10_000n;
  const deathsBySlice = apportion(deaths, eligible.map((slice) => ({ key: slice.populationSliceId, weight: slice.population })));
  const populationSlices = compactPopulationSlicesV5((state.populationSlices ?? []).map((slice) => ({ ...slice, population: slice.population - (deathsBySlice.get(slice.populationSliceId) ?? 0n), provenanceRefs: deathsBySlice.has(slice.populationSliceId) ? [...slice.provenanceRefs, sourceEventId] : slice.provenanceRefs })));
  const publicDeaths = new Map<string, bigint>();
  for (const slice of state.populationSlices ?? []) if (slice.locationType === "PUBLIC_SETTLEMENT") { const amount = deathsBySlice.get(slice.populationSliceId) ?? 0n; const key = `${slice.locationId}\u0000${slice.breedId}\u0000${slice.tier}`; publicDeaths.set(key, (publicDeaths.get(key) ?? 0n) + amount); }
  const cohorts = state.cohorts.map((cell) => ({ ...cell, tiers: Object.fromEntries(V5_TIERS.map((tier) => [tier, { ...cell.tiers[tier], population: cell.tiers[tier].population - (publicDeaths.get(`${cell.settlementId}\u0000${cell.breedId}\u0000${tier}`) ?? 0n) }])) as typeof cell.tiers }));
  const next = { ...state, cohorts, populationSlices }; validatePopulationPartitionV5(next); return { state: next, deaths };
}

export function adjustTargetedFactionOpinionV5(state: WorldStateV5, groupId: DerogatoryGroupIdV5, faction: WorldKey, delta: number, sourceEventId: string): WorldStateV5 {
  return { ...state, populationSlices: (state.populationSlices ?? []).map((slice) => slice.membershipSignature.includes(groupId) ? { ...slice, factionOpinion: { ...slice.factionOpinion, [faction]: Math.max(0, Math.min(1000, slice.factionOpinion[faction] + delta)) }, provenanceRefs: [...slice.provenanceRefs, sourceEventId] } : slice) };
}

export function adjustTargetedFactionOpinionAtLocationV5(state: WorldStateV5, groupId: DerogatoryGroupIdV5, locationType: "PUBLIC_SETTLEMENT" | "ENCLAVE", locationId: string, faction: WorldKey, delta: number, sourceEventId: string): WorldStateV5 {
  if (!Number.isSafeInteger(delta) || delta < -1000 || delta > 1000) throw new Error("Invalid targeted faction-opinion delta");
  return {
    ...state,
    populationSlices: (state.populationSlices ?? []).map((slice) => slice.locationType === locationType && slice.locationId === locationId && slice.membershipSignature.includes(groupId)
      ? { ...slice, factionOpinion: { ...slice.factionOpinion, [faction]: Math.max(0, Math.min(1000, slice.factionOpinion[faction] + delta)) }, provenanceRefs: [...slice.provenanceRefs, sourceEventId] }
      : slice),
  };
}

export function applyTargetedGrowthSuppressionV5(state: WorldStateV5, groupId: DerogatoryGroupIdV5, modifierPpm: number, untilYear: number, sourceEventId: string): WorldStateV5 {
  if (!Number.isSafeInteger(modifierPpm) || modifierPpm > 0 || modifierPpm < -1_000_000) throw new Error("Invalid growth suppression ppm");
  return { ...state, populationSlices: (state.populationSlices ?? []).map((slice) => slice.membershipSignature.includes(groupId) ? { ...slice, growthModifierPpm: Math.min(slice.growthModifierPpm, modifierPpm), growthModifierUntilYear: Math.max(slice.growthModifierUntilYear ?? untilYear, untilYear), provenanceRefs: [...slice.provenanceRefs, sourceEventId] } : slice) };
}

export function applyPublicSliceGrowthModifiersV5(prior: WorldStateV5, postDemography: WorldStateV5): WorldStateV5 {
  const priorById = new Map((prior.populationSlices ?? []).map((slice) => [slice.populationSliceId, slice])); const reductions = new Map<string, bigint>();
  const populationSlices = (postDemography.populationSlices ?? []).map((slice) => {
    const previous = priorById.get(slice.populationSliceId); const activeModifier = slice.growthModifierUntilYear !== null && slice.growthModifierUntilYear >= postDemography.year ? slice.growthModifierPpm : 0;
    if (slice.locationType !== "PUBLIC_SETTLEMENT" || !previous || activeModifier >= 0) return slice.growthModifierUntilYear !== null && slice.growthModifierUntilYear < postDemography.year ? { ...slice, growthModifierPpm: 0, growthModifierUntilYear: null } : slice;
    const allocatedGrowth = slice.population > previous.population ? slice.population - previous.population : 0n; const reduction = allocatedGrowth * BigInt(-activeModifier) / 1_000_000n;
    if (reduction > 0n) { const key = `${slice.locationId}\u0000${slice.breedId}\u0000${slice.tier}`; reductions.set(key, (reductions.get(key) ?? 0n) + reduction); }
    return { ...slice, population: slice.population - reduction };
  });
  const cohorts = postDemography.cohorts.map((cell) => ({ ...cell, tiers: Object.fromEntries(V5_TIERS.map((tier) => [tier, { ...cell.tiers[tier], population: cell.tiers[tier].population - (reductions.get(`${cell.settlementId}\u0000${cell.breedId}\u0000${tier}`) ?? 0n) }])) as typeof cell.tiers }));
  const result = { ...postDemography, cohorts, populationSlices: compactPopulationSlicesV5(populationSlices) }; validatePopulationPartitionV5(result); return result;
}

export function applyEnclaveDemographyV5(state: WorldStateV5, canonical: CanonicalDataV5, variables: MechanicsVariablesV1, settlementDominantFactions: Readonly<Record<string, WorldKey>>): { state: WorldStateV5; growth: bigint } {
  if (!(state.enclaves ?? []).some((row) => row.status === "ACTIVE")) return { state, growth: 0n };
  const sovereign = canonical.sovereigns[state.worldKey].sovereignFaction; let totalGrowth = 0n;
  const populationSlices = (state.populationSlices ?? []).map((slice) => {
    if (slice.locationType !== "ENCLAVE") return slice;
    const enclave = state.enclaves!.find((row) => row.enclaveId === slice.locationId); if (!enclave || enclave.status !== "ACTIVE") return slice;
    const breed = canonical.breeds.find((row) => row.breedId === slice.breedId); if (!breed) throw new Error(`Unknown Enclave Breed ${slice.breedId}`);
    const baseRate = effectiveGrowthRatePpm(resolveBreedFaction(breed, sovereign, variables.sovereignTieBreak), sovereign, settlementDominantFactions[enclave.hostSettlementId]!, variables);
    const modifier = slice.growthModifierUntilYear !== null && slice.growthModifierUntilYear >= state.year ? slice.growthModifierPpm : 0; const rate = Math.max(0, baseRate + modifier);
    const growth = slice.population === 0n ? 0n : divideRoundedAway(slice.population * BigInt(rate), 1_000_000n); totalGrowth += growth;
    return { ...slice, population: slice.population + growth, growthModifierPpm: slice.growthModifierUntilYear !== null && slice.growthModifierUntilYear < state.year ? 0 : slice.growthModifierPpm, growthModifierUntilYear: slice.growthModifierUntilYear !== null && slice.growthModifierUntilYear < state.year ? null : slice.growthModifierUntilYear };
  });
  return { state: { ...state, populationSlices: compactPopulationSlicesV5(populationSlices) }, growth: totalGrowth };
}

export function applyTargetedConfiscationV5(state: WorldStateV5, groupId: DerogatoryGroupIdV5, score: number, sourceEventId: string): WorldStateV5 {
  if (!Number.isSafeInteger(score) || score < 0 || score > 1000) throw new Error("Invalid targeted confiscation score");
  return { ...state, populationSlices: (state.populationSlices ?? []).map((slice) => slice.membershipSignature.includes(groupId) ? { ...slice, confiscationScore: Math.max(slice.confiscationScore ?? 0, score), restrictionKeys: [...new Set([...slice.restrictionKeys, `CONFISCATION:${sourceEventId}`])].sort(), provenanceRefs: [...slice.provenanceRefs, sourceEventId] } : slice) };
}

export function applyTargetedRestrictionV5(state: WorldStateV5, groupId: DerogatoryGroupIdV5, restrictionKey: string, sourceEventId: string): WorldStateV5 {
  if (!restrictionKey.trim()) throw new Error("Targeted restriction key is empty");
  return { ...state, populationSlices: (state.populationSlices ?? []).map((slice) => slice.membershipSignature.includes(groupId) ? { ...slice, restrictionKeys: [...new Set([...slice.restrictionKeys, restrictionKey])].sort(), provenanceRefs: [...slice.provenanceRefs, sourceEventId] } : slice) };
}

export function transferTargetedPopulationV5(input: { state: WorldStateV5; groupId?: DerogatoryGroupIdV5; sourceLocationType: "PUBLIC_SETTLEMENT" | "ENCLAVE"; sourceLocationId: string; destinationLocationType: "PUBLIC_SETTLEMENT" | "ENCLAVE"; destinationLocationId: string; shareBps: BasisPoints; sourceEventId: string }): { state: WorldStateV5; transferred: bigint; transferredSliceIds: string[] } {
  if (!Number.isSafeInteger(input.shareBps) || input.shareBps < 0 || input.shareBps > 10_000) throw new Error("Invalid targeted transfer share");
  if (input.sourceLocationType === input.destinationLocationType && input.sourceLocationId === input.destinationLocationId) throw new Error("Targeted transfer source equals destination");
  const eligible = (input.state.populationSlices ?? []).filter((slice) => slice.locationType === input.sourceLocationType && slice.locationId === input.sourceLocationId && (!input.groupId || slice.membershipSignature.includes(input.groupId)));
  const eligiblePopulation = eligible.reduce((sum, slice) => sum + slice.population, 0n);
  const transferTotal = eligiblePopulation * BigInt(input.shareBps) / 10_000n;
  const moves = apportion(transferTotal, eligible.map((slice) => ({ key: slice.populationSliceId, weight: slice.population })));
  let transferred = 0n; const additions: TargetedPopulationSliceV5[] = [];
  const populationSlices = (input.state.populationSlices ?? []).map((slice) => {
    const amount = moves.get(slice.populationSliceId) ?? 0n; if (amount === 0n) return slice; transferred += amount;
    additions.push({ ...slice, populationSliceId: id([slice.populationSliceId, input.destinationLocationType, input.destinationLocationId, input.sourceEventId]), locationType: input.destinationLocationType, locationId: input.destinationLocationId, population: amount, provenanceRefs: [...slice.provenanceRefs, input.sourceEventId] });
    return { ...slice, population: slice.population - amount, provenanceRefs: [...slice.provenanceRefs, input.sourceEventId] };
  });
  const publicDelta = new Map<string, bigint>();
  for (const slice of eligible) { const amount = moves.get(slice.populationSliceId) ?? 0n; if (input.sourceLocationType === "PUBLIC_SETTLEMENT") { const key = `${input.sourceLocationId}\u0000${slice.breedId}\u0000${slice.tier}`; publicDelta.set(key, (publicDelta.get(key) ?? 0n) - amount); } if (input.destinationLocationType === "PUBLIC_SETTLEMENT") { const key = `${input.destinationLocationId}\u0000${slice.breedId}\u0000${slice.tier}`; publicDelta.set(key, (publicDelta.get(key) ?? 0n) + amount); } }
  const cohortMap = new Map(input.state.cohorts.map((cell) => [`${cell.settlementId}\u0000${cell.breedId}`, structuredClone(cell)]));
  for (const [key, delta] of publicDelta) { const [settlementId, breedId, tier] = key.split("\u0000") as [string, string, SocialTier]; const cellKey = `${settlementId}\u0000${breedId}`; let cell = cohortMap.get(cellKey); if (!cell) { cell = { settlementId, breedId, tiers: { HIGH: { population: 0n, prosperity: 500 }, MID: { population: 0n, prosperity: 500 }, LOW: { population: 0n, prosperity: 500 } } }; cohortMap.set(cellKey, cell); } cell.tiers[tier].population += delta; if (cell.tiers[tier].population < 0n) throw new Error(`Targeted transfer overdrew ${key}`); }
  const next = { ...input.state, cohorts: [...cohortMap.values()].filter((cell) => V5_TIERS.some((tier) => cell.tiers[tier].population > 0n)).sort((a, b) => `${a.settlementId}/${a.breedId}`.localeCompare(`${b.settlementId}/${b.breedId}`)), populationSlices: compactPopulationSlicesV5([...populationSlices, ...additions]) };
  validatePopulationPartitionV5(next); return { state: next, transferred, transferredSliceIds: additions.map((row) => row.populationSliceId).sort() };
}

export function applyLocationMortalityV5(state: WorldStateV5, locationType: "PUBLIC_SETTLEMENT" | "ENCLAVE", locationId: string, mortalityBps: BasisPoints, sourceEventId: string): { state: WorldStateV5; deaths: bigint } {
  if (!Number.isSafeInteger(mortalityBps) || mortalityBps < 0 || mortalityBps > 10_000) throw new Error("Invalid location mortality basis points");
  const eligible = (state.populationSlices ?? []).filter((slice) => slice.locationType === locationType && slice.locationId === locationId);
  const eligiblePopulation = eligible.reduce((sum, slice) => sum + slice.population, 0n);
  const deaths = eligiblePopulation * BigInt(mortalityBps) / 10_000n;
  const losses = apportion(deaths, eligible.map((slice) => ({ key: slice.populationSliceId, weight: slice.population })));
  const populationSlices = compactPopulationSlicesV5((state.populationSlices ?? []).map((slice) => ({ ...slice, population: slice.population - (losses.get(slice.populationSliceId) ?? 0n), provenanceRefs: (losses.get(slice.populationSliceId) ?? 0n) > 0n ? [...slice.provenanceRefs, sourceEventId] : slice.provenanceRefs })));
  const publicLosses = new Map<string, bigint>(); for (const slice of eligible) if (slice.locationType === "PUBLIC_SETTLEMENT") { const key = `${slice.locationId}\u0000${slice.breedId}\u0000${slice.tier}`; publicLosses.set(key, (publicLosses.get(key) ?? 0n) + (losses.get(slice.populationSliceId) ?? 0n)); }
  const cohorts = state.cohorts.map((cell) => ({ ...cell, tiers: Object.fromEntries(V5_TIERS.map((tier) => [tier, { ...cell.tiers[tier], population: cell.tiers[tier].population - (publicLosses.get(`${cell.settlementId}\u0000${cell.breedId}\u0000${tier}`) ?? 0n) }])) as typeof cell.tiers }));
  const next = { ...state, cohorts, populationSlices }; validatePopulationPartitionV5(next); return { state: next, deaths };
}
