import type { PuzzleTemplate } from "../domain/types.js";
import type { RestRouterOptions } from "./router-options.js";
export type { RestRouterOptions } from "./router-options.js";
import { json } from "./json-response.js";
import { createRestRoutes } from "./rest-routes.js";
import { resolveRoute } from "./route-resolution.js";
export { SCENARIOS_CACHE_CONTROL, VERSION_CACHE_CONTROL } from "./rest-routes.js";

/** Runtime-neutral Fetch router; Worker and Node adapters can share it unchanged. */
export function createRestRouter(templates: readonly PuzzleTemplate[], options: RestRouterOptions = {}) {
  const routes = createRestRoutes(templates, options);
  return async (request: Request): Promise<Response> => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return json({ error: { code: "bad_request", message: "Invalid URL" } }, 400);
    }
    const resolution = resolveRoute(routes, request.method, url.pathname);
    if (resolution.kind === "handler") return resolution.handler(request, url);
    if (resolution.kind === "method_not_allowed") {
      return json({ error: { code: "method_not_allowed", message: "Method not allowed" } }, 405, { allow: resolution.allowedMethods.join(", ") });
    }
    return json({ error: { code: "not_found", message: "route not found" } }, 404);
  };
}
