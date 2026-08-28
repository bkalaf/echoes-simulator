import type { CanonicalDataV5 } from "./config.js";
import { effectiveRouteClassification, type RouteClassificationAuthorityV1 } from "./route-classification.js";
import type { AcceptedLabelLedgerEntryV5, NamingComparisonAuditStatusV5, NamingRequestV5, WorldKey, WorldStateV5 } from "./types.js";

const WORLDS: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];
const TRUSTED_SOURCES = new Set(["CANONICAL_EXISTING", "OWNER_INPUT", "LLM_NAMING_RESPONSE", "AUTOMATIC_REUSE"]);
export type NamingGeographyPattern = "AAA" | "AAB" | "ABA" | "BAA" | "ABC" | "INCOMPLETE";
export type NamingGeographyEntityType = "SETTLEMENT" | "POI" | "ROUTE";
export type NamingGeographyWorldStatus = "ACCEPTED" | "PENDING" | "UNNAMED" | "NOT_FOUNDED" | "INACTIVE" | "MODE_UNRESOLVED" | "NO_NAME_REQUIRED" | "NOT_YET_EFFECTIVE";

export interface NamingGeographyWorldCell {
  worldKey: WorldKey;
  entityId: string | null;
  label: string | null;
  display: string;
  status: NamingGeographyWorldStatus;
  source: AcceptedLabelLedgerEntryV5["source"] | null;
  cssClass: "name-divergence-odd" | "name-divergence-all" | "name-incomplete" | null;
}

export interface NamingGeographyRow {
  entityType: NamingGeographyEntityType;
  physicalIdentity: string;
  secondaryReference: string;
  continentGroup: string;
  pattern: NamingGeographyPattern;
  comparisonAuditStatus: NamingComparisonAuditStatusV5;
  atlasTarget: { kind: "SITE" | "POI" | "ROUTE"; ids: string[] };
  cells: Record<WorldKey, NamingGeographyWorldCell>;
}

export interface NamingGeographyReadModelV1 {
  schemaVersion: "echoes-naming-geography-v1";
  year: number;
  rows: NamingGeographyRow[];
  summaries: Record<string, { AAA: number; AAB_FAMILY: number; ABC: number; INCOMPLETE: number }>;
}

function comparableLabel(cell: NamingGeographyWorldCell): string | null {
  return cell.status === "ACCEPTED" && cell.label && cell.source && TRUSTED_SOURCES.has(cell.source) ? cell.label.normalize("NFC").trim().toLowerCase() : null;
}

export function classifyNamingGeographyCells(cells: Record<WorldKey, NamingGeographyWorldCell>): { pattern: NamingGeographyPattern; styled: Record<WorldKey, NamingGeographyWorldCell> } {
  const values = WORLDS.map((world) => comparableLabel(cells[world]));
  if (values.some((value) => value === null)) return { pattern: "INCOMPLETE", styled: Object.fromEntries(WORLDS.map((world) => [world, { ...cells[world], cssClass: "name-incomplete" as const }])) as Record<WorldKey, NamingGeographyWorldCell> };
  const [a, b, c] = values as [string, string, string];
  const pattern: NamingGeographyPattern = a === b && b === c ? "AAA" : a === b ? "AAB" : a === c ? "ABA" : b === c ? "BAA" : "ABC";
  const odd = pattern === "AAB" ? "RUIN" : pattern === "ABA" ? "SCHISM" : pattern === "BAA" ? "CONCORD" : null;
  const styled = Object.fromEntries(WORLDS.map((world) => [world, { ...cells[world], cssClass: pattern === "ABC" ? "name-divergence-all" as const : odd === world ? "name-divergence-odd" as const : null }])) as Record<WorldKey, NamingGeographyWorldCell>;
  return { pattern, styled };
}

function continentForRegion(canonical: CanonicalDataV5, regionId: string): string | null {
  const values = [...new Set(canonical.sites.filter((site) => site.regionId === regionId).map((site) => site.continent).filter((value): value is string => Boolean(value)))];
  return values.length === 1 ? values[0]! : null;
}

