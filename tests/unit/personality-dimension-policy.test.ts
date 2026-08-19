import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  auditPersonalityDimensionPolicy,
  buildPersonalityDimensionPolicy,
  CONTROLLED_DIMENSION_VALUES,
} from "../../src/core/research/personality-dimension-policy";
import registry from "../../resources/personality/personality-expression-registry-v3.json";

describe("PERSONALITY_PROFILE_DIMENSIONS_V1", () => {
  const policy = buildPersonalityDimensionPolicy(registry);

  it("covers every current family and expression exactly once", () => {
    const families = new Set(registry.map((row) => row.family));
    expect(families.size).toBe(80);
    expect(registry).toHaveLength(369);
    expect(policy.familyProfiles).toHaveLength(families.size);
    expect(new Set(policy.familyProfiles.map((row) => row.family))).toEqual(families);
    expect(policy.expressionReviews).toHaveLength(registry.length);
    expect(new Set(policy.expressionReviews.map((row) => row.personalityId)).size).toBe(registry.length);
  });

  it("resolves all twelve controlled dimensions without nulls", () => {
    expect(policy.effectiveProfiles).toHaveLength(registry.length);
    for (const profile of policy.effectiveProfiles) {
      expect(Object.keys(profile.dimensions).sort()).toEqual(Object.keys(CONTROLLED_DIMENSION_VALUES).sort());
      for (const [field, value] of Object.entries(profile.dimensions)) {
        expect(CONTROLLED_DIMENSION_VALUES[field as keyof typeof CONTROLLED_DIMENSION_VALUES]).toContain(value);
      }
    }
  });

  it("is deterministic and audits cleanly", () => {
    expect(buildPersonalityDimensionPolicy(registry)).toEqual(policy);
    const audit = auditPersonalityDimensionPolicy(policy, registry);
    expect(audit.status).toBe("PASS");
    expect(audit.missingFields).toEqual([]);
    expect(audit.invalidEnums).toEqual([]);
    expect(audit.expressionsMissingFamily).toEqual([]);
    expect(audit.overridesWithoutSemanticRationale).toEqual([]);
    expect(audit.exactFactionArchetypeProfiles).toEqual([]);
    expect(audit.unjustifiedDuplicateProfileGroups).toEqual([]);
  });

  it("records a semantic review and rationale for every expression", () => {
    for (const review of policy.expressionReviews) {
      expect(review.reviewed).toBe(true);
      expect(review.reviewRationale.length).toBeGreaterThan(20);
      for (const override of Object.values(review.overrides)) {
        expect(override.rationale.length).toBeGreaterThan(20);
      }
    }
    expect(policy.expressionReviews.some((row) => Object.keys(row.overrides).length > 0)).toBe(true);
  });

  it("does not implement the forbidden faction-template shortcut", () => {
    const source = readFileSync(resolve("src/core/research/personality-dimension-policy.ts"), "utf8");
    expect(source).not.toMatch(/dominantFaction/);
    expect(source).not.toMatch(/property_faction_mapping/);
  });

  it("publishes the audited versioned policy authority", () => {
    const directory = resolve("resources/research-v4/personality");
    const readJsonl = (name: string) => readFileSync(resolve(directory, name), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(readJsonl("personality_family_dimension_profiles_v1.jsonl")).toEqual(policy.familyProfiles);
    expect(readJsonl("personality_expression_dimension_overrides_v1.jsonl")).toEqual(policy.expressionReviews);
    expect(readJsonl("personality_expression_effective_profiles_v1.jsonl")).toEqual(policy.effectiveProfiles);
    const audit = JSON.parse(readFileSync(resolve(directory, "personality_dimension_policy_audit.json"), "utf8"));
    expect(audit.status).toBe("PASS");
    expect(audit.counts).toEqual({ families: 80, expressions: 369, effectiveProfiles: 369, overrides: 48 });
    expect(audit.exactFactionArchetypeProfiles).toEqual([]);
  });
});
