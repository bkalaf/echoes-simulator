import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CanonicalDataV5 } from "../../src/core/v5/config.js";
import { buildRunAuthoritySnapshotV1 } from "../../src/core/v5/authority-snapshot.js";
import { canonicalJson } from "../../src/core/serialization/canonical-json.js";
import { canonicalV5FromRunAuthoritySnapshot, canonicalV5FromRunAuthoritySnapshotForRead, V5_CANONICAL_CORE_AUTHORITY_ID } from "../../src/persistence/postgres-canonical.js";

const hash = (value: unknown): string => createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");

describe("capability-level PostgreSQL canonical authority", () => {
  it("replays a core-only immutable snapshot without mutable PostgreSQL or Breed-Deity", () => {
    const core: CanonicalDataV5 = {
      schemaVersion: "echoes-canonical-data-v5",
      canonicalBundleHash: "source-bundle",
      breeds: [], sites: [], regions: [], governments: [], economicForms: [], physicalPois: [], routeCorridors: [],
      sovereigns: {} as CanonicalDataV5["sovereigns"],
      groupRegionAssignments: {} as CanonicalDataV5["groupRegionAssignments"],
      initialSettlements: [], canonicalLabels: {}, canonicalLabelAuthority: {}, canonicalEvents: [],
    };
    const revisionId = "CORE_RECONCILED_TEST";
    const snapshot = buildRunAuthoritySnapshotV1([{
      authorityId: V5_CANONICAL_CORE_AUTHORITY_ID,
      revisionId,
      authorityType: "MIGRATED_ACCEPTED_CANONICAL_AGGREGATE",
      schemaVersion: core.schemaVersion,
      approvedBy: "DETERMINISTIC_MIGRATION_TEST",
      approvedAt: "2026-08-30T00:00:00.000Z",
      effectiveFromYear: 0,
      content: core,
    }]);
    const expectedBundleHash = hash({ canonicalCoreRevisionId: revisionId, canonicalCoreSha256: hash(core) });
    expect(canonicalV5FromRunAuthoritySnapshot(snapshot, expectedBundleHash, 100).canonicalBundleHash).toBe(expectedBundleHash);
    expect(canonicalV5FromRunAuthoritySnapshotForRead(snapshot, expectedBundleHash, 100)?.canonicalBundleHash).toBe(expectedBundleHash);
  });
});
