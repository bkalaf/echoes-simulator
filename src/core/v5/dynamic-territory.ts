import type { ControllerType, SettlementV5, WorldKey, WorldStateV5 } from "./types.js";

export type SettlementMembershipCauseV1 = "SECESSION" | "CONQUEST" | "TREATY" | "ANNEXATION" | "STATE_SPLIT" | "STATE_MERGE" | "OWNER_AUTHORIZED_EQUIVALENT";

export interface SettlementStateMembershipTermV1 {
  membershipTermId: string;
  settlementId: string;
  stateId: string;
  effectiveFromYear: number;
  effectiveToYear: number | null;
  cause: SettlementMembershipCauseV1;
  sourceEventId: string;
}

export interface SettlementMembershipEventV1 {
  eventId: string;
  settlementId: string;
  fromStateId: string;
  toStateId: string;
  year: number;
  cause: SettlementMembershipCauseV1;
}

export interface SettlementInfluenceTermV1 {
  influenceTermId: string;
  settlementId: string;
  effectiveFromYear: number;
  effectiveToYear: number | null;
  latitude: number;
  longitude: number;
  effectiveRadiusKm: number;
  policyRevisionId: string;
  sourceEventId: string;
}

export interface InfluenceControlResultV1 {
  settlementId: string | null;
  stateId: string | null;
  normalizedDistance: number | null;
  status: "CONTROLLED" | "UNCLAIMED";
}

export interface DynamicControlTermV1 {
  controlTermId: string;
  entityType: "POI" | "REFUGE" | "RESOURCE" | "ROUTE_SEGMENT";
  entityId: string;
  controllingSettlementId: string;
  controllingStateId: string;
  controllerType: ControllerType;
  effectiveFromYear: number;
  effectiveToYear: number | null;
  sourceInfluenceTermId: string;
  sourceEventId: string;
}

export interface TerritoryCoordinateV1 { longitude: number; latitude: number }
export interface StateTerritoryCellV1 {
  territoryCellId: string;
  worldKey: WorldKey;
  stateId: string | null;
  controllingSettlementId: string | null;
  effectiveFromYear: number;
  effectiveToYear: number | null;
  ring: readonly TerritoryCoordinateV1[];
  status: "CLAIMED" | "UNCLAIMED";
}

export function weightedBoundaryDistanceFromA(totalDistance: number, radiusA: number, radiusB: number): number {
  if (![totalDistance, radiusA, radiusB].every(Number.isFinite) || totalDistance < 0 || radiusA <= 0 || radiusB <= 0) throw new Error("Weighted boundary inputs must be finite with positive radii");
  return totalDistance * radiusA / (radiusA + radiusB);
}

