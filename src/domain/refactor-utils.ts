import type { PuzzleSpec, Solution } from "./types.js";

export type ConstraintKind =
  | "matches"
  | "notMatches"
  | "before"
  | "adjacent"
  | "sameRow"
  | "distance";

export function isConstraintKind(value: unknown): value is ConstraintKind {
  return (
    typeof value === "string" &&
    ["matches", "notMatches", "before", "adjacent", "sameRow", "distance"].includes(value)
  );
}

export function isValidJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Utility mirroring the small helper used in the exhaustive solver: returns
 * the index of `value` within the requested category for a given solution.
 * Throws a descriptive error when inputs are invalid.
 */
export function positionOf(spec: PuzzleSpec, solution: Solution, categoryId: string, value: string): number {
  const found = spec.categories.find(candidate => candidate.id === categoryId);
  if (!found) throw new Error(`unknown category: ${categoryId}`);
  const values = categoryId === spec.baseCategory ? found.values : solution.assignments[categoryId];
  if (!values) throw new Error(`solution has no assignment for category: ${categoryId}`);
  const result = values.indexOf(value);
  if (result < 0) throw new Error(`unknown value ${JSON.stringify(value)} in ${categoryId}`);
  return result;
}

/**
 * Factory producing either a fixed-position function (for base category values)
 * or a function that resolves a position against a live `assignments` map.
 * This matches the pattern used in the exhaustive solver's compile step.
 */
export function positionFactory(spec: PuzzleSpec, categoryId: string, value: string): ((assignments: Record<string, string[]>) => number) {
  const category = spec.categories.find(c => c.id === categoryId);
  if (!category) throw new Error(`unknown category: ${categoryId}`);
  const knownPosition = category.values.indexOf(value);
  if (knownPosition < 0) throw new Error(`unknown value ${JSON.stringify(value)} in ${categoryId}`);
  if (categoryId === spec.baseCategory) return () => knownPosition;
  return (assignments: Record<string, string[]>) => {
    const assigned = assignments[categoryId];
    if (!assigned) throw new Error(`solution has no assignment for category: ${categoryId}`);
    return assigned.indexOf(value);
  };
}

/**
 * Placeholder category template resolver. Intended to be expanded to return
 * localized/rendering templates for `subject|action|negativeAction`.
 */
export type TemplateType = "subject" | "action" | "negativeAction";
export function getCategoryTemplate(_categoryId: string, _type: TemplateType): string {
  // Minimal default: caller should replace with domain-specific templates.
  return "";
}
