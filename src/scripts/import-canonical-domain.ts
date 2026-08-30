import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import { loadBundledCanonicalV5 } from "../core/v5/canonical-adapter.js";
import { disconnectDomainDatabase, getDomainDatabase } from "../persistence/postgres-domain.js";
import { V5_CANONICAL_CORE_AUTHORITY_ID } from "../persistence/postgres-canonical.js";
import { flattenTypedAuthorityValues } from "../persistence/typed-authority-values.js";

const sourceDirectory = resolve(process.argv[2] ?? "resources/canonical");
const canonical = loadBundledCanonicalV5(sourceDirectory);
const contentSha256 = createHash("sha256").update(canonicalJson(canonical), "utf8").digest("hex");
const revisionId = `${V5_CANONICAL_CORE_AUTHORITY_ID}_${contentSha256.slice(0, 20)}`;
const database = getDomainDatabase();

try {
  const existing = await database.canonicalAuthorityRevision.findUnique({ where: { revisionId } });
  if (!existing) await database.canonicalAuthorityRevision.create({ data: {
    revisionId,
    authorityId: V5_CANONICAL_CORE_AUTHORITY_ID,
    authorityType: "CANONICAL_DOMAIN_CORE",
    schemaVersion: canonical.schemaVersion,
    contentSha256,
    status: "UNREVIEWED",
    provenanceRef: `LEGACY_IMPORT_ONLY:${sourceDirectory}`,
    values: { create: flattenTypedAuthorityValues(canonical).map((row) => ({ ...row, decimalValue: row.decimalValue?.toString() })) },
  } });
  process.stdout.write(`${JSON.stringify({ status: existing ? "ALREADY_IMPORTED" : "IMPORTED_UNREVIEWED", authorityId: V5_CANONICAL_CORE_AUTHORITY_ID, revisionId, contentSha256, typedValueCount: flattenTypedAuthorityValues(canonical).length, nextAction: "Review and approve this exact canonical revision; import does not grant authority." }, null, 2)}\n`);
} finally {
  await disconnectDomainDatabase();
}
