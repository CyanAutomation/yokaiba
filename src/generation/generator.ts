import type { Clue, Difficulty, DifficultyLevel, GeneratedPuzzle, PuzzleTemplate, Solution } from "../domain/types.js";
import type { PuzzleSolver } from "../domain/puzzle-solver.js";
import { exhaustivePuzzleSolver } from "../constraints/solver.js";
import { assessDifficultyProfileV5, assessPuzzleDifficulty, difficultyForV5 } from "./difficulty-assessment.js";
import { evaluateHumanDeductionTraceV5 } from "./human-deduction-v5.js";
import { DIFFICULTY_BANDS_V5, DIFFICULTY_MODEL_V5, type DifficultyProfileV1 } from "./difficulty-profile.js";
import { isIjfSeniorMensWeightClass } from "../domain/ijf-weight-classes.js";
import { renderClues } from "./clue-text.js";
import { random, shuffled } from "./rng.js";

export const GENERATOR_VERSION = "yokaiba-generator-v6";
/** Version of the built-in solver used when callers do not provide one. */
export const SOLVER_VERSION = exhaustivePuzzleSolver.version;
const MAX_DIFFICULTY_STRATEGIES = 64;
const DENSE_FALLBACK_STRATEGY_LIMIT = 8;
const V5_STRATEGY_LIMIT = 12;
const V5_DENSE_STRATEGY_LIMIT = 4;
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

