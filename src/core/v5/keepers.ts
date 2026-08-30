import type { WorldKey } from "./types.js";

export interface LegendaryRewardItemV1 {
  legendaryRewardItemId: string;
  canonicalName: string;
  canonicalDescription: string;
  authorityRevisionId: string;
  sourceAuthorityRef: string;
  active: boolean;
}

export interface KeeperOfficeV1 {
  keeperOfficeId: string;
  legendaryRewardItemId: string;
  worldKey: WorldKey;
  createdYear: number;
  dissolvedYear: number | null;
}

export interface KeeperHolderTermV1 {
  keeperHolderTermId: string;
  keeperOfficeId: string;
  holderPersonId: string;
  effectiveFromYear: number;
  effectiveToYear: number | null;
  selectionEventId: string;
  authorityRevisionId: string;
}

const WORLDS: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];

export function legendaryRewardInventoryReadinessV1(items: readonly LegendaryRewardItemV1[], authorityRevisionId: string | null): { status: "READY" | "LEGENDARY_REWARD_INVENTORY_REQUIRED"; itemCount: number | null } {
  if (!authorityRevisionId) return { status: "LEGENDARY_REWARD_INVENTORY_REQUIRED", itemCount: null };
  if (items.some((item) => item.authorityRevisionId !== authorityRevisionId || !item.legendaryRewardItemId.trim() || !item.canonicalName.trim() || !item.sourceAuthorityRef.trim())) throw new Error("Legendary Reward inventory contains an unproven item");
  if (new Set(items.map((item) => item.legendaryRewardItemId)).size !== items.length) throw new Error("Legendary Reward inventory contains duplicate item IDs");
  return { status: "READY", itemCount: items.length };
}

export function materializeKeeperOfficesV1(items: readonly LegendaryRewardItemV1[], authorityRevisionId: string | null): KeeperOfficeV1[] {
  const readiness = legendaryRewardInventoryReadinessV1(items, authorityRevisionId);
  if (readiness.status !== "READY") throw new Error("Legendary Reward inventory authority is required before Keeper Offices can be created");
  return items.filter((item) => item.active).flatMap((item) => WORLDS.map((worldKey) => ({ keeperOfficeId: `KEEPER_OFFICE_${worldKey}_${item.legendaryRewardItemId}`, legendaryRewardItemId: item.legendaryRewardItemId, worldKey, createdYear: 0, dissolvedYear: null }))).sort((left, right) => left.keeperOfficeId.localeCompare(right.keeperOfficeId));
}

export function validateKeeperArchitectureV1(items: readonly LegendaryRewardItemV1[], offices: readonly KeeperOfficeV1[], terms: readonly KeeperHolderTermV1[]): void {
  const itemIds = new Set(items.map((item) => item.legendaryRewardItemId));
  const officeKeys = offices.map((office) => `${office.worldKey}\0${office.legendaryRewardItemId}`);
  if (new Set(officeKeys).size !== officeKeys.length) throw new Error("Keeper architecture has more than one Office per item/world");
  for (const item of items.filter((candidate) => candidate.active)) for (const worldKey of WORLDS) if (!officeKeys.includes(`${worldKey}\0${item.legendaryRewardItemId}`)) throw new Error(`Missing Keeper Office for ${item.legendaryRewardItemId}/${worldKey}`);
  if (offices.some((office) => !itemIds.has(office.legendaryRewardItemId))) throw new Error("Keeper Office references an unknown Legendary Reward Item");
  const officeIds = new Set(offices.map((office) => office.keeperOfficeId));
  for (const term of terms) {
    if (!officeIds.has(term.keeperOfficeId)) throw new Error(`Keeper holder term ${term.keeperHolderTermId} references an unknown Office`);
    if (term.effectiveToYear !== null && term.effectiveToYear <= term.effectiveFromYear) throw new Error(`Keeper holder term ${term.keeperHolderTermId} has an invalid interval`);
  }
  for (const office of offices) {
    const ordered = terms.filter((term) => term.keeperOfficeId === office.keeperOfficeId).sort((left, right) => left.effectiveFromYear - right.effectiveFromYear);
    for (let index = 1; index < ordered.length; index += 1) if (ordered[index - 1]!.effectiveToYear === null || ordered[index - 1]!.effectiveToYear! > ordered[index]!.effectiveFromYear) throw new Error(`Keeper Office ${office.keeperOfficeId} has overlapping holder terms`);
  }
}

export function succeedKeeperHolderV1(input: { office: KeeperOfficeV1; terms: readonly KeeperHolderTermV1[]; holderPersonId: string; year: number; selectionEventId: string; authorityRevisionId: string }): KeeperHolderTermV1[] {
  if (!input.holderPersonId.trim() || !input.selectionEventId.trim() || !input.authorityRevisionId.trim()) throw new Error("Keeper succession requires a real holder and provenance");
  const active = input.terms.filter((term) => term.keeperOfficeId === input.office.keeperOfficeId && term.effectiveFromYear <= input.year && (term.effectiveToYear === null || term.effectiveToYear > input.year));
  if (active.length > 1) throw new Error(`Keeper Office ${input.office.keeperOfficeId} has multiple active holders`);
  const closed = input.terms.map((term) => term === active[0] ? { ...term, effectiveToYear: input.year } : term);
  const next: KeeperHolderTermV1 = { keeperHolderTermId: `KEEPER_TERM_${input.office.keeperOfficeId}_${input.year}_${input.holderPersonId}`, keeperOfficeId: input.office.keeperOfficeId, holderPersonId: input.holderPersonId, effectiveFromYear: input.year, effectiveToYear: null, selectionEventId: input.selectionEventId, authorityRevisionId: input.authorityRevisionId };
  return [...closed, next].sort((left, right) => left.effectiveFromYear - right.effectiveFromYear || left.keeperHolderTermId.localeCompare(right.keeperHolderTermId));
}
