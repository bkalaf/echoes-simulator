import { spawn } from "node:child_process";
import { resolveDomainDatabaseConnection } from "../persistence/domain-database-connection.js";

const args = process.argv.slice(2);
if (args.length === 0) throw new Error("A Prisma command is required");
const resolved = resolveDomainDatabaseConnection();
if (!resolved) throw new Error("CANONICAL_DATABASE_NOT_DISCOVERABLE: refusing to run a mutating Prisma command");

const child = spawn("pnpm", ["exec", "prisma", ...args], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: resolved.connectionString },
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(signal, () => {
  if (!child.killed) child.kill(signal);
});
child.once("error", (error) => { throw error; });
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
