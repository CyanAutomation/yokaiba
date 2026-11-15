import type { Clue, Difficulty, DifficultyLevel, GeneratedPuzzle, PuzzleTemplate, Solution } from "../domain/types.js";
import type { PuzzleSolver } from "../domain/puzzle-solver.js";
import { exhaustivePuzzleSolver } from "../constraints/solver.js";
import { assessDifficultyProfileV5, assessPuzzleDifficulty, difficultyForV5 } from "./difficulty-assessment.js";
import { evaluateHumanDeductionTraceV5 } from "./human-deduction-v5.js";
import { DIFFICULTY_BANDS_V5, DIFFICULTY_MODEL_V5, type DifficultyProfileV1 } from "./difficulty-profile.js";
import { isIjfSeniorMensWeightClass } from "../domain/ijf-weight-classes.js";
import { renderClues } from "./clue-text.js";
import { random, shuffled } from "./rng.js";
import { v5ClueWeight } from "./v5-clue-weight.js";

export const GENERATOR_VERSION = "yokaiba-generator-v6";
/** Version of the built-in solver used when callers do not provide one. */
export const SOLVER_VERSION = exhaustivePuzzleSolver.version;
export const DEFAULT_DIFFICULTY_MODEL = "v5" as const;
export const DEFAULT_DIFFICULTY_MODEL_VERSION = DIFFICULTY_MODEL_V5;
const MAX_DIFFICULTY_STRATEGIES = 64;
const DENSE_FALLBACK_STRATEGY_LIMIT = 8;
const V5_STRATEGY_LIMIT = 12;
const V5_DENSE_STRATEGY_LIMIT = 12;
const V5_FALLBACK_SEED_LIMIT = 2;
const V5_SUPPLEMENTAL_CLUE_LIMIT = 16;
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

function crossCategoryPairCandidates(
  leftCategory: PuzzleTemplate["categories"][number],
  rightCategory: PuzzleTemplate["categories"][number],
  solution: Solution,
): Clue[] {
  const candidates: Clue[] = [];
  const leftAssignment = solution.assignments[leftCategory.id]!;
  const rightAssignment = solution.assignments[rightCategory.id]!;
  for (let leftRow = 0; leftRow < leftAssignment.length; leftRow += 1) {
    for (let rightRow = 0; rightRow < rightAssignment.length; rightRow += 1) {
      if (leftRow === rightRow) continue;
      const earlier = leftRow < rightRow
        ? { category: leftCategory.id, value: leftAssignment[leftRow]! }
        : { category: rightCategory.id, value: rightAssignment[rightRow]! };
      const later = leftRow < rightRow
        ? { category: rightCategory.id, value: rightAssignment[rightRow]! }
        : { category: leftCategory.id, value: leftAssignment[leftRow]! };
      const id = `${leftCategory.id}-${leftRow}-${rightCategory.id}-${rightRow}`;
      candidates.push({
        id: `before-cross-${id}`,
        constraint: { kind: "before", left: earlier, right: later },
        text: "",
      });
      if (Math.abs(leftRow - rightRow) === 1) {
        candidates.push({
          id: `adjacent-cross-${id}`,
          constraint: { kind: "adjacent", left: earlier, right: later },
          text: "",
        });
      }
    }
  }
  return candidates;
}

