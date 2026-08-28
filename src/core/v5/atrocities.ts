import type { CanonicalDataV5, CausalOwnerInputsV1 } from "./config.js";
import { V5_CAUSAL_DERIVATION_VERSION, V5_MECHANICS_VERSION } from "./config.js";
import { foundEnclaveV5, admitTargetedPopulationToEnclaveV5 } from "./enclaves.js";
import { requireHistoricalPolicyV5, type PersecutionDisplacementEnclavePolicyV1 } from "./historical-policies.js";
import { adjustTargetedFactionOpinionAtLocationV5, adjustTargetedFactionOpinionV5, applyTargetedConfiscationV5, applyTargetedGrowthSuppressionV5, applyTargetedMortalityV5, applyTargetedRestrictionV5, causalPopulationTotalsV5, validatePopulationPartitionV5 } from "./population-slices.js";
import type { AtrocityOccurrenceIdV5, BasisPoints, CausalEventV5, DerogatoryTargetingScopeV5, EnclaveFormV5, EnclaveSecrecyStateV5, LocalAtrocityResponseTypeV5, Score1000, TargetedPopulationSliceV5, WorldKey, WorldStateV5 } from "./types.js";
import { divideRoundedAway } from "./fixed-point.js";

export type AtrocityTypedEffectV5 =
  | { type: "MORTALITY"; mortalityBps: BasisPoints }
  | { type: "GROWTH_SUPPRESSION"; modifierPpm: number; durationYears: number }
  | { type: "DISPLACEMENT"; sourceSettlementId: string; shareBps: BasisPoints; destination: "AUTHORIZED_ENCLAVE" }
  | { type: "SEIZURE"; confiscationScore: Score1000 }
  | { type: "RESTRICTION"; restrictionKey: string }
  | { type: "IMPRISONMENT"; restrictionKey: string }
  | { type: "DESTRUCTION"; settlementIds: readonly string[]; industryDamage: Score1000 }
  | { type: "CONFLICT"; borderRelationId: string; grievanceDelta: Score1000 }
  | { type: "FACTION_OPINION"; faction: WorldKey; delta: number }
  | { type: "SANCTUARY"; hostSettlementId: string }
  | { type: "ENCLAVE_AUTHORIZATION"; hostSettlementId: string; form: EnclaveFormV5; secrecyState: EnclaveSecrecyStateV5; authorizationRef: string };

export interface AtrocityShockDefinitionV5 {
  schemaVersion: "echoes-atrocity-shock-definition-v1";
  shockDefinitionId: string;
  occurrenceId: AtrocityOccurrenceIdV5;
  triggerYear: number;
  targetScope: DerogatoryTargetingScopeV5;
  authorityStatus: "OWNER_APPROVED" | "TEST_FIXTURE";
  authorityRef: string;
  worldKeys?: readonly WorldKey[];
  effects: readonly AtrocityTypedEffectV5[];
}

