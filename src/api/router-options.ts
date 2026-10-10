export interface RestRouterOptions {
  /** Required to issue tamper-proof puzzle tokens for server-side verification. */
  puzzleTokenSecret?: string;
  /** Previous HMAC keys may verify existing, unexpired v3 tokens during rotation. */
  puzzleTokenPreviousSecrets?: readonly string[];
  /** New token lifetime. Defaults to seven days and is capped at 30 days. */
  puzzleTokenTtlSeconds?: number;
  serviceVersion?: string;
  buildSha?: string;
  /** Durable anonymous outcome sink. The endpoint returns 202 only after this accepts the event. */
  recordOutcome?: (event: Record<string, unknown>) => void | Promise<void>;
}
