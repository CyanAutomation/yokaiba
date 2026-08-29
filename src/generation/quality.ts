import type { Clue, PuzzleSpec } from "../domain/types.js";
import { countSolutions } from "../constraints/solver.js";

const COST: Record<Clue["constraint"]["kind"], number> = { matches: 1, notMatches: 1, before: 3, adjacent: 3 };

export interface PuzzleQuality {
  unique: boolean;
  redundantClueIds: string[];
  clueDiversity: { distinctKinds: number; kinds: string[] };
  readability: { unreadableClueIds: string[] };
  humanSolve: { solved: boolean; usedGuessing: false; totalCost: number; hardestStep: number };
}

/** A no-guess human model using direct, all-different, ordering, and adjacency elimination. */
function directHumanSolve(spec: PuzzleSpec, clues: readonly Clue[]) {
  const base = spec.categories.find(category => category.id === spec.baseCategory)!;
  const possible = new Map<string, Array<Set<string>>>();
  for (const category of spec.categories) if (category.id !== spec.baseCategory) possible.set(category.id, base.values.map(() => new Set(category.values)));
  const totalCost = clues.reduce((total, clue) => total + COST[clue.constraint.kind], 0);
  const hardestStep = clues.reduce((hardest, clue) => Math.max(hardest, COST[clue.constraint.kind]), 0);

  const termRows = (categoryId: string, value: string) => {
    if (categoryId === spec.baseCategory) {
      const row = base.values.indexOf(value);
      return row < 0 ? [] : [row];
    }
    const cells = possible.get(categoryId);
    if (!cells) return [];
    return cells.flatMap((cell, row) => cell.has(value) ? [row] : []);
  };
  const removeTermRows = (categoryId: string, value: string, disallowedRows: Set<number>) => {
    if (categoryId === spec.baseCategory) return false;
    const cells = possible.get(categoryId)!;
    let changed = false;
    for (const row of disallowedRows) changed = cells[row].delete(value) || changed;
    return changed;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const clue of clues) {
      const constraint = clue.constraint;
      if (constraint.kind === "matches" || constraint.kind === "notMatches") {
        const row = base.values.indexOf(constraint.subject);
        const cells = possible.get(constraint.category)!;
        if (constraint.kind === "matches" && (cells[row].size !== 1 || !cells[row].has(constraint.value))) {
          cells[row] = new Set([constraint.value]);
          changed = true;
        }
        if (constraint.kind === "notMatches") changed = cells[row].delete(constraint.value) || changed;
        continue;
      }
      const leftRows = termRows(constraint.left.category, constraint.left.value);
      const rightRows = termRows(constraint.right.category, constraint.right.value);
      const satisfies = constraint.kind === "before"
        ? (left: number, right: number) => left < right
        : (left: number, right: number) => Math.abs(left - right) === 1;
      changed = removeTermRows(constraint.left.category, constraint.left.value,
        new Set(leftRows.filter(left => !rightRows.some(right => satisfies(left, right))))) || changed;
      changed = removeTermRows(constraint.right.category, constraint.right.value,
        new Set(rightRows.filter(right => !leftRows.some(left => satisfies(left, right))))) || changed;
    }
    for (const cells of possible.values()) {
      const assigned = new Set(cells.filter(cell => cell.size === 1).map(cell => [...cell][0]));
      for (const cell of cells) if (cell.size > 1) for (const value of assigned) changed = cell.delete(value) || changed;
      for (const value of base.values.map((_baseValue, row) => [...cells[row]]).flat()) {
        const possibleRows = cells.flatMap((cell, row) => cell.has(value) ? [row] : []);
        if (possibleRows.length === 1 && cells[possibleRows[0]].size > 1) {
          cells[possibleRows[0]] = new Set([value]);
          changed = true;
        }
      }
    }
  }
  return { solved: [...possible.values()].every(cells => cells.every(cell => cell.size === 1)), usedGuessing: false as const, totalCost, hardestStep };
}

export function evaluatePuzzleQuality(spec: PuzzleSpec, clues: readonly Clue[]): PuzzleQuality {
  const unique = countSolutions(spec, clues, 2) === 1;
  const redundantClueIds = clues.filter(clue => countSolutions(spec, clues.filter(candidate => candidate.id !== clue.id), 2) === 1).map(clue => clue.id);
  const kinds = [...new Set(clues.map(clue => clue.constraint.kind))].sort();
  return {
    unique,
    redundantClueIds,
    clueDiversity: { distinctKinds: kinds.length, kinds },
    readability: { unreadableClueIds: clues.filter(clue => !clue.text.trim() || /\b(undefined|null)\b/i.test(clue.text)).map(clue => clue.id) },
    humanSolve: directHumanSolve(spec, clues),
  };
}
