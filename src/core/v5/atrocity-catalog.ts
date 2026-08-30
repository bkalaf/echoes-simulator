import { createHash } from "node:crypto";
import { canonicalJson } from "../serialization/canonical-json.js";
import { V5_ATROCITY_OCCURRENCE_IDS, type WorldKey } from "./types.js";

export interface AtrocityNarrativeFormV1 {
  thematicSpine: string;
  scopeRule: string;
  targetRules: string;
  perpetratorsAndComplicity: string;
  publicResponse: string;
  reputationConsequences: string;
  pairedPillarMovement: string;
  migrationConsequences: string;
  religiousConsequences: string;
  familyConsequences: string;
  neighborEffects: string;
  historicalScar: string;
}

export interface AtrocityNumericPolicyFormV1 {
  harmSharePolicyId: "ATROCITY_HARM_SHARE";
  primaryHarmProfilePolicyId: "ATROCITY_PRIMARY_HARM_PROFILES";
  concentrationPolicyId: "ATROCITY_CONCENTRATION";
  spilloverPolicyId: "ATROCITY_SPILLOVER";
  persistencePolicyId: "ATROCITY_PERSISTENCE";
  trackedComponents: readonly ["UNIQUE_HARMED", "MORTALITY", "DISPLACEMENT", "DETENTION_LABOR", "EXCLUSION", "DENIAL", "SEIZURE", "GROWTH_SUPPRESSION", "SECONDARY_OVERLAP"];
}

export interface AtrocityWorldDefinitionV1 { definitionId: string; occurrenceId: typeof V5_ATROCITY_OCCURRENCE_IDS[number]; worldKey: WorldKey; narrative: AtrocityNarrativeFormV1; numericPolicy: AtrocityNumericPolicyFormV1; definitionSha256: string }

const THEMES: Readonly<Record<typeof V5_ATROCITY_OCCURRENCE_IDS[number], { spine: string; scope: string; mechanism: string }>> = {
  ATROCITY_17_A: { spine: "Book 18 / ZERO / founding narrative suppression", scope: "GLOBAL", mechanism: "founding exclusion and denial of recognized civic claims" },
  ATROCITY_17_B: { spine: "Book 17 / WHAT WE DID / concealment-retaliation-profiteering", scope: "REGIONAL", mechanism: "concealment, retaliatory status harm, and opportunistic extraction" },
  ATROCITY_16: { spine: "Book 16 / SLEEP / coercive institutional consolidation", scope: "GLOBAL", mechanism: "coercive institutional consolidation without Book/Witness phase identifiers" },
  ATROCITY_15: { spine: "Book 15 / BODIES", scope: "GLOBAL", mechanism: "identity control, conformity, and disenfranchisement" },
  ATROCITY_14: { spine: "Book 14 / NO RETURN", scope: "REGIONAL", mechanism: "normalized abuse and refusal to correct acknowledged harm" },
  ATROCITY_13: { spine: "Book 13 / CATACLYSM", scope: "REGIONAL", mechanism: "culpable discriminatory catastrophe triage distinct from the catastrophe itself" },
  ATROCITY_12: { spine: "Book 12 / THE CLEARANCE", scope: "LOCAL_WITH_NEIGHBOR_SPILLOVER", mechanism: "administrative exclusion, forced relocation, and clearance" },
  ATROCITY_11: { spine: "Book 11 / THE FAILED PEACE", scope: "REGIONAL", mechanism: "buried crimes, selective justice, and repeated harm" },
  ATROCITY_10: { spine: "Book 10 / WINTER", scope: "REGIONAL", mechanism: "restoration of discredited systems through nostalgia or conditional aid" },
  ATROCITY_09: { spine: "Book 9 / THE SIEGE", scope: "GLOBAL", mechanism: "coercive assignment, credential control, and patronage dependency" },
  ATROCITY_08: { spine: "Book 8 / SVALBARD", scope: "REGIONAL", mechanism: "retaliatory overcorrection and survivalist exclusion" },
  ATROCITY_07: { spine: "Book 7 / RELOCATION", scope: "GLOBAL", mechanism: "secrecy, surveillance, and restrictions that never sunset" },
  ATROCITY_06: { spine: "Book 6 / ARK 5", scope: "REGIONAL", mechanism: "collective guilt, system failure, and premature abandonment" },
  ATROCITY_05: { spine: "Book 5 / THE ENEMY FORMS", scope: "GLOBAL_OR_REGIONAL", mechanism: "alarmism, expedient coercion, and punitive exclusion" },
  ATROCITY_04: { spine: "Book 4 / THE CONTINGENCY", scope: "REGIONAL", mechanism: "principle evasion, bargaining away protection, and inherited debt" },
  ATROCITY_03: { spine: "Book 3 / THE BETTER FUTURE", scope: "LOCAL_OR_REGIONAL", mechanism: "hubristic projects and optimization that externalize harm" },
  ATROCITY_02: { spine: "Book 2 / THE SHOWCASE", scope: "REGIONAL", mechanism: "exception, coverup, spectacle, and scapegoating" },
  ATROCITY_01: { spine: "Book 1 / THE FIRST CRACKS", scope: "LOCAL_OR_REGIONAL", mechanism: "ordinary emergency compromise becoming systemic harm" },
};

