import type { GeneratedPuzzle } from "../domain/types.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface PuzzleTokenPayload {
  version: 1;
  templateId: string;
  seed: string;
  generatorVersion: string;
  solverVersion: string;
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

async function signingKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function signature(secret: string, encodedPayload: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(secret), encoder.encode(encodedPayload)));
}

export async function issuePuzzleToken(puzzle: GeneratedPuzzle, secret: string): Promise<string> {
  const payload: PuzzleTokenPayload = {
    version: 1,
    templateId: puzzle.templateId,
    seed: puzzle.seed,
    generatorVersion: puzzle.generatorVersion,
    solverVersion: puzzle.solverVersion,
  };
  const encodedPayload = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  return `${encodedPayload}.${base64UrlEncode(await signature(secret, encodedPayload))}`;
}

export async function verifyPuzzleToken(token: string, secret: string): Promise<PuzzleTokenPayload | undefined> {
  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra) return undefined;
  const suppliedSignature = base64UrlDecode(encodedSignature);
  const rawPayload = base64UrlDecode(encodedPayload);
  if (!suppliedSignature || !rawPayload) return undefined;
  const valid = await crypto.subtle.verify("HMAC", await signingKey(secret), suppliedSignature as unknown as BufferSource, encoder.encode(encodedPayload));
  if (!valid) return undefined;
  try {
    const value: unknown = JSON.parse(decoder.decode(rawPayload));
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const payload = value as Record<string, unknown>;
    if (payload.version !== 1 || typeof payload.templateId !== "string" || typeof payload.seed !== "string" || typeof payload.generatorVersion !== "string" || typeof payload.solverVersion !== "string") return undefined;
    return payload as unknown as PuzzleTokenPayload;
  } catch {
    return undefined;
  }
}
