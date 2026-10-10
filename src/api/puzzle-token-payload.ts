import type { DifficultyLevel } from "../domain/types.js";
import { base64UrlDecode } from "./puzzle-token-crypto.js";

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

const decoder = new TextDecoder();

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

export function decodePuzzleTokenPayload(encodedPayload: string): VerifiedPuzzleTokenPayload | undefined {
  const rawPayload = base64UrlDecode(encodedPayload);
  if (!rawPayload) return undefined;
  try {
    const payload: unknown = JSON.parse(decoder.decode(rawPayload));
    return isPuzzleTokenPayload(payload) ? payload : undefined;
  } catch {
    return undefined;
  }
}
