import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import { loadBundledCanonicalV5 } from "../core/v5/canonical-adapter.js";
import { DEFAULT_DIAGNOSTIC_CONFIG_V1, DEFAULT_MECHANICS_VARIABLES_V1, DEFAULT_OPERATIONAL_CONFIG_V1, V5_CAUSAL_DERIVATION_VERSION, V5_MECHANICS_VERSION, V5_READ_MODEL_VERSION, V5_SCHEDULER_VERSION, diagnosticCandidateOwnerInputsV1 } from "../core/v5/config.js";
import { causalEventHash, causalStateHash } from "../core/v5/engine.js";
import { buildPersistedNamingBatchesV5 } from "../core/v5/naming.js";
import { parseRouteClassificationAuthority, ROUTE_CLASSIFICATION_SCHEMA_VERSION } from "../core/v5/route-classification.js";
import { buildNonCausalRouteNamingRequests } from "../core/v5/routes.js";
import { continueV5History, runV5History } from "../core/v5/runner.js";
import { buildDiagnosticDjtPolicyV5, buildScheduledTransactionsV5, DJT_POLICY_KEY_V5 } from "../core/v5/schedule.js";
import type { CausalEventV5, WorldKey, WorldStateV5 } from "../core/v5/types.js";

const WORLDS: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];
const SEED = process.argv.slice(2).find((argument) => !argument.startsWith("--")) ?? "EIDOLON_V5_DIAGNOSTIC_1787843667789";
const YEARS = new Set([50, 89, 90, 274, 275, 280, 285]);
const canonical = loadBundledCanonicalV5(resolve("resources/canonical"));
const baseOwner = diagnosticCandidateOwnerInputsV1(Object.fromEntries(canonical.governments.map((government) => [government.governmentFormId, { source: "DIAGNOSTIC_CANDIDATE" }])));
const djtPolicy = buildDiagnosticDjtPolicyV5(canonical);
const owner = { ...baseOwner, canonicalPolicies: djtPolicy ? { ...baseOwner.canonicalPolicies, [DJT_POLICY_KEY_V5]: djtPolicy } : baseOwner.canonicalPolicies };
const scheduledTransactions = buildScheduledTransactionsV5(canonical, owner, SEED);
const snapshots = new Map<number, Record<WorldKey, WorldStateV5>>();
const result = runV5History({
  canonical, ownerInputs: owner, mechanics: DEFAULT_MECHANICS_VARIABLES_V1, operational: DEFAULT_OPERATIONAL_CONFIG_V1, diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1,
  normalizedSeed: SEED, mode: "DIAGNOSTIC", throughYear: 285, scheduledTransactions, stopAtBlockingNaming: false, interactiveNamingEnabled: false, retainHistory: true,
  onAtomicYear: (snapshot) => { if (YEARS.has(snapshot.year)) snapshots.set(snapshot.year, structuredClone(snapshot.states) as Record<WorldKey, WorldStateV5>); },
});
const activeInstitution = (state: WorldStateV5, type: string): Set<string> => new Set(state.institutions.filter((institution) => institution.institutionType === type && institution.foundedYear <= state.year && (institution.dissolvedYear === null || institution.dissolvedYear > state.year)).map((institution) => institution.institutionId));
const officesFor = (state: WorldStateV5, type: string) => { const ids = activeInstitution(state, type); return state.offices.filter((office) => ids.has(office.institutionId)); };
const activeTermsFor = (state: WorldStateV5, officeIds: ReadonlySet<string>) => state.officeTerms.filter((term) => officeIds.has(term.officeId) && term.startYear <= state.year && (term.endYear === null || term.endYear > state.year));
const chamberSelectionEvents = (events: readonly CausalEventV5[]) => events.filter((event) => event.eventType === "OfficeholderSelected" && (String(event.entityId).startsWith("CONCLAVE_") || String(event.entityId).startsWith("SENATE_")));

