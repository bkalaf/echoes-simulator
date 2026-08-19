# August 18 source-lead adversarial assessment

Verdict: **REJECT** as semantic authority. The archive remains usable only for source discovery and provenance leads.

## Independently reproduced census

- Breed rows: 2056
- Research status: {"RESOLVED_IMPORTABLE":3,"REVIEW_REQUIRED":2053}
- Dimension rows: 24672; unresolved: 20427; authored inference: 849
- Citations without bounded context: 35889/35889
- Trait rows: 318; distinct texts: 83; suspicious generic rows: 78
- Inherited ecology rows requiring re-verification: 1695

## Mandatory regressions

- FAIL DOMESTICATED_GOAT: Only trait=["Is kept as livestock."] and foodSpecific=["GRASSES"]; the livestock-only/GRASSES template must be reopened.
- FAIL DOMESTICATED_SHEEP: Only trait=["Is kept as livestock."] and foodSpecific=["GRASSES"]; grain/seed-feed evidence is not represented.
- FAIL FLOWERHORN_WORKSHOP: terrainSpecific=["WORKSHOP"]; aquarium husbandry does not establish WORKSHOP habitat.
- FAIL IRANIAN_CITY: terrainSpecific=["CITY"]; the prior cuisine/diaspora bridge is not habitat evidence.
- FAIL MALAYAN_TAPIR_SETTLEMENT: terrainSpecific=["CITY","FOREST_EDGE","MARSH","RAIN_FOREST","RIVER","SWAMP","VILLAGE"]; proximity to settlements cannot normalize to settlement habitat.
- FAIL AARDVARK_DIMENSION_CASCADE: 5 dimensions were authored from a personality/behavior bridge instead of field-specific evidence.
- REOPENED HUMAN_GENERIC_WOUND_TEMPLATE: 0 exact generic-template matches; all Human personality assignments remain reopened for subject, actor/victim, scope, and locator review.
- FAIL CITATION_CONTEXT: 35889/35889 citation rows have no bounded excerpt/context field.
- FAIL PET_GENERIC_TRAITS: 21 PET trait rows match a prohibited generic opening/template.
- REOPENED AFRICAN_MANATEE_DAMS: Ecology is empty and dam-related claims were not freshly verified: terrainBroad=[].
- REOPENED BANDED_MONGOOSE_SOCIALITY: Prior group-defense trait exists, but its full evidence chain and independent dimensions require fresh verification.
- FAIL AUSTRALIAN_LUNGFISH_PARENTAL_GUARDING: A parental-care fact was converted to personality=CARE_SELECTIVE_NEGLECT_EXPRESSION and motivation=ALTRUISTIC; both are reopened.
- PASS ALPINE_IBEX_ARBOREAL: terrainBroad=["GRASSLAND","MOUNTAIN"] terrainSpecific=["ALPINE","CLIFF","MEADOW"].

## Decision

9 mandatory cases fail and 3 remain reopened. No value from this archive is copied into V3 without a fresh, field-specific evidence chain. The fresh queue contains 37008 tasks; 3679 are owner-policy PET nulls and 33329 require research.
