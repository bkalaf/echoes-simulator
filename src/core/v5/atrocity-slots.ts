import { V5_ATROCITY_OCCURRENCE_IDS, type AtrocityOccurrenceSlotV5 } from "./types.js";

function witnessFor(occurrenceId: (typeof V5_ATROCITY_OCCURRENCE_IDS)[number]): number {
  const match = occurrenceId.match(/WITNESS_(\d+)/);
  if (!match) throw new Error(`Invalid atrocity occurrence ID ${occurrenceId}`);
  return Number(match[1]);
}

export function createAtrocityOccurrenceSlotsV5(): AtrocityOccurrenceSlotV5[] {
  return V5_ATROCITY_OCCURRENCE_IDS.map((occurrenceId) => ({
    occurrenceId,
    witness: witnessFor(occurrenceId) as AtrocityOccurrenceSlotV5["witness"],
    witnessOccurrence: occurrenceId.endsWith("_A") ? "A" : occurrenceId.endsWith("_B") ? "B" : "ONLY",
    status: "NOT_CONFIGURED",
    triggerYear: null,
    targetScope: null,
    shockDefinitionId: null,
    authorityRef: "V5.4_STRUCTURAL_SLOT_ONLY",
  }));
}

export function validateAtrocityOccurrenceSlotsV5(slots: readonly AtrocityOccurrenceSlotV5[]): void {
  if (slots.length !== V5_ATROCITY_OCCURRENCE_IDS.length) throw new Error("V5.4 requires exactly 18 atrocity occurrence slots");
  slots.forEach((slot, index) => {
    if (slot.occurrenceId !== V5_ATROCITY_OCCURRENCE_IDS[index]) throw new Error(`Atrocity slot order mismatch at ${index}`);
    if (slot.status === "NOT_CONFIGURED" && (slot.triggerYear !== null || slot.targetScope !== null || slot.shockDefinitionId !== null)) throw new Error(`Disabled atrocity slot ${slot.occurrenceId} carries executable configuration`);
    if (slot.status === "CONFIGURED" && (slot.triggerYear === null || slot.targetScope === null || slot.shockDefinitionId === null)) throw new Error(`Configured atrocity slot ${slot.occurrenceId} is incomplete`);
  });
}
