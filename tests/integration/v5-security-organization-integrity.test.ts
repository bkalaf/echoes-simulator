import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bootstrapWorldV5 } from "../../src/core/v5/bootstrap.js";
import { loadBundledCanonicalV5 } from "../../src/core/v5/canonical-adapter.js";
import { DEFAULT_MECHANICS_VARIABLES_V1, V5_MECHANICS_VERSION, diagnosticCandidateOwnerInputsV1 } from "../../src/core/v5/config.js";
import { updateCivicInstitutionsAndSecurityV5, validateSecurityForceOrganizationIntegrityV5 } from "../../src/core/v5/historical-dynamism.js";
import { V5_EMPTY_EVENT_HISTORY_HASH } from "../../src/core/v5/persistence.js";
import { normalizeSeed } from "../../src/core/v5/random.js";
import { V5_SECURITY_FORCE_TYPES, type CausalEventV5, type OrganizationV5, type OwnershipStakeV5 } from "../../src/core/v5/types.js";
import { SimulatorStore } from "../../src/persistence/sqlite-store.js";

describe("V5.4 SecurityForce Organization checkpoint integration", () => {
  it("rolls back every world's persisted year when any atomic-year write fails", () => {
    const directory = mkdtempSync(join(tmpdir(), "echoes-v54-atomic-persistence-"));
    const store = new SimulatorStore(join(directory, "fixture.sqlite"));
    const event: CausalEventV5 = { schemaVersion: "echoes-causal-event-v5", eventId: "ATOMIC_EVENT", worldKey: "CONCORD", year: 1, phase: "AUDIT", sequence: 0, eventType: "AtomicFixture", entityType: "WORLD", entityId: "CONCORD", causeEventIds: [], mechanicsVersion: V5_MECHANICS_VERSION, causalDerivationVersion: "echoes-derived-metrics-v1.1.0", keyedDecisionIdentity: null, mutations: [], payload: {} };
    try {
      store.createRun({ runId: "ATOMIC_PERSISTENCE", mode: "DIAGNOSTIC", status: "RUNNING", seed: "fixture", seedHash: "a".repeat(64), policyVersion: V5_MECHANICS_VERSION, currentYear: 0 });
      expect(() => store.withV5AtomicYearTransaction(() => { store.appendV5CausalEvents("ATOMIC_PERSISTENCE", [event]); store.setRunStatus("ATOMIC_PERSISTENCE", "RUNNING", 1); throw new Error("INJECTED_WORLD_WRITE_FAILURE"); })).toThrow(/INJECTED_WORLD_WRITE_FAILURE/);
      expect(store.v5EventCount("ATOMIC_PERSISTENCE")).toBe(0);
      expect(store.getRun("ATOMIC_PERSISTENCE")).toMatchObject({ status: "RUNNING", currentYear: 0 });
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("restores all seven force/Organization identities and control relationships from SQLite", () => {
    const canonical = loadBundledCanonicalV5(resolve("resources/canonical"));
    const ownerInputs = diagnosticCandidateOwnerInputsV1(Object.fromEntries(canonical.governments.map((government) => [government.governmentFormId, { source: "DIAGNOSTIC_CANDIDATE" }])));
    const boot = bootstrapWorldV5({ worldKey: "CONCORD", canonical, ownerInputs, variables: DEFAULT_MECHANICS_VARIABLES_V1, normalizedSeed: normalizeSeed("SECURITY_ORGANIZATION_INTEGRATION"), mode: "DIAGNOSTIC" }).state;
    const home = [...boot.settlements].sort((a, b) => a.settlementId.localeCompare(b.settlementId))[0]!;
    const parents: OrganizationV5[] = [
      { organizationId: "INTEGRATION_CORPORATION", type: "CORPORATION", sectorId: "MANUFACTURE", homeSettlementId: home.settlementId, founderControllerType: "STATE", founderControllerId: home.stateId, wealth: 800, influence: 700, status: "ACTIVE", belowSurvivalReviewCount: 0, formationYear: 0, dissolutionYear: null },
      { organizationId: "INTEGRATION_CRIME", type: "CRIME_ORGANIZATION", sectorId: "TRADE_AND_TRANSPORT", homeSettlementId: home.settlementId, founderControllerType: "FAMILY", founderControllerId: "INTEGRATION_FAMILY", wealth: 800, influence: 700, status: "ACTIVE", belowSurvivalReviewCount: 0, formationYear: 0, dissolutionYear: null },
      { organizationId: "INTEGRATION_GUILD", type: "GUILD", sectorId: "MANUFACTURE", homeSettlementId: home.settlementId, founderControllerType: "DIFFUSE", founderControllerId: "MEMBERS_INTEGRATION_GUILD", wealth: 800, influence: 700, status: "ACTIVE", belowSurvivalReviewCount: 0, formationYear: 0, dissolutionYear: null },
    ];
    const parentStakes: OwnershipStakeV5[] = parents.map((organization) => ({ stakeId: `STAKE_${organization.organizationId}`, organizationId: organization.organizationId, controllerType: organization.founderControllerType, controllerId: organization.founderControllerId, ownershipShareBps: 10_000, controlShareBps: 10_000, startYear: 0, endYear: null, sourceEventId: "INTEGRATION_FIXTURE" }));
    const prepared = { ...boot, year: 10, families: [{ familyId: "INTEGRATION_FAMILY", homeSettlementId: home.settlementId, founderBreedId: boot.cohorts.find((cohort) => cohort.settlementId === home.settlementId)!.breedId, factionAffinity: boot.states.find((state) => state.stateId === home.stateId)!.factionAffinity, wealth: 800 as const, influence: 700 as const, prestige: 600 as const, status: "ACTIVE" as const, foundingYear: 0, extinctionYear: null }], organizations: parents, ownershipStakes: parentStakes, institutions: [...boot.institutions, { institutionId: "INTEGRATION_MILITARY", stateId: home.stateId, institutionType: "MILITARY_SECURITY", jurisdictionSettlementId: home.settlementId, capacity: 800 as const, foundedYear: 0, dissolvedYear: null }, { institutionId: "INTEGRATION_FAITH", stateId: home.stateId, institutionType: "FAITH", jurisdictionSettlementId: home.settlementId, capacity: 800 as const, foundedYear: 0, dissolvedYear: null }] };
    const formed = updateCivicInstitutionsAndSecurityV5(prepared, { canonical, ownerInputs, mode: "DIAGNOSTIC" }).state;
    expect(new Set(formed.securityForces?.map((force) => force.forceType))).toEqual(new Set(V5_SECURITY_FORCE_TYPES));
    expect(() => validateSecurityForceOrganizationIntegrityV5(formed)).not.toThrow();

    const directory = mkdtempSync(join(tmpdir(), "echoes-v54-security-integrity-"));
    const store = new SimulatorStore(join(directory, "fixture.sqlite"));
    try {
      store.createRun({ runId: "SECURITY_ORGANIZATION_INTEGRATION", mode: "DIAGNOSTIC", status: "RUNNING", seed: "fixture", seedHash: "f".repeat(64), policyVersion: V5_MECHANICS_VERSION, currentYear: formed.year });
      const saved = store.saveV5Checkpoint("SECURITY_ORGANIZATION_INTEGRATION", formed, V5_EMPTY_EVENT_HISTORY_HASH);
      const restored = store.loadLatestV5Checkpoint("SECURITY_ORGANIZATION_INTEGRATION", "CONCORD", formed.year)!;
      expect(restored.stateHash).toBe(saved.stateHash);
      expect(restored.state.organizations.map((organization) => organization.organizationId)).toEqual(formed.organizations.map((organization) => organization.organizationId));
      expect(restored.state.securityForces?.map((force) => [force.securityForceId, force.organizationId])).toEqual(formed.securityForces?.map((force) => [force.securityForceId, force.organizationId]));
      expect(() => validateSecurityForceOrganizationIntegrityV5(restored.state)).not.toThrow();
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
