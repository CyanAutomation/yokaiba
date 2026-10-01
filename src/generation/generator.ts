import type { Clue, DifficultyLevel, GeneratedPuzzle, PuzzleTemplate, Solution } from "../domain/types.js";
import type { PuzzleSolver } from "../domain/puzzle-solver.js";
import { exhaustivePuzzleSolver } from "../constraints/solver.js";
import { assessPuzzleDifficulty } from "./quality.js";
import { isIjfSeniorMensWeightClass } from "../domain/ijf-weight-classes.js";
import { renderClues } from "./clue-text.js";
import { random, shuffled } from "./rng.js";

export const GENERATOR_VERSION = "yokaiba-generator-v5";
/** Version of the built-in solver used when callers do not provide one. */
export const SOLVER_VERSION = exhaustivePuzzleSolver.version;
const MAX_DIFFICULTY_STRATEGIES = 64;
const DENSE_FALLBACK_STRATEGY_LIMIT = 8;
const LEVEL_TWO_CLUE_PROFILES = [
  [0, 1, 2], [0, 2, 1], [1, 0, 2],
  [1, 2, 0], [2, 0, 1], [2, 1, 0],
] as const;

// RNG and shuffle are provided by ./rng.ts

function validateTemplate(template: PuzzleTemplate) {
  const base = template.categories.find(category => category.id === template.baseCategory);
  if (!base) throw new Error("template baseCategory must exist");
  if (new Set(template.categories.map(category => category.id)).size !== template.categories.length) throw new Error("template category IDs must be unique");
  if (new Set(base.values).size !== base.values.length) throw new Error("base values must be unique");
  for (const category of template.categories) {
    if (category.values.length !== base.values.length || new Set(category.values).size !== category.values.length) throw new Error("each category needs unique values matching base row count");
    if (category.id === "weight" && category.values.some(value => !isIjfSeniorMensWeightClass(value))) throw new Error("weight categories must use valid IJF senior men's weight classes");
  }
}

function makeSolution(template: PuzzleTemplate, next: () => number): Solution {
  return {
    assignments: Object.fromEntries(template.categories.filter(category => category.id !== template.baseCategory)
      .map(category => [category.id, shuffled(category.values, next)])),
  };
}

function generationDimensions(template: PuzzleTemplate) {
  const base = template.categories.find(category => category.id === template.baseCategory)!;
  return {
    base,
    categories: template.categories.filter(category => category.id !== template.baseCategory),
  };
}

function directCandidates(template: PuzzleTemplate, solution: Solution, next: () => number): Clue[] {
  const { base, categories } = generationDimensions(template);
  const candidates: Clue[] = [];
  for (const category of categories) {
    for (const [row, value] of solution.assignments[category.id].entries()) {
      const subject = base.values[row];
      candidates.push({
        id: `matches-${category.id}-${row}`,
        constraint: { kind: "matches", subject, category: category.id, value },
        text: "",
      });
    }
  }
  return shuffled(candidates, next);
}

function negativeCandidates(base: PuzzleTemplate["categories"][number], category: PuzzleTemplate["categories"][number], assignment: readonly string[], next: () => number): Clue[] {
  return assignment.map((actualValue, row) => {
    const alternatives = category.values.filter(value => value !== actualValue);
    const value = alternatives[Math.floor(next() * alternatives.length)];
    return {
      id: `not-matches-${category.id}-${row}`,
      constraint: { kind: "notMatches", subject: base.values[row], category: category.id, value },
      text: "",
    };
  });
}

function orderedCandidates(category: PuzzleTemplate["categories"][number], assignment: readonly string[]): Clue[] {
  if (!category.ordered) return [];
  const candidates: Clue[] = [];
  for (let leftRow = 0; leftRow < assignment.length; leftRow += 1) {
    for (let rightRow = leftRow + 1; rightRow < assignment.length; rightRow += 1) {
      const left = { category: category.id, value: assignment[leftRow]! };
      const right = { category: category.id, value: assignment[rightRow]! };
      candidates.push({
        id: `before-${category.id}-${leftRow}-${rightRow}`,
        constraint: { kind: "before", left, right },
        text: "",
      });
      if (rightRow === leftRow + 1) {
        candidates.push({
          id: `adjacent-${category.id}-${leftRow}-${rightRow}`,
          constraint: { kind: "adjacent", left, right },
          text: "",
        });
      }
    }
  }
  return candidates;
}

