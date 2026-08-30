# Owner Policy Review

Locked owner structure is displayed for context and is not presented for reapproval. The 52 unresolved revisions remain candidates; this artifact approves none of them. Independent candidates support multi-select approval, with a separate immutable decision and hash for each revision.

## LOCKED OWNER STRUCTURE

- **FEDERAL_VISION_DIRECTIONALITY** [LOCKED_OWNER_AUTHORITY] — Concord → Crown / Church; Ruin → Intellectual Elite / Hereditary Elite; Schism → Corporate Actors / Wealth Elite.
- **REFUGE_CLASSIFICATION_STRUCTURE** [LOCKED_OWNER_AUTHORITY] — Exactly 47 terminal FoodSpecific values are base Refuge-eligible, exactly 14 are non-Refuge classifications, and every eligible value used by more than 100 canonical Breeds receives a second Refuge.
- **NON_REFUGE_SUSTENANCE_STRUCTURE** [LOCKED_OWNER_AUTHORITY] — The 14 non-Refuge classifications receive no physical Refuge. BLOOD is sourced from the living. NO_FEEDING requires no sustenance. FEAR supports a peaceful/calm penalty and war/unrest availability behavior; detailed meanings and formulas remain unresolved.
- **INFLUENCE_BOUNDARY_STRUCTURE** [LOCKED_OWNER_AUTHORITY] — Influence uses normalized geodesic distance. Radii 25:15 divide a contested span 5/8:3/8 with deterministic ties.
- **INFLUENCE_CONTRIBUTOR_STRUCTURE** [LOCKED_OWNER_AUTHORITY] — Structural contributors are population/Settlement size, economy, tourism, political power, university prominence, cultural institutions, corporation prominence, Family/dynasty prominence, regional-capital status, political victories, military victories, defeats, catastrophe damage, and atrocity damage. Route centrality is not locked.
- **ATROCITY_IDENTITY_AND_ACCOUNTING** [LOCKED_OWNER_AUTHORITY] — All definitions reference one common harm-share revision; unique harmed is counted once; Book/Witness identifiers remain distinct from Atrocity identifiers.
- **ATROCITY_PRIMARY_HARM_ACCOUNTING** [LOCKED_OWNER_AUTHORITY] — Each primary harm profile allocates exactly 100% of uniqueHarmed among mutually exclusive primary outcomes. Secondary consequences may overlap but never increase uniqueHarmed.
- **ATROCITY_SPILLOVER_ACCOUNTING** [LOCKED_OWNER_AUTHORITY] — DIRECT_HARM_SPILLOVER redistributes the same unique-harmed budget across Settlements/cohorts. SECONDARY_CONSEQUENCE_SPILLOVER changes non-victim consequences and never adds unique harmed. Direct victims cannot be double-counted.
- **ATROCITY_17_A_INHERITED_SCHEDULE** [LOCKED_OWNER_AUTHORITY] — ATROCITY_17_A inherits the approved year-50 ATROCITY_17 schedule authority.
- **ATROCITY_HISTORY_APPEND_ONLY** [LOCKED_OWNER_AUTHORITY] — Historical events and scar records are append-only. Their current mechanical effects may decay, strengthen, reactivate, or interact with later history under approved policy.
- **RELIGIOUS_SITE_CARDINALITY** [LOCKED_OWNER_AUTHORITY] — At most one Shrine and one Temple may exist per Deity/world.
- **PANTHEON_CENTER_SELECTION_STRUCTURE** [LOCKED_OWNER_AUTHORITY] — Pantheon-center selection considers eligible site-hosting Settlements, maximizes site count by State, chooses the smallest eligible Settlement, resolves State-count ties across tied States by smallest eligible Settlement, then uses stable Settlement ID.

## PENDING SEMANTIC AUTHORITY

### DEROGATORY_TAXONOMY

- Purpose: Reconciles each legacy candidate Group before recording membership in three canonical structures.
- Units/range: typed review decisions; KEEP or REJECT for every legacy Group; three membership decisions only for KEEP Groups
- Consumers: Derogatory predicate readiness, atrocity target selection
- Locked structure shown with this row: none
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "three canonical structure names",
    "KEEP or REJECT for each legacy candidate Group",
    "for each KEEP Group: MEMBER or NOT_MEMBER in each structure"
  ]
}
```

- Significance: All-NOT_MEMBER cannot implicitly preserve a legacy Group; the atomic 63-decision targeting protocol remains separate.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → DEROGATORY_TAXONOMY → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### RELIGIOUS_SIMILARITY

- Purpose: Defines and weights Deity/Pantheon relationship effects.
- Units/range: typed semantics and fixed-point weights; Per-field 0..1000
- Consumers: cohesion, migration, sanctuary, alliances
- Locked structure shown with this row: none
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "same-Deity effect",
    "same-Pantheon/different-Deity effect",
    "different-Pantheon effect",
    "corresponding weights"
  ]
}
```

