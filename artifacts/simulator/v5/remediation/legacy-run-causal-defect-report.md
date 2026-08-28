# Legacy run causal defect report

The pre-v5.2.0 run omitted Founding Waves 2–5 and cannot resume under the corrected scheduler/mechanics identity. Causal resume fails closed before writes. Owner naming responses remain eligible only through the non-causal `LEGACY_NAMING_ONLY` acceptance path, which preserves the stored scheduler, mechanics, derivation, causal-run hash, event history, and checkpoint hashes.

- Live database opened through SQLite during this acceptance: **NO**
- Live database opened writable during this acceptance: **NO**
- Live main/WAL byte fingerprints unchanged: **YES**
- Live main/WAL/SHM filesystem envelope unchanged: **YES**
- Live logical causal/naming digests unchanged: **YES**
- Overall live causal preservation: **PASS**
- Replay/checkpoint continuation equivalence: **PASS**
