import type { Difficulty, PuzzleTemplate } from "../domain/types.js";
import { DifficultyUnavailableError, generateProgressivePuzzle, generatePuzzle, generatePuzzleAtDifficultyWithFallback } from "./generator.js";

export interface DifficultyCorpusAudit {
  templateId: string;
  modelVersion: string;
  sampleSize: number;
  generated: number;
  unavailable: number;
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
  levels: TargetedDifficultyLevelAudit[];
}

export interface TargetedDifficultyLevelAudit {
  requestedDifficultyLevel: Difficulty["level"];
  generated: number;
  assessedLevelCounts: number[];
  humanTrace: { complete: number; incomplete: number };
  fallback: { used: number; maximumAttempt: number; attempts?: { p50: number; p95: number } };
  clues: { average: number; minimum: number; maximum: number };
}

export interface TargetedDifficultyLevelResult {
  modelVersion: string;
  level: TargetedDifficultyLevelAudit;
}

export interface DifficultyAuditRecord {
  level: Difficulty["level"];
  humanTraceComplete: boolean;
  clueCount: number;
}

export type DifficultyCorpusStatistics = Pick<DifficultyCorpusAudit, "levelCounts" | "humanTrace" | "clues">;

export interface DifficultyAuditProgress {
  phase: "difficulty" | "targeted";
  templateId: string;
  requestedDifficultyLevel?: Difficulty["level"];
  completed: number;
  total: number;
}

export type DifficultyAuditProgressCallback = (progress: DifficultyAuditProgress) => void;

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
type DifficultyAuditOptions = { sampleSize?: number; seedPrefix?: string; onProgress?: DifficultyAuditProgressCallback };

function auditFromOptions(
  template: PuzzleTemplate,
  options: DifficultyAuditOptions,
  generator: typeof generatePuzzle,
): DifficultyCorpusAudit {
  const sampleSize = options.sampleSize ?? template.metadata?.difficultyCalibration.corpus.sampleSize ?? 1_000;
  const seedPrefix = options.seedPrefix ?? "difficulty-audit";
  if (!Number.isInteger(sampleSize) || sampleSize < 1) throw new RangeError("sampleSize must be a positive integer");
  return auditCorpusWithGenerator(template, sampleSize, seedPrefix, generator, options.onProgress);
}

export function auditDifficultyCorpus(template: PuzzleTemplate, options: DifficultyAuditOptions = {}): DifficultyCorpusAudit {
  return auditFromOptions(template, options, generatePuzzle);
}

/** Report the no-target generation distribution returned by the API's progressive path. */
export function auditProductionDifficultyCorpus(template: PuzzleTemplate, options: DifficultyAuditOptions = {}): DifficultyCorpusAudit {
  return auditFromOptions(template, options, generateProgressivePuzzle);
}

function auditCorpusWithGenerator(
  template: PuzzleTemplate,
  sampleSize: number,
  seedPrefix: string,
  generator: typeof generatePuzzle,
  onProgress?: DifficultyAuditProgressCallback,
): DifficultyCorpusAudit {

  const records: DifficultyAuditRecord[] = [];
  let modelVersion: string | undefined;
  let unavailable = 0;
  for (let index = 0; index < sampleSize; index += 1) {
    let puzzle: ReturnType<typeof generatePuzzle>;
    try {
      puzzle = generator(template, `${seedPrefix}-${index}`);
    } catch (error) {
      if (!(error instanceof DifficultyUnavailableError)) throw error;
      unavailable += 1;
      onProgress?.({ phase: "difficulty", templateId: template.id, completed: index + 1, total: sampleSize });
      continue;
    }
    modelVersion ??= puzzle.difficulty.modelVersion;
    records.push({
      level: puzzle.difficulty.level,
      humanTraceComplete: puzzle.difficulty.evidence.humanSolve.solved,
      clueCount: puzzle.clues.length,
    });
    onProgress?.({ phase: "difficulty", templateId: template.id, completed: index + 1, total: sampleSize });
  }
  const statistics: DifficultyCorpusStatistics = records.length > 0
    ? aggregateDifficultyAuditRecords(records)
    : { levelCounts: Array<number>(12).fill(0), humanTrace: { complete: 0, incomplete: 0 }, clues: { average: 0, minimum: 0, maximum: 0 } };
  return {
    templateId: template.id,
    modelVersion: modelVersion ?? "unavailable",
    sampleSize,
    generated: records.length,
    unavailable,
    seedPrefix,
    ...statistics,
  };
}