const assertions: Record<WorldKey, Record<string, boolean>> = {} as Record<WorldKey, Record<string, boolean>>;
const evidence: Record<WorldKey, unknown> = {} as Record<WorldKey, unknown>;
for (const world of WORLDS) {
  const at50 = snapshots.get(50)![world]; const at89 = snapshots.get(89)![world]; const at90 = snapshots.get(90)![world];
  const at274 = snapshots.get(274)![world]; const at275 = snapshots.get(275)![world]; const at280 = snapshots.get(280)![world]; const at285 = snapshots.get(285)![world];
  const pre50 = officesFor(at50, "CONCLAVE_PRE90"); const pre89 = officesFor(at89, "CONCLAVE_PRE90"); const post90 = officesFor(at90, "CONCLAVE_POST90");
  const senate274 = officesFor(at274, "SENATE"); const senate275 = officesFor(at275, "SENATE"); const senate280 = officesFor(at280, "SENATE"); const senate285 = officesFor(at285, "SENATE");
  const a275 = senate275.filter((office) => office.titleKey === "SENATE_SEAT_A"); const a280 = senate280.filter((office) => office.titleKey === "SENATE_SEAT_A"); const b280 = senate280.filter((office) => office.titleKey === "SENATE_SEAT_B"); const a285 = senate285.filter((office) => office.titleKey === "SENATE_SEAT_A"); const b285 = senate285.filter((office) => office.titleKey === "SENATE_SEAT_B");
  const allChamberEvents = chamberSelectionEvents(result.events[world]);
  const stablePeople = new Set(at285.politicalPeople.map((person) => person.personId));
  assertions[world] = {
    year50ConclaveOneSeatPerSettlement: pre50.length === at50.settlements.length,
    year50ConclavePopulated: activeTermsFor(at50, new Set(pre50.map((office) => office.officeId))).length === pre50.length,
    year89PreReformStillApplies: pre89.length === at89.settlements.length && pre89.length === 72,
    year90PostReformThreePerState: post90.length === at90.states.length * 3 && post90.length === 72,
    year90PreReformInstitutionsDissolved: at90.institutions.filter((institution) => institution.institutionType === "CONCLAVE_PRE90").every((institution) => institution.dissolvedYear === 90),
    year274NoSenate: senate274.length === 0,
    year275SeatA: a275.length === at275.states.length && activeTermsFor(at275, new Set(a275.map((office) => office.officeId))).every((term) => term.startYear === 275 && term.endYear === 285),
    year280SeatB: b280.length === at280.states.length && activeTermsFor(at280, new Set(b280.map((office) => office.officeId))).every((term) => term.startYear === 280 && term.endYear === 290),
    year280SeatARemainsStaggered: activeTermsFor(at280, new Set(a280.map((office) => office.officeId))).every((term) => term.startYear === 275 && term.endYear === 285),
    year285SeatARenewed: activeTermsFor(at285, new Set(a285.map((office) => office.officeId))).every((term) => term.startYear === 285 && term.endYear === 295),
    year285SeatBRemainsStaggered: activeTermsFor(at285, new Set(b285.map((office) => office.officeId))).every((term) => term.startYear === 280 && term.endYear === 290),
    immutableSelectionEvidence: allChamberEvents.length > 0 && allChamberEvents.every((event) => {
      const payload = event.payload as Record<string, unknown>;
      return Boolean(payload.appliedSelectionRule && payload.sourceGovernmentFormId && payload.sourceGovernmentOfficeId && payload.selectorType && payload.selectedPersonId && payload.officeTermId);
    }),
    holdersAreStablePoliticalPeople: activeTermsFor(at285, new Set([...officesFor(at285, "CONCLAVE_POST90"), ...senate285].map((office) => office.officeId))).every((term) => stablePeople.has(term.personId)),
  };
  evidence[world] = { year50: { settlements: at50.settlements.length, seats: pre50.length }, year89: { settlements: at89.settlements.length, seats: pre89.length }, year90: { states: at90.states.length, seats: post90.length }, year274: { senateSeats: senate274.length }, year275: { senateA: a275.length }, year280: { senateA: a280.length, senateB: b280.length }, year285: { senateA: a285.length, senateB: b285.length }, chamberSelectionEvents: allChamberEvents.length, politicalPeople: at285.politicalPeople.length };
}

const splitStates = snapshots.get(90)!;
const split = continueV5History({
  canonical, ownerInputs: owner, mechanics: DEFAULT_MECHANICS_VARIABLES_V1, operational: DEFAULT_OPERATIONAL_CONFIG_V1, diagnostic: DEFAULT_DIAGNOSTIC_CONFIG_V1,
  normalizedSeed: SEED, mode: "DIAGNOSTIC", throughYear: 285, scheduledTransactions, initialStates: structuredClone(splitStates),
  initialEventCounts: Object.fromEntries(WORLDS.map((world) => [world, result.events[world].filter((event) => event.year <= 90).length])),
  stopAtBlockingNaming: false, interactiveNamingEnabled: false, retainHistory: true,
});
const replayAssertions = Object.fromEntries(WORLDS.map((world) => [world, {
  stateHashEquivalent: causalStateHash(split.states[world]) === causalStateHash(result.states[world]),
  post90EventHashEquivalent: causalEventHash(split.events[world]) === causalEventHash(result.events[world].filter((event) => event.year > 90)),
}])) as unknown as Record<WorldKey, Record<string, boolean>>;

