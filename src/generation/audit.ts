import type { Clue, Difficulty, GeneratedPuzzle, PuzzleTemplate } from "../domain/types.js";
import type { PuzzleSolver } from "../domain/puzzle-solver.js";
import { exhaustivePuzzleSolver } from "../constraints/solver.js";
import { DEFAULT_DIFFICULTY_MODEL, DEFAULT_DIFFICULTY_MODEL_VERSION, DifficultyUnavailableError, generatePuzzle, generatePuzzleForRequest } from "./generator.js";
import { evaluateHumanDeductionTraceV5 } from "./human-deduction-v5.js";

export type ClueLogicalContribution = "uniqueness-critical" | "no-guess-critical" | "not-essential";

export interface ClueAblationResult {
  clueId: string;
  uniqueWithout: boolean;
  humanTraceCompleteWithout: boolean;
  logicalContribution: ClueLogicalContribution;
  deductionStepsUsingClue: number;
  traceStepCountWithoutClue: number;
  /** Steps in the reduced trace minus steps in the full trace; positive means the alternative trace is longer. */
  traceStepDelta: number;
  /** Other individually non-essential clues whose joint removal breaks uniqueness or no-guess completion. */
  redundantWithClueIds: string[];
}

/** Measure single-clue effects and interactions between individually non-essential clues. */
export function auditClueAblation(template: PuzzleTemplate, clues: readonly Clue[], solver: PuzzleSolver = exhaustivePuzzleSolver): ClueAblationResult[] {
  const fullTrace = evaluateHumanDeductionTraceV5(template, clues);
  const results = clues.map((clue, removedIndex): ClueAblationResult => {
    const remaining = clues.filter((_candidate, index) => index !== removedIndex);
    const uniqueWithout = solver.countSolutions(template, remaining, 2) === 1;
    const traceWithout = evaluateHumanDeductionTraceV5(template, remaining);
    const humanTraceCompleteWithout = traceWithout.solved;
    return {
      clueId: clue.id,
      uniqueWithout,
      humanTraceCompleteWithout,
      logicalContribution: !uniqueWithout ? "uniqueness-critical" : !humanTraceCompleteWithout ? "no-guess-critical" : "not-essential",
      deductionStepsUsingClue: fullTrace.steps.filter(step => step.clueIds.includes(clue.id)).length,
      traceStepCountWithoutClue: traceWithout.steps.length,
      traceStepDelta: traceWithout.steps.length - fullTrace.steps.length,
      redundantWithClueIds: [],
    };
  });

  const individuallyNonEssential = results.flatMap((result, index) => result.logicalContribution === "not-essential" ? [index] : []);
  for (let candidateIndex = 0; candidateIndex < individuallyNonEssential.length; candidateIndex += 1) {
    const leftIndex = individuallyNonEssential[candidateIndex]!;
    for (let otherIndex = candidateIndex + 1; otherIndex < individuallyNonEssential.length; otherIndex += 1) {
      const rightIndex = individuallyNonEssential[otherIndex]!;
      const remaining = clues.filter((_candidate, index) => index !== leftIndex && index !== rightIndex);
      const uniqueWithoutPair = solver.countSolutions(template, remaining, 2) === 1;
      const traceCompleteWithoutPair = evaluateHumanDeductionTraceV5(template, remaining).solved;
      if (uniqueWithoutPair && traceCompleteWithoutPair) continue;
      results[leftIndex]!.redundantWithClueIds.push(clues[rightIndex]!.id);
      results[rightIndex]!.redundantWithClueIds.push(clues[leftIndex]!.id);
    }
  }
  return results;
}

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
  unavailable?: number;
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
type AuditPuzzleGenerator = (template: PuzzleTemplate, seed: string) => GeneratedPuzzle;
type DifficultyAuditOptions = { sampleSize?: number; seedPrefix?: string; onProgress?: DifficultyAuditProgressCallback; generator?: AuditPuzzleGenerator };

function auditFromOptions(
  template: PuzzleTemplate,
  options: DifficultyAuditOptions,
  generator: AuditPuzzleGenerator,
): DifficultyCorpusAudit {
  const sampleSize = options.sampleSize ?? template.metadata?.difficultyCalibration.corpus.sampleSize ?? 1_000;
  const seedPrefix = options.seedPrefix ?? "difficulty-audit";
  if (!Number.isInteger(sampleSize) || sampleSize < 1) throw new RangeError("sampleSize must be a positive integer");
  return auditCorpusWithGenerator(template, sampleSize, seedPrefix, generator, options.onProgress);
}

