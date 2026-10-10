import type { Clue, PuzzleSpec, Solution } from "../domain/types.js";
import type { PuzzleSolver } from "../domain/puzzle-solver.js";
import { category, compileConstraints, type CompiledConstraint } from "./compiled-constraints.js";
export { satisfiesConstraint } from "./compiled-constraints.js";

/** Inclusive row-count bounds supported by the exhaustive MVP solver. */
export const MIN_SUPPORTED_ROWS = 2;
export const MAX_SUPPORTED_ROWS = 5;

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

interface CandidateDimension {
  readonly id: string;
  readonly permutations: readonly string[][];
  readonly degree: number;
  readonly originalIndex: number;
}

export interface SolverTelemetry {
  /** Diagnostic count of permutation assignments considered; its exact value is not part of the solver's public contract. */
  readonly nodesVisited: number;
  /** Diagnostic count of compiled constraints evaluated, excluding those deferred as unready; its exact value is not contractual. */
  readonly constraintChecks: number;
  /** Wall-clock time spent inside the solve call. */
  readonly elapsedMs: number;
}

export interface SolveWithTelemetryResult {
  readonly solutions: Solution[];
  readonly telemetry: SolverTelemetry;
}

/** Exhaustive, deterministic solver. Intended for the MVP's deliberately small grids. */
export function solveWithTelemetry(
  spec: PuzzleSpec,
  clues: readonly Clue[],
  limit = Number.POSITIVE_INFINITY,
  now: () => number = () => performance.now(),
): SolveWithTelemetryResult {
  const startedAt = now();
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
    if (depth === candidates.length) {
      results.push({ assignments: Object.fromEntries(originalDimensions.map(({ id }) => [id, [...assignments[id]!]])) });
      return;
    }
    const dimension = candidates[depth];
    dimension.permutations.some(permutation => {
      nodesVisited += 1;
      assignments[dimension.id] = permutation;
      if (check(constraintsReadyAtDepth[depth]!)) visit(depth + 1);
      delete assignments[dimension.id];
      return results.length >= limit;
    });
  };
  if (limit > 0 && check(rootConstraints)) visit(0);
  return { solutions: results, telemetry: { nodesVisited, constraintChecks, elapsedMs: now() - startedAt } };
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
