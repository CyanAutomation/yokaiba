import { DifficultyUnavailableError, generatePuzzleForRequest } from "../generation/generator.js";
import { DEFAULT_PUZZLE_TOKEN_TTL_SECONDS, issuePuzzleTokenWithIdentity } from "./puzzle-token.js";
import { json } from "./json-response.js";
import type { GeneratedPuzzle, PuzzleTemplate } from "../domain/types.js";
import { normalizeGenerationParameters } from "./generation-parameters.js";
import { parseGenerationQuery } from "./generation-query.js";
import { badRequest, readJsonBody } from "./request-utils.js";
import type { RestRouterOptions } from "./router-options.js";

const GENERATED_PUZZLE_CACHE_CONTROL = "public, max-age=300, s-maxage=300, must-revalidate";

async function publicPuzzle(puzzle: GeneratedPuzzle, options: RestRouterOptions) {
  const { solution: _solution, spec, ...rest } = puzzle;
  const issuedToken = options.puzzleTokenSecret
    ? await issuePuzzleTokenWithIdentity(puzzle, options.puzzleTokenSecret, {
      ttlSeconds: options.puzzleTokenTtlSeconds ?? DEFAULT_PUZZLE_TOKEN_TTL_SECONDS,
    })
    : undefined;
  return {
    ...rest,
    spec,
    ...(issuedToken ? { puzzleToken: issuedToken.token, puzzleFingerprint: issuedToken.puzzleFingerprint } : {}),
  };
}

async function generationRequest(request: Request) {
  const body = await readJsonBody(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new TypeError("request body must be an object");
  const value = body as Record<string, unknown>;
  return normalizeGenerationParameters({ ...value, ...(value.seed === undefined ? { seed: crypto.randomUUID() } : {}) });
}

export async function generationRoute(
  request: Request,
  url: URL,
  templates: Map<string, PuzzleTemplate>,
  options: RestRouterOptions,
): Promise<Response> {
  let parameters: ReturnType<typeof parseGenerationQuery>;
  try {
    parameters = request.method === "POST" ? await generationRequest(request) : parseGenerationQuery(url);
  } catch (error) {
    return badRequest(error);
  }

  const { templateId, seed, difficultyLevel, allowSeedFallback, difficultyModel } = parameters;
  const template = templates.get(templateId);
  if (!template) return json({ error: { code: "not_found", message: "unknown templateId" } }, 404);

  try {
    return json(await publicPuzzle(generatePuzzleForRequest(template, seed, difficultyLevel, allowSeedFallback, undefined, difficultyModel ?? "v5"), options), 200,
      request.method === "GET" ? { "cache-control": GENERATED_PUZZLE_CACHE_CONTROL } : undefined);
  } catch (error) {
    if (error instanceof DifficultyUnavailableError) return json({
      error: { code: "difficulty_unavailable", message: error.message },
      templateId: error.templateId,
      ...(error.requestedDifficultyLevel === undefined ? {} : { requestedDifficultyLevel: error.requestedDifficultyLevel }),
      availableDifficultyLevels: error.availableDifficultyLevels,
      ...(error.diagnostics ? { selectionDiagnostics: error.diagnostics } : {}),
    }, 422, request.method === "GET" ? { "cache-control": GENERATED_PUZZLE_CACHE_CONTROL } : undefined);
    return json({ error: { code: "generation_failed", message: "puzzle generation failed" } }, 500);
  }
}
