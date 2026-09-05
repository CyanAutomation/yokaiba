import { createRestRouter } from "../src/api/router.js";
import { createYokaibaMcpHandler } from "../src/mcp/server.js";
import { tournamentOrderTemplate } from "../src/templates/tournament-order.js";
import { openDivisionTemplate } from "../src/templates/open-division.js";
import { championshipCircuitTemplate } from "../src/templates/championship-circuit.js";
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
  /** Deployment-time package version and immutable revision, injected by CI. */
  BUILD_VERSION?: string;
  BUILD_SHA?: string;
  /** Optional best-effort, per-isolate REST requests-per-minute override. Defaults to 60. */
  REST_RATE_LIMIT?: string;
  /** Optional best-effort verification attempts per minute; defaults to 10. */
  VERIFY_RATE_LIMIT?: string;
  /** Optional Cloudflare Rate Limiting binding for production-wide general REST enforcement. */
  REST_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  /** Optional Cloudflare Rate Limiting binding for production-wide answer-verification enforcement. */
  VERIFY_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  /** Static public assets, including Swagger UI and the canonical OpenAPI document. */
  ASSETS?: { fetch(request: Request): Promise<Response> };
}

const templates = [tournamentOrderTemplate, openDivisionTemplate, championshipCircuitTemplate];
const mcp = createYokaibaMcpHandler(templates);

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

const encoder = new TextEncoder();

const swaggerUiDocument = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Yokaiba API reference</title><link rel="stylesheet" href="/swagger-ui/swagger-ui.css"></head>
<body><main id="swagger-ui" aria-label="Yokaiba API reference"></main>
<script src="/swagger-ui/swagger-ui-bundle.js"></script>
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
export interface RateLimitDecision {
  limited: boolean;
  /** Present only when the Worker performed the limiting locally. */
  remaining?: number;
  /** Unix epoch seconds; present only when the Worker performed the limiting locally. */
  resetAt?: number;
}
export type RateLimiter = (request: Request, rawLimit: string | undefined, scope: string) => boolean | RateLimitDecision;
export interface WorkerOptions {
  localRateLimitStore?: RateLimitStore;
  clock?: () => number;
  rateLimiter?: RateLimiter;
  generatedPuzzleCache?: GeneratedPuzzleCache;
  generatePuzzleResponse?: (request: Request) => Response | Promise<Response>;
}
const RATE_WINDOW_MS = 60_000;
const MAX_RATE_LIMIT_KEYS = 10_000;
const GENERATED_PUZZLE_CACHE_TTL_MS = 300_000;
const MAX_GENERATED_PUZZLE_CACHE_ENTRIES = 128;

export interface GeneratedPuzzleCacheEntry { expiresAt: number; response: Response; }
export type GeneratedPuzzleCache = Map<string, GeneratedPuzzleCacheEntry>;

function generatedPuzzleCacheKey(request: Request, puzzleTokenSecret: string | undefined): string {
  return `${request.url}\u0000${puzzleTokenSecret ?? ""}`;
}

function cachedGeneratedPuzzle(cache: GeneratedPuzzleCache, key: string, now: number): Response | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    cache.delete(key);
    return undefined;
  }
  // Refresh insertion order so the oldest entry is evicted first.
  cache.delete(key);
  cache.set(key, entry);
  return entry.response.clone();
}

function cacheGeneratedPuzzle(cache: GeneratedPuzzleCache, key: string, response: Response, now: number): void {
  if (response.status !== 200 && response.status !== 422) return;
  cache.set(key, { expiresAt: now + GENERATED_PUZZLE_CACHE_TTL_MS, response: response.clone() });
  while (cache.size > MAX_GENERATED_PUZZLE_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
}

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
      return { limited: false, remaining: limit - 1, resetAt: Math.ceil((now + RATE_WINDOW_MS) / 1_000) };
    }
    current.count += 1;
    return {
      limited: current.count > limit,
      remaining: Math.max(0, limit - current.count),
      resetAt: Math.ceil(current.resetAt / 1_000),
    };
  };
}