- Significance: Detailed relationship behavior and weights remain unresolved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → RELIGIOUS_SIMILARITY → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### RESOURCE_QUARTERMASTER_ASSIGNMENT_POLICY

- Purpose: Deterministically selects the Quartermaster serving each ResourceNode/logistics flow.
- Units/range: ordered semantic rules; Complete deterministic ordering with stable-ID tie-break
- Consumers: ResourceNode logistics
- Locked structure shown with this row: none
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "eligible Quartermasters",
    "control/jurisdiction",
    "route/access",
    "capacity priority",
    "reassignment",
    "stable-ID tie-break"
  ]
}
```

- Significance: The assignment authority is required but its ordering is unresolved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → RESOURCE_QUARTERMASTER_ASSIGNMENT_POLICY → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### ROUTE_DECISION

- Purpose: Controls opening, capacity, degradation, closure, and control of physical corridors.
- Units/range: typed weights and thresholds; Per-field schema limits
- Consumers: route lifecycle
- Locked structure shown with this row: none
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "causal route classification",
    "status transitions",
    "control and access semantics"
  ]
}
```

- Significance: Prompt-01 classification remains noncausal until separately promoted.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → ROUTE_DECISION → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SUSTENANCE_ANGER_SEMANTICS

- Purpose: Defines the permitted causal source metrics and meaning for ANGER.
- Units/range: typed semantic mapping; Explicit permitted metrics and interpretation
- Consumers: dynamic sustenance:ANGER
- Locked structure shown with this row: NON_REFUGE_SUSTENANCE_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "sourceMetricIds",
    "semanticDescription",
    "No detailed meaning may be inferred from the classification name."
  ]
}
```

- Significance: No detailed ANGER causal source mapping has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SUSTENANCE_ANGER_SEMANTICS → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SUSTENANCE_BLOOD_SEMANTICS

- Purpose: Defines the permitted causal source metrics and meaning for BLOOD.
- Units/range: typed semantic mapping; Explicit permitted metrics and interpretation
- Consumers: dynamic sustenance:BLOOD
- Locked structure shown with this row: NON_REFUGE_SUSTENANCE_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "sourceMetricIds",
    "semanticDescription",
    "BLOOD is sourced from the living; the precise permitted source metrics remain unresolved."
  ]
}
```

- Significance: No detailed BLOOD causal source mapping has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SUSTENANCE_BLOOD_SEMANTICS → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SUSTENANCE_DESIRE_SEMANTICS

- Purpose: Defines the permitted causal source metrics and meaning for DESIRE.
- Units/range: typed semantic mapping; Explicit permitted metrics and interpretation
- Consumers: dynamic sustenance:DESIRE
- Locked structure shown with this row: NON_REFUGE_SUSTENANCE_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "sourceMetricIds",
    "semanticDescription",
    "No detailed meaning may be inferred from the classification name."
  ]
}
```

- Significance: No detailed DESIRE causal source mapping has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SUSTENANCE_DESIRE_SEMANTICS → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SUSTENANCE_DREAMS_SEMANTICS

- Purpose: Defines the permitted causal source metrics and meaning for DREAMS.
- Units/range: typed semantic mapping; Explicit permitted metrics and interpretation
- Consumers: dynamic sustenance:DREAMS
- Locked structure shown with this row: NON_REFUGE_SUSTENANCE_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "sourceMetricIds",
    "semanticDescription",
    "No detailed meaning may be inferred from the classification name."
  ]
}
```

- Significance: No detailed DREAMS causal source mapping has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SUSTENANCE_DREAMS_SEMANTICS → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SUSTENANCE_EMOTION_SEMANTICS

- Purpose: Defines the permitted causal source metrics and meaning for EMOTION.
- Units/range: typed semantic mapping; Explicit permitted metrics and interpretation
- Consumers: dynamic sustenance:EMOTION
- Locked structure shown with this row: NON_REFUGE_SUSTENANCE_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "sourceMetricIds",
    "semanticDescription",
    "No detailed meaning may be inferred from the classification name."
  ]
}
```

- Significance: No detailed EMOTION causal source mapping has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SUSTENANCE_EMOTION_SEMANTICS → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SUSTENANCE_ESSENCE_OF_FAITH_SEMANTICS

- Purpose: Defines the permitted causal source metrics and meaning for ESSENCE_OF_FAITH.
- Units/range: typed semantic mapping; Explicit permitted metrics and interpretation
- Consumers: dynamic sustenance:ESSENCE_OF_FAITH
- Locked structure shown with this row: NON_REFUGE_SUSTENANCE_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "sourceMetricIds",
    "semanticDescription",
    "No detailed meaning may be inferred from the classification name."
  ]
}
```

