import type { Difficulty, PuzzleTemplate } from "../domain/types.js";
import { generatePuzzle } from "./generator.js";

export interface DifficultyCorpusAudit {
  templateId: string;
  modelVersion: string;
  sampleSize: number;
  seedPrefix: string;
  levelCounts: number[];
  humanTrace: { complete: number; incomplete: number };
  clues: { average: number; minimum: number; maximum: number };
}

export interface DifficultyAuditRecord {
  level: Difficulty["level"];
  humanTraceComplete: boolean;
  clueCount: number;
}

export type DifficultyCorpusStatistics = Pick<DifficultyCorpusAudit, "levelCounts" | "humanTrace" | "clues">;

/** Aggregate already-generated audit observations without invoking the generator. */
export function aggregateDifficultyAuditRecords(records: readonly DifficultyAuditRecord[]): DifficultyCorpusStatistics {
  if (records.length === 0) throw new RangeError("at least one audit record is required");

  const levelCounts = Array<number>(12).fill(0);
  let complete = 0;
  let clueTotal = 0;
  let minimum = Infinity;
  let maximum = 0;
  for (const record of records) {
    levelCounts[record.level - 1] += 1;
    if (record.humanTraceComplete) complete += 1;
    clueTotal += record.clueCount;
    minimum = Math.min(minimum, record.clueCount);
    maximum = Math.max(maximum, record.clueCount);
  }

  return {
    levelCounts,
    humanTrace: { complete, incomplete: records.length - complete },
    clues: { average: clueTotal / records.length, minimum, maximum },
  };
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

  const records: DifficultyAuditRecord[] = [];
  let modelVersion: string | undefined;
  for (let index = 0; index < sampleSize; index += 1) {
    const puzzle = generatePuzzle(template, `${seedPrefix}-${index}`);
    modelVersion ??= puzzle.difficulty.modelVersion;
    records.push({
      level: puzzle.difficulty.level,
      humanTraceComplete: puzzle.difficulty.evidence.humanSolve.solved,
      clueCount: puzzle.clues.length,
    });
  }
  return {
    templateId: template.id,
    modelVersion: modelVersion!,
    sampleSize,
    seedPrefix,
    ...aggregateDifficultyAuditRecords(records),
  };
}
