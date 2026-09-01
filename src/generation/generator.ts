import type { Clue, GeneratedPuzzle, PuzzleTemplate, Solution } from "../domain/types.js";
import type { PuzzleSolver } from "../domain/puzzle-solver.js";
import { exhaustivePuzzleSolver } from "../constraints/solver.js";
import { assessPuzzleDifficulty } from "./quality.js";

export const GENERATOR_VERSION = "yokaiba-generator-v2";
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
  }
}

function makeSolution(template: PuzzleTemplate, next: () => number): Solution {
  return {
    assignments: Object.fromEntries(template.categories.filter(category => category.id !== template.baseCategory)
      .map(category => [category.id, shuffled(category.values, next)])),
  };
}

function directText(subject: string, categoryId: string, value: string) {
  if (categoryId === "weight") return `${subject} fought in the ${value} division.`;
  if (categoryId === "tatami") return `${subject} competed on ${value}.`;
  if (categoryId === "placing") return `${subject} finished ${value}.`;
  if (categoryId === "medal") return `${subject} earned ${value}.`;
  return `${subject}'s ${categoryId.replace(/([A-Z])/g, " $1").toLowerCase()} was ${value}.`;
}

function negativeText(subject: string, categoryId: string, value: string) {
  if (categoryId === "weight") return `${subject} did not fight in the ${value} division.`;
  if (categoryId === "tatami") return `${subject} was not scheduled on ${value}.`;
  if (categoryId === "placing") return `${subject} did not finish ${value}.`;
  if (categoryId === "medal") return `${subject} did not earn ${value}.`;
  return `${subject}'s ${categoryId.replace(/([A-Z])/g, " $1").toLowerCase()} was not ${value}.`;
}

function sameRowText(leftValue: string, rightCategoryId: string, rightValue: string) {
  if (rightCategoryId === "tatami") return `The ${leftValue} competitor fought on ${rightValue}.`;
  if (rightCategoryId === "medal") return `The ${leftValue} competitor earned ${rightValue}.`;
  if (rightCategoryId === "placing") return `The ${leftValue} competitor finished ${rightValue}.`;
  if (rightCategoryId === "weight") return `The competitor on ${leftValue} fought in the ${rightValue} division.`;
  return `The competitor with ${leftValue} had ${rightValue} for ${rightCategoryId.replace(/([A-Z])/g, " $1").toLowerCase()}.`;
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
        text: directText(subject, category.id, value),
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
        text: negativeText(base.values[row], category.id, value),
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
          text: `In the ${template.title.toLowerCase()}, ${left.value} came before ${right.value}.`,
        });
        if (rightRow === leftRow + 1) {
          candidates.push({
            id: `adjacent-${category.id}-${leftRow}-${rightRow}`,
            constraint: { kind: "adjacent", left, right },
          text: `${left.value} and ${right.value} were consecutive in the ${template.title.toLowerCase()}.`,
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
          text: sameRowText(left.value, rightCategory.id, right.value),
        });
        for (let otherRow = row + 1; otherRow < base.values.length; otherRow += 1) {
          const distance = otherRow - row;
          const distantRight = { category: rightCategory.id, value: rightAssignment[otherRow]! };
          candidates.push({
            id: `distance-${leftCategory.id}-${rightCategory.id}-${row}-${otherRow}`,
            constraint: { kind: "distance", left, right: distantRight, distance },
            text: `${left.value} and ${distantRight.value} were ${distance} ${distance === 1 ? "place" : "places"} apart.`,
          });
        }
      }
    }
  }
  return shuffled(candidates, next);
}

export interface GenerationOptions {
  difficultyLevel?: 1 | 2 | 3 | 4 | 5;
  /** Selects a deterministic clue strategy without changing the puzzle seed. */
  strategy?: number;
}

function prioritizeForDifficulty(candidates: readonly Clue[], difficultyLevel: GenerationOptions["difficultyLevel"], next: () => number) {
  const shuffledCandidates = shuffled(candidates, next);
  if (!difficultyLevel) return shuffledCandidates;
  const eligibleCandidates = difficultyLevel >= 4
    ? shuffledCandidates.filter(clue => clue.constraint.kind !== "matches")
    : shuffledCandidates;
  const weight = (clue: Clue) => {
    const kind = clue.constraint.kind;
    if (difficultyLevel <= 2) return kind === "matches" ? 0 : kind === "notMatches" ? 1 : 2;
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
    clues: selected,
    difficulty: assessPuzzleDifficulty(template, selected),
    solution,
  };
}

/**
 * Construct from one stable solution seed and explore deterministic clue-order
 * strategies. This targets difficulty without silently substituting a caller's
 * seed for a different puzzle identity.
 */
export function generatePuzzleAtDifficulty(template: PuzzleTemplate, seed: string, difficultyLevel: 1 | 2 | 3 | 4 | 5, solver: PuzzleSolver = exhaustivePuzzleSolver): GeneratedPuzzle {
  for (let strategy = 0; strategy < 64; strategy += 1) {
    const candidate = generatePuzzle(template, seed, solver, { difficultyLevel, strategy });
    if (candidate.difficulty.level === difficultyLevel) {
      return { ...candidate, requestedDifficultyLevel: difficultyLevel, generationStrategy: strategy };
    }
  }
  // Some small boards have no subset in a requested score band for one fixed
  // solution. Preserve the caller's identity while using the historical seed
  // search only as a bounded compatibility fallback.
  for (let attempt = 0; attempt < 128; attempt += 1) {
    const candidateSeed = `${seed}:difficulty:${difficultyLevel}:${attempt}`;
    const candidate = generatePuzzle(template, candidateSeed, solver);
    if (candidate.difficulty.level === difficultyLevel) {
      return { ...candidate, requestedSeed: seed, requestedDifficultyLevel: difficultyLevel, generationStrategy: attempt };
    }
  }
  throw new Error("requested difficulty is unavailable");
}