- Significance: No detailed ESSENCE_OF_FAITH causal source mapping has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SUSTENANCE_ESSENCE_OF_FAITH_SEMANTICS → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SUSTENANCE_FEAR_SEMANTICS

- Purpose: Defines the permitted causal source metrics and meaning for FEAR.
- Units/range: typed semantic mapping; Explicit permitted metrics and interpretation
- Consumers: dynamic sustenance:FEAR
- Locked structure shown with this row: NON_REFUGE_SUSTENANCE_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "sourceMetricIds",
    "semanticDescription",
    "FEAR supports lower availability or a penalty in peaceful/calm conditions and greater availability during war/unrest; detailed mapping remains unresolved."
  ]
}
```

- Significance: No detailed FEAR causal source mapping has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SUSTENANCE_FEAR_SEMANTICS → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SUSTENANCE_GRIEF_SEMANTICS

- Purpose: Defines the permitted causal source metrics and meaning for GRIEF.
- Units/range: typed semantic mapping; Explicit permitted metrics and interpretation
- Consumers: dynamic sustenance:GRIEF
- Locked structure shown with this row: NON_REFUGE_SUSTENANCE_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "sourceMetricIds",
    "semanticDescription",
    "No detailed meaning may be inferred from the classification name."
  ]
}
```

- Significance: No detailed GRIEF causal source mapping has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SUSTENANCE_GRIEF_SEMANTICS → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SUSTENANCE_MEMORY_SEMANTICS

- Purpose: Defines the permitted causal source metrics and meaning for MEMORY.
- Units/range: typed semantic mapping; Explicit permitted metrics and interpretation
- Consumers: dynamic sustenance:MEMORY
- Locked structure shown with this row: NON_REFUGE_SUSTENANCE_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "sourceMetricIds",
    "semanticDescription",
    "No detailed meaning may be inferred from the classification name."
  ]
}
```

- Significance: No detailed MEMORY causal source mapping has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SUSTENANCE_MEMORY_SEMANTICS → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SUSTENANCE_MUSIC_ATTENTION_SEMANTICS

- Purpose: Defines the permitted causal source metrics and meaning for MUSIC_ATTENTION.
- Units/range: typed semantic mapping; Explicit permitted metrics and interpretation
- Consumers: dynamic sustenance:MUSIC_ATTENTION
- Locked structure shown with this row: NON_REFUGE_SUSTENANCE_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "sourceMetricIds",
    "semanticDescription",
    "No detailed meaning may be inferred from the classification name."
  ]
}
```

- Significance: No detailed MUSIC_ATTENTION causal source mapping has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SUSTENANCE_MUSIC_ATTENTION_SEMANTICS → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SUSTENANCE_NECROMANTIC_ESSENCE_SEMANTICS

- Purpose: Defines the permitted causal source metrics and meaning for NECROMANTIC_ESSENCE.
- Units/range: typed semantic mapping; Explicit permitted metrics and interpretation
- Consumers: dynamic sustenance:NECROMANTIC_ESSENCE
- Locked structure shown with this row: NON_REFUGE_SUSTENANCE_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "sourceMetricIds",
    "semanticDescription",
    "No detailed meaning may be inferred from the classification name."
  ]
}
```

- Significance: No detailed NECROMANTIC_ESSENCE causal source mapping has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SUSTENANCE_NECROMANTIC_ESSENCE_SEMANTICS → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SUSTENANCE_NO_FEEDING_SEMANTICS

- Purpose: Defines the permitted causal source metrics and meaning for NO_FEEDING.
- Units/range: typed semantic mapping; Explicit permitted metrics and interpretation
- Consumers: dynamic sustenance:NO_FEEDING
- Locked structure shown with this row: NON_REFUGE_SUSTENANCE_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "sourceMetricIds",
    "semanticDescription",
    "NO_FEEDING requires no sustenance; the behavior of demand and satisfaction records remains unresolved."
  ]
}
```

- Significance: No detailed NO_FEEDING causal source mapping has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SUSTENANCE_NO_FEEDING_SEMANTICS → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SUSTENANCE_OATHS_HONOR_SEMANTICS