function responseForSettlement(state: WorldStateV5, settlementId: string, targetSlices: readonly TargetedPopulationSliceV5[], policy: PersecutionDisplacementEnclavePolicyV1): { responseType: LocalAtrocityResponseTypeV5; intensity: Score1000 } {
  const settlement = state.settlements.find((row) => row.settlementId === settlementId)!;
  const stateRow = state.states.find((row) => row.stateId === settlement.stateId)!;
  const institutionCapacity = Math.min(1000, state.institutions.filter((row) => row.jurisdictionSettlementId === settlementId && row.dissolvedYear === null).reduce((sum, row) => sum + (row.capacity ?? 0), 0));
  const security = Math.min(1000, (state.securityForces ?? []).filter((row) => row.jurisdictionId === settlementId && row.status === "ACTIVE").reduce((sum, row) => sum + row.suppressionCapacity, 0));
  const localPopulation = state.cohorts.filter((row) => row.settlementId === settlementId).reduce((sum, cell) => sum + cell.tiers.HIGH.population + cell.tiers.MID.population + cell.tiers.LOW.population, 0n);
  const targetPopulation = targetSlices.reduce((sum, slice) => sum + slice.population, 0n);
  const presence = localPopulation === 0n ? 0 : Number(targetPopulation * 1000n / localPopulation);
  const targetFactionAffinity = targetPopulation === 0n ? 0 : Number(targetSlices.reduce((sum, slice) => sum + slice.population * BigInt(slice.factionOpinion[stateRow.dominantFaction]), 0n) / targetPopulation);
  const sovereignRelationship = stateRow.dominantFaction === state.worldKey ? 1000 : stateRow.factionAffinity[state.worldKey];
  const localCells = state.cohorts.filter((row) => row.settlementId === settlementId);
  const prosperityNumerator = localCells.reduce((sum, cell) => sum + cell.tiers.HIGH.population * BigInt(cell.tiers.HIGH.prosperity) + cell.tiers.MID.population * BigInt(cell.tiers.MID.prosperity) + cell.tiers.LOW.population * BigInt(cell.tiers.LOW.prosperity), 0n);
  const wealthIncentive = localPopulation === 0n ? 0 : Number(prosperityNumerator / localPopulation);
  const metrics = { faction: targetFactionAffinity, government: stateRow.legitimacy, institutionCapacity, targetPresence: presence, sovereignRelationship, unrest: 1000 - settlement.unrest, security: 1000 - security, wealthIncentive };
  const weighted = Object.entries(policy.responseScoreWeights).reduce((sum, [key, weight]) => sum + metrics[key as keyof typeof metrics] * weight, 0);
  const protection = Math.max(0, Math.min(1000, Number(divideRoundedAway(BigInt(weighted), 10_000n))));
  if (protection >= 650) return { responseType: "SANCTUARY", intensity: protection };
  if (protection >= 450) return { responseType: "PROTEST", intensity: protection };
  if (security >= 800 || settlement.unrest >= 700) return { responseType: "SUPPORT_REPRESSION", intensity: Math.min(1000, Math.max(security, settlement.unrest)) };
  return { responseType: "NEUTRAL_COMPLIANCE", intensity: Math.min(1000, 1000 - protection) };
}

