# Founding-wave authority audit

- Seed: `EIDOLON_V5_DIAGNOSTIC_1787843667789`
- Scheduler: `echoes-scheduler-v5.3.0`
- Mechanics: `echoes-mechanics-v5.3.0`
- Causal derivation: `echoes-derived-metrics-v1.1.0`
- Resolved waves: Wave 2 year 1; Wave 3 year 77; Wave 4 year 125; Wave 5 year 176.
- Authority count: 24 additions per wave per world, 96 Wave-2-through-Wave-5 additions per world, 120 scheduled pre-R10 Settlements per world including Year 0.
- Transfer policy: exact integer `floor(source Breed/tier population / 10)`, applied atomically with population conservation.
- Identity policy: `SETTLEMENT_<WORLD>_<SITE_ID>`.
- Naming: comparison-aware `BATCHED` requests by physical Site ID; unresolved labels never block unattended causal execution.
