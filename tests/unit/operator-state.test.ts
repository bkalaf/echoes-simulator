import { describe, expect, it } from "vitest";
import { deriveOperatorViewModel, type CanonicalDataStatus, type OperatorSnapshot } from "../../src/core/operator/operator-state.js";

const ready: CanonicalDataStatus = { status: "READY", semanticAuthorityVersion: "V4", semanticAuthorityFilename: "v4.zip", semanticAuthoritySha256: "hash", semanticAuthorityVerdict: "ACCEPT_SIMULATION_READY", year0Readiness: "PASS", ownerPolicyVersion: "owner-v1", personalityPolicyVersion: "PERSONALITY_PROFILE_DIMENSIONS_V1", bundleVersion: "V4_SIMULATION_READY", bundleContentSha256: "bundle" };
const invalid: CanonicalDataStatus = { status: "INVALID", semanticAuthorityVersion: null, semanticAuthorityFilename: null, semanticAuthoritySha256: null, semanticAuthorityVerdict: null, year0Readiness: null, ownerPolicyVersion: null, personalityPolicyVersion: null, bundleVersion: null, bundleContentSha256: null, errorCode: "BUNDLED_CANONICAL_DATA_INVALID", errorDetail: "checksum mismatch" };
const snapshot = (overrides: Partial<OperatorSnapshot> = {}): OperatorSnapshot => ({ canonicalData: ready, manifest: null, runs: [], selectedRunId: null, pendingNamingJob: null, ...overrides });

describe("bundled canonical operator state", () => {
  it("starts READY with both run modes available and no validation state", () => {
    const view = deriveOperatorViewModel(snapshot());
    expect(view).toMatchObject({ productState: "READY", canRunCanonical: true, canRunDiagnostic: true, semanticAuthorityLabel: "V4 · SIMULATION READY" });
    expect(view.primaryNotice.title).toBe("Canonical data is simulation-ready.");
  });

  it("fails closed as an internal build defect without suggesting operator validation", () => {
    const view = deriveOperatorViewModel(snapshot({ canonicalData: invalid }));
    expect(view.canRunCanonical).toBe(false);
    expect(view.canRunDiagnostic).toBe(true);
    expect(view.primaryNotice.detail).toContain("BUNDLED_CANONICAL_DATA_INVALID");
    expect(JSON.stringify(view)).not.toMatch(/validate|preflight|select.*directory/i);
  });

  it("makes a genuine naming barrier the primary global state", () => {
    const view = deriveOperatorViewModel(snapshot({ manifest: { runId: "RUN", mode: "CANONICAL", status: "WAITING_FOR_NAMING", currentYear: 0 }, pendingNamingJob: {} }));
    expect(view).toMatchObject({ productState: "WAITING_FOR_NAMING", canRunCanonical: false, canRunDiagnostic: false, canSubmitNaming: true });
  });

  it("does not let retired V3 history block a new V4 run", () => {
    const view = deriveOperatorViewModel(snapshot({ manifest: { runId: "OLD", mode: "CANONICAL", status: "RETIRED_DATA_AUTHORITY", currentYear: 100 } }));
    expect(view.productState).toBe("READY");
    expect(view.canRunCanonical).toBe(true);
  });
});
