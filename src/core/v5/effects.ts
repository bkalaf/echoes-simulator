import { clamp, largestRemainder, normalizeFactionVector } from "./fixed-point.js";
import { applyMigrationTransfers, type MigrationTransferV5 } from "./migration.js";
import { cellPopulation } from "./derivations.js";
import type { ControllerType, FamilyStatus, InstitutionV5, OfficeV5, Score1000, SectorId, SocialTier, WorldStateV5 } from "./types.js";

interface EffectBase { effectId: string; sourceEventId: string; }
export interface PopulationLossEffect extends EffectBase { type: "POPULATION_LOSS"; targets: readonly { settlementId: string; breedId?: string; tier?: SocialTier }[]; deaths: bigint; }
export interface PoliticalPersonDeathEffect extends EffectBase { type: "POLITICAL_PERSON_DEATH"; personIds: readonly string[]; }
export interface ForcedMigrationEffect extends EffectBase { type: "FORCED_MIGRATION"; transfers: readonly MigrationTransferV5[]; }
export interface TierTransferEffect extends EffectBase { type: "TIER_TRANSFER"; settlementId: string; breedId: string; fromTier: SocialTier; toTier: SocialTier; population: bigint; }
export interface ProsperityEffect extends EffectBase { type: "PROSPERITY"; targets: readonly { settlementId: string; breedId?: string; tier?: SocialTier }[]; delta: number; }
export interface IndustryDamageEffect extends EffectBase { type: "INDUSTRY_DAMAGE"; settlementIds: readonly string[]; sectors: readonly SectorId[]; damage: Score1000; }
export interface FamilyPowerEffect extends EffectBase { type: "FAMILY_POWER"; familyIds: readonly string[]; wealthDelta?: number; influenceDelta?: number; prestigeDelta?: number; }
export interface FamilyStatusEffect extends EffectBase { type: "FAMILY_STATUS"; familyId: string; status: FamilyStatus; }
export interface OrganizationOwnershipEffect extends EffectBase {
  type: "ORGANIZATION_OWNERSHIP";
  organizationId: string;
  closeStakeIds: readonly string[];
  replacementStakes: readonly {
    controllerType: ControllerType;
    controllerId: string;
    ownershipShareBps: number;
    controlShareBps: number;
  }[];
}
export interface UnrestEffect extends EffectBase { type: "UNREST"; settlementIds: readonly string[]; delta: number; }
export interface LegitimacyEffect extends EffectBase { type: "LEGITIMACY"; stateIds: readonly string[]; delta: number; }
export interface FactionAffinityEffect extends EffectBase { type: "FACTION_AFFINITY"; stateIds: readonly string[]; delta: Partial<Record<"CONCORD" | "SCHISM" | "RUIN", number>>; }
export interface OfficeRemovalEffect extends EffectBase { type: "OFFICE_REMOVAL"; officeTermIds: readonly string[]; reason: "REMOVAL" | "GOVERNMENT_CHANGE"; }
export interface GovernmentTransitionEffect extends EffectBase {
  type: "GOVERNMENT_TRANSITION";
  stateId: string;
  governmentFormId: string;
  bypassReason: "COUP" | "REBELLION" | "CANONICAL" | "CRISIS";
  cooldownUntilYear: number;
  retireInstitutionIds: readonly string[];
  newInstitutions: readonly InstitutionV5[];
  newOffices: readonly OfficeV5[];
}
export interface GrievanceEffect extends EffectBase { type: "GRIEVANCE"; borderRelationId: string; delta: number; }
export interface BorderTensionEffect extends EffectBase { type: "BORDER_TENSION"; borderRelationId: string; delta: number; }
export interface BorderExhaustionEffect extends EffectBase { type: "BORDER_EXHAUSTION"; borderRelationId: string; delta: number; }
export interface BorderClaimEffect extends EffectBase { type: "BORDER_CLAIM"; borderRelationId: string; delta: number; }
export interface StateMembershipEffect extends EffectBase { type: "STATE_MEMBERSHIP"; settlementIds: readonly string[]; stateId: string; }