function asRateLimitDecision(result: boolean | RateLimitDecision): RateLimitDecision {
  return typeof result === "boolean" ? { limited: result } : result;
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
  if (request.method !== "GET" || (response.status !== 200 && response.status !== 422)) return response;
  const etag = await contentEtag(response);
  const headers = new Headers(response.headers);
  headers.set("etag", etag);
  if (weaklyMatchesEtag(request.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers });
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Emits privacy-preserving calibration telemetry: never log a caller seed or answer. */
function observeDifficultyGeneration(response: Response, ctx: ExecutionContext): void {
  if (response.status !== 200 && response.status !== 422) return;
  const task = response.clone().json().then(body => {
    if (!body || typeof body !== "object" || Array.isArray(body)) return;
    const record = body as Record<string, unknown>;
    const difficulty = record.difficulty;
    const error = record.error;
    const outcome = response.status === 200 ? "generated" : "unavailable";
    console.log(JSON.stringify({
      event: "difficulty_generation",
      outcome,
      templateId: typeof record.templateId === "string" ? record.templateId : undefined,
      requestedDifficultyLevel: typeof record.requestedDifficultyLevel === "number" ? record.requestedDifficultyLevel : undefined,
      assessedDifficultyLevel: difficulty && typeof difficulty === "object" && typeof (difficulty as Record<string, unknown>).level === "number" ? (difficulty as Record<string, unknown>).level : undefined,
      modelVersion: difficulty && typeof difficulty === "object" && typeof (difficulty as Record<string, unknown>).modelVersion === "string" ? (difficulty as Record<string, unknown>).modelVersion : undefined,
      errorCode: error && typeof error === "object" && typeof (error as Record<string, unknown>).code === "string" ? (error as Record<string, unknown>).code : undefined,
    }));
  }).catch(() => undefined);
  if (typeof ctx.waitUntil === "function") ctx.waitUntil(task); else void task;
}

function swaggerUiResponse(): Response {
  return new Response(swaggerUiDocument, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

async function staticAsset(request: Request, env: Env, assetPath: string, contentType?: string): Promise<Response> {
  if (!env.ASSETS) return json({ error: { code: "not_configured", message: "static assets are not configured" } }, 503);
  const url = new URL(request.url);
  url.pathname = assetPath;
  url.search = "";
  const asset = await env.ASSETS.fetch(new Request(url, request));
  const headers = new Headers(asset.headers);
  headers.set("x-content-type-options", "nosniff");
  if (contentType) headers.set("content-type", contentType);
  return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
}

async function providerRateLimitDecision(
  provider: Env["REST_RATE_LIMITER"] | undefined,
  request: Request,
  onProviderFailure: () => void,
): Promise<RateLimitDecision | undefined> {
  if (provider) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const client = request.headers.get("cf-connecting-ip") ?? "anonymous";
      return { limited: !(await provider.limit({ key: `${client}:${path}` })).success };
    } catch {
      onProviderFailure();
      console.error(JSON.stringify({ event: "rate_limit_provider_failure", path: new URL(request.url).pathname }));
    }
  }
  return undefined;
}

async function restRateLimitDecision(
  rateLimited: RateLimiter,
  request: Request,
  env: Env,
  onRestProviderFailure: () => void,
  onVerifyProviderFailure: () => void,
): Promise<RateLimitDecision> {
  const verification = new URL(request.url).pathname === "/v1/puzzles/verify";
  const providerDecision = await providerRateLimitDecision(
    verification ? env.VERIFY_RATE_LIMITER : env.REST_RATE_LIMITER,
    request,
    verification ? onVerifyProviderFailure : onRestProviderFailure,
  );
  if (providerDecision) return providerDecision;
  // Retain the local fallback if the relevant provider binding is unavailable.
  if (verification) return asRateLimitDecision(rateLimited(request, env.VERIFY_RATE_LIMIT ?? "10", "verify"));
  return asRateLimitDecision(rateLimited(request, env.REST_RATE_LIMIT ?? "60", "rest"));
}

function allowedOrigin(request: Request, hostnames: string[]) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return hostnames.includes(new URL(origin).hostname); } catch { return false; }
}