- Purpose: Defines the permitted causal source metrics and meaning for OATHS_HONOR.
- Units/range: typed semantic mapping; Explicit permitted metrics and interpretation
- Consumers: dynamic sustenance:OATHS_HONOR
- Locked structure shown with this row: NON_REFUGE_SUSTENANCE_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "sourceMetricIds",
    "semanticDescription",
    "No detailed meaning may be inferred from the classification name."
  ]
}
```

- Significance: No detailed OATHS_HONOR causal source mapping has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SUSTENANCE_OATHS_HONOR_SEMANTICS → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SUSTENANCE_SIN_SEMANTICS

- Purpose: Defines the permitted causal source metrics and meaning for SIN.
- Units/range: typed semantic mapping; Explicit permitted metrics and interpretation
- Consumers: dynamic sustenance:SIN
- Locked structure shown with this row: NON_REFUGE_SUSTENANCE_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "sourceMetricIds",
    "semanticDescription",
    "No detailed meaning may be inferred from the classification name."
  ]
}
```

- Significance: No detailed SIN causal source mapping has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SUSTENANCE_SIN_SEMANTICS → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.


## PENDING NUMERIC AUTHORITY

### ATROCITY_17_B_SCHEDULE

- Purpose: Sets only the newly proposed ATROCITY_17_B trigger year.
- Units/range: simulation year; Integer greater than 50
- Consumers: atrocity scheduler
- Locked structure shown with this row: ATROCITY_17_A_INHERITED_SCHEDULE
- Candidate values:

```json
{
  "ATROCITY_17_B": 75
}
```

- Significance: ATROCITY_17_A=50 is inherited locked authority; only the proposed year 75 needs review.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → ATROCITY_17_B_SCHEDULE → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### ATROCITY_CONCENTRATION

- Purpose: Controls how the common unique-harmed budget is concentrated among approved target cohorts.
- Units/range: basis points and fixed-point concentration; 0..10000; exact population conservation
- Consumers: atrocity execution, population slicing
- Locked structure shown with this row: ATROCITY_IDENTITY_AND_ACCOUNTING
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "target concentration formula",
    "cohort caps",
    "stable remainder allocation"
  ]
}
```

- Significance: No concentration formula has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → ATROCITY_CONCENTRATION → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### ATROCITY_HARM_SHARE

- Purpose: Sets the shared proportion of current world population uniquely harmed by each occurrence.
- Units/range: parts per million of world population; 0..1000000 ppm
- Consumers: all 54 atrocity definitions
- Locked structure shown with this row: ATROCITY_IDENTITY_AND_ACCOUNTING
- Candidate values:

```json
{
  "targetHarmSharePpm": 100000
}
```

- Significance: The packet's 10 percent example remains a numeric candidate.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → ATROCITY_HARM_SHARE → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### ATROCITY_PERSISTENCE

- Purpose: Controls current mechanical effects of append-only atrocity and scar history.
- Units/range: years and fixed-point effects; Per-field schema limits
- Consumers: historical scars, reputation, group safety, paired pillars
- Locked structure shown with this row: ATROCITY_HISTORY_APPEND_ONLY
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "decay",
    "strengthening",
    "reactivation",
    "later-history interactions",
    "effect caps and durations"
  ]
}
```

- Significance: Append-only records do not imply permanently constant numeric effects.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → ATROCITY_PERSISTENCE → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### ATROCITY_PRIMARY_HARM_PROFILES

