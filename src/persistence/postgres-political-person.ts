import type { Prisma, PrismaClient } from "@prisma/client";

import type { WorldKey } from "../core/v5/types.js";
import type { FactionVector } from "../core/v5/types.js";
import type { SimulatorStore } from "./sqlite-store.js";
import { getDomainDatabase } from "./postgres-domain.js";

const WORLDS: readonly WorldKey[] = ["CONCORD", "SCHISM", "RUIN"];

/**
 * Projects the latest immutable causal checkpoints into normalized PostgreSQL
 * PoliticalPerson rows. Old people remain explicit NULL/UNKNOWN; no alignment
 * is guessed from World, State, Family, Settlement, Breed, or office.
 */
export async function syncPoliticalPeopleToPostgres(store: SimulatorStore, runId: string, database: PrismaClient = getDomainDatabase()): Promise<{ people: number; aligned: number; unknown: number }> {
  const manifest = store.loadV5RunManifest(runId);
  const run = store.getRun(runId);
  if (!manifest || !run) throw new Error(`Unknown V5 run ${runId}`);
  const checkpoints = WORLDS.map((worldKey) => ({ worldKey, checkpoint: store.loadLatestV5Checkpoint(runId, worldKey, run.currentYear ?? undefined) }));
  if (checkpoints.some(({ checkpoint }) => !checkpoint)) throw new Error(`V5 PostgreSQL PoliticalPerson projection requires an atomic checkpoint for all worlds in ${runId}`);
  let people = 0;
  let aligned = 0;
  await database.$transaction(async (transaction: Prisma.TransactionClient) => {
    for (const { worldKey, checkpoint } of checkpoints) for (const person of checkpoint!.state.politicalPeople) {
      people += 1;
      const vector = person.factionAffinity;
      if (vector) {
        if (person.factionAlignmentEffectiveFromYear === undefined || !person.factionAlignmentSourceEventId) throw new Error(`PoliticalPerson ${person.personId} has alignment without effective history`);
        aligned += 1;
      }
      const current = {
        familyId: person.familyId,
        breedId: person.breedId,
        originSettlementId: person.originSettlementId,
        currentConcordAffinity: vector?.CONCORD ?? null,
        currentSchismAffinity: vector?.SCHISM ?? null,
        currentRuinAffinity: vector?.RUIN ?? null,
        currentAlignmentEffectiveFromYear: person.factionAlignmentEffectiveFromYear ?? null,
        mechanicsVersion: manifest.mechanicsVersion,
      };
      await transaction.politicalPerson.upsert({ where: { runId_worldKey_personId: { runId, worldKey, personId: person.personId } }, create: { runId, worldKey, personId: person.personId, ...current }, update: current });
      if (vector) await transaction.politicalPersonAlignment.upsert({
        where: { runId_worldKey_personId_effectiveFromYear: { runId, worldKey, personId: person.personId, effectiveFromYear: person.factionAlignmentEffectiveFromYear! } },
        create: { runId, worldKey, personId: person.personId, effectiveFromYear: person.factionAlignmentEffectiveFromYear!, effectiveToYear: null, concordAffinity: vector.CONCORD, schismAffinity: vector.SCHISM, ruinAffinity: vector.RUIN, sourceEventId: person.factionAlignmentSourceEventId! },
        update: { effectiveToYear: null, concordAffinity: vector.CONCORD, schismAffinity: vector.SCHISM, ruinAffinity: vector.RUIN, sourceEventId: person.factionAlignmentSourceEventId! },
      });
    }
  });
  return { people, aligned, unknown: people - aligned };
}

/** PostgreSQL read authority for effective person alignment; absent rows are explicit UNKNOWN. */
export async function loadPoliticalPersonAlignmentsAtYear(runId: string, worldKey: WorldKey, year: number, database: PrismaClient = getDomainDatabase()): Promise<Record<string, FactionVector>> {
  const rows = await database.politicalPersonAlignment.findMany({
    where: { runId, worldKey, effectiveFromYear: { lte: year }, OR: [{ effectiveToYear: null }, { effectiveToYear: { gt: year } }] },
    orderBy: [{ personId: "asc" }, { effectiveFromYear: "desc" }],
  });
  const result: Record<string, FactionVector> = {};
  for (const row of rows) if (!result[row.personId]) result[row.personId] = { CONCORD: row.concordAffinity, SCHISM: row.schismAffinity, RUIN: row.ruinAffinity };
  return result;
}
