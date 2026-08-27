import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const directory = resolve(process.argv[2] ?? "resources/canonical");
const manifestPath = resolve(directory, "canonical_bundle_manifest.json");
const checksumPath = resolve(directory, "integrity/checksums.sha256");
const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");
const files = (current: string): string[] => readdirSync(current).flatMap((name) => { const path = resolve(current, name); return statSync(path).isDirectory() ? files(path) : [relative(directory, path).replaceAll("\\", "/")]; }).sort();
const payloadFiles = files(directory).filter((name) => !["canonical_bundle_manifest.json", "integrity/checksums.sha256"].includes(name));
const requiredFiles = Object.fromEntries(payloadFiles.map((name) => [name, sha256(readFileSync(resolve(directory, name)))]));
const contentSha256 = sha256(Object.entries(requiredFiles).map(([name, hash]) => `${hash}  ${name}`).join("\n") + "\n");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, contentSha256, requiredFiles }, null, 2)}\n`);
const checksumFiles = files(directory).filter((name) => name !== "integrity/checksums.sha256");
writeFileSync(checksumPath, `${checksumFiles.map((name) => `${sha256(readFileSync(resolve(directory, name)))}  ${name}`).join("\n")}\n`);
process.stdout.write(`${JSON.stringify({ contentSha256, requiredFileCount: payloadFiles.length, checksumFileCount: checksumFiles.length })}\n`);
