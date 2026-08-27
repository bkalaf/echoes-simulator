import { createHash } from "node:crypto";

export const KEYED_RANDOM_VERSION_V1 = "echoes-keyed-random-sha256-v1";
export const V5_RANDOM_NAMESPACES = [
  "GOVERNMENT_TRANSITION_ROUTINE", "BORDER_SKIRMISH_DECLARATION", "BORDER_SKIRMISH_OUTCOME", "BORDER_WAR_DECLARATION", "BORDER_PEACE",
  "WAR_EPISODE_INTENSITY", "WAR_EPISODE_OUTCOME", "ORGANIZATION_FORMATION_CORPORATION", "ORGANIZATION_FORMATION_CRIME",
  "FAMILY_RELATION_ALLIANCE", "FAMILY_RELATION_RIVALRY", "STATE_SECESSION_DECISION", "OFFICE_CANDIDATE_SELECTION", "POLITICAL_PERSON_SOURCE",
  "POLITICAL_PERSON_ACTIVATION_AGE", "POLITICAL_PERSON_CURRENT_AGE", "POLITICAL_PERSON_RETIREMENT_AGE", "POLITICAL_PERSON_NATURAL_DEATH_AGE",
] as const;
export type V5RandomNamespace = (typeof V5_RANDOM_NAMESPACES)[number];

export interface KeyedRandomIdentity {
  normalizedSeed: string;
  randomNamespace: V5RandomNamespace;
  comparisonEntityId: string;
  year: number;
  candidateOrDecisionKey: string;
}

export function normalizeSeed(seed: string): string {
  if (!seed) throw new Error("V5 seed is required");
  return createHash("sha256").update(seed.normalize("NFC"), "utf8").digest("hex");
}

export function normalizeComparisonIdentity(value: string): string {
  return value.normalize("NFC").replace(/CONCORD|SCHISM|RUIN/g, "WORLD");
}

export function keyedRandomDigest(identity: KeyedRandomIdentity): string {
  return createHash("sha256").update([
    identity.normalizedSeed,
    KEYED_RANDOM_VERSION_V1,
    identity.randomNamespace,
    normalizeComparisonIdentity(identity.comparisonEntityId),
    String(identity.year),
    normalizeComparisonIdentity(identity.candidateOrDecisionKey),
  ].join("\0"), "utf8").digest("hex");
}

export function keyedDrawBps(identity: KeyedRandomIdentity): number {
  const digest = Buffer.from(keyedRandomDigest(identity), "hex");
  return Number(digest.readBigUInt64BE(0) % 10_000n);
}

export function keyedInteger(identity: KeyedRandomIdentity, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || maximum < minimum) throw new Error("Invalid keyed integer range");
  const digest = Buffer.from(keyedRandomDigest(identity), "hex");
  return minimum + Number(digest.readBigUInt64BE(0) % BigInt(maximum - minimum + 1));
}