- Purpose: Allocates uniqueHarmed among mutually exclusive primary outcomes.
- Units/range: basis points of uniqueHarmed; Every profile sums exactly to 10000
- Consumers: atrocity execution, migration, population
- Locked structure shown with this row: ATROCITY_IDENTITY_AND_ACCOUNTING, ATROCITY_PRIMARY_HARM_ACCOUNTING
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "mortality",
    "forced displacement",
    "detention/forced labor",
    "civic exclusion",
    "service/access denial",
    "asset/property seizure",
    "growth/reproductive suppression",
    "other explicitly modeled primary harm"
  ]
}
```

- Significance: The two conflicting primary-allocation policies were collapsed; no profile values are approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → ATROCITY_PRIMARY_HARM_PROFILES → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### ATROCITY_SPILLOVER

- Purpose: Separately controls direct-victim redistribution and overlapping non-victim consequences.
- Units/range: basis points and typed fixed-point effects; Direct allocation conserves uniqueHarmed; secondary effects add zero uniqueHarmed
- Consumers: atrocity execution, neighbor effects, migration
- Locked structure shown with this row: ATROCITY_SPILLOVER_ACCOUNTING
- Candidate values:

```json
{
  "DIRECT_HARM_SPILLOVER": {
    "status": "OWNER_VALUES_REQUIRED",
    "unresolvedFields": [
      "redistribution share",
      "eligible neighboring Settlements/cohorts",
      "distance/route attenuation"
    ]
  },
  "SECONDARY_CONSEQUENCE_SPILLOVER": {
    "status": "OWNER_VALUES_REQUIRED",
    "unresolvedFields": [
      "reputation",
      "fear",
      "grievance",
      "propaganda",
      "migration pressure",
      "diplomacy",
      "religion",
      "Family reaction"
    ]
  }
}
```

- Significance: Direct-victim and secondary-consequence layers are structurally separate; all magnitudes remain unresolved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → ATROCITY_SPILLOVER → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### CLASS_POLICY

- Purpose: Maps tier populations into causal social-class distributions.
- Units/range: basis points; Each tier distribution sums exactly to 10000
- Consumers: classDistribution, office eligibility
- Locked structure shown with this row: none
- Candidate values:

```json
{
  "schemaVersion": "echoes-class-policy-v1",
  "tierWeights": {
    "HIGH": {
      "NOBILITY": 7000,
      "INTELLECTUAL": 2000,
      "WORKER": 800,
      "WANDERER": 200
    },
    "MID": {
      "NOBILITY": 1000,
      "INTELLECTUAL": 4000,
      "WORKER": 4500,
      "WANDERER": 500
    },
    "LOW": {
      "NOBILITY": 0,
      "INTELLECTUAL": 1000,
      "WORKER": 7000,
      "WANDERER": 2000
    }
  },
  "contextModifiers": {}
}
```

- Significance: Corrected from a 1,000-scale representation to basis points without approving the values.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → CLASS_POLICY → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### CONFLICT_EPISODE_PROFILE

- Purpose: Controls aggregate causal effects of conflict episodes.
- Units/range: typed fixed-point values; Per-field schema limits
- Consumers: conflict
- Locked structure shown with this row: none
- Candidate values:

```json
{
  "schemaVersion": "echoes-conflict-episode-profile-v1",
  "maximumMortalityBps": 20,
  "maximumDisplacementBps": 100,
  "maximumProsperityDamage": 40,
  "maximumIndustryDamage": 50,
  "maximumUnrestDelta": 80,
  "maximumLegitimacyDelta": 60,
  "maximumGrievanceDelta": 100,
  "maximumExhaustionDelta": 100
}
```

- Significance: Existing numeric review blocker carried forward.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → CONFLICT_EPISODE_PROFILE → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### FEDERAL_VISION_WEIGHTS

- Purpose: Weights the locked Concord, Ruin, and Schism directionality in shared decisions.
- Units/range: basis points; Each decision profile sums to 10000
- Consumers: executive actions, appointments, routes, institutions
- Locked structure shown with this row: FEDERAL_VISION_DIRECTIONALITY
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "per-consumer weights",
    "normalization",
    "caps"
  ]
}
```

- Significance: Directionality is locked; its numeric weights remain unresolved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → FEDERAL_VISION_WEIGHTS → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### PEACE_EXHAUSTION_POLICY

- Purpose: Controls war exhaustion and peaceful recovery.
- Units/range: score/year; Per-field schema limits
- Consumers: peace review
- Locked structure shown with this row: none
- Candidate values:

```json
{
  "schemaVersion": "echoes-peace-exhaustion-policy-v1",
  "warExhaustionIncrease": 80,
  "peacefulExhaustionRecovery": 40,
  "postWarCooldownYears": 20
}
```

- Significance: Existing numeric review blocker carried forward.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → PEACE_EXHAUSTION_POLICY → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### POI_RENAME_CONSEQUENCES

- Purpose: Controls political and historical consequences of KEEP and REQUEST_RENAME decisions.
- Units/range: typed deltas and durations; Per-field schema limits
- Consumers: POI naming rights
- Locked structure shown with this row: none
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "legitimacy",
    "acceptance/grievance",
    "historical erasure",
    "group safety/migration",
    "pillar and Family reputation",
    "propaganda",
    "diplomatic claims",
    "conflict risk",
    "durable cultural memory"
  ]
}
```

- Significance: Consequence categories are structural; magnitudes remain unresolved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → POI_RENAME_CONSEQUENCES → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### QUARTERMASTER_CAPACITY_LOSS

- Purpose: Controls intake, storage, throughput, disruption, spoilage, and delivery loss.
- Units/range: aggregate stock/year and basis points; Non-negative; loss 0..10000 bps
- Consumers: logistics flow
- Locked structure shown with this row: none
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "intake capacity",
    "storage",
    "throughput",
    "disruption",
    "spoilage",
    "delivery loss"
  ]
}
```

- Significance: No numeric capacity or loss formula has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → QUARTERMASTER_CAPACITY_LOSS → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### REFUGE_OUTPUT

- Purpose: Controls aggregate Refuge output entering local logistics.
- Units/range: aggregate stock/year; Non-negative
- Consumers: Quartermaster intake
- Locked structure shown with this row: REFUGE_CLASSIFICATION_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "production formula",
    "capacity",
    "quality modifiers"
  ]
}
```

- Significance: No numeric output formula has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → REFUGE_OUTPUT → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### REFUGE_REPLENISHMENT

- Purpose: Controls recovery and replenishment of Refuge output.
- Units/range: aggregate stock/year; Non-negative and capacity bounded
- Consumers: Refuge stock
- Locked structure shown with this row: REFUGE_CLASSIFICATION_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "replenishment rate",
    "damage response",
    "capacity bound"
  ]
}
```

