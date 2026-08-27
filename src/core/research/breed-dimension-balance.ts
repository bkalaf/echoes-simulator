import { createHash } from "node:crypto";
import {
  BREED_DIMENSION_BALANCE_POLICY,
  RAW_DIMENSIONS,
  type EffectiveBreedSemantics,
  type PolicyDimensionValue,
} from "./v4-contract.js";

export { BREED_DIMENSION_BALANCE_POLICY } from "./v4-contract.js";

type Faction = "CONCORD" | "SCHISM" | "RUIN";
type PropertyMapping = Record<string, Record<Faction, string>>;
type RawDimension = typeof RAW_DIMENSIONS[number];

export interface BreedDimensionBalanceChange {
  breedId: string;
  field: RawDimension;
  before: string;
  after: string;
  priorDisposition: PolicyDimensionValue["disposition"];
  priorPolicyRef: PolicyDimensionValue["policyRef"];
  disposition: "OWNER_BALANCED_VALUE";
  policyRef: typeof BREED_DIMENSION_BALANCE_POLICY;
}

export interface BreedDimensionBalanceFieldReport {
  values: Record<Faction, string>;
  before: Record<string, number>;
  after: Record<string, number>;
  changedAssignments: number;
}

export interface BreedDimensionBalanceReport {
  schemaVersion: "eidolon-breed-dimension-balance-report-v1";
  policyRef: typeof BREED_DIMENSION_BALANCE_POLICY;
  strategy: "MINIMUM_CHANGE_STABLE_HASH";
  totalCivicBreeds: number;
  targetPerValue: number;
  totalChangedAssignments: number;
  changedBreeds: number;
  byField: Record<RawDimension, BreedDimensionBalanceFieldReport>;
}

function mappingKey(field: RawDimension): string {
  return `${field[0]!.toUpperCase()}${field.slice(1)}`;
}

function stableOrder(field: RawDimension, breedId: string, value: string): string {
  return createHash("sha256")
    .update(`${BREED_DIMENSION_BALANCE_POLICY}\0${field}\0${breedId}\0${value}`)
    .digest("hex");
}

function counts(rows: readonly EffectiveBreedSemantics[], field: RawDimension, values: readonly string[]): Record<string, number> {
  const result = Object.fromEntries(values.map((value) => [value, 0])) as Record<string, number>;
  for (const row of rows) {
    const value = row.dimensions[field].value;
    if (!(value in result)) throw new Error(`${row.breedId}.${field} has uncontrolled value ${value}`);
    result[value] += 1;
  }
  return result;
}

export function rebalanceBreedDimensions(
  input: readonly EffectiveBreedSemantics[],
  propertyMapping: PropertyMapping,
): { rows: EffectiveBreedSemantics[]; report: BreedDimensionBalanceReport; changes: BreedDimensionBalanceChange[] } {
  if (input.length === 0 || input.length % 3 !== 0) throw new Error("Civic Breed count must be non-zero and divisible by three");
  if (new Set(input.map((row) => row.breedId)).size !== input.length) throw new Error("Civic Breed IDs must be unique before balancing");

  const rows = [...input]
    .sort((left, right) => left.breedId.localeCompare(right.breedId))
    .map((row) => ({ ...row, dimensions: { ...row.dimensions } }));
  const targetPerValue = rows.length / 3;
  const changes: BreedDimensionBalanceChange[] = [];
  const byField = {} as Record<RawDimension, BreedDimensionBalanceFieldReport>;

  for (const field of RAW_DIMENSIONS) {
    const fieldMapping = propertyMapping[mappingKey(field)];
    if (!fieldMapping) throw new Error(`Property/faction mapping lacks ${mappingKey(field)}`);
    const factions: Faction[] = ["CONCORD", "SCHISM", "RUIN"];
    const values = factions.map((faction) => fieldMapping[faction]);
    if (values.some((value) => !value) || new Set(values).size !== 3) throw new Error(`${mappingKey(field)} must map to three distinct controlled values`);

    const before = counts(rows, field, values);
    const donorRows = values.flatMap((value) => rows
      .filter((row) => row.dimensions[field].value === value)
      .sort((left, right) => stableOrder(field, left.breedId, value).localeCompare(stableOrder(field, right.breedId, value)) || left.breedId.localeCompare(right.breedId))
      .slice(0, Math.max(0, before[value]! - targetPerValue)));
    let donorIndex = 0;

    for (const faction of factions) {
      const afterValue = fieldMapping[faction];
      const deficit = Math.max(0, targetPerValue - before[afterValue]!);
      for (let index = 0; index < deficit; index += 1) {
        const row = donorRows[donorIndex++];
        if (!row) throw new Error(`${field} donor coverage does not match its deficits`);
        const prior = row.dimensions[field];
        const change: BreedDimensionBalanceChange = {
          breedId: row.breedId,
          field,
          before: prior.value,
          after: afterValue,
          priorDisposition: prior.disposition,
          priorPolicyRef: prior.policyRef,
          disposition: "OWNER_BALANCED_VALUE",
          policyRef: BREED_DIMENSION_BALANCE_POLICY,
        };
        row.dimensions[field] = { value: afterValue, disposition: change.disposition, policyRef: change.policyRef };
        changes.push(change);
      }
    }
    if (donorIndex !== donorRows.length) throw new Error(`${field} surplus donors were not fully consumed`);
    const after = counts(rows, field, values);
    if (values.some((value) => after[value] !== targetPerValue)) throw new Error(`${field} did not reach its exact balance target`);
    byField[field] = {
      values: { CONCORD: fieldMapping.CONCORD, SCHISM: fieldMapping.SCHISM, RUIN: fieldMapping.RUIN },
      before,
      after,
      changedAssignments: donorRows.length,
    };
  }

  return {
    rows,
    changes,
    report: {
      schemaVersion: "eidolon-breed-dimension-balance-report-v1",
      policyRef: BREED_DIMENSION_BALANCE_POLICY,
      strategy: "MINIMUM_CHANGE_STABLE_HASH",
      totalCivicBreeds: rows.length,
      targetPerValue,
      totalChangedAssignments: changes.length,
      changedBreeds: new Set(changes.map((change) => change.breedId)).size,
      byField,
    },
  };
}