function sameRowAndDistanceCandidates(
  base: PuzzleTemplate["categories"][number],
  leftCategory: PuzzleTemplate["categories"][number],
  rightCategory: PuzzleTemplate["categories"][number],
  solution: Solution,
): Clue[] {
  const leftAssignment = solution.assignments[leftCategory.id]!;
  const rightAssignment = solution.assignments[rightCategory.id]!;
  const candidates: Clue[] = [];
  for (let row = 0; row < base.values.length; row += 1) {
    const left = { category: leftCategory.id, value: leftAssignment[row]! };
    const right = { category: rightCategory.id, value: rightAssignment[row]! };
    candidates.push({
      id: `same-row-${leftCategory.id}-${rightCategory.id}-${row}`,
      constraint: { kind: "sameRow", left, right },
      text: "",
    });
    for (let otherRow = row + 1; otherRow < base.values.length; otherRow += 1) {
      const distance = otherRow - row;
      const distantRight = { category: rightCategory.id, value: rightAssignment[otherRow]! };
      candidates.push({
        id: `distance-${leftCategory.id}-${rightCategory.id}-${row}-${otherRow}`,
        constraint: { kind: "distance", left, right: distantRight, distance },
        text: "",
      });
    }
  }
  return candidates;
}

/**
 * Create true relational and negative statements from the hidden assignment.
 * The wording deliberately references the tournament lineup, rather than
 * exposing implementation terms such as row indexes or permutations.
 */
function relationalCandidates(template: PuzzleTemplate, solution: Solution, next: () => number): Clue[] {
  const { base, categories } = generationDimensions(template);
  const candidates = categories.flatMap(category => {
    const assignment = solution.assignments[category.id];
    return [
      ...negativeCandidates(base, category, assignment, next),
      ...orderedCandidates(category, assignment),
    ];
  });
  for (let leftIndex = 0; leftIndex < categories.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < categories.length; rightIndex += 1) {
      candidates.push(...sameRowAndDistanceCandidates(base, categories[leftIndex]!, categories[rightIndex]!, solution));
    }
  }
  return shuffled(candidates, next);
}

export interface GenerationOptions {
  difficultyLevel?: DifficultyLevel;
  /** Selects a deterministic clue strategy without changing the puzzle seed. */
  strategy?: number;
}

/** A requested difficulty cannot be met for this seed using any allowed clue order. */
export class DifficultyUnavailableError extends Error {
  /**
   * Levels actually observed while trying every deterministic strategy for the
   * requested band. They are useful alternatives, but intentionally are not
   * advertised as an exhaustive seed-wide search across every target band.
   */
  readonly availableDifficultyLevels: readonly DifficultyLevel[];
  readonly templateId: string;
  readonly requestedDifficultyLevel: DifficultyLevel;

  constructor(templateId: string, seed: string, level: number, availableDifficultyLevels: readonly DifficultyLevel[] = []) {
    super(`difficulty level ${level} is unavailable for template ${templateId} and seed ${seed}`);
    this.name = "DifficultyUnavailableError";
    this.templateId = templateId;
    this.requestedDifficultyLevel = level as DifficultyLevel;
    this.availableDifficultyLevels = availableDifficultyLevels;
  }
}

type ClueKind = Clue["constraint"]["kind"];

function clueFamily(kind: ClueKind): 0 | 1 | 2 {
  return kind === "matches" ? 0 : kind === "notMatches" ? 1 : 2;
}

function levelOneWeight(kind: ClueKind): number {
  return clueFamily(kind);
}

function levelTwoWeight(kind: ClueKind, strategy: number): number {
  // Search distinct clue-family orderings. A single ordering cannot reach
  // the full calibrated band after redundant clues have been removed.
  return LEVEL_TWO_CLUE_PROFILES[strategy % LEVEL_TWO_CLUE_PROFILES.length]![clueFamily(kind)]!;
}

function levelThreeWeight(kind: ClueKind): number {
  return kind === "matches" ? 1 : kind === "notMatches" ? 2 : 0;
}

function advancedWeight(kind: ClueKind): number {
  if (kind === "matches") return 3;
  if (kind === "notMatches") return 2;
  return kind === "sameRow" || kind === "distance" ? 0 : 1;
}

function clueWeight(kind: ClueKind, difficultyLevel: number, strategy: number): number {
  if (difficultyLevel === 1) return levelOneWeight(kind);
  if (difficultyLevel === 2) return levelTwoWeight(kind, strategy);
  if (difficultyLevel === 3) return levelThreeWeight(kind);
  return advancedWeight(kind);
}

