import { createHash } from "node:crypto";
import type { DivergenceReportV1 } from "./read-model.js";

export const V5_REMEDIATION_DIVERGENCE_REGRESSION_SCOPE = {
  normalizedSeed: "a053c88c32a6329002868ee4a4700cb017849b1a72db4262b925cbd7d0da6e72",
  canonicalBundleHash: "93c4295284048cf7e4250522993dcd8f91e563dc614b23735f6fe8cbc39ae427",
  mechanicsVersion: "echoes-mechanics-v5.1.0",
  causalDerivationVersion: "echoes-derived-metrics-v1.1.0",
  comparisonSetVersion: "echoes-v5-comparison-registry-203-baseline-v1",
  comparisonSetHash: "dee80a6a3700fcdf3817310863893abc1060687e48a265007492c6046af1bfe1",
} as const;

export const V5_REMEDIATION_DIVERGENCE_REGRESSION_EXPECTED = { total: 203, identical: 132, minor: 15, material: 56 } as const;

export function divergenceComparisonSetHash(report: DivergenceReportV1): string {
  return createHash("sha256").update(`${report.items.map((item) => item.comparisonId).join("\n")}\n`).digest("hex");
}

export function validateScopedV5DivergenceRegression(input: {
  normalizedSeed: string;
  canonicalBundleHash: string;
  mechanicsVersion: string;
  causalDerivationVersion: string;
  comparisonSetVersion: string;
  report: DivergenceReportV1;
}): { applies: boolean; pass: boolean; actual: { total: number; identical: number; minor: number; material: number }; reason: string } {
  const actual = {
    total: input.report.items.length,
    identical: input.report.items.filter((item) => item.classification === "IDENTICAL").length,
    minor: input.report.items.filter((item) => item.classification === "MINOR_VARIANT").length,
    material: input.report.items.filter((item) => item.classification === "MATERIAL_DIVERGENCE").length,
  };
  const comparisonSetHash = divergenceComparisonSetHash(input.report);
  const applies = input.normalizedSeed === V5_REMEDIATION_DIVERGENCE_REGRESSION_SCOPE.normalizedSeed
    && input.canonicalBundleHash === V5_REMEDIATION_DIVERGENCE_REGRESSION_SCOPE.canonicalBundleHash
    && input.mechanicsVersion === V5_REMEDIATION_DIVERGENCE_REGRESSION_SCOPE.mechanicsVersion
    && input.causalDerivationVersion === V5_REMEDIATION_DIVERGENCE_REGRESSION_SCOPE.causalDerivationVersion
    && input.comparisonSetVersion === V5_REMEDIATION_DIVERGENCE_REGRESSION_SCOPE.comparisonSetVersion
    && comparisonSetHash === V5_REMEDIATION_DIVERGENCE_REGRESSION_SCOPE.comparisonSetHash;
  if (!applies) return { applies: false, pass: true, actual, reason: "NOT_APPLICABLE_TO_THIS_SEED_CANONICAL_MECHANICS_DERIVATION_OR_REGISTERED_COMPARISON_SET" };
  const pass = Object.entries(V5_REMEDIATION_DIVERGENCE_REGRESSION_EXPECTED).every(([key, value]) => actual[key as keyof typeof actual] === value);
  return { applies: true, pass, actual, reason: pass ? "SCOPED_STABILIZATION_BASELINE_PRESERVED" : "SCOPED_STABILIZATION_BASELINE_REGRESSION" };
}
