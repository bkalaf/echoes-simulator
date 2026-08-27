import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  dominantFactionsWithinTolerance,
  projectBreedFaction,
} from "../../src/core/research/breed-faction-projection.js";
import { RAW_DIMENSIONS } from "../../src/core/research/v4-contract.js";

type WorldKey = "CONCORD" | "SCHISM" | "RUIN";
const mapping = JSON.parse(readFileSync("resources/reference/property_faction_mapping.json", "utf8")) as Record<string, Record<WorldKey, string>>;
const key = (field: string): string => `${field[0]!.toUpperCase()}${field.slice(1)}`;

function dimensions(factions: readonly WorldKey[]): Record<string, { value: string }> {
  return Object.fromEntries(RAW_DIMENSIONS.map((field, index) => [field, { value: mapping[key(field)]![factions[index]!] }])) as Record<string, { value: string }>;
}

describe("persisted Breed faction projection", () => {
  it("awards one point for each of the twelve controlled attribute matches", () => {
    expect(projectBreedFaction(dimensions(Array<WorldKey>(12).fill("CONCORD")), mapping)).toEqual({
      factionObject: { CONCORD: 12, SCHISM: 0, RUIN: 0 },
      dominantFaction: ["CONCORD"],
    });
  });

  it("persists multiple leading WorldKeys and applies the inclusive one-point tolerance", () => {
    expect(projectBreedFaction(dimensions([...Array<WorldKey>(6).fill("CONCORD"), ...Array<WorldKey>(6).fill("SCHISM")]), mapping)).toEqual({
      factionObject: { CONCORD: 6, SCHISM: 6, RUIN: 0 },
      dominantFaction: ["CONCORD", "SCHISM"],
    });
    expect(dominantFactionsWithinTolerance({ CONCORD: 10, SCHISM: 9, RUIN: 4 }, 1)).toEqual(["CONCORD", "SCHISM"]);
    expect(dominantFactionsWithinTolerance({ CONCORD: 10, SCHISM: 8, RUIN: 4 }, 1)).toEqual(["CONCORD"]);
  });

  it("rejects an uncontrolled attribute instead of silently omitting its points", () => {
    const invalid = dimensions(Array<WorldKey>(12).fill("RUIN"));
    invalid.motivation = { value: "UNKNOWN" };
    expect(() => projectBreedFaction(invalid, mapping)).toThrow(/motivation.*UNKNOWN/i);
  });
});
