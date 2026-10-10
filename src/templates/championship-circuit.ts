import type { PuzzleTemplate } from "../domain/types.js";
import { createChampionshipCategories } from "./template-builders.js";

/** A dense 5x5 format intended for the hardest generated puzzles. */
export const championshipCircuitTemplate: PuzzleTemplate = {
  id: "championship-circuit-v2",
  title: "Championship Circuit",
  baseCategory: "judoka",
  categories: createChampionshipCategories({
    id: "medal", label: "Result", values: ["Gold", "Silver", "Bronze", "Finalist", "Quarter-finalist"], ordered: true,
  }),
  metadata: {
    locales: { default: "en", supported: ["en"] },
    difficultyCalibration: {
      modelVersion: "yokaiba-difficulty-v4",
      scoreThresholds: [145, 157, 168],
      levelRange: [9, 12],
      requiresHumanSolve: true,
      corpus: { sampleSize: 1_000, methodology: "Seeded corpus scored with a deterministic deduction trace and solver telemetry." },
    },
  },
};
