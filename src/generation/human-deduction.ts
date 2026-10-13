import type { Clue, PuzzleSpec } from "../domain/types.js";
import { propagateAllDifferent } from "./all-different.js";
import { applyDeduction, createDeductionPossibilities, deductionCost } from "./human-deduction-rules.js";

export interface HumanDeductionTrace {
  solved: boolean;
  usedGuessing: false;
  totalCost: number;
  hardestStep: number;
  deductionPasses: number;
}

/** A no-guess human model using direct, all-different, ordering, and adjacency elimination. */
export function evaluateHumanDeductionTrace(spec: PuzzleSpec, clues: readonly Clue[]): HumanDeductionTrace {
  const { baseValues, possible } = createDeductionPossibilities(spec);
  const totalCost = clues.reduce((total, clue) => total + deductionCost(clue), 0);
  const hardestStep = clues.reduce((hardest, clue) => Math.max(hardest, deductionCost(clue)), 0);

  let changed = true;
  let deductionPasses = 0;
  while (changed) {
    deductionPasses += 1;
    changed = false;
    for (const clue of clues) changed = applyDeduction(clue, spec, baseValues, possible) || changed;
    changed = propagateAllDifferent(possible) || changed;
  }
  return { solved: [...possible.values()].every(cells => cells.every(cell => cell.size === 1)), usedGuessing: false, totalCost, hardestStep, deductionPasses };
}
