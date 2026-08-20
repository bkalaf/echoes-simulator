import { describe, expect, it } from "vitest";
import { deriveOperatorViewModel, type OperatorSnapshot } from "../../src/core/operator/operator-state.js";

const blocker = { issueCode: "BREED_RESEARCH_INCOMPLETE", severity: "BLOCKER", blocksCanonical: true, message: "Research remains incomplete." };
const readyV4 = {
  schemaVersion: "eidolon-simulator-real-preflight-v3",
  structuralStatus: "PASS",
  canonicalReady: true,
  activeIssues: [],
  semanticAuthorityVersion: "V4",
  semanticAuthorityFilename: "research-v4.zip",
  semanticAuthoritySha256: "v4-hash",
  semanticAuthorityVerdict: "ACCEPT_SIMULATION_READY",
  year0Readiness: "PASS",
  policyVersion: "OWNER_POLICY_2026_08_19_V4",
  engineReadinessVersion: "eidolon-simulator-engine-readiness-v1",
};

function snapshot(overrides: Partial<OperatorSnapshot> = {}): OperatorSnapshot {
  return { preflight: null, manifest: null, runs: [], selectedRunId: null, pendingNamingJob: null, ...overrides };
}

describe("operator state derivation", () => {
  it("treats null preflight as NOT_VALIDATED while leaving diagnostic available", () => {
    const view = deriveOperatorViewModel(snapshot());
    expect(view.preflightState).toBe("NOT_VALIDATED");
    expect(view.runState).toBe("NO_RUN");
    expect(view.canRunDiagnostic).toBe(true);
    expect(view.canRunCanonical).toBe(false);
    expect(view.primaryNotice.title).toBe("Inputs have not been validated.");
    expect(view.setupCanonicalStatus).toBe("NOT VALIDATED");
    expect(view.setupCanonicalDetail).toBe("No preflight has been run");
    expect(view.setupCanonicalDetail).not.toContain("0 active blockers");
  });

  it("reports a blocked preflight with its exact blocker", () => {
    const view = deriveOperatorViewModel(snapshot({ preflight: { canonicalReady: false, structuralStatus: "PASS", activeIssues: [blocker] } }));
    expect(view.preflightState).toBe("BLOCKED");
    expect(view.blockingIssues).toEqual([blocker]);
    expect(view.primaryNotice.title).toBe("Canonical execution is blocked.");
    expect(view.setupCanonicalDetail).toBe("1 active blocker");
  });

  it("enables canonical execution only for current accepted V4 and passing year zero", () => {
    const view = deriveOperatorViewModel(snapshot({ preflight: readyV4 }));
    expect(view.preflightState).toBe("READY");
    expect(view.canRunCanonical).toBe(true);
    expect(view.primaryNotice.title).toBe("Canonical inputs are validated and simulation-ready.");
    expect(view.semanticAuthorityLabel).toBe("V4 · SIMULATION_READY");
  });

  it("marks a retired V3 ready report stale and requires V4 validation", () => {
    const view = deriveOperatorViewModel(snapshot({ preflight: {
      ...readyV4,
      semanticAuthorityVersion: "V3",
      semanticAuthorityVerdict: "ACCEPT_FINAL",
    } }));
    expect(view.preflightState).toBe("STALE");
    expect(view.canRunCanonical).toBe(false);
    expect(view.canonicalDisabledReasons).toContain("V4 validation required.");
  });

  it("marks an otherwise-ready preflight stale when an input hash changed", () => {
    const view = deriveOperatorViewModel(snapshot({ preflight: { ...readyV4, inputsCurrent: false } }));
    expect(view.preflightState).toBe("STALE");
    expect(view.canonicalDisabledReasons).toContain("One or more selected input hashes changed.");
  });

  it("turns an unexplained canonicalReady=false report into a visible consistency error", () => {
    const view = deriveOperatorViewModel(snapshot({ preflight: { canonicalReady: false, structuralStatus: "PASS", activeIssues: [] } }));
    expect(view.preflightState).toBe("ERROR");
    expect(view.blockingIssues[0]?.issueCode).toBe("PREFLIGHT_INCONSISTENT_BLOCKED_WITHOUT_REASON");
    expect(view.setupCanonicalDetail).not.toContain("0 active blockers");
  });

  it("blocks both start actions when a different persisted run is active", () => {
    const view = deriveOperatorViewModel(snapshot({ preflight: readyV4, hasActiveRun: true }));
    expect(view.canRunDiagnostic).toBe(false);
    expect(view.canRunCanonical).toBe(false);
    expect(view.diagnosticDisabledReasons).toEqual(["Another run is active."]);
  });

  it.each([
    ["not validated", snapshot(), "NOT VALIDATED", false],
    ["blocked", snapshot({ preflight: { canonicalReady: false, structuralStatus: "PASS", activeIssues: [blocker] } }), "BLOCKED", false],
    ["ready", snapshot({ preflight: readyV4 }), "READY", true],
    ["stale", snapshot({ preflight: { ...readyV4, semanticAuthorityVersion: "V3" } }), "STALE", false],
  ])("keeps renderer labels consistent for %s", (_name, input, expectedStatus, canRunCanonical) => {
    const view = deriveOperatorViewModel(input as OperatorSnapshot);
    expect(view.setupCanonicalStatus).toBe(expectedStatus);
    expect(view.canRunCanonical).toBe(canRunCanonical);
    expect(view.diagnostics.preflightState).toBe(view.preflightState);
    expect(view.primaryNotice.title.includes("ready")).toBe(view.preflightState === "READY");
  });
});
