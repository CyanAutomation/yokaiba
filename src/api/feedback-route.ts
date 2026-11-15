import type { DifficultyLevel, PuzzleTemplate } from "../domain/types.js";
import { json } from "./json-response.js";
import { badRequest, readJsonBody } from "./request-utils.js";
import { verifyPuzzleToken, type PuzzleTokenSecrets } from "./puzzle-token.js";

const FEEDBACK_RATINGS = ["too_easy", "just_right", "too_hard"] as const;
const FEEDBACK_REASONS = ["difficult_to_start", "confusing_clues", "too_many_deductions", "took_too_long", "other"] as const;
const FEEDBACK_OUTCOMES = ["completed", "in_progress"] as const;

export type FeedbackRating = typeof FEEDBACK_RATINGS[number];
export type FeedbackReason = typeof FEEDBACK_REASONS[number];
export type FeedbackOutcome = typeof FEEDBACK_OUTCOMES[number];

export interface PuzzleFeedbackRecord {
  idempotencyKey: string;
  puzzleFingerprint: string;
  templateId: string;
  requestedSeed: string;
  seed: string;
  requestedLevel: DifficultyLevel | null;
  assessedLevel: DifficultyLevel;
  difficultyModelVersion: string;
  generatorVersion: string;
  generationMetadata: Record<string, unknown>;
  rating: FeedbackRating;
  reason: FeedbackReason | null;
  outcome: FeedbackOutcome;
  hintsUsed: number;
  mistakes: number;
  elapsedMs: number | null;
  smartMarkingEnabled: boolean | null;
  submittedAt: string;
}

export type FeedbackWriteResult = "inserted" | "duplicate" | "conflict";
export type FeedbackSink = (feedback: PuzzleFeedbackRecord) => Promise<FeedbackWriteResult> | FeedbackWriteResult;

const MAX_FEEDBACK_BODY_BYTES = 4 * 1024;
const MAX_PUZZLE_TOKEN_LENGTH = 3_000;
const MAX_GAMEPLAY_COUNT = 100;
const MAX_ELAPSED_MS = 86_400_000;
const IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FEEDBACK_FIELDS = new Set([
  "puzzleToken", "rating", "reason", "outcome", "hintsUsed", "mistakes", "elapsedMs", "smartMarkingEnabled", "idempotencyKey",
]);

interface ParsedSubmission {
  puzzleToken: string;
  rating: FeedbackRating;
  reason: FeedbackReason | null;
  outcome: FeedbackOutcome;
  idempotencyKey: string;
  hintsUsed: number;
  mistakes: number;
  elapsedMs: number | null;
  smartMarkingEnabled: boolean | null;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("request body must be an object");
  return value as Record<string, unknown>;
}

function boundedInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} is outside its supported range`);
  }
  return value;
}

function assertKnownFeedbackFields(body: Record<string, unknown>): void {
  const unexpected = Object.keys(body).find(key => !FEEDBACK_FIELDS.has(key));
  if (unexpected) throw new TypeError("request body contains an unknown field");
}

function parsePuzzleToken(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_PUZZLE_TOKEN_LENGTH) {
    throw new TypeError("puzzleToken must be a bounded non-empty string");
  }
  return value;
}

function parseRating(value: unknown): FeedbackRating {
  if (typeof value !== "string" || !FEEDBACK_RATINGS.includes(value as FeedbackRating)) {
    throw new TypeError("rating must be too_easy, just_right, or too_hard");
  }
  return value as FeedbackRating;
}

function parseReason(value: unknown, rating: FeedbackRating): FeedbackReason | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || !FEEDBACK_REASONS.includes(value as FeedbackReason)) {
    throw new TypeError("reason is not supported");
  }
  if (rating !== "too_hard") throw new TypeError("reason is only allowed with too_hard");
  return value as FeedbackReason;
}

function parseOutcome(value: unknown): FeedbackOutcome {
  if (typeof value !== "string" || !FEEDBACK_OUTCOMES.includes(value as FeedbackOutcome)) {
    throw new TypeError("outcome must be completed or in_progress");
  }
  return value as FeedbackOutcome;
}

function parseIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new TypeError("idempotencyKey must be a UUID v4");
  }
  return value;
}

function parseElapsedTime(value: unknown): number | null {
  return value === undefined ? null : boundedInteger(value, "elapsedMs", 0, MAX_ELAPSED_MS);
}

function parseSmartMarking(value: unknown): boolean | null {
  if (value === undefined) return null;
  if (typeof value !== "boolean") throw new TypeError("smartMarkingEnabled must be a boolean");
  return value;
}

function parseSubmission(value: unknown): ParsedSubmission {
  const body = record(value);
  assertKnownFeedbackFields(body);
  const puzzleToken = parsePuzzleToken(body.puzzleToken);
  const rating = parseRating(body.rating);
  const reason = parseReason(body.reason, rating);
  const outcome = parseOutcome(body.outcome);
  const idempotencyKey = parseIdempotencyKey(body.idempotencyKey);
  const hintsUsed = boundedInteger(body.hintsUsed, "hintsUsed", 0, MAX_GAMEPLAY_COUNT);
  const mistakes = boundedInteger(body.mistakes, "mistakes", 0, MAX_GAMEPLAY_COUNT);
  return {
    puzzleToken,
    rating,
    reason,
    outcome,
    idempotencyKey,
    hintsUsed,
    mistakes,
    elapsedMs: parseElapsedTime(body.elapsedMs),
    smartMarkingEnabled: parseSmartMarking(body.smartMarkingEnabled),
  };
}

export async function feedbackRoute(
  request: Request,
  templates: Map<string, PuzzleTemplate>,
  secrets: PuzzleTokenSecrets,
  saveFeedback?: FeedbackSink,
  now: () => number = Date.now,
): Promise<Response> {
  if (!saveFeedback) return json({ error: { code: "not_configured", message: "puzzle feedback storage is not configured" } }, 503);
  let submission: ParsedSubmission;
  try {
    submission = parseSubmission(await readJsonBody(request, MAX_FEEDBACK_BODY_BYTES));
  } catch (error) {
    return badRequest(error);
  }
  let token;
  try {
    token = await verifyPuzzleToken(submission.puzzleToken, secrets);
  } catch {
    return badRequest(new TypeError("puzzleToken is invalid"));
  }
  if (!token || token.version !== 4) return badRequest(new TypeError("puzzleToken is invalid or does not support feedback"));
  if (!templates.has(token.templateId)) return badRequest(new TypeError("puzzleToken references an unknown template"));
  const feedback: PuzzleFeedbackRecord = {
    idempotencyKey: submission.idempotencyKey,
    puzzleFingerprint: token.puzzleFingerprint,
    templateId: token.templateId,
    requestedSeed: token.requestedSeed,
    seed: token.seed,
    requestedLevel: token.requestedDifficultyLevel ?? null,
    assessedLevel: token.assessedDifficultyLevel,
    difficultyModelVersion: token.difficultyModelVersion,
    generatorVersion: token.generatorVersion,
    generationMetadata: {
      fingerprintVersion: 1,
      solverVersion: token.solverVersion,
      difficultyModel: token.difficultyModel ?? "v4",
      ...(token.generationStrategy === undefined ? {} : { generationStrategy: token.generationStrategy }),
      ...(token.seedFallbackAttempt === undefined ? {} : { seedFallbackAttempt: token.seedFallbackAttempt }),
      requestedSeed: token.requestedSeed,
      seed: token.seed,
    },
    rating: submission.rating,
    reason: submission.reason,
    outcome: submission.outcome,
    hintsUsed: submission.hintsUsed,
    mistakes: submission.mistakes,
    elapsedMs: submission.elapsedMs,
    smartMarkingEnabled: submission.smartMarkingEnabled,
    submittedAt: new Date(now()).toISOString(),
  };
  try {
    const result = await saveFeedback(feedback);
    if (result === "conflict") return json({ error: { code: "idempotency_conflict", message: "This submission key was already used for different feedback" } }, 409);
    return json({ accepted: true, duplicate: result === "duplicate" }, result === "duplicate" ? 200 : 202);
  } catch {
    console.error(JSON.stringify({ event: "puzzle_feedback_storage_failure" }));
    return json({ error: { code: "storage_unavailable", message: "puzzle feedback storage is unavailable" } }, 503);
  }
}
