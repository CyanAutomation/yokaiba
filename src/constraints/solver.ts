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
    case "sameRow":
      return positionOf(spec, solution, constraint.left.category, constraint.left.value) === positionOf(spec, solution, constraint.right.category, constraint.right.value);
    case "distance":
      return Math.abs(positionOf(spec, solution, constraint.left.category, constraint.left.value) - positionOf(spec, solution, constraint.right.category, constraint.right.value)) === constraint.distance;
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

interface CompiledConstraint {
  /** Non-base categories that must have a permutation before this is testable. */
  readonly requiredCategories: readonly string[];
  readonly satisfies: (assignments: Record<string, string[]>) => boolean;
}

interface CandidateDimension {
  readonly id: string;
  readonly permutations: readonly string[][];
  readonly degree: number;
  readonly originalIndex: number;
}

export interface SolverTelemetry {
  /** Permutation assignments considered by the depth-first search. */
  readonly nodesVisited: number;
  /** Compiled constraints actually evaluated; not constraints deferred as unready. */
  readonly constraintChecks: number;
  /** Wall-clock time spent inside the solve call. */
  readonly elapsedMs: number;
}

export interface SolveWithTelemetryResult {
  readonly solutions: Solution[];
  readonly telemetry: SolverTelemetry;
}

function compileConstraints(spec: PuzzleSpec, clues: readonly Clue[]): CompiledConstraint[] {
  const base = category(spec, spec.baseCategory);
  const knownPosition = (categoryId: string, value: string) => {
    const values = category(spec, categoryId).values;
    const position = values.indexOf(value);
    if (position < 0) throw new Error(`unknown value ${JSON.stringify(value)} in ${categoryId}`);
    return position;
  };
  const position = (categoryId: string, value: string) => {
    const fixedPosition = knownPosition(categoryId, value);
    if (categoryId === base.id) return (_assignments: Record<string, string[]>) => fixedPosition;
    return (assignments: Record<string, string[]>) => {
      const values = assignments[categoryId];
      if (!values) throw new Error(`solution has no assignment for category: ${categoryId}`);
      return values.indexOf(value);
    };
  };
  const requirements = (...categoryIds: string[]) => [...new Set(categoryIds.filter(categoryId => categoryId !== base.id))];

  return clues.map(({ constraint }) => {
    switch (constraint.kind) {
      case "matches": {
        const subjectPosition = position(base.id, constraint.subject);
        const valuePosition = position(constraint.category, constraint.value);
        return { requiredCategories: requirements(constraint.category), satisfies: assignments => subjectPosition(assignments) === valuePosition(assignments) };
      }
      case "notMatches": {
        const subjectPosition = position(base.id, constraint.subject);
        const valuePosition = position(constraint.category, constraint.value);
        return { requiredCategories: requirements(constraint.category), satisfies: assignments => subjectPosition(assignments) !== valuePosition(assignments) };
      }
      case "before": {
        const leftPosition = position(constraint.left.category, constraint.left.value);
        const rightPosition = position(constraint.right.category, constraint.right.value);
        return {
          requiredCategories: requirements(constraint.left.category, constraint.right.category),
          satisfies: assignments => leftPosition(assignments) < rightPosition(assignments),
        };
      }
      case "adjacent": {
        const leftPosition = position(constraint.left.category, constraint.left.value);
        const rightPosition = position(constraint.right.category, constraint.right.value);
        return {
          requiredCategories: requirements(constraint.left.category, constraint.right.category),
          satisfies: assignments => Math.abs(leftPosition(assignments) - rightPosition(assignments)) === 1,
        };
      }
      case "sameRow": {
        const leftPosition = position(constraint.left.category, constraint.left.value);
        const rightPosition = position(constraint.right.category, constraint.right.value);
        return {
          requiredCategories: requirements(constraint.left.category, constraint.right.category),
          satisfies: assignments => leftPosition(assignments) === rightPosition(assignments),
        };
      }
      case "distance": {
        if (!Number.isInteger(constraint.distance) || constraint.distance < 1) throw new Error("distance clues require a positive integer distance");
        const leftPosition = position(constraint.left.category, constraint.left.value);
        const rightPosition = position(constraint.right.category, constraint.right.value);
        return {
          requiredCategories: requirements(constraint.left.category, constraint.right.category),
          satisfies: assignments => Math.abs(leftPosition(assignments) - rightPosition(assignments)) === constraint.distance,
        };
      }
    }
  });
}

