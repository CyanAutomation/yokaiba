import { createRestRouter } from "../src/api/router.js";
import { createYokaibaMcpHandler } from "../src/mcp/server.js";
import { tournamentOrderTemplate } from "../src/templates/tournament-order.js";
import { hostHeaderValidationResponse } from "@modelcontextprotocol/server";

interface Env {
  /** Matches Budokon's API-key secret name and protects the MCP endpoint. */
  API_KEY?: string;
  /** Required comma-separated hostnames, e.g. yokaiba.example.com,yokaiba.workers.dev. */
  MCP_ALLOWED_HOSTNAMES?: string;
  /** Optional requests-per-minute override. Defaults to 30. */
  MCP_RATE_LIMIT?: string;
  /** Comma-separated browser origins permitted to call the public REST API. */
  REST_ALLOWED_ORIGINS?: string;
  /** HMAC secret used to issue and validate browser puzzle tokens. */
  PUZZLE_TOKEN_SECRET?: string;
  /** Optional best-effort, per-isolate REST requests-per-minute override. Defaults to 60. */
  REST_RATE_LIMIT?: string;
  /** Optional best-effort verification attempts per minute; defaults to 10. */
  VERIFY_RATE_LIMIT?: string;
  /** Optional Cloudflare Rate Limiting binding for production-wide REST enforcement. */
  REST_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  /** Static public assets, including Swagger UI and the canonical OpenAPI document. */
  ASSETS?: { fetch(request: Request): Promise<Response> };
}

const templates = [tournamentOrderTemplate];
const mcp = createYokaibaMcpHandler(templates);

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

const encoder = new TextEncoder();

