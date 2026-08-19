import { cpSync, mkdirSync, realpathSync, renameSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const stage = "/tmp/echoes-simulator-offline-package-stage";
const output = resolve(root, "dist/linux-unpacked-offline");
const artifact = resolve(root, "dist/Echoes-of-Eidolon-Simulator-linux-x64.tar");
rmSync(stage, { recursive: true, force: true });
rmSync(output, { recursive: true, force: true });
rmSync(artifact, { force: true });
mkdirSync(resolve(stage, "node_modules"), { recursive: true });
cpSync(resolve(root, "dist"), resolve(stage, "dist"), { recursive: true, filter: (source) => !source.includes("linux-unpacked") && !source.endsWith(".tar") });
cpSync(resolve(root, "dist-electron"), resolve(stage, "dist-electron"), { recursive: true });
cpSync(resolve(root, "package.json"), resolve(stage, "package.json"));
for (const dependency of ["csv-parse", "fflate", "zod"]) cpSync(realpathSync(resolve(root, "node_modules", dependency)), resolve(stage, "node_modules", dependency), { recursive: true });

cpSync(resolve(root, "node_modules/electron/dist"), output, { recursive: true });
mkdirSync(resolve(output, "resources"), { recursive: true });
const asar = resolve(root, "node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar/bin/asar.js");
const packed = spawnSync(process.execPath, [asar, "pack", stage, resolve(output, "resources/app.asar")], { stdio: "inherit" });
if (packed.status !== 0) process.exit(packed.status ?? 1);
cpSync(resolve(root, "resources"), resolve(output, "resources/simulator-resources"), { recursive: true });
renameSync(resolve(output, "electron"), resolve(output, "echoes-of-eidolon-simulator"));
const archived = spawnSync("tar", ["--sort=name", "--mtime=2026-08-19T00:00:00Z", "--owner=0", "--group=0", "--numeric-owner", "-cf", artifact, "-C", dirname(output), output.split("/").at(-1)], { stdio: "inherit" });
rmSync(stage, { recursive: true, force: true });
if (archived.status !== 0) process.exit(archived.status ?? 1);
process.stdout.write(`${artifact}\n`);
