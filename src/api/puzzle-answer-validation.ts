import type { PuzzleSpec, Solution } from "../domain/types.js";

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(message);
  return value as Record<string, unknown>;
}

function validateCategoryPermutation(categoryId: string, expectedValues: readonly string[], value: unknown): string[] {
  if (!Array.isArray(value)
    || value.length !== expectedValues.length
    || value.some(candidate => typeof candidate !== "string")
    || new Set(value).size !== value.length
    || value.some(candidate => !expectedValues.includes(candidate))) {
    throw new TypeError(`answer for ${categoryId} must be a complete permutation of its category values`);
  }
  return [...value];
}

function validateAnswerAssignments(spec: PuzzleSpec, value: unknown): Solution["assignments"] {
  const assignments = objectRecord(value, "answer.assignments must be an object");
  const expected = spec.categories.filter(category => category.id !== spec.baseCategory);
  if (Object.keys(assignments).length !== expected.length || expected.some(category => !Object.hasOwn(assignments, category.id))) {
    throw new TypeError("answer must include every non-base category exactly once");
  }
  const normalized: Record<string, string[]> = {};
  for (const category of expected) normalized[category.id] = validateCategoryPermutation(category.id, category.values, assignments[category.id]);
  return normalized;
}

/** Validate and normalize a submitted answer before comparing it with the solution. */
export function validatePuzzleAnswer(spec: PuzzleSpec, value: unknown): Solution {
  const answer = objectRecord(value, "answer must be an object");
  const unknown = Object.keys(answer).find(name => name !== "assignments");
  if (unknown !== undefined) throw new TypeError(`unknown field answer.${unknown}`);
  return { assignments: validateAnswerAssignments(spec, answer.assignments) };
}
