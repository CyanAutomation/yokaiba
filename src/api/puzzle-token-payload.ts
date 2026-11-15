import type { DifficultyLevel } from "../domain/types.js";
import { base64UrlDecode } from "./puzzle-token-crypto.js";

export const MAX_PUZZLE_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

interface PuzzleTokenFields {
  templateId: string;
  seed: string;
  generatorVersion: string;
  solverVersion: string;
  requestedDifficultyLevel?: DifficultyLevel;
  /** Omitted historical tokens always replay through the v4 selection policy. */
  difficultyModel?: "v4" | "v5" | "compare";
}

export interface LegacyPuzzleTokenPayloadV3 extends PuzzleTokenFields {
  version: 3;
  issuedAt: number;
  expiresAt: number;
}

export interface PuzzleTokenPayload extends PuzzleTokenFields {
  version: 4;
  requestedSeed: string;
  puzzleFingerprint: string;
  assessedDifficultyLevel: DifficultyLevel;
  difficultyModelVersion: string;
  generationStrategy?: number;
  seedFallbackAttempt?: number;
  issuedAt: number;
  expiresAt: number;
}

export type VerifiedPuzzleTokenPayload = PuzzleTokenPayload | LegacyPuzzleTokenPayloadV3;

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

function hasValidDifficultyModel(value: unknown): boolean {
  return value === undefined || value === "v4" || value === "v5" || value === "compare";
}

function hasValidExpiryWindow(payload: Record<string, unknown>): boolean {
  if (!Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt)) return false;
  const issuedAt = payload.issuedAt as number;
  const expiresAt = payload.expiresAt as number;
  return expiresAt > issuedAt && expiresAt - issuedAt <= MAX_PUZZLE_TOKEN_TTL_SECONDS;
}

function hasValidLegacyClaims(payload: Record<string, unknown>): boolean {
  return payload.version === 3 && hasValidExpiryWindow(payload);
}

function hasValidOptionalCounter(value: unknown): boolean {
  return value === undefined || (Number.isSafeInteger(value) && (value as number) >= 0);
}

function hasValidCurrentClaims(payload: Record<string, unknown>): boolean {
  return payload.version === 4
    && nonEmptyString(payload.requestedSeed)
    && typeof payload.puzzleFingerprint === "string"
    && /^[a-f0-9]{64}$/.test(payload.puzzleFingerprint)
    && typeof payload.assessedDifficultyLevel === "number"
    && hasValidDifficulty(payload.assessedDifficultyLevel)
    && nonEmptyString(payload.difficultyModelVersion)
    && hasValidOptionalCounter(payload.generationStrategy)
    && hasValidOptionalCounter(payload.seedFallbackAttempt)
    && hasValidExpiryWindow(payload);
}

function isPuzzleTokenPayload(value: unknown): value is VerifiedPuzzleTokenPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  if (!hasTokenTextFields(payload) || !hasValidDifficulty(payload.requestedDifficultyLevel)
    || !hasValidDifficultyModel(payload.difficultyModel)) return false;
  return hasValidLegacyClaims(payload) || hasValidCurrentClaims(payload);
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
