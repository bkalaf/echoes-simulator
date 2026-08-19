import { createHash } from "node:crypto";
import type { WorldKey } from "../contracts/domain.js";

export const PRNG_VERSION = "sha256-counter-v1";

export interface RandomScope {
  world: WorldKey | "SHARED";
  year: number;
  purpose: string;
  entityId: string;
  ordinal?: number;
}

export class ScopedRandom {
  readonly normalizedSeedHash: string;
  constructor(private readonly runSeed: string) {
    if (!runSeed) throw new Error("Run seed is required");
    this.normalizedSeedHash = createHash("sha256").update(runSeed.normalize("NFC"), "utf8").digest("hex");
  }

  bytes(scope: RandomScope): Buffer {
    const material = [this.normalizedSeedHash, scope.world, String(scope.year), scope.purpose, scope.entityId, String(scope.ordinal ?? 0)].join("\0");
    return createHash("sha256").update(material, "utf8").digest();
  }

  integer(scope: RandomScope, minimum: number, maximum: number): number {
    if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || maximum < minimum) throw new Error("Invalid integer range");
    const range = BigInt(maximum - minimum + 1);
    return minimum + Number(this.bytes(scope).readBigUInt64BE(0) % range);
  }

  choice<T>(scope: RandomScope, values: readonly T[]): T {
    if (values.length === 0) throw new Error("Cannot choose from an empty list");
    return values[this.integer(scope, 0, values.length - 1)]!;
  }

  shuffle<T>(scope: RandomScope, values: readonly T[]): T[] {
    return values.map((value, index) => ({ value, key: this.bytes({ ...scope, ordinal: index }).toString("hex") }))
      .sort((a, b) => a.key.localeCompare(b.key)).map(({ value }) => value);
  }
}
