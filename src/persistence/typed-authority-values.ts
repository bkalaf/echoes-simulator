export type TypedAuthorityValue = {
  valuePath: string;
  valueType: "TEXT" | "INTEGER" | "BIGINT" | "DECIMAL" | "BOOLEAN" | "NULL" | "OBJECT" | "ARRAY";
  textValue?: string | null;
  integerValue?: bigint | null;
  decimalValue?: string | { toString(): string } | null;
  booleanValue?: boolean | null;
};

function objectPath(parent: string, key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? `${parent}.${key}` : `${parent}["${encodeURIComponent(key)}"]`;
}

export function flattenTypedAuthorityValues(value: unknown, path = "$"): TypedAuthorityValue[] {
  if (value === null || value === undefined) return [{ valuePath: path, valueType: "NULL" }];
  if (typeof value === "string") return [{ valuePath: path, valueType: "TEXT", textValue: value }];
  if (typeof value === "boolean") return [{ valuePath: path, valueType: "BOOLEAN", booleanValue: value }];
  if (typeof value === "bigint") return [{ valuePath: path, valueType: "BIGINT", integerValue: value }];
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Canonical authority ${path} is not finite`);
    return Number.isInteger(value) ? [{ valuePath: path, valueType: "INTEGER", integerValue: BigInt(value) }] : [{ valuePath: path, valueType: "DECIMAL", decimalValue: String(value) }];
  }
  if (Array.isArray(value)) return [{ valuePath: path, valueType: "ARRAY" }, ...value.flatMap((item, index) => flattenTypedAuthorityValues(item, `${path}[${index}]`))];
  if (typeof value === "object") return [{ valuePath: path, valueType: "OBJECT" }, ...Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).flatMap(([key, item]) => flattenTypedAuthorityValues(item, objectPath(path, key)))];
  throw new Error(`Canonical authority ${path} has unsupported type ${typeof value}`);
}

type PathToken = string | number;
function pathTokens(path: string): PathToken[] {
  if (path === "$") return [];
  if (!path.startsWith("$")) throw new Error(`Invalid typed authority path ${path}`);
  const tokens: PathToken[] = [];
  let offset = 1;
  while (offset < path.length) {
    if (path[offset] === ".") {
      const match = path.slice(offset).match(/^\.([A-Za-z_][A-Za-z0-9_]*)/);
      if (!match) throw new Error(`Invalid typed authority path ${path}`);
      tokens.push(match[1]!); offset += match[0].length;
    } else if (path[offset] === "[") {
      const indexMatch = path.slice(offset).match(/^\[(\d+)\]/);
      if (indexMatch) {
        tokens.push(Number(indexMatch[1])); offset += indexMatch[0].length;
        continue;
      }
      const keyMatch = path.slice(offset).match(/^\["([^"\\]*)"\]/);
      if (!keyMatch) throw new Error(`Invalid typed authority path ${path}`);
      try { tokens.push(decodeURIComponent(keyMatch[1]!)); } catch { throw new Error(`Invalid encoded typed authority key in ${path}`); }
      offset += keyMatch[0].length;
    } else throw new Error(`Invalid typed authority path ${path}`);
  }
  return tokens;
}

function scalar(row: TypedAuthorityValue): unknown {
  if (row.valueType === "NULL") return null;
  if (row.valueType === "TEXT") return row.textValue ?? "";
  if (row.valueType === "BOOLEAN") return row.booleanValue ?? false;
  if (row.valueType === "BIGINT") return BigInt(row.integerValue ?? 0n);
  if (row.valueType === "INTEGER") {
    const value = Number(row.integerValue ?? 0n);
    if (!Number.isSafeInteger(value)) throw new Error(`Typed authority integer at ${row.valuePath} exceeds the safe integer range`);
    return value;
  }
  if (row.valueType === "DECIMAL") return Number(row.decimalValue?.toString() ?? "0");
  return row.valueType === "ARRAY" ? [] : {};
}

export function hydrateTypedAuthorityValues(rows: readonly TypedAuthorityValue[]): unknown {
  if (rows.length === 0) throw new Error("Typed canonical authority contains no values");
  const ordered = [...rows].sort((left, right) => pathTokens(left.valuePath).length - pathTokens(right.valuePath).length || left.valuePath.localeCompare(right.valuePath));
  const rootRow = ordered.find((row) => row.valuePath === "$");
  if (!rootRow) throw new Error("Typed canonical authority has no root value");
  const root = scalar(rootRow);
  for (const row of ordered) {
    if (row.valuePath === "$") continue;
    const tokens = pathTokens(row.valuePath);
    let parent = root as Record<string | number, unknown>;
    for (const token of tokens.slice(0, -1)) {
      const next = parent[token];
      if (!next || typeof next !== "object") throw new Error(`Typed canonical authority path ${row.valuePath} has no container parent`);
      parent = next as Record<string | number, unknown>;
    }
    parent[tokens.at(-1)!] = scalar(row);
  }
  return root;
}
