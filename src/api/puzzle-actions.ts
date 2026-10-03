import { DifficultyUnavailableError, generatePuzzleForRequest } from "../generation/generator.js";
import type { GeneratedPuzzle, PuzzleSpec, PuzzleTemplate, Solution } from "../domain/types.js";
import { verifyPuzzleToken } from "./puzzle-token.js";

export type HintKind = "clue" | "elimination" | "placement";

export type PuzzleHint =
  | { kind: "clue" | "elimination"; clue: { id: string; text: string } }
  | { kind: "placement"; placement: { subject: string; category: string; value: string } };

export class PuzzleActionError extends TypeError {
  readonly code: "invalid_puzzle_token" | "unsupported_puzzle_version";

  constructor(code: PuzzleActionError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

/** v3-v5 preserve puzzle-solution semantics for tokens issued by older releases. */
function supportsTokenGeneratorVersion(tokenVersion: string, generatedVersion: string) {
  return tokenVersion === generatedVersion || (
    ["yokaiba-generator-v2", "yokaiba-generator-v3", "yokaiba-generator-v4"].includes(tokenVersion)
    && ["yokaiba-generator-v3", "yokaiba-generator-v4", "yokaiba-generator-v5"].includes(generatedVersion)
  );
}

export async function puzzleFromToken(puzzleToken: string, templates: Map<string, PuzzleTemplate>, secret: string): Promise<GeneratedPuzzle> {
  const token = await verifyPuzzleToken(puzzleToken, secret);
  if (!token) throw new PuzzleActionError("invalid_puzzle_token", "puzzleToken is invalid");
  const template = templates.get(token.templateId);
  if (!template) throw new PuzzleActionError("invalid_puzzle_token", "puzzleToken references an unknown template");
  let puzzle: GeneratedPuzzle;
  try {
    puzzle = generatePuzzleForRequest(template, token.seed, token.requestedDifficultyLevel);
  } catch (error) {
    if (error instanceof DifficultyUnavailableError) {
      throw new PuzzleActionError("unsupported_puzzle_version", "puzzleToken references an unsupported puzzle version");
    }
    throw error;
  }
  if (!supportsTokenGeneratorVersion(token.generatorVersion, puzzle.generatorVersion) || puzzle.solverVersion !== token.solverVersion) {
    throw new PuzzleActionError("unsupported_puzzle_version", "puzzleToken references an unsupported puzzle version");
  }
  return puzzle;
}

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

function validateAnswer(spec: PuzzleSpec, value: unknown): Solution {
  const answer = objectRecord(value, "answer must be an object");
  const unknown = Object.keys(answer).find(name => name !== "assignments");
  if (unknown !== undefined) throw new TypeError(`unknown field answer.${unknown}`);
  return { assignments: validateAnswerAssignments(spec, answer.assignments) };
}

function sameSolution(left: Solution, right: Solution): boolean {
  const categories = Object.keys(left.assignments);
  return categories.length === Object.keys(right.assignments).length && categories.every(category =>
    left.assignments[category].length === right.assignments[category]?.length
      && left.assignments[category].every((value, index) => value === right.assignments[category][index]));
}

export function verifyPuzzleAnswer(puzzle: GeneratedPuzzle, answer: unknown): boolean {
  return sameSolution(puzzle.solution, validateAnswer(puzzle.spec, answer));
}

function placementHint(puzzle: GeneratedPuzzle, hintIndex: number): PuzzleHint {
  const baseCategory = puzzle.spec.categories.find(candidate => candidate.id === puzzle.spec.baseCategory)!;
  const categories = puzzle.spec.categories.filter(candidate => candidate.id !== puzzle.spec.baseCategory);
  if (categories.length === 0) throw new Error("No non-base categories available for placement hints");
  const totalCells = baseCategory.values.length * categories.length;
  const cellIndex = hintIndex % totalCells;
  const subjectIndex = Math.floor(cellIndex / categories.length);
  const category = categories[cellIndex % categories.length]!;
  return {
    kind: "placement",
    placement: {
      subject: baseCategory.values[subjectIndex]!,
      category: category.id,
      value: puzzle.solution.assignments[category.id][subjectIndex]!,
    },
  };
}

function clueHint(puzzle: GeneratedPuzzle, kind: Exclude<HintKind, "placement">, hintIndex: number): PuzzleHint {
  const candidates = kind === "elimination"
    ? puzzle.clues.filter(candidate => candidate.constraint.kind === "notMatches")
    : puzzle.clues;
  const pool = candidates.length > 0 ? candidates : puzzle.clues;
  if (pool.length === 0) throw new Error("No clues available for hints");
  const clue = pool[hintIndex % pool.length]!;
  return { kind: kind === "elimination" && clue.constraint.kind === "notMatches" ? "elimination" : "clue", clue: { id: clue.id, text: clue.text } };
}

/** Return a deterministic hint at the caller's current hint index; indices wrap when a hint pool is exhausted. */
export function puzzleHint(puzzle: GeneratedPuzzle, kind: HintKind = "clue", hintIndex = 0): PuzzleHint {
  return kind === "placement" ? placementHint(puzzle, hintIndex) : clueHint(puzzle, kind, hintIndex);
}
