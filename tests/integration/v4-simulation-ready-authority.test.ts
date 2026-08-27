import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { openValidatedZip, parseJsonLines, sha256 } from "../../src/core/inputs/importer.js";
import { BREED_DIMENSION_BALANCE_POLICY, PERSONALITY_DIMENSION_POLICY, RAW_DIMENSIONS } from "../../src/core/research/v4-contract.js";

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
    expect(identities).toHaveLength(2062);
    expect(effective).toHaveLength(1779);
    expect(pets).toHaveLength(283);
    expect(units).toHaveLength(1225);
    expect(evidence).toHaveLength(3675);
    expect(new Set(identities.map((row) => row.breedId)).size).toBe(2062);
  });

  it("has full non-null civic critical semantics with audited Personality values and explicit balance overrides", () => {
    const effective = parseJsonLines(member("effective_breed_semantics.jsonl"));
    const report = JSON.parse(strFromU8(member("breed_dimension_balance_report.json"))) as { totalCivicBreeds: number; targetPerValue: number; totalChangedAssignments: number; changedBreeds: number; byField: Record<string, { values: Record<string, string>; after: Record<string, number> }> };
    const changes = parseJsonLines(member("breed_dimension_balance_changes.jsonl"));
    for (const row of effective) {
      expect(row.personalityId).toEqual(expect.any(String));
      expect(row.terrainBroad).toEqual(expect.arrayContaining([expect.any(String)]));
      expect(row.terrainSpecific).toEqual(expect.arrayContaining([expect.any(String)]));
      for (const field of RAW_DIMENSIONS) {
        const dimension = (row.dimensions as Record<string, { value: string; disposition: string; policyRef: string }>)[field]!;
        expect(dimension.value).toEqual(expect.any(String));
        expect([
          ["OWNER_POLICY_VALUE", PERSONALITY_DIMENSION_POLICY],
          ["OWNER_BALANCED_VALUE", BREED_DIMENSION_BALANCE_POLICY],
        ]).toContainEqual([dimension.disposition, dimension.policyRef]);
      }
      expect(row.factionObject).toEqual({ CONCORD: expect.any(Number), SCHISM: expect.any(Number), RUIN: expect.any(Number) });
      expect(Object.values(row.factionObject as Record<string, number>).reduce((sum, score) => sum + score, 0)).toBe(12);
      expect(row.dominantFaction).toEqual(expect.arrayContaining([expect.stringMatching(/^(CONCORD|SCHISM|RUIN)$/)]));
    }
    expect(report).toMatchObject({ totalCivicBreeds: 1779, targetPerValue: 593 });
    expect(changes).toHaveLength(report.totalChangedAssignments);
    expect(new Set(changes.map((change) => change.breedId)).size).toBe(report.changedBreeds);
    for (const field of RAW_DIMENSIONS) {
      expect(Object.values(report.byField[field]!.after)).toEqual([593, 593, 593]);
      const values = Object.values(report.byField[field]!.values);
      expect(values.map((value) => effective.filter((row) => (row.dimensions as Record<string, { value: string }>)[field]!.value === value).length)).toEqual([593, 593, 593]);
    }
    const coverage = JSON.parse(strFromU8(member("critical_coverage.json"))) as Record<string, { civicResolved: number; invalidUnresolved: number }>;
    expect(Object.values(coverage).every((row) => row.civicResolved === 1779 && row.invalidUnresolved === 0)).toBe(true);
  });

  it("persists explicit policy-null faction projections for all PET Breeds", () => {
    const pets = parseJsonLines(member("pet_policy_semantics.jsonl"));
    expect(pets).toHaveLength(283);
    expect(pets.every((row) => {
      const scores = row.factionObject as Record<string, number> | undefined;
      return scores?.CONCORD === 0 && scores.SCHISM === 0 && scores.RUIN === 0 && Array.isArray(row.dominantFaction) && row.dominantFaction.length === 0 && row.factionDisposition === "POLICY_NULL";
    })).toBe(true);
  });

  it("has an independent zero-finding acceptance and deterministic recorded hash", () => {
    const acceptance = JSON.parse(readFileSync(resolve(root, "artifacts/research-v4/acceptance/v4_adversarial_acceptance.json"), "utf8"));
    expect(acceptance).toMatchObject({ verdict: "ACCEPT_SIMULATION_READY", safeToImport: true, researchCompletionClaimSupported: true, structuralIntegrityPassed: true, semanticEvidenceIntegrityPassed: true, counts: { findings: 0 } });
    expect(acceptance.archive.sha256).toBe(sha256(readFileSync(filename)));
  });
});
