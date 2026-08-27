import { createHash } from "node:crypto";
import { canonicalJson } from "../serialization/canonical-json.js";
import type { CanonicalDataV5, CausalOwnerInputsV1, MechanicsVariablesV1 } from "./config.js";
import { V5_CAUSAL_DERIVATION_VERSION, V5_MECHANICS_VERSION } from "./config.js";
import { applyCausalEffects, type CausalEffect } from "./effects.js";
import { blend, clamp, divideRoundedAway, factionCompatibility, largestRemainder, ratioScore, thresholdChance, weightedMean } from "./fixed-point.js";
import { deriveMetrics, industryMean, settlementPopulation, stateAdjacency, statePopulation } from "./derivations.js";
import { keyedDrawBps, keyedInteger, type KeyedRandomIdentity } from "./random.js";
import type { ActiveConflictV5, BorderRelationV5, CausalEventV5, Score1000, StateV5, WorldStateV5 } from "./types.js";

function digest(value: unknown): string { return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex").slice(0, 20); }
function pair(a: string, b: string): readonly [string, string] { return a.localeCompare(b) <= 0 ? [a, b] : [b, a]; }
function randomIdentity(normalizedSeed: string, randomNamespace: KeyedRandomIdentity["randomNamespace"], comparisonEntityId: string, year: number, candidateOrDecisionKey: string): KeyedRandomIdentity { return { normalizedSeed, randomNamespace, comparisonEntityId, year, candidateOrDecisionKey }; }

export function reconcileBorderRelations(state: WorldStateV5, canonical: CanonicalDataV5): { state: WorldStateV5; events: CausalEventV5[] } {
  const adjacent = new Set(stateAdjacency(state, canonical).map(([a, b]) => pair(a, b).join("\0")));
  const existing = new Map(state.borderRelations.map((relation) => [pair(relation.stateAId, relation.stateBId).join("\0"), { ...relation }]));
  const events: CausalEventV5[] = [];
  for (const key of [...adjacent].sort()) {
    const [stateAId, stateBId] = key.split("\0") as [string, string];
    const relation = existing.get(key);
    if (!relation) {
      const created: BorderRelationV5 = { borderRelationId: `BORDER_${digest(key)}`, stateAId, stateBId, activeBorder: true, tension: 0, exhaustion: 0, grievance: 0, territorialClaim: 0, status: "PEACE", warDeclaredYear: null, warEndedYear: null, cooldownUntilYear: null };
      existing.set(key, created); events.push(borderLifecycleEvent(state, created, "BorderCreated"));
    } else if (!relation.activeBorder) { relation.activeBorder = true; events.push(borderLifecycleEvent(state, relation, "BorderReactivated")); }
  }
  for (const [key, relation] of existing) if (relation.activeBorder && !adjacent.has(key)) { relation.activeBorder = false; events.push(borderLifecycleEvent(state, relation, "BorderDeactivated")); }
  return { state: { ...state, borderRelations: [...existing.values()].sort((a, b) => a.borderRelationId.localeCompare(b.borderRelationId)) }, events };
}

function borderLifecycleEvent(state: WorldStateV5, relation: BorderRelationV5, eventType: string): CausalEventV5 { return { schemaVersion: "echoes-causal-event-v5", eventId: `EVT_${state.worldKey}_${state.year}_${eventType}_${relation.borderRelationId}`, worldKey: state.worldKey, year: state.year, phase: "TRIGGERED", sequence: 0, eventType, entityType: "BORDER_RELATION", entityId: relation.borderRelationId, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: null, mutations: [], payload: { stateAId: relation.stateAId, stateBId: relation.stateBId, activeBorder: relation.activeBorder } }; }

export function borderExposure(state: WorldStateV5, stateId: string): Score1000 { return state.borderRelations.filter((border) => border.activeBorder && (border.stateAId === stateId || border.stateBId === stateId)).reduce((maximum, border) => Math.max(maximum, border.tension), 0); }
export function stateExhaustion(state: WorldStateV5, stateId: string): Score1000 { return state.borderRelations.filter((border) => border.activeBorder && (border.stateAId === stateId || border.stateBId === stateId)).reduce((maximum, border) => Math.max(maximum, border.exhaustion), 0); }
export function stateGrievance(state: WorldStateV5, stateId: string): Score1000 { return state.borderRelations.filter((border) => border.activeBorder && (border.stateAId === stateId || border.stateBId === stateId)).reduce((maximum, border) => Math.max(maximum, border.grievance), 0); }
export function borderStateUnrest(stateUnrestA: Score1000, stateUnrestB: Score1000): Score1000 { return Number(divideRoundedAway(BigInt(stateUnrestA + stateUnrestB), 2n)); }
export function statePopulationScale(population: bigint, variables: MechanicsVariablesV1): Score1000 { return ratioScore(population, variables.conflictStatePopulationReference, 0); }

export function stateIndustryStrength(state: WorldStateV5, stateId: string): Score1000 {
  const settlements = state.settlements.filter((settlement) => settlement.stateId === stateId); const population = statePopulation(state, stateId);
  if (population === 0n) return 0;
  return Number(divideRoundedAway(settlements.reduce((sum, settlement) => sum + settlementPopulation(state, settlement.settlementId) * BigInt(industryMean(settlement)), 0n), population));
}

export function stateCapacity(state: WorldStateV5, politicalState: StateV5, institutionEffectiveness: Score1000, stateUnrest: Score1000, variables: MechanicsVariablesV1): Score1000 {
  return weightedMean([stateIndustryStrength(state, politicalState.stateId), 2500], [institutionEffectiveness, 2500], [politicalState.legitimacy, 2000], [1000 - stateUnrest, 1500], [statePopulationScale(statePopulation(state, politicalState.stateId), variables), 1500]);
}

export function borderEconomicPressure(state: WorldStateV5, relation: BorderRelationV5, metrics: ReturnType<typeof deriveMetrics>): Score1000 {
  const settlementsA = state.settlements.filter((settlement) => settlement.stateId === relation.stateAId); const settlementsB = state.settlements.filter((settlement) => settlement.stateId === relation.stateBId);
  const populationA = statePopulation(state, relation.stateAId); const populationB = statePopulation(state, relation.stateBId);
  const strain = (settlements: typeof settlementsA, population: bigint) => population === 0n ? 0 : Number(divideRoundedAway(settlements.reduce((sum, settlement) => sum + settlementPopulation(state, settlement.settlementId) * BigInt(1000 - metrics.settlementProsperity[settlement.settlementId]!), 0n), population));
  const opportunity = (settlements: typeof settlementsA, population: bigint) => population === 0n ? 0 : Number(divideRoundedAway(settlements.reduce((sum, settlement) => sum + settlementPopulation(state, settlement.settlementId) * BigInt(metrics.localOpportunity[settlement.settlementId]!), 0n), population));
  return weightedMean([Number(divideRoundedAway(BigInt(strain(settlementsA, populationA) + strain(settlementsB, populationB)), 2n)), 5000], [Math.abs(opportunity(settlementsA, populationA) - opportunity(settlementsB, populationB)), 5000]);
}

export function conflictPressure(state: WorldStateV5, relation: BorderRelationV5, canonical: CanonicalDataV5, variables: MechanicsVariablesV1, suppliedMetrics?: ReturnType<typeof deriveMetrics>): Score1000 {
  const metrics = suppliedMetrics ?? deriveMetrics(state, canonical, variables); const stateA = state.states.find((row) => row.stateId === relation.stateAId)!; const stateB = state.states.find((row) => row.stateId === relation.stateBId)!;
  return weightedMean([1000 - factionCompatibility(stateA.factionAffinity, stateB.factionAffinity), 3000], [relation.territorialClaim, 2500], [borderEconomicPressure(state, relation, metrics), 2000], [borderStateUnrest(metrics.stateUnrest[stateA.stateId]!, metrics.stateUnrest[stateB.stateId]!), 1500], [relation.grievance, 1000]);
}

export interface BorderDecisionResult { state: WorldStateV5; events: CausalEventV5[]; }
export function reviewBordersLate(state: WorldStateV5, canonical: CanonicalDataV5, owner: CausalOwnerInputsV1, variables: MechanicsVariablesV1, normalizedSeed: string): BorderDecisionResult {
  const phaseStartMetrics = deriveMetrics(state, canonical, variables);
  const events: CausalEventV5[] = []; let borders = state.borderRelations.map((border) => ({ ...border })); let conflicts = [...state.activeConflicts]; let working = state;
  for (const border of borders.filter((row) => row.activeBorder).sort((a, b) => a.borderRelationId.localeCompare(b.borderRelationId))) {
    const pressure = conflictPressure(state, border, canonical, variables, phaseStartMetrics);
    border.tension = blend(border.tension, pressure, variables.borderTensionInertiaBps);
    if (border.status === "WAR") {
      const peacePressure = weightedMean([border.exhaustion, 7000], [1000 - border.tension, 3000]); const chance = thresholdChance(peacePressure, variables.borderPeaceThreshold, variables.borderPeaceMaximumChanceBps); const random = randomIdentity(normalizedSeed, "BORDER_PEACE", border.borderRelationId, state.year, "peace"); const draw = keyedDrawBps(random);
      if (draw < chance) { border.status = "PEACE"; border.warEndedYear = state.year; border.cooldownUntilYear = state.year + (owner.peaceExhaustionPolicy?.postWarCooldownYears ?? 0); conflicts = conflicts.map((conflict) => conflict.borderRelationId === border.borderRelationId && conflict.endedYear === null ? { ...conflict, endedYear: state.year } : conflict); events.push(decisionEvent(state, border, "PeaceDeclared", random, { peacePressure, chanceBps: chance, drawBps: draw })); }
      continue;
    }
    if (border.cooldownUntilYear !== null && state.year < border.cooldownUntilYear) continue;
    if (border.tension >= variables.borderWarThreshold) {
      const chance = thresholdChance(border.tension, variables.borderWarThreshold, variables.borderWarMaximumChanceBps); const random = randomIdentity(normalizedSeed, "BORDER_WAR_DECLARATION", border.borderRelationId, state.year, "war"); const draw = keyedDrawBps(random);
      if (draw < chance) { border.status = "WAR"; border.warDeclaredYear = state.year; const attacker = border.stateAId; const conflict: ActiveConflictV5 = { conflictId: `CONFLICT_${digest([border.borderRelationId, state.year])}`, borderRelationId: border.borderRelationId, attackerStateId: attacker, defenderStateId: border.stateBId, declaredYear: state.year, activeFromYear: state.year + 1, endedYear: null }; conflicts.push(conflict); events.push(decisionEvent(state, border, "WarDeclared", random, { chanceBps: chance, drawBps: draw, activeFromYear: state.year + 1, conflictId: conflict.conflictId })); continue; }
    }
    if (border.tension >= variables.borderSkirmishThreshold) {
      const chance = thresholdChance(border.tension, variables.borderSkirmishThreshold, variables.borderSkirmishMaximumChanceBps); const random = randomIdentity(normalizedSeed, "BORDER_SKIRMISH_DECLARATION", border.borderRelationId, state.year, "skirmish"); const draw = keyedDrawBps(random);
      if (draw < chance) {
        const profile = owner.skirmishProfile; if (!profile) throw new Error("Approved SkirmishProfileV1 required");
        const outcomeIdentity = randomIdentity(normalizedSeed, "BORDER_SKIRMISH_OUTCOME", border.borderRelationId, state.year, "affected-state");
        const outcomeDraw = keyedDrawBps(outcomeIdentity);
        const affectedStateId = outcomeDraw < 5000 ? border.stateAId : border.stateBId;
        const affectedSettlement = state.settlements.filter((settlement) => settlement.stateId === affectedStateId).sort((a, b) => b.unrest - a.unrest || a.settlementId.localeCompare(b.settlementId))[0];
        const effectEventId = `EVT_${state.worldKey}_${state.year}_BorderSkirmish_${border.borderRelationId}`;
        const effects: CausalEffect[] = [];
        if (affectedSettlement) {
          const affectedPopulation = settlementPopulation(state, affectedSettlement.settlementId);
          const deaths = affectedPopulation * BigInt(profile.mortalityBps) / 10_000n;
          if (deaths > 0n) effects.push({ type: "POPULATION_LOSS", effectId: `${effectEventId}_DEATHS`, sourceEventId: effectEventId, targets: [{ settlementId: affectedSettlement.settlementId }], deaths });
          if (profile.prosperityDamage > 0) effects.push({ type: "PROSPERITY", effectId: `${effectEventId}_PROSPERITY`, sourceEventId: effectEventId, targets: [{ settlementId: affectedSettlement.settlementId }], delta: -profile.prosperityDamage });
        }
        border.tension = clamp(border.tension + profile.tensionDelta, 0, 1000); border.grievance = clamp(border.grievance + profile.grievanceDelta, 0, 1000); border.exhaustion = clamp(border.exhaustion + profile.exhaustionDelta, 0, 1000); border.status = "SKIRMISH_COOLDOWN"; border.cooldownUntilYear = state.year + variables.borderSkirmishCooldownYears;
        working = { ...working, borderRelations: borders, activeConflicts: conflicts };
        const applied = applyCausalEffects(working, effects); working = applied.state;
        const event = decisionEvent(state, border, "BorderSkirmish", random, { chanceBps: chance, drawBps: draw, outcomeDrawBps: outcomeDraw, affectedStateId, affectedSettlementId: affectedSettlement?.settlementId ?? null, effectIds: effects.map((effect) => effect.effectId), accounting: applied.accounting.map((row) => ({ ...row, populationBefore: row.populationBefore.toString(), populationAfter: row.populationAfter.toString(), deaths: row.deaths.toString(), transferred: row.transferred.toString() })) });
        event.keyedDecisionIdentity = canonicalJson({ declaration: random, outcome: outcomeIdentity });
        events.push(event);
      }
    }
  }
  return { state: { ...working, borderRelations: borders, activeConflicts: conflicts }, events };
}

function decisionEvent(state: WorldStateV5, border: BorderRelationV5, eventType: string, random: KeyedRandomIdentity, payload: Record<string, unknown>): CausalEventV5 { return { schemaVersion: "echoes-causal-event-v5", eventId: `EVT_${state.worldKey}_${state.year}_${eventType}_${border.borderRelationId}`, worldKey: state.worldKey, year: state.year, phase: "LATE_BORDER", sequence: 0, eventType, entityType: "BORDER_RELATION", entityId: border.borderRelationId, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: canonicalJson(random), mutations: [], payload }; }

export function applyPeacefulExhaustionRecovery(state: WorldStateV5, owner: CausalOwnerInputsV1): WorldStateV5 {
  const recovery = owner.peaceExhaustionPolicy?.peacefulExhaustionRecovery;
  if (recovery === undefined) throw new Error("Approved peace/exhaustion policy required");
  return { ...state, borderRelations: state.borderRelations.map((border) => border.status === "WAR" ? border : { ...border, exhaustion: clamp(border.exhaustion - recovery, 0, 1000), status: border.status === "SKIRMISH_COOLDOWN" && (border.cooldownUntilYear ?? 0) <= state.year ? "PEACE" : border.status }) };
}

export interface WarEpisodeResult { state: WorldStateV5; events: CausalEventV5[]; effects: CausalEffect[]; }
export function applyActiveWarEpisodes(state: WorldStateV5, canonical: CanonicalDataV5, owner: CausalOwnerInputsV1, variables: MechanicsVariablesV1, normalizedSeed: string, institutionEffectivenessByState: Readonly<Record<string, Score1000>>): WarEpisodeResult {
  const activeAtYearStart = state.activeConflicts.filter((conflict) => conflict.endedYear === null && conflict.activeFromYear <= state.year && conflict.declaredYear < state.year).sort((a, b) => a.conflictId.localeCompare(b.conflictId));
  if (activeAtYearStart.length === 0) return { state, events: [], effects: [] };
  const profile = owner.conflictEpisodeProfile; if (!profile) throw new Error("Approved ConflictEpisodeProfileV1 required");
  let working = state; const events: CausalEventV5[] = []; const allEffects: CausalEffect[] = [];
  const phaseStartMetrics = deriveMetrics(state, canonical, variables);
  for (const conflict of activeAtYearStart) {
    const border = state.borderRelations.find((row) => row.borderRelationId === conflict.borderRelationId)!; const attacker = state.states.find((row) => row.stateId === conflict.attackerStateId)!; const defender = state.states.find((row) => row.stateId === conflict.defenderStateId)!;
    const attackerCapacity = stateCapacity(state, attacker, institutionEffectivenessByState[attacker.stateId] ?? 500, phaseStartMetrics.stateUnrest[attacker.stateId]!, variables); const defenderCapacity = stateCapacity(state, defender, institutionEffectivenessByState[defender.stateId] ?? 500, phaseStartMetrics.stateUnrest[defender.stateId]!, variables);
    const intensityIdentity = randomIdentity(normalizedSeed, "WAR_EPISODE_INTENSITY", conflict.conflictId, state.year, "intensity"); const outcomeIdentity = randomIdentity(normalizedSeed, "WAR_EPISODE_OUTCOME", conflict.conflictId, state.year, "balance"); const intensityDraw = Number(divideRoundedAway(BigInt(keyedDrawBps(intensityIdentity)), 10n)); const age = clamp((state.year - conflict.declaredYear) * 100, 0, 1000); const intensity = weightedMean([border.tension, 4000], [border.exhaustion, 2000], [age, 2000], [intensityDraw, 2000]); const swing = keyedInteger(outcomeIdentity, -200, 200); const balance = clamp(attackerCapacity - defenderCapacity + swing, -1000, 1000);
    const affectedStateId = balance >= 0 ? defender.stateId : attacker.stateId; const affectedSettlements = state.settlements.filter((settlement) => settlement.stateId === affectedStateId).sort((a, b) => b.unrest - a.unrest || a.settlementId.localeCompare(b.settlementId)); const targetIds = affectedSettlements.map((row) => row.settlementId); const affectedPopulation = statePopulation(state, affectedStateId); const deaths = affectedPopulation * BigInt(profile.maximumMortalityBps) * BigInt(intensity) / 10_000n / 1000n; const displacement = affectedPopulation * BigInt(profile.maximumDisplacementBps) * BigInt(intensity) / 10_000n / 1000n;
    const episodeId = `EVT_${state.worldKey}_${state.year}_WAR_EPISODE_${conflict.conflictId}`; const effects: CausalEffect[] = [];
    if (deaths > 0n) effects.push({ type: "POPULATION_LOSS", effectId: `${episodeId}_DEATHS`, sourceEventId: episodeId, targets: targetIds.map((settlementId) => ({ settlementId })), deaths });
    const origin = affectedSettlements[0]; const safe = working.settlements.filter((settlement) => settlement.stateId === affectedStateId && settlement.settlementId !== origin?.settlementId).sort((a, b) => a.unrest - b.unrest || a.settlementId.localeCompare(b.settlementId))[0];
    if (origin && safe && displacement > 0n) {
      const sourceCells = working.cohorts.filter((cell) => cell.settlementId === origin.settlementId); const sourcePopulation = sourceCells.reduce((sum, cell) => sum + cell.tiers.HIGH.population + cell.tiers.MID.population + cell.tiers.LOW.population, 0n); const bounded = displacement < sourcePopulation ? displacement : sourcePopulation; const rows = sourceCells.flatMap((cell) => (["HIGH", "MID", "LOW"] as const).map((tier) => ({ cell, tier, population: cell.tiers[tier].population }))); const allocations = largestRemainder(bounded, rows.map((row) => row.population), rows.map((row) => `${row.cell.breedId}/${row.tier}`));
      const transfers = rows.map((row, index) => ({ transferId: `${episodeId}_DISPLACEMENT_${index}`, breedId: row.cell.breedId, tier: row.tier, originSettlementId: origin.settlementId, destinationSettlementId: safe.settlementId, population: allocations[index]!, prosperity: row.cell.tiers[row.tier].prosperity, cause: "FORCED" as const })).filter((row) => row.population > 0n);
      effects.push({ type: "FORCED_MIGRATION", effectId: `${episodeId}_DISPLACEMENT`, sourceEventId: episodeId, transfers });
    }
    const scale = (maximum: number) => Number(divideRoundedAway(BigInt(maximum) * BigInt(intensity), 1000n));
    if (targetIds.length) { effects.push({ type: "PROSPERITY", effectId: `${episodeId}_PROSPERITY`, sourceEventId: episodeId, targets: targetIds.map((settlementId) => ({ settlementId })), delta: -scale(profile.maximumProsperityDamage) }); effects.push({ type: "INDUSTRY_DAMAGE", effectId: `${episodeId}_INDUSTRY`, sourceEventId: episodeId, settlementIds: targetIds, sectors: ["EXTRACTION", "MANUFACTURE", "TRADE_AND_TRANSPORT"], damage: scale(profile.maximumIndustryDamage) }); effects.push({ type: "UNREST", effectId: `${episodeId}_UNREST`, sourceEventId: episodeId, settlementIds: targetIds, delta: scale(profile.maximumUnrestDelta) }); }
    effects.push({ type: "LEGITIMACY", effectId: `${episodeId}_LEGITIMACY`, sourceEventId: episodeId, stateIds: [affectedStateId], delta: -scale(profile.maximumLegitimacyDelta) }, { type: "GRIEVANCE", effectId: `${episodeId}_GRIEVANCE`, sourceEventId: episodeId, borderRelationId: border.borderRelationId, delta: scale(profile.maximumGrievanceDelta) }, { type: "BORDER_EXHAUSTION", effectId: `${episodeId}_EXHAUSTION`, sourceEventId: episodeId, borderRelationId: border.borderRelationId, delta: scale(profile.maximumExhaustionDelta) });
    const applied = applyCausalEffects(working, effects); working = applied.state; allEffects.push(...effects);
    events.push({ schemaVersion: "echoes-causal-event-v5", eventId: episodeId, worldKey: state.worldKey, year: state.year, phase: "ACTIVE_WAR", sequence: events.length, eventType: "WarEpisode", entityType: "CONFLICT", entityId: conflict.conflictId, causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, keyedDecisionIdentity: canonicalJson({ intensityIdentity, outcomeIdentity }), mutations: [], payload: { attackerCapacity, defenderCapacity, intensity, balance, deaths: deaths.toString(), displacement: displacement.toString(), effectIds: effects.map((effect) => effect.effectId) } });
  }
  return { state: working, events, effects: allEffects };
}
