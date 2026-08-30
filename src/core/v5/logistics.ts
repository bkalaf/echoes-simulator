import type { ControllerType, WorldKey } from "./types.js";

export type CanonicalInventoryStatusV1 = "READY" | "RESOURCE_AUTHORITY_REQUIRED" | "LEGENDARY_REWARD_INVENTORY_REQUIRED";

export interface ResourceAuthorityStatusV1 {
  status: "READY" | "RESOURCE_AUTHORITY_REQUIRED";
  authorityRevisionId: string | null;
  resourceNodeCount: number | null;
  detail: string;
}

export interface QuartermasterV1 {
  quartermasterId: string;
  worldKey: WorldKey;
  settlementId: string;
  controllingOrganizationId: string | null;
  activeFromYear: number;
  activeToYear: number | null;
  capacity: bigint;
  storedQuantity: bigint;
  status: "ACTIVE" | "DISRUPTED" | "INACTIVE";
}

export type QuartermasterAssignmentCriterionV1 = "SAME_CONTROLLER" | "SAME_STATE" | "SAME_SETTLEMENT" | "ROUTE_ACCESS" | "AVAILABLE_CAPACITY" | "STABLE_QUARTERMASTER_ID";
export interface ResourceQuartermasterAssignmentPolicyV1 {
  policyRevisionId: string;
  orderedCriteria: readonly QuartermasterAssignmentCriterionV1[];
  allowCrossState: boolean;
  requireActiveRoute: boolean;
  status: "UNREVIEWED" | "APPROVED" | "REJECTED" | "SUPERSEDED";
}

export interface ResourceLogisticsContextV1 {
  resourceNodeId: string;
  controllingStateId: string;
  controllingSettlementId: string | null;
  controllingOrganizationId: string | null;
  eligibleQuartermasterIds: readonly string[];
  routeAccessibleQuartermasterIds: readonly string[];
}

export interface ResourceQuartermasterAssignmentTermV1 {
  assignmentTermId: string;
  worldKey: WorldKey;
  resourceNodeId: string;
  quartermasterId: string;
  effectiveFromYear: number;
  effectiveToYear: number | null;
  policyRevisionId: string;
  sourceEventId: string;
}

export interface QuartermasterFlowV1 {
  flowId: string;
  worldKey: WorldKey;
  quartermasterId: string;
  sourceType: "REFUGE" | "RESOURCE_NODE";
  sourceId: string;
  year: number;
  producedQuantity: bigint;
  acceptedQuantity: bigint;
  lostQuantity: bigint;
  deliveredQuantity: bigint;
  retainedQuantity: bigint;
  policyRevisionIds: readonly string[];
}

type ApprovedPolicyStatusV1 = "UNREVIEWED" | "APPROVED" | "REJECTED" | "SUPERSEDED";
export interface RefugeOutputPolicyV1 { policyRevisionId: string; formula: "LINEAR_AVAILABLE_STOCK_PPM_V1"; outputRatePpm: number; status: ApprovedPolicyStatusV1 }
export interface RefugeReplenishmentPolicyV1 { policyRevisionId: string; formula: "LINEAR_MISSING_CAPACITY_PPM_V1"; replenishmentRatePpm: number; status: ApprovedPolicyStatusV1 }
export interface ResourceYieldDepletionPolicyV1 { policyRevisionId: string; formula: "LINEAR_STOCK_FLOW_PPM_V1"; yieldRatePpm: number; depletionPerYieldPpm: number; renewableRecoveryPpm: number; status: ApprovedPolicyStatusV1 }
export interface QuartermasterCapacityLossPolicyV1 { policyRevisionId: string; formula: "CAPACITY_THROUGHPUT_LOSS_PPM_V1"; throughputPpmOfCapacity: number; lossPpm: number; deliveryPpmAfterLoss: number; status: ApprovedPolicyStatusV1 }

export interface RefugeStockV1 { refugeId: string; worldKey: WorldKey; capacity: bigint; availableStock: bigint; year: number }
export interface ResourceStockV1 { resourceNodeId: string; worldKey: WorldKey; capacity: bigint; availableStock: bigint; renewable: boolean; year: number }

const PPM = 1_000_000n;
function checkedPpm(value: number, field: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) throw new Error(`${field} must be integer ppm in 0..1000000`);
  return BigInt(value);
}
function requireApproved<T extends { policyRevisionId: string; status: ApprovedPolicyStatusV1 }>(policy: T | null, policyId: string): T {
  if (!policy || policy.status !== "APPROVED" || !policy.policyRevisionId.trim()) throw new Error(`${policyId} needs approval`);
  return policy;
}

