# Tranche 00 — Bootstrap Handoff

## Baseline

- Standalone-root placement explicitly authorized by owner; monorepo placement superseded.
- Starting Git SHA/branch: not applicable; `/home/bobby/echoes-simulator` was not an initialized Git checkout.
- Existing user artifacts preserved: implementation pack ZIP/directory and owner-added `echoes_of_eidolon_breed_research_2026-08-17.zip`.
- Node: `v22.22.0`; pnpm: `10.33.2`.
- No commit, branch, worktree, clone, push, publication, deployment, or provider/production mutation.

## Implemented

- Root standalone package `@echoes/simulator` version `0.1.0`.
- Electron 37.10.3 source boundary with `contextIsolation: true`, `nodeIntegration: false`, sandboxed renderer, deny-by-default external windows, and allowlisted preload calls.
- React/Vite operator shell.
- Versioned core contracts, run lifecycle, deterministic SHA-256 scoped random service, stable event identities/order, canonical BigInt JSON, exact rational helpers, and deterministic largest-remainder apportionment.
- Local SQLite adapter using Node's SQLite API, with normalized run/input/readiness/event/checkpoint/naming tables and append-order uniqueness.
- Worker request validation with version rejection.
- Static engine guard rejecting ambient `Math.random()`.

## Persistence


Electron runtime databases are created below `app.getPath("userData")`; tests require an explicit temporary path. Mutable databases are ignored from source control.

## Dependency/environment note

Outbound npm DNS and execution of binaries located on the writable workspace mount are restricted in this session. Dependencies were resolved from the existing read-only pnpm content-addressed cache with a local project registry and install scripts disabled. TypeScript/Vitest run through Node; Vite uses the identical cached esbuild 0.28.1 binary outside the no-exec workspace mount. This is an execution-environment accommodation, not a product runtime dependency on another repository.

## RED evidence

- Initial focused Vitest run: 3 suites failed because tranche modules did not exist.
- SQLite integration RED: failed because `src/persistence/sqlite-store.ts` did not exist.
- First GREEN candidate exposed a wrong provisional PRNG vector (`expected -1`, actual pinned SHA-256 algorithm result `2`); the vector was corrected to the implemented stable algorithm and rerun.

## GREEN evidence

- `node node_modules/vitest/vitest.mjs run tests/unit tests/integration/sqlite-store.test.ts`: 4 files, 8 tests passed.
- `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`: passed.
- `node node_modules/typescript/bin/tsc -p tsconfig.node.json --noEmit`: passed.
- Node TypeScript build plus Vite 7.3.6 production renderer build: passed; 28 modules transformed.

## Remaining scope

Tranches 01–08: real input importer/readiness, historical mechanics, naming workflow, full browser, deterministic export, Electron E2E/package launch, and full 0–2000 proof.
