import { generatePuzzle } from "../generation/generator.js";
import { issuePuzzleToken, verifyPuzzleToken } from "./puzzle-token.js";
import type { Difficulty, GeneratedPuzzle, PuzzleSpec, PuzzleTemplate, Solution } from "../domain/types.js";

const MAX_GENERATION_FIELD_LENGTH = 128;
const MAX_GENERATION_BODY_BYTES = 16 * 1024;
const MAX_DIFFICULTY_SEARCH_ATTEMPTS = 128;
// Generator releases can change a puzzle's representation. Keep browser and edge
// caches short-lived, and require revalidation instead of promising immutability.
const GENERATED_PUZZLE_CACHE_CONTROL = "public, max-age=300, s-maxage=300, must-revalidate";

const json = (body: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", ...headers },
});

export interface RestRouterOptions {
  /** Required to issue tamper-proof puzzle tokens for server-side verification. */
  puzzleTokenSecret?: string;
  serviceVersion?: string;
  buildSha?: string;
}

/** Read bounded bytes instead of trusting a spoofable or absent Content-Length header. */
async function readJsonBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_GENERATION_BODY_BYTES) throw new TypeError("request body is too large");
  if (!request.body) throw new TypeError("request body must be valid JSON");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_GENERATION_BODY_BYTES) {
        await reader.cancel();
        throw new TypeError("request body is too large");
      }
      chunks.push(value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new TypeError("request body must be valid JSON");
  } finally {
    reader.releaseLock();
  }
}
}

async function publicPuzzle(puzzle: GeneratedPuzzle, puzzleTokenSecret?: string) {
  const { solution: _solution, spec, ...rest } = puzzle;
  return { ...rest, spec, ...(puzzleTokenSecret ? { puzzleToken: await issuePuzzleToken(puzzle, puzzleTokenSecret) } : {}) };
}

function generationParameters(value: Record<string, unknown>) {
  if (typeof value.templateId !== "string" || !value.templateId.trim()) throw new TypeError("templateId must be a non-empty string");
  if (typeof value.seed !== "string" || !value.seed.trim()) throw new TypeError("seed must be a non-empty string");
  if (value.templateId.length > MAX_GENERATION_FIELD_LENGTH) throw new TypeError(`templateId must be at most ${MAX_GENERATION_FIELD_LENGTH} characters`);
  if (value.seed.length > MAX_GENERATION_FIELD_LENGTH) throw new TypeError(`seed must be at most ${MAX_GENERATION_FIELD_LENGTH} characters`);
  const difficultyLevel = value.difficultyLevel;
  if (difficultyLevel !== undefined && (typeof difficultyLevel !== "number" || !Number.isInteger(difficultyLevel) || difficultyLevel < 1 || difficultyLevel > 5)) throw new TypeError("difficultyLevel must be an integer from 1 to 5");
  return { templateId: value.templateId, seed: value.seed, ...(difficultyLevel === undefined ? {} : { difficultyLevel: difficultyLevel as Difficulty["level"] }) };
}

