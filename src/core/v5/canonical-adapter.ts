import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { WorldKey } from "../contracts/domain.js";
import { openValidatedZip, parseCsvFile, parseJsonLines, type GenericRow } from "../inputs/importer.js";
import type { CanonicalEffectiveBreedSemantics } from "../research/v4-contract.js";
import { normalizeFactionVector, ratioScore } from "./fixed-point.js";
import type { CanonicalDataV5, GovernmentPrototypeV5 } from "./config.js";
import type { SelectionRuleV5 } from "./types.js";

const WORLDS: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];
const WORLD_SCOPE: Record<WorldKey, string> = { CONCORD: "C", SCHISM: "S", RUIN: "R" };

interface IdentityRow extends GenericRow {
  breedId: string;
  groupId: string;
  populationKind: "HUMAN" | "BEAST" | "MYTHOS" | "PET";
}

interface SiteRow extends Record<string, string> {
  regionId: string;
  regionName: string;
  siteId: string;
  currentSiteName: string;
  nameStatus: string;
  continent: string;
  attractivenessTier: string;
  broadTerrain: string;
  specificTerrain: string;
  latitude: string;
  longitude: string;
}

interface AssignmentRow extends Record<string, string> {
  regionId: string;
  worldScope: string;
  groupId: string;
}

interface ReadinessRow {
  world: WorldKey;
  settlementId: string;
  siteId: string;
  regionId: string;
  currentName: string;
  population: string;
  politicalForm: string;
}

interface PoliticalFormRow {
  administrationMode: string;
  legitimacyBasis: string;
  authoritySource: string;
  politicalForm: string;
}

interface EconomicFormRow {
  ownershipMode: string;
  allocationMode: string;
  economicForm: string;
}

interface PoiRow extends Record<string, string> {
  poiId: string;
  poiType: string;
  poiCurrentName: string;
  poiWorkingLabel: string;
  poiNameStatus: string;
  siteId: string;
  regionId: string;
  regionName: string;
  continent: string;
  poiLatitude: string;
  poiLongitude: string;
  poiHostFeatureId: string;
}

interface SovereignRow {
  sovereignFaction: WorldKey;
  breedId: string;
  djtSeizureTarget: { siteId: string };
}

interface SharedEventRow {
  eventKey: string;
  nominalYear: number;
  kind: string;
  label: string;
  blocker?: string;
  warning?: string;
}

function member(archive: ReturnType<typeof openValidatedZip>, name: string): Uint8Array {
  const bytes = archive.entries[`${archive.prefix}${name}`];
  if (!bytes) throw new Error(`V5 canonical adapter requires ${name}`);
  return bytes;
}

function splitTerrain(value: string): string[] {
  return value.split("|").map((item) => item.trim()).filter(Boolean).sort();
}

function factionForCanonicalValue(mapping: Record<string, Record<WorldKey, string>>, property: string, value: string): WorldKey {
  const row = mapping[property];
  const match = WORLDS.find((world) => row?.[world] === value);
  if (!match) throw new Error(`Political prototype ${property}=${value} has no canonical faction mapping`);
  return match;
}

function diagnosticSelectionRule(row: PoliticalFormRow): SelectionRuleV5 {
  const selectionMethod: SelectionRuleV5["selectionMethod"] = row.authoritySource === "ELECTION"
    ? (row.legitimacyBasis === "MARTIAL" ? "MILITARY_SELECTION" : "ELITE_FRANCHISE")
    : row.authoritySource === "DIVINE_MANDATE"
      ? "RELIGIOUS_SELECTION"
      : row.legitimacyBasis === "ANCESTRAL"
        ? "HEREDITARY"
        : "RULER_APPOINTMENT";
  return {
    selectionMethod,
    scope: "STATE",
    requiresTrackedLineage: selectionMethod === "HEREDITARY",
    eligibleTiers: ["HIGH", "MID"],
    minimumFactionCompatibility: 0,
    stochasticTies: false,
    scoreWeights: { factionFit: 3500, classFit: 1000, localSupport: 3000, lineageFit: 1500, ruleSpecificFit: 1000 },
  };
}

