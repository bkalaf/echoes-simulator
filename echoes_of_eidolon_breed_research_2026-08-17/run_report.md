# Echoes of Eidolon — Breed Classification and Personality Research Run

Run date: 2026-08-17

## Result

Processed 2,056 supplied Breeds exactly once: BEAST 961, HUMAN 631, MYTHOS 181, PET 283. No application or database writes were performed.

All 2,056 speciesId mappings resolve, all Species Group mappings resolve to the supplied 84-record registry, every non-null Human Culture resolves, and every emitted personalityId exists in the refreshed 369-row/80-family registry.
Unresolved dispositions are terminal staging outcomes, not omitted input rows: no value was manufactured where exact-subject or claim-aligned evidence did not support one.

## Terminal status

- IMPORTABLE_WITH_OPTIONAL_GAPS: 283
- RESOLVED_IMPORTABLE: 285
- REVIEW_REQUIRED: 1,488

## Species and groups

- Valid speciesId mappings: 2,056; missing: 0; broken: 0; kind mismatches: 0.
- Unresolved Species Group mappings: 0.
- speciesGroupId and compact groupId were audited independently. Their literal values coincide because the supplied 84-record Species Group registry and live compact lookup independently agree on ID, label, and kind.

### Species Group distribution

| speciesGroupId | Kind | Name | Breeds |
|---|---:|---|---:|
| B01 | BEAST | Amphibians | 39 |
| B02 | BEAST | Arthropods | 105 |
| B03 | BEAST | Bats | 16 |
| B04 | BEAST | Bony Fish | 76 |
| B05 | BEAST | Carnivorans | 68 |
| B06 | BEAST | Cetaceans | 28 |
| B07 | BEAST | Elephants, Hyraxes & Afrotherians | 21 |
| B08 | BEAST | Even-Toed Ungulates | 45 |
| B09 | BEAST | Lizards | 35 |
| B10 | BEAST | Marsupials & Monotremes | 34 |
| B11 | BEAST | Mollusks & Other Invertebrates | 21 |
| B12 | BEAST | Odd-Toed Ungulates | 15 |
| B13 | BEAST | Other Specialized Birds | 38 |
| B14 | BEAST | Parrots & Cockatoos | 12 |
| B15 | BEAST | Pigeons, Gamebirds & Groundbirds | 39 |
| B16 | BEAST | Primates | 31 |
| B17 | BEAST | Raptors & Owls | 26 |
| B18 | BEAST | Rodents & Lagomorphs | 64 |
| B19 | BEAST | Sharks, Rays & Jawless Fish | 22 |
| B20 | BEAST | Snakes | 24 |
| B21 | BEAST | Songbirds | 48 |
| B22 | BEAST | Turtles & Crocodilians | 35 |
| B23 | BEAST | Waterbirds & Seabirds | 85 |
| B24 | BEAST | Xenarthrans & Other Mammals | 34 |
| H01 | HUMAN | Arabian Peninsula | 18 |
| H02 | HUMAN | Arctic & North American Indigenous | 14 |
| H03 | HUMAN | Australian Indigenous | 2 |
| H04 | HUMAN | Caucasian & Anatolian | 4 |
| H05 | HUMAN | Central African & Great Lakes | 23 |
| H06 | HUMAN | Central Asian & Steppe | 21 |
| H07 | HUMAN | Diaspora, Creole & Legendary Human Civilizations | 107 |
| H08 | HUMAN | East African & Nilotic | 17 |
| H09 | HUMAN | East Asian | 23 |
| H10 | HUMAN | Himalayan & Tibetan | 12 |
| H11 | HUMAN | Horn of Africa & Red Sea | 12 |
| H12 | HUMAN | Iranian, Kurdish & Eastern West Asian | 11 |
| H13 | HUMAN | Levantine & Mesopotamian | 19 |
| H14 | HUMAN | Mainland Southeast Asian | 18 |
| H15 | HUMAN | Maritime Southeast Asian | 22 |
| H16 | HUMAN | Mesoamerican & Caribbean Indigenous | 17 |
| H17 | HUMAN | North African & Saharan | 17 |
| H18 | HUMAN | Pacific & Oceanian | 32 |
| H19 | HUMAN | South American Indigenous | 17 |
| H20 | HUMAN | South Asian | 30 |
| H21 | HUMAN | Southern & Eastern European | 55 |
| H22 | HUMAN | Southern African | 22 |
| H23 | HUMAN | West African | 37 |
| H24 | HUMAN | Western & Northern European | 81 |
| M01 | MYTHOS | Angels & Celestials | 6 |
| M02 | MYTHOS | Constructs & Animated Objects | 7 |
| M03 | MYTHOS | Demons & Fiends | 9 |
| M04 | MYTHOS | Divine & Heavenly Spirits | 6 |
| M05 | MYTHOS | Djinn & Genie-Kin | 3 |
| M06 | MYTHOS | Dragons & Dragonkin | 7 |
| M07 | MYTHOS | Dwarves, Halflings & Little Folk | 12 |
| M08 | MYTHOS | Elementals | 15 |
| M09 | MYTHOS | Elves | 5 |
| M10 | MYTHOS | Fae & Fairy Folk | 7 |
| M11 | MYTHOS | Ghosts, Wraiths & Specters | 8 |
| M12 | MYTHOS | Giants & Titans | 9 |
| M13 | MYTHOS | Goblinoids & Orc-Kin | 4 |
| M14 | MYTHOS | Golems | 9 |
| M15 | MYTHOS | Household, Land & Place Spirits | 7 |
| M16 | MYTHOS | Hybrid & Legendary Monsters | 18 |
| M17 | MYTHOS | Liches, Mummies & Greater Undead | 6 |
| M18 | MYTHOS | Merfolk & Aquatic Peoples | 5 |
| M19 | MYTHOS | Nature & Plant Spirits | 5 |
| M20 | MYTHOS | Ogres, Trolls & Oni | 5 |
| M21 | MYTHOS | Shapeshifters & Werebeings | 13 |
| M22 | MYTHOS | Skeletons & Zombies | 2 |
| M23 | MYTHOS | Vampires & Blood-Drinkers | 6 |
| M24 | MYTHOS | Water Spirits & Aquatic Monsters | 7 |
| P01 | PET | Dogs | 51 |
| P02 | PET | Cats | 31 |
| P03 | PET | Horses & Equid Hybrids | 25 |
| P04 | PET | Cattle, Yak & Buffalo | 15 |
| P05 | PET | Sheep & Goats | 18 |
| P06 | PET | Camels, Llamas & Alpacas | 9 |
| P07 | PET | Pigs | 7 |
| P08 | PET | Rabbits, Rodents & Ferrets | 42 |
| P09 | PET | Chickens, Ducks & Geese | 26 |
| P10 | PET | Pigeons & Companion Birds | 18 |
| P11 | PET | Aquarium Fish | 36 |
| P12 | PET | Reptiles & Amphibians | 5 |