export function createWorker(options: WorkerOptions = {}) {
  const clock = options.clock ?? Date.now;
  const rateLimited = options.rateLimiter ?? createRateLimiter(options.localRateLimitStore, clock);
  const generatedPuzzleCache = options.generatedPuzzleCache ?? new Map<string, GeneratedPuzzleCacheEntry>();
  let rateLimitProviderFailed = false;
  let verifyRateLimitProviderFailed = false;
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
      let rateLimitDecision: RateLimitDecision | undefined;
      const finish = (response: Response) => {
        response.headers.set("x-request-id", requestId);
        if (restRequest) {
          const configuredLimit = path === "/v1/puzzles/verify" ? env.VERIFY_RATE_LIMIT ?? "10" : env.REST_RATE_LIMIT ?? "60";
          response.headers.set("ratelimit-limit", configuredLimit);
          response.headers.set("ratelimit-policy", `${configuredLimit};w=60`);
          if (rateLimitDecision?.remaining !== undefined) response.headers.set("ratelimit-remaining", String(rateLimitDecision.remaining));
          else if (response.status === 429) response.headers.set("ratelimit-remaining", "0");
          if (rateLimitDecision?.resetAt !== undefined) response.headers.set("ratelimit-reset", String(rateLimitDecision.resetAt));
        }
        if (responseCorsHeaders) for (const [name, value] of Object.entries(responseCorsHeaders)) response.headers.set(name, value);
        console.log(JSON.stringify({ event: "request", requestId, method: request.method, path, status: response.status, durationMs: Date.now() - startedAt }));
        return response;
      };
      const build = { serviceVersion: env.BUILD_VERSION ?? "0.1.0", buildSha: env.BUILD_SHA ?? "local" };
      if (path === "/") return finish(new Response(null, { status: 302, headers: { location: new URL("/docs", request.url).toString(), "cache-control": "no-store" } }));
      if (path === "/healthz") return finish(json({ status: "ok", build }));
      if (path === "/readyz") return finish(json({
        status: "ready", build,
        rateLimitProvider: env.REST_RATE_LIMITER && !rateLimitProviderFailed ? "configured" : "fallback",
        verifyRateLimitProvider: env.VERIFY_RATE_LIMITER && !verifyRateLimitProviderFailed ? "configured" : "fallback",
      }));
      if (path === "/docs" || path === "/docs/") return finish(swaggerUiResponse());
      if (path === "/openapi/v1.yaml") return finish(await staticAsset(request, env, "/openapi/v1.yaml", "application/yaml; charset=utf-8"));
      if (restRequest && request.method === "OPTIONS") {
        const requestedMethod = request.headers.get("access-control-request-method");
        const requestedHeaders = request.headers.get("access-control-request-headers")?.split(",").map(value => value.trim().toLowerCase()).filter(Boolean) ?? [];
        if (!responseCorsHeaders || !["GET", "POST"].includes(requestedMethod?.toUpperCase() ?? "") || requestedHeaders.some(header => header !== "content-type")) return finish(json({ error: { code: "forbidden", message: "Origin is not allowed" } }, 403));
        return finish(new Response(null, { status: 204 }));
      }
      if (restRequest) rateLimitDecision = await restRateLimitDecision(
        rateLimited,
        request,
        env,
        () => { rateLimitProviderFailed = true; },
        () => { verifyRateLimitProviderFailed = true; },
      );
      if (rateLimitDecision?.limited) {
        return finish(new Response(JSON.stringify({ error: { code: "rate_limited", message: "Too many requests" } }), {
          status: 429,
          headers: { "content-type": "application/json; charset=utf-8", "retry-after": "60" },
        }));
      }
      if (path !== "/mcp") {
        const routeRequest = () => path === "/v1/puzzles/generate" && options.generatePuzzleResponse
          ? options.generatePuzzleResponse(request)
          : createRestRouter(templates, { puzzleTokenSecret: env.PUZZLE_TOKEN_SECRET, ...build })(request);
        const cacheKey = request.method === "GET" && path === "/v1/puzzles/generate"
          ? generatedPuzzleCacheKey(request, env.PUZZLE_TOKEN_SECRET)
          : undefined;
        const restResponse = cacheKey
          ? cachedGeneratedPuzzle(generatedPuzzleCache, cacheKey, clock()) ?? await routeRequest()
          : await routeRequest();
        if (cacheKey) cacheGeneratedPuzzle(generatedPuzzleCache, cacheKey, restResponse, clock());
        if (path === "/v1/puzzles/generate") observeDifficultyGeneration(restResponse, ctx);
        return finish(await cachePublicGet(restResponse, request));
      }
      if (asRateLimitDecision(rateLimited(request, env.MCP_RATE_LIMIT, "mcp")).limited) {
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
