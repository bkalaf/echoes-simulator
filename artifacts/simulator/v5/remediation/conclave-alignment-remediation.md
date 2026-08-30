# Conclave alignment remediation

PoliticalPerson alignment is now explicit durable state with effective-year provenance. New people receive a normalized vector during materialization; the same vector is used by deterministic office selection, persisted in causal selection evidence, projected to normalized PostgreSQL records, and read from PostgreSQL by People, Conclave, and Senate views. Immutable older checkpoints with no person vector remain `UNKNOWN/UNALIGNED`; no World, State, Family, Settlement, Breed, constituency, or selector fallback is used by the read model.

Constituency, representative, and selection-authority vectors are separate. City-seat constituency alignment comes from the represented Settlement population. Ruler appointment compares the representative with the persisted ruler or State authority; popular election compares with the constituency. The event records all three vectors, selector identity/type, source and origin Settlements, the exact SelectionRule snapshot, candidate count, score, and components.

The regression fixture makes one city 75% Ruin. Ruler appointment selects the explicit Concord person and preserves the political mismatch; popular election selects the explicit Ruin person. A legacy Lupin-style UI fixture has a Concord Family, Ruin constituency, Concord selector, and missing person vector; the representative renders `UNKNOWN/UNALIGNED` and is not inferred.

Versions: mechanics/scheduler 5.5.0, read model 1.3.0, derivation 1.1.0 unchanged, durable world schema unchanged.

Verified: typecheck, V5 architecture 28/28, Conclave UI 1/1, Atlas reconciliation 3/3, PostgreSQL domain 3/3, and 9/9 relevant Prompt 01 tests. One unrelated repository test remains blocked by the existing Breed–Deity 2062-vs-2063 coverage mismatch.
