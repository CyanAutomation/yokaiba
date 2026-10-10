import type { Clue, PuzzleSpec } from "../domain/types.js";
import type { PuzzleSolver } from "../domain/puzzle-solver.js";
import { exhaustivePuzzleSolver } from "../constraints/solver.js";
import type { HumanDeductionTrace } from "./human-deduction.js";
import { evaluateHumanDeductionTrace } from "./human-deduction.js";

export { assessPuzzleDifficulty, DIFFICULTY_MODEL_VERSION } from "./difficulty-assessment.js";
export { evaluateHumanDeductionTrace } from "./human-deduction.js";

export interface PuzzleQuality {
  unique: boolean;
  redundantClueIds: string[];
  clueDiversity: { distinctKinds: number; kinds: string[] };
  readability: { unreadableClueIds: string[] };
  humanSolve: HumanDeductionTrace;
}

/** Whether rendered clue prose is present and contains no unresolved placeholders. */
export function isClueTextReadable(text: string): boolean {
  return Boolean(text.trim()) && !/\b(undefined|null)\b/i.test(text);
}

export function evaluatePuzzleQuality(spec: PuzzleSpec, clues: readonly Clue[], solver: PuzzleSolver = exhaustivePuzzleSolver): PuzzleQuality {
  const unique = solver.countSolutions(spec, clues, 2) === 1;
  const redundantClueIds = clues.filter(clue => solver.countSolutions(spec, clues.filter(candidate => candidate.id !== clue.id), 2) === 1).map(clue => clue.id);
  const kinds = [...new Set(clues.map(clue => clue.constraint.kind))].sort();
  return {
    unique,
    redundantClueIds,
    clueDiversity: { distinctKinds: kinds.length, kinds },
    readability: { unreadableClueIds: clues.filter(clue => !isClueTextReadable(clue.text)).map(clue => clue.id) },
    humanSolve: evaluateHumanDeductionTrace(spec, clues),
  };
}
