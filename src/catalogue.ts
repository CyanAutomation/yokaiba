import type { PuzzleTemplate } from "./domain/types.js";

/** Public template metadata sufficient for a client to build a puzzle board. */
export function scenarioSummary({ id, title, baseCategory, categories, metadata }: PuzzleTemplate) {
  return { id, title, baseCategory, categories, ...(metadata ? { metadata } : {}) };
}