function entryFor(ledger: readonly AcceptedLabelLedgerEntryV5[], entityId: string, year: number): AcceptedLabelLedgerEntryV5 | null {
  return ledger.filter((entry) => entry.entityId === entityId && entry.nameEffectiveFromYear <= year && TRUSTED_SOURCES.has(entry.source)).sort((a, b) => b.nameEffectiveFromYear - a.nameEffectiveFromYear || b.acceptanceYear - a.acceptanceYear)[0] ?? null;
}

function cell(entityId: string | null, status: Exclude<NamingGeographyWorldStatus, "ACCEPTED">, display: string, ledger: readonly AcceptedLabelLedgerEntryV5[], year: number): NamingGeographyWorldCell {
  if (entityId) {
    const entry = entryFor(ledger, entityId, year);
    if (entry) return { worldKey: entry.worldKey!, entityId, label: entry.label, display: entry.label, status: "ACCEPTED", source: entry.source, cssClass: null };
    if (ledger.some((candidate) => candidate.entityId === entityId && candidate.nameEffectiveFromYear > year && TRUSTED_SOURCES.has(candidate.source))) {
      return { worldKey: "CONCORD", entityId, label: null, display: "NOT YET EFFECTIVE", status: "NOT_YET_EFFECTIVE", source: null, cssClass: null };
    }
  }
  return { worldKey: "CONCORD", entityId, label: null, display, status, source: null, cssClass: null };
}

function auditStatus(cells: Record<WorldKey, NamingGeographyWorldCell>, ledger: readonly AcceptedLabelLedgerEntryV5[], expectedGroupId: string): NamingComparisonAuditStatusV5 {
  const entries = WORLDS.flatMap((world) => cells[world].entityId ? ledger.filter((entry) => entry.entityId === cells[world].entityId) : []);
  if (entries.some((entry) => entry.namingComparisonGroupId === expectedGroupId && entry.comparisonAuthorityRef)) return "COMPARISON_AWARE";
  return "UNCOORDINATED";
}

function finalize(row: Omit<NamingGeographyRow, "pattern" | "cells" | "comparisonAuditStatus"> & { cells: Record<WorldKey, NamingGeographyWorldCell>; expectedGroupId: string }, ledger: readonly AcceptedLabelLedgerEntryV5[]): NamingGeographyRow {
  for (const world of WORLDS) row.cells[world].worldKey = world;
  const classified = classifyNamingGeographyCells(row.cells);
  return { entityType: row.entityType, physicalIdentity: row.physicalIdentity, secondaryReference: row.secondaryReference, continentGroup: row.continentGroup, atlasTarget: row.atlasTarget, pattern: classified.pattern, cells: classified.styled, comparisonAuditStatus: auditStatus(classified.styled, ledger, row.expectedGroupId) };
}