function buildDiagnosticGovernmentPrototypes(
  rows: readonly PoliticalFormRow[],
  propertyMapping: Record<string, Record<WorldKey, string>>,
): GovernmentPrototypeV5[] {
  return rows.map((row) => {
    const counts: Record<WorldKey, number> = { CONCORD: 0, SCHISM: 0, RUIN: 0 };
    counts[factionForCanonicalValue(propertyMapping, "AdministrationMode", row.administrationMode)] += 1;
    counts[factionForCanonicalValue(propertyMapping, "LegitimacyBasis", row.legitimacyBasis)] += 1;
    counts[factionForCanonicalValue(propertyMapping, "AuthoritySource", row.authoritySource)] += 1;
    const rule = diagnosticSelectionRule(row);
    return {
      governmentFormId: row.politicalForm,
      doctrineVector: normalizeFactionVector(counts),
      administrationMode: row.administrationMode,
      legitimacyBasis: row.legitimacyBasis,
      authoritySource: row.authoritySource,
      franchiseBreadth: row.authoritySource === "ELECTION" ? 750 : row.authoritySource === "APPOINTMENT" ? 400 : 200,
      requiredInstitutions: [{
        institutionType: `GOVERNMENT_${row.politicalForm}`,
        offices: [{
          titleKey: `OFFICE_${row.politicalForm}_APEX`,
          jurisdictionSettlementId: null,
          power: 1000,
          mandatory: true,
          apex: true,
          termYears: row.authoritySource === "ELECTION" ? 10 : null,
          selectionRule: rule,
        }],
      }],
    };
  }).sort((a, b) => a.governmentFormId.localeCompare(b.governmentFormId));
}

/**
 * Adapts the current bundled V4 authority into V5 input shapes without altering
 * the V4 engine. Government Office mappings produced here are diagnostic
 * candidates; canonical V5 runs still fail closed through CausalOwnerInputsV1.
 */