export function advanceRefugeStockV1(input: { stock: RefugeStockV1; outputPolicy: RefugeOutputPolicyV1 | null; replenishmentPolicy: RefugeReplenishmentPolicyV1 | null }): { stock: RefugeStockV1; producedQuantity: bigint; replenishedQuantity: bigint; policyRevisionIds: readonly string[] } {
  const output = requireApproved(input.outputPolicy, "REFUGE_OUTPUT");
  const replenishment = requireApproved(input.replenishmentPolicy, "REFUGE_REPLENISHMENT");
  if (input.stock.capacity < 0n || input.stock.availableStock < 0n || input.stock.availableStock > input.stock.capacity) throw new Error(`Refuge ${input.stock.refugeId} has invalid stock`);
  const missing = input.stock.capacity - input.stock.availableStock;
  const replenishedQuantity = missing * checkedPpm(replenishment.replenishmentRatePpm, "replenishmentRatePpm") / PPM;
  const replenishedStock = input.stock.availableStock + replenishedQuantity;
  const producedQuantity = replenishedStock * checkedPpm(output.outputRatePpm, "outputRatePpm") / PPM;
  return { stock: { ...input.stock, year: input.stock.year + 1, availableStock: replenishedStock - producedQuantity }, producedQuantity, replenishedQuantity, policyRevisionIds: [output.policyRevisionId, replenishment.policyRevisionId] };
}

export function advanceResourceStockV1(input: { stock: ResourceStockV1; policy: ResourceYieldDepletionPolicyV1 | null }): { stock: ResourceStockV1; producedQuantity: bigint; depletedQuantity: bigint; recoveredQuantity: bigint; policyRevisionIds: readonly string[] } {
  const policy = requireApproved(input.policy, "RESOURCE_YIELD_DEPLETION");
  if (input.stock.capacity < 0n || input.stock.availableStock < 0n || input.stock.availableStock > input.stock.capacity) throw new Error(`ResourceNode ${input.stock.resourceNodeId} has invalid stock`);
  const producedQuantity = input.stock.availableStock * checkedPpm(policy.yieldRatePpm, "yieldRatePpm") / PPM;
  const depletedQuantity = producedQuantity * checkedPpm(policy.depletionPerYieldPpm, "depletionPerYieldPpm") / PPM;
  const afterDepletion = input.stock.availableStock - (depletedQuantity > input.stock.availableStock ? input.stock.availableStock : depletedQuantity);
  const recoveredQuantity = input.stock.renewable ? (input.stock.capacity - afterDepletion) * checkedPpm(policy.renewableRecoveryPpm, "renewableRecoveryPpm") / PPM : 0n;
  return { stock: { ...input.stock, year: input.stock.year + 1, availableStock: afterDepletion + recoveredQuantity }, producedQuantity, depletedQuantity, recoveredQuantity, policyRevisionIds: [policy.policyRevisionId] };
}

export function routeOutputThroughQuartermasterV1(input: { flowId: string; sourceType: QuartermasterFlowV1["sourceType"]; sourceId: string; year: number; producedQuantity: bigint; quartermaster: QuartermasterV1; policy: QuartermasterCapacityLossPolicyV1 | null; upstreamPolicyRevisionIds: readonly string[] }): { quartermaster: QuartermasterV1; flow: QuartermasterFlowV1 } {
  const policy = requireApproved(input.policy, "QUARTERMASTER_CAPACITY_LOSS");
  if (input.producedQuantity < 0n || input.quartermaster.status !== "ACTIVE") throw new Error(`Quartermaster ${input.quartermaster.quartermasterId} cannot accept output`);
  const freeCapacity = input.quartermaster.capacity - input.quartermaster.storedQuantity;
  if (freeCapacity < 0n) throw new Error(`Quartermaster ${input.quartermaster.quartermasterId} exceeds capacity`);
  const throughput = input.quartermaster.capacity * checkedPpm(policy.throughputPpmOfCapacity, "throughputPpmOfCapacity") / PPM;
  const acceptedQuantity = [input.producedQuantity, freeCapacity, throughput].reduce((minimum, value) => value < minimum ? value : minimum);
  const lostQuantity = acceptedQuantity * checkedPpm(policy.lossPpm, "lossPpm") / PPM;
  const afterLoss = acceptedQuantity - lostQuantity;
  const deliveredQuantity = afterLoss * checkedPpm(policy.deliveryPpmAfterLoss, "deliveryPpmAfterLoss") / PPM;
  const retainedQuantity = afterLoss - deliveredQuantity;
  const flow: QuartermasterFlowV1 = { flowId: input.flowId, worldKey: input.quartermaster.worldKey, quartermasterId: input.quartermaster.quartermasterId, sourceType: input.sourceType, sourceId: input.sourceId, year: input.year, producedQuantity: input.producedQuantity, acceptedQuantity, lostQuantity, deliveredQuantity, retainedQuantity, policyRevisionIds: [...input.upstreamPolicyRevisionIds, policy.policyRevisionId] };
  validateQuartermasterFlowV1(flow);
  return { quartermaster: { ...input.quartermaster, storedQuantity: input.quartermaster.storedQuantity + retainedQuantity }, flow };
}

