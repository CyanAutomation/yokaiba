import type { Difficulty, GeneratedPuzzle } from "../domain/types.js";
import type { DifficultyUnavailableError } from "../generation/generator.js";
import type { DifficultyAssessmentV5, DifficultyMetricV5, DifficultyProfileV1 } from "../generation/difficulty-profile.js";
import type { HumanDeductionTraceV5 } from "../generation/human-deduction-v5.js";

export type PublicDifficultyTrace = Pick<
  HumanDeductionTraceV5,
  | "solved"
  | "usedGuessing"
  | "status"
  | "maximumDependencyDepth"
  | "startingDeductions"
  | "automaticPropagationSteps"
  | "crossCategorySteps"
>;

export type PublicDifficultyProfile = Omit<DifficultyProfileV1, "logical"> & {
  logical: Omit<DifficultyAssessmentV5, "trace"> & { trace: PublicDifficultyTrace };
};

export type PublicGeneratedPuzzle = Omit<GeneratedPuzzle, "solution" | "difficultyProfile"> & {
  difficultyProfile?: PublicDifficultyProfile;
};

function publicMetric(metric: DifficultyMetricV5): DifficultyMetricV5 {
  return {
    score: metric.score,
    direction: metric.direction,
    raw: metric.raw,
    interpretation: metric.interpretation,
  };
}

function publicLegacyDifficulty(difficulty: Difficulty): Difficulty {
  return {
    level: difficulty.level,
    label: difficulty.label,
    modelVersion: difficulty.modelVersion,
    evidence: {
      score: difficulty.evidence.score,
      humanSolve: {
        solved: difficulty.evidence.humanSolve.solved,
        totalCost: difficulty.evidence.humanSolve.totalCost,
        hardestStep: difficulty.evidence.humanSolve.hardestStep,
        deductionPasses: difficulty.evidence.humanSolve.deductionPasses,
      },
      clueStructure: {
        directClues: difficulty.evidence.clueStructure.directClues,
        relationalClues: difficulty.evidence.clueStructure.relationalClues,
        crossCategoryClues: difficulty.evidence.clueStructure.crossCategoryClues,
      },
      solver: {
        nodesVisited: difficulty.evidence.solver.nodesVisited,
        constraintChecks: difficulty.evidence.solver.constraintChecks,
      },
    },
  };
}

type GeneratedSelectionDiagnostics = NonNullable<GeneratedPuzzle["selectionDiagnostics"]>;
type UnavailableSelectionDiagnostics = NonNullable<DifficultyUnavailableError["diagnostics"]>;

export function publicSelectionDiagnostics(diagnostics: GeneratedSelectionDiagnostics): GeneratedSelectionDiagnostics;
export function publicSelectionDiagnostics(diagnostics: UnavailableSelectionDiagnostics): UnavailableSelectionDiagnostics;
export function publicSelectionDiagnostics(
  diagnostics: GeneratedSelectionDiagnostics | UnavailableSelectionDiagnostics,
): GeneratedSelectionDiagnostics | UnavailableSelectionDiagnostics {
  const common = {
    modelVersion: diagnostics.modelVersion,
    strategiesAttempted: diagnostics.strategiesAttempted,
    eligibleCandidates: diagnostics.eligibleCandidates,
    ...(diagnostics.candidateScoreRange ? {
      candidateScoreRange: {
        minimum: diagnostics.candidateScoreRange.minimum,
        maximum: diagnostics.candidateScoreRange.maximum,
        complete: diagnostics.candidateScoreRange.complete,
        incomplete: diagnostics.candidateScoreRange.incomplete,
      },
    } : {}),
  };

  if ("strategyBudget" in diagnostics) {
    return {
      ...common,
      strategyBudget: diagnostics.strategyBudget,
      ...(diagnostics.selectedScore === undefined ? {} : { selectedScore: diagnostics.selectedScore }),
      ...(diagnostics.selectedRankDistance === undefined ? {} : { selectedRankDistance: diagnostics.selectedRankDistance }),
    };
  }

  return {
    ...common,
    reason: diagnostics.reason,
    ...(diagnostics.fallbackSeedsAttempted === undefined ? {} : { fallbackSeedsAttempted: diagnostics.fallbackSeedsAttempted }),
  };
}

function publicDifficultyProfile(profile: DifficultyProfileV1): PublicDifficultyProfile {
  const assessment = profile.logical;
  const trace = assessment.trace;
  return {
    profileVersion: profile.profileVersion,
    logical: {
      modelVersion: assessment.modelVersion,
      score: assessment.score,
      level: assessment.level,
      inDifficultyBand: assessment.inDifficultyBand,
      band: {
        minimumScore: assessment.band.minimumScore,
        maximumScore: assessment.band.maximumScore,
      },
      status: assessment.status,
      metrics: {
        reasoningDependencyDepth: publicMetric(assessment.metrics.reasoningDependencyDepth),
        deductionComplexity: publicMetric(assessment.metrics.deductionComplexity),
        workingMemoryDemand: publicMetric(assessment.metrics.workingMemoryDemand),
        crossCategoryReasoning: publicMetric(assessment.metrics.crossCategoryReasoning),
        startingAccessibility: publicMetric(assessment.metrics.startingAccessibility),
        automaticCascadeBehaviour: publicMetric(assessment.metrics.automaticCascadeBehaviour),
        residualLogicalComplexity: publicMetric(assessment.metrics.residualLogicalComplexity),
      },
      trace: {
        solved: trace.solved,
        usedGuessing: trace.usedGuessing,
        status: trace.status,
        maximumDependencyDepth: trace.maximumDependencyDepth,
        startingDeductions: trace.startingDeductions,
        automaticPropagationSteps: trace.automaticPropagationSteps,
        crossCategorySteps: trace.crossCategorySteps,
      },
    },
    legacy: publicLegacyDifficulty(profile.legacy),
    semantic: {
      schemaVersion: profile.semantic.schemaVersion,
      model: profile.semantic.model,
      resolvedModel: profile.semantic.resolvedModel,
      status: profile.semantic.status,
      metrics: {},
      reviewFlags: [...profile.semantic.reviewFlags],
    },
    calibrationStatus: profile.calibrationStatus,
  };
}

/** Project a generated puzzle to fields safe for player-facing REST and MCP output. */
export function publicPuzzleFields(puzzle: GeneratedPuzzle): PublicGeneratedPuzzle {
  const {
    id,
    requestedSeed,
    seed,
    templateId,
    generatorVersion,
    solverVersion,
    difficultyModel,
    difficultyProfile,
    selectionDiagnostics,
    spec,
    clues,
    difficulty,
    requestedDifficultyLevel,
    generationStrategy,
    seedFallbackAttempt,
  } = puzzle;
  return {
    id,
    requestedSeed,
    seed,
    templateId,
    generatorVersion,
    solverVersion,
    ...(difficultyModel ? { difficultyModel } : {}),
    ...(difficultyProfile ? { difficultyProfile: publicDifficultyProfile(difficultyProfile) } : {}),
    ...(selectionDiagnostics ? { selectionDiagnostics: publicSelectionDiagnostics(selectionDiagnostics) } : {}),
    spec,
    clues,
    difficulty,
    ...(requestedDifficultyLevel === undefined ? {} : { requestedDifficultyLevel }),
    ...(generationStrategy === undefined ? {} : { generationStrategy }),
    ...(seedFallbackAttempt === undefined ? {} : { seedFallbackAttempt }),
  };
}
