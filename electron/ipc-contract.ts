import { z } from "zod";

export const WORKER_SCHEMA_VERSION = "eidolon-simulator-worker-v1" as const;
const workerRequestSchema = z.object({
  schemaVersion: z.literal(WORKER_SCHEMA_VERSION),
  requestId: z.string().min(1),
  action: z.enum(["STATUS", "ADVANCE", "PAUSE", "REBUILD_PROJECTION", "RUN_DIAGNOSTIC", "VALIDATE_REAL_INPUTS"]),
  payload: z.record(z.string(), z.unknown()),
});

export type WorkerRequest = z.infer<typeof workerRequestSchema>;
export function parseWorkerRequest(value: unknown): WorkerRequest {
  return workerRequestSchema.parse(value);
}