- Significance: No numeric replenishment formula has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → REFUGE_REPLENISHMENT → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### RESOURCE_YIELD_DEPLETION

- Purpose: Controls aggregate ResourceNode yield, regeneration, depletion, and recovery.
- Units/range: aggregate stock/year; Non-negative and capacity bounded
- Consumers: ResourceNode stock
- Locked structure shown with this row: none
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "yield",
    "regeneration",
    "depletion",
    "recovery"
  ]
}
```

- Significance: No numeric Resource formula has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → RESOURCE_YIELD_DEPLETION → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SETTLEMENT_INFLUENCE

- Purpose: Transforms locked contributors into a geodesic influence radius.
- Units/range: distance and fixed-point weights; Positive bounded radius; saturating transforms
- Consumers: territory, POI/Refuge/Resource/route control
- Locked structure shown with this row: INFLUENCE_BOUNDARY_STRUCTURE, INFLUENCE_CONTRIBUTOR_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "normalization by contributor",
    "saturation",
    "caps",
    "weights",
    "radius formula",
    "whether and how route centrality contributes"
  ]
}
```

- Significance: Contributor categories and boundary geometry are locked; exact formulas and proposed route centrality remain candidates.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SETTLEMENT_INFLUENCE → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SHRINE_THRESHOLD

- Purpose: Determines when a Deity becomes eligible for its single world Shrine.
- Units/range: parts per million of Settlement population; 0..1000000 ppm
- Consumers: religious-site eligibility
- Locked structure shown with this row: RELIGIOUS_SITE_CARDINALITY, PANTHEON_CENTER_SELECTION_STRUCTURE
- Candidate values:

```json
{
  "minimumSettlementSharePpm": 800000
}
```

- Significance: The 80 percent threshold remains a numeric candidate.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SHRINE_THRESHOLD → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SKIRMISH_PROFILE

- Purpose: Controls bounded skirmish effects.
- Units/range: typed fixed-point values; Per-field schema limits
- Consumers: border skirmish
- Locked structure shown with this row: none
- Candidate values:

```json
{
  "schemaVersion": "echoes-skirmish-profile-v1",
  "tensionDelta": 40,
  "grievanceDelta": 50,
  "exhaustionDelta": 30,
  "prosperityDamage": 10,
  "mortalityBps": 1
}
```

- Significance: Existing numeric review blocker carried forward.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SKIRMISH_PROFILE → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SUSTENANCE_ANGER_NUMERIC

- Purpose: Controls production/availability, consumption/demand, scarcity/satisfaction, and decay where applicable for ANGER.
- Units/range: aggregate quantity/year and parts per million; Non-negative; conservation-valid; classification semantics respected
- Consumers: dynamic sustenance:ANGER
- Locked structure shown with this row: NON_REFUGE_SUSTENANCE_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "productionAvailability",
    "consumptionDemand",
    "scarcitySatisfaction",
    "decayIfApplicable"
  ]
}
```

- Significance: No numeric ANGER sustenance formula has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SUSTENANCE_ANGER_NUMERIC → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SUSTENANCE_BLOOD_NUMERIC

- Purpose: Controls production/availability, consumption/demand, scarcity/satisfaction, and decay where applicable for BLOOD.
- Units/range: aggregate quantity/year and parts per million; Non-negative; conservation-valid; classification semantics respected
- Consumers: dynamic sustenance:BLOOD
- Locked structure shown with this row: NON_REFUGE_SUSTENANCE_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "productionAvailability",
    "consumptionDemand",
    "scarcitySatisfaction",
    "decayIfApplicable"
  ]
}
```

- Significance: No numeric BLOOD sustenance formula has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SUSTENANCE_BLOOD_NUMERIC → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SUSTENANCE_DESIRE_NUMERIC

- Purpose: Controls production/availability, consumption/demand, scarcity/satisfaction, and decay where applicable for DESIRE.
- Units/range: aggregate quantity/year and parts per million; Non-negative; conservation-valid; classification semantics respected
- Consumers: dynamic sustenance:DESIRE
- Locked structure shown with this row: NON_REFUGE_SUSTENANCE_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "productionAvailability",
    "consumptionDemand",
    "scarcitySatisfaction",
    "decayIfApplicable"
  ]
}
```

- Significance: No numeric DESIRE sustenance formula has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SUSTENANCE_DESIRE_NUMERIC → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SUSTENANCE_DREAMS_NUMERIC

- Purpose: Controls production/availability, consumption/demand, scarcity/satisfaction, and decay where applicable for DREAMS.
- Units/range: aggregate quantity/year and parts per million; Non-negative; conservation-valid; classification semantics respected
- Consumers: dynamic sustenance:DREAMS
- Locked structure shown with this row: NON_REFUGE_SUSTENANCE_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "productionAvailability",
    "consumptionDemand",
    "scarcitySatisfaction",
    "decayIfApplicable"
  ]
}
```

