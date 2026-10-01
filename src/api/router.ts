import { DifficultyUnavailableError, GENERATOR_VERSION, generateProgressivePuzzle, generatePuzzleAtDifficulty, generatePuzzleAtDifficultyWithFallback, SOLVER_VERSION } from "../generation/generator.js";
import { issuePuzzleToken, verifyPuzzleToken } from "./puzzle-token.js";
import { json } from "./json-response.js";
import type { Difficulty, GeneratedPuzzle, PuzzleSpec, PuzzleTemplate, Solution } from "../domain/types.js";
import { scenarioSummary } from "../catalogue.js";
import { normalizeGenerationParameters, parseGenerationQuery } from "./generation-query.js";

const MAX_GENERATION_BODY_BYTES = 16 * 1024;
const INVALID_JSON_BODY_MESSAGE = "request body must be valid JSON";
const MAX_DIFFICULTY_SEARCH_ATTEMPTS = 128;
// Generator releases can change a puzzle's representation. Keep browser and edge
// caches short-lived, and require revalidation instead of promising immutability.
const GENERATED_PUZZLE_CACHE_CONTROL = "public, max-age=300, s-maxage=300, must-revalidate";
export const SCENARIOS_CACHE_CONTROL = "public, max-age=300, s-maxage=300, must-revalidate";
export const VERSION_CACHE_CONTROL = "no-cache";

// JSON response builder provided by ./json-response.ts

export interface RestRouterOptions {
  /** Required to issue tamper-proof puzzle tokens for server-side verification. */
  puzzleTokenSecret?: string;
  serviceVersion?: string;
  buildSha?: string;
}

function publicCapabilities(templates: readonly PuzzleTemplate[], puzzleTokenSecret?: string) {
  const locales = new Set<string>();
  const scenarios = templates.map(template => {
    for (const locale of template.metadata?.locales.supported ?? []) locales.add(locale);
    const [minimumLevel, maximumLevel] = template.metadata?.difficultyCalibration.levelRange ?? [1, 12];
    return { id: template.id, difficultyLevels: Array.from({ length: maximumLevel - minimumLevel + 1 }, (_value, index) => minimumLevel + index) };
  });
  return {
    apiVersion: "v1",
    features: { answerVerification: Boolean(puzzleTokenSecret), conditionalGet: true, difficultySelection: true, hints: Boolean(puzzleTokenSecret), outcomeTelemetry: true, seedFallback: true },
    locales: [...locales].sort(),
    scenarios,
  };
}

/** Read bounded bytes instead of trusting a spoofable or absent Content-Length header. */
async function readJsonBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_GENERATION_BODY_BYTES) throw new TypeError(INVALID_JSON_BODY_MESSAGE);
  if (!request.body) throw new TypeError(INVALID_JSON_BODY_MESSAGE);
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
        throw new TypeError(INVALID_JSON_BODY_MESSAGE);
      }
      chunks.push(value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new TypeError(INVALID_JSON_BODY_MESSAGE);
  } finally {
    reader.releaseLock();
  }
}

async function publicPuzzle(puzzle: GeneratedPuzzle, puzzleTokenSecret?: string) {
  const { solution: _solution, spec, ...rest } = puzzle;
  return { ...rest, spec, ...(puzzleTokenSecret ? { puzzleToken: await issuePuzzleToken(puzzle, puzzleTokenSecret) } : {}) };
}

