import type { Clue, PuzzleSpec } from "../domain/types.js";
import { propagateAllDifferent } from "./all-different.js";

export interface HumanDeductionTrace {
  solved: boolean;
  usedGuessing: false;
  totalCost: number;
  hardestStep: number;
  deductionPasses: number;
}

/** Per-clue deduction costs calibrated for the difficulty trace. */
const COST: Record<Clue["constraint"]["kind"], number> = { matches: 1, notMatches: 1, before: 3, adjacent: 3, sameRow: 3, distance: 4 };

type DirectConstraint = Extract<Clue["constraint"], { kind: "matches" | "notMatches" }>;
type RelationalConstraint = Exclude<Clue["constraint"], DirectConstraint>;
type PossibleRows = Map<string, Array<Set<string>>>;

function applyDirectConstraint(constraint: DirectConstraint, baseValues: readonly string[], possible: PossibleRows): boolean {
  const row = baseValues.indexOf(constraint.subject);
  const cells = possible.get(constraint.category)!;
  if (constraint.kind === "matches") {
    if (cells[row].size === 1 && cells[row].has(constraint.value)) return false;
    cells[row] = new Set([constraint.value]);
    return true;
  }
  return cells[row].delete(constraint.value);
}

function rowsForTerm(categoryId: string, value: string, baseCategory: string, baseValues: readonly string[], possible: PossibleRows): number[] {
  if (categoryId === baseCategory) {
    const row = baseValues.indexOf(value);
    return row < 0 ? [] : [row];
  }
  const cells = possible.get(categoryId);
  if (!cells) return [];
  return cells.flatMap((cell, row) => cell.has(value) ? [row] : []);
}

function removeTermFromRows(categoryId: string, value: string, disallowedRows: Set<number>, baseCategory: string, possible: PossibleRows): boolean {
  if (categoryId === baseCategory) return false;
  const cells = possible.get(categoryId)!;
  let changed = false;
  for (const row of disallowedRows) changed = cells[row].delete(value) || changed;
  return changed;
}

function satisfiesRelationship(constraint: RelationalConstraint, left: number, right: number): boolean {
  switch (constraint.kind) {
    case "before": return left < right;
    case "sameRow": return left === right;
    case "distance": return Math.abs(left - right) === constraint.distance;
    case "adjacent": return Math.abs(left - right) === 1;
  }
}

function applyRelationalConstraint(constraint: RelationalConstraint, baseCategory: string, baseValues: readonly string[], possible: PossibleRows): boolean {
  const leftRows = rowsForTerm(constraint.left.category, constraint.left.value, baseCategory, baseValues, possible);
  const rightRows = rowsForTerm(constraint.right.category, constraint.right.value, baseCategory, baseValues, possible);
  const satisfies = (left: number, right: number) => satisfiesRelationship(constraint, left, right);
  const leftDisallowed = new Set(leftRows.filter(left => !rightRows.some(right => satisfies(left, right))));
  const rightDisallowed = new Set(rightRows.filter(right => !leftRows.some(left => satisfies(left, right))));
  const leftChanged = removeTermFromRows(constraint.left.category, constraint.left.value, leftDisallowed, baseCategory, possible);
  const rightChanged = removeTermFromRows(constraint.right.category, constraint.right.value, rightDisallowed, baseCategory, possible);
  return leftChanged || rightChanged;
}

function applyDeduction(clue: Clue, spec: PuzzleSpec, baseValues: readonly string[], possible: PossibleRows): boolean {
  const constraint = clue.constraint;
  if (constraint.kind === "matches" || constraint.kind === "notMatches") return applyDirectConstraint(constraint, baseValues, possible);
  return applyRelationalConstraint(constraint, spec.baseCategory, baseValues, possible);
}

/** A no-guess human model using direct, all-different, ordering, and adjacency elimination. */
export function evaluateHumanDeductionTrace(spec: PuzzleSpec, clues: readonly Clue[]): HumanDeductionTrace {
  const base = spec.categories.find(category => category.id === spec.baseCategory)!;
  const possible: PossibleRows = new Map();
  for (const category of spec.categories) if (category.id !== spec.baseCategory) possible.set(category.id, base.values.map(() => new Set(category.values)));
  const totalCost = clues.reduce((total, clue) => total + COST[clue.constraint.kind], 0);
  const hardestStep = clues.reduce((hardest, clue) => Math.max(hardest, COST[clue.constraint.kind]), 0);

  let changed = true;
  let deductionPasses = 0;
  while (changed) {
    deductionPasses += 1;
    changed = false;
    for (const clue of clues) changed = applyDeduction(clue, spec, base.values, possible) || changed;
    changed = propagateAllDifferent(possible) || changed;
  }
  return { solved: [...possible.values()].every(cells => cells.every(cell => cell.size === 1)), usedGuessing: false, totalCost, hardestStep, deductionPasses };
}