- Significance: No numeric DREAMS sustenance formula has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SUSTENANCE_DREAMS_NUMERIC → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SUSTENANCE_EMOTION_NUMERIC

- Purpose: Controls production/availability, consumption/demand, scarcity/satisfaction, and decay where applicable for EMOTION.
- Units/range: aggregate quantity/year and parts per million; Non-negative; conservation-valid; classification semantics respected
- Consumers: dynamic sustenance:EMOTION
- Locked structure shown with this row: NON_REFUGE_SUSTENANCE_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "productionAvailability",
    "consumptionDemand",
    "scarcitySatisfaction",
    "decayIfApplicable"
  ]
}
```

- Significance: No numeric EMOTION sustenance formula has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SUSTENANCE_EMOTION_NUMERIC → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SUSTENANCE_ESSENCE_OF_FAITH_NUMERIC

- Purpose: Controls production/availability, consumption/demand, scarcity/satisfaction, and decay where applicable for ESSENCE_OF_FAITH.
- Units/range: aggregate quantity/year and parts per million; Non-negative; conservation-valid; classification semantics respected
- Consumers: dynamic sustenance:ESSENCE_OF_FAITH
- Locked structure shown with this row: NON_REFUGE_SUSTENANCE_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "productionAvailability",
    "consumptionDemand",
    "scarcitySatisfaction",
    "decayIfApplicable"
  ]
}
```

- Significance: No numeric ESSENCE_OF_FAITH sustenance formula has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SUSTENANCE_ESSENCE_OF_FAITH_NUMERIC → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SUSTENANCE_FEAR_NUMERIC

- Purpose: Controls production/availability, consumption/demand, scarcity/satisfaction, and decay where applicable for FEAR.
- Units/range: aggregate quantity/year and parts per million; Non-negative; conservation-valid; classification semantics respected
- Consumers: dynamic sustenance:FEAR
- Locked structure shown with this row: NON_REFUGE_SUSTENANCE_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "productionAvailability",
    "consumptionDemand",
    "scarcitySatisfaction",
    "decayIfApplicable"
  ]
}
```

- Significance: No numeric FEAR sustenance formula has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SUSTENANCE_FEAR_NUMERIC → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SUSTENANCE_GRIEF_NUMERIC

- Purpose: Controls production/availability, consumption/demand, scarcity/satisfaction, and decay where applicable for GRIEF.
- Units/range: aggregate quantity/year and parts per million; Non-negative; conservation-valid; classification semantics respected
- Consumers: dynamic sustenance:GRIEF
- Locked structure shown with this row: NON_REFUGE_SUSTENANCE_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "productionAvailability",
    "consumptionDemand",
    "scarcitySatisfaction",
    "decayIfApplicable"
  ]
}
```

- Significance: No numeric GRIEF sustenance formula has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SUSTENANCE_GRIEF_NUMERIC → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SUSTENANCE_MEMORY_NUMERIC

- Purpose: Controls production/availability, consumption/demand, scarcity/satisfaction, and decay where applicable for MEMORY.
- Units/range: aggregate quantity/year and parts per million; Non-negative; conservation-valid; classification semantics respected
- Consumers: dynamic sustenance:MEMORY
- Locked structure shown with this row: NON_REFUGE_SUSTENANCE_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "productionAvailability",
    "consumptionDemand",
    "scarcitySatisfaction",
    "decayIfApplicable"
  ]
}
```

- Significance: No numeric MEMORY sustenance formula has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SUSTENANCE_MEMORY_NUMERIC → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SUSTENANCE_MUSIC_ATTENTION_NUMERIC

- Purpose: Controls production/availability, consumption/demand, scarcity/satisfaction, and decay where applicable for MUSIC_ATTENTION.
- Units/range: aggregate quantity/year and parts per million; Non-negative; conservation-valid; classification semantics respected
- Consumers: dynamic sustenance:MUSIC_ATTENTION
- Locked structure shown with this row: NON_REFUGE_SUSTENANCE_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "productionAvailability",
    "consumptionDemand",
    "scarcitySatisfaction",
    "decayIfApplicable"
  ]
}
```

- Significance: No numeric MUSIC_ATTENTION sustenance formula has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SUSTENANCE_MUSIC_ATTENTION_NUMERIC → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SUSTENANCE_NECROMANTIC_ESSENCE_NUMERIC

