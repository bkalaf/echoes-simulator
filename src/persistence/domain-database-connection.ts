import { existsSync, lstatSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type DomainDatabaseConnectionSource =
  | "EXPLICIT_DATABASE_URL"
  | "ECHOES_SHARED_LOCAL_CONFIG"
  | "ELECTRON_SAFE_STORAGE";

export interface ResolvedDomainDatabaseConnection {
  connectionString: string;
  source: DomainDatabaseConnectionSource;
  displayLabel: string;
  sharedCanonicalDatabase: boolean;
  configurationRoot: string | null;
}

export interface DomainDatabaseConnectionResolutionOptions {
  environment?: Readonly<Record<string, string | undefined>>;
  currentDirectory?: string;
  simulatorRoot?: string;
  packagedOverride?: (() => string | null) | null;
}

export class DomainDatabaseConnectionResolutionError extends Error {
  constructor(public readonly diagnosticCode: string, message: string) {
    super(message);
    this.name = "DomainDatabaseConnectionResolutionError";
  }
}

let packagedConnectionProvider: (() => string | null) | null = null;

export function setPackagedDomainDatabaseConnectionProvider(provider: (() => string | null) | null): void {
  packagedConnectionProvider = provider;
}

function resolvedConnection(
  connectionString: string,
  metadata: Omit<ResolvedDomainDatabaseConnection, "connectionString">,
): ResolvedDomainDatabaseConnection {
  const result = { ...metadata } as ResolvedDomainDatabaseConnection;
  Object.defineProperty(result, "connectionString", { value: connectionString, enumerable: false, configurable: false, writable: false });
  return Object.freeze(result);
}

function validatedPostgresConnectionString(value: string, diagnosticCode: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new DomainDatabaseConnectionResolutionError(diagnosticCode, "Canonical database credential is empty");
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") throw new Error("unsupported protocol");
  } catch {
    throw new DomainDatabaseConnectionResolutionError(diagnosticCode, "Canonical database credential is not a PostgreSQL URL");
  }
  return trimmed;
}

function packageRootFrom(start: string): string | null {
  let current = resolve(start);
  for (;;) {
    const packagePath = resolve(current, "package.json");
    if (existsSync(packagePath)) {
      try {
        const candidate = JSON.parse(readFileSync(packagePath, "utf8")) as { name?: unknown };
        if (candidate.name === "@echoes/simulator") return current;
      } catch {
        // Continue upward. A malformed unrelated package file is not authority.
      }
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function configPathForRoot(candidateRoot: string): string | null {
  const resolvedRoot = resolve(candidateRoot);
  const candidates = resolvedRoot.endsWith(".json")
    ? [resolvedRoot]
    : [resolve(resolvedRoot, ".local/config.json"), resolve(resolvedRoot, "config.json")];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function sharedConnectionFromConfig(candidateRoot: string): ResolvedDomainDatabaseConnection | null {
  const configPath = configPathForRoot(candidateRoot);
  if (!configPath) return null;
  let config: { credentialDirectory?: unknown };
  try {
    config = JSON.parse(readFileSync(configPath, "utf8")) as { credentialDirectory?: unknown };
  } catch {
    throw new DomainDatabaseConnectionResolutionError("ECHOES_CANONICAL_CONFIG_INVALID", "Echoes canonical local configuration is not valid JSON");
  }
  if (typeof config.credentialDirectory !== "string" || !config.credentialDirectory.trim()) {
    throw new DomainDatabaseConnectionResolutionError("ECHOES_CREDENTIAL_DIRECTORY_INVALID", "Echoes canonical local configuration does not define credentialDirectory");
  }
  const repositoryRoot = basename(dirname(configPath)) === ".local" ? dirname(dirname(configPath)) : dirname(configPath);
  const credentialDirectory = isAbsolute(config.credentialDirectory)
    ? resolve(config.credentialDirectory)
    : resolve(repositoryRoot, config.credentialDirectory);
  const credentialPath = resolve(credentialDirectory, "database_url");
  if (!existsSync(credentialPath)) {
    throw new DomainDatabaseConnectionResolutionError("ECHOES_DATABASE_CREDENTIAL_MISSING", "Echoes canonical database credential file is missing");
  }
  const metadata = lstatSync(credentialPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new DomainDatabaseConnectionResolutionError("ECHOES_DATABASE_CREDENTIAL_UNSAFE", "Echoes canonical database credential must be a regular non-symlink file");
  }
  if (metadata.size <= 0 || metadata.size > 16_384) {
    throw new DomainDatabaseConnectionResolutionError("ECHOES_DATABASE_CREDENTIAL_INVALID_SIZE", "Echoes canonical database credential has an invalid size");
  }
  if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
    throw new DomainDatabaseConnectionResolutionError("ECHOES_DATABASE_CREDENTIAL_PERMISSIONS", "Echoes canonical database credential permissions are too broad");
  }
  const connectionString = validatedPostgresConnectionString(readFileSync(credentialPath, "utf8"), "ECHOES_DATABASE_CREDENTIAL_INVALID");
  return resolvedConnection(connectionString, {
    source: "ECHOES_SHARED_LOCAL_CONFIG",
    displayLabel: "Echoes shared PostgreSQL",
    sharedCanonicalDatabase: true,
    configurationRoot: repositoryRoot,
  });
}

export function resolveDomainDatabaseConnection(options: DomainDatabaseConnectionResolutionOptions = {}): ResolvedDomainDatabaseConnection | null {
  const environment = options.environment ?? process.env;
  const explicit = environment.DATABASE_URL?.trim();
  if (explicit) return resolvedConnection(validatedPostgresConnectionString(explicit, "EXPLICIT_DATABASE_URL_INVALID"), {
    source: "EXPLICIT_DATABASE_URL",
    displayLabel: "Explicit simulator PostgreSQL override",
    sharedCanonicalDatabase: false,
    configurationRoot: null,
  });

  const currentDirectory = resolve(options.currentDirectory ?? process.cwd());
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const simulatorRoot = resolve(options.simulatorRoot ?? packageRootFrom(currentDirectory) ?? packageRootFrom(moduleDirectory) ?? currentDirectory);
  const configuredRoot = environment.ECHOES_CANONICAL_CONFIG_ROOT?.trim();
  const siblingCandidates = configuredRoot
    ? [isAbsolute(configuredRoot) ? configuredRoot : resolve(currentDirectory, configuredRoot)]
    : [resolve(simulatorRoot, "../echoes-of-eidolon"), resolve(currentDirectory, "../echoes-of-eidolon")];
  for (const candidate of [...new Set(siblingCandidates.map((entry) => resolve(entry)))]) {
    const shared = sharedConnectionFromConfig(candidate);
    if (shared) return shared;
  }

  const packaged = options.packagedOverride ?? packagedConnectionProvider;
  const packagedValue = packaged?.()?.trim();
  if (packagedValue) return resolvedConnection(validatedPostgresConnectionString(packagedValue, "ELECTRON_SAFE_STORAGE_DATABASE_URL_INVALID"), {
    source: "ELECTRON_SAFE_STORAGE",
    displayLabel: "Packaged secure PostgreSQL override",
    sharedCanonicalDatabase: false,
    configurationRoot: null,
  });
  return null;
}