const finalStatesBeforeRouteOverlay = Object.fromEntries(WORLDS.map((world) => [world, causalStateHash(result.states[world])])) as Record<WorldKey, string>;
const activeCorridor = canonical.routeCorridors.find((corridor) => WORLDS.every((world) => result.states[world].worldRoutes.some((route) => route.corridorId === corridor.corridorId)))!;
const classification = parseRouteClassificationAuthority({
  schemaVersion: ROUTE_CLASSIFICATION_SCHEMA_VERSION, authorityVersion: "prompt01-single-route-test-v1", authorityStatus: "OWNER_APPROVED_NONCAUSAL_OVERLAY", approvedAt: "2026-08-27T00:00:00Z",
  classifications: [{ corridorId: activeCorridor.corridorId, ownerDecisionStatus: "OWNER_VALUES", ownerPrimaryMode: "PORTAL_ONLY", ownerInfrastructureClass: "PORTAL_ONLY", ownerPortalCapability: true, ownerTradeDesignation: false, ownerEvidenceRef: "PROMPT01_ACCEPTANCE_FIXTURE" }],
}, new Set(canonical.routeCorridors.map((corridor) => corridor.corridorId)));
const overlayRequests = WORLDS.flatMap((world) => buildNonCausalRouteNamingRequests(result.states[world], canonical, classification, owner, DEFAULT_MECHANICS_VARIABLES_V1));
const overlayBatches = buildPersistedNamingBatchesV5("PROMPT01_TEMPORARY_RUN", overlayRequests, 50, overlayRequests);
const routeAssertions = {
  allThirtyEightPersistedRoutesRemainUnresolved: WORLDS.every((world) => result.states[world].worldRoutes.every((route) => route.primaryMode === "UNRESOLVED" && route.infrastructureClass === "UNRESOLVED")),
  oneApprovedCorridorOnly: classification.classifications.length === 1,
  exactlyOneRequestPerWorld: overlayRequests.length === 3 && WORLDS.every((world) => overlayRequests.filter((request) => request.worldKey === world).length === 1),
  portalOnlyIsBatchedAndNameable: overlayRequests.every((request) => request.behavior === "BATCHED" && request.context?.effectivePrimaryMode === "NONE" && request.context?.effectiveInfrastructureClass === "NONE"),
  comparisonAwareByCorridor: overlayRequests.every((request) => request.namingComparisonGroupId === `WORLD_ROUTE:${activeCorridor.corridorId}`),
  immutableBatchCreated: overlayBatches.length === 1 && overlayBatches[0]!.items.length === 3,
  noAcceptedLabels: overlayRequests.every((request) => request.acceptedLabel === null),
  causalStateUnchanged: WORLDS.every((world) => causalStateHash(result.states[world]) === finalStatesBeforeRouteOverlay[world]),
};

const pass = [...WORLDS.flatMap((world) => Object.values(assertions[world])), ...WORLDS.flatMap((world) => Object.values(replayAssertions[world])), ...Object.values(routeAssertions)].every(Boolean);
const report = {
  schemaVersion: "echoes-v5-prompt01-acceptance-v1", seed: SEED, schedulerVersion: V5_SCHEDULER_VERSION, mechanicsVersion: V5_MECHANICS_VERSION,
  causalDerivationVersion: V5_CAUSAL_DERIVATION_VERSION, readModelVersion: V5_READ_MODEL_VERSION, canonicalBundleHash: canonical.canonicalBundleHash,
  completedYear: result.completedYear, worlds: evidence, assertions, replayAssertions, routeOverlay: { approvedCorridorId: activeCorridor.corridorId, authorityVersion: classification.authorityVersion, requestIds: overlayRequests.map((request) => request.requestId), batchIds: overlayBatches.map((batch) => batch.batchId), assertions: routeAssertions }, pass,
};
writeFileSync(resolve("artifacts/simulator/v5/remediation/prompt01-acceptance.json"), `${canonicalJson(report)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ pass, completedYear: result.completedYear, report: resolve("artifacts/simulator/v5/remediation/prompt01-acceptance.json"), assertions: WORLDS.reduce((sum, world) => sum + Object.keys(assertions[world]).length, 0) + Object.keys(routeAssertions).length + WORLDS.reduce((sum, world) => sum + Object.keys(replayAssertions[world]).length, 0) })}\n`);
if (!pass) process.exitCode = 1;
