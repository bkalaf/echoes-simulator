import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RouteCorridorAuthorityV1 } from "./config.js";

export const ROUTE_CLASSIFICATION_SCHEMA_VERSION = "echoes-route-classification-authority-v1" as const;
export const ROUTE_CLASSIFICATION_AUTHORITY_RELATIVE_PATH = join("noncausal", "route-classification", "route-classification-authority-v1.json");

export type RouteClassificationModeV1 = "LAND" | "SEA" | "AIR" | "PORTAL_ONLY";
export type RouteClassificationInfrastructureV1 = "ROAD" | "HIGHWAY" | "SEA_ROUTE" | "AIRSHIP_ROUTE" | "PORTAL_ONLY";
export type RouteOwnerDecisionStatusV1 = "OWNER_VALUES" | "APPROVE_RECOMMENDATION";

export interface RouteClassificationDecisionV1 {
  corridorId: string;
  ownerDecisionStatus: RouteOwnerDecisionStatusV1;
  ownerPrimaryMode: RouteClassificationModeV1;
  ownerInfrastructureClass: RouteClassificationInfrastructureV1;
  ownerPortalCapability: boolean;
  ownerTradeDesignation: boolean;
  ownerEvidenceRef: string;
  recommendationEvidence?: string | null;
}

export interface RouteClassificationAuthorityV1 {
  schemaVersion: typeof ROUTE_CLASSIFICATION_SCHEMA_VERSION;
  authorityVersion: string;
  authorityStatus: "OWNER_APPROVED_NONCAUSAL_OVERLAY" | "NO_OWNER_DECISIONS";
  approvedAt: string | null;
  classifications: RouteClassificationDecisionV1[];
}

export interface EffectiveRouteClassificationV1 {
  corridorId: string;
  semanticReadiness: "READY" | "NOT_READY";
  classificationStatus: "OWNER_APPROVED" | "OWNER_APPROVAL_REQUIRED";
  classificationAuthorityVersion: string | null;
  effectivePrimaryMode: "LAND" | "SEA" | "AIR" | "NONE" | "UNRESOLVED";
  effectiveInfrastructureClass: "ROAD" | "HIGHWAY" | "SEA_ROUTE" | "AIRSHIP_ROUTE" | "NONE" | "UNRESOLVED";
  portalCapability: boolean;
  tradeDesignation: boolean;
  ownerEvidenceRef: string | null;
}

const EMPTY_AUTHORITY: RouteClassificationAuthorityV1 = {
  schemaVersion: ROUTE_CLASSIFICATION_SCHEMA_VERSION,
  authorityVersion: "route-classification-owner-decisions-v1-empty",
  authorityStatus: "NO_OWNER_DECISIONS",
  approvedAt: null,
  classifications: [],
};

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`Route classification ${field} must be a non-empty string`);
  return value.trim();
}

function parseDecision(value: unknown): RouteClassificationDecisionV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Route classification entry must be an object");
  const row = value as Record<string, unknown>;
  const corridorId = requireString(row.corridorId, "corridorId");
  if (row.ownerDecisionStatus !== "OWNER_VALUES" && row.ownerDecisionStatus !== "APPROVE_RECOMMENDATION") throw new Error(`${corridorId}: ownerDecisionStatus must be OWNER_VALUES or APPROVE_RECOMMENDATION`);
  const ownerPrimaryMode = row.ownerPrimaryMode;
  const ownerInfrastructureClass = row.ownerInfrastructureClass;
  const validPair =
    (ownerPrimaryMode === "LAND" && (ownerInfrastructureClass === "ROAD" || ownerInfrastructureClass === "HIGHWAY")) ||
    (ownerPrimaryMode === "SEA" && ownerInfrastructureClass === "SEA_ROUTE") ||
    (ownerPrimaryMode === "AIR" && ownerInfrastructureClass === "AIRSHIP_ROUTE") ||
    (ownerPrimaryMode === "PORTAL_ONLY" && ownerInfrastructureClass === "PORTAL_ONLY");
  if (!validPair) throw new Error(`${corridorId}: owner mode/infrastructure is not an allowed pair`);
  if (typeof row.ownerPortalCapability !== "boolean") throw new Error(`${corridorId}: ownerPortalCapability must be boolean`);
  if (typeof row.ownerTradeDesignation !== "boolean") throw new Error(`${corridorId}: ownerTradeDesignation must be boolean`);
  if (ownerPrimaryMode === "PORTAL_ONLY" && row.ownerPortalCapability !== true) throw new Error(`${corridorId}: PORTAL_ONLY requires ownerPortalCapability=true`);
  return {
    corridorId,
    ownerDecisionStatus: row.ownerDecisionStatus,
    ownerPrimaryMode,
    ownerInfrastructureClass,
    ownerPortalCapability: row.ownerPortalCapability,
    ownerTradeDesignation: row.ownerTradeDesignation,
    ownerEvidenceRef: requireString(row.ownerEvidenceRef, "ownerEvidenceRef"),
    recommendationEvidence: row.recommendationEvidence === undefined || row.recommendationEvidence === null ? null : requireString(row.recommendationEvidence, "recommendationEvidence"),
  };
}

