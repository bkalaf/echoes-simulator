import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  auditPersonalityDimensionPolicy,
  buildPersonalityDimensionPolicy,
  type PersonalityDimensionPolicy,
} from "../core/research/personality-dimension-policy.js";

const root = resolve(process.cwd());
const registryPath = resolve(root, "resources/personality/personality-expression-registry-v3.json");
const outputDirectory = resolve(root, "resources/research-v4/personality");
const registryBytes = readFileSync(registryPath);
const registry = JSON.parse(registryBytes.toString("utf8")) as { personalityId: string; family: string; expression: string }[];

function jsonl(rows: readonly unknown[]): string { return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`; }
function sha256(bytes: Buffer | string): string { return createHash("sha256").update(bytes).digest("hex"); }

export function writePersonalityDimensionPolicy(policy: PersonalityDimensionPolicy): void {
  const audit = auditPersonalityDimensionPolicy(policy, registry);
  if (audit.status !== "PASS") throw new Error(`Personality policy audit failed: ${JSON.stringify(audit)}`);
  mkdirSync(outputDirectory, { recursive: true });
  const familyBytes = jsonl(policy.familyProfiles);
  const overrideBytes = jsonl(policy.expressionReviews);
  const effectiveBytes = jsonl(policy.effectiveProfiles);
  writeFileSync(resolve(outputDirectory, "personality_family_dimension_profiles_v1.jsonl"), familyBytes);
  writeFileSync(resolve(outputDirectory, "personality_expression_dimension_overrides_v1.jsonl"), overrideBytes);
  writeFileSync(resolve(outputDirectory, "personality_expression_effective_profiles_v1.jsonl"), effectiveBytes);
  writeFileSync(resolve(outputDirectory, "personality_dimension_policy_audit.json"), `${JSON.stringify({
    ...audit,
    schemaVersion: "eidolon-personality-dimension-policy-audit-v1",
    sourceRegistry: { path: "resources/personality/personality-expression-registry-v3.json", sha256: sha256(registryBytes), rows: registry.length },
    outputHashes: {
      familyProfilesSha256: sha256(familyBytes),
      expressionReviewsSha256: sha256(overrideBytes),
      effectiveProfilesSha256: sha256(effectiveBytes),
    },
  }, null, 2)}\n`);
}

writePersonalityDimensionPolicy(buildPersonalityDimensionPolicy(registry));
console.log(JSON.stringify({ status: "PASS", families: 80, expressions: registry.length, outputDirectory }, null, 2));
