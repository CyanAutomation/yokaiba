import { createRestRouter } from "../src/api/router.js";
import { createYokaibaMcpHandler } from "../src/mcp/server.js";
import { tournamentOrderTemplate } from "../src/templates/tournament-order.js";
import { tournamentOrderV2Template } from "../src/templates/tournament-order-v2.js";
import { openDivisionTemplate } from "../src/templates/open-division.js";
import { championshipCircuitTemplate } from "../src/templates/championship-circuit.js";
import { championshipBridgeTemplate } from "../src/templates/championship-bridge.js";
import { hostHeaderValidationResponse } from "@modelcontextprotocol/server";
import { json } from "../src/api/json-response.js";

interface Env {
  /** Matches Budokon's API-key secret name and protects the MCP endpoint. */
  API_KEY?: string;
  /** Optional JSON object of client IDs to API keys for per-client MCP quotas. */
  MCP_API_KEYS?: string;
  /** Required comma-separated hostnames, e.g. yokaiba.example.com,yokaiba.workers.dev. */
  MCP_ALLOWED_HOSTNAMES?: string;
  /** Optional requests-per-minute override. Defaults to 30. */
  MCP_RATE_LIMIT?: string;
  /** Optional unauthenticated MCP requests-per-window override. Defaults to 10. */
  MCP_PREAUTH_RATE_LIMIT?: string;
  /** Optional expensive generate_puzzle MCP requests-per-minute override. Defaults to 10. */
  MCP_GENERATE_RATE_LIMIT?: string;
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
  /** Optional best-effort puzzle-hint requests per minute; defaults to 10. */
  HINT_RATE_LIMIT?: string;
  /** Optional Cloudflare Rate Limiting binding for production-wide general REST enforcement. */
  REST_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  /** Optional Cloudflare Rate Limiting binding for production-wide answer-verification enforcement. */
  VERIFY_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  /** Optional Cloudflare binding that throttles unauthenticated MCP traffic before authentication. */
  MCP_PREAUTH_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  /** Optional Cloudflare binding for authenticated MCP request enforcement. */
  MCP_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  /** Optional Cloudflare binding for the expensive MCP generate_puzzle operation. */
  MCP_GENERATE_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  /** Static public assets, including Swagger UI and the canonical OpenAPI document. */
  ASSETS?: { fetch(request: Request): Promise<Response> };
}

const templates = [tournamentOrderV2Template, tournamentOrderTemplate, openDivisionTemplate, championshipBridgeTemplate, championshipCircuitTemplate];
const mcp = createYokaibaMcpHandler(templates);

// JSON response builder provided by src/api/json-response.ts

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

function requestApiKey(request: Request): string | null {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? request.headers.get("x-api-key");
}

function authorized(request: Request, key: string | undefined) {
  if (!key) return false;
  const candidate = requestApiKey(request);
  return candidate !== null && constantTimeEqual(key, candidate);
}

function configuredMcpApiKeys(env: Env): string[] | undefined {
  if (!env.MCP_API_KEYS) return env.API_KEY ? [env.API_KEY] : undefined;
  try {
    const parsed = JSON.parse(env.MCP_API_KEYS) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const keys = Object.values(parsed).filter((value): value is string => typeof value === "string" && value.length > 0);
    return keys.length > 0 ? keys : undefined;
  } catch {
    return undefined;
  }
}

function authenticatedMcpApiKey(request: Request, env: Env): string | undefined {
  const candidate = requestApiKey(request);
  const keys = configuredMcpApiKeys(env);
  if (!candidate || !keys) return undefined;
  let matchingKey: string | undefined;
  for (const key of keys) if (constantTimeEqual(key, candidate)) matchingKey ??= key;
  return matchingKey;
}

