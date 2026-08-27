import { readdirSync, readFileSync, statSync } from "node:fs";
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
    return statSync(target).isDirectory() ? sourceFiles(target) : name.endsWith(".ts") ? [target] : [];
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
  failures,
};
process.stdout.write(`${canonicalJson(report)}\n`);
if (!report.pass) process.exitCode = 1;