const numericPolicy: AtrocityNumericPolicyFormV1 = { harmSharePolicyId: "ATROCITY_HARM_SHARE", primaryHarmProfilePolicyId: "ATROCITY_PRIMARY_HARM_PROFILES", concentrationPolicyId: "ATROCITY_CONCENTRATION", spilloverPolicyId: "ATROCITY_SPILLOVER", persistencePolicyId: "ATROCITY_PERSISTENCE", trackedComponents: ["UNIQUE_HARMED", "MORTALITY", "DISPLACEMENT", "DETENTION_LABOR", "EXCLUSION", "DENIAL", "SEIZURE", "GROWTH_SUPPRESSION", "SECONDARY_OVERLAP"] };

function direction(occurrenceId: typeof V5_ATROCITY_OCCURRENCE_IDS[number], worldKey: WorldKey): { perpetrator: string; counterPillar: string } {
  const late = Number(occurrenceId.match(/\d+/)?.[0] ?? 0) <= 9;
  if (worldKey === "CONCORD") return late ? { perpetrator: "Crown-aligned state apparatus", counterPillar: "Church protection and sanctuary" } : { perpetrator: "Church-aligned institutions with state complicity", counterPillar: "Crown protection and secular restraint" };
  if (worldKey === "RUIN") return late ? { perpetrator: "Intellectual and technocratic elite", counterPillar: "Hereditary protection and Family sponsorship" } : { perpetrator: "Hereditary elite and client Families", counterPillar: "Intellectual, legal, and credentialed opposition" };
  return late ? { perpetrator: "Wealth elite and personal oligarchic houses", counterPillar: "Corporate standardization and accountable access" } : { perpetrator: "Corporate actors and charter institutions", counterPillar: "Wealth-elite personal patronage and exceptions" };
}

export function buildAtrocityWorldDefinitionsV1(): AtrocityWorldDefinitionV1[] {
  return V5_ATROCITY_OCCURRENCE_IDS.flatMap((occurrenceId) => (["CONCORD", "SCHISM", "RUIN"] as const).map((worldKey) => {
    const theme = THEMES[occurrenceId];
    const pillars = direction(occurrenceId, worldKey);
    const narrative: AtrocityNarrativeFormV1 = {
      thematicSpine: theme.spine,
      scopeRule: theme.scope,
      targetRules: "Use only the accepted atomic Derogatory decision for this world/scope; never infer a target from stereotypes or local synthesis.",
      perpetratorsAndComplicity: `${pillars.perpetrator}; record direct perpetrators, institutional complicity, protection, refusal, and non-participation separately. Mechanism: ${theme.mechanism}.`,
      publicResponse: "Persist fear/compliance separately from grievance/unrest and record both public approval and protection/counter-mobilization.",
      reputationConsequences: "Update perpetration, complicity, protection, and refusal reputation as distinct evidence-backed consequences.",
      pairedPillarMovement: `Permit evidence-backed movement toward ${pillars.counterPillar}; do not force a quota or scripted outcome.`,
      migrationConsequences: "Persist source, destination, Breed, tier, count, reason, forced status, and group-safety cohort for every resulting transfer.",
      religiousConsequences: "Track sanctuary, complicity, loss of trust, conversion pressure, and plural protection without assuming uniform belief response.",
      familyConsequences: "Track Family sponsorship, relief, exploitation, propaganda, counter-mobilization, succession exposure, and durable reputation.",
      neighborEffects: "Apply approved direct-harm spillover only by redistributing the common unique-harmed budget; apply secondary consequence spillover to safety perceptions, propaganda, diplomacy, migration pressure, religion, Families, and routes without adding victims.",
      historicalScar: "Append durable event and scar records without rewriting prior harmed cohorts, aliases, decisions, or evidence. Approved current effects may decay, strengthen, reactivate, or interact with later history.",
    };
    const definitionId = `${occurrenceId}_${worldKey}`;
    return { definitionId, occurrenceId, worldKey, narrative, numericPolicy, definitionSha256: createHash("sha256").update(canonicalJson({ definitionId, occurrenceId, worldKey, narrative, numericPolicy })).digest("hex") };
  }));
}

export function validateAtrocityWorldDefinitionsV1(definitions: readonly AtrocityWorldDefinitionV1[]): void {
  if (definitions.length !== 54 || new Set(definitions.map((definition) => definition.definitionId)).size !== 54) throw new Error("Atrocity authority requires exactly 54 unique world definitions");
  for (const occurrenceId of V5_ATROCITY_OCCURRENCE_IDS) for (const worldKey of ["CONCORD", "SCHISM", "RUIN"] as const) if (!definitions.some((definition) => definition.occurrenceId === occurrenceId && definition.worldKey === worldKey)) throw new Error(`Missing atrocity definition ${occurrenceId} ${worldKey}`);
  if (new Set(definitions.map((definition) => definition.numericPolicy.harmSharePolicyId)).size !== 1) throw new Error("All atrocity definitions must share one approved harm-share revision");
  if (definitions.some((definition) => /WITNESS|SEAL|HARNESS|RING|MANTLE|LOOM|PATCHWORK/i.test(definition.definitionId))) throw new Error("Book/Witness structures cannot enter atrocity identifiers");
}

export const ATROCITY_INTEGRATION_FIXTURES_V1 = [
  { fixtureId: "POISONED_WELL", requiredEvidence: ["exact population conservation", "approved concentration and spillover", "scapegoating separated from direct harm", "Family counter-mobilization", "persistent policy effects", "no illustrative hardcoded deltas"] },
  { fixtureId: "RUIN_LITERACY_CREDENTIAL", requiredEvidence: ["credential exclusion and literacy effects", "exact population conservation", "migration and group-safety transfers", "Family sponsorship and counter-mobilization", "persistent policy effects", "no illustrative hardcoded deltas"] },
] as const;
