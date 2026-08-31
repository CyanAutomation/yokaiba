import type { Clue, ClueConstraint, PuzzleSpec, Solution } from "../domain/types.js";
import type { PuzzleSolver } from "../domain/puzzle-solver.js";

/** Inclusive row-count bounds supported by the exhaustive MVP solver. */
export const MIN_SUPPORTED_ROWS = 2;
export const MAX_SUPPORTED_ROWS = 5;

function category(spec: PuzzleSpec, id: string) {
  const found = spec.categories.find(candidate => candidate.id === id);
  if (!found) throw new Error(`unknown category: ${id}`);
  return found;
}

function positionOf(spec: PuzzleSpec, solution: Solution, categoryId: string, value: string): number {
  const values = categoryId === spec.baseCategory
    ? category(spec, categoryId).values
    : solution.assignments[categoryId];
  if (!values) throw new Error(`solution has no assignment for category: ${categoryId}`);
  const result = values.indexOf(value);
  if (result < 0) throw new Error(`unknown value ${JSON.stringify(value)} in ${categoryId}`);
  return result;
}

export function satisfiesConstraint(spec: PuzzleSpec, solution: Solution, constraint: ClueConstraint): boolean {
  switch (constraint.kind) {
    case "matches":
      return positionOf(spec, solution, spec.baseCategory, constraint.subject) === positionOf(spec, solution, constraint.category, constraint.value);
    case "notMatches":
      return positionOf(spec, solution, spec.baseCategory, constraint.subject) !== positionOf(spec, solution, constraint.category, constraint.value);
    case "before":
      return positionOf(spec, solution, constraint.left.category, constraint.left.value) < positionOf(spec, solution, constraint.right.category, constraint.right.value);
    case "adjacent":
      return Math.abs(positionOf(spec, solution, constraint.left.category, constraint.left.value) - positionOf(spec, solution, constraint.right.category, constraint.right.value)) === 1;
  }
}

function isAssigned(spec: PuzzleSpec, solution: Solution, categoryId: string) {
  return categoryId === spec.baseCategory || solution.assignments[categoryId] !== undefined;
}

/** A constraint can prune a partial permutation only once all it references exist. */
function isReady(spec: PuzzleSpec, solution: Solution, constraint: ClueConstraint): boolean {
  switch (constraint.kind) {
    case "matches":
    case "notMatches": return isAssigned(spec, solution, constraint.category);
    case "before":
    case "adjacent": return isAssigned(spec, solution, constraint.left.category) && isAssigned(spec, solution, constraint.right.category);
  }
}

function permutations(values: string[]): string[][] {
  // Iterative Heap's algorithm keeps the call stack constant even if the MVP's
  // row limit is increased in a future template version.
  const current = [...values];
  const result = [[...current]];
  const counters = new Array<number>(current.length).fill(0);
  let index = 1;
  while (index < current.length) {
    if (counters[index] < index) {
      const swapIndex = index % 2 === 0 ? 0 : counters[index];
      [current[swapIndex], current[index]] = [current[index], current[swapIndex]];
      result.push([...current]);
      counters[index] += 1;
      index = 1;
    } else {
      counters[index] = 0;
      index += 1;
    }
  }
  return result;
}

/** Exhaustive, deterministic solver. Intended for the MVP's deliberately small grids. */
export function solve(spec: PuzzleSpec, clues: readonly Clue[], limit = Number.POSITIVE_INFINITY): Solution[] {
  const base = category(spec, spec.baseCategory);
  const dimensions = spec.categories.filter(item => item.id !== spec.baseCategory);
  if (base.values.length < MIN_SUPPORTED_ROWS || base.values.length > MAX_SUPPORTED_ROWS) {
    throw new Error(`MVP solver supports grids with ${MIN_SUPPORTED_ROWS} through ${MAX_SUPPORTED_ROWS} rows`);
  }
  for (const item of dimensions) if (item.values.length !== base.values.length) throw new Error("every category must have one value per base row");
  const candidates = dimensions.map(item => ({ id: item.id, permutations: permutations(item.values) }));
  const results: Solution[] = [];
  const assignments: Record<string, string[]> = {};
  const visit = (depth: number) => {
    if (results.length >= limit) return;
    if (depth === candidates.length) {
      const candidate = { assignments: Object.fromEntries(Object.entries(assignments).map(([id, values]) => [id, [...values]])) };
      if (clues.every(clue => satisfiesConstraint(spec, candidate, clue.constraint))) results.push(candidate);
      return;
    }
    const dimension = candidates[depth];
    for (const permutation of dimension.permutations) {
      assignments[dimension.id] = permutation;
      const partial = { assignments };
      if (clues.every(clue => !isReady(spec, partial, clue.constraint) || satisfiesConstraint(spec, partial, clue.constraint))) visit(depth + 1);
      delete assignments[dimension.id];
      if (results.length >= limit) return;
    }
  };
  visit(0);
  return results;
}

export function countSolutions(spec: PuzzleSpec, clues: readonly Clue[], limit = 2): number {
  return solve(spec, clues, limit).length;
}

/** The built-in exhaustive implementation for small, deterministic grids. */
export const exhaustivePuzzleSolver: PuzzleSolver = {
  version: "yokaiba-exhaustive-v1",
  solve,
  countSolutions,
};