## Human Culture

- Direct verified Culture mappings: 604.
- Research-complete null umbrella mappings: 27.
- Unresolved Culture mappings: 0.

### Human Culture distribution

| cultureId | Culture | Human Breeds |
|---|---|---:|
| CLT_ABORIGINAL_AUSTRALIAN | Aboriginal Australian | 2 |
| CLT_AFRICAN_AMERICAN | African American | 2 |
| CLT_AFRIKANER | Afrikaner | 1 |
| CLT_AFRO_LATIN_AMERICAN_AFRO_BAHIAN | Afro Latin American Afro Bahian | 11 |
| CLT_AINU | Ainu | 1 |
| CLT_ALBANIAN | Albanian | 1 |
| CLT_AMAZIGH_BERBER | Amazigh Berber | 4 |
| CLT_AMAZONIAN_INDIGENOUS_MARAJOARA_SHIPIBO | Amazonian Indigenous Marajoara Shipibo | 6 |
| CLT_ANCIENT_LEVANTINE_NABATAEAN_PHOENICIAN | Ancient Levantine Nabataean Phoenician | 3 |
| CLT_ANGLOPHONE_ATLANTIC_CREOLE_MAROON | Anglophone Atlantic Creole Maroon | 23 |
| CLT_ANISHINAABE | Anishinaabe | 1 |
| CLT_ARABIAN_PENINSULA_ARAB | Arabian Peninsula Arab | 17 |
| CLT_ASSYRIAN_SYRIAC | Assyrian Syriac | 3 |
| CLT_ATLANTIS | Atlantis | 1 |
| CLT_AVALON | Avalon | 2 |
| CLT_AYMARA_TIWANAKU | Aymara Tiwanaku | 2 |
| CLT_BALINESE | Balinese | 1 |
| CLT_BALTIC | Baltic | 2 |
| CLT_BASQUE | Basque | 1 |
| CLT_BENGALI | Bengali | 1 |
| CLT_CARIBBEAN_INDIGENOUS_TAINO | Caribbean Indigenous Taino | 5 |
| CLT_CATALAN | Catalan | 1 |
| CLT_CAUCASUS_HIGHLAND_GEORGIAN_NORTH_CAUCASIAN | Caucasus Highland Georgian North Caucasian | 4 |
| CLT_CENTRAL_AND_GREAT_LAKES_AFRICAN_KONGO_BANTU_TWA | Central And Great Lakes African Kongo Bantu Twa | 18 |
| CLT_CENTRAL_SAHARA_TOUBOU_TEBU | Central Sahara Toubou Tebu | 2 |
| CLT_CHAD_SUDAN_INTERIOR | Chad Sudan Interior | 4 |
| CLT_DINE_NAVAJO | Dine Navajo | 2 |
| CLT_EAST_AFRICAN_BANTU_SWAHILI_COMORIAN | East African Bantu Swahili Comorian | 7 |
| CLT_EDO_BENIN_NIGER_DELTA | Edo Benin Niger Delta | 3 |
| CLT_EGYPTIAN_COPTIC | Egyptian Coptic | 3 |
| CLT_ENGLISH_ANGLO | English Anglo | 12 |
| CLT_ETHIOPIAN_ERITREAN_HIGHLANDS_AND_SOUTH | Ethiopian Eritrean Highlands And South | 5 |
| CLT_FINNIC | Finnic | 4 |
| CLT_FRANCOPHONE_CARIBBEAN_CREOLE | Francophone Caribbean Creole | 9 |
| CLT_FRENCH_FRANCOPHONE | French Francophone | 11 |
| CLT_GARIFUNA | Garifuna | 1 |
| CLT_GERMAN_DUTCH_FLEMISH_CONTINENTAL_WEST_GERMANIC | German Dutch Flemish Continental West Germanic | 28 |
| CLT_GREEK_AEGEAN_BYZANTINE | Greek Aegean Byzantine | 6 |
| CLT_GUARANI_CHACO | Guarani Chaco | 2 |
| CLT_GUJARATI | Gujarati | 2 |
| CLT_GULF_VOLTA_WEST_AFRICAN_AKAN_GBE_GUR | Gulf Volta West African Akan Gbe Gur | 9 |
| CLT_GULLAH_GEECHEE | Gullah Geechee | 1 |
| CLT_HAUDENOSAUNEE | Haudenosaunee | 1 |
| CLT_HAUSA_KANURI_SAHEL | Hausa Kanuri Sahel | 3 |
| CLT_HISPANIC_AMERICAN_MESTIZO | Hispanic American Mestizo | 16 |
| CLT_HOPI | Hopi | 2 |
| CLT_HUNGARIAN_MAGYAR | Hungarian Magyar | 4 |
| CLT_IBERIAN_ATLANTIC_PORTUGUESE_CREOLE | Iberian Atlantic Portuguese Creole | 15 |
| CLT_IGBO | Igbo | 1 |
| CLT_INDIAN_OCEAN_CREOLE | Indian Ocean Creole | 4 |
| CLT_INDIAN_OCEAN_MUSLIM_CAPE_MALAY_MALDIVIAN | Indian Ocean Muslim Cape Malay Maldivian | 4 |
| CLT_INUIT_YUPIK | Inuit Yupik | 3 |
| CLT_IRISH_GAELIC | Irish Gaelic | 5 |
| CLT_ITALIAN_CENTRAL_MEDITERRANEAN | Italian Central Mediterranean | 13 |
| CLT_JAPANESE | Japanese | 3 |
| CLT_JAVA_JAVANESE_SUNDANESE | Java Javanese Sundanese | 2 |
| CLT_JEWISH_DIASPORA | Jewish Diaspora | 3 |
| CLT_KANAKA_MAOLI_HAWAIIAN | Kanaka Maoli Hawaiian | 2 |
| CLT_KHMER | Khmer | 2 |
| CLT_KIPCHAK_AND_NORTHERN_TURKIC | Kipchak And Northern Turkic | 5 |
| CLT_KOREAN | Korean | 1 |
| CLT_KURDISH | Kurdish | 1 |
| CLT_LEVANTINE_ARAB | Levantine Arab | 8 |
| CLT_LOWLAND_FILIPINO_TAGALOG_VISAYAN | Lowland Filipino Tagalog Visayan | 4 |
| CLT_MAASAI_NILOTIC_EAST_AFRICA | Maasai Nilotic East Africa | 6 |
| CLT_MAGHREBI_ARAB | Maghrebi Arab | 6 |
| CLT_MALAGASY | Malagasy | 3 |
| CLT_MAORI | Maori | 2 |
| CLT_MAPUCHE | Mapuche | 1 |
| CLT_MARITIME_AUSTRONESIAN_MALAYIC_BORNEAN_TIMORESE | Maritime Austronesian Malayic Bornean Timorese | 13 |
| CLT_MAYA_CULTURAL_CONTINUUM | Maya Cultural Continuum | 3 |
| CLT_MELANESIAN_PAPUAN | Melanesian Papuan | 7 |
| CLT_MESOPOTAMIAN_SUMERIAN_BABYLONIAN | Mesopotamian Sumerian Babylonian | 4 |
| CLT_METIS | Metis | 1 |
| CLT_MEXICA_AZTEC | Mexica Aztec | 3 |
| CLT_MICRONESIAN | Micronesian | 7 |
| CLT_MISSISSIPPIAN_EASTERN_WOODLANDS | Mississippian Eastern Woodlands | 2 |
| CLT_MIXTEC_NUU_SAVI | Mixtec Nuu Savi | 2 |
| CLT_MOCHE | Moche | 2 |
| CLT_MONGOL | Mongol | 2 |
| CLT_MUISCA | Muisca | 1 |
| CLT_MYANMAR_MAINLAND_SOUTHEAST_ASIAN_HIGHLAND | Myanmar Mainland Southeast Asian Highland | 8 |
| CLT_NEPAL_BHUTAN_HIMALAYAN_NEWAR | Nepal Bhutan Himalayan Newar | 8 |
| CLT_NORDIC | Nordic | 9 |
| CLT_NORTHERN_HAN_CHINESE | Northern Han Chinese | 4 |
| CLT_NORTH_AND_WEST_INDIAN_INDUS_GANGETIC | North And West Indian Indus Gangetic | 12 |
| CLT_NUBIAN | Nubian | 1 |
| CLT_OGHUZ_TURKIC | Oghuz Turkic | 9 |
| CLT_OLMEC | Olmec | 2 |
| CLT_PASHTUN | Pashtun | 1 |
| CLT_PERSIAN_IRANIAN | Persian Iranian | 7 |
| CLT_POLYNESIAN_ISLANDS | Polynesian Islands | 11 |
| CLT_PUNJABI_SIKH | Punjabi Sikh | 2 |
| CLT_PUREPECHA | Purepecha | 1 |
| CLT_QUECHUA_INCA_CONTINUUM | Quechua Inca Continuum | 3 |
| CLT_RAJASTHANI | Rajasthani | 1 |
| CLT_ROMANI | Romani | 2 |
| CLT_ROMANIAN_MOLDOVAN | Romanian Moldovan | 3 |
| CLT_RUSSIAN_EASTERN_EUROPEAN | Russian Eastern European | 15 |
| CLT_SAMI_ARCTIC_URALIC | Sami Arctic Uralic | 2 |
| CLT_SAN_KHOEKHOE | San Khoekhoe | 4 |
| CLT_SCOTS_ULSTER_SCOTS | Scots Ulster Scots | 2 |
| CLT_SENEGAMBIAN_FULANI_WOLOF_SERER | Senegambian Fulani Wolof Serer | 6 |
| CLT_SHAMBHALA | Shambhala | 1 |
| CLT_SINHALESE | Sinhalese | 1 |
| CLT_SOMALI_CUSHITIC_HORN | Somali Cushitic Horn | 6 |
| CLT_SONGHAI | Songhai | 2 |
| CLT_SOUTHERN_AFRICAN_BANTU_NGUNI_SOTHO_TSWANA | Southern African Bantu Nguni Sotho Tswana | 9 |
| CLT_SOUTHERN_HAN_CHINESE_WU_MIN_YUE_HAKKA | Southern Han Chinese Wu Min Yue Hakka | 13 |
| CLT_SOUTH_INDIAN_DRAVIDIAN | South Indian Dravidian | 9 |
| CLT_SOUTH_SLAVIC | South Slavic | 11 |
| CLT_SPANISH_CASTILIAN | Spanish Castilian | 4 |
| CLT_TAI_THAI_LAO_LANNA | Tai Thai Lao Lanna | 7 |
| CLT_TAJIK_SOGDIAN | Tajik Sogdian | 2 |
| CLT_TIBETAN | Tibetan | 4 |
| CLT_TLINGIT | Tlingit | 1 |
| CLT_UPLAND_FILIPINO_IFUGAO_CORDILLERAN_LUMAD | Upland Filipino Ifugao Cordilleran Lumad | 2 |
| CLT_UPPER_GUINEA_MANDE_KRU_TEMNE | Upper Guinea Mande Kru Temne | 11 |
| CLT_UZBEK_TIMURID | Uzbek Timurid | 3 |
| CLT_VIETNAMESE | Vietnamese | 1 |
| CLT_WELSH_BRITTONIC_CELTIC | Welsh Brittonic Celtic | 1 |
| CLT_YORUBA | Yoruba | 1 |
| CLT_YS | Ys | 2 |
| CLT_ZAMBEZI_ZIMBABWE_MOZAMBIQUE_BANTU | Zambezi Zimbabwe Mozambique Bantu | 8 |
| CLT_ZAPOTEC | Zapotec | 1 |

