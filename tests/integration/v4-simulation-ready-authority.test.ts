import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { openValidatedZip, parseJsonLines, sha256 } from "../../src/core/inputs/importer.js";
import { RAW_DIMENSIONS } from "../../src/core/research/v4-contract.js";

const root = resolve(".");
const filename = resolve(root, "ECHOES_OF_EIDOLON_BREED_SEMANTICS_V4_SIMULATION_READY.zip");
const archive = openValidatedZip(filename);
const member = (name: string) => archive.entries[`${archive.prefix}${name}`]!;

describe("V4 simulation-ready semantic authority", () => {
  it("preserves exact identity, civic, PET, unit, audit, and evidence coverage", () => {
    const identities = parseJsonLines(member("canonical_breed_identities.jsonl"));
    const effective = parseJsonLines(member("effective_breed_semantics.jsonl"));
    const pets = parseJsonLines(member("pet_policy_semantics.jsonl"));
    const units = parseJsonLines(member("research_units.jsonl"));
    const evidence = parseJsonLines(member("evidence.jsonl"));
    expect(identities).toHaveLength(2056);
    expect(effective).toHaveLength(1773);
    expect(pets).toHaveLength(283);
    expect(units).toHaveLength(1219);
    expect(evidence).toHaveLength(3657);
    expect(new Set(identities.map((row) => row.breedId)).size).toBe(2056);
  });

  it("has full non-null civic critical semantics from the audited Personality policy", () => {
    const effective = parseJsonLines(member("effective_breed_semantics.jsonl"));
    for (const row of effective) {
      expect(row.personalityId).toEqual(expect.any(String));
      expect(row.terrainBroad).toEqual(expect.arrayContaining([expect.any(String)]));
      expect(row.terrainSpecific).toEqual(expect.arrayContaining([expect.any(String)]));
      for (const field of RAW_DIMENSIONS) expect((row.dimensions as Record<string, unknown>)[field]).toMatchObject({ disposition: "OWNER_POLICY_VALUE", policyRef: "PERSONALITY_PROFILE_DIMENSIONS_V1", value: expect.any(String) });
    }
    const coverage = JSON.parse(strFromU8(member("critical_coverage.json"))) as Record<string, { civicResolved: number; invalidUnresolved: number }>;
    expect(Object.values(coverage).every((row) => row.civicResolved === 1773 && row.invalidUnresolved === 0)).toBe(true);
  });

  it("has an independent zero-finding acceptance and deterministic recorded hash", () => {
    const acceptance = JSON.parse(readFileSync(resolve(root, "artifacts/research-v4/acceptance/v4_adversarial_acceptance.json"), "utf8"));
    expect(acceptance).toMatchObject({ verdict: "ACCEPT_SIMULATION_READY", safeToImport: true, researchCompletionClaimSupported: true, structuralIntegrityPassed: true, semanticEvidenceIntegrityPassed: true, counts: { findings: 0 } });
    expect(acceptance.archive.sha256).toBe(sha256(readFileSync(filename)));
  });
});
