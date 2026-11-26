import type { FeedbackSink } from "./feedback-route.js";
import type { PuzzleSolver } from "../domain/puzzle-solver.js";

export interface RestRouterOptions {
  /** Required to issue tamper-proof puzzle tokens for server-side verification. */
  puzzleTokenSecret?: string;
  /** Previous HMAC keys may verify existing, unexpired v3 and v4 tokens during rotation. */
  puzzleTokenPreviousSecrets?: readonly string[];
  /** New token lifetime. Defaults to seven days and is capped at 30 days. */
  puzzleTokenTtlSeconds?: number;
  serviceVersion?: string;
  buildSha?: string;
  /** Optional deterministic solver implementation for generation and version reporting. */
  solver?: PuzzleSolver;
  /** Solver identity reported before a backend is loaded, such as on /v1/version. */
  solverVersion?: string;
  /** Durable anonymous outcome sink. The endpoint returns 202 only after this accepts the event. */
  recordOutcome?: (event: Record<string, unknown>) => void | Promise<void>;
  /** Durable anonymous puzzle-difficulty feedback sink. */
  recordFeedback?: FeedbackSink;
}