/** A requested difficulty cannot be met for this seed using any allowed clue order. */
export class DifficultyUnavailableError extends Error {
  /**
   * Levels actually observed while trying every deterministic strategy for the
   * requested band. They are useful alternatives, but intentionally are not
   * advertised as an exhaustive seed-wide search across every target band.
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

function v5ClueWeight(clue: Clue, level: DifficultyLevel, strategy: number, rowCount: number): number {
  const kind = clue.constraint.kind;
  if (level >= 3 && level <= 5) {
    const anchorRow = strategy % rowCount;
    if (kind === "matches") {
      const row = /(?:^|-)matches-.+-([0-9]+)$/.exec(clue.id)?.[1];
      return row !== undefined && Number(row) === anchorRow ? 0 : 36;
    }
    if (kind === "notMatches") return 30;
    if (level === 3) return kind === "before" || kind === "distance" ? 6 : kind === "sameRow" ? 8 : kind === "adjacent" ? 12 : 18;
    if (level === 4) return kind === "sameRow" || kind === "adjacent" ? 6 : kind === "before" ? 12 : 18;
    return kind === "sameRow" ? 6 : kind === "distance" ? 9 : kind === "before" ? 12 : kind === "adjacent" ? 18 : 24;
  }
  const family = kind === "matches" ? 0 : kind === "notMatches" ? 1 : kind === "before" ? 2
    : kind === "adjacent" ? 3 : kind === "sameRow" ? 4 : 5;
  const preferences: readonly (readonly number[])[] = [
    [0, 1, 5, 4, 3, 6],  // Level 1: direct facts and exclusions form easy starts.
    [1, 0, 4, 3, 2, 5],  // Level 2: slightly more use of a small number of relations.
    [1, 0, 3, 2, 4, 5],
    [1, 0, 4, 3, 2, 5],
    [1, 0, 2, 3, 4, 5],
    [5, 4, 2, 3, 0, 1],
    [3, 2, 1, 3, 0, 4],
    [4, 3, 2, 3, 0, 1],
    [5, 4, 2, 3, 1, 0],  // Level 9: exact-distance and same-row relations lead.
    [4, 5, 2, 3, 1, 0],  // Level 10: distance and same-row relations lead.
    [5, 4, 1, 3, 2, 0],  // Level 11: exact-distance clues lead, then ordering.
    [5, 4, 3, 2, 1, 0],  // Level 12: lead with exact-distance and cross-category row links.
  ];
  const rank = preferences[level - 1]![family]!;
  // Six stable rotations keep equal-rank clue ordering reproducible while
  // giving candidate search useful structural variety.
  return rank * 6 + ((family + strategy) % 6);
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
  const clueCandidates = [...directCandidates(template, solution, next), ...relationalCandidates(template, solution, next)];
  const strategyRandom = random(`${template.id}:${seed}:strategy:${options.strategy ?? 0}`);
  const candidates = options.difficultyModel === "v5"
    ? prioritizeForV5(clueCandidates, options.difficultyLevel, strategyRandom, options.strategy ?? 0)
    : prioritizeForDifficulty(clueCandidates, options.difficultyLevel, strategyRandom, options.strategy ?? 0);
  const useV5 = options.difficultyModel === "v5";
  let uniquenessEstablished = false;
  let supplementalClues = 0;
  for (const clue of candidates) {
    if (uniquenessEstablished) {
      if (evaluateHumanDeductionTraceV5(template, selected).solved || supplementalClues >= V5_SUPPLEMENTAL_CLUE_LIMIT) break;
      selected.push(clue);
      supplementalClues += 1;
      continue;
    }
    if (solver.countSolutions(template, selected, 2) === 1) {
      uniquenessEstablished = true;
      if (!useV5 || evaluateHumanDeductionTraceV5(template, selected).solved) break;
      if (supplementalClues >= V5_SUPPLEMENTAL_CLUE_LIMIT) break;
      selected.push(clue);
      supplementalClues += 1;
      continue;
    }
    selected.push(clue);
  }
  if (solver.countSolutions(template, selected, 2) !== 1) throw new Error("candidate pool did not establish uniqueness");
  for (let index = selected.length - 1; index >= 0; index -= 1) {
    const without = selected.filter((_clue, candidateIndex) => candidateIndex !== index);
    if (solver.countSolutions(template, without, 2) === 1
      && (!useV5 || evaluateHumanDeductionTraceV5(template, without).solved)) selected.splice(index, 1);
  }
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

function v5StrategyLimit(template: PuzzleTemplate): number {
  const base = template.categories.find(category => category.id === template.baseCategory)!;
  return base.values.length >= 5 && template.categories.length >= 3 ? V5_DENSE_STRATEGY_LIMIT : V5_STRATEGY_LIMIT;
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
  const observedLevels = new Set<DifficultyLevel>();
  let best: GeneratedPuzzle | undefined;
  let bestRank = Number.POSITIVE_INFINITY;
  let eligibleCandidates = 0;
  let strategiesAttempted = 0;
  let minimumScore = Number.POSITIVE_INFINITY;
  let maximumScore = Number.NEGATIVE_INFINITY;
  let completeCandidates = 0;
  let incompleteCandidates = 0;
  for (let strategy = 0; strategy < strategyLimit; strategy += 1) {
    strategiesAttempted += 1;
    const candidate = generatePuzzle(template, seed, solver, { difficultyLevel, difficultyModel: "v5", strategy });
    const logical = candidate.difficultyProfile!.logical;
    if (logical.inDifficultyBand && logical.status === "complete"
      && logical.level >= minimumLevel && logical.level <= maximumLevel) observedLevels.add(logical.level);
    minimumScore = Math.min(minimumScore, logical.score);
    maximumScore = Math.max(maximumScore, logical.score);
    if (logical.status === "complete") completeCandidates += 1;
    else incompleteCandidates += 1;
    if (!logical.inDifficultyBand || logical.level !== difficultyLevel || logical.status !== "complete") continue;
    eligibleCandidates += 1;
    const rank = v5CandidateRank(candidate, difficultyLevel);
    if (!best || rank < bestRank) {
      bestRank = rank;
      best = { ...candidate, requestedDifficultyLevel: difficultyLevel, generationStrategy: strategy };
    }
  }
  if (best) return {
    ...best,
    selectionDiagnostics: {
      modelVersion: DIFFICULTY_MODEL_V5,
      strategyBudget: strategyLimit,
      strategiesAttempted,
      eligibleCandidates,
      selectedScore: best.difficultyProfile!.logical.score,
      selectedRankDistance: Number(bestRank.toFixed(3)),
      candidateScoreRange: {
        minimum: minimumScore,
        maximum: maximumScore,
        complete: completeCandidates,
        incomplete: incompleteCandidates,
      },
    },
  };
  throw new DifficultyUnavailableError(
    template.id,
    seed,
    difficultyLevel,
    [...observedLevels].sort((left, right) => left - right),
    {
      modelVersion: DIFFICULTY_MODEL_V5,
      strategiesAttempted,
      eligibleCandidates,
      reason: "no_candidate_in_band",
      candidateScoreRange: strategiesAttempted ? {
        minimum: minimumScore,
        maximum: maximumScore,
        complete: completeCandidates,
        incomplete: incompleteCandidates,
      } : undefined,
    },
  );
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

/** Apply the same progressive/default and explicit-target policy for every transport. */
export function generatePuzzleForRequest(
  template: PuzzleTemplate,
  seed: string,
  difficultyLevel?: DifficultyLevel,
  allowSeedFallback = false,
  solver: PuzzleSolver = exhaustivePuzzleSolver,
  difficultyModel: "v4" | "v5" | "compare" = "v5",
): GeneratedPuzzle {
  if (difficultyModel === "compare") {
    const legacy = difficultyLevel === undefined
      ? generateProgressivePuzzle(template, seed, solver)
      : allowSeedFallback
        ? generatePuzzleAtDifficultyWithFallback(template, seed, difficultyLevel, solver)
        : generatePuzzleAtDifficulty(template, seed, difficultyLevel, solver);
    const difficultyProfile = assessDifficultyProfileV5(template, legacy.clues);
    return { ...legacy, difficultyModel: "compare", difficultyProfile };
  }
  if (difficultyModel === "v5") {
    if (difficultyLevel !== undefined) {
      if (!allowSeedFallback) return generatePuzzleAtDifficultyV5(template, seed, difficultyLevel, solver);
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
          unavailable = new DifficultyUnavailableError(template.id, seed, difficultyLevel, error.availableDifficultyLevels, {
            modelVersion: DIFFICULTY_MODEL_V5,
            strategiesAttempted: (unavailable?.diagnostics?.strategiesAttempted ?? 0) + (error.diagnostics?.strategiesAttempted ?? 0),
            eligibleCandidates: (unavailable?.diagnostics?.eligibleCandidates ?? 0) + (error.diagnostics?.eligibleCandidates ?? 0),
            reason: "no_candidate_in_band",
            fallbackSeedsAttempted,
            candidateScoreRange: error.diagnostics?.candidateScoreRange === undefined
              ? unavailable?.diagnostics?.candidateScoreRange
              : unavailable?.diagnostics?.candidateScoreRange === undefined
                ? error.diagnostics.candidateScoreRange
                : {
                  minimum: Math.min(unavailable.diagnostics.candidateScoreRange.minimum, error.diagnostics.candidateScoreRange.minimum),
                  maximum: Math.max(unavailable.diagnostics.candidateScoreRange.maximum, error.diagnostics.candidateScoreRange.maximum),
                  complete: unavailable.diagnostics.candidateScoreRange.complete + error.diagnostics.candidateScoreRange.complete,
                  incomplete: unavailable.diagnostics.candidateScoreRange.incomplete + error.diagnostics.candidateScoreRange.incomplete,
                },
          });
        }
      }
      throw unavailable ?? new DifficultyUnavailableError(template.id, seed, difficultyLevel);
    }
    return generateV5Progressive(template, seed, solver);
  }
  const legacy = difficultyLevel === undefined ? generateProgressivePuzzle(template, seed, solver) : allowSeedFallback
    ? generatePuzzleAtDifficultyWithFallback(template, seed, difficultyLevel, solver)
    : generatePuzzleAtDifficulty(template, seed, difficultyLevel, solver);
  return { ...legacy, difficultyModel: "v4" };
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
