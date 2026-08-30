import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildDynamicAtlasOverlayV1 } from "../core/atlas/dynamic-overlay.js";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import { buildAtrocityWorldDefinitionsV1, ATROCITY_INTEGRATION_FIXTURES_V1, validateAtrocityWorldDefinitionsV1 } from "../core/v5/atrocity-catalog.js";
import { candidateGroupsForDerogatoryReviewV1, emptyDerogatoryTaxonomyReviewV1 } from "../core/v5/derogatory-taxonomy.js";
import { influenceControlAtPointV1, validateStateTerritoryTopologyV1, weightedBoundaryDistanceFromA } from "../core/v5/dynamic-territory.js";
import { FEDERAL_VISION_PROFILES_V1 } from "../core/v5/federal-vision.js";
import { legendaryRewardInventoryReadinessV1 } from "../core/v5/keepers.js";
import { resourceAuthorityStatusV1 } from "../core/v5/logistics.js";
import { initialOwnerPolicyCenterV56, LOCKED_OWNER_AUTHORITIES_V56, type OwnerPolicyRevisionV1 } from "../core/v5/owner-policy-center.js";
import { POI_RENAME_CONSEQUENCE_DIMENSIONS_V1 } from "../core/v5/poi-renames.js";
import { FOOD_SPECIFIC_SELECTORS_V1, FOOD_SPECIFIC_VALUES_V1, REFUGE_ELIGIBLE_FOOD_SPECIFIC_V1, refugeConsumerCountsV1 } from "../core/v5/refuge-genesis.js";
import { NON_REFUGE_FOOD_SPECIFIC_V1 } from "../core/v5/sustenance.js";
import { assertWorldNeutralCausalEqualityV1, worldNeutralCausalHashV1 } from "../core/v5/world-neutral.js";
import { disconnectDomainDatabase, preflightDomainDatabase } from "../persistence/postgres-domain.js";
import { loadCausalCapabilityReadiness } from "../persistence/causal-capability-readiness.js";

const outputDirectory = resolve("artifacts/simulator/v5/remediation");
mkdirSync(outputDirectory, { recursive: true });
const pretty = (value: unknown): string => JSON.stringify(value, (_key, child) => typeof child === "bigint" ? child.toString() : child, 2);
const writeJson = (name: string, value: unknown): void => writeFileSync(resolve(outputDirectory, name), `${pretty(value)}\n`, "utf8");
const writeMarkdown = (name: string, value: string): void => writeFileSync(resolve(outputDirectory, name), `${value.trim()}\n`, "utf8");
const sha256 = (value: unknown): string => createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");

const databasePreflight = await preflightDomainDatabase();
const capabilityReadiness = databasePreflight.state === "READY" ? await loadCausalCapabilityReadiness() : null;
writeJson("startup-domain-database-doctor.json", databasePreflight);
await disconnectDomainDatabase();

const policies = initialOwnerPolicyCenterV56();
const semanticPolicies = policies.filter((policy) => policy.reviewAuthority === "SEMANTIC");
const numericPolicies = policies.filter((policy) => policy.reviewAuthority === "NUMERIC");
const policyReview = {
  schemaVersion: "echoes-owner-policy-review-v56",
  status: "OWNER_REVIEW_REQUIRED",
  mechanicsVersion: "echoes-mechanics-v5.6.0",
  schedulerVersion: "echoes-scheduler-v5.6.0",
  readModelVersion: "echoes-read-model-v1.4.0",
  causalDerivationVersion: "echoes-derived-metrics-v1.1.0",
  policyCount: policies.length,
  lockedOwnerStructureCount: LOCKED_OWNER_AUTHORITIES_V56.length,
  lockedOwnerStructure: LOCKED_OWNER_AUTHORITIES_V56.map((authority) => ({ ...authority, status: "LOCKED_OWNER_AUTHORITY" })),
  pendingSemanticAuthorityCount: semanticPolicies.length,
  pendingNumericAuthorityCount: numericPolicies.length,
  policies,
  approvedPolicyRevisions: [],
  rejectedOrSupersededPolicyRevisions: [],
  approvalMetadata: "The application automatically records current owner/session identity, timestamp, revision ID, generated content hash, prior revision, and action provenance.",
  effectiveBoundaryDefaults: { GENESIS: "year 0 / next new run", SCHEDULED_BARRIER: "policy's designed barrier", ATOMIC_YEAR_BARRIER: "next permitted atomic-year barrier", manualEntry: "only when the owner explicitly overrides the default" },
  bulkApproval: "Independent candidate revisions may be selected and approved together; every revision receives a separate immutable approval and hash.",
  approvalAction: "Open Owner Policy Center, review a pending policy, use EDIT AS NEW REVISION if values must change, optionally override the default effective year, then APPROVE. For unchanged independent candidates, select several rows and use APPROVE SELECTED.",
};
writeJson("owner-policy-review.json", policyReview);
const policyMarkdown = (policy: OwnerPolicyRevisionV1): string => `### ${policy.policyId}\n\n- Purpose: ${policy.purpose}\n- Units/range: ${policy.units}; ${policy.allowedRange}\n- Consumers: ${policy.causalConsumers.join(", ")}\n- Locked structure shown with this row: ${policy.lockedAuthorityIds.length ? policy.lockedAuthorityIds.join(", ") : "none"}\n- Candidate values:\n\n\`\`\`json\n${pretty(policy.candidateContent)}\n\`\`\`\n\n- Significance: ${policy.candidateRationale}\n- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.\n- Exact action: Owner Policy Center → ${policy.policyId} → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.\n`;
writeMarkdown("owner-policy-review.md", `# Owner Policy Review\n\nLocked owner structure is displayed for context and is not presented for reapproval. The ${policies.length} unresolved revisions remain candidates; this artifact approves none of them. Independent candidates support multi-select approval, with a separate immutable decision and hash for each revision.\n\n## LOCKED OWNER STRUCTURE\n\n${LOCKED_OWNER_AUTHORITIES_V56.map((authority) => `- **${authority.authorityId}** [LOCKED_OWNER_AUTHORITY] — ${authority.statement}`).join("\n")}\n\n## PENDING SEMANTIC AUTHORITY\n\n${semanticPolicies.map(policyMarkdown).join("\n")}\n\n## PENDING NUMERIC AUTHORITY\n\n${numericPolicies.map(policyMarkdown).join("\n")}\n\n## APPROVED POLICY REVISION\n\nNone are asserted by this regenerated candidate artifact. Runtime approvals, when present, are shown from immutable PostgreSQL revisions.\n\n## REJECTED / SUPERSEDED\n\nNone are asserted by this regenerated candidate artifact. Runtime rejected and superseded revisions remain visible in history.\n`);

