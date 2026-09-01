import type { PuzzleTemplate } from "../domain/types.js";
import { IJF_SENIOR_MENS_WEIGHT_CLASSES } from "../domain/ijf-weight-classes.js";

/** A five-judoka format that exercises the solver's supported maximum board size. */
export const openDivisionTemplate: PuzzleTemplate = {
  id: "open-division-v2",
  title: "Open Division",
  baseCategory: "judoka",
  categories: [
    { id: "judoka", label: "Judoka", values: ["Aki", "Hana", "Kenji", "Mika", "Sora"] },
    { id: "weight", label: "Weight category", values: IJF_SENIOR_MENS_WEIGHT_CLASSES.slice(0, 5), ordered: true },
    { id: "tatami", label: "Tatami", values: ["Tatami 1", "Tatami 2", "Tatami 3", "Tatami 4", "Tatami 5"], ordered: true },
  ],
  metadata: {
    locales: { default: "en", supported: ["en"] },
    difficultyCalibration: {
      modelVersion: "yokaiba-difficulty-v3",
      scoreThresholds: [85, 100, 115, 130],
      corpus: { sampleSize: 1_000, methodology: "Seeded corpus scored with the no-guess trace and deterministic solver telemetry." },
    },
  },
};
