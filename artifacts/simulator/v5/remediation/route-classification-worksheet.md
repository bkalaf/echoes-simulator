# V5 Route Classification Worksheet

Runtime graph inventory: **38 RouteCorridors**. Recommendations are non-authoritative.

Allowed owner classifications: `LAND / ROAD`, `LAND / HIGHWAY`, `SEA / SEA_ROUTE`, `AIR / AIRSHIP_ROUTE`, `PORTAL_ONLY / PORTAL_ONLY`.

Set `ownerDecisionStatus` to `OWNER_VALUES` with every owner field explicit, or to `APPROVE_RECOMMENDATION` to intentionally copy the recommendation. Blank rows remain unresolved. Generic `APPROVED` is invalid.

Route decisions are a non-causal overlay. They do not overwrite persisted WorldRoutes, RouteEstablished events, checkpoints, connectivity, or causal hashes.

| Corridor | Region A | Region B | Relationship | Recommendation | Confidence | Owner decision |
|---|---|---|---|---|---|---|
| ROUTE_CORRIDOR_R01_R03 | R01 Icewake (Raukaam) | R03 Highsteppe (Raukaam) | SAME-CONTINENT; centroid A 65.8720, -93.4804; centroid B 50.2561, -117.8798; great-circle 2223 km | LAND / ROAD; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R01_R04 | R01 Icewake (Raukaam) | R04 Rivergrass (Raukaam) | SAME-CONTINENT; centroid A 65.8720, -93.4804; centroid B 44.0418, -80.5006; great-circle 2553 km | LAND / ROAD; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R01_R05 | R01 Icewake (Raukaam) | R05 Shadowspine (Raukaam) | SAME-CONTINENT; centroid A 65.8720, -93.4804; centroid B 27.1973, -91.4979; great-circle 4303 km | LAND / ROAD; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R02_R03 | R02 Timbersteppe (Raukaam) | R03 Highsteppe (Raukaam) | SAME-CONTINENT; centroid A 56.1107, -137.1407; centroid B 50.2561, -117.8798; great-circle 1432 km | LAND / HIGHWAY; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R02_R07 | R02 Timbersteppe (Raukaam) | R07 Duskcanopy (Raukaam) | SAME-CONTINENT; centroid A 56.1107, -137.1407; centroid B 11.3071, -86.1410; great-circle 6621 km | LAND / ROAD; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R02_R08 | R02 Timbersteppe (Raukaam) | R08 Shadeleaf (Raukaam) | SAME-CONTINENT; centroid A 56.1107, -137.1407; centroid B 9.8677, -124.6291; great-circle 5256 km | LAND / ROAD; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R03_R07 | R03 Highsteppe (Raukaam) | R07 Duskcanopy (Raukaam) | SAME-CONTINENT; centroid A 50.2561, -117.8798; centroid B 11.3071, -86.1410; great-circle 5209 km | LAND / ROAD; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R04_R09 | R04 Rivergrass (Raukaam) | R09 Forestcrown (Morgenland) | INTERCONTINENTAL; centroid A 44.0418, -80.5006; centroid B 29.8293, 46.2658; great-circle 10183 km | SEA / SEA_ROUTE; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R04_R15 | R04 Rivergrass (Raukaam) | R15 Forestfold (Morgenland) | INTERCONTINENTAL; centroid A 44.0418, -80.5006; centroid B 36.4565, 29.0436; great-circle 8597 km | SEA / SEA_ROUTE; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R05_R18 | R05 Shadowspine (Raukaam) | R18 Aerie Peaks (Valdmere) | INTERCONTINENTAL; centroid A 27.1973, -91.4979; centroid B -22.0346, -72.8988; great-circle 5828 km | SEA / SEA_ROUTE; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R05_R19 | R05 Shadowspine (Raukaam) | R19 Caldera Heights (Valdmere) | INTERCONTINENTAL; centroid A 27.1973, -91.4979; centroid B -23.0174, -26.9738; great-circle 8897 km | SEA / SEA_ROUTE; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R06_R11 | R06 Highcourt (Raukaam) | R11 Sunscar (Morgenland) | INTERCONTINENTAL; centroid A 20.3042, -60.4417; centroid B 28.5159, 64.7247; great-circle 12009 km | SEA / SEA_ROUTE; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R06_R19 | R06 Highcourt (Raukaam) | R19 Caldera Heights (Valdmere) | INTERCONTINENTAL; centroid A 20.3042, -60.4417; centroid B -23.0174, -26.9738; great-circle 6031 km | SEA / SEA_ROUTE; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R06_R20 | R06 Highcourt (Raukaam) | R20 Heartwood (Valdmere) | INTERCONTINENTAL; centroid A 20.3042, -60.4417; centroid B -32.9653, 10.9006; great-circle 9606 km | SEA / SEA_ROUTE; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R07_R08 | R07 Duskcanopy (Raukaam) | R08 Shadeleaf (Raukaam) | SAME-CONTINENT; centroid A 11.3071, -86.1410; centroid B 9.8677, -124.6291; great-circle 4207 km | LAND / ROAD; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R08_R17 | R08 Shadeleaf (Raukaam) | R17 Canopywall (Valdmere) | INTERCONTINENTAL; centroid A 9.8677, -124.6291; centroid B -18.1372, -95.2906; great-circle 4480 km | SEA / SEA_ROUTE; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R09_R10 | R09 Forestcrown (Morgenland) | R10 Innerwood (Morgenland) | SAME-CONTINENT; centroid A 29.8293, 46.2658; centroid B 41.6315, 52.9183; great-circle 1442 km | LAND / HIGHWAY; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R09_R15 | R09 Forestcrown (Morgenland) | R15 Forestfold (Morgenland) | SAME-CONTINENT; centroid A 29.8293, 46.2658; centroid B 36.4565, 29.0436; great-circle 1761 km | LAND / ROAD; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R10_R11 | R10 Innerwood (Morgenland) | R11 Sunscar (Morgenland) | SAME-CONTINENT; centroid A 41.6315, 52.9183; centroid B 28.5159, 64.7247; great-circle 1808 km | LAND / ROAD; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R10_R15 | R10 Innerwood (Morgenland) | R15 Forestfold (Morgenland) | SAME-CONTINENT; centroid A 41.6315, 52.9183; centroid B 36.4565, 29.0436; great-circle 2133 km | LAND / ROAD; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R11_R12 | R11 Sunscar (Morgenland) | R12 Reefward (Morgenland) | SAME-CONTINENT; centroid A 28.5159, 64.7247; centroid B 23.4768, 119.9427; great-circle 5500 km | LAND / ROAD; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R12_R14 | R12 Reefward (Morgenland) | R14 Manywater (Morgenland) | SAME-CONTINENT; centroid A 23.4768, 119.9427; centroid B 19.4338, 90.1049; great-circle 3115 km | LAND / ROAD; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R12_R16 | R12 Reefward (Morgenland) | R16 Eastchain (Morgenland) | SAME-CONTINENT; centroid A 23.4768, 119.9427; centroid B -6.3585, 118.7385; great-circle 3320 km | LAND / ROAD; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R13_R14 | R13 Drymarsh (Morgenland) | R14 Manywater (Morgenland) | SAME-CONTINENT; centroid A -9.1982, 97.2290; centroid B 19.4338, 90.1049; great-circle 3278 km | LAND / ROAD; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R13_R16 | R13 Drymarsh (Morgenland) | R16 Eastchain (Morgenland) | SAME-CONTINENT; centroid A -9.1982, 97.2290; centroid B -6.3585, 118.7385; great-circle 2390 km | LAND / ROAD; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R13_R22 | R13 Drymarsh (Morgenland) | R22 The Chains (Valdmere) | INTERCONTINENTAL; centroid A -9.1982, 97.2290; centroid B -52.8389, 37.0549; great-circle 7218 km | SEA / SEA_ROUTE; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R14_R16 | R14 Manywater (Morgenland) | R16 Eastchain (Morgenland) | SAME-CONTINENT; centroid A 19.4338, 90.1049; centroid B -6.3585, 118.7385; great-circle 4249 km | LAND / ROAD; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R17_R18 | R17 Canopywall (Valdmere) | R18 Aerie Peaks (Valdmere) | SAME-CONTINENT; centroid A -18.1372, -95.2906; centroid B -22.0346, -72.8988; great-circle 2376 km | LAND / ROAD; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R17_R24 | R17 Canopywall (Valdmere) | R24 Southcanopy (Valdmere) | SAME-CONTINENT; centroid A -18.1372, -95.2906; centroid B -48.0569, -88.0320; great-circle 3391 km | LAND / ROAD; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R18_R19 | R18 Aerie Peaks (Valdmere) | R19 Caldera Heights (Valdmere) | SAME-CONTINENT; centroid A -22.0346, -72.8988; centroid B -23.0174, -26.9738; great-circle 4699 km | LAND / ROAD; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R19_R20 | R19 Caldera Heights (Valdmere) | R20 Heartwood (Valdmere) | SAME-CONTINENT; centroid A -23.0174, -26.9738; centroid B -32.9653, 10.9006; great-circle 3857 km | LAND / ROAD; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R20_R22 | R20 Heartwood (Valdmere) | R22 The Chains (Valdmere) | SAME-CONTINENT; centroid A -32.9653, 10.9006; centroid B -52.8389, 37.0549; great-circle 3037 km | LAND / ROAD; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R21_R23 | R21 Ringwood Isles (Valdmere) | R23 Highwater (Valdmere) | SAME-CONTINENT; centroid A -39.7109, 13.1611; centroid B -54.0815, -57.6572; great-circle 5367 km | LAND / ROAD; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R21_R24 | R21 Ringwood Isles (Valdmere) | R24 Southcanopy (Valdmere) | SAME-CONTINENT; centroid A -39.7109, 13.1611; centroid B -48.0569, -88.0320; great-circle 7556 km | LAND / ROAD; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R21_R25 | R21 Ringwood Isles (Valdmere) | R25 Marshroot (Valdmere) | SAME-CONTINENT; centroid A -39.7109, 13.1611; centroid B -52.3011, -15.8666; great-circle 2616 km | LAND / ROAD; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R22_R25 | R22 The Chains (Valdmere) | R25 Marshroot (Valdmere) | SAME-CONTINENT; centroid A -52.8389, 37.0549; centroid B -52.3011, -15.8666; great-circle 3495 km | LAND / ROAD; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R23_R24 | R23 Highwater (Valdmere) | R24 Southcanopy (Valdmere) | SAME-CONTINENT; centroid A -54.0815, -57.6572; centroid B -48.0569, -88.0320; great-circle 2206 km | LAND / ROAD; portal FALSE; trade TRUE | MEDIUM |  |
| ROUTE_CORRIDOR_R23_R25 | R23 Highwater (Valdmere) | R25 Marshroot (Valdmere) | SAME-CONTINENT; centroid A -54.0815, -57.6572; centroid B -52.3011, -15.8666; great-circle 2750 km | LAND / ROAD; portal FALSE; trade TRUE | MEDIUM |  |

The CSV/XLSX companions contain complete Site, Settlement, POI, terrain, recommendation-evidence, and explicit owner-authority columns.
