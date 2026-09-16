import type { Difficulty, PuzzleTemplate } from "../domain/types.js";
import { generatePuzzle, generatePuzzleAtDifficultyWithFallback } from "./generator.js";

export interface DifficultyCorpusAudit {
  templateId: string;
  modelVersion: string;
  sampleSize: number;
  seedPrefix: string;
  levelCounts: number[];
  humanTrace: { complete: number; incomplete: number };
  clues: { average: number; minimum: number; maximum: number };
}

/** A release-oriented report for the exact difficulty-selection path used by courses. */
export interface TargetedDifficultyCorpusAudit {
  templateId: string;
  modelVersion: string;
  sampleSize: number;
  seedPrefix: string;
  levels: Array<{
    requestedDifficultyLevel: Difficulty["level"];
    generated: number;
    assessedLevelCounts: number[];
    humanTrace: { complete: number; incomplete: number };
    fallback: { used: number; maximumAttempt: number };
    clues: { average: number; minimum: number; maximum: number };
  }>;
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
    if (!Number.isInteger(record.level) || record.level < 1 || record.level > 12) {
      throw new RangeError(`difficulty level must be an integer between 1 and 12, received ${record.level}`);
    }
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

/**
 * Exercise every advertised level through the same fallback path used by the
 * browser course. This is deliberately separate from the distribution audit:
 * a normal generator sample cannot prove that a requested level is deliverable.
 */
export function auditTargetedDifficultyCorpus(template: PuzzleTemplate, options: { sampleSize?: number; seedPrefix?: string } = {}): TargetedDifficultyCorpusAudit {
  const sampleSize = options.sampleSize ?? template.metadata?.difficultyCalibration.corpus.sampleSize ?? 1_000;
  const seedPrefix = options.seedPrefix ?? "targeted-difficulty-audit";
  if (!Number.isInteger(sampleSize) || sampleSize < 1) throw new RangeError("sampleSize must be a positive integer");
  const [minimumLevel, maximumLevel] = template.metadata?.difficultyCalibration.levelRange ?? [1, 12];
  let modelVersion: string | undefined;
  const levels = Array.from({ length: maximumLevel - minimumLevel + 1 }, (_value, offset) => {
    const requestedDifficultyLevel = (minimumLevel + offset) as Difficulty["level"];
    const records: DifficultyAuditRecord[] = [];
    let fallbackUsed = 0;
    let maximumAttempt = 0;
    for (let index = 0; index < sampleSize; index += 1) {
      const puzzle = generatePuzzleAtDifficultyWithFallback(template, `${seedPrefix}-${requestedDifficultyLevel}-${index}`, requestedDifficultyLevel);
      modelVersion ??= puzzle.difficulty.modelVersion;
      records.push({ level: puzzle.difficulty.level, humanTraceComplete: puzzle.difficulty.evidence.humanSolve.solved, clueCount: puzzle.clues.length });
      if (puzzle.seedFallbackAttempt !== undefined) {
        fallbackUsed += 1;
        maximumAttempt = Math.max(maximumAttempt, puzzle.seedFallbackAttempt);
      }
    }
    const statistics = aggregateDifficultyAuditRecords(records);
    return { requestedDifficultyLevel, generated: sampleSize, assessedLevelCounts: statistics.levelCounts, humanTrace: statistics.humanTrace, fallback: { used: fallbackUsed, maximumAttempt }, clues: statistics.clues };
  });
  return { templateId: template.id, modelVersion: modelVersion!, sampleSize, seedPrefix, levels };
}