const swaggerUiDocument = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Yokaiba API reference</title><link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css" integrity="sha384-WzpiqCnM12eQ0mh8EGuHyoK3PSgxSJpogk4wwxv4aCqth5f4o4tvbcz0jjJ6rWRJ" crossorigin="anonymous"></head>
<body><main id="swagger-ui" aria-label="Yokaiba API reference"></main>
<script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js" integrity="sha384-9HghXWVerMyVRtzQWNLGApK/7WA4uHc/hHlj01ctwrK/tDC3iwu7N/BV5Jrhn7OR" crossorigin="anonymous"></script>
<script>window.ui = SwaggerUIBundle({url:"/openapi/v1.yaml",dom_id:"#swagger-ui",deepLinking:true,presets:[SwaggerUIBundle.presets.apis],layout:"BaseLayout"});</script>
</body></html>`;

function constantTimeEqual(expected: string, candidate: string): boolean {
  const expectedBytes = encoder.encode(expected);
  const candidateBytes = encoder.encode(candidate);
  const length = Math.max(expectedBytes.length, candidateBytes.length);
  let difference = expectedBytes.length ^ candidateBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (expectedBytes[index] ?? 0) ^ (candidateBytes[index] ?? 0);
  }
  return difference === 0;
}

function authorized(request: Request, key: string | undefined) {
  if (!key) return false;
  const candidate = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? request.headers.get("x-api-key");
  return candidate !== null && constantTimeEqual(key, candidate);
}

export type RateLimitStore = Map<string, { count: number; resetAt: number }>;
export type RateLimiter = (request: Request, rawLimit: string | undefined, scope: string) => boolean;
const RATE_WINDOW_MS = 60_000;
const MAX_RATE_LIMIT_KEYS = 10_000;

export function createRateLimiter(rateLimits: RateLimitStore = new Map(), clock: () => number = Date.now): RateLimiter {
  return (request, rawLimit, scope) => {
    const now = clock();
    const configured = Number(rawLimit ?? 30);
    const limit = Number.isSafeInteger(configured) && configured > 0 ? configured : 30;
    const key = `${scope}:${request.headers.get("cf-connecting-ip") ?? "unknown"}`;
    const current = rateLimits.get(key);
    if (!current || current.resetAt <= now) {
      if (rateLimits.size >= MAX_RATE_LIMIT_KEYS) {
        for (const [candidate, value] of rateLimits) {
          if (value.resetAt <= now) rateLimits.delete(candidate);
        }
        if (rateLimits.size >= MAX_RATE_LIMIT_KEYS) rateLimits.delete(rateLimits.keys().next().value as string);
      }
      rateLimits.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
      return false;
    }
    current.count += 1;
    return current.count > limit;
  };
}

function configuredOrigins(rawOrigins: string | undefined) {
  return (rawOrigins ?? "").split(",").map(value => value.trim()).filter(Boolean);
}

function corsHeaders(origin: string | null, allowedOrigins: string[]) {
  if (!origin || !allowedOrigins.includes(origin)) return undefined;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };
}

function weaklyMatchesEtag(ifNoneMatch: string | null, etag: string): boolean {
  if (ifNoneMatch === null) return false;
  return ifNoneMatch.split(",").map(value => value.trim()).some(value => value === "*" || value.replace(/^W\//, "") === etag);
}

async function contentEtag(response: Response): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await response.clone().arrayBuffer());
  return `"yokaiba-v1-${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("")}"`;
}

async function cachePublicGet(response: Response, request: Request): Promise<Response> {
  if (request.method !== "GET" || response.status !== 200) return response;
  const etag = await contentEtag(response);
  const headers = new Headers(response.headers);
  headers.set("etag", etag);
  if (weaklyMatchesEtag(request.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers });
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function swaggerUiResponse(): Response {
  return new Response(swaggerUiDocument, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; script-src 'self' 'unsafe-inline' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: https:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

async function staticAsset(request: Request, env: Env, assetPath: string): Promise<Response> {
  if (!env.ASSETS) return json({ error: { code: "not_configured", message: "static assets are not configured" } }, 503);
  const url = new URL(request.url);
  url.pathname = assetPath;
  url.search = "";
  const asset = await env.ASSETS.fetch(new Request(url, request));
  const headers = new Headers(asset.headers);
  headers.set("x-content-type-options", "nosniff");
  return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
}

async function restRateLimited(rateLimited: RateLimiter, request: Request, env: Env): Promise<boolean> {
  if (new URL(request.url).pathname === "/v1/puzzles/verify" && rateLimited(request, env.VERIFY_RATE_LIMIT ?? "10", "verify")) return true;
  if (env.REST_RATE_LIMITER) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const client = request.headers.get("cf-connecting-ip") ?? "anonymous";
      return !(await env.REST_RATE_LIMITER.limit({ key: `${client}:${path}` })).success;
    } catch {
      // Retain the local fallback if a provider binding is temporarily unavailable.
    }
  }
  return rateLimited(request, env.REST_RATE_LIMIT ?? "60", "rest");
}

function allowedOrigin(request: Request, hostnames: string[]) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return hostnames.includes(new URL(origin).hostname); } catch { return false; }
}

export function createWorker(rateLimited: RateLimiter = createRateLimiter()) {
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      const startedAt = Date.now();
      const requestId = crypto.randomUUID();
      let path: string;
      try {
        path = new URL(request.url).pathname;
      } catch {
        const response = json({ error: { code: "bad_request", message: "Invalid URL" } }, 400);
        response.headers.set("x-request-id", requestId);
        console.log(JSON.stringify({ event: "request", requestId, method: request.method, path: "invalid", status: response.status, durationMs: Date.now() - startedAt }));
        return response;
      }
      const restRequest = path.startsWith("/v1/");
      const responseCorsHeaders = restRequest ? corsHeaders(request.headers.get("origin"), configuredOrigins(env.REST_ALLOWED_ORIGINS)) : undefined;
      const finish = (response: Response) => {
        response.headers.set("x-request-id", requestId);
        if (responseCorsHeaders) for (const [name, value] of Object.entries(responseCorsHeaders)) response.headers.set(name, value);
        console.log(JSON.stringify({ event: "request", requestId, method: request.method, path, status: response.status, durationMs: Date.now() - startedAt }));
        return response;
      };
      if (path === "/healthz") return finish(json({ status: "ok" }));
      if (path === "/docs" || path === "/docs/") return finish(swaggerUiResponse());
      if (path === "/openapi/v1.yaml") return finish(await staticAsset(request, env, "/openapi/v1.yaml"));
      if (restRequest && request.method === "OPTIONS") {
        const requestedMethod = request.headers.get("access-control-request-method");
        const requestedHeaders = request.headers.get("access-control-request-headers")?.split(",").map(value => value.trim().toLowerCase()).filter(Boolean) ?? [];
        if (!responseCorsHeaders || !["GET", "POST"].includes(requestedMethod?.toUpperCase() ?? "") || requestedHeaders.some(header => header !== "content-type")) return finish(json({ error: { code: "forbidden", message: "Origin is not allowed" } }, 403));
        return finish(new Response(null, { status: 204 }));
      }
      if (restRequest && await restRateLimited(rateLimited, request, env)) {
        return finish(new Response(JSON.stringify({ error: { code: "rate_limited", message: "Too many requests" } }), {
          status: 429,
          headers: { "content-type": "application/json; charset=utf-8", "retry-after": "60" },
        }));
      }
      if (path !== "/mcp") return finish(await cachePublicGet(await createRestRouter(templates, { puzzleTokenSecret: env.PUZZLE_TOKEN_SECRET })(request), request));
      if (rateLimited(request, env.MCP_RATE_LIMIT, "mcp")) {
        return finish(new Response(JSON.stringify({ error: { code: "rate_limited", message: "Too many requests" } }), {
          status: 429,
          headers: { "content-type": "application/json; charset=utf-8", "retry-after": "60" },
        }));
      }
      if (!env.API_KEY || !env.MCP_ALLOWED_HOSTNAMES) return finish(json({ error: { code: "not_configured", message: "MCP credentials and allowed hosts are required" } }, 503));
      if (!authorized(request, env.API_KEY)) return finish(json({ error: { code: "unauthorized", message: "A valid API key is required" } }, 401));
      const hostnames = env.MCP_ALLOWED_HOSTNAMES.split(",").map(value => value.trim()).filter(Boolean);
      const rejectedHost = hostHeaderValidationResponse(request, hostnames);
      if (rejectedHost) return finish(rejectedHost);
      if (!allowedOrigin(request, hostnames)) return finish(json({ error: { code: "forbidden", message: "Origin is not allowed" } }, 403));
      return finish(await mcp.fetch(request));
    },
  } satisfies ExportedHandler<Env>;
}

export default createWorker();
