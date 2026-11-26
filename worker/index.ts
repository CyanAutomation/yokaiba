import { createRestRouter } from "../src/api/router.js";
import type { PuzzleSolver } from "../src/domain/puzzle-solver.js";
import { SOLVER_VERSION } from "../src/generation/generator.js";
import { RUST_WASM_SOLVER_VERSION } from "../src/constraints/rust-solver.js";
import { createUtcpManual, DEFAULT_PUBLIC_API_BASE_URL } from "../src/utcp/manual.js";
import { tournamentOrderTemplate } from "../src/templates/tournament-order.js";
import { tournamentOrderV2Template } from "../src/templates/tournament-order-v2.js";
import { openDivisionTemplate } from "../src/templates/open-division.js";
import { championshipCircuitTemplate } from "../src/templates/championship-circuit.js";
import { championshipBridgeTemplate } from "../src/templates/championship-bridge.js";
import { json } from "../src/api/json-response.js";
import { DEFAULT_PUZZLE_TOKEN_TTL_SECONDS, MAX_PUZZLE_TOKEN_TTL_SECONDS } from "../src/api/puzzle-token.js";
import { emitDifficultyGeneration } from "./difficulty-telemetry.js";
import { createPuzzleFeedbackSink, type D1DatabaseLike } from "./puzzle-feedback-storage.js";
import {
  createRateLimiter,
  restRateLimitConfiguration,
  restRateLimitDecision,
  type RateLimitDecision,
  type RateLimiter,
  type RateLimitStore,
} from "./rate-limit.js";
export type { RateLimiter, RateLimitStore } from "./rate-limit.js";

export interface Env {
  /** Canonical HTTPS origin advertised in UTCP HTTP call templates. */
  PUBLIC_API_BASE_URL?: string;
  /** Comma-separated browser origins permitted to call the public REST API. */
  REST_ALLOWED_ORIGINS?: string;
  /** HMAC secret used to issue and validate browser puzzle tokens. */
  PUZZLE_TOKEN_SECRET?: string;
  /** Optional JSON array of prior HMAC secrets retained for token rotation grace. */
  PUZZLE_TOKEN_PREVIOUS_SECRETS?: string;
  /** Token lifetime in seconds; defaults to seven days and is capped at 30 days. */
  PUZZLE_TOKEN_TTL_SECONDS?: string;
  /** Solver used for generation. Wrangler selects Rust/Wasm; unset values use TypeScript. */
  SOLVER_BACKEND?: string;
  /** Deployment-time package version and immutable revision, injected by CI. */
  BUILD_VERSION?: string;
  BUILD_SHA?: string;
  /** Optional best-effort, per-isolate REST requests-per-minute override. Defaults to 60. */
  REST_RATE_LIMIT?: string;
  /** Optional best-effort REST puzzle-generation requests per minute; defaults to 10. */
  REST_GENERATE_RATE_LIMIT?: string;
  /** Optional per-isolate fallback for answer verification when VERIFY_RATE_LIMITER is not configured; defaults to 10/minute. */
  VERIFY_RATE_LIMIT?: string;
  /** Optional per-isolate fallback for puzzle hints when VERIFY_RATE_LIMITER is not configured; defaults to 10/minute. */
  HINT_RATE_LIMIT?: string;
  /** Optional per-isolate fallback for feedback when VERIFY_RATE_LIMITER is not configured; defaults to 10/minute. */
  FEEDBACK_RATE_LIMIT?: string;
  /** Optional Cloudflare Rate Limiting binding for production-wide general REST enforcement. */
  REST_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  /** Optional Cloudflare Rate Limiting binding for REST puzzle generation. */
  REST_GENERATE_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  /** Shared Cloudflare Rate Limiting binding for answer verification, hints, and feedback; these operations fail closed if it errors. */
  VERIFY_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  /** Cloudflare Analytics Engine dataset for anonymous puzzle outcome events. */
  PUZZLE_OUTCOMES?: AnalyticsEngineDataset;
  /** Cloudflare D1 database for durable anonymous player feedback. */
  PUZZLE_FEEDBACK?: D1DatabaseLike;
  /** Static public assets, including the canonical OpenAPI documents. */
  ASSETS?: { fetch(request: Request): Promise<Response> };
}

