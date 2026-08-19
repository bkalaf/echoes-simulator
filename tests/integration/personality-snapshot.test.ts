import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const source = "/home/bobby/echoes-of-eidolon/apps/web/src/data/personality-expression-registry-v3.json";
const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");

describe("personality reference snapshot", () => {
  it.runIf(existsSync(source))("matches the recorded source without runtime dependency", () => {
    const local = readFileSync("resources/personality/personality-expression-registry-v3.json");
    expect(sha(local)).toBe("f9a74e1563babc15d86121b5f43246e6d666b6a51736610629acca26d6b7fb38");
    expect(local.equals(readFileSync(source))).toBe(true);
  });
});
