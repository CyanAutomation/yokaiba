import type { PuzzleTemplate } from "../domain/types.js";
import { IJF_SENIOR_MENS_WEIGHT_CLASSES } from "../domain/ijf-weight-classes.js";

/** A gentler 5x5, three-category transition into the Championship Circuit. */
export const championshipBridgeTemplate: PuzzleTemplate = {
  id: "championship-bridge-v1",
  title: "Championship Bridge",
  baseCategory: "judoka",
  categories: [
    { id: "judoka", label: "Judoka", values: ["Aki", "Hana", "Kenji", "Mika", "Sora"] },
    { id: "weight", label: "Weight division", values: IJF_SENIOR_MENS_WEIGHT_CLASSES.slice(0, 5), ordered: true },
    { id: "tatami", label: "Tatami", values: ["Tatami 1", "Tatami 2", "Tatami 3", "Tatami 4", "Tatami 5"], ordered: true },
    { id: "result", label: "Result", values: ["1st", "2nd", "3rd", "4th", "5th"], ordered: true },
  ],
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
