import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export interface LegacyV5NamingTrustInspection {
  filename: string;
  trustStatus: "NO_DATABASE" | "NO_V5_RUNS" | "TRUSTED_V5_LEDGER" | "LEGACY_UNTRUSTED_NAMING";
  requiresFreshTrustedDatabase: boolean;
  v5RunCount: number;
  legacyLabelCount: number;
  trustedLedgerCount: number;
  bytesBefore: number;
  bytesAfter: number;
  sha256Before: string;
  sha256After: string;
}

function fingerprint(filename: string): { bytes: number; sha256: string } {
  if (!existsSync(filename)) return { bytes: 0, sha256: createHash("sha256").update("").digest("hex") };
  const bytes = statSync(filename).size;
  const digest = createHash("sha256");
  const descriptor = openSync(filename, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) { const count = readSync(descriptor, buffer, 0, buffer.length, null); if (count === 0) break; digest.update(buffer.subarray(0, count)); }
  } finally { closeSync(descriptor); }
  return { bytes, sha256: digest.digest("hex") };
}

/** Opens an existing database read-only and derives trust without schema initialization. */
export function inspectLegacyV5NamingTrust(filename: string): LegacyV5NamingTrustInspection {
  const before = fingerprint(filename);
  if (!existsSync(filename)) return { filename, trustStatus: "NO_DATABASE", requiresFreshTrustedDatabase: false, v5RunCount: 0, legacyLabelCount: 0, trustedLedgerCount: 0, bytesBefore: before.bytes, bytesAfter: before.bytes, sha256Before: before.sha256, sha256After: before.sha256 };
  const database = new DatabaseSync(filename, { readOnly: true });
  let v5RunCount = 0; let legacyLabelCount = 0; let trustedLedgerCount = 0;
  try {
    const tables = new Set((database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((row) => row.name));
    if (tables.has("v5_run_manifest")) v5RunCount = (database.prepare("SELECT COUNT(*) AS count FROM v5_run_manifest").get() as { count: number }).count;
    if (tables.has("v5_label_input")) legacyLabelCount = (database.prepare("SELECT COUNT(*) AS count FROM v5_label_input").get() as { count: number }).count;
    if (tables.has("v5_label_ledger")) trustedLedgerCount = (database.prepare("SELECT COUNT(*) AS count FROM v5_label_ledger").get() as { count: number }).count;
  } finally { database.close(); }
  const after = fingerprint(filename);
  if (before.bytes !== after.bytes || before.sha256 !== after.sha256) throw new Error("Read-only legacy V5 trust inspection changed database bytes");
  const legacy = v5RunCount > 0 && (trustedLedgerCount === 0 || legacyLabelCount > 0);
  return { filename, trustStatus: legacy ? "LEGACY_UNTRUSTED_NAMING" : v5RunCount === 0 ? "NO_V5_RUNS" : "TRUSTED_V5_LEDGER", requiresFreshTrustedDatabase: legacy, v5RunCount, legacyLabelCount, trustedLedgerCount, bytesBefore: before.bytes, bytesAfter: after.bytes, sha256Before: before.sha256, sha256After: after.sha256 };
}
