import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { canonicalJson } from "../core/serialization/canonical-json.js";
import { DEFAULT_MECHANICS_VARIABLES_V1 } from "../core/v5/config.js";
import { restoreMechanicsVariablesV1 } from "../core/v5/configuration.js";
import { V5_RANDOM_NAMESPACES } from "../core/v5/random.js";
import { auditCausalRegistry, DURABLE_WRITER_REGISTRY_V1, V5_CLOSURE_INVARIANTS } from "../core/v5/registry.js";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const target = resolve(directory, name);
    return statSync(target).isDirectory() ? sourceFiles(target) : /\.(ts|tsx|cts|mts)$/.test(name) ? [target] : [];
  }).sort();
}

const directory = resolve("src/core/v5");
const failures: string[] = [];
const usedNamespaces = new Set<string>();
for (const file of sourceFiles(directory)) {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const causal = !file.endsWith("read-model.ts") && !file.endsWith("configuration.ts") && !file.endsWith("service.ts");
  const visit = (node: ts.Node): void => {
    if (causal && ts.isNumericLiteral(node) && node.text.includes(".")) failures.push(`FLOAT_LITERAL:${file}:${source.getLineAndCharacterOfPosition(node.pos).line + 1}:${node.text}`);
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(source);
      if (causal && (expression === "Math.random" || expression === "Math.round")) failures.push(`FORBIDDEN_MATH:${file}:${source.getLineAndCharacterOfPosition(node.pos).line + 1}:${expression}`);
      if ((expression === "randomIdentity" || expression === "identity") && node.arguments.length >= 2 && ts.isStringLiteral(node.arguments[1]!)) usedNamespaces.add(node.arguments[1]!.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

const namingAuditRoots = [resolve("src/core/v5"), resolve("electron"), resolve("src/persistence"), resolve("src/scripts")];
const namingAuditFiles = namingAuditRoots.flatMap(sourceFiles);
const namingWriterInventory = [
  { writer: "SimulatorStore.saveV5NamingRequests/canonical materialization", allowedProvenance: ["CANONICAL_EXISTING"], validationPath: "explicit canonicalNamingAuthorityRef + validateAcceptedLabelProvenanceV5" },
  { writer: "SimulatorStore.recordV5AcceptedLabel", allowedProvenance: ["CANONICAL_EXISTING", "OWNER_INPUT", "AUTOMATIC_REUSE", "TEST_FIXTURE"], validationPath: "validateAcceptedLabelProvenanceV5; TEST_FIXTURE restricted to explicit test artifact" },
  { writer: "SimulatorStore.acceptV5NamingRequests", allowedProvenance: ["LLM_NAMING_RESPONSE"], validationPath: "immutable batch audit + exact response coverage + effective-year equality + persisted response attempt" },
] as const;
for (const file of namingAuditFiles) {
  const text = readFileSync(file, "utf8");
  const relative = file.replace(`${resolve(".")}/`, "");
  if (relative === "src/scripts/audit-v5-architecture.ts") continue;
  if (/Diagnostic \$\{|Diagnostic (STATE|SETTLEMENT|FAMILY|ORGANIZATION|POLITICAL_PERSON|WORLD_ROUTE|WORLD_POI)/.test(text)) failures.push(`SYNTHETIC_DIAGNOSTIC_LABEL:${relative}`);
  if (/ROUTINE_OFFICEHOLDER[^\n]{0,100}AUTOMATIC_REUSE/.test(text)) failures.push(`GENERIC_ROUTINE_REUSE:${relative}`);
  if (/function\s+(generate|synthesize|construct)[A-Za-z0-9_]*Name|\b(syllable|phoneme|markov|wordBucket|adjectiveNoun)\b/i.test(text)) failures.push(`LOCAL_NAME_SYNTHESIS_SYMBOL:${relative}`);
  if (text.includes("INSERT INTO v5_label_ledger") && !relative.endsWith("src/persistence/sqlite-store.ts")) failures.push(`UNREGISTERED_LABEL_LEDGER_WRITER:${relative}`);
  if (text.includes("UPDATE v5_naming_request SET request_json") && !relative.endsWith("src/persistence/sqlite-store.ts")) failures.push(`UNREGISTERED_ACCEPTED_LABEL_WRITER:${relative}`);
}
const persistenceText = readFileSync(resolve("src/persistence/sqlite-store.ts"), "utf8");
for (const required of ["validateAcceptedLabelProvenanceV5(entry", "source: \"LLM_NAMING_RESPONSE\"", "BATCHED naming cannot be accepted while any BLOCKING request remains", "nameEffectiveFromYear"]) if (!persistenceText.includes(required)) failures.push(`MISSING_NAMING_VALIDATION:${required}`);

const registeredNamespaces = new Set<string>(V5_RANDOM_NAMESPACES);
for (const namespace of usedNamespaces) if (!registeredNamespaces.has(namespace)) failures.push(`UNREGISTERED_RANDOM_NAMESPACE:${namespace}`);
const registry = auditCausalRegistry();
if (!registry.pass) failures.push(...registry.undefinedIdentifiers.map((name) => `UNDEFINED_CAUSAL_IDENTIFIER:${name}`), ...registry.duplicateMetrics.map((name) => `DUPLICATE_CAUSAL_METRIC:${name}`), ...registry.orphanDurableFields.map((name) => `ORPHAN_DURABLE_FIELD:${name}`));
for (const writer of DURABLE_WRITER_REGISTRY_V1) {
  if (!writer.initialSource || writer.writers.length === 0 || !writer.rule || !writer.range || writer.consumers.length === 0) failures.push(`INCOMPLETE_DURABLE_WRITER:${writer.field}`);
}
restoreMechanicsVariablesV1(JSON.parse(canonicalJson(DEFAULT_MECHANICS_VARIABLES_V1)));
if (!Object.entries(V5_CLOSURE_INVARIANTS).filter(([, value]) => typeof value === "boolean").every(([, value]) => value)) failures.push("DECLARED_CLOSURE_INVARIANT_FAILED");

const report = {
  schemaVersion: "echoes-v5-static-closure-audit-v1",
  pass: failures.length === 0,
  causalFilesInspected: sourceFiles(directory).length,
  registeredRandomNamespaces: [...registeredNamespaces].sort(),
  literalRandomNamespacesObserved: [...usedNamespaces].sort(),
  registry,
  durableWriterCount: DURABLE_WRITER_REGISTRY_V1.length,
  namingIntegrity: { filesInspected: namingAuditFiles.length, localNameSynthesisPaths: failures.filter((failure) => failure.startsWith("LOCAL_NAME_SYNTHESIS") || failure.startsWith("SYNTHETIC_DIAGNOSTIC_LABEL")), writerInventory: namingWriterInventory },
  failures,
};
const artifactDirectory = resolve("artifacts/simulator/v5/remediation");
mkdirSync(artifactDirectory, { recursive: true });
writeFileSync(resolve(artifactDirectory, "naming-pipeline-audit.json"), `${canonicalJson(report)}\n`, "utf8");
process.stdout.write(`${canonicalJson(report)}\n`);
if (!report.pass) process.exitCode = 1;
