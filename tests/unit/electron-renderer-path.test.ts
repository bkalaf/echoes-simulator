import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("packaged Electron renderer path", () => {
  it("builds file-relative asset URLs and loads the production index as a file", () => {
    const vite = readFileSync("vite.config.ts", "utf8");
    const electronMain = readFileSync("electron/main.ts", "utf8");
    expect(vite).toContain('base: "./"');
    expect(electronMain).toContain("mainWindow.loadFile");
  });

  it("emits the sandboxed preload as CommonJS instead of an unloadable ES module", () => {
    const electronMain = readFileSync("electron/main.ts", "utf8");
    const nodeConfig = readFileSync("tsconfig.node.json", "utf8");

    expect(existsSync("electron/preload.cts")).toBe(true);
    expect(electronMain).toContain('"preload.cjs"');
    expect(nodeConfig).toContain('"electron/**/*.cts"');
  });

  it("declares a restrictive renderer content security policy", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain("default-src 'self'");
  });
});