- Purpose: Controls production/availability, consumption/demand, scarcity/satisfaction, and decay where applicable for NECROMANTIC_ESSENCE.
- Units/range: aggregate quantity/year and parts per million; Non-negative; conservation-valid; classification semantics respected
- Consumers: dynamic sustenance:NECROMANTIC_ESSENCE
- Locked structure shown with this row: NON_REFUGE_SUSTENANCE_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "productionAvailability",
    "consumptionDemand",
    "scarcitySatisfaction",
    "decayIfApplicable"
  ]
}
```

- Significance: No numeric NECROMANTIC_ESSENCE sustenance formula has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SUSTENANCE_NECROMANTIC_ESSENCE_NUMERIC → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SUSTENANCE_NO_FEEDING_NUMERIC

- Purpose: Controls production/availability, consumption/demand, scarcity/satisfaction, and decay where applicable for NO_FEEDING.
- Units/range: aggregate quantity/year and parts per million; Non-negative; conservation-valid; classification semantics respected
- Consumers: dynamic sustenance:NO_FEEDING
- Locked structure shown with this row: NON_REFUGE_SUSTENANCE_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "productionAvailability",
    "consumptionDemand",
    "scarcitySatisfaction",
    "decayIfApplicable"
  ]
}
```

- Significance: No numeric NO_FEEDING sustenance formula has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SUSTENANCE_NO_FEEDING_NUMERIC → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SUSTENANCE_OATHS_HONOR_NUMERIC

- Purpose: Controls production/availability, consumption/demand, scarcity/satisfaction, and decay where applicable for OATHS_HONOR.
- Units/range: aggregate quantity/year and parts per million; Non-negative; conservation-valid; classification semantics respected
- Consumers: dynamic sustenance:OATHS_HONOR
- Locked structure shown with this row: NON_REFUGE_SUSTENANCE_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "productionAvailability",
    "consumptionDemand",
    "scarcitySatisfaction",
    "decayIfApplicable"
  ]
}
```

- Significance: No numeric OATHS_HONOR sustenance formula has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SUSTENANCE_OATHS_HONOR_NUMERIC → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### SUSTENANCE_SIN_NUMERIC

- Purpose: Controls production/availability, consumption/demand, scarcity/satisfaction, and decay where applicable for SIN.
- Units/range: aggregate quantity/year and parts per million; Non-negative; conservation-valid; classification semantics respected
- Consumers: dynamic sustenance:SIN
- Locked structure shown with this row: NON_REFUGE_SUSTENANCE_STRUCTURE
- Candidate values:

```json
{
  "status": "OWNER_VALUES_REQUIRED",
  "unresolvedFields": [
    "productionAvailability",
    "consumptionDemand",
    "scarcitySatisfaction",
    "decayIfApplicable"
  ]
}
```

- Significance: No numeric SIN sustenance formula has been approved.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → SUSTENANCE_SIN_NUMERIC → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### TEMPLE_THRESHOLD

- Purpose: Determines when a Deity becomes eligible for its single world Temple.
- Units/range: worshippers; >= 1
- Consumers: religious-site eligibility
- Locked structure shown with this row: RELIGIOUS_SITE_CARDINALITY, PANTHEON_CENTER_SELECTION_STRUCTURE
- Candidate values:

```json
{
  "minimumWorshippers": 100000
}
```

- Significance: The 100,000 threshold remains a numeric candidate.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → TEMPLE_THRESHOLD → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.

### TERRAIN_COMPATIBILITY_POLICY

- Purpose: Controls compatibility between population ecology and physical sites.
- Units/range: score 0..1000; 0..1000
- Consumers: founding, migration
- Locked structure shown with this row: none
- Candidate values:

```json
{
  "schemaVersion": "echoes-terrain-compatibility-v1",
  "exactSpecificMatch": 1000,
  "broadMatchNoSpecificConflict": 750,
  "broadMatchSpecificMismatch": 500,
  "broadMismatch": 200,
  "unknown": 500
}
```

- Significance: Existing numeric review blocker carried forward.
- If unapproved: the simulator fails closed only when a causal consumer first requires this policy.
- Exact action: Owner Policy Center → TERRAIN_COMPATIBILITY_POLICY → review → EDIT AS NEW REVISION if needed → APPROVE. Identity, timestamp, revision, hash, prior revision, provenance, and the lifecycle-default boundary are automatic; enter a year only to override the default.


## APPROVED POLICY REVISION

None are asserted by this regenerated candidate artifact. Runtime approvals, when present, are shown from immutable PostgreSQL revisions.

## REJECTED / SUPERSEDED

None are asserted by this regenerated candidate artifact. Runtime rejected and superseded revisions remain visible in history.
