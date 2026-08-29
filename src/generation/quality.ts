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

/** A no-guess first-pass human model: direct assignment plus one-value-left elimination. */
function directHumanSolve(spec: PuzzleSpec, clues: readonly Clue[]) {
  const base = spec.categories.find(category => category.id === spec.baseCategory)!;
  const possible = new Map<string, Array<Set<string>>>();
  for (const category of spec.categories) if (category.id !== spec.baseCategory) possible.set(category.id, base.values.map(() => new Set(category.values)));
  let totalCost = 0;
  let hardestStep = 0;
  for (const clue of clues) {
    if (clue.constraint.kind === "matches" || clue.constraint.kind === "notMatches") {
      const row = base.values.indexOf(clue.constraint.subject);
      const cells = possible.get(clue.constraint.category)!;
      if (clue.constraint.kind === "matches") { cells[row] = new Set([clue.constraint.value]); }
      else cells[row].delete(clue.constraint.value);
      totalCost += COST[clue.constraint.kind]; hardestStep = Math.max(hardestStep, COST[clue.constraint.kind]);
    }
  }
  for (const cells of possible.values()) {
    let changed = true;
    while (changed) {
      changed = false;
      const assigned = new Set(cells.filter(cell => cell.size === 1).map(cell => [...cell][0]));
      for (const cell of cells) if (cell.size > 1) for (const value of assigned) changed = cell.delete(value) || changed;
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
