import { describe, expect, it } from "vitest";
import { CANDIDATE_CLASS_POLICY_V1 } from "../../src/core/v5/config.js";
import { initialOwnerPolicyCenterV56, LOCKED_OWNER_AUTHORITIES_V56 } from "../../src/core/v5/owner-policy-center.js";
import { NON_REFUGE_FOOD_SPECIFIC_V1 } from "../../src/core/v5/sustenance.js";
import { defaultOwnerPolicyEffectiveYear } from "../../src/persistence/postgres-owner-policy.js";

describe("corrected Owner Policy Center V5.6", () => {
  const policies = initialOwnerPolicyCenterV56();
  const ids = new Set(policies.map((policy) => policy.policyId));

  it("keeps locked owner structure outside the candidate approval state", () => {
    expect(LOCKED_OWNER_AUTHORITIES_V56).toHaveLength(12);
    expect(LOCKED_OWNER_AUTHORITIES_V56.every((authority) => authority.authorityId && authority.statement)).toBe(true);
    expect(policies.every((policy) => policy.status === "UNREVIEWED" && (policy.reviewAuthority === "SEMANTIC" || policy.reviewAuthority === "NUMERIC"))).toBe(true);
  });

  it("represents class percentages as basis points without approving them", () => {
    expect(CANDIDATE_CLASS_POLICY_V1.tierWeights).toEqual({
      HIGH: { NOBILITY: 7000, INTELLECTUAL: 2000, WORKER: 800, WANDERER: 200 },
      MID: { NOBILITY: 1000, INTELLECTUAL: 4000, WORKER: 4500, WANDERER: 500 },
      LOW: { NOBILITY: 0, INTELLECTUAL: 1000, WORKER: 7000, WANDERER: 2000 },
    });
    expect(Object.values(CANDIDATE_CLASS_POLICY_V1.tierWeights).map((tier) => Object.values(tier).reduce((sum, value) => sum + value, 0))).toEqual([10000, 10000, 10000]);
    expect(policies.find((policy) => policy.policyId === "CLASS_POLICY")?.status).toBe("UNREVIEWED");
  });

  it("uses one primary-harm family and reviews only the new 17B year", () => {
    expect(ids.has("ATROCITY_PRIMARY_HARM_PROFILES")).toBe(true);
    expect(ids.has("ATROCITY_HARM_PROFILES")).toBe(false);
    expect(ids.has("ATROCITY_MORTALITY_DISPLACEMENT")).toBe(false);
    expect(ids.has("ATROCITY_17_B_SCHEDULE")).toBe(true);
    expect(ids.has("ATROCITY_17_AB_SCHEDULE")).toBe(false);
    expect(LOCKED_OWNER_AUTHORITIES_V56.find((authority) => authority.authorityId === "ATROCITY_17_A_INHERITED_SCHEDULE")?.statement).toContain("year-50");
  });

  it("provides independent semantic and numeric review for every non-Refuge FoodSpecific", () => {
    for (const foodSpecific of NON_REFUGE_FOOD_SPECIFIC_V1) {
      expect(ids.has(`SUSTENANCE_${foodSpecific}_SEMANTICS`)).toBe(true);
      expect(ids.has(`SUSTENANCE_${foodSpecific}_NUMERIC`)).toBe(true);
    }
    expect(policies.filter((policy) => /^SUSTENANCE_.*_SEMANTICS$/.test(policy.policyId))).toHaveLength(14);
    expect(policies.filter((policy) => /^SUSTENANCE_.*_NUMERIC$/.test(policy.policyId))).toHaveLength(14);
  });

  it("derives effective boundaries unless an explicit override is supplied", () => {
    expect(defaultOwnerPolicyEffectiveYear({ kind: "GENESIS" }, 80)).toBe(0);
    expect(defaultOwnerPolicyEffectiveYear({ kind: "SCHEDULED_BARRIER", defaultYear: 75 }, 20)).toBe(75);
    expect(defaultOwnerPolicyEffectiveYear({ kind: "SCHEDULED_BARRIER", defaultYear: 75 }, 80)).toBe(81);
    expect(defaultOwnerPolicyEffectiveYear({ kind: "ATOMIC_YEAR_BARRIER" }, 80)).toBe(81);
  });
});
