import type { Difficulty, PuzzleTemplate } from "../domain/types.js";
import { generatePuzzle } from "./generator.js";

export interface DifficultyCorpusAudit {
  templateId: string;
  modelVersion: string;
  sampleSize: number;
  seedPrefix: string;
  levelCounts: [number, number, number, number, number];
  humanTrace: { complete: number; incomplete: number };
  clues: { average: number; minimum: number; maximum: number };
}

/**
 * Generate a deterministic seed corpus for calibration and release regression
 * checks. It deliberately reports the bounded no-guess trace separately from
 * player outcomes: this is an engineering diagnostic, not human validation.
 */
export function auditDifficultyCorpus(template: PuzzleTemplate, options: { sampleSize?: number; seedPrefix?: string } = {}): DifficultyCorpusAudit {
  const sampleSize = options.sampleSize ?? template.metadata?.difficultyCalibration.corpus.sampleSize ?? 1_000;
  const seedPrefix = options.seedPrefix ?? "difficulty-audit";
  if (!Number.isInteger(sampleSize) || sampleSize < 1) throw new RangeError("sampleSize must be a positive integer");

  const levelCounts: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let complete = 0;
  let clueTotal = 0;
  let minimum = Infinity;
  let maximum = 0;
  let modelVersion: string | undefined;
  for (let index = 0; index < sampleSize; index += 1) {
    const puzzle = generatePuzzle(template, `${seedPrefix}-${index}`);
    const level = puzzle.difficulty.level as Difficulty["level"];
    levelCounts[level - 1] += 1;
    modelVersion ??= puzzle.difficulty.modelVersion;
    if (puzzle.difficulty.evidence.humanSolve.solved) complete += 1;
    clueTotal += puzzle.clues.length;
    minimum = Math.min(minimum, puzzle.clues.length);
    maximum = Math.max(maximum, puzzle.clues.length);
  }
  return {
    templateId: template.id,
    modelVersion: modelVersion!,
    sampleSize,
    seedPrefix,
    levelCounts,
    humanTrace: { complete, incomplete: sampleSize - complete },
    clues: { average: clueTotal / sampleSize, minimum, maximum },
  };
}
