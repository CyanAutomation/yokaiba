import type { PuzzleTemplate } from "../domain/types.js";
import { createChampionshipCategories } from "./template-builders.js";

/** A gentler 5x5, three-category transition into the Championship Circuit. */
export const championshipBridgeTemplate: PuzzleTemplate = {
  id: "championship-bridge-v1",
  title: "Championship Bridge",
  baseCategory: "judoka",
  categories: createChampionshipCategories({
    id: "result", label: "Result", values: ["1st", "2nd", "3rd", "4th", "5th"], ordered: true,
  }),
  metadata: {
    locales: { default: "en", supported: ["en"] },
    difficultyCalibration: {
      modelVersion: "yokaiba-difficulty-v4",
      // The structure is championship-sized, while generous thresholds make it
      // a deliberate bridge between Open Division and expert play.
      scoreThresholds: [160],
      levelRange: [8, 9],
      requiresHumanSolve: true,
      corpus: { sampleSize: 1_000, methodology: "Seeded corpus scored with the no-guess trace and deterministic solver telemetry." },
    },
  },
};