## Traits

- Verified canonical traits: 338.
- Appearance-only or measurement-only candidates rejected/rerouted: 1,274.
- Breeds with unresolved trait research: 1,149.
- Human historical facts were not converted into population-wide behavioral traits; those trait fields are documented RESOLVED_NULL to avoid essentializing Human cultures.
- Parent-Species facts were not reused as PET Breed differentiators; unsupported PET traits remain optional gaps.

### Trait count by population kind

- BEAST: 220
- MYTHOS: 118

### Trait count by domain

- COMMUNICATION: 32
- CONTINUITY: 60
- DEFENSE: 34
- EMBODIMENT: 39
- NAVIGATION: 2
- OFFENSE: 10
- OTHER: 30
- SENSORY: 15
- SOCIAL: 15
- TOOL_USE: 3
- TRANSFORMATION: 98

## Personality

- BEAST outward-expression dispositions: {'RESOLVED_NULL': 26, 'UNRESOLVED': 764, 'VERIFIED_VALUE': 171}.
- MYTHOS inward-expression dispositions: {'RESOLVED_NULL': 3, 'UNRESOLVED': 102, 'VERIFIED_VALUE': 76}.
- HUMAN core-wound dispositions: {'UNRESOLVED': 622, 'VERIFIED_VALUE': 9}.
- PET policy-null count: 283.
- dominantFaction metadata was never used to choose a family or expression.

## Rejected evidence

- Appearance/measurement mismatch rejected: 1,274.
- Subject-mismatch evidence rejected: 4; uncertain cross-population analogies were not admitted as active evidence.
- Claim-mismatch, taxonomy-only, or nonfunctional candidates rejected: 4,741.

## Remaining blockers

1,488 Breeds remain REVIEW_REQUIRED because a population-specific personality bridge was not supported by the reviewed evidence. Exact Breed IDs and reasons are listed in coverage.json and entity_research_status.jsonl.

## Validation

- Every JSON file parsed.
- Every JSONL line parsed.
- All citation, evidence, source, foreign-key, Species Group, Culture, and Personality references resolved.
- Input/output count equality and uniqueness checks passed.
- PET personality policy and non-Human Culture null rules passed.
- Zero appearance-only strings remain in canonical traits.
- Zero application/database writes.

Checksums are recorded in checksums.sha256.
