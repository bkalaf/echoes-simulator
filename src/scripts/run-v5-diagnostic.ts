import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import { normalizeSeed } from "../core/v5/random.js";
import { runPersistedV5Diagnostic } from "../core/v5/service.js";
import { legacyImportTestCanonicalAuthorityV5 } from "../core/v5/canonical-adapter.js";
import { SimulatorStore } from "../persistence/sqlite-store.js";

const throughYear = process.argv[2] === undefined ? 25 : Number(process.argv[2]);
if (!Number.isSafeInteger(throughYear) || throughYear < 0) throw new Error("Usage: pnpm diagnostic:v5 [nonnegative-through-year] [seed]");
const seed = normalizeSeed(process.argv[3] ?? "EIDOLON_V5_DIAGNOSTIC");
const outputDirectory = resolve("artifacts/simulator/v5");
mkdirSync(outputDirectory, { recursive: true });
const store = new SimulatorStore(resolve(outputDirectory, "diagnostic.sqlite"));
try {
  const result = runPersistedV5Diagnostic({ store, canonicalAuthority: legacyImportTestCanonicalAuthorityV5(resolve("resources/canonical")), normalizedSeed: seed, throughYear });
  process.stdout.write(`${canonicalJson({ ...result, databasePath: store.filename })}\n`);
} finally {
  store.close();
}
