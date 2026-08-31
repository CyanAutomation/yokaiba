import type { PuzzleTemplate } from "../domain/types.js";

/** A five-judoka format that exercises the solver's supported maximum board size. */
export const openDivisionTemplate: PuzzleTemplate = {
  id: "open-division-v1",
  title: "Open Division",
  baseCategory: "judoka",
  categories: [
    { id: "judoka", label: "Judoka", values: ["Aki", "Hana", "Kenji", "Mika", "Sora"] },
    { id: "weight", label: "Weight category", values: ["-60 kg", "-66 kg", "-73 kg", "-81 kg", "+81 kg"], ordered: true },
    { id: "tatami", label: "Tatami", values: ["Tatami 1", "Tatami 2", "Tatami 3", "Tatami 4", "Tatami 5"], ordered: true },
  ],
  metadata: {
    locales: { default: "en", supported: ["en"] },
    difficultyCalibration: {
      modelVersion: "yokaiba-difficulty-v2",
      scoreThresholds: [71, 73, 79, 89],
      corpus: { sampleSize: 1_000, methodology: "Seeded corpus scored with the no-guess trace and deterministic solver telemetry." },
    },
  },
};