export type CausalEffect = PopulationLossEffect | PoliticalPersonDeathEffect | ForcedMigrationEffect | TierTransferEffect | ProsperityEffect | IndustryDamageEffect | FamilyPowerEffect | FamilyStatusEffect | OrganizationOwnershipEffect | UnrestEffect | LegitimacyEffect | FactionAffinityEffect | OfficeRemovalEffect | GovernmentTransitionEffect | GrievanceEffect | BorderTensionEffect | BorderExhaustionEffect | BorderClaimEffect | StateMembershipEffect;

export interface EffectAccounting {
  effectId: string;
  type: CausalEffect["type"];
  populationBefore: bigint;
  populationAfter: bigint;
  deaths: bigint;
  transferred: bigint;
}

function totalPopulation(state: WorldStateV5): bigint { return state.cohorts.reduce((sum, cell) => sum + cellPopulation(cell), 0n); }

function applyPopulationLoss(state: WorldStateV5, effect: PopulationLossEffect): WorldStateV5 {
  const matching = state.cohorts.flatMap((cell, cellIndex) => (["HIGH", "MID", "LOW"] as const).map((tier) => ({ cell, cellIndex, tier, population: cell.tiers[tier].population })).filter((row) => effect.targets.some((target) => target.settlementId === row.cell.settlementId && (!target.breedId || target.breedId === row.cell.breedId) && (!target.tier || target.tier === row.tier))));
  const available = matching.reduce((sum, row) => sum + row.population, 0n);
  if (effect.deaths < 0n || effect.deaths > available) throw new Error(`PopulationLossEffect ${effect.effectId} exceeds resolved population`);
  const losses = largestRemainder(effect.deaths, matching.map((row) => row.population), matching.map((row) => `${row.cell.settlementId}/${row.cell.breedId}/${row.tier}`));
  const cohorts = state.cohorts.map((cell) => structuredClone(cell));
  matching.forEach((row, index) => { cohorts[row.cellIndex]!.tiers[row.tier].population -= losses[index]!; });
  return { ...state, cohorts: cohorts.filter((cell) => cellPopulation(cell) > 0n) };
}

function validateFamilyExtinction(state: WorldStateV5, familyId: string): void {
  const living = state.politicalPeople.some((person) => person.familyId === familyId && (person.actualDeathYear ?? person.naturalDeathYear) > state.year);
  const offices = state.officeTerms.some((term) => term.endYear === null && state.politicalPeople.find((person) => person.personId === term.personId)?.familyId === familyId);
  const ownership = state.ownershipStakes.some((stake) => stake.endYear === null && stake.controllerType === "FAMILY" && stake.controllerId === familyId && (stake.ownershipShareBps > 0 || stake.controlShareBps > 0));
  const relations = state.familyRelations.some((relation) => relation.endYear === null && (relation.familyAId === familyId || relation.familyBId === familyId));
  if (living || offices || ownership || relations) throw new Error(`Family ${familyId} cannot become extinct while durable roles remain`);
}

function validateStakeTotals(state: WorldStateV5, organizationId: string): void {
  const stakes = state.ownershipStakes.filter((stake) => stake.organizationId === organizationId && stake.endYear === null);
  const ownership = stakes.reduce((sum, stake) => sum + stake.ownershipShareBps, 0);
  const control = stakes.reduce((sum, stake) => sum + stake.controlShareBps, 0);
  if (ownership !== 10_000 || control !== 10_000) throw new Error(`Ownership totals for ${organizationId} are ${ownership}/${control}`);
}

