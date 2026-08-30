import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DomainDatabaseConnectionResolutionError, resolveDomainDatabaseConnection } from "../../src/persistence/domain-database-connection.js";

function sharedFixture(): { root: string; simulatorRoot: string; siblingRoot: string; secret: string } {
  const root = mkdtempSync(join(tmpdir(), "echoes-domain-discovery-"));
  const simulatorRoot = join(root, "echoes-simulator");
  const siblingRoot = join(root, "echoes-of-eidolon");
  const secretDirectory = join(siblingRoot, ".local/secrets");
  const secret = "postgresql://owner:private-value@127.0.0.1:5432/shared";
  mkdirSync(simulatorRoot, { recursive: true });
  mkdirSync(secretDirectory, { recursive: true });
  writeFileSync(join(simulatorRoot, "package.json"), JSON.stringify({ name: "@echoes/simulator" }));
  writeFileSync(join(siblingRoot, ".local/config.json"), JSON.stringify({ credentialDirectory: ".local/secrets" }));
  writeFileSync(join(secretDirectory, "database_url"), `${secret}\n`, { mode: 0o600 });
  return { root, simulatorRoot, siblingRoot, secret };
}

describe("shared Echoes PostgreSQL connection discovery", () => {
  it("prefers an explicit simulator override", () => {
    const fixture = sharedFixture();
    const explicit = "postgresql://explicit:secret@localhost:5432/override";
    const result = resolveDomainDatabaseConnection({ simulatorRoot: fixture.simulatorRoot, currentDirectory: fixture.simulatorRoot, environment: { DATABASE_URL: explicit }, packagedOverride: () => "postgresql://packaged:secret@localhost:5432/package" });
    expect(result).toMatchObject({ source: "EXPLICIT_DATABASE_URL", sharedCanonicalDatabase: false });
    expect(result?.connectionString).toBe(explicit);
  });

  it("discovers the sibling config before packaged safeStorage and never serializes the secret", () => {
    const fixture = sharedFixture();
    const result = resolveDomainDatabaseConnection({ simulatorRoot: fixture.simulatorRoot, currentDirectory: fixture.simulatorRoot, environment: {}, packagedOverride: () => "postgresql://packaged:secret@localhost:5432/package" });
    expect(result).toMatchObject({ source: "ECHOES_SHARED_LOCAL_CONFIG", displayLabel: "Echoes shared PostgreSQL", sharedCanonicalDatabase: true });
    expect(result?.connectionString).toBe(fixture.secret);
    expect(JSON.stringify(result)).not.toContain(fixture.secret);
    expect(Object.keys(result ?? {})).not.toContain("connectionString");
  });

  it("supports an explicit canonical configuration-root override", () => {
    const fixture = sharedFixture();
    const result = resolveDomainDatabaseConnection({ currentDirectory: fixture.simulatorRoot, simulatorRoot: fixture.simulatorRoot, environment: { ECHOES_CANONICAL_CONFIG_ROOT: fixture.siblingRoot } });
    expect(result?.source).toBe("ECHOES_SHARED_LOCAL_CONFIG");
    expect(result?.configurationRoot).toBe(fixture.siblingRoot);
  });

  it("uses packaged safeStorage only when explicit and shared development configuration are absent", () => {
    const root = mkdtempSync(join(tmpdir(), "echoes-domain-packaged-"));
    const packaged = "postgresql://packaged:secret@localhost:5432/package";
    const result = resolveDomainDatabaseConnection({ currentDirectory: root, simulatorRoot: root, environment: {}, packagedOverride: () => packaged });
    expect(result).toMatchObject({ source: "ELECTRON_SAFE_STORAGE", sharedCanonicalDatabase: false });
    expect(result?.connectionString).toBe(packaged);
  });

  it("returns null only after every configured source is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "echoes-domain-absent-"));
    expect(resolveDomainDatabaseConnection({ currentDirectory: root, simulatorRoot: root, environment: {}, packagedOverride: () => null })).toBeNull();
  });

  it.runIf(process.platform !== "win32")("rejects a broadly readable sibling credential", () => {
    const fixture = sharedFixture();
    chmodSync(join(fixture.siblingRoot, ".local/secrets/database_url"), 0o644);
    expect(() => resolveDomainDatabaseConnection({ simulatorRoot: fixture.simulatorRoot, currentDirectory: fixture.simulatorRoot, environment: {} })).toThrowError(DomainDatabaseConnectionResolutionError);
  });
});
