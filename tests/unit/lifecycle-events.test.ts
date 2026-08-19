import { describe, expect, it } from "vitest";
import { canRun, transitionRun } from "../../src/core/run/lifecycle.js";
import { sortEvents, stableEventId } from "../../src/core/events/event-store.js";
import { checkpointDigest, createReplayCheckpoint, replayFromCheckpoint, restoreReplayCheckpoint } from "../../src/core/checkpoints/checkpoint.js";

describe("lifecycle and event contracts", () => {
  it("enforces legal transitions and run gates", () => {
    expect(transitionRun("CREATED", "VALIDATING_INPUTS")).toBe("VALIDATING_INPUTS");
    expect(() => transitionRun("CREATED", "RUNNING")).toThrow();
    expect(canRun({ status: "READY", mode: "CANONICAL", blockers: ["X"], pendingNaming: 0, inputsValidated: true })).toEqual({ allowed: false, reason: "Canonical readiness blockers: X" });
    expect(canRun({ status: "READY", mode: "DIAGNOSTIC", blockers: [], pendingNaming: 1, inputsValidated: true }).allowed).toBe(false);
  });

  it("sorts events and creates stable identities/digests", () => {
    const later = { year: 2, phaseOrder: 10, sequence: 0 };
    const earlier = { year: 1, phaseOrder: 90, sequence: 5 };
    expect(sortEvents([later, earlier])).toEqual([earlier, later]);
    expect(stableEventId("run", "CONCORD", 1, "GROWTH", "cohort", 0)).toBe(stableEventId("run", "CONCORD", 1, "GROWTH", "cohort", 0));
    expect(checkpointDigest({ population: 10n, nested: { b: 2, a: 1 } })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("restores complete checkpoint state and replays later events to the direct state digest", () => {
    const initial = { year: 0, cohorts: [{ cohortId: "C1", population: 10n, wealthScore: 0 }], namingStatus: "CLEAR", federalCapital: "S1" };
    const events = [
      { year: 1, growth: 1n, wealth: 2 },
      { year: 2, growth: 1n, wealth: 3 },
      { year: 3, growth: 2n, wealth: 4 },
    ];
    const reducer = (state: typeof initial, event: typeof events[number]) => ({ ...state, year: event.year, cohorts: [{ ...state.cohorts[0]!, population: state.cohorts[0]!.population + event.growth, wealthScore: state.cohorts[0]!.wealthScore + event.wealth }] });
    const direct = events.reduce(reducer, initial);
    const atTwo = events.slice(0, 2).reduce(reducer, initial);
    const checkpoint = createReplayCheckpoint({ runId: "RUN", worldKey: "CONCORD", state: atTwo, engineVersion: "v1", policyVersion: "p1" });
    expect(restoreReplayCheckpoint(checkpoint)).toEqual(atTwo);
    const replayed = replayFromCheckpoint(checkpoint, events.slice(2), reducer);
    expect(checkpointDigest(replayed)).toBe(checkpointDigest(direct));
    expect(() => restoreReplayCheckpoint({ ...checkpoint, stateHash: "bad" })).toThrow(/hash/i);
  });
});