/** Run one requested level independently so a caller can checkpoint between levels. */
function collectTargetedDifficultySamples(
  template: PuzzleTemplate,
  requestedDifficultyLevel: Difficulty["level"],
  sampleSize: number,
  seedPrefix: string,
  onProgress?: DifficultyAuditProgressCallback,
): { records: DifficultyAuditRecord[]; fallbackAttempts: number[]; modelVersion: string } {
  const records: DifficultyAuditRecord[] = [];
  const fallbackAttempts: number[] = [];
  let modelVersion: string | undefined;
  for (let index = 0; index < sampleSize; index += 1) {
    const puzzle = generatePuzzleAtDifficultyWithFallback(template, `${seedPrefix}-${requestedDifficultyLevel}-${index}`, requestedDifficultyLevel);
    modelVersion ??= puzzle.difficulty.modelVersion;
    records.push({ level: puzzle.difficulty.level, humanTraceComplete: puzzle.difficulty.evidence.humanSolve.solved, clueCount: puzzle.clues.length });
    onProgress?.({ phase: "targeted", templateId: template.id, requestedDifficultyLevel, completed: index + 1, total: sampleSize });
    if (puzzle.seedFallbackAttempt !== undefined) fallbackAttempts.push(puzzle.seedFallbackAttempt);
  }
  return { records, fallbackAttempts, modelVersion: modelVersion! };
}

export function auditTargetedDifficultyLevel(
  template: PuzzleTemplate,
  requestedDifficultyLevel: Difficulty["level"],
  options: { sampleSize?: number; seedPrefix?: string; onProgress?: DifficultyAuditProgressCallback } = {},
): TargetedDifficultyLevelResult {
  const sampleSize = options.sampleSize ?? template.metadata?.difficultyCalibration.corpus.sampleSize ?? 1_000;
  const seedPrefix = options.seedPrefix ?? "targeted-difficulty-audit";
  if (!Number.isInteger(sampleSize) || sampleSize < 1) throw new RangeError("sampleSize must be a positive integer");
  const [minimumLevel, maximumLevel] = template.metadata?.difficultyCalibration.levelRange ?? [1, 12];
  if (requestedDifficultyLevel < minimumLevel || requestedDifficultyLevel > maximumLevel) {
    throw new RangeError(`${template.id} does not advertise difficulty level ${requestedDifficultyLevel}`);
  }

  const { records, fallbackAttempts, modelVersion } = collectTargetedDifficultySamples(
    template,
    requestedDifficultyLevel,
    sampleSize,
    seedPrefix,
    options.onProgress,
  );
  const statistics = aggregateDifficultyAuditRecords(records);
  return {
    modelVersion,
    level: {
      requestedDifficultyLevel,
      generated: sampleSize,
      assessedLevelCounts: statistics.levelCounts,
      humanTrace: statistics.humanTrace,
      fallback: {
        used: fallbackAttempts.length,
        maximumAttempt: fallbackAttempts.length > 0 ? Math.max(...fallbackAttempts) : 0,
        attempts: fallbackAttemptPercentiles(fallbackAttempts),
      },
      clues: statistics.clues,
    },
  };
}

/** Summarize one-based fallback attempts with the nearest-rank percentile definition. */
export function fallbackAttemptPercentiles(attempts: readonly number[]): { p50: number; p95: number } {
  if (attempts.some(attempt => !Number.isInteger(attempt) || attempt < 1)) {
    throw new RangeError("fallback attempts must be positive integers");
  }
  if (attempts.length === 0) return { p50: 0, p95: 0 };
  const sorted = [...attempts].sort((left, right) => left - right);
  const nearestRank = (percentile: number) => sorted[Math.ceil(percentile * sorted.length) - 1]!;
  return { p50: nearestRank(0.5), p95: nearestRank(0.95) };
}

/**
 * Exercise every advertised level through the same fallback path used by the
 * browser course. This is deliberately separate from the distribution audit:
 * a normal generator sample cannot prove that a requested level is deliverable.
 */
export function auditTargetedDifficultyCorpus(template: PuzzleTemplate, options: { sampleSize?: number; seedPrefix?: string; onProgress?: DifficultyAuditProgressCallback } = {}): TargetedDifficultyCorpusAudit {
  const sampleSize = options.sampleSize ?? template.metadata?.difficultyCalibration.corpus.sampleSize ?? 1_000;
  const seedPrefix = options.seedPrefix ?? "targeted-difficulty-audit";
  if (!Number.isInteger(sampleSize) || sampleSize < 1) throw new RangeError("sampleSize must be a positive integer");
  const [minimumLevel, maximumLevel] = template.metadata?.difficultyCalibration.levelRange ?? [1, 12];
  const results = Array.from({ length: maximumLevel - minimumLevel + 1 }, (_value, offset) => auditTargetedDifficultyLevel(
    template,
    (minimumLevel + offset) as Difficulty["level"],
    { sampleSize, seedPrefix, onProgress: options.onProgress },
  ));
  const modelVersion = results[0]?.modelVersion;
  const levels = results.map(result => result.level);
  return { templateId: template.id, modelVersion: modelVersion!, sampleSize, seedPrefix, levels };
}