async function generationRequest(request: Request) {
  const body = await readJsonBody(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new TypeError("request body must be an object");
  return generationParameters(body as Record<string, unknown>);
}

function generationQuery(url: URL) {
  const rawDifficulty = url.searchParams.get("difficultyLevel");
  return generationParameters({ templateId: url.searchParams.get("templateId"), seed: url.searchParams.get("seed"), ...(rawDifficulty === null ? {} : { difficultyLevel: Number(rawDifficulty) }) });
}

function generateAtDifficulty(template: PuzzleTemplate, seed: string, difficultyLevel: Difficulty["level"] | undefined): GeneratedPuzzle {
  if (!difficultyLevel) return generatePuzzle(template, seed);
  for (let attempt = 0; attempt < MAX_DIFFICULTY_SEARCH_ATTEMPTS; attempt += 1) {
    const candidateSeed = `${seed}-level-${difficultyLevel}-${attempt}`;
    const candidate = generatePuzzle(template, candidateSeed);
    if (candidate.difficulty.level === difficultyLevel) return candidate;
  }
  throw new TypeError("requested difficulty is unavailable");
}

function validateAnswer(spec: PuzzleSpec, value: unknown): Solution {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("answer must be an object");
  const assignments = (value as Record<string, unknown>).assignments;
  if (!assignments || typeof assignments !== "object" || Array.isArray(assignments)) throw new TypeError("answer.assignments must be an object");
  const expected = spec.categories.filter(category => category.id !== spec.baseCategory);
  const actual = assignments as Record<string, unknown>;
  if (Object.keys(actual).length !== expected.length || expected.some(category => !(category.id in actual))) throw new TypeError("answer must include every non-base category exactly once");
  const normalized: Record<string, string[]> = {};
  for (const category of expected) {
    const values = actual[category.id];
    if (!Array.isArray(values) || values.length !== category.values.length || values.some(value => typeof value !== "string") || new Set(values).size !== values.length || values.some(value => !category.values.includes(value))) {
      throw new TypeError(`answer for ${category.id} must be a complete permutation of its category values`);
    }
    normalized[category.id] = [...values];
  }
  return { assignments: normalized };
}

function sameSolution(left: Solution, right: Solution): boolean {
  const categories = Object.keys(left.assignments);
  return categories.length === Object.keys(right.assignments).length && categories.every(category => left.assignments[category].length === right.assignments[category]?.length && left.assignments[category].every((value, index) => value === right.assignments[category][index]));
}

async function verificationRequest(request: Request) {
  const body = await readJsonBody(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new TypeError("request body must be an object");
  const value = body as Record<string, unknown>;
  if (typeof value.puzzleToken !== "string" || !value.puzzleToken) throw new TypeError("puzzleToken must be a non-empty string");
  if (!("answer" in value)) throw new TypeError("answer is required");
  return { puzzleToken: value.puzzleToken, answer: value.answer };
}

/** Runtime-neutral Fetch router; Worker and Node adapters can share it unchanged. */
export function createRestRouter(templates: readonly PuzzleTemplate[], options: RestRouterOptions = {}) {
  const byId = new Map(templates.map(template => [template.id, template]));
  return async (request: Request): Promise<Response> => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return json({ error: { code: "bad_request", message: "Invalid URL" } }, 400);
    }
    const path = url.pathname;
    if (request.method === "GET" && path === "/v1/scenarios") return json({ scenarios: templates.map(({ id, title, metadata }) => ({ id, title, ...(metadata ? { metadata } : {}) })) });
    if (request.method === "GET" && path === "/v1/version") return json({ serviceVersion: options.serviceVersion ?? "0.1.0", buildSha: options.buildSha ?? "local", generatorVersion: "yokaiba-generator-v1", solverVersion: "yokaiba-exhaustive-v1" });
    if (request.method === "POST" && path === "/v1/puzzles/verify") {
      if (!options.puzzleTokenSecret) return json({ error: { code: "not_configured", message: "puzzle verification is not configured" } }, 503);
      try {
        const { puzzleToken, answer } = await verificationRequest(request);
        const token = await verifyPuzzleToken(puzzleToken, options.puzzleTokenSecret);
        if (!token) throw new TypeError("puzzleToken is invalid");
        const template = byId.get(token.templateId);
        if (!template) throw new TypeError("puzzleToken references an unknown template");
        const puzzle = generatePuzzle(template, token.seed);
        if (puzzle.generatorVersion !== token.generatorVersion || puzzle.solverVersion !== token.solverVersion) throw new TypeError("puzzleToken references an unsupported puzzle version");
        return json({ correct: sameSolution(puzzle.solution, validateAnswer(puzzle.spec, answer)) });
      } catch (error) {
        return json({ error: { code: "bad_request", message: error instanceof Error ? error.message : "invalid request" } }, 400);
      }
    }
    if ((request.method === "POST" || request.method === "GET") && path === "/v1/puzzles/generate") {
      try {
        const { templateId, seed, difficultyLevel } = request.method === "POST" ? await generationRequest(request) : generationQuery(url);
        const template = byId.get(templateId);
        if (!template) return json({ error: { code: "not_found", message: "unknown templateId" } }, 404);
        return json(await publicPuzzle(generateAtDifficulty(template, seed, difficultyLevel), options.puzzleTokenSecret), 200,
          request.method === "GET" ? { "cache-control": GENERATED_PUZZLE_CACHE_CONTROL } : undefined);
      } catch (error) {
        return json({ error: { code: "bad_request", message: error instanceof Error ? error.message : "invalid request" } }, 400);
      }
    }
    return json({ error: { code: "not_found", message: "route not found" } }, 404);
  };
}