export function applyCausalEffects(initial: WorldStateV5, effects: readonly CausalEffect[]): { state: WorldStateV5; accounting: EffectAccounting[]; successionOfficeIds: string[] } {
  let state = structuredClone(initial);
  const accounting: EffectAccounting[] = [];
  const successionOfficeIds = new Set<string>();
  for (const effect of effects) {
    const before = totalPopulation(state);
    let deaths = 0n; let transferred = 0n;
    switch (effect.type) {
      case "POPULATION_LOSS": state = applyPopulationLoss(state, effect); deaths = effect.deaths; break;
      case "POLITICAL_PERSON_DEATH": {
        const ids = new Set(effect.personIds);
        if (effect.personIds.some((personId) => !state.politicalPeople.some((person) => person.personId === personId))) throw new Error(`PoliticalPersonDeathEffect ${effect.effectId} targets an unknown person`);
        state.politicalPeople = state.politicalPeople.map((person) => ids.has(person.personId) ? { ...person, actualDeathYear: Math.min(person.actualDeathYear ?? person.naturalDeathYear, state.year) } : person);
        state.officeTerms = state.officeTerms.map((term) => {
          if (term.endYear !== null || !ids.has(term.personId)) return term;
          successionOfficeIds.add(term.officeId); return { ...term, endYear: state.year, terminationReason: "DEATH" };
        });
        break;
      }
      case "FORCED_MIGRATION": state = applyMigrationTransfers(state, effect.transfers); transferred = effect.transfers.reduce((sum, transfer) => sum + transfer.population, 0n); break;
      case "TIER_TRANSFER": {
        if (effect.fromTier === effect.toTier) break;
        const cell = state.cohorts.find((row) => row.settlementId === effect.settlementId && row.breedId === effect.breedId);
        if (!cell || cell.tiers[effect.fromTier].population < effect.population || effect.population < 0n) throw new Error(`Invalid TierTransferEffect ${effect.effectId}`);
        cell.tiers[effect.fromTier].population -= effect.population; cell.tiers[effect.toTier].population += effect.population; transferred = effect.population;
        break;
      }
      case "PROSPERITY": state.cohorts = state.cohorts.map((cell) => ({ ...cell, tiers: Object.fromEntries((Object.keys(cell.tiers) as SocialTier[]).map((tier) => [tier, { ...cell.tiers[tier], prosperity: effect.targets.some((target) => target.settlementId === cell.settlementId && (!target.breedId || target.breedId === cell.breedId) && (!target.tier || target.tier === tier)) ? clamp(cell.tiers[tier].prosperity + effect.delta, 0, 1000) : cell.tiers[tier].prosperity }])) as typeof cell.tiers })); break;
      case "INDUSTRY_DAMAGE": state.settlements = state.settlements.map((settlement) => effect.settlementIds.includes(settlement.settlementId) ? { ...settlement, sectorStrengths: Object.fromEntries(Object.entries(settlement.sectorStrengths).map(([sector, strength]) => [sector, effect.sectors.includes(sector as SectorId) ? clamp(strength - effect.damage, 0, 1000) : strength])) as typeof settlement.sectorStrengths } : settlement); break;
      case "FAMILY_POWER": state.families = state.families.map((family) => effect.familyIds.includes(family.familyId) ? { ...family, wealth: clamp(family.wealth + (effect.wealthDelta ?? 0), 0, 1000), influence: clamp(family.influence + (effect.influenceDelta ?? 0), 0, 1000), prestige: clamp(family.prestige + (effect.prestigeDelta ?? 0), 0, 1000) } : family); break;
      case "FAMILY_STATUS": {
        const family = state.families.find((row) => row.familyId === effect.familyId);
        if (!family) throw new Error(`Unknown Family ${effect.familyId}`);
        if (family.status === "EXTINCT" && effect.status !== "EXTINCT") throw new Error(`Family ${effect.familyId} cannot be revived in V5`);
        if (effect.status === "EXTINCT") validateFamilyExtinction(state, effect.familyId);
        state.families = state.families.map((row) => row.familyId === effect.familyId ? { ...row, status: effect.status, extinctionYear: effect.status === "EXTINCT" ? state.year : row.extinctionYear } : row);
        break;
      }
      case "ORGANIZATION_OWNERSHIP": {
        if (!state.organizations.some((organization) => organization.organizationId === effect.organizationId)) throw new Error(`Unknown Organization ${effect.organizationId}`);
        const closeIds = new Set(effect.closeStakeIds);
        if (effect.closeStakeIds.some((stakeId) => !state.ownershipStakes.some((stake) => stake.stakeId === stakeId && stake.organizationId === effect.organizationId && stake.endYear === null))) throw new Error(`OrganizationOwnershipEffect ${effect.effectId} closes an unknown or inactive stake`);
        state.ownershipStakes = state.ownershipStakes.map((stake) => closeIds.has(stake.stakeId) ? { ...stake, endYear: state.year } : stake);
        state.ownershipStakes.push(...effect.replacementStakes.map((stake, index) => ({ ...stake, stakeId: `STAKE_${effect.effectId}_${index}`, organizationId: effect.organizationId, startYear: state.year, endYear: null, sourceEventId: effect.sourceEventId })));
        validateStakeTotals(state, effect.organizationId); break;
      }
      case "UNREST": state.settlements = state.settlements.map((settlement) => effect.settlementIds.includes(settlement.settlementId) ? { ...settlement, unrest: clamp(settlement.unrest + effect.delta, 0, 1000) } : settlement); break;
      case "LEGITIMACY": state.states = state.states.map((row) => effect.stateIds.includes(row.stateId) ? { ...row, legitimacy: clamp(row.legitimacy + effect.delta, 0, 1000) } : row); break;
      case "FACTION_AFFINITY": {
        if (effect.stateIds.some((stateId) => !state.states.some((row) => row.stateId === stateId))) throw new Error(`FactionAffinityEffect ${effect.effectId} targets an unknown State`);
        state.states = state.states.map((row) => effect.stateIds.includes(row.stateId) ? { ...row, factionAffinity: normalizeFactionVector({ CONCORD: clamp(row.factionAffinity.CONCORD + (effect.delta.CONCORD ?? 0), 0, 1000), SCHISM: clamp(row.factionAffinity.SCHISM + (effect.delta.SCHISM ?? 0), 0, 1000), RUIN: clamp(row.factionAffinity.RUIN + (effect.delta.RUIN ?? 0), 0, 1000) }) } : row); break;
      }
      case "OFFICE_REMOVAL": {
        const ids = new Set(effect.officeTermIds); state.officeTerms = state.officeTerms.map((term) => { if (!ids.has(term.officeTermId) || term.endYear !== null) return term; successionOfficeIds.add(term.officeId); return { ...term, endYear: state.year, terminationReason: effect.reason }; }); break;
      }
      case "GOVERNMENT_TRANSITION": {
        const retiringInstitutionIds = new Set(effect.retireInstitutionIds);
        const retiringOfficeIds = new Set(state.offices.filter((office) => retiringInstitutionIds.has(office.institutionId)).map((office) => office.officeId));
        if (effect.newInstitutions.some((institution) => institution.stateId !== effect.stateId)) throw new Error(`GovernmentTransitionEffect ${effect.effectId} contains a foreign Institution`);
        if (effect.newOffices.some((office) => !effect.newInstitutions.some((institution) => institution.institutionId === office.institutionId))) throw new Error(`GovernmentTransitionEffect ${effect.effectId} contains an Office without its Institution`);
        state.institutions = [
          ...state.institutions.map((institution) => retiringInstitutionIds.has(institution.institutionId) && institution.dissolvedYear === null ? { ...institution, dissolvedYear: state.year } : institution),
          ...effect.newInstitutions,
        ];
        state.offices = [...state.offices, ...effect.newOffices];
        state.officeTerms = state.officeTerms.map((term) => {
          if (term.endYear !== null || !retiringOfficeIds.has(term.officeId)) return term;
          return { ...term, endYear: state.year, terminationReason: "GOVERNMENT_CHANGE" };
        });
        state.states = state.states.map((row) => row.stateId === effect.stateId ? { ...row, actualGovernment: effect.governmentFormId, qualifyingGovernmentReviewCount: 0, lastGovernmentTransitionYear: state.year, routineTransitionCooldownUntilYear: effect.cooldownUntilYear } : row);
        break;
      }
      case "GRIEVANCE": if (!state.borderRelations.some((row) => row.borderRelationId === effect.borderRelationId)) throw new Error(`GrievanceEffect ${effect.effectId} targets an unknown border`); state.borderRelations = state.borderRelations.map((row) => row.borderRelationId === effect.borderRelationId ? { ...row, grievance: clamp(row.grievance + effect.delta, 0, 1000) } : row); break;
      case "BORDER_TENSION": if (!state.borderRelations.some((row) => row.borderRelationId === effect.borderRelationId)) throw new Error(`BorderTensionEffect ${effect.effectId} targets an unknown border`); state.borderRelations = state.borderRelations.map((row) => row.borderRelationId === effect.borderRelationId ? { ...row, tension: clamp(row.tension + effect.delta, 0, 1000) } : row); break;
      case "BORDER_EXHAUSTION": if (!state.borderRelations.some((row) => row.borderRelationId === effect.borderRelationId)) throw new Error(`BorderExhaustionEffect ${effect.effectId} targets an unknown border`); state.borderRelations = state.borderRelations.map((row) => row.borderRelationId === effect.borderRelationId ? { ...row, exhaustion: clamp(row.exhaustion + effect.delta, 0, 1000) } : row); break;
      case "BORDER_CLAIM": if (!state.borderRelations.some((row) => row.borderRelationId === effect.borderRelationId)) throw new Error(`BorderClaimEffect ${effect.effectId} targets an unknown border`); state.borderRelations = state.borderRelations.map((row) => row.borderRelationId === effect.borderRelationId ? { ...row, territorialClaim: clamp(row.territorialClaim + effect.delta, 0, 1000) } : row); break;
      case "STATE_MEMBERSHIP": {
        if (!state.states.some((candidate) => candidate.stateId === effect.stateId)) throw new Error(`StateMembershipEffect ${effect.effectId} targets unknown State ${effect.stateId}`);
        if (effect.settlementIds.some((settlementId) => !state.settlements.some((settlement) => settlement.settlementId === settlementId))) throw new Error(`StateMembershipEffect ${effect.effectId} targets unknown Settlement`);
        state.settlements = state.settlements.map((row) => effect.settlementIds.includes(row.settlementId) ? { ...row, stateId: effect.stateId } : row); break;
      }
    }
    const after = totalPopulation(state);
    if (effect.type === "POPULATION_LOSS" && before !== after + deaths) throw new Error(`Mortality accounting failed for ${effect.effectId}`);
    if (effect.type !== "POPULATION_LOSS" && before !== after) throw new Error(`Nonlethal effect ${effect.effectId} changed aggregate population`);
    accounting.push({ effectId: effect.effectId, type: effect.type, populationBefore: before, populationAfter: after, deaths, transferred });
  }
  return { state, accounting, successionOfficeIds: [...successionOfficeIds].sort() };
}