export function parseRouteClassificationAuthority(value: unknown, expectedCorridorIds?: ReadonlySet<string>): RouteClassificationAuthorityV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Route classification authority must be an object");
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== ROUTE_CLASSIFICATION_SCHEMA_VERSION) throw new Error(`Route classification schemaVersion must be ${ROUTE_CLASSIFICATION_SCHEMA_VERSION}`);
  const classifications = Array.isArray(row.classifications) ? row.classifications.map(parseDecision) : (() => { throw new Error("Route classification classifications must be an array"); })();
  const seen = new Set<string>();
  for (const decision of classifications) {
    if (seen.has(decision.corridorId)) throw new Error(`Duplicate Route classification for ${decision.corridorId}`);
    if (expectedCorridorIds && !expectedCorridorIds.has(decision.corridorId)) throw new Error(`Unknown Route corridor ${decision.corridorId}`);
    seen.add(decision.corridorId);
  }
  const authorityStatus = classifications.length === 0 ? "NO_OWNER_DECISIONS" : "OWNER_APPROVED_NONCAUSAL_OVERLAY";
  if (row.authorityStatus !== authorityStatus) throw new Error(`Route classification authorityStatus must be ${authorityStatus}`);
  return {
    schemaVersion: ROUTE_CLASSIFICATION_SCHEMA_VERSION,
    authorityVersion: requireString(row.authorityVersion, "authorityVersion"),
    authorityStatus,
    approvedAt: row.approvedAt === null ? null : requireString(row.approvedAt, "approvedAt"),
    classifications: classifications.sort((left, right) => left.corridorId.localeCompare(right.corridorId)),
  };
}

export function loadRouteClassificationAuthority(resourceDirectory: string, corridors?: readonly RouteCorridorAuthorityV1[]): RouteClassificationAuthorityV1 {
  const path = join(resourceDirectory, ROUTE_CLASSIFICATION_AUTHORITY_RELATIVE_PATH);
  if (!existsSync(path)) return EMPTY_AUTHORITY;
  return parseRouteClassificationAuthority(JSON.parse(readFileSync(path, "utf8")), corridors ? new Set(corridors.map((corridor) => corridor.corridorId)) : undefined);
}

export function effectiveRouteClassification(corridor: RouteCorridorAuthorityV1, authority: RouteClassificationAuthorityV1 = EMPTY_AUTHORITY): EffectiveRouteClassificationV1 {
  const decision = authority.classifications.find((candidate) => candidate.corridorId === corridor.corridorId);
  if (!decision) return {
    corridorId: corridor.corridorId,
    semanticReadiness: "NOT_READY",
    classificationStatus: "OWNER_APPROVAL_REQUIRED",
    classificationAuthorityVersion: null,
    effectivePrimaryMode: "UNRESOLVED",
    effectiveInfrastructureClass: "UNRESOLVED",
    portalCapability: corridor.portalCapability,
    tradeDesignation: corridor.tradeDesignation,
    ownerEvidenceRef: null,
  };
  return {
    corridorId: corridor.corridorId,
    semanticReadiness: "READY",
    classificationStatus: "OWNER_APPROVED",
    classificationAuthorityVersion: authority.authorityVersion,
    effectivePrimaryMode: decision.ownerPrimaryMode === "PORTAL_ONLY" ? "NONE" : decision.ownerPrimaryMode,
    effectiveInfrastructureClass: decision.ownerInfrastructureClass === "PORTAL_ONLY" ? "NONE" : decision.ownerInfrastructureClass,
    portalCapability: decision.ownerPortalCapability,
    tradeDesignation: decision.ownerTradeDesignation,
    ownerEvidenceRef: decision.ownerEvidenceRef,
  };
}
