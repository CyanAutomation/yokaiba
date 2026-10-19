import type { Difficulty, DifficultyLevel } from "../domain/types.js";
import type { HumanDeductionTraceV5 } from "./human-deduction-v5.js";

export const DIFFICULTY_MODEL_V5 = "yokaiba-difficulty-v5" as const;
export const DIFFICULTY_PROFILE_VERSION = "yokaiba-difficulty-profile-v1" as const;
export const JEV_SEMANTIC_SCHEMA_VERSION = "yokaiba-jev-semantic-v2" as const;
export const JEV_REQUESTED_MODEL = "~typesafe/jev-latest" as const;

export interface DifficultyBandV5 {
  level: DifficultyLevel;
  minimumScore: number;
  maximumScore: number;
  /** Minimum meaningful inference depth used as a candidate-ranking preference. */
  preferredMinimumDepth: number;
}

/** Inclusive provisional ranges chosen from the first paired and targeted audit; not player-calibrated. */
export const DIFFICULTY_BANDS_V5: readonly DifficultyBandV5[] = [
  { level: 1, minimumScore: 14, maximumScore: 15, preferredMinimumDepth: 0 },
  { level: 2, minimumScore: 16, maximumScore: 39, preferredMinimumDepth: 0 },
  { level: 3, minimumScore: 40, maximumScore: 44, preferredMinimumDepth: 1 },
  { level: 4, minimumScore: 45, maximumScore: 52, preferredMinimumDepth: 1 },
  { level: 5, minimumScore: 53, maximumScore: 60, preferredMinimumDepth: 1 },
  { level: 6, minimumScore: 61, maximumScore: 65, preferredMinimumDepth: 2 },
  { level: 7, minimumScore: 66, maximumScore: 69, preferredMinimumDepth: 2 },
  { level: 8, minimumScore: 70, maximumScore: 72, preferredMinimumDepth: 2 },
  { level: 9, minimumScore: 73, maximumScore: 76, preferredMinimumDepth: 3 },
  { level: 10, minimumScore: 77, maximumScore: 80, preferredMinimumDepth: 3 },
  { level: 11, minimumScore: 81, maximumScore: 90, preferredMinimumDepth: 4 },
  { level: 12, minimumScore: 91, maximumScore: 100, preferredMinimumDepth: 5 },
];

export interface DifficultyMetricV5 {
  score: number;
  direction: "higher_is_harder" | "higher_is_easier";
  raw: Record<string, number | number[]>;
  interpretation: string;
}

export interface DifficultyAssessmentV5 {
  modelVersion: typeof DIFFICULTY_MODEL_V5;
  score: number;
  level: DifficultyLevel;
  inDifficultyBand: boolean;
  band: { minimumScore: number; maximumScore: number };
  status: "complete" | "incomplete" | "contradiction";
  metrics: {
    reasoningDependencyDepth: DifficultyMetricV5;
    deductionComplexity: DifficultyMetricV5;
    workingMemoryDemand: DifficultyMetricV5;
    crossCategoryReasoning: DifficultyMetricV5;
    startingAccessibility: DifficultyMetricV5;
    automaticCascadeBehaviour: DifficultyMetricV5;
    residualLogicalComplexity: DifficultyMetricV5;
  };
  trace: HumanDeductionTraceV5;
}

export interface DifficultyProfileV1 {
  profileVersion: typeof DIFFICULTY_PROFILE_VERSION;
  logical: DifficultyAssessmentV5;
  legacy: Difficulty;
  semantic: {
    schemaVersion: typeof JEV_SEMANTIC_SCHEMA_VERSION;
    model: typeof JEV_REQUESTED_MODEL;
    resolvedModel: string | null;
    status: "not_assessed";
    metrics: Record<string, never>;
    reviewFlags: string[];
  };
  calibrationStatus: "provisional";
}