export function loadBundledCanonicalV5(canonicalDirectory: string): CanonicalDataV5 {
  const manifest = JSON.parse(readFileSync(resolve(canonicalDirectory, "canonical_bundle_manifest.json"), "utf8")) as {
    buildReady: boolean;
    breedSemanticFilename: string;
    contentSha256: string;
  };
  if (!manifest.buildReady || !manifest.contentSha256) throw new Error("V5 requires a build-ready canonical bundle with a content hash");
  const archive = openValidatedZip(resolve(canonicalDirectory, "breeds", manifest.breedSemanticFilename));
  const identities = parseJsonLines(member(archive, "canonical_breed_identities.jsonl")) as IdentityRow[];
  const effective = parseJsonLines(member(archive, "effective_breed_semantics.jsonl")) as unknown as CanonicalEffectiveBreedSemantics[];
  const identityByBreed = new Map(identities.map((row) => [row.breedId, row]));
  const breeds = effective.map((row) => {
    const identity = identityByBreed.get(row.breedId);
    if (!identity) throw new Error(`V5 effective Breed ${row.breedId} lacks canonical identity`);
    if (!row.factionObject || !Array.isArray(row.dominantFaction)) throw new Error(`V5 Breed ${row.breedId} lacks direct faction authority`);
    return {
      breedId: row.breedId,
      populationKind: identity.populationKind,
      groupId: identity.groupId,
      factionObject: { ...row.factionObject },
      dominantFaction: [...row.dominantFaction],
      terrainBroad: [...row.terrainBroad].sort(),
      terrainSpecific: [...row.terrainSpecific].sort(),
      ownershipMode: row.dimensions.ownershipMode.value,
      allocationMode: row.dimensions.allocationMode.value,
    };
  }).sort((a, b) => a.breedId.localeCompare(b.breedId));

  // V5 founding may use any canonical Site. `founding_sites.csv` describes the
  // occupied year-0 subset; the Site authority is the complete naming master.
  const siteRows = parseCsvFile(resolve(canonicalDirectory, "atlas/sites_naming_master.csv")) as SiteRow[];
  const maximumSiteTier = Math.max(...siteRows.map((row) => Number.parseInt(row.attractivenessTier, 10)).filter(Number.isFinite));
  const sites = siteRows.map((row) => ({
    siteId: row.siteId,
    regionId: row.regionId,
    regionName: row.regionName,
    continent: row.continent || null,
    currentName: row.currentSiteName || null,
    nameStatus: row.nameStatus || "UNRESOLVED",
    namingAuthorityRef: row.nameStatus === "CANONICAL" && row.currentSiteName ? `CANONICAL_ATLAS_SITE_NAMING:${row.siteId}` : null,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    terrainBroad: splitTerrain(row.broadTerrain),
    terrainSpecific: splitTerrain(row.specificTerrain),
    quality: ratioScore(BigInt(Number.parseInt(row.attractivenessTier, 10)), BigInt(maximumSiteTier), 500),
  })).sort((a, b) => a.siteId.localeCompare(b.siteId));

  const adjacency = JSON.parse(readFileSync(resolve(canonicalDirectory, "reference/region_adjacency.json"), "utf8")) as { directed: boolean; regions: Record<string, string[]> };
  if (adjacency.directed !== true) throw new Error("V5 migration and TradeAccess require the canonical directed Region graph");
  const regions = Object.entries(adjacency.regions).map(([regionId, directedAdjacentRegionIds]) => ({ regionId, directedAdjacentRegionIds: [...directedAdjacentRegionIds].sort() })).sort((a, b) => a.regionId.localeCompare(b.regionId));
  const directedEdges = new Set(regions.flatMap((region) => region.directedAdjacentRegionIds.map((adjacent) => `${region.regionId}\0${adjacent}`)));
  const corridorPairs = new Set(regions.flatMap((region) => region.directedAdjacentRegionIds.map((adjacent) => [region.regionId, adjacent].sort().join("\0"))));
  const routeCorridors = [...corridorPairs].sort().map((pair) => {
    const [regionAId, regionBId] = pair.split("\0") as [string, string];
    const forward = directedEdges.has(`${regionAId}\0${regionBId}`);
    const reverse = directedEdges.has(`${regionBId}\0${regionAId}`);
    return {
      corridorId: `ROUTE_CORRIDOR_${regionAId}_${regionBId}`,
      regionAId,
      regionBId,
      canonicalDirectionality: forward && reverse ? "BIDIRECTIONAL" as const : forward ? "A_TO_B" as const : "B_TO_A" as const,
      portalCapability: false,
      landCapability: false,
      seaCapability: false,
      airCapability: false,
      canonicalConnectionTags: [] as string[],
      primaryMode: "UNRESOLVED" as const,
      infrastructureClass: "UNRESOLVED" as const,
      tradeDesignation: false,
      resolutionAuthority: "OWNER_APPROVAL_REQUIRED" as const,
    };
  });

  const assignments = parseCsvFile(resolve(canonicalDirectory, "atlas/region_species_group_assignments.csv")) as AssignmentRow[];
  const groupRegionAssignments = Object.fromEntries(WORLDS.map((world) => {
    const rows = assignments.filter((row) => row.regionId !== "R10" && row.worldScope.includes(WORLD_SCOPE[world]));
    const result: Record<string, string> = {};
    for (const row of rows) {
      if (result[row.groupId] && result[row.groupId] !== row.regionId) throw new Error(`Ambiguous ${world}/${row.groupId} year-0 Region assignment`);
      result[row.groupId] = row.regionId;
    }
    // R10's world-specific rows are context for the later DJT movement, not an
    // occupied year-0 Settlement. Their unique non-R10 row is the pre-DJT
    // population location in that world.
    for (const groupId of new Set(assignments.map((row) => row.groupId))) {
      if (result[groupId]) continue;
      const fallbackRegions = [...new Set(assignments.filter((row) => row.groupId === groupId && row.regionId !== "R10").map((row) => row.regionId))];
      if (fallbackRegions.length !== 1) throw new Error(`No unique pre-DJT Region for ${world}/${groupId}`);
      result[groupId] = fallbackRegions[0]!;
    }
    return [world, result];
  })) as Record<WorldKey, Record<string, string>>;

  const readiness = JSON.parse(readFileSync(resolve(canonicalDirectory, "integrity/year0_readiness.json"), "utf8")) as { status: string; settlementWorldResults: ReadinessRow[] };
  if (readiness.status !== "PASS") throw new Error("V5 adapter requires passing year-0 canonical readiness");
  const initialSettlements = readiness.settlementWorldResults.filter((row) => row.regionId !== "R10").map((row) => ({
    worldKey: row.world,
    settlementId: row.settlementId,
    siteId: row.siteId,
    stateId: `STATE_${row.world}_${row.regionId}`,
    governmentFormId: row.politicalForm,
    populationWeight: BigInt(row.population),
  })).sort((a, b) => `${a.worldKey}/${a.settlementId}`.localeCompare(`${b.worldKey}/${b.settlementId}`));

  const propertyMapping = JSON.parse(readFileSync(resolve(canonicalDirectory, "reference/property_faction_mapping.json"), "utf8")) as Record<string, Record<WorldKey, string>>;
  const politicalRows = (JSON.parse(readFileSync(resolve(canonicalDirectory, "reference/political_form_mapping.json"), "utf8")) as { rows: PoliticalFormRow[] }).rows;
  const economicForms = (JSON.parse(readFileSync(resolve(canonicalDirectory, "reference/economic_form_mapping.json"), "utf8")) as { rows: EconomicFormRow[] }).rows
    .map((row) => ({ ...row })).sort((a, b) => a.economicForm.localeCompare(b.economicForm));
  const physicalPois = (parseCsvFile(resolve(canonicalDirectory, "atlas/pois_by_site_naming.csv")) as PoiRow[]).map((row) => ({
    poiId: row.poiId, poiType: row.poiType, workingLabel: row.poiCurrentName || row.poiWorkingLabel || "", nameStatus: row.poiNameStatus || "WORKING",
    siteId: row.siteId, regionId: row.regionId, regionName: row.regionName, continent: row.continent || null,
    canonicalLabel: row.poiNameStatus === "CANONICAL" && row.poiCurrentName ? row.poiCurrentName : null,
    namingAuthorityRef: row.poiNameStatus === "CANONICAL" && row.poiCurrentName ? `CANONICAL_ATLAS_POI_NAMING:${row.poiId}` : null,
    latitude: Number(row.poiLatitude), longitude: Number(row.poiLongitude), hostFeatureId: row.poiHostFeatureId || null,
  })).sort((a, b) => a.poiId.localeCompare(b.poiId));
  const governments = buildDiagnosticGovernmentPrototypes(politicalRows, propertyMapping);
  const sovereignRows = JSON.parse(readFileSync(resolve(canonicalDirectory, "reference/sovereign_and_djt.json"), "utf8")) as Record<WorldKey, SovereignRow>;
  const sovereigns = Object.fromEntries(WORLDS.map((world) => [world, {
    sovereignFaction: sovereignRows[world].sovereignFaction,
    breedId: sovereignRows[world].breedId,
    seizureTargetSiteId: sovereignRows[world].djtSeizureTarget.siteId,
  }])) as CanonicalDataV5["sovereigns"];
  const canonicalSiteRows = siteRows.filter((row) => row.nameStatus === "CANONICAL" && row.currentSiteName && row.currentSiteName !== "NAMING_REQUIRED");
  const canonicalLabels = Object.fromEntries(canonicalSiteRows.map((row) => [row.siteId, row.currentSiteName]));
  const canonicalLabelAuthority = Object.fromEntries(canonicalSiteRows.map((row) => [row.siteId, `CANONICAL_ATLAS_SITE_NAMING:${row.siteId}`]));
  const sharedEvents = (JSON.parse(readFileSync(resolve(canonicalDirectory, "reference/shared_event_skeleton.json"), "utf8")) as { events: SharedEventRow[] }).events;
  const canonicalEvents = sharedEvents.map((event) => ({
    eventId: event.eventKey,
    year: event.nominalYear,
    eventType: event.kind,
    payload: { label: event.label, ...(event.blocker ? { blocker: event.blocker } : {}), ...(event.warning ? { warning: event.warning } : {}) },
  }));

  return {
    schemaVersion: "echoes-canonical-data-v5",
    canonicalBundleHash: manifest.contentSha256,
    breeds,
    sites,
    regions,
    governments,
    economicForms,
    physicalPois,
    routeCorridors,
    sovereigns,
    groupRegionAssignments,
    initialSettlements,
    canonicalLabels,
    canonicalLabelAuthority,
    canonicalEvents,
  };
}

export const V5_R10_CONTEXT: Readonly<Record<WorldKey, readonly string[]>> = {
  CONCORD: ["H12", "M01", "M05"],
  RUIN: ["H03", "B10", "B13"],
  SCHISM: ["H01", "H17", "B07"],
};
