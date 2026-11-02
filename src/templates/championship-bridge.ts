import type { PuzzleTemplate } from "../domain/types.js";
import { createChampionshipCategories, createDifficultyCalibration, createTemplateMetadata } from "./template-builders.js";

/** A gentler 5x5, three-category transition into the Championship Circuit. */
export const championshipBridgeTemplate: PuzzleTemplate = {
  id: "championship-bridge-v1",
  title: "Championship Bridge",
  baseCategory: "judoka",
  categories: createChampionshipCategories({
    id: "result", label: "Result", values: ["1st", "2nd", "3rd", "4th", "5th"], ordered: true,
  }),
  // The structure is championship-sized, while generous thresholds make it
  // a deliberate bridge between Open Division and expert play.
  metadata: createTemplateMetadata(
    createDifficultyCalibration({
      scoreThresholds: [160],
      levelRange: [8, 9],
      requiresHumanSolve: true,
    }),
  ),
};
