import { apportionLargestRemainder } from "../math/exact.js";

export type TerrainSuitability = "NONE" | "BROAD" | "SPECIFIC" | "UNKNOWN";
export function terrainSuitability(breedBroad: readonly string[], breedSpecific: readonly string[], siteBroad: readonly string[], siteSpecific: readonly string[]): TerrainSuitability {
  if (breedBroad.length === 0 || breedSpecific.length === 0) return "UNKNOWN";
  if (!breedBroad.some((value) => siteBroad.includes(value))) return "BROAD";
  if (!breedSpecific.some((value) => siteSpecific.includes(value))) return "SPECIFIC";
  return "NONE";
}

export interface MigrationIntent { transferId: string; originCohortId: string; destinationId: string; proposed: bigint; }
export interface AppliedTransfer extends MigrationIntent { amount: bigint; }
export function applySimultaneousTransfers(populations: ReadonlyMap<string, bigint>, intents: readonly MigrationIntent[]): { retained: Map<string, bigint>; transfers: AppliedTransfer[] } {
  const retained = new Map(populations);
  const transfers: AppliedTransfer[] = [];
  const byOrigin = new Map<string, MigrationIntent[]>();
  for (const intent of intents) byOrigin.set(intent.originCohortId, [...(byOrigin.get(intent.originCohortId) ?? []), intent]);
  for (const [origin, outgoing] of byOrigin) {
    const available = populations.get(origin);
    if (available === undefined) throw new Error(`Unknown origin cohort ${origin}`);
    const proposedTotal = outgoing.reduce((sum, intent) => sum + intent.proposed, 0n);
    const amounts = proposedTotal <= available ? outgoing.map((intent) => intent.proposed) : apportionLargestRemainder(available, outgoing.map((intent) => intent.proposed), outgoing.map((intent) => intent.transferId));
    const applied = amounts.reduce((sum, amount) => sum + amount, 0n);
    retained.set(origin, available - applied);
    outgoing.forEach((intent, index) => transfers.push({ ...intent, amount: amounts[index]! }));
  }
  return { retained, transfers: transfers.sort((a, b) => a.transferId.localeCompare(b.transferId)) };
}

export function buildMigrationEdges(settlements: readonly { settlementId: string; regionId: string }[], adjacency: Record<string, string[]>): { originId: string; destinationId: string }[] {
  return settlements.flatMap((origin) => settlements.filter((destination) => adjacency[origin.regionId]?.includes(destination.regionId)).map((destination) => ({ originId: origin.settlementId, destinationId: destination.settlementId }))).sort((a, b) => a.originId.localeCompare(b.originId) || a.destinationId.localeCompare(b.destinationId));
}