async function apiKeyFingerprint(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(key));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function mcpToolName(request: Request): Promise<string | undefined> {
  if (request.method !== "POST") return undefined;
  try {
    const payload = await request.clone().json() as { method?: unknown; params?: { name?: unknown } };
    return payload.method === "tools/call" && typeof payload.params?.name === "string" ? payload.params.name : undefined;
  } catch {
    return undefined;
  }
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
import { GeneratedPuzzleCache, generatedPuzzleCacheKey, cachedGeneratedPuzzle, cacheGeneratedPuzzle, cachePublicGet } from "./cache.js";
export { GeneratedPuzzleCache } from "./cache.js";

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

// `contentEtag` and `cachePublicGet` were moved to ./cache.ts and are imported above.

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
  key = `${request.headers.get("cf-connecting-ip") ?? "anonymous"}:${new URL(request.url).pathname}`,
): Promise<RateLimitDecision | undefined> {
  if (provider) {
    try {
      return { limited: !(await provider.limit({ key })).success };
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
  const protectedPuzzleOperation = ["/v1/puzzles/verify", "/v1/puzzles/hint"].includes(new URL(request.url).pathname);
  const providerDecision = await providerRateLimitDecision(
    protectedPuzzleOperation ? env.VERIFY_RATE_LIMITER : env.REST_RATE_LIMITER,
    request,
    protectedPuzzleOperation ? onVerifyProviderFailure : onRestProviderFailure,
  );
  if (providerDecision) return providerDecision;
  // Retain the local fallback if the relevant provider binding is unavailable.
  if (protectedPuzzleOperation) return asRateLimitDecision(rateLimited(request, new URL(request.url).pathname === "/v1/puzzles/hint" ? env.HINT_RATE_LIMIT ?? "10" : env.VERIFY_RATE_LIMIT ?? "10", "protected-puzzle"));
  return asRateLimitDecision(rateLimited(request, env.REST_RATE_LIMIT ?? "60", "rest"));
}

function allowedOrigin(request: Request, hostnames: string[]) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return hostnames.includes(new URL(origin).hostname); } catch { return false; }
}

interface ProviderFailures {
  rest: boolean;
  verify: boolean;
  mcpPreAuth: boolean;
  mcp: boolean;
  mcpGenerate: boolean;
}

interface RequestContext {
  readonly startedAt: number;
  readonly requestId: string;
  readonly path: string;
  readonly restRequest: boolean;
  readonly responseCorsHeaders?: Record<string, string>;
  rateLimitDecision?: RateLimitDecision;
  rateLimitScope?: string;
}

function buildInfo(env: Env) {
  return { serviceVersion: env.BUILD_VERSION ?? "0.1.0", buildSha: env.BUILD_SHA ?? "local" };
}

function configuredRestLimit(path: string, env: Env): string {
  if (path === "/v1/puzzles/verify") return env.VERIFY_RATE_LIMIT ?? "10";
  if (path === "/v1/puzzles/hint") return env.HINT_RATE_LIMIT ?? "10";
  return env.REST_RATE_LIMIT ?? "60";
}

function finalizeResponse(response: Response, request: Request, env: Env, context: RequestContext): Response {
  response.headers.set("x-request-id", context.requestId);
  if (context.restRequest) {
    const configuredLimit = configuredRestLimit(context.path, env);
    response.headers.set("ratelimit-limit", configuredLimit);
    response.headers.set("ratelimit-policy", `${configuredLimit};w=60`);
    if (context.rateLimitDecision?.remaining !== undefined) response.headers.set("ratelimit-remaining", String(context.rateLimitDecision.remaining));
    else if (response.status === 429) response.headers.set("ratelimit-remaining", "0");
    if (context.rateLimitDecision?.resetAt !== undefined) response.headers.set("ratelimit-reset", String(context.rateLimitDecision.resetAt));
  }
  if (context.responseCorsHeaders) for (const [name, value] of Object.entries(context.responseCorsHeaders)) response.headers.set(name, value);
  if (response.status === 429) console.log(JSON.stringify({ event: "rate_limited", requestId: context.requestId, path: context.path, scope: context.rateLimitScope ?? "unknown" }));
  console.log(JSON.stringify({ event: "request", requestId: context.requestId, method: request.method, path: context.path, status: response.status, durationMs: Date.now() - context.startedAt }));
  return response;
}

function tooManyRequests(): Response {
  return new Response(JSON.stringify({ error: { code: "rate_limited", message: "Too many requests" } }), {
    status: 429,
    headers: { "content-type": "application/json; charset=utf-8", "retry-after": "60" },
  });
}

function readinessResponse(env: Env, build: ReturnType<typeof buildInfo>, failures: ProviderFailures): Response {
  return json({
    status: "ready", build,
    rateLimitProvider: env.REST_RATE_LIMITER && !failures.rest ? "configured" : "fallback",
    verifyRateLimitProvider: env.VERIFY_RATE_LIMITER && !failures.verify ? "configured" : "fallback",
    mcpPreAuthRateLimitProvider: env.MCP_PREAUTH_RATE_LIMITER && !failures.mcpPreAuth ? "configured" : "fallback",
    mcpRateLimitProvider: env.MCP_RATE_LIMITER && !failures.mcp ? "configured" : "fallback",
    mcpGenerateRateLimitProvider: env.MCP_GENERATE_RATE_LIMITER && !failures.mcpGenerate ? "configured" : "fallback",
  });
}

