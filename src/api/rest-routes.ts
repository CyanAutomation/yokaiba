import type { PuzzleTemplate } from "../domain/types.js";
import { GENERATOR_VERSION, SOLVER_VERSION } from "../generation/generator.js";
import { scenarioSummary } from "../catalogue.js";
import { generationRoute } from "./generation-route.js";
import { outcomeRoute } from "./outcome-route.js";
import { hintRoute, verificationRoute } from "./puzzle-action-routes.js";
import type { RestRouterOptions } from "./router-options.js";
import { json } from "./json-response.js";
import type { RouteHandler } from "./route-resolution.js";

export const SCENARIOS_CACHE_CONTROL = "public, max-age=300, s-maxage=300, must-revalidate";
export const VERSION_CACHE_CONTROL = "no-cache";

function publicCapabilities(templates: readonly PuzzleTemplate[], puzzleTokenSecret?: string, hasOutcomeSink = false) {
  const locales = new Set<string>();
  const scenarios = templates.map(template => {
    for (const locale of template.metadata?.locales.supported ?? []) locales.add(locale);
    const [minimumLevel, maximumLevel] = template.metadata?.difficultyCalibration.levelRange ?? [1, 12];
    return { id: template.id, difficultyLevels: Array.from({ length: maximumLevel - minimumLevel + 1 }, (_value, index) => minimumLevel + index) };
  });
  return {
    apiVersion: "v1",
    features: { answerVerification: Boolean(puzzleTokenSecret), conditionalGet: true, difficultySelection: true, hints: Boolean(puzzleTokenSecret), outcomeTelemetry: hasOutcomeSink, seedFallback: true },
    locales: [...locales].sort(),
    scenarios,
  };
}

export function createRestRoutes(templates: readonly PuzzleTemplate[], options: RestRouterOptions): Map<string, RouteHandler> {
  const byId = new Map(templates.map(template => [template.id, template]));
  const protectedSecrets = [options.puzzleTokenSecret, ...(options.puzzleTokenPreviousSecrets ?? [])]
    .filter((secret): secret is string => Boolean(secret));
  return new Map<string, RouteHandler>([
    ["GET /v1/scenarios", async () => json({ scenarios: templates.map(scenarioSummary) }, 200, { "cache-control": SCENARIOS_CACHE_CONTROL })],
    ["GET /v1/capabilities", async () => json({
      ...publicCapabilities(templates, options.puzzleTokenSecret, Boolean(options.recordOutcome)),
    }, 200, { "cache-control": SCENARIOS_CACHE_CONTROL })],
    ["GET /v1/version", async () => json({ serviceVersion: options.serviceVersion ?? "0.1.0", buildSha: options.buildSha ?? "local", generatorVersion: GENERATOR_VERSION, solverVersion: SOLVER_VERSION }, 200, { "cache-control": VERSION_CACHE_CONTROL })],
    ["POST /v1/events", request => outcomeRoute(request, byId, options.recordOutcome)],
    ["POST /v1/puzzles/hint", request => hintRoute(request, byId, protectedSecrets)],
    ["POST /v1/puzzles/verify", request => verificationRoute(request, byId, protectedSecrets)],
    ["GET /v1/puzzles/generate", (request, url) => generationRoute(request, url, byId, options)],
    ["POST /v1/puzzles/generate", (request, url) => generationRoute(request, url, byId, options)],
  ]);
}
