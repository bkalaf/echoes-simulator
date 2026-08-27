import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const directory = resolve("resources/canonical/research-corpus");
const jsonLines = (name: string): Record<string, unknown>[] => readFileSync(resolve(directory, name), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);

describe("installed remediated research corpus", () => {
  it("has exact remediated ledger and reconciliation coverage with verified artifact hashes", () => {
    const manifest = JSON.parse(readFileSync(resolve(directory, "IMPORT_MANIFEST.json"), "utf8")) as {
      sourcePackage: string;
      sourcePackageSha256: string;
      observedRecordCounts: Record<string, number>;
      observedRecordCount: number;
      ledgerRecordCount: number;
      ordinalCoverageStart: number;
      ordinalCoverageEnd: number;
      missingOrdinals: number[];
      duplicateOrdinals: number[];
      artifactHashes: Record<string, string>;
    };
    const reconciliation = jsonLines("IMPORT_RECONCILIATION.jsonl");
    const checksumEntries = Object.fromEntries(readFileSync(resolve(directory, "checksums.sha256"), "utf8").trim().split("\n").map((line) => { const match = /^([0-9a-f]{64})  (.+)$/.exec(line)!; return [match[2], match[1]]; }));
    expect(manifest.sourcePackage).toBe("EIDOLON_CHAT_CLASSIFICATION_ALL_RESPONSES_0001-6039_REMEDIATED_2026-08-26.zip");
    expect(manifest.sourcePackageSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.observedRecordCounts).toEqual({ TAXONOMY: 2_628, SPECIES: 1_138, CULTURE: 127, SPECIES_GROUP: 84, BREED: 2_062 });
    expect(manifest.observedRecordCount).toBe(6_039);
    expect(manifest.ledgerRecordCount).toBe(6_039);
    expect(reconciliation).toHaveLength(6_039);
    expect(new Set(reconciliation.map((row) => row.sourceFilename)).size).toBe(6_039);
    expect(manifest.ordinalCoverageStart).toBe(1);
    expect(manifest.ordinalCoverageEnd).toBe(6_039);
    expect(manifest.missingOrdinals).toEqual([]);
    expect(manifest.duplicateOrdinals).toEqual([]);
    for (const [filename, hash] of Object.entries(manifest.artifactHashes)) expect(checksumEntries[filename]).toBe(hash);
  }, 30_000);

  it("materializes every former failure and the requested Beast coverage with complete Taxonomy dependencies", () => {
    const ledger = jsonLines("IMPORT_LEDGER.jsonl") as {
      recordType: string; recordId: string; reviewVerdict: string; importDisposition: string; canonicalMaterialized: boolean;
      canonicalPayload: Record<string, unknown> | null;
    }[];
    const byId = new Map(ledger.map((row) => [row.recordId, row]));
    const findings = JSON.parse(readFileSync(resolve(directory, "IMPORT_FINDINGS.json"), "utf8")) as { summary: Record<string, number>; findings: { code: string }[] };
    const formerlyFailed = [
      "SPC_DYNASTES_HERCULES", "SPC_DRACO_MOO", "BRD_ANIMATED_STATUE", "BRD_DOMESTICATED_GOOSE_AFRICAN_GOOSE",
      "BRD_DOMESTICATED_GOOSE_CHINESE_GOOSE", "BRD_FAT_TAILED_DUNNART", "BRD_HERCULES_BEETLE", "BRD_HUMAN_TLINGIT_TLINGIT",
      "BRD_HUMAN_UPLAND_FILIPINO_IFUGAO_CORDILLERAN_LUMAD_IFUGAO", "BRD_HUMAN_UPLAND_FILIPINO_IFUGAO_CORDILLERAN_LUMAD_LUMAD", "BRD_MO_O",
    ];
    for (const id of formerlyFailed) expect(byId.get(id)).toMatchObject({ reviewVerdict: "PASS", canonicalMaterialized: true });
    expect(ledger.filter((row) => row.importDisposition.startsWith("QUARANTINED"))).toEqual([]);
    expect(findings.summary.BLOCKER).toBe(0);
    expect(findings.findings.some((finding) => finding.code === "MISSING_REQUIRED_FIELD")).toBe(false);

    for (const id of ["TAX_SPECIES_SMINTHOPSIS_CRASSICAUDATA", "TAX_SPECIES_ANSER_CYGNOIDES", "SPC_ANSER_CYGNOIDES", "CLT_TLINGIT", "CLT_UPLAND_FILIPINO_IFUGAO_CORDILLERAN_LUMAD"]) {
      expect(byId.get(id)).toMatchObject({ reviewVerdict: "PASS", canonicalMaterialized: true });
    }
    expect(byId.get("BRD_DOMESTICATED_GOOSE_AFRICAN_GOOSE")?.canonicalPayload?.speciesId).toBe("SPC_ANSER_CYGNOIDES");
    expect(byId.get("BRD_DOMESTICATED_GOOSE_CHINESE_GOOSE")?.canonicalPayload?.speciesId).toBe("SPC_ANSER_CYGNOIDES");
    expect(byId.get("SPC_PHASCOGALE_CRASSICAUDATA")?.canonicalPayload?.scientificName).toBe("Sminthopsis crassicaudata");

    const requested = [
      "BRD_GREAT_FRIGATEBIRD", "BRD_MAGNIFICENT_FRIGATEBIRD", "BRD_CHESTNUT_BELLIED_SANDGROUSE", "BRD_NAMAQUA_SANDGROUSE",
      "BRD_PIN_TAILED_SANDGROUSE", "BRD_COMMON_KINGFISHER", "BRD_GIANT_KINGFISHER", "BRD_GREEN_AND_RUFOUS_KINGFISHER", "BRD_BEARDED_VULTURE",
      "BRD_SAIGA_ANTELOPE", "BRD_EASTERN_QUOLL", "BRD_SPOTTED_TAILED_QUOLL", "BRD_INDIAN_SPOTTED_CHEVROTAIN", "BRD_LESSER_MOUSE_DEER",
      "BRD_WATER_CHEVROTAIN", "BRD_PHILIPPINE_TARSIER", "BRD_SPECTRAL_TARSIER", "BRD_PINK_FAIRY_ARMADILLO", "BRD_RED_HANDFISH",
      "BRD_SPOTTED_HANDFISH", "BRD_ZIEBELLS_HANDFISH",
      "BRD_VOGELKOP_SUPERB_BIRD_OF_PARADISE", "BRD_LESSER_BIRD_OF_PARADISE", "BRD_RED_BIRD_OF_PARADISE",
    ];
    for (const id of requested) expect(byId.get(id)).toMatchObject({ reviewVerdict: "PASS", canonicalMaterialized: true, canonicalPayload: { populationKind: "BEAST" } });
    const traits = (id: string): string => JSON.stringify(byId.get(id)?.canonicalPayload?.traits ?? []).toLowerCase();
    expect(traits("BRD_GREAT_FRIGATEBIRD")).toContain("sleep");
    expect(traits("BRD_NAMAQUA_SANDGROUSE")).toContain("water");
    expect(traits("BRD_COMMON_KINGFISHER")).toContain("refraction");
    expect((byId.get("BRD_COMMON_KINGFISHER")?.canonicalPayload?.foodSpecific as string[])).toContain("FISH");
    expect((byId.get("BRD_BEARDED_VULTURE")?.canonicalPayload?.foodSpecific as string[])).toContain("BONE_MARROW");
    expect(traits("BRD_LESSER_MOUSE_DEER")).toContain("smallest living hoofed");
    expect(traits("BRD_PHILIPPINE_TARSIER")).toContain("nearly 180 degrees");
    expect(traits("BRD_SPECTRAL_TARSIER")).toContain("nearly 180 degrees");
    expect(traits("BRD_PINK_FAIRY_ARMADILLO")).toContain("swimming-like");
    expect(traits("BRD_RED_HANDFISH")).toContain("hand-like pectoral fins");
    expect(traits("BRD_VOGELKOP_SUPERB_BIRD_OF_PARADISE")).toContain("hypnotic courtship show");
    expect(byId.get("BRD_VOGELKOP_SUPERB_BIRD_OF_PARADISE")?.canonicalPayload?.personalityId).toBe("DESIRE_COURTSHIP_DISPLAY_EXPRESSION");

    const taxonomyIds = new Set(ledger.filter((row) => row.recordType === "TAXONOMY" && row.canonicalMaterialized).map((row) => row.recordId));
    for (const breedId of requested) {
      const speciesId = String(byId.get(breedId)?.canonicalPayload?.speciesId);
      const dependencies = byId.get(speciesId)?.canonicalPayload?.taxonomyDependencyIds as string[];
      expect(dependencies).toHaveLength(7);
      expect(dependencies.every((id) => taxonomyIds.has(id))).toBe(true);
    }
  }, 30_000);
});