export function buildNamingGeographyReadModel(canonical: CanonicalDataV5, states: Partial<Record<WorldKey, WorldStateV5>>, ledger: readonly AcceptedLabelLedgerEntryV5[], requests: readonly NamingRequestV5[], year: number, classificationAuthority?: RouteClassificationAuthorityV1): NamingGeographyReadModelV1 {
  const rows: NamingGeographyRow[] = [];
  for (const site of canonical.sites) {
    const cells = Object.fromEntries(WORLDS.map((world) => {
      const settlement = states[world]?.settlements.find((item) => item.siteId === site.siteId);
      const pending = settlement && requests.some((request) => request.entityId === settlement.settlementId && !request.acceptedLabel);
      return [world, settlement ? cell(settlement.settlementId, pending ? "PENDING" : "UNNAMED", pending ? "PENDING" : "UNNAMED", ledger, year) : cell(null, "NOT_FOUNDED", "NOT FOUNDED", ledger, year)];
    })) as Record<WorldKey, NamingGeographyWorldCell>;
    rows.push(finalize({ entityType: "SETTLEMENT", physicalIdentity: site.siteId, secondaryReference: `${site.regionId} · ${site.regionName}`, continentGroup: site.continent ?? "CONTINENT UNRESOLVED", atlasTarget: { kind: "SITE", ids: [site.siteId] }, cells, expectedGroupId: `SETTLEMENT_SITE:${site.siteId}` }, ledger));
  }
  for (const poi of canonical.physicalPois) {
    const cells = Object.fromEntries(WORLDS.map((world) => {
      const entityId = `WORLD_POI_${world}_${poi.poiId}`;
      const pending = requests.some((request) => request.entityId === entityId && !request.acceptedLabel);
      const context = poi.workingLabel ? `${pending ? "PENDING" : "UNNAMED"} · working reference: ${poi.workingLabel}` : pending ? "PENDING" : "UNNAMED";
      return [world, cell(entityId, pending ? "PENDING" : "UNNAMED", context, ledger, year)];
    })) as Record<WorldKey, NamingGeographyWorldCell>;
    rows.push(finalize({ entityType: "POI", physicalIdentity: poi.poiId, secondaryReference: `${poi.poiType} · ${poi.siteId}`, continentGroup: poi.continent ?? canonical.sites.find((site) => site.siteId === poi.siteId)?.continent ?? "CONTINENT UNRESOLVED", atlasTarget: { kind: "POI", ids: [poi.poiId] }, cells, expectedGroupId: `PHYSICAL_POI:${poi.poiId}` }, ledger));
  }
  for (const corridor of canonical.routeCorridors) {
    const effective = effectiveRouteClassification(corridor, classificationAuthority);
    const continentA = continentForRegion(canonical, corridor.regionAId); const continentB = continentForRegion(canonical, corridor.regionBId);
    const continentGroup = !continentA || !continentB ? "CONTINENT UNRESOLVED" : continentA === continentB ? continentA : `INTERCONTINENTAL — ${[continentA, continentB].sort().join(" ↔ ")}`;
    const cells = Object.fromEntries(WORLDS.map((world) => {
      const entityId = `WORLD_ROUTE_${world}_${corridor.corridorId}`;
      const route = states[world]?.worldRoutes.find((item) => item.routeId === entityId);
      if (!route) return [world, cell(entityId, "INACTIVE", "INACTIVE", ledger, year)];
      if (effective.semanticReadiness === "NOT_READY") return [world, cell(entityId, "MODE_UNRESOLVED", "NOT READY FOR NAMING", ledger, year)];
      const pending = requests.some((request) => request.entityId === entityId && !request.acceptedLabel);
      return [world, cell(entityId, pending ? "PENDING" : "UNNAMED", pending ? "PENDING" : "UNNAMED", ledger, year)];
    })) as Record<WorldKey, NamingGeographyWorldCell>;
    rows.push(finalize({ entityType: "ROUTE", physicalIdentity: corridor.corridorId, secondaryReference: `${corridor.regionAId} ↔ ${corridor.regionBId}`, continentGroup, atlasTarget: { kind: "ROUTE", ids: [corridor.regionAId, corridor.regionBId] }, cells, expectedGroupId: `WORLD_ROUTE:${corridor.corridorId}` }, ledger));
  }
  rows.sort((a, b) => a.entityType.localeCompare(b.entityType) || a.continentGroup.localeCompare(b.continentGroup) || a.physicalIdentity.localeCompare(b.physicalIdentity));
  const summaries: NamingGeographyReadModelV1["summaries"] = {};
  for (const row of rows) { const summary = summaries[row.continentGroup] ?? { AAA: 0, AAB_FAMILY: 0, ABC: 0, INCOMPLETE: 0 }; if (row.pattern === "AAA") summary.AAA += 1; else if (["AAB", "ABA", "BAA"].includes(row.pattern)) summary.AAB_FAMILY += 1; else if (row.pattern === "ABC") summary.ABC += 1; else summary.INCOMPLETE += 1; summaries[row.continentGroup] = summary; }
  return { schemaVersion: "echoes-naming-geography-v1", year, rows, summaries };
}
