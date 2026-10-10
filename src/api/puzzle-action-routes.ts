import type { PuzzleTemplate } from "../domain/types.js";
import { puzzleFromToken, puzzleHint, verifyPuzzleAnswer, type HintKind } from "./puzzle-actions.js";
import { json } from "./json-response.js";
import { badRequest, readJsonBody } from "./request-utils.js";

function requestedHintKind(value: unknown): HintKind {
  const kind = value === undefined ? "clue" : value;
  if (kind !== "clue" && kind !== "elimination") throw new TypeError("kind must be clue or elimination");
  return kind;
}

function requestedHintIndex(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 100) {
    throw new TypeError("hintIndex must be an integer from 0 to 100");
  }
  return value;
}

async function protectedPuzzle(request: Request, templates: Map<string, PuzzleTemplate>, secrets: readonly string[]) {
  const body = await readJsonBody(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new TypeError("request body must be an object");
  const value = body as Record<string, unknown>;
  if (typeof value.puzzleToken !== "string" || !value.puzzleToken) throw new TypeError("puzzleToken must be a non-empty string");
  return { value, puzzle: await puzzleFromToken(value.puzzleToken, templates, secrets) };
}

function rejectUnknownFields(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).find(name => !allowed.includes(name));
  if (unknown !== undefined) throw new TypeError("unknown field " + unknown);
}

export async function hintRoute(request: Request, templates: Map<string, PuzzleTemplate>, secrets: readonly string[]): Promise<Response> {
  if (secrets.length === 0) return json({ error: { code: "not_configured", message: "puzzle hints are not configured" } }, 503);
  try {
    const { value, puzzle } = await protectedPuzzle(request, templates, secrets);
    rejectUnknownFields(value, ["puzzleToken", "kind", "hintIndex"]);
    return json(puzzleHint(puzzle, requestedHintKind(value.kind), requestedHintIndex(value.hintIndex)));
  } catch (error) {
    return badRequest(error);
  }
}

export async function verificationRoute(request: Request, templates: Map<string, PuzzleTemplate>, secrets: readonly string[]): Promise<Response> {
  if (secrets.length === 0) return json({ error: { code: "not_configured", message: "puzzle verification is not configured" } }, 503);
  try {
    const body = await readJsonBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new TypeError("request body must be an object");
    const value = body as Record<string, unknown>;
    rejectUnknownFields(value, ["puzzleToken", "answer"]);
    if (typeof value.puzzleToken !== "string" || !value.puzzleToken) throw new TypeError("puzzleToken must be a non-empty string");
    if (!("answer" in value)) throw new TypeError("answer is required");
    const puzzle = await puzzleFromToken(value.puzzleToken, templates, secrets);
    return json({ correct: verifyPuzzleAnswer(puzzle, value.answer) });
  } catch (error) {
    return badRequest(error);
  }
}
