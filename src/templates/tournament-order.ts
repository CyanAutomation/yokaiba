import type { PuzzleTemplate } from "../domain/types.js";

/** Editorial starter content; every value is fictional and safe for puzzle use. */
export const tournamentOrderTemplate: PuzzleTemplate = {
  id: "tournament-order-v1",
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
      modelVersion: "yokaiba-difficulty-v2",
      scoreThresholds: [68, 73, 79, 88],
      corpus: { sampleSize: 1_000, methodology: "Seeded corpus scored with the no-guess trace and deterministic solver telemetry." },
    },
  },
};