export function auditDifficultyCorpus(template: PuzzleTemplate, options: DifficultyAuditOptions = {}): DifficultyCorpusAudit {
  return auditFromOptions(template, options, options.generator ?? ((candidateTemplate, seed) => generatePuzzle(candidateTemplate, seed, undefined, { difficultyModel: DEFAULT_DIFFICULTY_MODEL })));
}

/** Report the no-target distribution returned by the latest API generation path (v5 by default). */
export function auditProductionDifficultyCorpus(template: PuzzleTemplate, options: DifficultyAuditOptions = {}): DifficultyCorpusAudit {
  return auditFromOptions(template, options, options.generator ?? ((candidateTemplate, seed) => generatePuzzleForRequest(candidateTemplate, seed)));
}

function auditCorpusWithGenerator(
  template: PuzzleTemplate,
  sampleSize: number,
  seedPrefix: string,
  generator: AuditPuzzleGenerator,
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
    modelVersion: modelVersion ?? DEFAULT_DIFFICULTY_MODEL_VERSION,
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
  generateTargeted: TargetedPuzzleGenerator = (candidateTemplate, seed, level) => generatePuzzleForRequest(candidateTemplate, seed, level, true),
): { records: DifficultyAuditRecord[]; fallbackAttempts: number[]; unavailable: number; modelVersion: string } {
  const records: DifficultyAuditRecord[] = [];
  const fallbackAttempts: number[] = [];
  let unavailable = 0;
  let modelVersion: string | undefined;
  for (let index = 0; index < sampleSize; index += 1) {
    try {
      const puzzle = generateTargeted(template, `${seedPrefix}-${requestedDifficultyLevel}-${index}`, requestedDifficultyLevel);
      modelVersion ??= puzzle.difficulty.modelVersion;
      records.push({ level: puzzle.difficulty.level, humanTraceComplete: puzzle.difficulty.evidence.humanSolve.solved, clueCount: puzzle.clues.length });
      if (puzzle.seedFallbackAttempt !== undefined) fallbackAttempts.push(puzzle.seedFallbackAttempt);
    } catch (error) {
      if (!(error instanceof DifficultyUnavailableError)) throw error;
      unavailable += 1;
    }
    onProgress?.({ phase: "targeted", templateId: template.id, requestedDifficultyLevel, completed: index + 1, total: sampleSize });
  }
  return { records, fallbackAttempts, unavailable, modelVersion: modelVersion ?? DEFAULT_DIFFICULTY_MODEL_VERSION };
}

export type TargetedPuzzleGenerator = (template: PuzzleTemplate, seed: string, level: Difficulty["level"]) => GeneratedPuzzle;

export function auditTargetedDifficultyLevel(
  template: PuzzleTemplate,
  requestedDifficultyLevel: Difficulty["level"],
  options: { sampleSize?: number; seedPrefix?: string; onProgress?: DifficultyAuditProgressCallback; generateTargeted?: TargetedPuzzleGenerator } = {},
): TargetedDifficultyLevelResult {
  const sampleSize = options.sampleSize ?? template.metadata?.difficultyCalibration.corpus.sampleSize ?? 1_000;
  const seedPrefix = options.seedPrefix ?? "targeted-difficulty-audit";
  if (!Number.isInteger(sampleSize) || sampleSize < 1) throw new RangeError("sampleSize must be a positive integer");
  const [minimumLevel, maximumLevel] = template.metadata?.difficultyCalibration.levelRange ?? [1, 12];
  if (requestedDifficultyLevel < minimumLevel || requestedDifficultyLevel > maximumLevel) {
    throw new RangeError(`${template.id} does not advertise difficulty level ${requestedDifficultyLevel}`);
  }

  const { records, fallbackAttempts, unavailable, modelVersion } = collectTargetedDifficultySamples(
    template,
    requestedDifficultyLevel,
    sampleSize,
    seedPrefix,
    options.onProgress,
    options.generateTargeted ?? ((candidateTemplate, seed, level) => generatePuzzleForRequest(candidateTemplate, seed, level, true)),
  );
  const statistics = records.length > 0
    ? aggregateDifficultyAuditRecords(records)
    : { levelCounts: Array<number>(12).fill(0), humanTrace: { complete: 0, incomplete: 0 }, clues: { average: 0, minimum: 0, maximum: 0 } };
  return {
    modelVersion,
    level: {
      requestedDifficultyLevel,
      generated: records.length,
      unavailable,
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
  const modelVersion = results[0]?.modelVersion ?? DEFAULT_DIFFICULTY_MODEL_VERSION;
  const levels = results.map(result => result.level);
  return { templateId: template.id, modelVersion, sampleSize, seedPrefix, levels };
}