function prioritizeForDifficulty(candidates: readonly Clue[], difficultyLevel: GenerationOptions["difficultyLevel"], next: () => number, strategy = 0) {
  const shuffledCandidates = shuffled(candidates, next);
  if (!difficultyLevel) return shuffledCandidates;
  const eligibleCandidates = difficultyLevel >= 4
    ? shuffledCandidates.filter(clue => clue.constraint.kind !== "matches")
    : shuffledCandidates;
  return eligibleCandidates.sort((left, right) =>
    clueWeight(left.constraint.kind, difficultyLevel, strategy) - clueWeight(right.constraint.kind, difficultyLevel, strategy));
}

/**
 * Select a clue subset that establishes uniqueness, then remove every
 * individually redundant clue. The candidate pool combines direct, negative,
 * ordering, and adjacency clues so template prose can create genuine logic
 * deductions instead of presenting the full answer as facts.
 */
export function generatePuzzle(template: PuzzleTemplate, seed: string, solver: PuzzleSolver = exhaustivePuzzleSolver, options: GenerationOptions = {}): GeneratedPuzzle {
  validateTemplate(template);
  const next = random(`${template.id}:${seed}`);
  const solution = makeSolution(template, next);
  const selected: Clue[] = [];
  const candidates = prioritizeForDifficulty(
    [...directCandidates(template, solution, next), ...relationalCandidates(template, solution, next)],
    options.difficultyLevel,
    random(`${template.id}:${seed}:strategy:${options.strategy ?? 0}`),
    options.strategy ?? 0,
  );
  for (const clue of candidates) {
    if (solver.countSolutions(template, selected, 2) === 1) break;
    selected.push(clue);
  }
  if (solver.countSolutions(template, selected, 2) !== 1) throw new Error("candidate pool did not establish uniqueness");
  for (let index = selected.length - 1; index >= 0; index -= 1) {
    const without = selected.filter((_clue, candidateIndex) => candidateIndex !== index);
    if (solver.countSolutions(template, without, 2) === 1) selected.splice(index, 1);
  }
  return {
    id: `${template.id}:${seed}`,
    requestedSeed: seed,
    seed,
    templateId: template.id,
    generatorVersion: GENERATOR_VERSION,
    solverVersion: solver.version,
    spec: template,
    clues: renderClues(template, seed, selected),
    difficulty: assessPuzzleDifficulty(template, selected),
    solution,
  };
}

/**
 * Construct from one stable solution seed and explore deterministic clue-order
 * strategies. A target is unavailable rather than silently changing the seed.
 */
export function generatePuzzleAtDifficulty(template: PuzzleTemplate, seed: string, difficultyLevel: DifficultyLevel, solver: PuzzleSolver = exhaustivePuzzleSolver, strategyLimit = MAX_DIFFICULTY_STRATEGIES): GeneratedPuzzle {
  const observedLevels = new Set<DifficultyLevel>();
  const requiresHumanSolve = template.metadata?.difficultyCalibration.requiresHumanSolve === true;
  for (let strategy = 0; strategy < strategyLimit; strategy += 1) {
    const candidate = generatePuzzle(template, seed, solver, { difficultyLevel, strategy });
    observedLevels.add(candidate.difficulty.level);
    if (candidate.difficulty.level === difficultyLevel && (!requiresHumanSolve || candidate.difficulty.evidence.humanSolve.solved)) {
      return { ...candidate, requestedDifficultyLevel: difficultyLevel, generationStrategy: strategy };
    }
  }
  throw new DifficultyUnavailableError(template.id, seed, difficultyLevel, [...observedLevels].sort((left, right) => left - right));
}

/** Five-row boards with at least two working grids can exceed Worker CPU limits during repeated fallback searches. */
export function difficultyStrategyLimitForFallback(template: PuzzleTemplate): number {
  const base = template.categories.find(category => category.id === template.baseCategory)!;
  const grids = template.categories.length - 1;
  return base.values.length >= 5 && grids >= 2 ? DENSE_FALLBACK_STRATEGY_LIMIT : MAX_DIFFICULTY_STRATEGIES;
}

/** Generate the normal puzzle unless this versioned template promises no-guess play. */
export function generateProgressivePuzzle(template: PuzzleTemplate, seed: string, solver: PuzzleSolver = exhaustivePuzzleSolver): GeneratedPuzzle {
  const puzzle = generatePuzzle(template, seed, solver);
  if (template.metadata?.difficultyCalibration.requiresHumanSolve !== true || puzzle.difficulty.evidence.humanSolve.solved) return puzzle;
  return generatePuzzleAtDifficulty(template, seed, puzzle.difficulty.level, solver);
}

