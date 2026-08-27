# V4 Breed data review export

Source: /home/bobby/echoes-simulator/ECHOES_OF_EIDOLON_BREED_SEMANTICS_V4_SIMULATION_READY.zip
Source SHA-256: a7f8378adba7a7d8980dcfc81eb493e4da5514e7cad0c1ee22fc8d638b95ad23
Manifest status: SIMULATION_READY

This export preserves the V4 authority as written. It does not treat the pack's SIMULATION_READY claim as proof that every owner-requested authoring field was researched. In particular, optional_authoring_gaps.json marks traits, foodBroad, and foodSpecific OUT_OF_SCOPE_OPTIONAL for all 2,056 Breeds; the master CSV exposes those fields as blank with that disposition.

Arrays are separated with " | ". Nested policy/audit objects remain JSON inside quoted CSV cells. UTF-8 CSV files include a BOM for spreadsheet compatibility.
