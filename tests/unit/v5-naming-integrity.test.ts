import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bootstrapWorldV5 } from "../../src/core/v5/bootstrap.js";
import { loadBundledCanonicalV5 } from "../../src/core/v5/canonical-adapter.js";
import { DEFAULT_MECHANICS_VARIABLES_V1, diagnosticCandidateOwnerInputsV1 } from "../../src/core/v5/config.js";
import { boundedHistogram, mergeBoundedDiagnosticObservations } from "../../src/core/v5/diagnostics.js";
import { validateScopedV5DivergenceRegression, V5_REMEDIATION_DIVERGENCE_REGRESSION_SCOPE } from "../../src/core/v5/divergence-regression.js";
import { classifyNamingGeographyCells, type NamingGeographyWorldCell } from "../../src/core/v5/naming-geography.js";
import {
  COMPARISON_AWARE_NAMING_INSTRUCTION_V5,
  DEFAULT_NAMING_BEHAVIOR_V5,
  assertLiteralAutomaticReuseV5,
  buildPersistedNamingBatchesV5,
  validateAcceptedLabelProvenanceV5,
  validateNamingBatchResponseV5,
} from "../../src/core/v5/naming.js";
import { normalizeSeed } from "../../src/core/v5/random.js";
import { reconcileWorldRoutes } from "../../src/core/v5/routes.js";
import type { AcceptedLabelLedgerEntryV5, NamingRequestV5, WorldKey } from "../../src/core/v5/types.js";

const canonical = loadBundledCanonicalV5(resolve("resources/canonical"));
const owner = diagnosticCandidateOwnerInputsV1(Object.fromEntries(canonical.governments.map((government) => [government.governmentFormId, {}])));

function ledger(overrides: Partial<AcceptedLabelLedgerEntryV5> = {}): AcceptedLabelLedgerEntryV5 {
  return {
    ledgerEntryId: "LEDGER_1", runId: "RUN_1", worldKey: "CONCORD", entityType: "SETTLEMENT", entityId: "SETTLEMENT_1", label: "The Accepted Name",
    source: "OWNER_INPUT", sourceRequestId: null, sourceAuthorityRef: "OWNER_AUDIT:1", sourceBatchId: null, sourceResponseAttemptId: null,
    nameEffectiveFromYear: 10, acceptanceYear: 25, reusedFromEntityId: null, reusedFromLedgerEntryId: null, namingComparisonGroupId: null, comparisonAuthorityRef: null,
    ...overrides,
  };
}

function request(worldKey: WorldKey, group: string, behavior: "BLOCKING" | "BATCHED" = "BATCHED"): NamingRequestV5 {
  return { requestId: `REQ_${worldKey}_${group}`, entityType: "SETTLEMENT", entityId: `SETTLEMENT_${worldKey}_${group}`, behavior, createdYear: 12, nameEffectiveFromYear: 12, worldKey, namingComparisonGroupId: `SETTLEMENT_SITE:${group}`, comparisonAuthorityRef: `CANONICAL_SITE_ID:${group}`, comparisonGroupingVersion: "echoes-naming-comparison-groups-v1", acceptedLabel: null, context: { world: worldKey, creationYear: 12 } };
}

function geographyCell(worldKey: WorldKey, label: string | null, source: AcceptedLabelLedgerEntryV5["source"] | null = "OWNER_INPUT"): NamingGeographyWorldCell {
  return { worldKey, entityId: `ENTITY_${worldKey}`, label, display: label ?? "PENDING", status: label ? "ACCEPTED" : "PENDING", source: label ? source : null, cssClass: null };
}

