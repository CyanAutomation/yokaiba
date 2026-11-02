import type { Category, DifficultyCalibration, DifficultyLevel, PuzzleTemplate, TemplateMetadata } from "../domain/types.js";
import { IJF_SENIOR_MENS_WEIGHT_CLASSES } from "../domain/ijf-weight-classes.js";

const TOURNAMENT_CORPUS_METHOD = "Seeded corpus scored with the no-guess trace and deterministic solver telemetry.";
const TOURNAMENT_MODEL_VERSION = "yokaiba-difficulty-v4";

export function createDifficultyCalibration(options: {
  scoreThresholds: number[];
  levelRange: [DifficultyLevel, DifficultyLevel];
  requiresHumanSolve?: boolean;
  corpus?: { sampleSize: number; methodology: string };
}): DifficultyCalibration {
  return {
    modelVersion: TOURNAMENT_MODEL_VERSION,
    scoreThresholds: options.scoreThresholds,
    levelRange: options.levelRange,
    ...(options.requiresHumanSolve ? { requiresHumanSolve: true } : {}),
    corpus: options.corpus ?? { sampleSize: 1_000, methodology: TOURNAMENT_CORPUS_METHOD },
  };
}

export function createTemplateMetadata(difficultyCalibration: DifficultyCalibration): TemplateMetadata {
  return {
    locales: { default: "en", supported: ["en"] },
    difficultyCalibration,
  };
}

export function createTournamentOrderTemplate(id: string, requiresHumanSolve: boolean): PuzzleTemplate {
  return {
    id,
    title: "Tournament Order",
    baseCategory: "judoka",
    categories: [
      { id: "judoka", label: "Judoka", values: ["Aki", "Hana", "Kenji", "Sora"] },
      { id: "weight", label: "Weight division", values: ["-60 kg", "-66 kg", "-73 kg", "-81 kg"], ordered: true },
      { id: "tatami", label: "Tatami", values: ["Tatami 1", "Tatami 2", "Tatami 3", "Tatami 4"], ordered: true },
      { id: "placing", label: "Placing", values: ["1st", "2nd", "3rd", "4th"], ordered: true },
    ],
    metadata: createTemplateMetadata(
      createDifficultyCalibration({
        scoreThresholds: [105, 118, 130],
        levelRange: [1, 4],
        requiresHumanSolve,
      }),
    ),
  };
}

export function createChampionshipCategories(result: Category): Category[] {
  return [
    { id: "judoka", label: "Judoka", values: ["Aki", "Hana", "Kenji", "Mika", "Sora"] },
    { id: "weight", label: "Weight division", values: IJF_SENIOR_MENS_WEIGHT_CLASSES.slice(0, 5), ordered: true },
    { id: "tatami", label: "Tatami", values: ["Tatami 1", "Tatami 2", "Tatami 3", "Tatami 4", "Tatami 5"], ordered: true },
    { ...result, values: [...result.values] },
  ];
}