async function staticRoute(path: string, request: Request, env: Env, build: ReturnType<typeof buildInfo>, failures: ProviderFailures): Promise<Response | undefined> {
  if (path === "/") return new Response(null, { status: 302, headers: { location: new URL("/docs", request.url).toString(), "cache-control": "no-store" } });
  if (path === "/healthz") return json({ status: "ok", build });
  if (path === "/readyz") return readinessResponse(env, build, failures);
  if (path === "/docs" || path === "/docs/") return swaggerUiResponse();
  if (path === "/openapi/v1.yaml") return staticAsset(request, env, "/openapi/v1.yaml", "application/yaml; charset=utf-8");
  return undefined;
}

function corsPreflight(request: Request, cors: Record<string, string> | undefined): Response {
  const requestedMethod = request.headers.get("access-control-request-method");
  const requestedHeaders = request.headers.get("access-control-request-headers")?.split(",").map(value => value.trim().toLowerCase()).filter(Boolean) ?? [];
  if (!cors || !["GET", "POST"].includes(requestedMethod?.toUpperCase() ?? "") || requestedHeaders.some(header => header !== "content-type")) {
    return json({ error: { code: "forbidden", message: "Origin is not allowed" } }, 403);
  }
  return new Response(null, { status: 204 });
}

interface RestRequestDependencies {
  readonly options: WorkerOptions;
  readonly cache: GeneratedPuzzleCache;
  readonly inFlight: Map<string, Promise<Response>>;
  readonly clock: () => number;
  readonly build: ReturnType<typeof buildInfo>;
}

async function routeRestRequest(request: Request, path: string, env: Env, ctx: ExecutionContext, dependencies: RestRequestDependencies): Promise<Response> {
  const route = () => path === "/v1/puzzles/generate" && dependencies.options.generatePuzzleResponse
    ? dependencies.options.generatePuzzleResponse(request)
    : createRestRouter(templates, { puzzleTokenSecret: env.PUZZLE_TOKEN_SECRET, ...dependencies.build })(request);
  const cacheKey = request.method === "GET" && path === "/v1/puzzles/generate"
    ? await generatedPuzzleCacheKey(request, env.PUZZLE_TOKEN_SECRET)
    : undefined;
  let response: Response;
  if (!cacheKey) {
    response = await route();
  } else {
    const cached = cachedGeneratedPuzzle(dependencies.cache, cacheKey, dependencies.clock());
    if (cached) {
      response = cached;
    } else {
      let generation = dependencies.inFlight.get(cacheKey);
      if (!generation) {
        generation = (async () => cacheGeneratedPuzzle(dependencies.cache, cacheKey, await route(), dependencies.clock()))();
        dependencies.inFlight.set(cacheKey, generation);
      }
      try {
        response = (await generation).clone();
      } finally {
        if (dependencies.inFlight.get(cacheKey) === generation) dependencies.inFlight.delete(cacheKey);
      }
    }
  }
  if (path === "/v1/puzzles/generate") observeDifficultyGeneration(response, ctx);
  return cachePublicGet(response, request);
}

interface McpRequestDependencies {
  readonly rateLimited: RateLimiter;
  readonly failures: ProviderFailures;
  readonly finish: (response: Response) => Response;
  readonly setRateLimit: (scope: string, decision: RateLimitDecision) => boolean;
}

async function resolveMcpRateLimit(
  request: Request,
  provider: Env["MCP_RATE_LIMITER"] | undefined,
  rawLimit: string | undefined,
  scope: string,
  rateLimited: RateLimiter,
  onProviderFailure: () => void,
  key?: string,
): Promise<RateLimitDecision> {
  return await providerRateLimitDecision(provider, request, onProviderFailure, key)
    ?? asRateLimitDecision(rateLimited(request, rawLimit, scope));
}

