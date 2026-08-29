import { generatePuzzle } from "../generation/generator.js";
import type { GeneratedPuzzle, PuzzleTemplate } from "../domain/types.js";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" },
});

function publicPuzzle(puzzle: GeneratedPuzzle) {
  const { solution: _solution, spec, ...rest } = puzzle;
  return { ...rest, spec };
}

async function generationRequest(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { throw new TypeError("request body must be valid JSON"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new TypeError("request body must be an object");
  const value = body as Record<string, unknown>;
  if (typeof value.templateId !== "string" || !value.templateId.trim()) throw new TypeError("templateId must be a non-empty string");
  if (typeof value.seed !== "string" || !value.seed.trim()) throw new TypeError("seed must be a non-empty string");
  return { templateId: value.templateId, seed: value.seed };
}

/** Runtime-neutral Fetch router; Worker and Node adapters can share it unchanged. */
export function createRestRouter(templates: readonly PuzzleTemplate[]) {
  const byId = new Map(templates.map(template => [template.id, template]));
  return async (request: Request): Promise<Response> => {
    let path: string;
    try {
      path = new URL(request.url).pathname;
    } catch {
      return json({ error: { code: "bad_request", message: "Invalid URL" } }, 400);
    }
    if (request.method === "GET" && path === "/v1/scenarios") return json({ scenarios: templates.map(({ id, title }) => ({ id, title })) });
    if (request.method === "GET" && path === "/v1/version") return json({ serviceVersion: "0.1.0", generatorVersion: "yokaiba-generator-v1", solverVersion: "yokaiba-exhaustive-v1" });
    if (request.method === "POST" && path === "/v1/puzzles/generate") {
      try {
        const { templateId, seed } = await generationRequest(request);
        const template = byId.get(templateId);
        if (!template) return json({ error: { code: "not_found", message: "unknown templateId" } }, 404);
        return json(publicPuzzle(generatePuzzle(template, seed)));
      } catch (error) {
        return json({ error: { code: "bad_request", message: error instanceof Error ? error.message : "invalid request" } }, 400);
      }
    }
    return json({ error: { code: "not_found", message: "route not found" } }, 404);
  };
}
