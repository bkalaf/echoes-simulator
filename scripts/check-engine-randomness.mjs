import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

async function files(directory) {
  const result = [];
  for (const name of await readdir(directory)) {
    const target = join(directory, name);
    if ((await stat(target)).isDirectory()) result.push(...await files(target));
    else if (/\.(ts|tsx)$/.test(name)) result.push(target);
  }
  return result;
}

const offenders = [];
for (const file of await files(new URL("../src/core", import.meta.url).pathname)) {
  if ((await readFile(file, "utf8")).includes("Math.random(")) offenders.push(file);
}
if (offenders.length) throw new Error(`Ambient Math.random found in engine: ${offenders.join(", ")}`);
console.log("PASS: no ambient Math.random in src/core");