describe("V5 naming integrity", () => {
  it("enforces provenance-dependent nullable references without manufacturing IDs", () => {
    expect(() => validateAcceptedLabelProvenanceV5(ledger({ source: "CANONICAL_EXISTING", sourceRequestId: null, sourceAuthorityRef: "CANONICAL_NAME_AUTHORITY:SITE-001" }), "PRODUCTION")).not.toThrow();
    expect(() => validateAcceptedLabelProvenanceV5(ledger({ source: "OWNER_INPUT", sourceRequestId: null, sourceAuthorityRef: "OWNER_AUDIT:42" }), "REMEDIATION")).not.toThrow();
    expect(() => validateAcceptedLabelProvenanceV5(ledger({ source: "LLM_NAMING_RESPONSE", sourceRequestId: null, sourceAuthorityRef: null }), "PRODUCTION")).toThrow(/request, batch, and response attempt/);
    expect(() => validateAcceptedLabelProvenanceV5(ledger({ source: "TEST_FIXTURE", sourceAuthorityRef: "TEST_ARTIFACT:\/tmp\/fixture.sqlite" }), "REMEDIATION")).toThrow(/confined|reject/);
    expect(() => validateAcceptedLabelProvenanceV5(ledger({ nameEffectiveFromYear: 26, acceptanceYear: 25 }), "PRODUCTION")).toThrow(/years are invalid/);
  });

  it("requires exact trusted identity reuse and rejects variants and generic shortcuts", () => {
    const source = ledger({ source: "CANONICAL_EXISTING", sourceAuthorityRef: "CANONICAL_NAME_AUTHORITY:PERSON-1" });
    expect(() => assertLiteralAutomaticReuseV5(source.label, source, "EXACT_IDENTITY_REUSE:PERSON-1")).not.toThrow();
    expect(() => assertLiteralAutomaticReuseV5(`${source.label} II`, source, "EXACT_IDENTITY_REUSE:PERSON-1")).toThrow(/literally/);
    expect(() => assertLiteralAutomaticReuseV5(source.label, source, null)).toThrow(/explicit target-identity authority/);
    expect(DEFAULT_NAMING_BEHAVIOR_V5.ROUTINE_OFFICEHOLDER).toBe("BATCHED");
    expect(readFileSync(resolve("src/core/v5/naming.ts"), "utf8")).not.toContain('ROUTINE_OFFICEHOLDER: "AUTOMATIC_REUSE"');
  });

  it("keeps blocking and batched work separate and keeps comparison groups atomic in world order", () => {
    const grouped = [request("RUIN", "SITE-1"), request("CONCORD", "SITE-1"), request("SCHISM", "SITE-1"), request("CONCORD", "SITE-2")];
    const batches = buildPersistedNamingBatchesV5("RUN", grouped, 2);
    expect(batches).toHaveLength(2);
    expect(batches[0]!.items.map((item) => item.worldKey)).toEqual(["CONCORD", "SCHISM", "RUIN"]);
    expect(batches[0]!.items).toHaveLength(3);
    expect(batches[0]!.promptText).toContain(COMPARISON_AWARE_NAMING_INSTRUCTION_V5);
    expect(batches[0]!.comparisonGroups[0]?.members.map((member) => member.worldKey)).toEqual(["CONCORD", "SCHISM", "RUIN"]);
    const blocking = buildPersistedNamingBatchesV5("RUN", [...grouped, { ...request("CONCORD", "BLOCKER", "BLOCKING"), namingComparisonGroupId: null, comparisonAuthorityRef: null }], 50);
    expect(blocking).toHaveLength(1);
    expect(blocking[0]!.behavior).toBe("BLOCKING");
    expect(blocking[0]!.items.every((item) => item.behavior === "BLOCKING")).toBe(true);
  });

  it("requires one independent LLM response decision per counterpart and never fills equal contexts locally", () => {
    const batch = buildPersistedNamingBatchesV5("RUN", [request("CONCORD", "SITE-1"), request("SCHISM", "SITE-1"), request("RUIN", "SITE-1")], 50)[0]!;
    const incomplete = { schemaVersion: "echoes-v5-naming-batch-response-v2", batchId: batch.batchId, runId: batch.runId, decisions: batch.items.slice(0, 2).map((item) => ({ requestId: item.requestId, entityType: item.entityType, entityId: item.entityId, label: "Same Name", nameEffectiveFromYear: 12 })) };
    expect(validateNamingBatchResponseV5(batch, incomplete).accepted).toBe(false);
    expect(batch.items.every((item) => item.acceptedLabel === null)).toBe(true);
  });

  it("does not create naming requests for unresolved or portal-only routes, but batches resolved physical routes with creation-time context", () => {
    const boot = bootstrapWorldV5({ worldKey: "CONCORD", canonical, ownerInputs: owner, variables: DEFAULT_MECHANICS_VARIABLES_V1, normalizedSeed: normalizeSeed("V5_ROUTE_READINESS"), mode: "DIAGNOSTIC" });
    const active = boot.state.worldRoutes[0]!;
    const baseCorridor = canonical.routeCorridors.find((candidate) => candidate.corridorId === active.corridorId)!;
    const state = { ...boot.state, worldRoutes: boot.state.worldRoutes.filter((route) => route.corridorId !== active.corridorId) };
    const unresolved = reconcileWorldRoutes(state, { ...canonical, routeCorridors: [{ ...baseCorridor, primaryMode: "UNRESOLVED", infrastructureClass: "UNRESOLVED" }] }, owner, DEFAULT_MECHANICS_VARIABLES_V1);
    expect(unresolved.namingRequests).toHaveLength(0);
    const portal = reconcileWorldRoutes(state, { ...canonical, routeCorridors: [{ ...baseCorridor, portalCapability: true, primaryMode: "NONE", infrastructureClass: "UNRESOLVED" }] }, owner, DEFAULT_MECHANICS_VARIABLES_V1);
    expect(portal.namingRequests).toHaveLength(0);
    const resolved = reconcileWorldRoutes(state, { ...canonical, routeCorridors: [{ ...baseCorridor, landCapability: true, primaryMode: "LAND", infrastructureClass: "ROAD", resolutionAuthority: "CANONICAL_FACT" }] }, owner, DEFAULT_MECHANICS_VARIABLES_V1);
    expect(resolved.namingRequests).toHaveLength(1);
    expect(resolved.namingRequests[0]).toMatchObject({ behavior: "BATCHED", nameEffectiveFromYear: state.year, namingComparisonGroupId: `WORLD_ROUTE:${baseCorridor.corridorId}`, context: { establishedYear: state.year, primaryMode: "LAND", infrastructureClass: "ROAD" } });
  });

  it.each([
    ["AAA", ["Å", " Å ", "å"]],
    ["AAB", ["A", "a", "B"]],
    ["ABA", ["A", "B", "a"]],
    ["BAA", ["B", "A", "a"]],
    ["ABC", ["A", "B", "C"]],
  ] as const)("classifies %s without fuzzy matching and applies exact cell styles", (pattern, labels) => {
    const cells = { CONCORD: geographyCell("CONCORD", labels[0]), SCHISM: geographyCell("SCHISM", labels[1]), RUIN: geographyCell("RUIN", labels[2]) };
    const classified = classifyNamingGeographyCells(cells);
    expect(classified.pattern).toBe(pattern);
    expect(Object.values(classified.styled).filter((cell) => cell.cssClass === "name-divergence-all")).toHaveLength(pattern === "ABC" ? 3 : 0);
    expect(Object.values(classified.styled).filter((cell) => cell.cssClass === "name-divergence-odd")).toHaveLength(["AAB", "ABA", "BAA"].includes(pattern) ? 1 : 0);
  });

  it("classifies missing and working/test-only labels as incomplete", () => {
    const pending = { CONCORD: geographyCell("CONCORD", "Working", "TEST_FIXTURE"), SCHISM: geographyCell("SCHISM", "Working"), RUIN: geographyCell("RUIN", null) };
    expect(classifyNamingGeographyCells(pending).pattern).toBe("INCOMPLETE");
  });

  it("bounds diagnostic observations to fixed histograms and one merged aggregate", () => {
    const histogram = boundedHistogram([-5, 0, 500, 1000, 5000]);
    expect(histogram).toHaveLength(1001);
    expect(histogram[0]).toBe(2);
    expect(histogram[1000]).toBe(2);
    const first = { domain: "FOUNDING" as const, worldKey: "CONCORD" as const, year: 10, counters: { evaluations: 1 }, histograms: { pressure: histogram } };
    const merged = mergeBoundedDiagnosticObservations(first, { ...first, year: 20, counters: { evaluations: 2 }, absentComponents: ["NOT_PRESENT_IN_CURRENT_CAUSAL_MODEL"] });
    expect(merged.counters.evaluations).toBe(3);
    expect(merged.histograms.pressure).toHaveLength(1001);
    expect(merged.year).toBe(20);
  });

  it("scopes the 203-item divergence fixture to its exact registered comparison set", () => {
    const fixture = JSON.parse(readFileSync(resolve("artifacts/simulator/v5/acceptance/acceptance-report-2026-08-27T07-06-40-588Z.json"), "utf8")) as { divergence: import("../../src/core/v5/read-model.js").DivergenceReportV1 };
    const result = validateScopedV5DivergenceRegression({ ...V5_REMEDIATION_DIVERGENCE_REGRESSION_SCOPE, report: fixture.divergence });
    expect(result).toMatchObject({ applies: true, pass: true, actual: { total: 203, identical: 132, minor: 15, material: 56 } });
    expect(validateScopedV5DivergenceRegression({ ...V5_REMEDIATION_DIVERGENCE_REGRESSION_SCOPE, comparisonSetVersion: "future-registry", report: fixture.divergence })).toMatchObject({ applies: false, pass: true });
  });
});
