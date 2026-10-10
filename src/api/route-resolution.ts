export type RouteHandler = (request: Request, url: URL) => Promise<Response>;

export type RouteResolution =
  | { kind: "handler"; handler: RouteHandler }
  | { kind: "method_not_allowed"; allowedMethods: string[] }
  | { kind: "not_found" };

export function resolveRoute(
  routes: ReadonlyMap<string, RouteHandler>,
  method: string,
  pathname: string,
): RouteResolution {
  const handler = routes.get(`${method} ${pathname}`);
  if (handler) return { kind: "handler", handler };

  const allowedMethods = [...routes.keys()]
    .filter(route => route.slice(route.indexOf(" ") + 1) === pathname)
    .map(route => route.slice(0, route.indexOf(" ")))
    .sort();
  return allowedMethods.length > 0
    ? { kind: "method_not_allowed", allowedMethods }
    : { kind: "not_found" };
}
