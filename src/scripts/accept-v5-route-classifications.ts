import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import { loadBundledCanonicalV5 } from "../core/v5/canonical-adapter.js";
import { parseRouteClassificationAuthority, ROUTE_CLASSIFICATION_SCHEMA_VERSION, type RouteClassificationDecisionV1 } from "../core/v5/route-classification.js";

const argument = (name: string): string | null => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};
const worksheetPath = resolve(argument("--worksheet") ?? "artifacts/simulator/v5/remediation/route-classification-worksheet.csv");
const outputPath = resolve(argument("--output") ?? "resources/noncausal/route-classification/route-classification-authority-v1.json");
const authorityVersion = argument("--authority-version");
const approvedAt = argument("--approved-at");
if (!authorityVersion || !/^[A-Za-z0-9_.-]+$/.test(authorityVersion)) throw new Error("--authority-version is required and must use only letters, numbers, dot, underscore, or hyphen");
if (!approvedAt || Number.isNaN(Date.parse(approvedAt))) throw new Error("--approved-at is required and must be an ISO date/time");

const text = readFileSync(worksheetPath, "utf8");
const rows = parseCsv(text, { bom: true, columns: true, skip_empty_lines: true }) as Record<string, string>[];
const canonical = loadBundledCanonicalV5(resolve("resources/canonical"));
if (rows.length !== 38 || rows.length !== canonical.routeCorridors.length) throw new Error(`Owner worksheet must contain all 38 corridors; found ${rows.length}`);
const expected = new Set(canonical.routeCorridors.map((corridor) => corridor.corridorId));
const bool = (value: string, field: string, corridorId: string): boolean => {
  const normalized = value.trim().toUpperCase();
  if (normalized === "TRUE") return true;
  if (normalized === "FALSE") return false;
  throw new Error(`${corridorId}: ${field} must be TRUE or FALSE`);
};
const decisions: RouteClassificationDecisionV1[] = [];
for (const row of rows) {
  const corridorId = row.corridorId?.trim();
  if (!corridorId || !expected.delete(corridorId)) throw new Error(`Worksheet has an unknown or duplicate corridorId ${corridorId || "<blank>"}`);
  const status = row.ownerDecisionStatus?.trim().toUpperCase() ?? "";
  if (!status) continue;
  if (status === "APPROVED") throw new Error(`${corridorId}: generic APPROVED is ambiguous; use OWNER_VALUES or APPROVE_RECOMMENDATION`);
  if (status !== "OWNER_VALUES" && status !== "APPROVE_RECOMMENDATION") throw new Error(`${corridorId}: unsupported ownerDecisionStatus ${status}`);
  const useRecommendation = status === "APPROVE_RECOMMENDATION";
  const ownerPrimaryMode = (useRecommendation ? row["recommended primaryMode"] : row.ownerPrimaryMode)?.trim().toUpperCase();
  const ownerInfrastructureClass = (useRecommendation ? row["recommended infrastructureClass"] : row.ownerInfrastructureClass)?.trim().toUpperCase();
  const ownerPortalCapability = bool(useRecommendation ? row["recommended portalCapability"] : row.ownerPortalCapability, "ownerPortalCapability", corridorId);
  const ownerTradeDesignation = bool(useRecommendation ? row["recommended tradeDesignation"] : row.ownerTradeDesignation, "ownerTradeDesignation", corridorId);
  const ownerEvidenceRef = row.ownerEvidenceRef?.trim();
  if (!ownerEvidenceRef) throw new Error(`${corridorId}: ownerEvidenceRef is required for every decision`);
  decisions.push({
    corridorId,
    ownerDecisionStatus: status,
    ownerPrimaryMode: ownerPrimaryMode as RouteClassificationDecisionV1["ownerPrimaryMode"],
    ownerInfrastructureClass: ownerInfrastructureClass as RouteClassificationDecisionV1["ownerInfrastructureClass"],
    ownerPortalCapability,
    ownerTradeDesignation,
    ownerEvidenceRef,
    recommendationEvidence: useRecommendation ? row.recommendationEvidence?.trim() || null : null,
  });
}
if (expected.size > 0) throw new Error(`Worksheet is missing corridors: ${[...expected].sort().join(", ")}`);
const authority = parseRouteClassificationAuthority({
  schemaVersion: ROUTE_CLASSIFICATION_SCHEMA_VERSION,
  authorityVersion,
  authorityStatus: decisions.length > 0 ? "OWNER_APPROVED_NONCAUSAL_OVERLAY" : "NO_OWNER_DECISIONS",
  approvedAt,
  classifications: decisions,
}, new Set(canonical.routeCorridors.map((corridor) => corridor.corridorId)));
writeFileSync(outputPath, `${JSON.stringify(authority, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ outputPath, authorityVersion, approvedDecisions: authority.classifications.length, worksheetSha256: createHash("sha256").update(text).digest("hex"), causalAuthorityChanged: false })}\n`);
