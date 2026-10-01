import type { DifficultyLevel, GeneratedPuzzle } from "../domain/types.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface PuzzleTokenPayload {
  version: 2;
  templateId: string;
  seed: string;
  generatorVersion: string;
  solverVersion: string;
  requestedDifficultyLevel?: DifficultyLevel;
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

function hasTokenTextFields(payload: Record<string, unknown>): boolean {
  return nonEmptyString(payload.templateId)
    && nonEmptyString(payload.seed)
    && nonEmptyString(payload.generatorVersion)
    && nonEmptyString(payload.solverVersion);
}

function hasValidDifficulty(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 12);
}

function isPuzzleTokenPayload(value: unknown): value is PuzzleTokenPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return payload.version === 2 && hasTokenTextFields(payload) && hasValidDifficulty(payload.requestedDifficultyLevel);
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

async function signingKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function signature(secret: string, encodedPayload: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(secret), encoder.encode(encodedPayload)));
}

export async function issuePuzzleToken(puzzle: GeneratedPuzzle, secret: string): Promise<string> {
  const payload: PuzzleTokenPayload = {
    version: 2,
    templateId: puzzle.templateId,
    seed: puzzle.seed,
    generatorVersion: puzzle.generatorVersion,
    solverVersion: puzzle.solverVersion,
    ...(puzzle.requestedDifficultyLevel === undefined ? {} : { requestedDifficultyLevel: puzzle.requestedDifficultyLevel }),
  };
  const encodedPayload = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  return `${encodedPayload}.${base64UrlEncode(await signature(secret, encodedPayload))}`;
}

export async function verifyPuzzleToken(token: string, secret: string): Promise<PuzzleTokenPayload | undefined> {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
  const [encodedPayload, encodedSignature] = parts as [string, string];
  if (!await isValidSignature(encodedPayload, encodedSignature, secret)) return undefined;
  const payload = decodePayload(encodedPayload);
  return isPuzzleTokenPayload(payload) ? payload : undefined;
}
