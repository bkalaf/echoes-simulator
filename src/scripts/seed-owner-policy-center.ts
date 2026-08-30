import { bootstrapOwnerPolicyCenterV56 } from "../persistence/postgres-owner-policy.js";
import { disconnectDomainDatabase } from "../persistence/postgres-domain.js";

const result = await bootstrapOwnerPolicyCenterV56();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
await disconnectDomainDatabase();