export function resourceAuthorityStatusV1(input: { authorityRevisionId: string | null; approvedNodeCount: number | null }): ResourceAuthorityStatusV1 {
  if (!input.authorityRevisionId || input.approvedNodeCount === null) return { status: "RESOURCE_AUTHORITY_REQUIRED", authorityRevisionId: null, resourceNodeCount: null, detail: "No approved Resource inventory is available. Unknown authority is not an empty canonical universe." };
  if (!Number.isInteger(input.approvedNodeCount) || input.approvedNodeCount < 0) throw new Error("Approved Resource node count must be a non-negative integer");
  return { status: "READY", authorityRevisionId: input.authorityRevisionId, resourceNodeCount: input.approvedNodeCount, detail: `${input.approvedNodeCount} approved Resource Nodes` };
}

function activeQuartermasters(quartermasters: readonly QuartermasterV1[], year: number): QuartermasterV1[] {
  return quartermasters.filter((quartermaster) => quartermaster.status === "ACTIVE" && quartermaster.activeFromYear <= year && (quartermaster.activeToYear === null || quartermaster.activeToYear > year));
}

export function selectResourceQuartermasterV1(input: { worldKey: WorldKey; year: number; policy: ResourceQuartermasterAssignmentPolicyV1 | null; context: ResourceLogisticsContextV1; quartermasters: readonly QuartermasterV1[]; stateBySettlementId: Readonly<Record<string, string>> }): QuartermasterV1 {
  if (!input.policy || input.policy.status !== "APPROVED") throw new Error("Resource-to-Quartermaster assignment policy needs approval");
  if (input.policy.orderedCriteria.at(-1) !== "STABLE_QUARTERMASTER_ID") throw new Error("Approved Resource-to-Quartermaster policy must end with stable Quartermaster ID tie-break");
  let candidates = activeQuartermasters(input.quartermasters, input.year).filter((quartermaster) => quartermaster.worldKey === input.worldKey && input.context.eligibleQuartermasterIds.includes(quartermaster.quartermasterId));
  if (input.policy.requireActiveRoute) candidates = candidates.filter((quartermaster) => input.context.routeAccessibleQuartermasterIds.includes(quartermaster.quartermasterId));
  if (!input.policy.allowCrossState) candidates = candidates.filter((quartermaster) => input.stateBySettlementId[quartermaster.settlementId] === input.context.controllingStateId);
  if (candidates.length === 0) throw new Error(`No eligible Quartermaster for ResourceNode ${input.context.resourceNodeId}`);
  const rank = (quartermaster: QuartermasterV1): readonly (number | string)[] => input.policy!.orderedCriteria.map((criterion) => {
    if (criterion === "SAME_SETTLEMENT") return quartermaster.settlementId === input.context.controllingSettlementId ? 0 : 1;
    if (criterion === "SAME_STATE") return input.stateBySettlementId[quartermaster.settlementId] === input.context.controllingStateId ? 0 : 1;
    if (criterion === "ROUTE_ACCESS") return input.context.routeAccessibleQuartermasterIds.includes(quartermaster.quartermasterId) ? 0 : 1;
    if (criterion === "AVAILABLE_CAPACITY") return Number(-(quartermaster.capacity - quartermaster.storedQuantity));
    if (criterion === "SAME_CONTROLLER") return quartermaster.controllingOrganizationId !== null && quartermaster.controllingOrganizationId === input.context.controllingOrganizationId ? 0 : 1;
    return quartermaster.quartermasterId;
  });
  return [...candidates].sort((left, right) => {
    const leftRank = rank(left); const rightRank = rank(right);
    for (let index = 0; index < leftRank.length; index += 1) { const a = leftRank[index]!; const b = rightRank[index]!; if (a === b) continue; return typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b)); }
    return left.quartermasterId.localeCompare(right.quartermasterId);
  })[0]!;
}

export function validateQuartermasterFlowV1(flow: QuartermasterFlowV1): void {
  for (const value of [flow.producedQuantity, flow.acceptedQuantity, flow.lostQuantity, flow.deliveredQuantity, flow.retainedQuantity]) if (value < 0n) throw new Error(`Quartermaster flow ${flow.flowId} contains a negative quantity`);
  if (flow.acceptedQuantity > flow.producedQuantity) throw new Error(`Quartermaster flow ${flow.flowId} accepts more than was produced`);
  if (flow.lostQuantity + flow.deliveredQuantity + flow.retainedQuantity !== flow.acceptedQuantity) throw new Error(`Quartermaster flow ${flow.flowId} does not conserve accepted stock`);
}

export interface PhysicalNodeControlV1 { controllerType: ControllerType; controllerId: string }