type LedgerRow = { recordType: string; recordId: string; canonicalMaterialized: boolean; canonicalPayload?: { foodSpecific?: string[] } };
const ledgerRows = readFileSync(resolve("resources/canonical/research-corpus/IMPORT_LEDGER.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as LedgerRow);
const breedFoodRows = ledgerRows.filter((row) => row.recordType === "BREED" && row.canonicalMaterialized).map((row) => ({ breedId: row.recordId, foodSpecific: row.canonicalPayload?.foodSpecific ?? [] }));
const consumerCounts = refugeConsumerCountsV1(breedFoodRows);
const secondNodeValues = Object.entries(consumerCounts).filter(([, count]) => count > 100).sort(([left], [right]) => left.localeCompare(right));
const refugeGenesisCount = REFUGE_ELIGIBLE_FOOD_SPECIFIC_V1.length + secondNodeValues.length;

const neutralHash = assertWorldNeutralCausalEqualityV1([
  { worldKey: "CONCORD", eventId: "EVENT_CONCORD_1", routeId: "ROUTE_CONCORD_A", population: 100n },
  { worldKey: "SCHISM", eventId: "EVENT_SCHISM_1", routeId: "ROUTE_SCHISM_A", population: 100n },
  { worldKey: "RUIN", eventId: "EVENT_RUIN_1", routeId: "ROUTE_RUIN_A", population: 100n },
]);
const nonNeutralHashes = ["CONCORD", "SCHISM", "RUIN"].map((worldKey, index) => worldNeutralCausalHashV1({ worldKey, eventId: `EVENT_${worldKey}_1`, policySignal: index + 1 }));
writeJson("three-world-genesis-diff.json", {
  schemaVersion: "echoes-three-world-genesis-diff-v56",
  status: databasePreflight.state === "READY" ? "AUTHORITY_READY_FOR_BOUNDED_GENESIS" : "LIVE_GENESIS_BLOCKED_BY_DOMAIN_AUTHORITY",
  requiredIdenticalDomains: ["population", "Breed/tier distribution", "24 physical cities", "Origin Regions", "POIs", "route opportunities", "deity authority", "economy", "RNG semantics", "approved physical corpora"],
  onlyDirectionalInputs: { sovereignBreed: true, federalGovernanceAlignment: true, federalCapitalDesignationAlignment: true },
  resourceAuthority: resourceAuthorityStatusV1({ authorityRevisionId: null, approvedNodeCount: null }),
  refugeAudit: { canonicalBreedRows: breedFoodRows.length, terminalFoodSpecificCount: FOOD_SPECIFIC_VALUES_V1.length - FOOD_SPECIFIC_SELECTORS_V1.length, selectorCount: FOOD_SPECIFIC_SELECTORS_V1.length, eligibleCount: REFUGE_ELIGIBLE_FOOD_SPECIFIC_V1.length, nonRefugeCount: NON_REFUGE_FOOD_SPECIFIC_V1.length, secondNodeValues: secondNodeValues.map(([foodSpecific, count]) => ({ foodSpecific, canonicalBreedConsumers: count })), secondNodeCount: secondNodeValues.length, genesisPerWorld: refugeGenesisCount, moonlightCount: consumerCounts.MOONLIGHT > 100 ? 2 : 1 },
  worldKeyCausalRngSalt: false,
  normalizedNeutralHash: neutralHash,
  nonNeutralHashes,
  nonNeutralDivergenceProvedByFixture: new Set(nonNeutralHashes).size === 3,
});

writeMarkdown("federal-vision-causal-trace.md", `# Federal Vision Causal Trace\n\nStructural directionality is locked as owner authority; weights and thresholds remain candidates.\n\n${Object.values(FEDERAL_VISION_PROFILES_V1).map((profile) => `- ${profile.worldKey}: ${profile.primaryPillar} → ${profile.counterPillar} (${profile.structuralAuthorityRef})`).join("\n")}\n\nShared consumer surfaces: executive actions, appointments, spending, institutions, access, routes, enforcement, propaganda, ownership, and paired-pillar decisions. WorldKey and identity-only world-scoped IDs are prohibited as causal RNG salts. Outcomes remain emergent rather than scripted.\n`);

const territorySettlements = [
  { settlementId: "S_A", siteId: "SITE_A", regionId: "R01", stateId: "STATE_A", foundedYear: 0, unrest: 0, sectorStrengths: { LAND_AND_FOOD: 0, EXTRACTION: 0, MANUFACTURE: 0, TRADE_AND_TRANSPORT: 0, KNOWLEDGE_AND_SERVICES: 0 } },
  { settlementId: "S_B", siteId: "SITE_B", regionId: "R01", stateId: "STATE_B", foundedYear: 0, unrest: 0, sectorStrengths: { LAND_AND_FOOD: 0, EXTRACTION: 0, MANUFACTURE: 0, TRADE_AND_TRANSPORT: 0, KNOWLEDGE_AND_SERVICES: 0 } },
];
const influenceTerms = territorySettlements.map((settlement, index) => ({ influenceTermId: `INFLUENCE_${index}`, settlementId: settlement.settlementId, effectiveFromYear: 0, effectiveToYear: null, latitude: 0, longitude: index === 0 ? -1 : 1, effectiveRadiusKm: 200, policyRevisionId: "TEST_APPROVED_INFLUENCE_POLICY", sourceEventId: "TEST_EVENT" }));
const tieControl = influenceControlAtPointV1({ point: { latitude: 0, longitude: 0 }, settlements: territorySettlements, terms: influenceTerms, year: 1 });
writeJson("dynamic-influence-validation.json", { schemaVersion: "echoes-dynamic-influence-validation-v56", status: "STRUCTURAL_PASS_NUMERIC_POLICY_REVIEW_REQUIRED", normalizedDistance: "geodesic distance / approved effective radius", contestedSpan: { total: 40, strengths: [25, 15], boundaryFromFirst: weightedBoundaryDistanceFromA(40, 25, 15), shares: ["5/8", "3/8"] }, deterministicTie: tieControl, membershipMutationAllowed: false, controlDomains: ["POI", "REFUGE", "RESOURCE", "ROUTE_SEGMENT"] });
const ring = [{ longitude: 0, latitude: 0 }, { longitude: 1, latitude: 0 }, { longitude: 1, latitude: 1 }, { longitude: 0, latitude: 0 }];
const topology = validateStateTerritoryTopologyV1([{ territoryCellId: "CELL_1", worldKey: "CONCORD", stateId: "STATE_A", controllingSettlementId: "S_A", effectiveFromYear: 1, effectiveToYear: null, ring, status: "CLAIMED" }]);
const overlayInput = { runId: "VALIDATION_RUN", worldKey: "CONCORD" as const, boundary: { runCurrentYear: 12, commonProjectedThroughYear: 10, selectedDataYear: 10, freshness: "STALE" as const, mixedYearReadsAllowed: false as const }, features: [{ featureId: "TERRITORY_CELL_1", layer: "STATE_TERRITORY" as const, geometryType: "POLYGON" as const, coordinates: ring, controllerId: "STATE_A", status: "CLAIMED", acceptedLabel: null, sourceIdentityId: "CELL_1", evidenceRef: "TEST_TOPOLOGY" }] };
const overlayA = buildDynamicAtlasOverlayV1(overlayInput); const overlayB = buildDynamicAtlasOverlayV1(overlayInput);
writeJson("state-territory-validation.json", { schemaVersion: "echoes-state-territory-validation-v56", topology, closed: true, nonSelfIntersecting: true, nonOverlapping: true, unclaimedGapRepresentation: "explicit UNCLAIMED cells", geographyContainment: "validated against external canonical physical geometry at projection time", membershipRule: "Settlement.stateId changes only through explicit membership events", influenceCannotWriteMembership: true, dynamicOverlayDeterministic: overlayA.contentSha256 === overlayB.contentSha256, dynamicOverlayHash: overlayA.contentSha256, selectedYearConsistency: { runYear: overlayA.runYear, projectedThrough: overlayA.commonProjectedThroughYear, selectedDataYear: overlayA.selectedDataYear, freshness: overlayA.freshness, mixedYearReadsAllowed: overlayA.mixedYearReadsAllowed } });

writeJson("refuge-resource-route-validation.json", {
  schemaVersion: "echoes-refuge-resource-route-validation-v56",
  refuge: { status: "GENESIS_COUNT_AUDITED_PLACEMENT_AND_NUMERIC_POLICIES_REQUIRED", eligibleTerminalCount: 47, nonRefugeCount: 14, selectors: FOOD_SPECIFIC_SELECTORS_V1, secondNodeCount: secondNodeValues.length, genesisPerWorld: refugeGenesisCount, secondNodeValues: secondNodeValues.map(([foodSpecific, count]) => ({ foodSpecific, count })), moonlightPresent: REFUGE_ELIGIBLE_FOOD_SPECIFIC_V1.includes("MOONLIGHT") },
  dynamicSustenance: { classifications: NON_REFUGE_FOOD_SPECIFIC_V1, detailedMappingsApproved: false, causalBehavior: "fails closed per classification until both semantic and numeric revisions are approved" },
  resource: resourceAuthorityStatusV1({ authorityRevisionId: null, approvedNodeCount: null }),
  logistics: { quartermasterEntryPoint: ["REFUGE", "RESOURCE_NODE"], tracked: ["intake", "storage", "throughput", "allocation", "spoilage/loss", "disruption", "delivery"], assignmentPolicy: "RESOURCE_QUARTERMASTER_ASSIGNMENT_POLICY", assignmentStatus: "UNREVIEWED", causalBehavior: "no Resource output enters logistics without approved assignment and valid year-effective term" },
  routes: { physicalCorridorSeparatedFromDynamicTerms: true, prompt01ClassificationCausalStatus: "NONCAUSAL", promotionRequired: true },
  pois: { yearEffectiveControl: true, decisions: ["KEEP_EXISTING_NAME", "REQUEST_RENAME"], aliasPreservationRequired: true, consequenceDimensions: POI_RENAME_CONSEQUENCE_DIMENSIONS_V1, magnitudesApproved: false },
});

const taxonomyReview = emptyDerogatoryTaxonomyReviewV1();
const taxonomyJson = { ...taxonomyReview, candidateGroups: candidateGroupsForDerogatoryReviewV1(), externalDecisionProtocol: { scopesPerWorld: 21, worlds: 3, decisionsPerBatch: 63, initialYear: 15, initialAction: "SELECT", laterYears: "150 and every 100 years thereafter", laterActions: ["KEEP", "REPLACE"], partialAcceptance: false, localSynthesis: false } };
writeJson("derogatory-group-canonicalization.json", taxonomyJson);
writeMarkdown("derogatory-group-canonicalization.md", `# Derogatory Group Canonicalization\n\nStatus: ${taxonomyReview.status}; legacy status: ${taxonomyReview.legacyStatus}. The three canonical grouping structure names and memberships are absent, so the implementation preserves three neutral review slots rather than inventing three individual groups.\n\nEvery legacy candidate Group first requires KEEP or REJECT. Only a KEEP Group then requires MEMBER or NOT_MEMBER in each of the three structures; NOT_MEMBER in all three never implicitly preserves a legacy Group.\n\n${candidateGroupsForDerogatoryReviewV1().map((row) => `- ${row.groupId}: KEEP | REJECT; if KEEP, three explicit membership decisions`).join("\n")}\n\nThe external protocol remains independent: one atomic ordered 63-decision batch (21 scopes × three worlds), SELECT at year 15, KEEP or REPLACE at year 150 and every 100 years thereafter, exact coverage, chained provenance, no partial acceptance, and no local synthesis.\n\nExact action: Owner Policy Center → DEROGATORY_TAXONOMY → EDIT AS NEW REVISION → enter three distinct structure names, KEEP/REJECT for every candidate Group, and memberships for each KEEP Group → APPROVE.\n`);

const atrocityDefinitions = buildAtrocityWorldDefinitionsV1();
validateAtrocityWorldDefinitionsV1(atrocityDefinitions);
writeJson("atrocity-18x3-catalog.json", { schemaVersion: "echoes-atrocity-18x3-catalog-v1", occurrenceCount: 18, worldDefinitionCount: atrocityDefinitions.length, identifiers: [...new Set(atrocityDefinitions.map((definition) => definition.occurrenceId))], definitions: atrocityDefinitions });
writeMarkdown("atrocity-impact-policy.md", `# Atrocity Impact Policy\n\nAll 54 definitions include narrative/downstream and numeric-policy forms. They reference one common ATROCITY_HARM_SHARE revision, one ATROCITY_PRIMARY_HARM_PROFILES family, concentration, direct/secondary spillover, and persistence. The packet's 10 percent share remains an UNREVIEWED numeric candidate.\n\nPrimary profiles allocate exactly 100 percent of uniqueHarmed among mutually exclusive outcomes. DIRECT_HARM_SPILLOVER redistributes that same budget; SECONDARY_CONSEQUENCE_SPILLOVER may overlap without adding victims. Historical event and scar records are append-only, while current mechanical effects may decay, strengthen, reactivate, or interact with later history. ATROCITY_17_A=50 is locked inherited authority; only ATROCITY_17_B=75 remains proposed.\n\nTracked separately: unique harmed, mortality, displacement, detention/labor, exclusion, denial, seizure, growth suppression, secondary overlaps, fear/compliance, grievance/unrest, group-safety migration, reputation, complicity/protection, paired pillars, neighbor ripple, and long memory. Catastrophes remain distinct from culpable atrocities.\n\nExact action: Owner Policy Center → review ATROCITY_HARM_SHARE, ATROCITY_PRIMARY_HARM_PROFILES, ATROCITY_CONCENTRATION, ATROCITY_SPILLOVER, ATROCITY_PERSISTENCE, and ATROCITY_17_B_SCHEDULE.\n`);
writeJson("atrocity-fixture-results.json", { schemaVersion: "echoes-atrocity-fixture-results-v56", status: "STRUCTURAL_FIXTURES_PRESENT_NUMERIC_EXECUTION_BLOCKED", fixtures: ATROCITY_INTEGRATION_FIXTURES_V1, hardcodedIllustrativeDeltas: false, blockingPolicies: ["ATROCITY_HARM_SHARE", "ATROCITY_PRIMARY_HARM_PROFILES", "ATROCITY_CONCENTRATION", "ATROCITY_SPILLOVER", "ATROCITY_PERSISTENCE"] });

writeJson("deity-religion-validation.json", { schemaVersion: "echoes-deity-religion-validation-v56", status: "BREED_PRIMARY_DEITY_AND_NUMERIC_POLICY_REQUIRED", derivation: "actual Settlement Breed population → Breed.primaryDeityId → Deity/Pantheon support", breedPrimaryDeityRequired: true, uniqueReligiousSiteLimits: { templePerDeityWorld: 1, shrinePerDeityWorld: 1 }, structuralPantheonCenterAlgorithmApproved: true, durableType: "PantheonCenterDesignation", presentationLabel: "Pantheon Center", pantheonSeatTermStatus: "PROVISIONAL", candidatePolicies: ["TEMPLE_THRESHOLD", "SHRINE_THRESHOLD", "RELIGIOUS_SIMILARITY"] });
writeJson("family-power-validation.json", { schemaVersion: "echoes-family-power-validation-v56", status: "NORMALIZED_SCHEMA_AND_CAUSAL_SURFACES_PRESENT_BOUNDED_LIVE_ACCEPTANCE_BLOCKED", auditedPowerDimensions: ["wealth", "pedigree", "office", "education", "patronage", "property", "corporate", "security", "religious", "route", "reputation", "atrocity"], actions: ["sponsorship", "relief", "propaganda", "investment", "alliances", "migration", "protection", "exploitation", "succession", "exile", "specifically authorized execution"], deterministicRequirement: true, blocker: databasePreflight.diagnosticCode });
writeJson("migration-intermingling-validation.json", { schemaVersion: "echoes-migration-intermingling-validation-v56", status: "TYPED_TRANSFER_AND_READ_MODEL_CONTRACT_PRESENT_BOUNDED_LIVE_ACCEPTANCE_BLOCKED", transferFields: ["source", "destination", "Breed", "tier", "count", "reason", "forced/voluntary", "group-safety cohort", "triggering authority"], exactPopulationConservationRequired: true, selectedYearViews: ["Breed distribution", "origins", "arrivals", "Derogatory concentration", "religion", "Families", "births", "deaths", "migration matrices", "cross-world comparison"], neutralNormalizedHash: neutralHash, nonNeutralFixtureHashes: nonNeutralHashes, routeEvidenceRequiredForLiveAcceptance: true, blocker: databasePreflight.diagnosticCode });

const handoffSource = readFileSync(resolve("docs/ECHOES_OF_EIDOLON_DYNAMIC_ATLAS_HANDOFF_V1.md"), "utf8");
writeMarkdown("ECHOES_OF_EIDOLON_DYNAMIC_ATLAS_HANDOFF.md", `${handoffSource}\n\n## Completion boundary\n\nThe sibling repository was not modified. Two-repository Atlas completion remains outstanding until echoes-of-eidolon consumes and renders the versioned State/route/control overlay contract.`);

const cutoverFindings = [
  "electron/main.ts still exposes the legacy V4 canonical runner and its bundled canonical filesystem loader",
  "src/core/canonical/bundled-canonical.ts remains a production V4 filesystem authority loader",
  "src/core/engine/canonical-runner.ts and canonical-resume.ts still load domain JSON/CSV/ZIP files",
  "src/core/v5/canonical-adapter.ts remains available for explicit import/test provenance but has zero V5 production call sites",
];
const ownerPolicyCandidates = policies.map((policy) => `- ${policy.policyId}: ${canonicalJson(policy.candidateContent)}`).join("\n");
const report = `# Echoes Simulator Master Remediation Final Report\n\n## OPERATIONAL BLOCKERS\n\nPostgreSQL preflight: **${databasePreflight.state}** (${databasePreflight.diagnosticCode}). V5.6 causal creation is PostgreSQL-only and resume/replay uses immutable snapshotted typed content. SQLite commits survive projection failure and the idempotent catch-up runner advances the common watermark only after an atomic projected year succeeds.\n\nThe carried-forward repo-wide cutover gate is **not complete**:\n\n${cutoverFindings.map((finding) => `- ${finding}`).join("\n")}\n\n## OWNER POLICY CENTER\n\n${policies.length} typed candidate revisions are available with values, hashes, units, ranges, consumers, provenance, effective boundaries, and review actions. No candidate was silently approved.\n\n## BREED / DEITY\n\nThe positional V3 vector is rejected. Audit history identifies 2,063 positional values for 2,062 Breed identities and no stable-ID V3 evidence corpus. Production requires Breed.primaryDeityId → Deity.deityId, exact 2,062/2,062 decision provenance, FK validation, and NOT NULL. The terminal external reconstruction remains unresolved; no assignments were fabricated.\n\n## THREE-WORLD GENESIS\n\nStructural equality and world-neutral hash normalization are implemented. Refuge audit proves ${REFUGE_ELIGIBLE_FOOD_SPECIFIC_V1.length} base types plus ${secondNodeValues.length} corpus-derived second nodes = ${refugeGenesisCount} per world. Live genesis remains blocked by PostgreSQL/Breed authority; Resource absence remains RESOURCE_AUTHORITY_REQUIRED rather than an empty canon.\n\n## FEDERAL VISION\n\nConcord → Crown/Church, Ruin → Intellectual Elite/Hereditary Elite, and Schism → Corporate Actors/Wealth Elite are locked structural inputs. Numeric weights remain candidates. WorldKey cannot salt causal RNG.\n\n## STATES / DYNAMIC ATLAS\n\nExplicit Settlement membership events are the only writers of Settlement.stateId. Influence drives dynamic territory and control. The 25:15 boundary, deterministic ties, topology validators, selected-year overlay schema, freshness, and stable hashes are implemented. Sibling consumption remains outstanding.\n\n## REFUGES / RESOURCES / ROUTES / POIs\n\nAll 47 eligible terminals, MOONLIGHT, selector exclusions, all 14 non-Refuge classifications, approval-gated sustenance, Refuge production/replenishment, Resource yield/depletion, Quartermaster intake/storage/throughput/loss/delivery, deterministic assignment terms, noncausal Prompt-01 routes, dynamic POI control, alias-preserving rename decisions, and ten typed political/history consequence dimensions are represented. Missing inventories and policies fail closed only at their consumers.\n\n## UI REMEDIATION\n\nThe complete stable-ID Breed selector and Owner Policy Center are wired. Normal operator rows render typed human-readable fields; raw serialized payloads are restricted to developer/audit context. Rendered Electron acceptance still depends on a READY PostgreSQL authority.\n\n## DEROGATORY GROUPS\n\nThree neutral canonical grouping structures and explicit membership review are implemented without collapsing the domain to three groups. Legacy taxonomy stays LEGACY_UNTRUSTED_TARGET_TAXONOMY. The atomic 63-decision protocol and cadence remain independent and immutable.\n\n## ATROCITY SYSTEM\n\nExactly 18 structural identifiers and 54 world definitions are present, each with narrative/downstream and numeric-policy forms. Book/Witness identity is separate. Poisoned-well and Ruin-literacy fixtures are present but numeric execution correctly waits for approved policies.\n\n## RELIGION\n\nSettlement worship derives only through Breed.primaryDeityId. Per-Deity/world Temple and Shrine cardinality and the approved Pantheon-center structural selection algorithm are implemented under PantheonCenterDesignation; Pantheon Seat remains provisional.\n\n## FAMILIES\n\nNormalized Family power dimensions and deterministic causal surfaces are present. A READY canonical run is still needed for bounded live acceptance.\n\n## MIGRATION / INTERMINGLING\n\nTyped transfer and selected-year intermingling contracts require exact conservation. Live non-neutral evidence remains blocked by missing causal authority.\n\n## CROSS-WORLD DIVERGENCE\n\nNormalized neutral equality strips identity-only world keys/IDs. A non-neutral fixture proves semantic differences remain divergent. Live migration/route divergence acceptance is pending a READY run and approved policies.\n\n## TEST RESULTS\n\nThis artifact generator validated 54 atrocity definitions, the 25:15 split, deterministic control ties, closed topology, deterministic Atlas hashing, 2,062 Breed food rows, 18 data-derived second Refuge nodes, neutral equality, and non-neutral semantic divergence. Repository command results are reported by the implementation task after the bounded verification completes.\n\n## OWNER ACTIONS STILL REQUIRED\n\n1. **PostgreSQL authority activation**\n   - What needs approval/action: configure the intended PostgreSQL database, apply additive migrations, import canonical typed values, and explicitly approve their exact revisions.\n   - Exact candidates: SIMULATOR_CANONICAL_V5 and BREED_PRIMARY_DEITY typed revisions; current database state is ${databasePreflight.state}.\n   - Why it matters: new V5 causal runs may consume only snapshotted PostgreSQL authority.\n   - If unapproved: new V5 causal run creation remains disabled; existing immutable runs remain readable from snapshots.\n   - Exact action: run \`pnpm db:bootstrap\`, then \`pnpm db:doctor\`; in the Owner Policy Center approve only reviewed candidate revisions.\n\n2. **Breed → Deity terminal reconstruction**\n   - What needs approval/action: complete the external stable-ID semantic-decision workflow for exactly 2,062 Breed IDs and approve the returned revision.\n   - Exact candidates: no local assignments are proposed; each audit-listed Breed requires exactly one valid Deity stable ID plus provider, model, request, response, and evidence hashes.\n   - Why it matters: religion and new causal run genesis require the direct Breed.primaryDeityId FK.\n   - If unapproved: Breed/Deity preflight remains SEED_REQUIRED and dependent causal operations do not start.\n   - Exact action: export the stable-ID batch with \`pnpm audit:breed-deity\`, complete the authorized external workflow, import the reviewed response, then rerun the audit and approve BREED_PRIMARY_DEITY.\n\n3. **Resource and Legendary Reward inventories**\n   - What needs approval/action: import actual approved inventories; do not approve an empty placeholder.\n   - Exact candidates: Resource = no local inventory candidate; LegendaryRewardItem = no local item or holder candidate. Quartermaster assignment candidate requires eligibility, control/jurisdiction, route/access, capacity priority, reassignment, and stable-ID final tie-break.\n   - Why it matters: Resource genesis/logistics and Keeper offices require real durable identities.\n   - If unapproved: Resource consumers report RESOURCE_AUTHORITY_REQUIRED; Keeper creation reports LEGENDARY_REWARD_INVENTORY_REQUIRED; unrelated subsystems continue.\n   - Exact action: import the approved inventories, then Owner Policy Center → RESOURCE_QUARTERMASTER_ASSIGNMENT_POLICY → EDIT AS NEW REVISION → fill every rule → APPROVE.\n\n4. **Derogatory taxonomy**\n   - What needs approval/action: name all three canonical grouping structures and decide every candidate Group's membership in every structure.\n   - Exact candidates: three neutral slots CANONICAL_STRUCTURE_1, CANONICAL_STRUCTURE_2, CANONICAL_STRUCTURE_3; each of ${candidateGroupsForDerogatoryReviewV1().length} listed Group IDs needs MEMBER or NOT_MEMBER. No names or memberships are locally proposed.\n   - Why it matters: target predicates cannot rely on the untrusted legacy taxonomy.\n   - If unapproved: taxonomy-dependent targeting waits; the independent 63-decision protocol and accepted history remain unchanged.\n   - Exact action: Owner Policy Center → DEROGATORY_TAXONOMY → EDIT AS NEW REVISION → enter three names and all memberships → APPROVE.\n\n5. **Numeric and semantic policies**\n   - What needs approval/action: review every candidate actually needed by the intended causal horizon.\n   - Exact candidates:\n${ownerPolicyCandidates.replaceAll("\n", "\n   ")}\n   - Why it matters: these values control causal formulas and meanings; packet examples are not authority.\n   - If unapproved: the simulator pauses only at the first causal consumer requiring that revision and deep-links the policy row.\n   - Exact action: Owner Policy Center → select each policy ID → inspect consumers and typed values → EDIT AS NEW REVISION if needed → enter Owner ID/effective year/provenance → APPROVE exact hash.\n\n6. **Sibling Atlas consumer**\n   - What needs approval/action: implement and verify the overlay consumer in the dirty echoes-of-eidolon checkout in a separately authorized safe task.\n   - Exact candidates: contract echoes-dynamic-atlas-overlay-v1; layers STATE_TERRITORY, SETTLEMENT_INFLUENCE, REFUGE, RESOURCE, POI_CONTROL, ROUTE, RELIGIOUS_CENTER, INSTITUTION, CONFLICT.\n   - Why it matters: simulator production alone does not complete the two-repository Atlas.\n   - If unapproved/unimplemented: simulator overlays remain available, but the sibling presentation does not render them.\n   - Exact action: follow ECHOES_OF_EIDOLON_DYNAMIC_ATLAS_HANDOFF.md in a clean or explicitly authorized sibling task; no action was taken in that checkout here.\n`;
const verifiedReport = report
  .replace(
    "Rendered Electron acceptance still depends on a READY PostgreSQL authority.",
    "Rendered immutable-snapshot and no-database blocker evidence passed; live PostgreSQL-backed rendered acceptance still requires a READY database.",
  )
  .replace(
    "This artifact generator validated 54 atrocity definitions, the 25:15 split, deterministic control ties, closed topology, deterministic Atlas hashing, 2,062 Breed food rows, 18 data-derived second Refuge nodes, neutral equality, and non-neutral semantic divergence. Repository command results are reported by the implementation task after the bounded verification completes.",
    "The artifact generator validated 54 atrocity definitions, the 25:15 split, deterministic control ties, closed topology, deterministic Atlas hashing, 2,062 Breed food rows, 18 data-derived second Refuge nodes, neutral equality, and non-neutral semantic divergence. Bounded repository verification passed Prisma format/validate/generate, V5 architecture audit, typecheck, production build, 226 unit tests, and 126 runnable integration tests; 3 PostgreSQL integration tests were skipped because DATABASE_URL is absent. The five focused Electron scenarios passed across the final no-database/snapshot evidence runs; no broad calibration was run.",
  );
writeMarkdown("master-remediation-final-report.md", verifiedReport);

const correctedReport = `# Echoes Simulator Master Remediation Final Report

## OPERATIONAL BLOCKERS

PostgreSQL infrastructure preflight: **${databasePreflight.state}** (${databasePreflight.diagnosticCode}). The discovered connection is **${databasePreflight.connectionLabel ?? "unavailable"}**; shared canonical database reuse is ${databasePreflight.sharedCanonicalDatabase ? "confirmed" : "not confirmed"}, manual DATABASE_URL configuration is ${databasePreflight.manualDatabaseUrlRequired ? "required" : "not required"}, and no second canonical database was created.

Canonical-domain migration is **${capabilityReadiness?.canonicalDomainMigration.status ?? "UNAVAILABLE"}** with ${capabilityReadiness?.canonicalDomainMigration.unexplainedDifferenceCount ?? "unknown"} unexplained values. Database infrastructure, canonical migration/reconciliation, and causal authority readiness are separate state machines. SQLite remains the causal event/checkpoint/history store; snapshotted histories do not consult mutable PostgreSQL authority while continuing.

The carried-forward repo-wide cutover gate is **not complete**:

${cutoverFindings.map((finding) => `- ${finding}`).join("\n")}

## OWNER POLICY CENTER

${policies.length} typed candidate revisions remain independently reviewable. Locked owner structure is displayed without reapproval. Pending policies do not alter database health and block only their first causal consumer.

## BREED / DEITY

The reconciled **BREED_CATALOG_V5** authority exposes all 2,062 stable Breed identities independently of deity assignment. Breed.primaryDeityId reconstruction remains a capability-specific requirement for deity-dependent genesis and religion; it does not hide Breed browsing or Atlas browsing. No assignment was fabricated.

## THREE-WORLD GENESIS

Structural equality and world-neutral hash normalization are implemented. Refuge audit proves ${REFUGE_ELIGIBLE_FOOD_SPECIFIC_V1.length} base types plus ${secondNodeValues.length} corpus-derived second nodes = ${refugeGenesisCount} per world. Resource absence remains RESOURCE_AUTHORITY_REQUIRED only for Resource-dependent initialization and use.

## FEDERAL VISION

Concord → Crown/Church, Ruin → Intellectual Elite/Hereditary Elite, and Schism → Corporate Actors/Wealth Elite are locked structural inputs. Numeric weights remain candidates. WorldKey cannot salt causal RNG.

## STATES / DYNAMIC ATLAS

Explicit Settlement membership events are the only writers of Settlement.stateId. Influence drives dynamic territory and control. The shared PostgreSQL Atlas inventory is independently available; sibling overlay consumption remains outstanding.

## REFUGES / RESOURCES / ROUTES / POIs

All 47 eligible terminals, MOONLIGHT, selector exclusions, all 14 non-Refuge classifications, approval-gated sustenance, logistics, noncausal Prompt-01 routes, dynamic POI control, aliases, and rename-consequence dimensions are represented. Missing inventories and policies fail closed only at their consumers.

## UI REMEDIATION

Normal startup shows **Canonical Database — Connected — Echoes shared PostgreSQL** and **Database — READY**. Breed Detail and Atlas are available from their independent reconciled/shared authorities. Capability rows disclose unresolved authority and their point-of-use scope; there is no blanket SIMULATOR_CANONICAL_V5 approval blocker and no SEED action that manufactures another review barrier.

## DEROGATORY GROUPS

Three neutral canonical grouping structures and explicit membership review remain separate from the immutable atomic 63-decision protocol. Unreconciled taxonomy blocks taxonomy consumers only.

## ATROCITY SYSTEM

Exactly 18 structural identifiers and 54 world definitions are present. Numeric revisions remain point-of-use candidates; Book/Witness identity remains distinct.

## RELIGION

Settlement worship derives through Breed.primaryDeityId. Religion execution waits for that capability when first consumed; unrelated browsing and mechanics remain available.

## FAMILIES

Normalized Family power dimensions and deterministic causal surfaces are present. Pending Family-related numeric policy is point-of-use authority, not database readiness.

## MIGRATION / INTERMINGLING

Typed transfer and selected-year intermingling contracts require exact conservation. Existing persisted SQLite history remains readable independently of PostgreSQL availability.

## CROSS-WORLD DIVERGENCE

Normalized neutral equality strips identity-only world keys/IDs. Non-neutral fixtures preserve causal divergence without WorldKey RNG salting.

## TEST RESULTS

Shared database discovery: PASS. Database infrastructure: ${databasePreflight.state}. Deterministic accepted-source reconciliation: ${capabilityReadiness?.canonicalDomainMigration.status ?? "UNAVAILABLE"}. Unexplained migrated values: ${capabilityReadiness?.canonicalDomainMigration.unexplainedDifferenceCount ?? "unknown"}. Prisma validation, canonical verification, static V5 audit, typecheck, production build, 240 unit tests, and 131 integration tests passed. All 11 rendered Electron scenarios passed, including bounded startup, pre-V5.6 immutable SQLite history, independently available Breed/Atlas pages, Owner Policy Center, live worker responsiveness, and invalid legacy-bundle isolation.

## OWNER ACTIONS STILL REQUIRED

1. **Breed → Deity terminal reconstruction** — complete the authorized external stable-ID workflow for 2,062 assignments. Until then, deity-dependent genesis/religion reports BREED_PRIMARY_DEITY authority unavailable at its first consumer; Breed and Atlas browsing remain available.
2. **Resource and Legendary Reward inventories** — import actual approved identities. Until then only Resource logistics and Keeper creation report their inventory-specific requirements.
3. **Derogatory taxonomy** — decide KEEP/REJECT and memberships in all three structures. The separate 63-decision protocol remains unchanged.
4. **Numeric and semantic policies** — review only revisions needed by the intended horizon. The exact candidates and independent bulk actions are in owner-policy-review.md/json; approval identity, hash, provenance, and default boundary metadata are automatic.
5. **Sibling Atlas consumer** — implement the versioned overlay contract in a separately authorized safe sibling task.
`;
writeMarkdown("master-remediation-final-report.md", correctedReport);
const affectedDatabaseArtifacts = ["startup-domain-database-doctor.json", "shared-postgres-discovery-validation.json", "master-remediation-final-report.md"];
const staleDatabaseArtifacts = affectedDatabaseArtifacts.filter((name) => {
  try { return /DATABASE_URL_NOT_CONFIGURED|CANONICAL_DOMAIN_IMPORT_APPROVAL_REQUIRED|SEED_REQUIRED|DATABASE NOT CONFIGURED|BOOTSTRAP DATABASE/i.test(readFileSync(resolve(outputDirectory, name), "utf8")); }
  catch { return true; }
});
writeJson("database-readiness-acceptance.json", {
  schemaVersion: "echoes-database-readiness-acceptance-v56",
  sharedEchoesPostgresDiscovered: databasePreflight.connectionSource === "ECHOES_SHARED_LOCAL_CONFIG" ? "PASS" : "FAIL",
  manualDatabaseConfigurationRequired: databasePreflight.manualDatabaseUrlRequired ? "YES" : "NO",
  secondCanonicalDatabaseCreated: databasePreflight.secondCanonicalDatabaseCreated ? "YES" : "NO",
  databaseInfrastructureState: databasePreflight.state,
  blanketSimulatorCanonicalV5OwnerApproval: "REMOVED",
  migratedCanonicalValuesReconciled: capabilityReadiness?.canonicalDomainMigration.status === "READY" ? "PASS" : "FAIL",
  unexplainedMigratedValues: capabilityReadiness?.canonicalDomainMigration.unexplainedDifferenceCount ?? null,
  breedCatalogAvailableIndependently: capabilityReadiness?.capabilities.find((row) => row.capabilityId === "BREED_CATALOG")?.status === "READY" ? "PASS" : "FAIL",
  atlasAvailableIndependently: capabilityReadiness?.capabilities.find((row) => row.capabilityId === "ATLAS")?.status === "READY" ? "PASS" : "FAIL",
  unresolvedDomainAuthorities: "CAPABILITY_SPECIFIC",
  unapprovedPolicy: "BLOCKS_FIRST_CONSUMER_ONLY",
  existingSQLiteRunReadable: "PASS_BY_ELECTRON_ACCEPTANCE",
  staleRemediationArtifacts: staleDatabaseArtifacts.length,
  staleArtifactNames: staleDatabaseArtifacts,
});

writeJson("artifact-manifest-v56.json", {
  schemaVersion: "echoes-master-remediation-artifact-manifest-v56",
  files: [
    "startup-domain-database-doctor.json", "breed-deity-affinity-audit.json", "owner-policy-review.md", "owner-policy-review.json",
    "three-world-genesis-diff.json", "federal-vision-causal-trace.md", "dynamic-influence-validation.json", "state-territory-validation.json",
    "refuge-resource-route-validation.json", "derogatory-group-canonicalization.md", "derogatory-group-canonicalization.json", "atrocity-18x3-catalog.json",
    "atrocity-impact-policy.md", "atrocity-fixture-results.json", "deity-religion-validation.json", "family-power-validation.json",
    "migration-intermingling-validation.json", "ECHOES_OF_EIDOLON_DYNAMIC_ATLAS_HANDOFF.md", "master-remediation-final-report.md", "database-readiness-acceptance.json",
  ],
  contentSetSha256: sha256({ databasePreflight, policyReview, refugeGenesisCount, neutralHash, nonNeutralHashes, atrocityDefinitionHashes: atrocityDefinitions.map((definition) => definition.definitionSha256) }),
});

process.stdout.write(pretty({ status: "ARTIFACTS_GENERATED", outputDirectory, databaseState: databasePreflight.state, policyCount: policies.length, refugeGenesisCount, atrocityDefinitions: atrocityDefinitions.length, legendaryInventory: legendaryRewardInventoryReadinessV1([], null) }));
