import type { Clue, Difficulty, DifficultyCalibration, DifficultyLevel, PuzzleSpec } from "../domain/types.js";
import { exhaustivePuzzleSolver, solveWithTelemetry, type SolverTelemetry } from "../constraints/solver.js";
import { evaluateHumanDeductionTrace } from "./human-deduction.js";
import { evaluateHumanDeductionTraceV5 } from "./human-deduction-v5.js";
import {
  DIFFICULTY_BANDS_V5,
  DIFFICULTY_MODEL_V5,
  DIFFICULTY_PROFILE_VERSION,
  JEV_REQUESTED_MODEL,
  JEV_SEMANTIC_SCHEMA_VERSION,
  type DifficultyAssessmentV5,
  type DifficultyProfileV1,
} from "./difficulty-profile.js";

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
export function assessPuzzleDifficulty(spec: PuzzleSpec, clues: readonly Clue[], suppliedTelemetry?: SolverTelemetry): Difficulty {
  const calibration = spec.metadata?.difficultyCalibration ?? defaultCalibration;
  const humanSolve = evaluateHumanDeductionTrace(spec, clues);
  const telemetry = suppliedTelemetry ?? solveWithTelemetry(spec, clues, 2).telemetry;
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

const LABELS: Record<DifficultyLevel, string> = {
  1: "Very easy", 2: "Easy", 3: "Gentle", 4: "Comfortable", 5: "Moderate", 6: "Challenging",
  7: "Tricky", 8: "Hard", 9: "Very hard", 10: "Expert", 11: "Master", 12: "Extreme",
};

const clamp100 = (value: number) => Math.max(0, Math.min(100, value));
const round = (value: number) => Math.round(clamp100(value));

export function assessPuzzleDifficultyV5(
  spec: PuzzleSpec,
  clues: readonly Clue[],
  trace = evaluateHumanDeductionTraceV5(spec, clues),
  telemetry = solveWithTelemetry(spec, clues, 2).telemetry,
): DifficultyAssessmentV5 {
  const steps = trace.steps;
  const depthValues = steps.map(step => step.dependencyDepth);
  const maximumDepth = trace.maximumDependencyDepth;
  const meanDepth = depthValues.length === 0 ? 0 : depthValues.reduce((sum, depth) => sum + depth, 0) / depthValues.length;
  const sortedDepths = [...depthValues].sort((left, right) => left - right);
  const p75Depth = sortedDepths.length === 0 ? 0 : sortedDepths[Math.ceil(sortedDepths.length * 0.75) - 1]!;
  const depthHistogram = Array.from({ length: maximumDepth + 1 }, (_value, depth) => depthValues.filter(item => item === depth).length);
  const reasoningDependencyDepth = {
    score: round(70 * Math.min(1, maximumDepth / 8) + 30 * Math.min(1, meanDepth / 4)),
    direction: "higher_is_harder" as const,
    raw: { maximum: maximumDepth, mean: Number(meanDepth.toFixed(3)), p75: p75Depth, distribution: depthHistogram },
    interpretation: "Maximum dependency chain contributes 70%; mean deduction depth contributes 30%. Depth counts prerequisite inference steps, never propagation loops.",
  };

  const costs = steps.map(step => step.estimatedCognitiveCost);
  const meanCost = costs.length === 0 ? 0 : costs.reduce((sum, cost) => sum + cost, 0) / costs.length;
  const maximumCost = costs.length === 0 ? 0 : Math.max(...costs);
  const deductionComplexity = {
    score: round((Math.max(0, meanCost - 1) / 4) * 50 + (Math.max(0, maximumCost - 1) / 4) * 50),
    direction: "higher_is_harder" as const,
    raw: { meanEstimatedCost: Number(meanCost.toFixed(3)), maximumEstimatedCost: maximumCost, deductionCount: steps.length },
    interpretation: "Mean and highest required strategy cost are equally weighted on the provisional 1–5 cognitive-cost scale.",
  };

  const rowCount = spec.categories.find(category => category.id === spec.baseCategory)?.values.length ?? 1;
  const relevantAlternativeCounts = steps.map(step => step.workingMemoryDemand);
  const meanAlternatives = relevantAlternativeCounts.length === 0 ? 0 : relevantAlternativeCounts.reduce((sum, count) => sum + count, 0) / relevantAlternativeCounts.length;
  const peakAlternatives = relevantAlternativeCounts.length === 0 ? 0 : Math.max(...relevantAlternativeCounts);
  const normalizedAlternativeCapacity = Math.max(1, rowCount * rowCount * Math.min(4, Math.max(1, spec.categories.length - 1)));
  const workingMemoryDemand = {
    score: round(100 * meanAlternatives / normalizedAlternativeCapacity),
    direction: "higher_is_harder" as const,
    raw: { meanRelevantAlternatives: Number(meanAlternatives.toFixed(3)), peakRelevantAlternatives: peakAlternatives, normalizedCapacity: normalizedAlternativeCapacity },
    interpretation: "Mean unresolved candidates across clue categories and inherited prerequisite categories, divided by a template-size capacity. Solver memory use is not used.",
  };

  const crossCount = trace.crossCategorySteps;
  const crossCategoryReasoning = {
    score: round(100 * crossCount / Math.max(1, steps.length)),
    direction: "higher_is_harder" as const,
    raw: { crossCategoryDeductions: crossCount, totalDeductions: steps.length },
    interpretation: "Share of productive deductions whose clue or dependency chain spans more than one non-base category.",
  };

  const accessibleCount = steps.filter(step => step.dependencyDepth === 0
    && (step.rule === "direct-fact" || step.rule === "simple-elimination" || step.rule === "single-candidate")).length;
  const startingAccessibility = {
    score: round(100 * Math.min(1, accessibleCount / 3)),
    direction: "higher_is_easier" as const,
    raw: { productiveStartingDeductions: accessibleCount, saturationCount: 3 },
    interpretation: "Three independent deductions with no prerequisites saturate accessibility; dependent deductions do not count as starting moves.",
  };

  const automaticCascadeBehaviour = {
    score: round(100 * trace.automaticPropagationSteps / Math.max(1, steps.length)),
    direction: "higher_is_easier" as const,
    raw: { propagationSources: trace.automaticPropagationSteps, totalDeductions: steps.length },
    interpretation: "Share of deductions that became prerequisites for later propagation. This measures cascade flow, not loop count.",
  };

  const nodeWork = Math.log2(telemetry.nodesVisited + 1);
  const checkWork = Math.log2(telemetry.constraintChecks + 1);
  const residualLogicalComplexity = {
    score: round(50 * Math.min(1, nodeWork / 18) + 50 * Math.min(1, checkWork / 22)),
    direction: "higher_is_harder" as const,
    raw: { nodesVisited: telemetry.nodesVisited, constraintChecks: telemetry.constraintChecks },
    interpretation: "Bounded logarithmic solver-work signal; the metric is reported independently and contributes 5% to the final score.",
  };

  // The listed weights total 100%. Easier starts and larger cascades are
  // inverted so every term in the final score points toward greater difficulty.
  const score = round(
    reasoningDependencyDepth.score * 0.25
    + deductionComplexity.score * 0.20
    + workingMemoryDemand.score * 0.15
    + crossCategoryReasoning.score * 0.15
    + (100 - startingAccessibility.score) * 0.10
    + (100 - automaticCascadeBehaviour.score) * 0.10
    + residualLogicalComplexity.score * 0.05,
  );
  const selectedBand = DIFFICULTY_BANDS_V5.find(band => score >= band.minimumScore && score <= band.maximumScore);
  const band = selectedBand ?? DIFFICULTY_BANDS_V5[0]!;
  return {
    modelVersion: DIFFICULTY_MODEL_V5,
    score,
    level: band.level,
    inDifficultyBand: selectedBand !== undefined,
    band: { minimumScore: band.minimumScore, maximumScore: band.maximumScore },
    status: trace.status === "solved" ? "complete" : trace.status === "stalled" ? "incomplete" : "contradiction",
    metrics: {
      reasoningDependencyDepth,
      deductionComplexity,
      workingMemoryDemand,
      crossCategoryReasoning,
      startingAccessibility,
      automaticCascadeBehaviour,
      residualLogicalComplexity,
    },
    trace,
  };
}

/** Add a v4/v5 comparison profile for audits or explicit opt-in generation. */
export function assessDifficultyProfileV5(spec: PuzzleSpec, clues: readonly Clue[]): DifficultyProfileV1 {
  const trace = evaluateHumanDeductionTraceV5(spec, clues);
  const telemetry = solveWithTelemetry(spec, clues, 2).telemetry;
  const legacy = assessPuzzleDifficulty(spec, clues, telemetry);
  const logical = assessPuzzleDifficultyV5(spec, clues, trace, telemetry);
  return {
    profileVersion: DIFFICULTY_PROFILE_VERSION,
    logical,
    legacy,
    semantic: {
      schemaVersion: JEV_SEMANTIC_SCHEMA_VERSION,
      model: JEV_REQUESTED_MODEL,
      resolvedModel: null,
      status: "not_assessed",
      metrics: {},
      reviewFlags: [],
    },
    calibrationStatus: "provisional",
  };
}

export function difficultyForV5(profile: DifficultyProfileV1): Difficulty {
  const assessment = profile.logical;
  return {
    level: assessment.level,
    label: LABELS[assessment.level],
    modelVersion: DIFFICULTY_MODEL_V5,
    evidence: {
      score: assessment.score,
      humanSolve: {
        solved: assessment.trace.solved,
        totalCost: assessment.trace.steps.reduce((sum, step) => sum + step.estimatedCognitiveCost, 0),
        hardestStep: assessment.trace.steps.reduce((highest, step) => Math.max(highest, step.estimatedCognitiveCost), 0),
        // The legacy field remains for clients; v5 consumers should use the
        // explicitly named trace length and dependency-depth metrics.
        deductionPasses: assessment.trace.steps.length,
      },
      clueStructure: profile.legacy.evidence.clueStructure,
      solver: profile.legacy.evidence.solver,
    },
  };
}

export function withDifficultyProfile(spec: PuzzleSpec, clues: readonly Clue[]): { profile: DifficultyProfileV1; v5Difficulty: Difficulty } {
  const profile = assessDifficultyProfileV5(spec, clues);
  // `difficulty` keeps the legacy evidence shape while selection is gated by
  // the v5 logical assessment. Detailed v5 metrics and trace remain alongside it.
  return { profile, v5Difficulty: difficultyForV5(profile) };
}
