import { createHash } from "node:crypto";
import { canonicalJson } from "../serialization/canonical-json.js";

const WORLD_PATTERN = /CONCORD|SCHISM|RUIN/g;
const IDENTITY_ONLY_KEYS = new Set(["worldKey", "world", "rawWorldKey"]);

function normalizeIdentityString(value: string): string {
  if (/^(CONCORD|SCHISM|RUIN)$/.test(value)) return "WORLD";
  // Only stable-ID-shaped strings are identity-normalized. Narrative and other
  // semantic text must remain intact so genuine cross-world divergence cannot
  // disappear from the comparison hash.
  return /^[A-Z0-9:_-]+$/.test(value) ? value.replace(WORLD_PATTERN, "WORLD") : value;
}

export function normalizeWorldNeutralCausalContentV1(value: unknown): unknown {
  if (typeof value === "string") return normalizeIdentityString(value);
  if (typeof value === "bigint" || typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(normalizeWorldNeutralCausalContentV1);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !IDENTITY_ONLY_KEYS.has(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, normalizeWorldNeutralCausalContentV1(child)]));
  }
  throw new Error(`Unsupported causal value ${typeof value}`);
}

export function worldNeutralCausalHashV1(value: unknown): string {
  return createHash("sha256").update(canonicalJson(normalizeWorldNeutralCausalContentV1(value)), "utf8").digest("hex");
}

export function assertWorldNeutralCausalEqualityV1(values: readonly unknown[]): string {
  if (values.length < 2) throw new Error("World-neutral equality requires at least two values");
  const hashes = values.map(worldNeutralCausalHashV1);
  if (new Set(hashes).size !== 1) throw new Error(`World-neutral causal mismatch: ${hashes.join(",")}`);
  return hashes[0]!;
}
