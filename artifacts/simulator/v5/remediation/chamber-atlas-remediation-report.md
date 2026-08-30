# Chamber and canonical Atlas remediation report

## Chamber

- PoliticalPerson has an explicit normalized faction vector plus effective year and source event.
- Prisma models `PoliticalPerson` and `PoliticalPersonAlignment` enforce complete-or-null current vectors, exact sum 1000, temporal bounds, and composite run/world/person identity.
- New/resumed runs project people to PostgreSQL. People, Conclave, and Senate read effective person alignment from PostgreSQL; missing legacy history renders `UNKNOWN/UNALIGNED`.
- Office selection preserves constituency, representative, Family context, and selector as distinct causal/read-model concepts.
- Chamber UI exposes representative and constituency compositions independently and highlights known mismatches.

## Atlas

- Active public trace: `/gameplay/world-atlas` → `/api/atlas/public` → `atlas-geographic-points.json` plus `atlas-geographic-placement-audit.ts` → `AtlasGlobe`.
- Exact stable-ID comparison covers all 92 simulator POIs. Counts: 85 exact, 0 corrections, 0 simulator-only, 0 Atlas-only, 0 ID conflicts, 0 type conflicts, 7 invalid/withheld placements.
- PostgreSQL/Prisma contains 25 Regions, 175 Sites, 92 POIs, one current spatial authority, valid Site→Region and POI→Site/parent/authority foreign keys, and placement status/provenance.
- Runtime Atlas reads PostgreSQL only and renders 85 `AUTHORITATIVE` markers. It does not render the seven withheld conflicts and has no CSV fallback.
- POI-029 is verified at 41.625, 89.625 / SITE-095 / R14 / PEAK-DER-001. POI-092 is verified at -72, -18 / SITE-169 / R25. POI-008 is preserved at 46.369786, -3.449831 / SITE-104 / R15 but withheld because the active authority identifies Nimbus open ocean and provides no replacement anchor.
- EPSG:4326 convention is latitude/longitude, east-positive longitude, with 2D projection `x=(longitude+180)/360`, `y=(90-latitude)/180`; the 3D consumer passes latitude then longitude.

## Verification

- PASS: Prisma format/validate/generate and fresh forward migration.
- PASS: idempotent reconciliation/import audit; 92/175/25 rows, 85 rendered, 7 withheld.
- PASS: typecheck, build, V5 architecture 28/28, alignment/UI/Atlas unit tests, PostgreSQL integration 3/3.
- BLOCKED: desktop Electron rendered evidence. The sandboxed launch is denied, and no further full-access permission was requested after the user asked about permission volume.
- BLOCKED: one unrelated pre-existing Prompt 01 test reports Breed–Deity authority coverage mismatch.
- AUTHORITY BLOCKER: no active Atlas or owner-supplied crosswalk provides a defensible replacement coordinate for POI-008; it remains withheld instead of guessed.
