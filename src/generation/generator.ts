import type { Clue, DifficultyLevel, GeneratedPuzzle, PuzzleTemplate, Solution } from "../domain/types.js";
import type { PuzzleSolver } from "../domain/puzzle-solver.js";
import { exhaustivePuzzleSolver } from "../constraints/solver.js";
import { assessPuzzleDifficulty } from "./quality.js";
import { isIjfSeniorMensWeightClass } from "../domain/ijf-weight-classes.js";
import { renderClues } from "./clue-text.js";

export const GENERATOR_VERSION = "yokaiba-generator-v4";
/** Version of the built-in solver used when callers do not provide one. */
export const SOLVER_VERSION = exhaustivePuzzleSolver.version;

function hash(seed: string): number {
  let value = 2166136261;
  for (const character of seed) { const code = character.codePointAt(0); if (code !== undefined) { value ^= code; value = Math.imul(value, 16777619); } }
  return value >>> 0;
}

function random(seed: string) {
  let state = hash(seed);
  if (state === 0) state = 2166136261;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 2 ** 32; };
}

function shuffled<T>(values: readonly T[], next: () => number): T[] {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(next() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

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

function directCandidates(template: PuzzleTemplate, solution: Solution, next: () => number): Clue[] {
  const base = template.categories.find(category => category.id === template.baseCategory)!;
  const candidates: Clue[] = [];
  for (const category of template.categories) {
    if (category.id === template.baseCategory) continue;
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

/**
 * Create true relational and negative statements from the hidden assignment.
 * The wording deliberately references the tournament lineup, rather than
 * exposing implementation terms such as row indexes or permutations.
 */
function relationalCandidates(template: PuzzleTemplate, solution: Solution, next: () => number): Clue[] {
  const base = template.categories.find(category => category.id === template.baseCategory)!;
  const candidates: Clue[] = [];
  for (const category of template.categories) {
    if (category.id === template.baseCategory) continue;
    const assignment = solution.assignments[category.id];
    for (const [row, actualValue] of assignment.entries()) {
      const alternatives = category.values.filter(value => value !== actualValue);
      const value = alternatives[Math.floor(next() * alternatives.length)];
      candidates.push({
        id: `not-matches-${category.id}-${row}`,
        constraint: { kind: "notMatches", subject: base.values[row], category: category.id, value },
        text: "",
      });
    }
    if (!category.ordered) continue;
    for (let leftRow = 0; leftRow < assignment.length; leftRow += 1) {
      for (let rightRow = leftRow + 1; rightRow < assignment.length; rightRow += 1) {
        const left = { category: category.id, value: assignment[leftRow] };
        const right = { category: category.id, value: assignment[rightRow] };
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
  }
  const dimensions = template.categories.filter(category => category.id !== base.id);
  for (let leftIndex = 0; leftIndex < dimensions.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < dimensions.length; rightIndex += 1) {
      const leftCategory = dimensions[leftIndex]!;
      const rightCategory = dimensions[rightIndex]!;
      const leftAssignment = solution.assignments[leftCategory.id]!;
      const rightAssignment = solution.assignments[rightCategory.id]!;
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

function prioritizeForDifficulty(candidates: readonly Clue[], difficultyLevel: GenerationOptions["difficultyLevel"], next: () => number, strategy = 0) {
  const shuffledCandidates = shuffled(candidates, next);
  if (!difficultyLevel) return shuffledCandidates;
  const eligibleCandidates = difficultyLevel >= 4
    ? shuffledCandidates.filter(clue => clue.constraint.kind !== "matches")
    : shuffledCandidates;
  const weight = (clue: Clue) => {
    const kind = clue.constraint.kind;
    if (difficultyLevel === 1) return kind === "matches" ? 0 : kind === "notMatches" ? 1 : 2;
    if (difficultyLevel === 2) {
      // Search distinct clue-family orderings. A single ordering cannot reach
      // the full calibrated band after redundant clues have been removed.
      const family = kind === "matches" ? 0 : kind === "notMatches" ? 1 : 2;
      const profiles = [
        [0, 1, 2], [0, 2, 1], [1, 0, 2],
        [1, 2, 0], [2, 0, 1], [2, 1, 0],
      ];
      return profiles[strategy % profiles.length]![family]!;
    }
    if (difficultyLevel === 3) return kind === "matches" ? 1 : kind === "notMatches" ? 2 : 0;
    return kind === "matches" ? 3 : kind === "notMatches" ? 2 : kind === "sameRow" || kind === "distance" ? 0 : 1;
  };
  return eligibleCandidates.sort((left, right) => weight(left) - weight(right));
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
export function generatePuzzleAtDifficulty(template: PuzzleTemplate, seed: string, difficultyLevel: DifficultyLevel, solver: PuzzleSolver = exhaustivePuzzleSolver): GeneratedPuzzle {
  const observedLevels = new Set<DifficultyLevel>();
  for (let strategy = 0; strategy < 64; strategy += 1) {
    const candidate = generatePuzzle(template, seed, solver, { difficultyLevel, strategy });
    observedLevels.add(candidate.difficulty.level);
    if (candidate.difficulty.level === difficultyLevel) {
      return { ...candidate, requestedDifficultyLevel: difficultyLevel, generationStrategy: strategy };
    }
  }
  throw new DifficultyUnavailableError(template.id, seed, difficultyLevel, [...observedLevels].sort((left, right) => left - right));
}