async function generationRequest(request: Request) {
  const body = await readJsonBody(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new TypeError("request body must be an object");
  return normalizeGenerationParameters(body as Record<string, unknown>);
}

function generateAtDifficulty(template: PuzzleTemplate, seed: string, difficultyLevel: Difficulty["level"] | undefined, allowSeedFallback = false): GeneratedPuzzle {
  if (!difficultyLevel) return generateProgressivePuzzle(template, seed);
  return allowSeedFallback ? generatePuzzleAtDifficultyWithFallback(template, seed, difficultyLevel) : generatePuzzleAtDifficulty(template, seed, difficultyLevel);
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

/** v3-v5 preserve puzzle-solution semantics for older signed tokens. */
function supportsTokenGeneratorVersion(tokenVersion: string, generatedVersion: string) {
  return tokenVersion === generatedVersion || (
    ["yokaiba-generator-v2", "yokaiba-generator-v3", "yokaiba-generator-v4"].includes(tokenVersion)
    && ["yokaiba-generator-v3", "yokaiba-generator-v4", "yokaiba-generator-v5"].includes(generatedVersion)
  );
}

type HintKind = "clue" | "elimination" | "placement";

async function protectedPuzzle(request: Request, templates: Map<string, PuzzleTemplate>, secret: string) {
  const body = await readJsonBody(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new TypeError("request body must be an object");
  const value = body as Record<string, unknown>;
  return { value, puzzle: await puzzleFromToken(puzzleTokenValue(value), templates, secret) };
}

function puzzleTokenValue(value: Record<string, unknown>): string {
  if (typeof value.puzzleToken !== "string" || !value.puzzleToken) throw new TypeError("puzzleToken must be a non-empty string");
  return value.puzzleToken;
}

async function puzzleFromToken(puzzleToken: string, templates: Map<string, PuzzleTemplate>, secret: string): Promise<GeneratedPuzzle> {
  const token = await verifyPuzzleToken(puzzleToken, secret);
  if (!token) throw new TypeError("puzzleToken is invalid");
  const template = templates.get(token.templateId);
  if (!template) throw new TypeError("puzzleToken references an unknown template");
  const puzzle = token.requestedDifficultyLevel === undefined ? generateProgressivePuzzle(template, token.seed) : generatePuzzleAtDifficulty(template, token.seed, token.requestedDifficultyLevel);
  if (!supportsTokenGeneratorVersion(token.generatorVersion, puzzle.generatorVersion) || puzzle.solverVersion !== token.solverVersion) throw new TypeError("puzzleToken references an unsupported puzzle version");
  return puzzle;
}

const PUZZLE_OUTCOME_EVENTS = new Set(["puzzle_started", "puzzle_completed", "hint_used", "mistake", "puzzle_abandoned"]);
const TELEMETRY_NUMBER_RANGES = [
  ["requestedDifficultyLevel", 1, 12],
  ["assessedDifficultyLevel", 1, 12],
  ["clueCount", 0, 100],
  ["elapsedMs", 0, 86_400_000],
  ["hintsUsed", 0, 100],
  ["mistakes", 0, 100],
] as const;

function telemetryRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("request body must be an object");
  return value as Record<string, unknown>;
}

function validateTelemetryNumbers(event: Record<string, unknown>): void {
  for (const [name, minimum, maximum] of TELEMETRY_NUMBER_RANGES) {
    const candidate = event[name];
    if (candidate !== undefined && (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum)) {
      throw new TypeError(`${name} is outside its supported range`);
    }
  }
}

function optionalTelemetryNumber(event: Record<string, unknown>, name: string): Record<string, number> {
  const value = event[name];
  return typeof value === "number" ? { [name]: value } : {};
}

function telemetryRequest(value: unknown, templates: Map<string, PuzzleTemplate>) {
  const event = telemetryRecord(value);
  if (typeof event.event !== "string" || !PUZZLE_OUTCOME_EVENTS.has(event.event)) throw new TypeError("event must be a supported puzzle outcome");
  if (typeof event.templateId !== "string" || !templates.has(event.templateId)) throw new TypeError("templateId must reference a known template");
  validateTelemetryNumbers(event);
  if (event.smartMarkingEnabled !== undefined && typeof event.smartMarkingEnabled !== "boolean") throw new TypeError("smartMarkingEnabled must be a boolean");
  return {
    event: event.event,
    templateId: event.templateId,
    ...optionalTelemetryNumber(event, "requestedDifficultyLevel"),
    ...optionalTelemetryNumber(event, "assessedDifficultyLevel"),
    ...optionalTelemetryNumber(event, "clueCount"),
    ...optionalTelemetryNumber(event, "elapsedMs"),
    ...optionalTelemetryNumber(event, "hintsUsed"),
    ...optionalTelemetryNumber(event, "mistakes"),
    ...(typeof event.smartMarkingEnabled === "boolean" ? { smartMarkingEnabled: event.smartMarkingEnabled } : {}),
  };
}

function badRequest(error: unknown): Response {
  return json({ error: { code: "bad_request", message: error instanceof Error ? error.message : "invalid request" } }, 400);
}

async function outcomeRoute(request: Request, templates: Map<string, PuzzleTemplate>): Promise<Response> {
  try {
    console.log(JSON.stringify({ ...telemetryRequest(await readJsonBody(request), templates), logEvent: "puzzle_outcome" }));
    return json({ accepted: true }, 202);
  } catch (error) {
    return badRequest(error);
  }
}

async function hintRoute(request: Request, templates: Map<string, PuzzleTemplate>, secret?: string): Promise<Response> {
  if (!secret) return json({ error: { code: "not_configured", message: "puzzle hints are not configured" } }, 503);
  try {
    const { value, puzzle } = await protectedPuzzle(request, templates, secret);
    const kind = value.kind === undefined ? "clue" : value.kind;
    if (kind !== "clue" && kind !== "elimination" && kind !== "placement") throw new TypeError("kind must be clue, elimination, or placement");
    if (kind === "placement") {
      const category = puzzle.spec.categories.find(candidate => candidate.id !== puzzle.spec.baseCategory)!;
      return json({ kind, placement: { subject: puzzle.spec.categories.find(candidate => candidate.id === puzzle.spec.baseCategory)!.values[0], category: category.id, value: puzzle.solution.assignments[category.id][0] } });
    }
    const clue = (kind === "elimination" ? puzzle.clues.find(candidate => candidate.constraint.kind === "notMatches") : undefined) ?? puzzle.clues[0]!;
    return json({ kind: clue.constraint.kind === "notMatches" && kind === "elimination" ? kind : "clue", clue: { id: clue.id, text: clue.text } });
  } catch (error) {
    return badRequest(error);
  }
}

async function verificationRoute(request: Request, templates: Map<string, PuzzleTemplate>, secret?: string): Promise<Response> {
  if (!secret) return json({ error: { code: "not_configured", message: "puzzle verification is not configured" } }, 503);
  try {
    const body = await readJsonBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new TypeError("request body must be an object");
    const value = body as Record<string, unknown>;
    const puzzleToken = puzzleTokenValue(value);
    if (!("answer" in value)) throw new TypeError("answer is required");
    const puzzle = await puzzleFromToken(puzzleToken, templates, secret);
    return json({ correct: sameSolution(puzzle.solution, validateAnswer(puzzle.spec, value.answer)) });
  } catch (error) {
    return badRequest(error);
  }
}

async function generationRoute(
  request: Request,
  url: URL,
  templates: Map<string, PuzzleTemplate>,
  options: RestRouterOptions,
): Promise<Response> {
  try {
    const { templateId, seed, difficultyLevel, allowSeedFallback } = request.method === "POST" ? await generationRequest(request) : parseGenerationQuery(url);
    const template = templates.get(templateId);
    if (!template) return json({ error: { code: "not_found", message: "unknown templateId" } }, 404);
    return json(await publicPuzzle(generateAtDifficulty(template, seed, difficultyLevel, allowSeedFallback), options.puzzleTokenSecret), 200,
      request.method === "GET" ? { "cache-control": GENERATED_PUZZLE_CACHE_CONTROL } : undefined);
  } catch (error) {
    if (error instanceof DifficultyUnavailableError) return json({
      error: { code: "difficulty_unavailable", message: error.message },
      templateId: error.templateId,
      requestedDifficultyLevel: error.requestedDifficultyLevel,
      availableDifficultyLevels: error.availableDifficultyLevels,
    }, 422, request.method === "GET" ? { "cache-control": GENERATED_PUZZLE_CACHE_CONTROL } : undefined);
    return badRequest(error);
  }
}

/** Runtime-neutral Fetch router; Worker and Node adapters can share it unchanged. */
export function createRestRouter(templates: readonly PuzzleTemplate[], options: RestRouterOptions = {}) {
  const byId = new Map(templates.map(template => [template.id, template]));
  type RouteHandler = (request: Request, url: URL) => Promise<Response>;
  const routes = new Map<string, RouteHandler>([
    ["GET /v1/scenarios", async () => json({ scenarios: templates.map(scenarioSummary) }, 200, { "cache-control": SCENARIOS_CACHE_CONTROL })],
    ["GET /v1/capabilities", async () => json(publicCapabilities(templates, options.puzzleTokenSecret), 200, { "cache-control": SCENARIOS_CACHE_CONTROL })],
    ["GET /v1/version", async () => json({ serviceVersion: options.serviceVersion ?? "0.1.0", buildSha: options.buildSha ?? "local", generatorVersion: GENERATOR_VERSION, solverVersion: SOLVER_VERSION }, 200, { "cache-control": VERSION_CACHE_CONTROL })],
    ["POST /v1/events", request => outcomeRoute(request, byId)],
    ["POST /v1/puzzles/hint", request => hintRoute(request, byId, options.puzzleTokenSecret)],
    ["POST /v1/puzzles/verify", request => verificationRoute(request, byId, options.puzzleTokenSecret)],
    ["GET /v1/puzzles/generate", (request, url) => generationRoute(request, url, byId, options)],
    ["POST /v1/puzzles/generate", (request, url) => generationRoute(request, url, byId, options)],
  ]);

  return async (request: Request): Promise<Response> => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return json({ error: { code: "bad_request", message: "Invalid URL" } }, 400);
    }
    const handler = routes.get(`${request.method} ${url.pathname}`);
    return handler ? handler(request, url) : json({ error: { code: "not_found", message: "route not found" } }, 404);
  };
}
