import type { GeneratedPuzzle } from "../domain/types.js";
import { base64UrlEncode, isValidTokenSignature, signTokenPayload, tokenSecretList } from "./puzzle-token-crypto.js";
import { decodePuzzleTokenPayload, MAX_PUZZLE_TOKEN_TTL_SECONDS, type PuzzleTokenPayload, type VerifiedPuzzleTokenPayload } from "./puzzle-token-payload.js";
export { MAX_PUZZLE_TOKEN_TTL_SECONDS } from "./puzzle-token-payload.js";
export type { PuzzleTokenPayload, VerifiedPuzzleTokenPayload } from "./puzzle-token-payload.js";

const encoder = new TextEncoder();
export const DEFAULT_PUZZLE_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
export type PuzzleTokenSecrets = string | readonly string[];

export interface IssuePuzzleTokenOptions {
  /** Unix time in seconds; injectable to make expiry behavior deterministic in tests. */
  now?: number;
  ttlSeconds?: number;
}

export async function issuePuzzleToken(
  puzzle: GeneratedPuzzle,
  secret: string,
  options: IssuePuzzleTokenOptions = {},
): Promise<string> {
  const issuedAt = options.now ?? Math.floor(Date.now() / 1_000);
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_PUZZLE_TOKEN_TTL_SECONDS;
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) throw new TypeError("token issue time must be a non-negative integer");
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_PUZZLE_TOKEN_TTL_SECONDS) {
    throw new TypeError(`token lifetime must be between 1 and ${MAX_PUZZLE_TOKEN_TTL_SECONDS} seconds`);
  }
  const payload: PuzzleTokenPayload = {
    version: 3,
    templateId: puzzle.templateId,
    seed: puzzle.seed,
    generatorVersion: puzzle.generatorVersion,
    solverVersion: puzzle.solverVersion,
    issuedAt,
    expiresAt: issuedAt + ttlSeconds,
    ...(puzzle.requestedDifficultyLevel === undefined ? {} : { requestedDifficultyLevel: puzzle.requestedDifficultyLevel }),
  };
  const encodedPayload = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  return `${encodedPayload}.${base64UrlEncode(await signTokenPayload(secret, encodedPayload))}`;
}

/** Verify with the active key and optional previous keys during a bounded rotation window. */
export async function verifyPuzzleToken(
  token: string,
  secrets: PuzzleTokenSecrets,
  now = Math.floor(Date.now() / 1_000),
): Promise<VerifiedPuzzleTokenPayload | undefined> {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
  const [encodedPayload, encodedSignature] = parts as [string, string];
  const keys = tokenSecretList(secrets);
  for (let index = 0; index < keys.length; index += 1) {
    if (!await isValidTokenSignature(encodedPayload, encodedSignature, keys[index]!)) continue;
    const payload = decodePuzzleTokenPayload(encodedPayload);
    if (!payload) return undefined;
    // Legacy tokens had no expiry. A previous key retains them only for the
    // operator-controlled rotation grace period; removing that key ends it.
    if (payload.version === 2) return payload;
    if (payload.issuedAt > now || payload.expiresAt <= now) return undefined;
    return payload;
  }
  return undefined;
}
