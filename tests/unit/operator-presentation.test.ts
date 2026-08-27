import { describe, expect, it } from "vitest";
import { applyAcceptedSettlementNames } from "../../src/core/operator/presentation.js";

describe("operator presentation overlays", () => {
  it("shows accepted Settlement names immediately without mutating persisted projection fields", () => {
    const projection = { settlementId: "SETTLEMENT_CONCORD_SITE-096", name: null, dominantFaction: "CONCORD" };
    const presented = applyAcceptedSettlementNames([projection], new Map([[projection.settlementId, "Dar Mizan"]]));
    expect(presented).toEqual([{ ...projection, name: "Dar Mizan" }]);
    expect(projection.name).toBeNull();
  });
});
