export function applyAcceptedSettlementNames<T extends { settlementId: string; name?: unknown }>(
  projections: readonly T[],
  acceptedNames: ReadonlyMap<string, string>,
): T[] {
  return projections.map((projection) => {
    const accepted = acceptedNames.get(projection.settlementId);
    return accepted === undefined ? { ...projection } : { ...projection, name: accepted };
  });
}
