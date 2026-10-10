import type { Clue, Difficulty, DifficultyCalibration, DifficultyLevel, PuzzleSpec } from "../domain/types.js";
import { solveWithTelemetry } from "../constraints/solver.js";
import { evaluateHumanDeductionTrace } from "./human-deduction.js";

export const DIFFICULTY_MODEL_VERSION = "yokaiba-difficulty-v4";

const defaultCalibration: DifficultyCalibration = {
  modelVersion: DIFFICULTY_MODEL_VERSION,
  scoreThresholds: [68, 73, 79, 88, 98, 108, 118, 128, 138, 148, 158],
  levelRange: [1, 12],
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
  const humanSolve = evaluateHumanDeductionTrace(spec, clues);
  const telemetry = solveWithTelemetry(spec, clues, 2).telemetry;
  const directClues = clues.filter(clue => clue.constraint.kind === "matches" || clue.constraint.kind === "notMatches").length;
  const relationalClues = clues.length - directClues;
  const crossCategoryClues = clues.filter(clue => "left" in clue.constraint && clue.constraint.left.category !== clue.constraint.right.category).length;
  const score = humanSolve.totalCost * 2
    + humanSolve.hardestStep * 3
    + (humanSolve.solved ? 0 : 8)
    + relationalClues * 2
    + crossCategoryClues * 3
    + Math.min(10, humanSolve.deductionPasses)
    + Math.min(24, Math.floor(Math.log2(telemetry.nodesVisited + 1)) * 2)
    + Math.min(16, Math.floor(telemetry.constraintChecks / 8));
  const [minimumLevel, maximumLevel] = calibration.levelRange;
  if (minimumLevel > maximumLevel || calibration.scoreThresholds.length !== maximumLevel - minimumLevel) throw new Error("difficulty calibration thresholds must cover its level range");
  const offset = calibration.scoreThresholds.findIndex(threshold => score <= threshold);
  const level = (offset < 0 ? maximumLevel : minimumLevel + offset) as DifficultyLevel;
  const labels: Record<DifficultyLevel, string> = {
    1: "Very easy", 2: "Easy", 3: "Gentle", 4: "Comfortable", 5: "Moderate", 6: "Challenging",
    7: "Tricky", 8: "Hard", 9: "Very hard", 10: "Expert", 11: "Master", 12: "Extreme",
  };
  return {
    level,
    label: labels[level],
    modelVersion: calibration.modelVersion,
    evidence: {
      score,
      humanSolve: { solved: humanSolve.solved, totalCost: humanSolve.totalCost, hardestStep: humanSolve.hardestStep, deductionPasses: humanSolve.deductionPasses },
      clueStructure: { directClues, relationalClues, crossCategoryClues },
      solver: { nodesVisited: telemetry.nodesVisited, constraintChecks: telemetry.constraintChecks },
    },
  };
}
