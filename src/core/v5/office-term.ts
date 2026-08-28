import type { OfficeTermV5 } from "./types.js";

export function officeTermActiveAt(term: OfficeTermV5, year: number): boolean {
  return term.startYear <= year && (term.endYear === null || term.endYear > year);
}
