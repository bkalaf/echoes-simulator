import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CanonicalDataStatus } from "../operator/operator-state.js";

export interface CanonicalBundleRuntime extends CanonicalDataStatus {
  directory: string;
  manifest: Record<string, unknown> | null;
}

function sha256(data: Uint8Array | string): string { return createHash("sha256").update(data).digest("hex"); }

export function loadBundledCanonical(resourceDirectory: string): CanonicalBundleRuntime {
  const directory = resolve(resourceDirectory, "canonical");
  try {
    const manifestPath = resolve(directory, "canonical_bundle_manifest.json");
    if (!existsSync(manifestPath)) throw new Error("canonical_bundle_manifest.json is missing");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown> & { requiredFiles?: Record<string, string> };
    if (manifest.schemaVersion !== "eidolon-canonical-bundle-manifest-v1" || manifest.buildReady !== true) throw new Error("canonical manifest is not build-ready");
    if (manifest.breedSemanticVersion !== "V4" || manifest.breedSemanticVerdict !== "ACCEPT_SIMULATION_READY" || manifest.year0ReadinessStatus !== "PASS" || manifest.personalityPolicyVersion !== "PERSONALITY_PROFILE_DIMENSIONS_V1" || manifest.breedDimensionPolicyVersion !== "BREED_DIMENSION_BALANCE_V1" || manifest.breedFactionPolicyVersion !== "BREED_FACTION_PROJECTION_V1") throw new Error("canonical authority, policy, or year-0 readiness version is stale");
    if (typeof manifest.researchCorpusImportVersion !== "string" || !["COMPLETED", "COMPLETED_WITH_WARNINGS", "COMPLETED_WITH_BLOCKERS"].includes(String(manifest.researchCorpusImportStatus)) || manifest.researchCorpusManifest !== "research-corpus/IMPORT_MANIFEST.json") throw new Error("record-by-record research corpus import is absent or incomplete");
    for (const [name, hash] of Object.entries(manifest.requiredFiles ?? {})) {
      const filename = resolve(directory, name);
      if (!existsSync(filename)) throw new Error(`${name} is missing`);
      if (sha256(readFileSync(filename)) !== hash) throw new Error(`${name} failed its bundled checksum`);
    }
    const authority = resolve(directory, "breeds", String(manifest.breedSemanticFilename));
    if (sha256(readFileSync(authority)) !== manifest.breedSemanticSha256) throw new Error("bundled V4 semantic ZIP hash mismatch");
    return {
      status: "READY", directory, manifest,
      semanticAuthorityVersion: String(manifest.breedSemanticVersion), semanticAuthorityFilename: String(manifest.breedSemanticFilename),
      semanticAuthoritySha256: String(manifest.breedSemanticSha256), semanticAuthorityVerdict: String(manifest.breedSemanticVerdict),
      year0Readiness: String(manifest.year0ReadinessStatus), ownerPolicyVersion: String(manifest.ownerPolicyVersion), personalityPolicyVersion: String(manifest.personalityPolicyVersion),
      bundleVersion: String(manifest.bundleVersion), bundleContentSha256: String(manifest.contentSha256),
    };
  } catch (error) {
    return {
      status: "INVALID", directory, manifest: null,
      semanticAuthorityVersion: null, semanticAuthorityFilename: null, semanticAuthoritySha256: null, semanticAuthorityVerdict: null,
      year0Readiness: null, ownerPolicyVersion: null, personalityPolicyVersion: null, bundleVersion: null, bundleContentSha256: null,
      errorCode: "BUNDLED_CANONICAL_DATA_INVALID", errorDetail: error instanceof Error ? error.message : String(error),
    };
  }
}
