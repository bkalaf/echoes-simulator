import type { WorldKey } from "./types.js";

export type FederalPillarV1 = "CROWN" | "CHURCH" | "INTELLECTUAL_ELITE" | "HEREDITARY_ELITE" | "CORPORATE_ACTORS" | "WEALTH_ELITE";

export interface FederalVisionProfileV1 {
  worldKey: WorldKey;
  primaryPillar: FederalPillarV1;
  counterPillar: FederalPillarV1;
  structuralAuthorityRef: "OWNER_FEDERAL_VISION_DIRECTIONALITY_2026_08_29";
}

export const FEDERAL_VISION_PROFILES_V1: Readonly<Record<WorldKey, FederalVisionProfileV1>> = {
  CONCORD: { worldKey: "CONCORD", primaryPillar: "CROWN", counterPillar: "CHURCH", structuralAuthorityRef: "OWNER_FEDERAL_VISION_DIRECTIONALITY_2026_08_29" },
  RUIN: { worldKey: "RUIN", primaryPillar: "INTELLECTUAL_ELITE", counterPillar: "HEREDITARY_ELITE", structuralAuthorityRef: "OWNER_FEDERAL_VISION_DIRECTIONALITY_2026_08_29" },
  SCHISM: { worldKey: "SCHISM", primaryPillar: "CORPORATE_ACTORS", counterPillar: "WEALTH_ELITE", structuralAuthorityRef: "OWNER_FEDERAL_VISION_DIRECTIONALITY_2026_08_29" },
};

export function federalVisionForV1(worldKey: WorldKey): FederalVisionProfileV1 {
  return FEDERAL_VISION_PROFILES_V1[worldKey];
}