async function authenticatedMcpPrincipal(request: Request, env: Env, finish: (response: Response) => Response): Promise<string | Response> {
  const authenticatedApiKey = authenticatedMcpApiKey(request, env);
  if (!configuredMcpApiKeys(env) || !env.MCP_ALLOWED_HOSTNAMES) return finish(json({ error: { code: "not_configured", message: "MCP credentials and allowed hosts are required" } }, 503));
  if (!authenticatedApiKey) return finish(json({ error: { code: "unauthorized", message: "A valid API key is required" } }, 401));
  const hostnames = env.MCP_ALLOWED_HOSTNAMES.split(",").map(value => value.trim()).filter(Boolean);
  const rejectedHost = hostHeaderValidationResponse(request, hostnames);
  if (rejectedHost) return finish(rejectedHost);
  if (!allowedOrigin(request, hostnames)) return finish(json({ error: { code: "forbidden", message: "Origin is not allowed" } }, 403));
  return `api-key:${await apiKeyFingerprint(authenticatedApiKey)}`;
}

async function routeMcpRequest(request: Request, env: Env, dependencies: McpRequestDependencies): Promise<Response> {
  const preAuthDecision = await resolveMcpRateLimit(
    request,
    env.MCP_PREAUTH_RATE_LIMITER,
    env.MCP_PREAUTH_RATE_LIMIT ?? env.MCP_RATE_LIMIT ?? "10",
    "mcp-preauth",
    dependencies.rateLimited,
    () => { dependencies.failures.mcpPreAuth = true; },
  );
  if (dependencies.setRateLimit("mcp-preauth", preAuthDecision)) return dependencies.finish(tooManyRequests());

  const principal = await authenticatedMcpPrincipal(request, env, dependencies.finish);
  if (principal instanceof Response) return principal;
  const principalLimit = await resolveMcpRateLimit(
    request,
    env.MCP_RATE_LIMITER,
    env.MCP_RATE_LIMIT,
    "mcp",
    dependencies.rateLimited,
    () => { dependencies.failures.mcp = true; },
    `${principal}:mcp`,
  );
  if (dependencies.setRateLimit("mcp", principalLimit)) return dependencies.finish(tooManyRequests());

  if (await mcpToolName(request) === "generate_puzzle") {
    const generationLimit = await resolveMcpRateLimit(
      request,
      env.MCP_GENERATE_RATE_LIMITER,
      env.MCP_GENERATE_RATE_LIMIT ?? "10",
      "mcp-generate",
      dependencies.rateLimited,
      () => { dependencies.failures.mcpGenerate = true; },
      `${principal}:generate_puzzle`,
    );
    if (dependencies.setRateLimit("mcp-generate", generationLimit)) return dependencies.finish(tooManyRequests());
  }
  return dependencies.finish(await mcp.fetch(request));
}

export function createWorker(options: WorkerOptions = {}) {
  const clock = options.clock ?? Date.now;
  const rateLimited = options.rateLimiter ?? createRateLimiter(options.localRateLimitStore, clock);
  const generatedPuzzleCache = options.generatedPuzzleCache ?? new GeneratedPuzzleCache();
  const generatedPuzzleRequests = new Map<string, Promise<Response>>();
  const failures: ProviderFailures = { rest: false, verify: false, mcpPreAuth: false, mcp: false, mcpGenerate: false };
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
      const context: RequestContext = {
        startedAt,
        requestId,
        path,
        restRequest,
        responseCorsHeaders: restRequest ? corsHeaders(request.headers.get("origin"), configuredOrigins(env.REST_ALLOWED_ORIGINS)) : undefined,
      };
      const finish = (response: Response) => finalizeResponse(response, request, env, context);
      const build = buildInfo(env);

      const staticResponse = await staticRoute(path, request, env, build, failures);
      if (staticResponse) return finish(staticResponse);
      if (restRequest && request.method === "OPTIONS") return finish(corsPreflight(request, context.responseCorsHeaders));

      if (restRequest) {
        context.rateLimitDecision = await restRateLimitDecision(rateLimited, request, env,
          () => { failures.rest = true; },
          () => { failures.verify = true; });
        context.rateLimitScope = path === "/v1/puzzles/verify" || path === "/v1/puzzles/hint" ? "protected-puzzle" : "rest";
        if (context.rateLimitDecision.limited) return finish(tooManyRequests());
      }

      if (path === "/mcp") {
        return routeMcpRequest(request, env, {
          rateLimited,
          failures,
          finish,
          setRateLimit: (scope, decision) => {
            context.rateLimitScope = scope;
            context.rateLimitDecision = decision;
            return decision.limited;
          },
        });
      }
      const response = await routeRestRequest(request, path, env, ctx, {
        options,
        cache: generatedPuzzleCache,
        inFlight: generatedPuzzleRequests,
        clock,
        build,
      });
      return finish(response);
    },
  } satisfies ExportedHandler<Env>;
}

export default createWorker();
