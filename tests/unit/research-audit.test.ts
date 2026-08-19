import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { auditV2LeadArchive } from "../../src/core/research/adversarial-audit.js";

const input = resolve("ECHOES_OF_EIDOLON_SIMULATOR_BREED_RESEARCH_REMEDIATION_CODEX_PACK_2026-08-18/INPUTS/echoes_of_eidolon_breed_research_v2_semantic_remediated_2026-08-18(1).zip");

function rows(zip: Record<string, Uint8Array>, name: string): Record<string, unknown>[] {
  return strFromU8(zip[name]!).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

describe("August 18 source-lead adversarial audit", () => {
  it("independently rejects systemic semantic and evidence defects", () => {
    const zip = unzipSync(readFileSync(input));
    const census = auditV2LeadArchive({
      breeds: rows(zip, "breed_classifications.jsonl"),
      statuses: rows(zip, "entity_research_status.jsonl"),
      dimensions: rows(zip, "dimension_audit.jsonl"),
      citations: rows(zip, "citations.jsonl"),
      traits: rows(zip, "trait_research.jsonl"),
      ecology: rows(zip, "ecology_audit.jsonl"),
    });
    expect(census.verdict).toBe("REJECT");
    expect(census.counts).toMatchObject({
      breeds: 2056,
      populationKinds: { HUMAN: 631, BEAST: 961, MYTHOS: 181, PET: 283 },
      researchStatuses: { RESOLVED_IMPORTABLE: 3, REVIEW_REQUIRED: 2053 },
      dimensionRows: 24672,
      unresolvedDimensionRows: 20427,
      authoredInferenceDimensionRows: 849,
      citations: 35889,
      citationsWithoutBoundedContext: 35889,
    });
    expect(census.systemicFindings.find((finding) => finding.caseId === "FLOWERHORN_WORKSHOP")?.status).toBe("FAIL");
    expect(census.systemicFindings.find((finding) => finding.caseId === "ALPINE_IBEX_ARBOREAL")?.status).toBe("PASS");
  }, 30_000);
});
