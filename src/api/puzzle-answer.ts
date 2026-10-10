import type { GeneratedPuzzle, Solution } from "../domain/types.js";
import { validatePuzzleAnswer } from "./puzzle-answer-validation.js";

function sameSolution(left: Solution, right: Solution): boolean {
  const categories = Object.keys(left.assignments);
  return categories.length === Object.keys(right.assignments).length && categories.every(category =>
    left.assignments[category].length === right.assignments[category]?.length
      && left.assignments[category].every((value, index) => value === right.assignments[category][index]));
}

export function verifyPuzzleAnswer(puzzle: GeneratedPuzzle, answer: unknown): boolean {
  return sameSolution(puzzle.solution, validatePuzzleAnswer(puzzle.spec, answer));
}
