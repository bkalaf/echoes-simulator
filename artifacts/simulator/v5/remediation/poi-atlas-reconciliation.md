# Canonical Atlas POI reconciliation

Spatial identity was compared only by exact active public Atlas `poiId`. The R09 `POI-0001` namespace has no owner-supplied crosswalk to the simulator `POI-001` namespace and was not joined by name or position.

## Counts

- EXACT_MATCH: 85
- ATLAS_CORRECTION: 0
- SIMULATOR_ONLY: 0
- ATLAS_ONLY: 0
- ID_CONFLICT: 0
- TYPE_CONFLICT: 0
- INVALID_GEOGRAPHY: 7

## Required records

- POI-008: INVALID_GEOGRAPHY; database={"poiType":"HEAVENFALL","latitude":46.369786,"longitude":-3.449831,"siteId":"SITE-104","regionId":"R15","surfaceType":"LAND","hostFeatureId":null,"primaryBiomeId":"BIOME-OCEAN","placementStatus":"WITHHELD_CONFLICT","spatialAuthorityId":"EIDOLON_PUBLIC_3D_ATLAS_e760e7cd01c283d7a0e2"}; Declared LAND coordinate resolves to Nimbus open ocean; no authoritative replacement anchor exists.
- POI-029: EXACT_MATCH; database={"poiType":"PEAK","latitude":41.625,"longitude":89.625,"siteId":"SITE-095","regionId":"R14","surfaceType":"LAND","hostFeatureId":"PEAK-DER-001","primaryBiomeId":"BIOME-02","placementStatus":"AUTHORITATIVE","spatialAuthorityId":"EIDOLON_PUBLIC_3D_ATLAS_e760e7cd01c283d7a0e2"}; no conflict
- POI-092: EXACT_MATCH; database={"poiType":"OCEAN","latitude":-72,"longitude":-18,"siteId":"SITE-169","regionId":"R25","surfaceType":"OPEN_WATER","hostFeatureId":null,"primaryBiomeId":"BIOME-SWATH-0953","placementStatus":"AUTHORITATIVE","spatialAuthorityId":"EIDOLON_PUBLIC_3D_ATLAS_e760e7cd01c283d7a0e2"}; no conflict

Full field evidence is in `poi-atlas-reconciliation.json` and `poi-atlas-reconciliation.csv`.