export function executeAtrocityOccurrenceV5(input: { state: WorldStateV5; canonical: CanonicalDataV5; ownerInputs: CausalOwnerInputsV1; mode: "CANONICAL" | "DIAGNOSTIC"; definition: AtrocityShockDefinitionV5 }): { state: WorldStateV5; event: CausalEventV5 } {
  const { definition } = input;
  if (definition.worldKeys && !definition.worldKeys.includes(input.state.worldKey)) throw new Error(`Atrocity ${definition.occurrenceId} does not target world ${input.state.worldKey}`);
  const sourceEventId = `EVT_${input.state.worldKey}_${definition.triggerYear}_${definition.shockDefinitionId}`;
  if (definition.triggerYear !== input.state.year) throw new Error(`Atrocity ${definition.occurrenceId} is configured for ${definition.triggerYear}, not ${input.state.year}`);
  const configuredSlot = input.ownerInputs.atrocityOccurrenceSlots?.find((row) => row.occurrenceId === definition.occurrenceId);
  if (!configuredSlot || configuredSlot.status !== "CONFIGURED" || configuredSlot.triggerYear !== definition.triggerYear || configuredSlot.targetScope !== definition.targetScope || configuredSlot.shockDefinitionId !== definition.shockDefinitionId) throw new Error(`Atrocity slot ${definition.occurrenceId} is NOT_CONFIGURED or does not match its typed ShockDefinition`);
  if (input.mode === "CANONICAL" && definition.authorityStatus !== "OWNER_APPROVED") throw new Error("Canonical atrocity execution rejects test-fixture authority");
  requireHistoricalPolicyV5({ mode: input.mode, policies: input.ownerInputs.historicalDynamismPolicies, approvedHashes: input.ownerInputs.historicalDynamismApprovedPolicyHashes, diagnosticCandidateOptIns: input.ownerInputs.diagnosticHistoricalPolicyOptIns, policyKey: "DEROGATORY_MEMBERSHIP_SLICING", causalOperation: "RESOLVE_ATROCITY_TARGET_SLICES", worldKey: input.state.worldKey, year: input.state.year, entityType: "ATROCITY_OCCURRENCE", entityId: definition.occurrenceId });
  const persecutionPolicy = requireHistoricalPolicyV5({ mode: input.mode, policies: input.ownerInputs.historicalDynamismPolicies, approvedHashes: input.ownerInputs.historicalDynamismApprovedPolicyHashes, diagnosticCandidateOptIns: input.ownerInputs.diagnosticHistoricalPolicyOptIns, policyKey: "PERSECUTION_DISPLACEMENT_ENCLAVE", causalOperation: "RESOLVE_ATROCITY_RESPONSES_AND_DISPLACEMENT", worldKey: input.state.worldKey, year: input.state.year, entityType: "ATROCITY_OCCURRENCE", entityId: definition.occurrenceId });
  const selection = [...(input.state.derogatoryTargetSelections ?? [])].filter((row) => row.scope === definition.targetScope && row.effectiveFromYear <= input.state.year && (row.effectiveUntilYear === null || row.effectiveUntilYear > input.state.year)).sort((a, b) => b.reviewYear - a.reviewYear)[0];
  if (!selection) throw new Error(`Atrocity ${definition.occurrenceId} has no active Derogatory Group selection for ${definition.targetScope}`);
  const targetSlices = (input.state.populationSlices ?? []).filter((slice) => slice.membershipSignature.includes(selection.selectedGroupId));
  const populationBefore = targetSlices.reduce((sum, slice) => sum + slice.population, 0n); const totalsBefore = causalPopulationTotalsV5(input.state);
  let state = input.state; let deaths = 0n; let displaced = 0n; const emittedEffects: Array<Record<string, unknown>> = [];
  const settlements = [...new Set(targetSlices.filter((slice) => slice.locationType === "PUBLIC_SETTLEMENT").map((slice) => slice.locationId))].sort();
  let responses = settlements.map((settlementId) => {
    const localTargetSlices = targetSlices.filter((slice) => slice.locationType === "PUBLIC_SETTLEMENT" && slice.locationId === settlementId);
    const resolved = responseForSettlement(state, settlementId, localTargetSlices, persecutionPolicy); const responseId = `ATROCITY_RESPONSE_${definition.occurrenceId}_${settlementId}`;
    return { responseId, occurrenceId: definition.occurrenceId, settlementId, stateId: state.settlements.find((row) => row.settlementId === settlementId)!.stateId, targetGroupId: selection.selectedGroupId, responseType: resolved.responseType, intensity: resolved.intensity, sourceEventId };
  });
  for (const sanctuary of definition.effects.filter((effect): effect is Extract<AtrocityTypedEffectV5, { type: "SANCTUARY" }> => effect.type === "SANCTUARY")) {
    const settlement = state.settlements.find((row) => row.settlementId === sanctuary.hostSettlementId);
    if (!settlement) throw new Error(`Atrocity sanctuary references unknown Settlement ${sanctuary.hostSettlementId}`);
    const responseId = `ATROCITY_RESPONSE_${definition.occurrenceId}_${sanctuary.hostSettlementId}`;
    const explicit = { responseId, occurrenceId: definition.occurrenceId, settlementId: sanctuary.hostSettlementId, stateId: settlement.stateId, targetGroupId: selection.selectedGroupId, responseType: "SANCTUARY" as const, intensity: 1000, sourceEventId };
    responses = [...responses.filter((row) => row.settlementId !== sanctuary.hostSettlementId), explicit].sort((a, b) => a.settlementId.localeCompare(b.settlementId));
  }
  state = { ...state, localAtrocityResponses: [...(state.localAtrocityResponses ?? []), ...responses] };
  for (const response of responses) {
    const responseState = state.states.find((row) => row.stateId === response.stateId)!;
    const delta = response.responseType === "SANCTUARY" ? 100 : response.responseType === "PROTEST" ? 50 : response.responseType === "SUPPORT_REPRESSION" ? -150 : -25;
    state = adjustTargetedFactionOpinionAtLocationV5(state, selection.selectedGroupId, "PUBLIC_SETTLEMENT", response.settlementId, responseState.dominantFaction, delta, response.responseId);
  }
  const authorization = definition.effects.find((effect): effect is Extract<AtrocityTypedEffectV5, { type: "ENCLAVE_AUTHORIZATION" }> => effect.type === "ENCLAVE_AUTHORIZATION");
  let enclaveId: string | null = null;
  if (authorization) {
    const sanctuary = responses.find((row) => row.settlementId === authorization.hostSettlementId && row.responseType === "SANCTUARY");
    const founded = foundEnclaveV5({ state, canonical: input.canonical, policy: persecutionPolicy, hostSettlementId: authorization.hostSettlementId, targetGroupId: selection.selectedGroupId, form: authorization.form, secrecyState: authorization.secrecyState, sourceEventId, authorization: { targetingSelectionId: selection.selectionId, persecutionOrDisplacementEventId: sourceEventId, sanctuaryResponseId: sanctuary?.responseId ?? "", authorizationRef: authorization.authorizationRef } });
    state = founded.state; enclaveId = founded.enclave.enclaveId; emittedEffects.push({ type: authorization.type, enclaveId, authorizationRef: authorization.authorizationRef });
  }
  for (const effect of definition.effects) {
    if (effect.type === "MORTALITY") { const applied = applyTargetedMortalityV5(state, selection.selectedGroupId, effect.mortalityBps, sourceEventId); state = applied.state; deaths += applied.deaths; emittedEffects.push({ type: effect.type, mortalityBps: effect.mortalityBps, deaths: applied.deaths.toString() }); }
    else if (effect.type === "GROWTH_SUPPRESSION") { state = applyTargetedGrowthSuppressionV5(state, selection.selectedGroupId, effect.modifierPpm, state.year + effect.durationYears, sourceEventId); emittedEffects.push({ ...effect }); }
    else if (effect.type === "SEIZURE") { state = applyTargetedConfiscationV5(state, selection.selectedGroupId, effect.confiscationScore, sourceEventId); emittedEffects.push({ ...effect }); }
    else if (effect.type === "RESTRICTION" || effect.type === "IMPRISONMENT") { state = applyTargetedRestrictionV5(state, selection.selectedGroupId, `${effect.type}:${effect.restrictionKey}`, sourceEventId); emittedEffects.push({ ...effect }); }
    else if (effect.type === "DESTRUCTION") { state = { ...state, industries: (state.industries ?? []).map((row) => effect.settlementIds.includes(row.settlementId) ? { ...row, strength: Math.max(0, row.strength - effect.industryDamage), disruptedUntilYear: Math.max(row.disruptedUntilYear ?? state.year, state.year + 5) } : row) }; emittedEffects.push({ ...effect }); }
    else if (effect.type === "CONFLICT") { state = { ...state, borderRelations: state.borderRelations.map((row) => row.borderRelationId === effect.borderRelationId ? { ...row, grievance: Math.min(1000, row.grievance + effect.grievanceDelta) } : row) }; emittedEffects.push({ ...effect }); }
    else if (effect.type === "FACTION_OPINION") { state = adjustTargetedFactionOpinionV5(state, selection.selectedGroupId, effect.faction, effect.delta, sourceEventId); emittedEffects.push({ ...effect }); }
    else if (effect.type === "SANCTUARY") emittedEffects.push({ ...effect, responseId: responses.find((row) => row.settlementId === effect.hostSettlementId && row.responseType === "SANCTUARY")?.responseId ?? null });
    else if (effect.type === "DISPLACEMENT") { if (!enclaveId) throw new Error("Atrocity displacement to Enclave lacks explicit authorization/founding"); const admitted = admitTargetedPopulationToEnclaveV5({ state, policy: persecutionPolicy, enclaveId, sourceSettlementId: effect.sourceSettlementId, groupId: selection.selectedGroupId, shareBps: effect.shareBps, sourceEventId, cause: "ATROCITY" }); state = admitted.state; displaced += admitted.displacement.population; emittedEffects.push({ ...effect, enclaveId, displaced: admitted.displacement.population.toString() }); }
  }
  validatePopulationPartitionV5(state); const totalsAfter = causalPopulationTotalsV5(state);
  if (totalsBefore.causalTotalPopulation !== totalsAfter.causalTotalPopulation + deaths) throw new Error("Atrocity exact population accounting failed");
  const event: CausalEventV5 = { schemaVersion: "echoes-causal-event-v5", eventId: sourceEventId, worldKey: state.worldKey, year: state.year, phase: "TARGETING_RESPONSE", sequence: 0, eventType: "AtrocityOccurrenceResolved", entityType: "ATROCITY_OCCURRENCE", entityId: definition.occurrenceId, causeEventIds: [selection.selectionId], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload: { shockDefinitionId: definition.shockDefinitionId, authorityRef: definition.authorityRef, targetScope: definition.targetScope, targetGroupId: selection.selectedGroupId, selectionId: selection.selectionId, targetSliceIds: targetSlices.map((row) => row.populationSliceId).sort(), targetPopulationBefore: populationBefore.toString(), deaths: deaths.toString(), displaced: displaced.toString(), localResponseIds: responses.map((row) => row.responseId), typedEffects: emittedEffects, publicPopulationAfter: totalsAfter.publicPopulation.toString(), enclavePopulationAfter: totalsAfter.enclavePopulation.toString(), causalTotalPopulationAfter: totalsAfter.causalTotalPopulation.toString() } };
  return { state, event };
}
