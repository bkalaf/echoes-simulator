import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChamberView, type V5OperatorRunView } from "../../src/ui/v5-operator-views.js";

describe("Conclave alignment presentation", () => {
  it("does not backfill a legacy representative from Family, constituency, selector, or World", () => {
    const view: V5OperatorRunView = {
      world: "CONCORD", effectiveYear: 50, settlements: [], states: [], events: [], labels: { S_LUPIN: "Lupin-Ghar", P_LEGACY: "Legacy Holder", F_CONCORD: "House Concord" },
      institutions: [{ institutionId: "I_CONCLAVE", stateId: "STATE_1", institutionType: "CONCLAVE_PRE90", foundedYear: 0, dissolvedYear: null }],
      offices: [{ officeId: "O_LUPIN", institutionId: "I_CONCLAVE", jurisdictionSettlementId: "S_LUPIN", titleKey: "Lupin seat", power: 100, mandatory: true, apex: false, selectionRule: { selectionMethod: "RULER_APPOINTMENT" } }],
      people: [{ personId: "P_LEGACY", familyId: "F_CONCORD", breedId: "BRD_LUPIN", originSettlementId: "S_LUPIN", sourceTier: "HIGH", sourceClass: null, birthYear: 0, activeFromYear: 20, plannedRetirementYear: null, actualRetirementYear: null, naturalDeathYear: 100, actualDeathYear: null, disqualifiedFromYear: null, requalifiedYear: null }],
      families: [{ familyId: "F_CONCORD", homeSettlementId: "S_LUPIN", founderBreedId: "BRD_LUPIN", factionAffinity: { CONCORD: 1000, SCHISM: 0, RUIN: 0 }, wealth: 500, influence: 500, prestige: 500, status: "ACTIVE", foundingYear: 0, extinctionYear: null }],
      officeTerms: [{ officeTermId: "T_LUPIN", officeId: "O_LUPIN", personId: "P_LEGACY", startYear: 40, endYear: null, selectorType: "PERSON", selectorId: "P_SELECTOR", terminationReason: null }],
      personFactionById: { P_LEGACY: null }, constituencyFactionByOfficeId: { O_LUPIN: "RUIN" },
      officeTermSelectionEvidence: { T_LUPIN: { selectionEventId: "E_SELECT", appliedSelectionRule: { selectionMethod: "RULER_APPOINTMENT" }, sourceGovernmentFormId: "GOV", sourceGovernmentOfficeId: "GOV_APEX", selectorType: "PERSON", selectorId: "P_SELECTOR", selectedPersonId: "P_LEGACY", sourceSettlementId: "S_LUPIN", constituencyFactionAffinity: { CONCORD: 0, SCHISM: 0, RUIN: 1000 }, representativeFactionAffinity: null, selectionAuthorityFactionAffinity: { CONCORD: 1000, SCHISM: 0, RUIN: 0 }, candidateScore: 500, candidateCount: 1, materialized: false, scoreComponents: {} } },
    };
    const html = renderToStaticMarkup(<ChamberView kind="CONCLAVE" view={view} world="CONCORD" year={50}/>);
    expect(html).toContain("Represented Settlement"); expect(html).toContain("Lupin-Ghar");
    expect(html).toContain("Constituency alignment</dt><dd>RUIN");
    expect(html).toContain("Representative alignment</dt><dd>UNKNOWN/UNALIGNED");
    expect(html).toContain("Family alignment (context)</dt><dd>CONCORD");
    expect(html).toContain("Selector alignment</dt><dd>CONCORD");
    expect(html).toContain("Political mismatch</dt><dd>NO / NOT CLASSIFIABLE");
  });
});
