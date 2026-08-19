import type { WorldKey } from "../contracts/domain.js";

interface StateInput { stateId: string; settlements: { settlementId: string; siteId: string; population: bigint }[]; }
export interface ConclaveSeat { seatId: string; type: "CITY" | "UNINCORPORATED"; stateId: string; settlementId: string | null; siteId: string | null; vacant: boolean; }

export function buildConclaveSeats(world: WorldKey, year: number, states: readonly StateInput[], innerwoodExists: boolean): ConclaveSeat[] {
  const seats: ConclaveSeat[] = [];
  for (const state of [...states].sort((a, b) => a.stateId.localeCompare(b.stateId))) {
    const ranked = [...state.settlements].sort((a, b) => a.population === b.population ? a.siteId.localeCompare(b.siteId) : a.population > b.population ? -1 : 1);
    if (year < 90) {
      for (const settlement of ranked) seats.push({ seatId: `CONCLAVE_${world}_${state.stateId}_${settlement.settlementId}`, type: "CITY", stateId: state.stateId, settlementId: settlement.settlementId, siteId: settlement.siteId, vacant: false });
    } else {
      for (let index = 0; index < 2; index += 1) {
        const settlement = ranked[index];
        seats.push({ seatId: `CONCLAVE_${world}_${state.stateId}_CITY_${index + 1}`, type: "CITY", stateId: state.stateId, settlementId: settlement?.settlementId ?? null, siteId: settlement?.siteId ?? null, vacant: !settlement });
      }
      seats.push({ seatId: `CONCLAVE_${world}_${state.stateId}_UNINCORPORATED`, type: "UNINCORPORATED", stateId: state.stateId, settlementId: null, siteId: null, vacant: false });
    }
  }
  const expectedCapacity = year < 90 ? seats.length : innerwoodExists ? 75 : 72;
  if (seats.length > expectedCapacity) throw new Error("Conclave seat allocation exceeds capacity");
  return seats;
}

export function senateElectionSuffix(seat: "A" | "B"): 5 | 0 { return seat === "A" ? 5 : 0; }
export function isSenateElectionYear(seat: "A" | "B", year: number): boolean { return year % 10 === senateElectionSuffix(seat); }
