import type { FeedbackSink, PuzzleFeedbackRecord } from "../src/api/feedback-route.js";

interface FeedbackRow {
  puzzle_fingerprint: string;
  template_id: string;
  requested_level: number | null;
  assessed_level: number;
  difficulty_model_version: string;
  generator_version: string;
  generation_metadata: string;
  rating: string;
  reason: string | null;
  outcome: string;
  hints_used: number;
  mistakes: number;
  elapsed_ms: number | null;
  smart_marking_enabled: number | null;
}

type ComparableFeedback = Pick<FeedbackRow,
  | "puzzle_fingerprint"
  | "template_id"
  | "requested_level"
  | "assessed_level"
  | "difficulty_model_version"
  | "generator_version"
  | "generation_metadata"
  | "rating"
  | "reason"
  | "outcome"
  | "hints_used"
  | "mistakes"
  | "elapsed_ms"
  | "smart_marking_enabled"
>;

interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  run(): Promise<{ meta?: { changes?: number } }>;
  first<T>(): Promise<T | null>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1StatementLike;
}

function databaseValues(feedback: PuzzleFeedbackRecord): unknown[] {
  return [
    crypto.randomUUID(),
    feedback.idempotencyKey,
    feedback.puzzleFingerprint,
    feedback.templateId,
    feedback.requestedLevel,
    feedback.assessedLevel,
    feedback.difficultyModelVersion,
    feedback.generatorVersion,
    JSON.stringify(feedback.generationMetadata),
    feedback.rating,
    feedback.reason,
    feedback.outcome,
    feedback.hintsUsed,
    feedback.mistakes,
    feedback.elapsedMs,
    feedback.smartMarkingEnabled === null ? null : Number(feedback.smartMarkingEnabled),
    feedback.submittedAt,
  ];
}

function comparableStoredFeedback(row: FeedbackRow): ComparableFeedback {
  return {
    puzzle_fingerprint: row.puzzle_fingerprint,
    template_id: row.template_id,
    requested_level: row.requested_level,
    assessed_level: row.assessed_level,
    difficulty_model_version: row.difficulty_model_version,
    generator_version: row.generator_version,
    generation_metadata: row.generation_metadata,
    rating: row.rating,
    reason: row.reason,
    outcome: row.outcome,
    hints_used: row.hints_used,
    mistakes: row.mistakes,
    elapsed_ms: row.elapsed_ms,
    smart_marking_enabled: row.smart_marking_enabled,
  };
}

function comparableSubmittedFeedback(feedback: PuzzleFeedbackRecord): ComparableFeedback {
  return {
    puzzle_fingerprint: feedback.puzzleFingerprint,
    template_id: feedback.templateId,
    requested_level: feedback.requestedLevel,
    assessed_level: feedback.assessedLevel,
    difficulty_model_version: feedback.difficultyModelVersion,
    generator_version: feedback.generatorVersion,
    generation_metadata: JSON.stringify(feedback.generationMetadata),
    rating: feedback.rating,
    reason: feedback.reason,
    outcome: feedback.outcome,
    hints_used: feedback.hintsUsed,
    mistakes: feedback.mistakes,
    elapsed_ms: feedback.elapsedMs,
    smart_marking_enabled: feedback.smartMarkingEnabled === null ? null : Number(feedback.smartMarkingEnabled),
  };
}

function matchesExisting(row: FeedbackRow, feedback: PuzzleFeedbackRecord): boolean {
  const stored = comparableStoredFeedback(row);
  const submitted = comparableSubmittedFeedback(feedback);
  return (Object.keys(submitted) as Array<keyof ComparableFeedback>).every(key => stored[key] === submitted[key]);
}

/** Durable sink with unique idempotency keys; retries with changed payloads are conflicts. */
export function createPuzzleFeedbackSink(database: D1DatabaseLike): FeedbackSink {
  return async feedback => {
    const result = await database.prepare(`
      INSERT INTO puzzle_feedback (
        id, idempotency_key, puzzle_fingerprint, template_id, requested_level,
        assessed_level, difficulty_model_version, generator_version, generation_metadata,
        rating, reason, outcome, hints_used, mistakes, elapsed_ms, smart_marking_enabled, submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO NOTHING
    `).bind(...databaseValues(feedback)).run();
    if (result.meta?.changes === 1) return "inserted";

    const existing = await database.prepare(`
      SELECT puzzle_fingerprint, template_id, requested_level, assessed_level,
        difficulty_model_version, generator_version, generation_metadata,
        rating, reason, outcome, hints_used, mistakes, elapsed_ms, smart_marking_enabled
      FROM puzzle_feedback WHERE idempotency_key = ? LIMIT 1
    `).bind(feedback.idempotencyKey).first<FeedbackRow>();
    if (!existing) throw new Error("idempotency row was not available after insert conflict");
    return matchesExisting(existing, feedback) ? "duplicate" : "conflict";
  };
}
