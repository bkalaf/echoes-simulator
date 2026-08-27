import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseCsvSync } from "csv-parse/sync";
import { canonicalJson } from "../serialization/canonical-json.js";
import { buildNamingJob, type NamingContext, type NamingJob } from "./naming.js";

type PoiNamingRow = {
  siteId?: string;
  poiId?: string;
  poiType?: string;
  poiCurrentName?: string;
  poiWorkingLabel?: string;
  poiNameStatus?: string;
};

export type UnnamedPoiContext = NamingContext["unnamedPois"][number];

export function loadUnnamedPoisBySite(canonicalDirectory: string): Map<string, UnnamedPoiContext[]> {
  const rows = parseCsvSync(readFileSync(resolve(canonicalDirectory, "atlas/pois_by_site_naming.csv")), {
    bom: true,
    columns: true,
    skip_empty_lines: true,
  }) as PoiNamingRow[];
  const result = new Map<string, UnnamedPoiContext[]>();
  for (const row of rows) {
    if (!row.siteId || !row.poiId || !row.poiType || row.poiNameStatus === "CANONICAL") continue;
    const poi = { poiId: row.poiId, workingLabel: row.poiCurrentName || row.poiWorkingLabel || "", poiType: row.poiType };
    result.set(row.siteId, [...(result.get(row.siteId) ?? []), poi]);
  }
  for (const [siteId, pois] of result) result.set(siteId, pois.sort((left, right) => left.poiId.localeCompare(right.poiId)));
  return result;
}

export function enrichPendingNamingJobsWithPois(
  jobs: readonly NamingJob[],
  unnamedPoisBySite: ReadonlyMap<string, readonly UnnamedPoiContext[]>,
): { priorNamingJobId: string; job: NamingJob }[] {
  const replacements: { priorNamingJobId: string; job: NamingJob }[] = [];
  for (const prior of jobs) {
    const sitePois = unnamedPoisBySite.get(prior.context.settlement.siteId);
    if (!sitePois) continue;
    const unnamedPois = [...sitePois];
    if (canonicalJson(prior.context.unnamedPois) === canonicalJson(unnamedPois)) continue;
    replacements.push({ priorNamingJobId: prior.namingJobId, job: buildNamingJob({ ...prior.context, unnamedPois }) });
  }
  return replacements;
}
