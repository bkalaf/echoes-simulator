# Codex output review packet

This packet contains the standalone implementation produced in `/home/bobby/echoes-simulator`:

- application source (`src/`, `electron/`);
- tests and build configuration;
- standalone policy, contract, reference, personality, and Site resource snapshots used by the implementation;
- compiled renderer and Node/Electron output (`dist/`, `dist-electron/`);
- tranche and final-verification evidence under `artifacts/implementation/`;
- lockfile and workspace metadata required to reproduce the dependency graph.
- the owner-supplied `echoes_of_eidolon_breed_research_2026-08-17.zip`, unchanged, with SHA-256 `7d6b1651472a504ce861bf031f89a582df3a8ad06b3417a7d38436bcae7a9033`.

Deliberately excluded because they are owner inputs or generated dependency caches rather than Codex outputs:

- `ECHOES_OF_EIDOLON_SIMULATOR_CODEX_IMPLEMENTATION_PACK_2026-08-18/` and its ZIP;
- the extracted `echoes_of_eidolon_breed_research_2026-08-17/` duplicate directory;
- `node_modules/` and `.pnpm-store/`;
- `.git/`, `.agents/`, and `.codex/` workspace metadata.

The packet does not contain or modify files from the Echoes monorepo.

`KNOWN_MISTAKES_FOR_REVIEW.md` documents the implementation exactly as delivered, including the incorrect Breed authority handling and incomplete/overclaimed areas. No implementation correction was made after identifying those defects.