export function geodesicDistanceKmV1(left: { latitude: number; longitude: number }, right: { latitude: number; longitude: number }): number {
  const radians = (degrees: number): number => degrees * Math.PI / 180;
  const latitudeA = radians(left.latitude); const latitudeB = radians(right.latitude);
  const latitudeDelta = radians(right.latitude - left.latitude); const longitudeDelta = radians(right.longitude - left.longitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  const earthRadiusKm = 6_371_008_800 / 1_000_000;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function influenceControlAtPointV1(input: { point: { latitude: number; longitude: number }; settlements: readonly SettlementV5[]; terms: readonly SettlementInfluenceTermV1[]; year: number }): InfluenceControlResultV1 {
  const settlementById = new Map(input.settlements.map((settlement) => [settlement.settlementId, settlement]));
  const candidates = input.terms.filter((term) => term.effectiveFromYear <= input.year && (term.effectiveToYear === null || term.effectiveToYear > input.year)).map((term) => {
    const settlement = settlementById.get(term.settlementId);
    if (!settlement) throw new Error(`Influence term ${term.influenceTermId} references unknown Settlement ${term.settlementId}`);
    if (!(term.effectiveRadiusKm > 0)) throw new Error(`Influence term ${term.influenceTermId} has no approved positive radius`);
    const distance = geodesicDistanceKmV1(input.point, term);
    return { term, settlement, distance, normalizedDistance: distance / term.effectiveRadiusKm };
  }).filter((candidate) => candidate.distance <= candidate.term.effectiveRadiusKm)
    .sort((left, right) => left.normalizedDistance - right.normalizedDistance || left.settlement.settlementId.localeCompare(right.settlement.settlementId));
  const winner = candidates[0];
  return winner ? { settlementId: winner.settlement.settlementId, stateId: winner.settlement.stateId, normalizedDistance: winner.normalizedDistance, status: "CONTROLLED" } : { settlementId: null, stateId: null, normalizedDistance: null, status: "UNCLAIMED" };
}

export function applySettlementMembershipEventV1(state: WorldStateV5, terms: readonly SettlementStateMembershipTermV1[], event: SettlementMembershipEventV1): { state: WorldStateV5; terms: SettlementStateMembershipTermV1[] } {
  if (!Number.isInteger(event.year) || event.year !== state.year) throw new Error("Settlement membership event must occur at the current causal year");
  const settlement = state.settlements.find((candidate) => candidate.settlementId === event.settlementId);
  if (!settlement) throw new Error(`Unknown Settlement ${event.settlementId}`);
  if (settlement.stateId !== event.fromStateId) throw new Error(`Settlement ${event.settlementId} belongs to ${settlement.stateId}, not ${event.fromStateId}`);
  if (!state.states.some((candidate) => candidate.stateId === event.toStateId)) throw new Error(`Unknown destination State ${event.toStateId}`);
  if (event.fromStateId === event.toStateId) throw new Error("Settlement membership event must change State membership");
  const active = terms.filter((term) => term.settlementId === event.settlementId && term.effectiveFromYear <= event.year && (term.effectiveToYear === null || term.effectiveToYear > event.year));
  if (active.length > 1) throw new Error(`Settlement ${event.settlementId} has overlapping membership terms`);
  const closed = terms.map((term) => term === active[0] ? { ...term, effectiveToYear: event.year } : term);
  const nextTerm: SettlementStateMembershipTermV1 = { membershipTermId: `MEMBERSHIP_${event.settlementId}_${event.year}_${event.toStateId}`, settlementId: event.settlementId, stateId: event.toStateId, effectiveFromYear: event.year, effectiveToYear: null, cause: event.cause, sourceEventId: event.eventId };
  return { state: { ...state, settlements: state.settlements.map((candidate) => candidate.settlementId === event.settlementId ? { ...candidate, stateId: event.toStateId } : candidate) }, terms: [...closed, nextTerm].sort((left, right) => left.settlementId.localeCompare(right.settlementId) || left.effectiveFromYear - right.effectiveFromYear) };
}

function coordinateEqual(left: TerritoryCoordinateV1, right: TerritoryCoordinateV1): boolean { return left.longitude === right.longitude && left.latitude === right.latitude; }
function orientation(a: TerritoryCoordinateV1, b: TerritoryCoordinateV1, c: TerritoryCoordinateV1): number { return (b.latitude - a.latitude) * (c.longitude - b.longitude) - (b.longitude - a.longitude) * (c.latitude - b.latitude); }
function properIntersection(a: TerritoryCoordinateV1, b: TerritoryCoordinateV1, c: TerritoryCoordinateV1, d: TerritoryCoordinateV1): boolean {
  const abC = orientation(a, b, c); const abD = orientation(a, b, d); const cdA = orientation(c, d, a); const cdB = orientation(c, d, b);
  return abC * abD < 0 && cdA * cdB < 0;
}

export function validateStateTerritoryTopologyV1(cells: readonly StateTerritoryCellV1[]): { valid: true; cellCount: number; claimedCount: number; unclaimedCount: number } {
  const ids = cells.map((cell) => cell.territoryCellId);
  if (new Set(ids).size !== ids.length) throw new Error("Territory contains duplicate cell IDs");
  for (const cell of cells) {
    if (cell.ring.length < 4 || !coordinateEqual(cell.ring[0]!, cell.ring.at(-1)!)) throw new Error(`Territory cell ${cell.territoryCellId} is not a closed ring`);
    if (cell.status === "CLAIMED" && (!cell.stateId || !cell.controllingSettlementId)) throw new Error(`Claimed cell ${cell.territoryCellId} lacks control identity`);
    if (cell.status === "UNCLAIMED" && (cell.stateId || cell.controllingSettlementId)) throw new Error(`Unclaimed cell ${cell.territoryCellId} carries political control`);
    const segments = cell.ring.slice(0, -1).map((point, index) => [point, cell.ring[index + 1]!] as const);
    for (let left = 0; left < segments.length; left += 1) for (let right = left + 1; right < segments.length; right += 1) {
      if (Math.abs(left - right) <= 1 || (left === 0 && right === segments.length - 1)) continue;
      if (properIntersection(segments[left]![0], segments[left]![1], segments[right]![0], segments[right]![1])) throw new Error(`Territory cell ${cell.territoryCellId} self-intersects`);
    }
  }
  for (let left = 0; left < cells.length; left += 1) for (let right = left + 1; right < cells.length; right += 1) {
    const leftSegments = cells[left]!.ring.slice(0, -1).map((point, index) => [point, cells[left]!.ring[index + 1]!] as const);
    const rightSegments = cells[right]!.ring.slice(0, -1).map((point, index) => [point, cells[right]!.ring[index + 1]!] as const);
    for (const leftSegment of leftSegments) for (const rightSegment of rightSegments) if (properIntersection(leftSegment[0], leftSegment[1], rightSegment[0], rightSegment[1])) throw new Error(`Territory cells ${cells[left]!.territoryCellId} and ${cells[right]!.territoryCellId} overlap`);
  }
  return { valid: true, cellCount: cells.length, claimedCount: cells.filter((cell) => cell.status === "CLAIMED").length, unclaimedCount: cells.filter((cell) => cell.status === "UNCLAIMED").length };
}
