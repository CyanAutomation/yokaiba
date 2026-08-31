import type { Clue, Difficulty, DifficultyCalibration, PuzzleSpec } from "../domain/types.js";
import type { PuzzleSolver } from "../domain/puzzle-solver.js";
import { exhaustivePuzzleSolver, solveWithTelemetry } from "../constraints/solver.js";

const COST: Record<Clue["constraint"]["kind"], number> = { matches: 1, notMatches: 1, before: 3, adjacent: 3 };

export const DIFFICULTY_MODEL_VERSION = "yokaiba-difficulty-v2";
const defaultCalibration: DifficultyCalibration = {
  modelVersion: DIFFICULTY_MODEL_VERSION,
  scoreThresholds: [68, 73, 79, 88],
  corpus: { sampleSize: 1_000, methodology: "Seeded corpus scored with the no-guess trace and deterministic solver telemetry." },
};

/**
 * A stable initial rubric for the 4x4 template. Relational clues require more
 * mental bookkeeping than direct facts; negative clues and compact clue sets
 * add smaller penalties. The model version is returned to clients so future
 * calibration does not silently relabel an existing puzzle.
 */
export function assessPuzzleDifficulty(spec: PuzzleSpec, clues: readonly Clue[]): Difficulty {
  const calibration = spec.metadata?.difficultyCalibration ?? defaultCalibration;
  const humanSolve = directHumanSolve(spec, clues);
  const telemetry = solveWithTelemetry(spec, clues, 2).telemetry;
  // The score is intentionally deterministic: wall-clock duration varies by runtime,
  // while a no-guess trace and solver search work provide reproducible evidence.
  const score = humanSolve.totalCost * 2
    + humanSolve.hardestStep * 3
    + (humanSolve.solved ? 0 : 8)
    + Math.min(24, Math.floor(Math.log2(telemetry.nodesVisited + 1)) * 2)
    + Math.min(16, Math.floor(telemetry.constraintChecks / 8));
  const [levelOne, levelTwo, levelThree, levelFour] = calibration.scoreThresholds;
  const level: Difficulty["level"] = score <= levelOne ? 1 : score <= levelTwo ? 2 : score <= levelThree ? 3 : score <= levelFour ? 4 : 5;
  const labels: Record<Difficulty["level"], Difficulty["label"]> = {
    1: "Very easy", 2: "Easy", 3: "Moderate", 4: "Hard", 5: "Very hard",
  };
  return {
    level,
    label: labels[level],
    modelVersion: calibration.modelVersion,
    evidence: {
      score,
      humanSolve: { solved: humanSolve.solved, totalCost: humanSolve.totalCost, hardestStep: humanSolve.hardestStep },
      solver: { nodesVisited: telemetry.nodesVisited, constraintChecks: telemetry.constraintChecks },
    },
  };
}

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

export function evaluatePuzzleQuality(spec: PuzzleSpec, clues: readonly Clue[], solver: PuzzleSolver = exhaustivePuzzleSolver): PuzzleQuality {
  const unique = solver.countSolutions(spec, clues, 2) === 1;
  const redundantClueIds = clues.filter(clue => solver.countSolutions(spec, clues.filter(candidate => candidate.id !== clue.id), 2) === 1).map(clue => clue.id);
  const kinds = [...new Set(clues.map(clue => clue.constraint.kind))].sort();
  return {
    unique,
    redundantClueIds,
    clueDiversity: { distinctKinds: kinds.length, kinds },
    readability: { unreadableClueIds: clues.filter(clue => !clue.text.trim() || /\b(undefined|null)\b/i.test(clue.text)).map(clue => clue.id) },
    humanSolve: directHumanSolve(spec, clues),
  };
}
