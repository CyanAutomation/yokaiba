import type { DifficultyLevel, GeneratedPuzzle } from "../domain/types.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const DEFAULT_PUZZLE_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
export const MAX_PUZZLE_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

interface PuzzleTokenFields {
  templateId: string;
  seed: string;
  generatorVersion: string;
  solverVersion: string;
  requestedDifficultyLevel?: DifficultyLevel;
}

export interface PuzzleTokenPayload extends PuzzleTokenFields {
  version: 3;
  issuedAt: number;
  expiresAt: number;
}

/** Unexpired v2 tokens remain valid under the current key for sessions created before expiry was added. */
export interface LegacyPuzzleTokenPayload extends PuzzleTokenFields {
  version: 2;
}

export type VerifiedPuzzleTokenPayload = PuzzleTokenPayload | LegacyPuzzleTokenPayload;
export type PuzzleTokenSecrets = string | readonly string[];

export interface IssuePuzzleTokenOptions {
  /** Unix time in seconds; injectable to make expiry behavior deterministic in tests. */
  now?: number;
  ttlSeconds?: number;
}

function base64UrlEncode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasTokenTextFields(payload: Record<string, unknown>): payload is Record<string, unknown> & PuzzleTokenFields {
  return nonEmptyString(payload.templateId)
    && nonEmptyString(payload.seed)
    && nonEmptyString(payload.generatorVersion)
    && nonEmptyString(payload.solverVersion);
}

function hasValidDifficulty(value: unknown): value is DifficultyLevel | undefined {
  return value === undefined || (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 12);
}

function isPuzzleTokenPayload(value: unknown): value is VerifiedPuzzleTokenPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  if (!hasTokenTextFields(payload) || !hasValidDifficulty(payload.requestedDifficultyLevel)) return false;
  if (payload.version === 2) return true;
  return payload.version === 3
    && Number.isSafeInteger(payload.issuedAt)
    && Number.isSafeInteger(payload.expiresAt)
    && (payload.expiresAt as number) > (payload.issuedAt as number)
    && (payload.expiresAt as number) - (payload.issuedAt as number) <= MAX_PUZZLE_TOKEN_TTL_SECONDS;
}

function decodePayload(encodedPayload: string): unknown | undefined {
  const rawPayload = base64UrlDecode(encodedPayload);
  if (!rawPayload) return undefined;
  try {
    return JSON.parse(decoder.decode(rawPayload)) as unknown;
  } catch {
    return undefined;
  }
}

async function signingKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function signature(secret: string, encodedPayload: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(secret), encoder.encode(encodedPayload)));
}

async function isValidSignature(encodedPayload: string, encodedSignature: string, secret: string): Promise<boolean> {
  const suppliedSignature = base64UrlDecode(encodedSignature);
  if (!suppliedSignature) return false;
  try {
    return await crypto.subtle.verify(
      "HMAC",
      await signingKey(secret),
      suppliedSignature as unknown as BufferSource,
      encoder.encode(encodedPayload),
    );
  } catch {
    return false;
  }
}

function secretList(secrets: PuzzleTokenSecrets): string[] {
  const values = typeof secrets === "string" ? [secrets] : [...secrets];
  return [...new Set(values.filter(value => typeof value === "string" && value.length > 0))];
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
  return `${encodedPayload}.${base64UrlEncode(await signature(secret, encodedPayload))}`;
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
  const keys = secretList(secrets);
  for (let index = 0; index < keys.length; index += 1) {
    if (!await isValidSignature(encodedPayload, encodedSignature, keys[index]!)) continue;
    const payload = decodePayload(encodedPayload);
    if (!isPuzzleTokenPayload(payload)) return undefined;
    // Legacy tokens had no expiry. A previous key retains them only for the
    // operator-controlled rotation grace period; removing that key ends it.
    if (payload.version === 2) return payload;
    if (payload.issuedAt > now || payload.expiresAt <= now) return undefined;
    return payload;
  }
  return undefined;
}
