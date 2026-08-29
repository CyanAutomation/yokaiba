import { generatePuzzle } from "../generation/generator.js";
import type { GeneratedPuzzle, PuzzleTemplate } from "../domain/types.js";

const MAX_GENERATION_FIELD_LENGTH = 128;
const MAX_GENERATION_BODY_BYTES = 16 * 1024;
// Generator releases can change a puzzle's representation. Keep browser and edge
// caches short-lived, and require revalidation instead of promising immutability.
const GENERATED_PUZZLE_CACHE_CONTROL = "public, max-age=300, s-maxage=300, must-revalidate";

const json = (body: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", ...headers },
});

function publicPuzzle(puzzle: GeneratedPuzzle) {
  const { solution: _solution, spec, ...rest } = puzzle;
  return { ...rest, spec };
}

function generationParameters(value: Record<string, unknown>) {
  if (typeof value.templateId !== "string" || !value.templateId.trim()) throw new TypeError("templateId must be a non-empty string");
  if (typeof value.seed !== "string" || !value.seed.trim()) throw new TypeError("seed must be a non-empty string");
  if (value.templateId.length > MAX_GENERATION_FIELD_LENGTH) throw new TypeError(`templateId must be at most ${MAX_GENERATION_FIELD_LENGTH} characters`);
  if (value.seed.length > MAX_GENERATION_FIELD_LENGTH) throw new TypeError(`seed must be at most ${MAX_GENERATION_FIELD_LENGTH} characters`);
  return { templateId: value.templateId, seed: value.seed };
}

async function generationRequest(request: Request) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_GENERATION_BODY_BYTES) throw new TypeError("request body is too large");
  let body: unknown;
  try { body = await request.json(); } catch { throw new TypeError("request body must be valid JSON"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new TypeError("request body must be an object");
  return generationParameters(body as Record<string, unknown>);
}

function generationQuery(url: URL) {
  return generationParameters({ templateId: url.searchParams.get("templateId"), seed: url.searchParams.get("seed") });
}

/** Runtime-neutral Fetch router; Worker and Node adapters can share it unchanged. */
export function createRestRouter(templates: readonly PuzzleTemplate[]) {
  const byId = new Map(templates.map(template => [template.id, template]));
  return async (request: Request): Promise<Response> => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return json({ error: { code: "bad_request", message: "Invalid URL" } }, 400);
    }
    const path = url.pathname;
    if (request.method === "GET" && path === "/v1/scenarios") return json({ scenarios: templates.map(({ id, title }) => ({ id, title })) });
    if (request.method === "GET" && path === "/v1/version") return json({ serviceVersion: "0.1.0", generatorVersion: "yokaiba-generator-v1", solverVersion: "yokaiba-exhaustive-v1" });
    if ((request.method === "POST" || request.method === "GET") && path === "/v1/puzzles/generate") {
      try {
        const { templateId, seed } = request.method === "POST" ? await generationRequest(request) : generationQuery(url);
        const template = byId.get(templateId);
        if (!template) return json({ error: { code: "not_found", message: "unknown templateId" } }, 404);
        return json(publicPuzzle(generatePuzzle(template, seed)), 200,
          request.method === "GET" ? { "cache-control": GENERATED_PUZZLE_CACHE_CONTROL } : undefined);
      } catch (error) {
        return json({ error: { code: "bad_request", message: error instanceof Error ? error.message : "invalid request" } }, 400);
      }
    }
    return json({ error: { code: "not_found", message: "route not found" } }, 404);
  };
}