/** Relate values from different grids by their position in the tournament order. */
function crossCategoryOrderCandidates(
  categories: readonly PuzzleTemplate["categories"][number][],
  solution: Solution,
): Clue[] {
  const candidates: Clue[] = [];
  for (let leftIndex = 0; leftIndex < categories.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < categories.length; rightIndex += 1) {
      candidates.push(...crossCategoryPairCandidates(categories[leftIndex]!, categories[rightIndex]!, solution));
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
  difficultyModel?: "v5" | "compare";
  /** Selects a deterministic clue strategy without changing the puzzle seed. */
  strategy?: number;
}

/** No suitable puzzle was found within the deterministic generation strategy budget. */
export class DifficultyUnavailableError extends Error {
  /**
   * Levels observed across the deterministic strategies. For targeted requests,
   * they are alternatives rather than an exhaustive seed-wide search of every band.
   */
  readonly availableDifficultyLevels: readonly DifficultyLevel[];
  readonly templateId: string;
  readonly requestedDifficultyLevel?: DifficultyLevel;
  readonly diagnostics?: {
    modelVersion: string;
    strategiesAttempted: number;
    eligibleCandidates: number;
    reason: "no_candidate_in_band";
    fallbackSeedsAttempted?: number;
    candidateScoreRange?: { minimum: number; maximum: number; complete: number; incomplete: number };
  };

  constructor(
    templateId: string,
    seed: string,
    level: number | undefined,
    availableDifficultyLevels: readonly DifficultyLevel[] = [],
    diagnostics?: DifficultyUnavailableError["diagnostics"],
  ) {
    super(level === undefined
      ? `no complete difficulty v5 puzzle is available for template ${templateId} and seed ${seed}`
      : `difficulty level ${level} is unavailable for template ${templateId} and seed ${seed}`);
    this.name = "DifficultyUnavailableError";
    this.templateId = templateId;
    if (level !== undefined) this.requestedDifficultyLevel = level as DifficultyLevel;
    this.availableDifficultyLevels = availableDifficultyLevels;
    this.diagnostics = diagnostics;
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

function prioritizeForV5(candidates: readonly Clue[], difficultyLevel: DifficultyLevel | undefined, next: () => number, strategy = 0): Clue[] {
  const shuffledCandidates = shuffled(candidates, next);
  if (difficultyLevel === undefined) return shuffledCandidates;
  const rowCount = Math.max(...candidates.map(clue => clue.constraint.kind === "matches" || clue.constraint.kind === "notMatches"
    ? Number(/([0-9]+)$/.exec(clue.id)?.[1] ?? 0) + 1
    : 0));
  return shuffledCandidates.sort((left, right) =>
    v5ClueWeight(left, difficultyLevel, strategy, rowCount)
    - v5ClueWeight(right, difficultyLevel, strategy, rowCount));
}

function createClueCandidates(template: PuzzleTemplate, solution: Solution, next: () => number, options: GenerationOptions): Clue[] {
  return [
    ...directCandidates(template, solution, next),
    ...relationalCandidates(template, solution, next),
    ...(options.difficultyModel === "v5" && (options.difficultyLevel ?? 0) >= 11
      ? crossCategoryOrderCandidates(generationDimensions(template).categories, solution)
      : []),
  ];
}

interface UniqueClueStart {
  selected: Clue[];
  nextCandidate: number;
  needsHumanSolvingClues: boolean;
}

function findUniqueClueStart(
  template: PuzzleTemplate,
  candidates: readonly Clue[],
  solver: PuzzleSolver,
  useV5: boolean,
): UniqueClueStart {
  const selected: Clue[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    if (solver.countSolutions(template, selected, 2) !== 1) {
      selected.push(candidates[index]!);
      continue;
    }
    const needsHumanSolvingClues = useV5 && !evaluateHumanDeductionTraceV5(template, selected).solved;
    return { selected, nextCandidate: index, needsHumanSolvingClues };
  }
  if (solver.countSolutions(template, selected, 2) !== 1) throw new Error("candidate pool did not establish uniqueness");
  return { selected, nextCandidate: candidates.length, needsHumanSolvingClues: false };
}

function addHumanSolvingClues(
  template: PuzzleTemplate,
  selected: Clue[],
  candidates: readonly Clue[],
  startAt: number,
): void {
  let supplementalClues = 0;
  for (let index = startAt; index < candidates.length; index += 1) {
    if (evaluateHumanDeductionTraceV5(template, selected).solved || supplementalClues >= V5_SUPPLEMENTAL_CLUE_LIMIT) break;
    selected.push(candidates[index]!);
    supplementalClues += 1;
  }
}

function removeRedundantClues(template: PuzzleTemplate, selected: Clue[], solver: PuzzleSolver, useV5: boolean): void {
  for (let index = selected.length - 1; index >= 0; index -= 1) {
    const without = selected.filter((_clue, candidateIndex) => candidateIndex !== index);
    const remainsUnique = solver.countSolutions(template, without, 2) === 1;
    const remainsHumanSolvable = !useV5 || evaluateHumanDeductionTraceV5(template, without).solved;
    if (remainsUnique && remainsHumanSolvable) selected.splice(index, 1);
  }
}

function selectPuzzleClues(template: PuzzleTemplate, candidates: readonly Clue[], solver: PuzzleSolver, useV5: boolean): Clue[] {
  const start = findUniqueClueStart(template, candidates, solver, useV5);
  const selected = [...start.selected];
  if (start.needsHumanSolvingClues) addHumanSolvingClues(template, selected, candidates, start.nextCandidate);
  if (solver.countSolutions(template, selected, 2) !== 1) throw new Error("candidate pool did not establish uniqueness");
  removeRedundantClues(template, selected, solver, useV5);
  return selected;
}

/**
 * Select a clue subset that establishes uniqueness, then remove every
 * individually redundant clue. The candidate pool combines direct, negative,
 * ordering, and adjacency clues so template prose can create genuine logic
 * deductions instead of presenting the full answer as facts. V5 additionally
 * connects position clues across grids; the legacy candidate pool stays stable.
 */
export function generatePuzzle(template: PuzzleTemplate, seed: string, solver: PuzzleSolver = exhaustivePuzzleSolver, options: GenerationOptions = {}): GeneratedPuzzle {
  validateTemplate(template);
  const next = random(`${template.id}:${seed}`);
  const solution = makeSolution(template, next);
  const clueCandidates = createClueCandidates(template, solution, next, options);
  const strategyRandom = random(`${template.id}:${seed}:strategy:${options.strategy ?? 0}`);
  const candidates = options.difficultyModel === "v5"
    ? prioritizeForV5(clueCandidates, options.difficultyLevel, strategyRandom, options.strategy ?? 0)
    : prioritizeForDifficulty(clueCandidates, options.difficultyLevel, strategyRandom, options.strategy ?? 0);
  const useV5 = options.difficultyModel === "v5";
  const selected = selectPuzzleClues(template, candidates, solver, useV5);
  const profile = options.difficultyModel ? assessDifficultyProfileV5(template, selected) : undefined;
  const legacyDifficulty = profile?.legacy ?? assessPuzzleDifficulty(template, selected);
  const difficulty = useV5 && profile ? difficultyForV5(profile) : legacyDifficulty;
  return {
    id: useV5 ? `${template.id}:${seed}:${DIFFICULTY_MODEL_V5}` : `${template.id}:${seed}`,
    requestedSeed: seed,
    seed,
    templateId: template.id,
    generatorVersion: GENERATOR_VERSION,
    solverVersion: solver.version,
    ...(options.difficultyModel ? { difficultyModel: options.difficultyModel } : {}),
    ...(profile ? { difficultyProfile: profile } : {}),
    spec: template,
    clues: renderClues(template, seed, selected),
    difficulty,
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

function usesDenseV5Search(template: PuzzleTemplate): boolean {
  const base = template.categories.find(category => category.id === template.baseCategory)!;
  return base.values.length >= 5 && template.categories.length >= 3;
}

function v5StrategyLimit(template: PuzzleTemplate): number {
  return usesDenseV5Search(template) ? V5_DENSE_STRATEGY_LIMIT : V5_STRATEGY_LIMIT;
}

function v5CandidateRank(puzzle: GeneratedPuzzle, requestedDifficultyLevel: DifficultyLevel): number {
  const assessment = puzzle.difficultyProfile!.logical;
  const band = DIFFICULTY_BANDS_V5.find(item => item.level === requestedDifficultyLevel)!;
  const midpoint = (band.minimumScore + band.maximumScore) / 2;
  const depth = assessment.trace.maximumDependencyDepth;
  const depthShortfall = Math.max(0, band.preferredMinimumDepth - depth);
  const strategyKinds = new Set(assessment.trace.steps.flatMap(step => step.strategy));
  const diversityCredit = Math.min(3, Math.max(0, strategyKinds.size - 1)) * 0.25;
  const accessibility = assessment.metrics.startingAccessibility.score;
  const accessibilityPenalty = Math.max(0, 30 - accessibility) * 0.04;
  const cascadePenalty = Math.max(0, assessment.metrics.automaticCascadeBehaviour.score - 80) * 0.04;
  return Math.abs(assessment.score - midpoint) + depthShortfall * 3 + accessibilityPenalty + cascadePenalty - diversityCredit;
}

type CandidateScoreRange = NonNullable<DifficultyUnavailableError["diagnostics"]>["candidateScoreRange"];

interface V5CandidateSelection {
  readonly requestedLevel: DifficultyLevel;
  readonly minimumLevel: DifficultyLevel;
  readonly maximumLevel: DifficultyLevel;
  readonly observedLevels: Set<DifficultyLevel>;
  best?: GeneratedPuzzle;
  bestRank: number;
  eligibleCandidates: number;
  strategiesAttempted: number;
  minimumScore: number;
  maximumScore: number;
  completeCandidates: number;
  incompleteCandidates: number;
}

function createV5CandidateSelection(
  requestedLevel: DifficultyLevel,
  minimumLevel: DifficultyLevel,
  maximumLevel: DifficultyLevel,
): V5CandidateSelection {
  return {
    requestedLevel,
    minimumLevel,
    maximumLevel,
    observedLevels: new Set(),
    bestRank: Number.POSITIVE_INFINITY,
    eligibleCandidates: 0,
    strategiesAttempted: 0,
    minimumScore: Number.POSITIVE_INFINITY,
    maximumScore: Number.NEGATIVE_INFINITY,
    completeCandidates: 0,
    incompleteCandidates: 0,
  };
}

function observeV5Candidate(selection: V5CandidateSelection, candidate: GeneratedPuzzle, strategy: number): void {
  const logical = candidate.difficultyProfile!.logical;
  if (logical.inDifficultyBand && logical.status === "complete"
    && logical.level >= selection.minimumLevel && logical.level <= selection.maximumLevel) {
    selection.observedLevels.add(logical.level);
  }
  selection.minimumScore = Math.min(selection.minimumScore, logical.score);
  selection.maximumScore = Math.max(selection.maximumScore, logical.score);
  if (logical.status === "complete") selection.completeCandidates += 1;
  else selection.incompleteCandidates += 1;
  if (!logical.inDifficultyBand || logical.level !== selection.requestedLevel || logical.status !== "complete") return;

  selection.eligibleCandidates += 1;
  const rank = v5CandidateRank(candidate, selection.requestedLevel);
  if (selection.best && !(rank < selection.bestRank)) return;
  selection.bestRank = rank;
  selection.best = { ...candidate, requestedDifficultyLevel: selection.requestedLevel, generationStrategy: strategy };
}

function v5CandidateScoreRange(selection: V5CandidateSelection): NonNullable<CandidateScoreRange> | undefined {
  if (!selection.strategiesAttempted) return undefined;
  return {
    minimum: selection.minimumScore,
    maximum: selection.maximumScore,
    complete: selection.completeCandidates,
    incomplete: selection.incompleteCandidates,
  };
}

function selectedV5Candidate(selection: V5CandidateSelection, strategyLimit: number): GeneratedPuzzle {
  const best = selection.best!;
  return {
    ...best,
    selectionDiagnostics: {
      modelVersion: DIFFICULTY_MODEL_V5,
      strategyBudget: strategyLimit,
      strategiesAttempted: selection.strategiesAttempted,
      eligibleCandidates: selection.eligibleCandidates,
      selectedScore: best.difficultyProfile!.logical.score,
      selectedRankDistance: Number(selection.bestRank.toFixed(3)),
      candidateScoreRange: v5CandidateScoreRange(selection)!,
    },
  };
}

function v5UnavailableError(templateId: string, seed: string, selection: V5CandidateSelection): DifficultyUnavailableError {
  return new DifficultyUnavailableError(
    templateId,
    seed,
    selection.requestedLevel,
    [...selection.observedLevels].sort((left, right) => left - right),
    {
      modelVersion: DIFFICULTY_MODEL_V5,
      strategiesAttempted: selection.strategiesAttempted,
      eligibleCandidates: selection.eligibleCandidates,
      reason: "no_candidate_in_band",
      candidateScoreRange: v5CandidateScoreRange(selection),
    },
  );
}

/** Search a strict, deterministic strategy budget and retain the best in-band v5 candidate. */
export function generatePuzzleAtDifficultyV5(
  template: PuzzleTemplate,
  seed: string,
  difficultyLevel: DifficultyLevel,
  solver: PuzzleSolver = exhaustivePuzzleSolver,
  strategyLimit = v5StrategyLimit(template),
): GeneratedPuzzle {
  const [minimumLevel, maximumLevel] = template.metadata?.difficultyCalibration.levelRange ?? [1, 12];
  if (difficultyLevel < minimumLevel || difficultyLevel > maximumLevel) {
    throw new DifficultyUnavailableError(template.id, seed, difficultyLevel, [], {
      modelVersion: DIFFICULTY_MODEL_V5, strategiesAttempted: 0, eligibleCandidates: 0, reason: "no_candidate_in_band",
    });
  }
  const selection = createV5CandidateSelection(difficultyLevel, minimumLevel, maximumLevel);
  for (let strategy = 0; strategy < strategyLimit; strategy += 1) {
    selection.strategiesAttempted += 1;
    const candidate = generatePuzzle(template, seed, solver, {
      difficultyLevel,
      difficultyModel: "v5",
      strategy,
    });
    observeV5Candidate(selection, candidate, strategy);
  }
  if (selection.best) return selectedV5Candidate(selection, strategyLimit);
  throw v5UnavailableError(template.id, seed, selection);
}

function generateV5Progressive(template: PuzzleTemplate, seed: string, solver: PuzzleSolver): GeneratedPuzzle {
  const strategyLimit = v5StrategyLimit(template);
  let best: GeneratedPuzzle | undefined;
  let strategiesAttempted = 0;
  let eligibleCandidates = 0;
  const observed = new Set<DifficultyLevel>();
  for (let strategy = 0; strategy < strategyLimit; strategy += 1) {
    strategiesAttempted += 1;
    const candidate = generatePuzzle(template, seed, solver, { difficultyModel: "v5", strategy });
    const logical = candidate.difficultyProfile!.logical;
    observed.add(logical.level);
    if (!logical.inDifficultyBand || logical.status !== "complete") continue;
    eligibleCandidates += 1;
    if (!best || logical.score < best.difficultyProfile!.logical.score) best = { ...candidate, generationStrategy: strategy };
  }
  if (best) return {
    ...best,
    selectionDiagnostics: {
      modelVersion: DIFFICULTY_MODEL_V5,
      strategyBudget: strategyLimit,
      strategiesAttempted,
      eligibleCandidates,
      selectedScore: best.difficultyProfile!.logical.score,
    },
  };
  throw new DifficultyUnavailableError(template.id, seed, undefined, [...observed].sort((left, right) => left - right), {
    modelVersion: DIFFICULTY_MODEL_V5, strategiesAttempted: strategyLimit, eligibleCandidates: 0, reason: "no_candidate_in_band",
  });
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

function generateLegacyRequest(
  template: PuzzleTemplate,
  seed: string,
  difficultyLevel: DifficultyLevel | undefined,
  allowSeedFallback: boolean,
  solver: PuzzleSolver,
): GeneratedPuzzle {
  if (difficultyLevel === undefined) return generateProgressivePuzzle(template, seed, solver);
  return allowSeedFallback
    ? generatePuzzleAtDifficultyWithFallback(template, seed, difficultyLevel, solver)
    : generatePuzzleAtDifficulty(template, seed, difficultyLevel, solver);
}

function generateComparisonRequest(
  template: PuzzleTemplate,
  seed: string,
  difficultyLevel: DifficultyLevel | undefined,
  allowSeedFallback: boolean,
  solver: PuzzleSolver,
): GeneratedPuzzle {
  const legacy = generateLegacyRequest(template, seed, difficultyLevel, allowSeedFallback, solver);
  const difficultyProfile = assessDifficultyProfileV5(template, legacy.clues);
  return { ...legacy, difficultyModel: "compare", difficultyProfile };
}

function sumOptionalCounts(previous: number | undefined, current: number | undefined): number {
  return (previous ?? 0) + (current ?? 0);
}

function mergeCandidateScoreRanges(previous: CandidateScoreRange, current: CandidateScoreRange): CandidateScoreRange {
  if (current === undefined) return previous;
  if (previous === undefined) return current;
  return {
    minimum: Math.min(previous.minimum, current.minimum),
    maximum: Math.max(previous.maximum, current.maximum),
    complete: previous.complete + current.complete,
    incomplete: previous.incomplete + current.incomplete,
  };
}

function mergeV5UnavailableError(
  templateId: string,
  seed: string,
  difficultyLevel: DifficultyLevel,
  fallbackSeedsAttempted: number,
  previous: DifficultyUnavailableError | undefined,
  current: DifficultyUnavailableError,
): DifficultyUnavailableError {
  const previousDiagnostics = previous?.diagnostics;
  const currentDiagnostics = current.diagnostics;
  return new DifficultyUnavailableError(templateId, seed, difficultyLevel, current.availableDifficultyLevels, {
    modelVersion: DIFFICULTY_MODEL_V5,
    strategiesAttempted: sumOptionalCounts(previousDiagnostics?.strategiesAttempted, currentDiagnostics?.strategiesAttempted),
    eligibleCandidates: sumOptionalCounts(previousDiagnostics?.eligibleCandidates, currentDiagnostics?.eligibleCandidates),
    reason: "no_candidate_in_band",
    fallbackSeedsAttempted,
    candidateScoreRange: mergeCandidateScoreRanges(previousDiagnostics?.candidateScoreRange, currentDiagnostics?.candidateScoreRange),
  });
}

function generateV5TargetWithFallback(
  template: PuzzleTemplate,
  seed: string,
  difficultyLevel: DifficultyLevel,
  solver: PuzzleSolver,
): GeneratedPuzzle {
  let unavailable: DifficultyUnavailableError | undefined;
  let fallbackSeedsAttempted = 0;
  for (let attempt = 0; attempt <= V5_FALLBACK_SEED_LIMIT; attempt += 1) {
    fallbackSeedsAttempted += 1;
    const candidateSeed = fallbackSeed(seed, attempt);
    try {
      const candidate = generatePuzzleAtDifficultyV5(template, candidateSeed, difficultyLevel, solver, v5StrategyLimit(template));
      return { ...candidate, requestedSeed: seed, ...(attempt > 0 ? { seedFallbackAttempt: attempt } : {}) };
    } catch (error) {
      if (!(error instanceof DifficultyUnavailableError)) throw error;
      unavailable = mergeV5UnavailableError(template.id, seed, difficultyLevel, fallbackSeedsAttempted, unavailable, error);
    }
  }
  throw unavailable ?? new DifficultyUnavailableError(template.id, seed, difficultyLevel);
}

function generateV5Request(
  template: PuzzleTemplate,
  seed: string,
  difficultyLevel: DifficultyLevel | undefined,
  allowSeedFallback: boolean,
  solver: PuzzleSolver,
): GeneratedPuzzle {
  if (difficultyLevel === undefined) return generateV5Progressive(template, seed, solver);
  if (!allowSeedFallback) return generatePuzzleAtDifficultyV5(template, seed, difficultyLevel, solver);
  return generateV5TargetWithFallback(template, seed, difficultyLevel, solver);
}

/** Apply the same progressive/default and explicit-target policy for every transport. */
export function generatePuzzleForRequest(
  template: PuzzleTemplate,
  seed: string,
  difficultyLevel?: DifficultyLevel,
  allowSeedFallback = false,
  solver: PuzzleSolver = exhaustivePuzzleSolver,
  difficultyModel: "v4" | "v5" | "compare" = DEFAULT_DIFFICULTY_MODEL,
): GeneratedPuzzle {
  if (difficultyModel === "compare") return generateComparisonRequest(template, seed, difficultyLevel, allowSeedFallback, solver);
  if (difficultyModel === "v5") return generateV5Request(template, seed, difficultyLevel, allowSeedFallback, solver);
  return { ...generateLegacyRequest(template, seed, difficultyLevel, allowSeedFallback, solver), difficultyModel: "v4" };
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