export interface ShockDefinitionV5 { shockId: string; year: number; entityScopeSelectors: readonly ShockSelectorV5[]; effects: readonly CausalEffect[]; canonicalCauseMetadata: Record<string, unknown>; }
export type ShockSelectorV5 = { type: "STATE"; stateId: string } | { type: "SETTLEMENT"; settlementId: string } | { type: "RULING_FAMILIES"; stateId: string } | { type: "ORGANIZATION"; organizationId: string } | { type: "POLITICAL_PERSON"; personId: string };

export function resolveShockSelectors(state: WorldStateV5, selectors: readonly ShockSelectorV5[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const selector of selectors) {
    if (selector.type === "STATE") result.STATE = [...(result.STATE ?? []), selector.stateId];
    else if (selector.type === "SETTLEMENT") result.SETTLEMENT = [...(result.SETTLEMENT ?? []), selector.settlementId];
    else if (selector.type === "ORGANIZATION") result.ORGANIZATION = [...(result.ORGANIZATION ?? []), selector.organizationId];
    else if (selector.type === "POLITICAL_PERSON") result.POLITICAL_PERSON = [...(result.POLITICAL_PERSON ?? []), selector.personId];
    else {
      const apexOfficeIds = new Set(state.offices.filter((office) => office.apex && state.institutions.find((institution) => institution.institutionId === office.institutionId)?.stateId === selector.stateId).map((office) => office.officeId));
      const personIds = new Set(state.officeTerms.filter((term) => term.endYear === null && apexOfficeIds.has(term.officeId)).map((term) => term.personId));
      result.FAMILY = [...new Set(state.politicalPeople.filter((person) => personIds.has(person.personId) && person.familyId).map((person) => person.familyId!))].sort();
    }
  }
  return Object.fromEntries(Object.entries(result).map(([key, ids]) => [key, [...new Set(ids)].sort()]));
}

export function applyShockDefinition(state: WorldStateV5, definition: ShockDefinitionV5): ReturnType<typeof applyCausalEffects> & { resolvedTargets: Record<string, string[]> } {
  if (definition.year !== state.year) throw new Error(`Shock ${definition.shockId} is scheduled for ${definition.year}, not ${state.year}`);
  const resolvedTargets = resolveShockSelectors(state, definition.entityScopeSelectors);
  if (definition.effects.some((effect) => effect.sourceEventId !== definition.shockId)) throw new Error(`Shock ${definition.shockId} contains an effect with a different source event`);
  return { ...applyCausalEffects(state, definition.effects), resolvedTargets };
}