/** Exhaustive, deterministic solver. Intended for the MVP's deliberately small grids. */
export function solveWithTelemetry(spec: PuzzleSpec, clues: readonly Clue[], limit = Number.POSITIVE_INFINITY): SolveWithTelemetryResult {
  const startedAt = performance.now();
  const base = category(spec, spec.baseCategory);
  const originalDimensions = spec.categories.filter(item => item.id !== spec.baseCategory);
  if (base.values.length < MIN_SUPPORTED_ROWS || base.values.length > MAX_SUPPORTED_ROWS) {
    throw new Error(`MVP solver supports grids with ${MIN_SUPPORTED_ROWS} through ${MAX_SUPPORTED_ROWS} rows`);
  }
  for (const item of originalDimensions) if (item.values.length !== base.values.length) throw new Error("every category must have one value per base row");
  const compiledConstraints = compileConstraints(spec, clues);
  const degreeByCategory = new Map(originalDimensions.map(item => [item.id, 0]));
  for (const constraint of compiledConstraints) for (const categoryId of constraint.requiredCategories) {
    degreeByCategory.set(categoryId, (degreeByCategory.get(categoryId) ?? 0) + 1);
  }
  const candidates: CandidateDimension[] = originalDimensions.map((item, originalIndex) => ({
    id: item.id,
    permutations: permutations(item.values),
    degree: degreeByCategory.get(item.id) ?? 0,
    originalIndex,
  })).sort((left, right) => right.degree - left.degree || left.originalIndex - right.originalIndex);
  const candidateDepth = new Map(candidates.map((candidate, depth) => [candidate.id, depth]));
  const constraintsReadyAtDepth = candidates.map((): CompiledConstraint[] => []);
  const rootConstraints: CompiledConstraint[] = [];
  for (const constraint of compiledConstraints) {
    const readyDepth = Math.max(...constraint.requiredCategories.map(categoryId => candidateDepth.get(categoryId)!), -1);
    if (readyDepth < 0) rootConstraints.push(constraint);
    else constraintsReadyAtDepth[readyDepth]!.push(constraint);
  }
  const results: Solution[] = [];
  const assignments: Record<string, string[]> = {};
  let nodesVisited = 0;
  let constraintChecks = 0;
  const check = (constraints: readonly CompiledConstraint[]) => constraints.every(constraint => {
    constraintChecks += 1;
    return constraint.satisfies(assignments);
  });
  const visit = (depth: number) => {
    if (results.length >= limit) return;
    if (depth === candidates.length) {
      results.push({ assignments: Object.fromEntries(originalDimensions.map(({ id }) => [id, [...assignments[id]!]])) });
      return;
    }
    const dimension = candidates[depth];
    for (const permutation of dimension.permutations) {
      nodesVisited += 1;
      assignments[dimension.id] = permutation;
      if (check(constraintsReadyAtDepth[depth]!)) visit(depth + 1);
      delete assignments[dimension.id];
      if (results.length >= limit) return;
    }
  };
  if (limit > 0 && check(rootConstraints)) visit(0);
  return { solutions: results, telemetry: { nodesVisited, constraintChecks, elapsedMs: performance.now() - startedAt } };
}

/** Solve using the exhaustive baseline without retaining telemetry. */
export function solve(spec: PuzzleSpec, clues: readonly Clue[], limit = Number.POSITIVE_INFINITY): Solution[] {
  return solveWithTelemetry(spec, clues, limit).solutions;
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