const templates = [tournamentOrderV2Template, tournamentOrderTemplate, openDivisionTemplate, championshipBridgeTemplate, championshipCircuitTemplate];

// JSON response builder provided by src/api/json-response.ts

const docsDocument = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="REST API and UTCP documentation for Yokaiba." />
  <title>Yokaiba API documentation</title>
  <style>
    :root { color-scheme: light dark; font: 16px/1.6 system-ui, sans-serif; }
    body { max-width: 960px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
    header { margin-bottom: 2.5rem; }
    h1, h2 { line-height: 1.2; }
    h1 { margin-bottom: .35rem; }
    p { max-width: 72ch; }
    a { color: #1674d1; }
    nav, .links { display: flex; flex-wrap: wrap; gap: .6rem 1.25rem; }
    .links { margin: 1.25rem 0 2rem; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0 2rem; }
    th, td { text-align: left; vertical-align: top; padding: .7rem; border-bottom: 1px solid #8886; }
    th { font-size: .9rem; }
    code { font: .92em ui-monospace, monospace; overflow-wrap: anywhere; }
    .method { display: inline-block; min-width: 3.3em; font-weight: 700; }
    .note { padding: .8rem 1rem; border-left: 3px solid #1674d1; background: #8881; }
    @media (max-width: 600px) { body { padding: 1.25rem .8rem 3rem; } th, td { padding: .55rem .35rem; } }
  </style>
</head>
<body>
  <header>
    <h1>Yokaiba API</h1>
    <p>Build judo logic-grid puzzle experiences with the REST API, or connect a UTCP client to discover and call Yokaiba tools directly.</p>
    <nav aria-label="API specifications and guides">
      <a href="/openapi/v1.yaml">REST OpenAPI specification</a>
      <a href="/openapi/chatgpt-actions-v1.yaml">ChatGPT Actions specification</a>
      <a href="https://github.com/CyanAutomation/yokaiba/blob/main/docs/api-usage.md">REST usage guide</a>
      <a href="/utcp">UTCP manual</a>
      <a href="https://github.com/CyanAutomation/yokaiba/blob/main/docs/operations-and-deployment.md#utcp-tool-discovery">UTCP setup</a>
    </nav>
  </header>

  <main>
    <section aria-labelledby="rest-title">
      <h2 id="rest-title">REST API</h2>
      <p>REST endpoints return JSON. Puzzle generation and public catalogue endpoints are available without authentication. Answer verification and hints require a configured <code>PUZZLE_TOKEN_SECRET</code> and the token returned with a generated puzzle.</p>
      <table>
        <thead><tr><th scope="col">Method</th><th scope="col">Endpoint</th><th scope="col">Description</th></tr></thead>
        <tbody>
          <tr><td><span class="method">GET</span></td><td><a href="/healthz"><code>/healthz</code></a></td><td>Check that the service is responding.</td></tr>
          <tr><td><span class="method">GET</span></td><td><a href="/readyz"><code>/readyz</code></a></td><td>Check service readiness and configured providers.</td></tr>
          <tr><td><span class="method">GET</span></td><td><a href="/v1/scenarios"><code>/v1/scenarios</code></a></td><td>List available puzzle scenarios and board categories.</td></tr>
          <tr><td><span class="method">GET</span></td><td><a href="/v1/capabilities"><code>/v1/capabilities</code></a></td><td>Discover supported features and difficulty ranges.</td></tr>
          <tr><td><span class="method">GET</span></td><td><a href="/v1/version"><code>/v1/version</code></a></td><td>Get service, generator, and solver versions.</td></tr>
          <tr><td><span class="method">GET · POST</span></td><td><code>/v1/puzzles/generate</code></td><td>Generate a puzzle. GET supports deterministic, cacheable requests; POST supports JSON bodies.</td></tr>
          <tr><td><span class="method">POST</span></td><td><code>/v1/puzzles/verify</code></td><td>Verify submitted answers using a puzzle token.</td></tr>
          <tr><td><span class="method">POST</span></td><td><code>/v1/puzzles/hint</code></td><td>Request a bounded hint using a puzzle token.</td></tr>
          <tr><td><span class="method">POST</span></td><td><code>/v1/events</code></td><td>Record an anonymous puzzle outcome for calibration.</td></tr>
          <tr><td><span class="method">POST</span></td><td><code>/v1/feedback</code></td><td>Store anonymous difficulty feedback for a signed generated puzzle.</td></tr>
        </tbody>
      </table>
      <h3>Generate a puzzle</h3>
      <p>Use a template ID from <code>/v1/scenarios</code> and a seed to make a reproducible request:</p>
      <pre><code>curl 'https://yokaiba.scheimann.workers.dev/v1/puzzles/generate?templateId=tournament-order-v2&amp;seed=first-puzzle'</code></pre>
      <p class="note">The generated response contains the puzzle and a token for later verification or hints. It does not include the hidden solution.</p>
    </section>

    <section aria-labelledby="utcp-title">
      <h2 id="utcp-title">UTCP</h2>
      <p>Fetch the <a href="/utcp">UTCP manual</a> to discover tool schemas and direct HTTP call templates. UTCP clients call the REST endpoints themselves; puzzle actions require a token returned during generation.</p>
    </section>
  </main>
</body>
</html>`;

export interface WorkerOptions {
  localRateLimitStore?: RateLimitStore;
  clock?: () => number;
  rateLimiter?: RateLimiter;
  generatedPuzzleCache?: GeneratedPuzzleCache;
  cacheKeyBuilder?: typeof generatedPuzzleCacheKey;
  generatePuzzleResponse?: (request: Request) => Response | Promise<Response>;
  /** Injected loader keeps Rust/Wasm selection testable without changing the default backend. */
  rustSolverLoader?: () => Promise<PuzzleSolver>;
  cachedPublicFetch?: (request: Request, ctx: ExecutionContext) => Promise<Response>;
}
import { GeneratedPuzzleCache, generatedPuzzleCacheKey, cachedGeneratedPuzzle, cacheGeneratedPuzzle, cachePublicGet } from "./cache.js";
export { GeneratedPuzzleCache } from "./cache.js";

function configuredOrigins(rawOrigins: string | undefined) {
  return (rawOrigins ?? "").split(",").map(value => value.trim()).filter(Boolean);
}

function corsHeaders(origin: string | null, allowedOrigins: string[], methods = "GET, POST, OPTIONS") {
  if (!origin || !allowedOrigins.includes(origin)) return undefined;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": methods,
    "access-control-allow-headers": "content-type, if-none-match",
    "access-control-expose-headers": "etag, x-request-id, ratelimit-limit, ratelimit-policy, ratelimit-remaining, ratelimit-reset, retry-after",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };
}

function weaklyMatchesEtag(ifNoneMatch: string | null, etag: string): boolean {
  if (ifNoneMatch === null) return false;
  return ifNoneMatch.split(",").map(value => value.trim()).some(value => value === "*" || value.replace(/^W\//, "") === etag);
}

// `contentEtag` and `cachePublicGet` were moved to ./cache.ts and are imported above.

function observeDifficultyGeneration(response: Response, ctx: ExecutionContext): void {
  if (response.status !== 200 && response.status !== 422) return;
  const task = emitDifficultyGeneration(response.clone()).catch(() => undefined);
  if (typeof ctx.waitUntil === "function") ctx.waitUntil(task); else void task;
}

function docsResponse(): Response {
  return new Response(docsDocument, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300, must-revalidate",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
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
  headers.set("cache-control", asset.status === 200
    ? "public, max-age=300, s-maxage=300, must-revalidate"
    : "no-store");
  return cachePublicGet(new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers }), request);
}

function noStoreIfUnspecified(response: Response): Response {
  if (response.headers.has("cache-control")) return response;
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

interface ProviderFailures {
  rest: boolean;
  restGenerate: boolean;
  verify: boolean;
  outcomeTelemetry: boolean;
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

function configuredSolverVersion(env: Env): string {
  if (env.SOLVER_BACKEND === undefined || env.SOLVER_BACKEND === "typescript") return SOLVER_VERSION;
  if (env.SOLVER_BACKEND === "rust") return RUST_WASM_SOLVER_VERSION;
  throw new Error("SOLVER_BACKEND must be typescript or rust");
}

function solverVersionForPath(path: string, env: Env): string {
  return path === "/v1/puzzles/generate" ? configuredSolverVersion(env) : SOLVER_VERSION;
}

async function loadGenerationSolver(
  path: string,
  solverVersion: string,
  options: WorkerOptions,
): Promise<PuzzleSolver | undefined> {
  if (path !== "/v1/puzzles/generate" || solverVersion !== RUST_WASM_SOLVER_VERSION) return undefined;
  if (options.rustSolverLoader) return options.rustSolverLoader();
  const runtime = await import("../src/constraints/rust-solver-runtime.js");
  return runtime.rustWasmPuzzleSolver;
}

function configuredRestLimit(path: string, env: Env): string {
  return restRateLimitConfiguration(path, env).limit;
}

function finalizeResponse(response: Response, request: Request, env: Env, context: RequestContext): Response {
  if (!response.headers.has("cache-control")) response.headers.set("cache-control", "no-store");
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

function rateLimitProviderState(provider: unknown, failed: boolean, failClosedOnFailure = false): "configured" | "fallback" | "failing" {
  if (!provider) return "fallback";
  if (!failed) return "configured";
  return failClosedOnFailure ? "failing" : "fallback";
}

function outcomeTelemetryProviderState(provider: unknown, failed: boolean): "disabled" | "failing" | "configured" {
  if (!provider) return "disabled";
  return failed ? "failing" : "configured";
}

function readinessResponse(env: Env, build: ReturnType<typeof buildInfo>, failures: ProviderFailures): Response {
  return json({
    status: "ready", build,
    rateLimitProvider: rateLimitProviderState(env.REST_RATE_LIMITER, failures.rest),
    generateRateLimitProvider: rateLimitProviderState(env.REST_GENERATE_RATE_LIMITER, failures.restGenerate, true),
    verifyRateLimitProvider: rateLimitProviderState(env.VERIFY_RATE_LIMITER, failures.verify, true),
    outcomeTelemetryProvider: outcomeTelemetryProviderState(env.PUZZLE_OUTCOMES, failures.outcomeTelemetry),
  });
}

function previousPuzzleTokenSecrets(env: Env): string[] {
  if (!env.PUZZLE_TOKEN_PREVIOUS_SECRETS) return [];
  try {
    const value: unknown = JSON.parse(env.PUZZLE_TOKEN_PREVIOUS_SECRETS);
    return Array.isArray(value) ? value.filter((secret): secret is string => typeof secret === "string" && secret.length > 0) : [];
  } catch {
    return [];
  }
}

function puzzleTokenTtlSeconds(env: Env): number {
  const configured = Number(env.PUZZLE_TOKEN_TTL_SECONDS);
  return Number.isSafeInteger(configured) && configured >= 1 && configured <= MAX_PUZZLE_TOKEN_TTL_SECONDS
    ? configured
    : DEFAULT_PUZZLE_TOKEN_TTL_SECONDS;
}

const OUTCOME_METRIC_FIELDS = ["requestedDifficultyLevel", "assessedDifficultyLevel", "clueCount", "elapsedMs", "hintsUsed", "mistakes"] as const;

function writePuzzleOutcome(dataset: AnalyticsEngineDataset, event: Record<string, unknown>): void {
  let presentFields = 0;
  const values = OUTCOME_METRIC_FIELDS.map((field, index) => {
    const value = event[field];
    if (typeof value === "number") {
      presentFields |= 1 << index;
      return value;
    }
    return 0;
  });
  values.push(presentFields);
  dataset.writeDataPoint({
    indexes: [String(event.templateId)],
    blobs: [String(event.event), String(event.schemaVersion ?? 0), typeof event.smartMarkingEnabled === "boolean" ? String(event.smartMarkingEnabled) : "unknown"],
    doubles: values,
  });
}

async function utcpManualResponse(request: Request, env: Env, build: ReturnType<typeof buildInfo>): Promise<Response> {
  try {
    return await cachePublicGet(json(createUtcpManual({
      publicApiBaseUrl: env.PUBLIC_API_BASE_URL ?? DEFAULT_PUBLIC_API_BASE_URL,
      serviceVersion: build.serviceVersion,
      puzzleActionsAvailable: Boolean(env.PUZZLE_TOKEN_SECRET),
    }), 200, { "cache-control": "public, max-age=300, s-maxage=300, must-revalidate" }), request);
  } catch {
    return json({ error: { code: "not_configured", message: "UTCP public API base URL is invalid" } }, 503, { "cache-control": "no-store" });
  }
}

async function staticRoute(path: string, request: Request, env: Env, build: ReturnType<typeof buildInfo>, failures: ProviderFailures): Promise<Response | undefined> {
  if (!["/", "/healthz", "/readyz", "/docs", "/docs/", "/utcp", "/openapi/v1.yaml", "/openapi/chatgpt-actions-v1.yaml"].includes(path)) return undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: { code: "method_not_allowed", message: "Method not allowed" } }, 405, { allow: "GET, HEAD" });
  }
  let response: Response;
  if (path === "/") response = new Response(null, { status: 302, headers: { location: new URL("/docs", request.url).toString(), "cache-control": "no-store" } });
  else if (path === "/healthz") response = json({ status: "ok", build }, 200, { "cache-control": "no-store" });
  else if (path === "/readyz") {
    response = await readinessResponse(env, build, failures);
    response.headers.set("cache-control", "no-store");
  } else if (path === "/docs" || path === "/docs/") response = await cachePublicGet(docsResponse(), request);
  else if (path === "/utcp") response = await utcpManualResponse(request, env, build);
  else response = await staticAsset(request, env, path, "application/yaml; charset=utf-8");
  if (request.method === "HEAD") return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers });
  return response;
}

function corsPreflight(request: Request, cors: Record<string, string> | undefined, allowedMethods: readonly string[] = ["GET", "POST"]): Response {
  const requestedMethod = request.headers.get("access-control-request-method");
  const requestedHeaders = request.headers.get("access-control-request-headers")?.split(",").map(value => value.trim().toLowerCase()).filter(Boolean) ?? [];
  const allowedHeaders = new Set(["content-type", "if-none-match"]);
  if (!cors || !allowedMethods.includes(requestedMethod?.toUpperCase() ?? "") || requestedHeaders.some(header => !allowedHeaders.has(header))) {
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
  readonly failures: ProviderFailures;
}

async function generateRestResponse(
  request: Request,
  path: string,
  env: Env,
  dependencies: RestRequestDependencies,
): Promise<Response> {
  if (path === "/v1/puzzles/generate" && dependencies.options.generatePuzzleResponse) {
    return dependencies.options.generatePuzzleResponse(request);
  }
  const solverVersion = configuredSolverVersion(env);
  const solver = await loadGenerationSolver(path, solverVersion, dependencies.options);
  const router = createRestRouter(templates, {
    puzzleTokenSecret: env.PUZZLE_TOKEN_SECRET,
    puzzleTokenPreviousSecrets: env.PUZZLE_TOKEN_SECRET ? previousPuzzleTokenSecrets(env) : [],
    puzzleTokenTtlSeconds: puzzleTokenTtlSeconds(env),
    solverVersion,
    ...(solver ? { solver } : {}),
    ...dependencies.build,
    ...(env.PUZZLE_OUTCOMES ? { recordOutcome: event => {
      try { writePuzzleOutcome(env.PUZZLE_OUTCOMES!, event); }
      catch (error) { dependencies.failures.outcomeTelemetry = true; throw error; }
    } } : {}),
    ...(env.PUZZLE_FEEDBACK ? { recordFeedback: createPuzzleFeedbackSink(env.PUZZLE_FEEDBACK) } : {}),
  });
  return router(request);
}

async function routeRestRequest(request: Request, path: string, env: Env, ctx: ExecutionContext, dependencies: RestRequestDependencies): Promise<Response> {
  const solverVersion = solverVersionForPath(path, env);
  const cacheKey = request.method === "GET" && path === "/v1/puzzles/generate"
    ? await (dependencies.options.cacheKeyBuilder ?? generatedPuzzleCacheKey)(request, env.PUZZLE_TOKEN_SECRET, { solverVersion })
    : undefined;
  let response: Response;
  if (!cacheKey) {
    response = await generateRestResponse(request, path, env, dependencies);
    if (path === "/v1/puzzles/generate") observeDifficultyGeneration(response, ctx);
  } else {
    const cached = cachedGeneratedPuzzle(dependencies.cache, cacheKey, dependencies.clock());
    if (cached) {
      response = cached;
    } else {
      let generation = dependencies.inFlight.get(cacheKey);
      if (!generation) {
        generation = (async () => {
          const generated = await generateRestResponse(request, path, env, dependencies);
          observeDifficultyGeneration(generated, ctx);
          return cacheGeneratedPuzzle(dependencies.cache, cacheKey, generated, dependencies.clock());
        })();
        dependencies.inFlight.set(cacheKey, generation);
      }
      try {
        response = (await generation).clone();
      } finally {
        if (dependencies.inFlight.get(cacheKey) === generation) dependencies.inFlight.delete(cacheKey);
      }
    }
  }
  return cachePublicGet(response, request);
}

interface WorkerRuntimeDependencies {
  readonly options: WorkerOptions;
  readonly rateLimited: RateLimiter;
  readonly cache: GeneratedPuzzleCache;
  readonly inFlight: Map<string, Promise<Response>>;
  readonly clock: () => number;
  readonly failures: ProviderFailures;
}

function invalidUrlResponse(request: Request, startedAt: number, requestId: string): Response {
  const response = json({ error: { code: "bad_request", message: "Invalid URL" } }, 400);
  response.headers.set("x-request-id", requestId);
  console.log(JSON.stringify({ event: "request", requestId, method: request.method, path: "invalid", status: response.status, durationMs: Date.now() - startedAt }));
  return response;
}

const STATIC_CACHE_PATHS = new Set(["/docs", "/docs/", "/utcp", "/openapi/v1.yaml", "/openapi/chatgpt-actions-v1.yaml"]);
const REST_CACHE_PATHS = new Set(["/v1/puzzles/generate", "/v1/scenarios", "/v1/capabilities"]);

function requestFinalizer(request: Request, env: Env, context: RequestContext): (response: Response) => Response {
  return response => finalizeResponse(new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  }), request, env, context);
}

async function tryCachedPublicGet(
  request: Request,
  path: string,
  cacheablePaths: ReadonlySet<string>,
  ctx: ExecutionContext,
  options: WorkerOptions,
  finish: (response: Response) => Response,
): Promise<Response | undefined> {
  if (request.method !== "GET" || !cacheablePaths.has(path) || !options.cachedPublicFetch) return undefined;
  const cacheRequest = new Request(request);
  cacheRequest.headers.delete("origin");
  cacheRequest.headers.delete("if-none-match");
  const cached = await options.cachedPublicFetch(cacheRequest, ctx);
  return finish(await cachePublicGet(cached, request));
}

async function applyRestRequestLimit(
  request: Request,
  path: string,
  env: Env,
  context: RequestContext,
  dependencies: WorkerRuntimeDependencies,
  finish: (response: Response) => Response,
): Promise<Response | undefined> {
  if (!context.restRequest) return undefined;
  context.rateLimitDecision = await restRateLimitDecision(dependencies.rateLimited, request, env,
    () => { dependencies.failures.rest = true; },
    () => { dependencies.failures.restGenerate = true; },
    () => { dependencies.failures.verify = true; });
  context.rateLimitScope = restRateLimitConfiguration(path, env).scope;
  return context.rateLimitDecision.limited ? finish(tooManyRequests()) : undefined;
}

function restRequestDependencies(dependencies: WorkerRuntimeDependencies, build: ReturnType<typeof buildInfo>): RestRequestDependencies {
  return {
    options: dependencies.options,
    cache: dependencies.cache,
    inFlight: dependencies.inFlight,
    clock: dependencies.clock,
    build,
    failures: dependencies.failures,
  };
}

async function dispatchWorkerRequest(
  request: Request,
  path: string,
  env: Env,
  ctx: ExecutionContext,
  context: RequestContext,
  dependencies: WorkerRuntimeDependencies,
): Promise<Response> {
  const finish = requestFinalizer(request, env, context);
  const build = buildInfo(env);
  const cachedStatic = await tryCachedPublicGet(request, path, STATIC_CACHE_PATHS, ctx, dependencies.options, finish);
  if (cachedStatic) return cachedStatic;

  if ((context.restRequest || path === "/utcp") && request.method === "OPTIONS") {
    return finish(corsPreflight(request, context.responseCorsHeaders, context.restRequest ? ["GET", "POST"] : ["GET", "HEAD"]));
  }

  const staticResponse = await staticRoute(path, request, env, build, dependencies.failures);
  if (staticResponse) return finish(staticResponse);

  const limited = await applyRestRequestLimit(request, path, env, context, dependencies, finish);
  if (limited) return limited;

  const cachedRest = await tryCachedPublicGet(request, path, REST_CACHE_PATHS, ctx, dependencies.options, finish);
  if (cachedRest) return cachedRest;

  return finish(await routeRestRequest(request, path, env, ctx, restRequestDependencies(dependencies, build)));
}

async function handleWorkerRequest(request: Request, env: Env, ctx: ExecutionContext, dependencies: WorkerRuntimeDependencies): Promise<Response> {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  let path: string;
  try {
    path = new URL(request.url).pathname;
  } catch {
    return invalidUrlResponse(request, startedAt, requestId);
  }
  const restRequest = path.startsWith("/v1/");
  const utcpDiscoveryRequest = path === "/utcp";
  const context: RequestContext = {
    startedAt,
    requestId,
    path,
    restRequest,
    responseCorsHeaders: restRequest || utcpDiscoveryRequest
      ? corsHeaders(request.headers.get("origin"), configuredOrigins(env.REST_ALLOWED_ORIGINS), utcpDiscoveryRequest ? "GET, HEAD, OPTIONS" : undefined)
      : undefined,
  };
  return dispatchWorkerRequest(request, path, env, ctx, context, dependencies);
}

export function createWorker(options: WorkerOptions = {}) {
  const clock = options.clock ?? Date.now;
  const rateLimited = options.rateLimiter ?? createRateLimiter(options.localRateLimitStore, clock);
  const generatedPuzzleCache = options.generatedPuzzleCache ?? new GeneratedPuzzleCache();
  const generatedPuzzleRequests = new Map<string, Promise<Response>>();
  const failures: ProviderFailures = { rest: false, restGenerate: false, verify: false, outcomeTelemetry: false };
  const dependencies: WorkerRuntimeDependencies = {
    options,
    rateLimited,
    cache: generatedPuzzleCache,
    inFlight: generatedPuzzleRequests,
    clock,
    failures,
  };
  return {
    fetch: (request: Request, env: Env, ctx: ExecutionContext) => handleWorkerRequest(request, env, ctx, dependencies),
  } satisfies ExportedHandler<Env>;
}

export function createCachedPublicWorker() {
  const cache = new GeneratedPuzzleCache();
  const inFlight = new Map<string, Promise<Response>>();
  const failures: ProviderFailures = { rest: false, restGenerate: false, verify: false, outcomeTelemetry: false };
  return {
    fetch: (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
      const path = new URL(request.url).pathname;
      if (request.method !== "GET") return Promise.resolve(json({ error: { code: "method_not_allowed", message: "Method not allowed" } }, 405, { "cache-control": "no-store" }));
      if (path === "/docs" || path === "/docs/") return cachePublicGet(docsResponse(), request);
      if (path === "/utcp") return utcpManualResponse(request, env, buildInfo(env));
      if (path === "/openapi/v1.yaml" || path === "/openapi/chatgpt-actions-v1.yaml") {
        return staticAsset(request, env, path, "application/yaml; charset=utf-8");
      }
      if (path === "/v1/puzzles/generate" || path === "/v1/scenarios" || path === "/v1/capabilities") {
        return routeRestRequest(request, path, env, ctx, {
          options: {},
          cache,
          inFlight,
          clock: Date.now,
          build: buildInfo(env),
          failures,
        }).then(noStoreIfUnspecified);
      }
      return Promise.resolve(json({ error: { code: "not_found", message: "Not found" } }, 404, { "cache-control": "no-store" }));
    },
  };
}

export default createWorker();
