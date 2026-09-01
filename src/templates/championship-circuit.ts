import type { PuzzleTemplate } from "../domain/types.js";
import { IJF_SENIOR_MENS_WEIGHT_CLASSES } from "../domain/ijf-weight-classes.js";

/** A dense 5x5 format intended for the hardest generated puzzles. */
export const championshipCircuitTemplate: PuzzleTemplate = {
  id: "championship-circuit-v2",
  title: "Championship Circuit",
  baseCategory: "judoka",
  categories: [
    { id: "judoka", label: "Judoka", values: ["Aki", "Hana", "Kenji", "Mika", "Sora"] },
    { id: "weight", label: "Weight division", values: IJF_SENIOR_MENS_WEIGHT_CLASSES.slice(0, 5), ordered: true },
    { id: "tatami", label: "Tatami", values: ["Tatami 1", "Tatami 2", "Tatami 3", "Tatami 4", "Tatami 5"], ordered: true },
    { id: "medal", label: "Medal", values: ["Gold", "Silver", "Bronze", "Finalist", "Quarter-finalist"], ordered: true },
  ],
  metadata: {
    locales: { default: "en", supported: ["en"] },
    difficultyCalibration: {
      modelVersion: "yokaiba-difficulty-v3",
      scoreThresholds: [78, 88, 101, 116],
      corpus: { sampleSize: 1_000, methodology: "Seeded corpus scored with a deterministic deduction trace and solver telemetry." },
    },
  },
};