function satisfiesRequestedDifficulty(puzzle: GeneratedPuzzle, difficultyLevel: DifficultyLevel, requiresHumanSolve: boolean): boolean {
  return puzzle.difficulty.level === difficultyLevel && (!requiresHumanSolve || puzzle.difficulty.evidence.humanSolve.solved);
}

function fallbackSeed(requestedSeed: string, attempt: number): string {
  return attempt === 0 ? requestedSeed : `${requestedSeed}:fallback:${attempt}`;
}

function tryProgressiveFallbackCandidate(template: PuzzleTemplate, seed: string, solver: PuzzleSolver): GeneratedPuzzle | undefined {
  try {
    return generateProgressivePuzzle(template, seed, solver);
  } catch (error) {
    if (error instanceof DifficultyUnavailableError) return undefined;
    throw error;
  }
}

function generateCompactFallback(
  template: PuzzleTemplate,
  requestedSeed: string,
  difficultyLevel: DifficultyLevel,
  solver: PuzzleSolver,
  maxAttempts: number,
): GeneratedPuzzle {
  let unavailableError: DifficultyUnavailableError;
  try {
    return generatePuzzleAtDifficulty(template, requestedSeed, difficultyLevel, solver, MAX_DIFFICULTY_STRATEGIES);
  } catch (error) {
    if (!(error instanceof DifficultyUnavailableError)) throw error;
    unavailableError = error;
  }

  const requiresHumanSolve = template.metadata?.difficultyCalibration.requiresHumanSolve === true;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const puzzle = tryProgressiveFallbackCandidate(template, fallbackSeed(requestedSeed, attempt), solver);
    if (!puzzle) continue;
    if (satisfiesRequestedDifficulty(puzzle, difficultyLevel, requiresHumanSolve)) {
      return { ...puzzle, requestedSeed, seedFallbackAttempt: attempt };
    }
  }
  throw unavailableError;
}

function generateDenseFallback(
  template: PuzzleTemplate,
  requestedSeed: string,
  difficultyLevel: DifficultyLevel,
  solver: PuzzleSolver,
  maxAttempts: number,
): GeneratedPuzzle {
  const requiresHumanSolve = template.metadata?.difficultyCalibration.requiresHumanSolve === true;
  const observedLevels = new Set<DifficultyLevel>();
  for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
    const puzzle = generatePuzzle(template, fallbackSeed(requestedSeed, attempt), solver);
    observedLevels.add(puzzle.difficulty.level);
    if (!satisfiesRequestedDifficulty(puzzle, difficultyLevel, requiresHumanSolve)) continue;
    return {
      ...puzzle,
      requestedSeed,
      requestedDifficultyLevel: difficultyLevel,
      ...(attempt > 0 ? { seedFallbackAttempt: attempt } : {}),
    };
  }
  throw new DifficultyUnavailableError(
    template.id,
    requestedSeed,
    difficultyLevel,
    [...observedLevels].filter(level => level !== difficultyLevel).sort((left, right) => left - right),
  );
}

/**
 * Deterministically try nearby derived seeds when a caller explicitly permits
 * a target level to use a different puzzle.  The caller's original seed stays
 * in requestedSeed while seed identifies the replayable selected puzzle.
 */
export function generatePuzzleAtDifficultyWithFallback(template: PuzzleTemplate, requestedSeed: string, difficultyLevel: DifficultyLevel, solver: PuzzleSolver = exhaustivePuzzleSolver, maxAttempts = 32): GeneratedPuzzle {
  // Compact boards keep the full adaptive search: they do not hit the Worker
  // CPU ceiling and the targeted path reliably supplies calibrated levels.
  if (difficultyStrategyLimitForFallback(template) === MAX_DIFFICULTY_STRATEGIES) {
    return generateCompactFallback(template, requestedSeed, difficultyLevel, solver, maxAttempts);
  }
  // Fallback callers explicitly permit a different seed. Generate one normal
  // deterministic candidate per seed and accept it only when it already meets
  // the requested band and the template's no-guess requirement. Retargeting
  // every off-target candidate performs a nested multi-strategy search and can
  // exceed the Worker CPU budget before the bounded seed scan completes.
  return generateDenseFallback(template, requestedSeed, difficultyLevel, solver, maxAttempts);
}
