import type { Category, PuzzleTemplate } from "../domain/types.js";
import { IJF_SENIOR_MENS_WEIGHT_CLASSES } from "../domain/ijf-weight-classes.js";

const TOURNAMENT_CORPUS_METHOD = "Seeded corpus scored with the no-guess trace and deterministic solver telemetry.";

export function createTournamentOrderTemplate(id: string, requiresHumanSolve: boolean): PuzzleTemplate {
  return {
    id,
    title: "Tournament Order",
    baseCategory: "judoka",
    categories: [
      { id: "judoka", label: "Judoka", values: ["Aki", "Hana", "Kenji", "Sora"] },
      { id: "weight", label: "Weight category", values: ["-60 kg", "-66 kg", "-73 kg", "-81 kg"], ordered: true },
      { id: "tatami", label: "Tatami", values: ["Tatami 1", "Tatami 2", "Tatami 3", "Tatami 4"], ordered: true },
      { id: "placing", label: "Placing", values: ["1st", "2nd", "3rd", "4th"], ordered: true },
    ],
    metadata: {
      locales: { default: "en", supported: ["en"] },
      difficultyCalibration: {
        modelVersion: "yokaiba-difficulty-v4",
        scoreThresholds: [105, 118, 130],
        levelRange: [1, 4],
        ...(requiresHumanSolve ? { requiresHumanSolve: true } : {}),
        corpus: { sampleSize: 1_000, methodology: TOURNAMENT_CORPUS_METHOD },
      },
    },
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
