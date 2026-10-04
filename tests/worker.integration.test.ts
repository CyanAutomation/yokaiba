import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import worker, { createRateLimiter, createWorker, GeneratedPuzzleCache } from "../worker/index.js";

test("version and readiness expose deployed build and rate-limit configuration", async () => {
  const isolatedWorker = createWorker({ rateLimiter: () => false });
  const env = {
    BUILD_VERSION: "0.1.0-test", BUILD_SHA: "deadbeef",
    REST_RATE_LIMITER: { limit: async () => ({ success: true }) },
    REST_GENERATE_RATE_LIMITER: { limit: async () => ({ success: true }) },
    VERIFY_RATE_LIMITER: { limit: async () => ({ success: true }) },
    MCP_PREAUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
    MCP_RATE_LIMITER: { limit: async () => ({ success: true }) },
    MCP_GENERATE_RATE_LIMITER: { limit: async () => ({ success: true }) },
    MCP_PUZZLE_ACTION_RATE_LIMITER: { limit: async () => ({ success: true }) },
    PUZZLE_OUTCOMES: { writeDataPoint: () => undefined },
  };
  const version = await isolatedWorker.fetch(new Request("https://yokaiba.test/v1/version"), env, {} as ExecutionContext);
  assert.deepEqual(await version.json(), {
    serviceVersion: "0.1.0-test", buildSha: "deadbeef", generatorVersion: "yokaiba-generator-v5", solverVersion: "yokaiba-exhaustive-v1",
  });
  const ready = await isolatedWorker.fetch(new Request("https://yokaiba.test/readyz"), env, {} as ExecutionContext);
  assert.deepEqual(await ready.json(), {
    status: "ready", build: { serviceVersion: "0.1.0-test", buildSha: "deadbeef" },
    rateLimitProvider: "configured", generateRateLimitProvider: "configured", verifyRateLimitProvider: "configured",
    mcpPreAuthRateLimitProvider: "configured", mcpRateLimitProvider: "configured", mcpGenerateRateLimitProvider: "configured",
    mcpPuzzleActionRateLimitProvider: "configured", outcomeTelemetryProvider: "configured",
  });
});

test("MCP rate limiting runs before authentication", async () => {
  const isolatedLimiter = createRateLimiter(new Map());
  const isolatedWorker = createWorker({ rateLimiter: isolatedLimiter });
  const env = {
    API_KEY: "secret",
    MCP_ALLOWED_HOSTNAMES: "yokaiba.test",
    MCP_RATE_LIMIT: "2",
  };
  const makeRequest = () => new Request("https://yokaiba.test/mcp", {
    headers: { "cf-connecting-ip": "192.0.2.201" },
  });

  // Apply the limit before authentication so unauthenticated request floods cannot bypass this protection.
  const firstUnauthorized = await isolatedWorker.fetch(makeRequest(), env, {} as ExecutionContext);
  assert.equal(firstUnauthorized.status, 401);
  assert.deepEqual(await firstUnauthorized.json(), {
    error: { code: "unauthorized", message: "A valid API key is required" },
  });
  const secondUnauthorized = await isolatedWorker.fetch(makeRequest(), env, {} as ExecutionContext);
  assert.equal(secondUnauthorized.status, 401);
  assert.deepEqual(await secondUnauthorized.json(), {
    error: { code: "unauthorized", message: "A valid API key is required" },
  });
  const limited = await isolatedWorker.fetch(makeRequest(), env, {} as ExecutionContext);
  assert.equal(limited.status, 429);
  assert.deepEqual(await limited.clone().json(), {
    error: { code: "rate_limited", message: "Too many requests" },
  });
  assert.equal(limited.headers.get("retry-after"), "60");
});

test("MCP pre-auth provider rate limiting protects authentication before the MCP handler", async () => {
  const providerKeys: string[] = [];
  let authenticatedProviderCalled = false;
  const isolatedWorker = createWorker({ rateLimiter: () => { throw new Error("local fallback should not run"); } });
  const env = {
    API_KEY: "secret",
    MCP_ALLOWED_HOSTNAMES: "yokaiba.test",
    MCP_PREAUTH_RATE_LIMITER: { limit: async ({ key }: { key: string }) => { providerKeys.push(key); return { success: false }; } },
    MCP_RATE_LIMITER: { limit: async () => { authenticatedProviderCalled = true; return { success: true }; } },
  };
  const response = await isolatedWorker.fetch(new Request("https://yokaiba.test/mcp", {
    headers: { "cf-connecting-ip": "192.0.2.201" },
  }), env, {} as ExecutionContext);

  assert.equal(response.status, 429);
  assert.deepEqual(providerKeys, ["192.0.2.201:/mcp"]);
  assert.equal(authenticatedProviderCalled, false);
});

test("MCP provider rate limiting uses an authenticated principal and falls back locally on failure", async () => {
  const providerKeys: string[] = [];
  const isolatedWorker = createWorker({ localRateLimitStore: new Map(), clock: () => 1_000 });
  const env = {
    API_KEY: "secret",
    MCP_ALLOWED_HOSTNAMES: "yokaiba.test",
    MCP_RATE_LIMIT: "1",
    MCP_PREAUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
    MCP_RATE_LIMITER: { limit: async ({ key }: { key: string }) => { providerKeys.push(key); throw new Error("provider unavailable"); } },
  };
  const request = () => new Request("https://yokaiba.test/mcp", {
    headers: { authorization: "Bearer secret", host: "yokaiba.test", "cf-connecting-ip": "192.0.2.202" },
  });

  const first = await isolatedWorker.fetch(request(), env, {} as ExecutionContext);
  assert.notEqual(first.status, 429);
  assert.equal(providerKeys.length, 1);
  assert.match(providerKeys[0], /^api-key:[a-f0-9]{64}:mcp$/);
  assert.doesNotMatch(providerKeys[0], /secret|192\.0\.2\.202/);

  const limited = await isolatedWorker.fetch(request(), env, {} as ExecutionContext);
  assert.equal(limited.status, 429);
  const ready = await isolatedWorker.fetch(new Request("https://yokaiba.test/readyz"), env, {} as ExecutionContext);
  assert.deepEqual(await ready.json(), {
    status: "ready", build: { serviceVersion: "0.1.0", buildSha: "local" },
    rateLimitProvider: "fallback", generateRateLimitProvider: "fallback", verifyRateLimitProvider: "fallback",
    mcpPreAuthRateLimitProvider: "configured", mcpRateLimitProvider: "fallback", mcpGenerateRateLimitProvider: "fallback",
    mcpPuzzleActionRateLimitProvider: "fallback", outcomeTelemetryProvider: "disabled",
  });
});

test("MCP generate_puzzle calls its dedicated provider quota", async () => {
  const allMcpKeys: string[] = [];
  const generationKeys: string[] = [];
  const isolatedWorker = createWorker({ rateLimiter: () => { throw new Error("local fallback should not run"); } });
  const env = {
    API_KEY: "secret",
    MCP_ALLOWED_HOSTNAMES: "yokaiba.test",
    MCP_PREAUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
    MCP_RATE_LIMITER: { limit: async ({ key }: { key: string }) => { allMcpKeys.push(key); return { success: true }; } },
    MCP_GENERATE_RATE_LIMITER: { limit: async ({ key }: { key: string }) => { generationKeys.push(key); return { success: true }; } },
  };
  const response = await isolatedWorker.fetch(new Request("https://yokaiba.test/mcp", {
    method: "POST",
    headers: { authorization: "Bearer secret", host: "yokaiba.test", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "generate_puzzle", arguments: {} } }),
  }), env, {} as ExecutionContext);

  assert.notEqual(response.status, 429);
  assert.deepEqual(allMcpKeys.map(key => key.replace(/:mcp$/, "")), generationKeys.map(key => key.replace(/:generate_puzzle$/, "")));
  assert.match(generationKeys[0], /^api-key:[a-f0-9]{64}:generate_puzzle$/);
});

test("MCP_API_KEYS gives distinct clients independent provider quota identities", async () => {
  const providerKeys: string[] = [];
  const isolatedWorker = createWorker({ rateLimiter: () => { throw new Error("local fallback should not run"); } });
  const env = {
    MCP_API_KEYS: JSON.stringify({ game: "game-secret", partner: "partner-secret" }),
    MCP_ALLOWED_HOSTNAMES: "yokaiba.test",
    MCP_PREAUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
    MCP_RATE_LIMITER: { limit: async ({ key }: { key: string }) => { providerKeys.push(key); return { success: true }; } },
  };
  const request = (key: string) => new Request("https://yokaiba.test/mcp", {
    headers: { authorization: `Bearer ${key}`, host: "yokaiba.test" },
  });

  assert.notEqual((await isolatedWorker.fetch(request("game-secret"), env, {} as ExecutionContext)).status, 429);
  assert.notEqual((await isolatedWorker.fetch(request("partner-secret"), env, {} as ExecutionContext)).status, 429);
  assert.equal(providerKeys.length, 2);
  assert.notEqual(providerKeys[0], providerKeys[1]);
  assert.ok(providerKeys.every(key => /^api-key:[a-f0-9]{64}:mcp$/.test(key)));
});

test("worker rejects malformed URLs without throwing", async () => {
  let rateLimiterCalls = 0;
  const isolatedWorker = createWorker({
    rateLimiter: () => {
      rateLimiterCalls += 1;
      return false;
    },
  });
  // Request-like objects cover malformed runtime input that the standard Request constructor rejects first.
  const request = { method: "GET", url: "not a URL" } as Request;
  const response = await isolatedWorker.fetch(request, {}, {} as ExecutionContext);

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: { code: "bad_request", message: "Invalid URL" } });
  assert.equal(rateLimiterCalls, 0);
});

test("worker falls back to local REST rate limiting when the provider fails", async () => {
  const providerInvocations: string[] = [];
  const isolatedWorker = createWorker({
    localRateLimitStore: new Map(),
    clock: () => 1_000,
  });
  const env = {
    REST_RATE_LIMIT: "1",
    REST_RATE_LIMITER: {
      limit: async ({ key }: { key: string }) => {
        providerInvocations.push(key);
        throw new Error("provider unavailable");
      },
    },
  };
  const makeRequest = () => new Request("https://yokaiba.test/v1/scenarios", {
    headers: { "cf-connecting-ip": "192.0.2.254" },
  });

  const first = await isolatedWorker.fetch(makeRequest(), env, {} as ExecutionContext);
  assert.equal(first.status, 200);
  assert.deepEqual(providerInvocations, ["192.0.2.254:/v1/scenarios"]);

  const limited = await isolatedWorker.fetch(makeRequest(), env, {} as ExecutionContext);
  assert.deepEqual(providerInvocations, [
    "192.0.2.254:/v1/scenarios",
    "192.0.2.254:/v1/scenarios",
  ]);
  assert.equal(limited.status, 429);
  assert.deepEqual(await limited.json(), {
    error: { code: "rate_limited", message: "Too many requests" },
  });
  assert.equal(limited.headers.get("retry-after"), "60");
  assert.equal(limited.headers.get("ratelimit-remaining"), "0");
  const ready = await isolatedWorker.fetch(new Request("https://yokaiba.test/readyz"), env, {} as ExecutionContext);
  assert.deepEqual(await ready.json(), {
    status: "ready", build: { serviceVersion: "0.1.0", buildSha: "local" },
    rateLimitProvider: "fallback", generateRateLimitProvider: "fallback", verifyRateLimitProvider: "fallback",
    mcpPreAuthRateLimitProvider: "fallback", mcpRateLimitProvider: "fallback", mcpGenerateRateLimitProvider: "fallback",
    mcpPuzzleActionRateLimitProvider: "fallback", outcomeTelemetryProvider: "disabled",
  });
});

test("worker allows supported CORS preflight headers", async () => {
  const env = { REST_ALLOWED_ORIGINS: "https://game.example,https://preview.example" };
  const preflight = await worker.fetch(new Request("https://yokaiba.test/v1/puzzles/generate", {
    method: "OPTIONS",
    headers: {
      origin: "https://game.example",
      "access-control-request-method": "POST",
      "access-control-request-headers": "Content-Type",
    },
  }), env, {} as ExecutionContext);

  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://game.example");
  assert.equal(preflight.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");
  assert.equal(preflight.headers.get("access-control-allow-headers"), "content-type, if-none-match");
  assert.equal(preflight.headers.get("vary"), "Origin");
});

test("worker permits conditional REST requests from an allowed browser origin", async () => {
  const env = { REST_ALLOWED_ORIGINS: "https://game.example" };
  const preflight = await worker.fetch(new Request("https://yokaiba.test/v1/scenarios", {
    method: "OPTIONS",
    headers: {
      origin: "https://game.example",
      "access-control-request-method": "GET",
      "access-control-request-headers": "If-None-Match",
    },
  }), env, {} as ExecutionContext);

  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-headers"), "content-type, if-none-match");

  const response = await worker.fetch(new Request("https://yokaiba.test/v1/scenarios", {
    headers: { origin: "https://game.example", "if-none-match": '"cached"', "cf-connecting-ip": "192.0.2.240" },
  }), env, {} as ExecutionContext);
  assert.match(response.headers.get("access-control-expose-headers") ?? "", /etag/i);
  assert.match(response.headers.get("access-control-expose-headers") ?? "", /x-request-id/i);
  assert.ok(response.headers.get("etag"));
});

test("worker rejects unsupported CORS preflight headers", async () => {
  const env = { REST_ALLOWED_ORIGINS: "https://game.example" };
  const preflight = await worker.fetch(new Request("https://yokaiba.test/v1/puzzles/generate", {
    method: "OPTIONS",
    headers: {
      origin: "https://game.example",
      "access-control-request-method": "POST",
      "access-control-request-headers": "x-unexpected-header",
    },
  }), env, {} as ExecutionContext);

  assert.equal(preflight.status, 403);
});

test("worker reports health status and response body", async () => {
  const health = await worker.fetch(new Request("https://yokaiba.test/healthz"), {}, {} as ExecutionContext);

  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", build: { serviceVersion: "0.1.0", buildSha: "local" } });
});

test("worker adds CORS and request-ID headers to REST responses", async () => {
  const response = await worker.fetch(new Request("https://yokaiba.test/v1/scenarios", {
    headers: { origin: "https://game.example" },
  }), { REST_ALLOWED_ORIGINS: "https://game.example" }, {} as ExecutionContext);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://game.example");
  assert.match(response.headers.get("access-control-expose-headers") ?? "", /etag/i);
  assert.ok(response.headers.get("x-request-id"));
  assert.equal(response.headers.get("ratelimit-limit"), "60");
  assert.equal(response.headers.get("ratelimit-policy"), "60;w=60");
  assert.equal(response.headers.get("ratelimit-remaining"), "59");
  assert.match(response.headers.get("ratelimit-reset") ?? "", /^\d+$/);
});

test("worker exhausts the REST rate limit", async () => {
  const isolatedWorker = createWorker();
  const env = { REST_RATE_LIMIT: "2" };
  const makeRequest = () => new Request("https://yokaiba.test/v1/scenarios", {
    headers: { "cf-connecting-ip": "192.0.2.88" },
  });

  assert.equal((await isolatedWorker.fetch(makeRequest(), env, {} as ExecutionContext)).status, 200);
  assert.equal((await isolatedWorker.fetch(makeRequest(), env, {} as ExecutionContext)).status, 200);
  assert.equal((await isolatedWorker.fetch(makeRequest(), env, {} as ExecutionContext)).status, 429);
});

test("worker returns an ETag and honors conditional public GETs", async () => {
  const env = { REST_ALLOWED_ORIGINS: "https://game.example", PUZZLE_TOKEN_SECRET: "test-token-secret" };
  const url = "https://yokaiba.test/v1/puzzles/generate?templateId=tournament-order-v1&seed=etag-seed";
  const first = await worker.fetch(new Request(url, { headers: { origin: "https://game.example", "cf-connecting-ip": "192.0.2.89" } }), env, {} as ExecutionContext);
  assert.equal(first.status, 200);
  const etag = first.headers.get("etag");
  assert.match(etag ?? "", /^"yokaiba-v1-[a-f0-9]{64}"$/);
  const second = await worker.fetch(new Request(url, { headers: { origin: "https://game.example", "if-none-match": etag!, "cf-connecting-ip": "192.0.2.89" } }), env, {} as ExecutionContext);
  assert.equal(second.status, 304);
});

test("worker emits calibration telemetry without logging puzzle seeds or answers", async () => {
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = message => { logs.push(String(message)); };
  try {
    for (const responseBody of [
      {
        templateId: "test-template",
        seed: "private-seed",
        solution: { assignments: { color: ["secret-answer"] } },
        requestedDifficultyLevel: 7,
        difficulty: { level: 6, modelVersion: "difficulty-v1" },
      },
      {
        templateId: "test-template",
        seed: "private-seed",
        requestedDifficultyLevel: 8,
        error: { code: "difficulty_unavailable" },
      },
    ]) {
      const waitUntilTasks: Promise<unknown>[] = [];
      const isolatedWorker = createWorker({
        rateLimiter: () => false,
        generatePuzzleResponse: () => new Response(JSON.stringify(responseBody), {
          status: "error" in responseBody ? 422 : 200,
          headers: { "content-type": "application/json" },
        }),
      });
      const response = await isolatedWorker.fetch(
        new Request("https://yokaiba.test/v1/puzzles/generate?templateId=test-template&seed=private-seed"),
        {},
        { waitUntil: (task: Promise<unknown>) => { waitUntilTasks.push(task); } } as unknown as ExecutionContext,
      );
      assert.equal(response.status, "error" in responseBody ? 422 : 200);
      await Promise.all(waitUntilTasks);
    }
  } finally {
    console.log = originalLog;
  }

  const events = logs.map(message => JSON.parse(message) as Record<string, unknown>)
    .filter(record => record.event === "difficulty_generation");
  assert.deepEqual(events, [
    {
      event: "difficulty_generation",
      outcome: "generated",
      templateId: "test-template",
      requestedDifficultyLevel: 7,
      assessedDifficultyLevel: 6,
      modelVersion: "difficulty-v1",
    },
    {
      event: "difficulty_generation",
      outcome: "unavailable",
      templateId: "test-template",
      requestedDifficultyLevel: 8,
      errorCode: "difficulty_unavailable",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(events), /private-seed|secret-answer/);
});

test("worker memoizes deterministic GET generation within the local cache TTL", async () => {
  let now = 1_000;
  let generationCalls = 0;
  const generatedPuzzleCache = new GeneratedPuzzleCache();
  const isolatedWorker = createWorker({
    clock: () => now,
    generatedPuzzleCache,
    generatePuzzleResponse: () => {
      generationCalls += 1;
      return new Response(JSON.stringify({ generationCalls }), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  const request = () => new Request("https://yokaiba.test/v1/puzzles/generate?templateId=tournament-order-v1&seed=memoized", {
    headers: { "cf-connecting-ip": "192.0.2.91" },
  });

  const first = await isolatedWorker.fetch(request(), {}, {} as ExecutionContext);
  assert.equal(first.status, 200);
  const freshEtag = first.headers.get("etag");
  assert.match(freshEtag ?? "", /^"yokaiba-v1-[a-f0-9]{64}"$/);
  assert.deepEqual(await first.json(), { generationCalls: 1 });
  const snapshot = [...generatedPuzzleCache.values()][0]!;
  assert.equal("response" in snapshot, false);
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.etag, freshEtag);
  assert.equal(new TextDecoder().decode(snapshot.body), JSON.stringify({ generationCalls: 1 }));

  const cached = await isolatedWorker.fetch(request(), {}, {} as ExecutionContext);
  const etag = cached.headers.get("etag");
  assert.equal(etag, freshEtag);
  assert.deepEqual(await cached.json(), { generationCalls: 1 });
  assert.equal(generationCalls, 1);
  const revalidated = await isolatedWorker.fetch(new Request(request(), { headers: {
    "cf-connecting-ip": "192.0.2.91",
    "if-none-match": etag!,
  } }), {}, {} as ExecutionContext);
  assert.equal(revalidated.status, 304);
  assert.equal(revalidated.headers.get("etag"), freshEtag);
  assert.equal(generationCalls, 1);
  now += 300_000;
  assert.deepEqual(await (await isolatedWorker.fetch(request(), {}, {} as ExecutionContext)).json(), { generationCalls: 2 });
  assert.equal(generationCalls, 2);
});

test("worker memoizes canonical generation queries and separates every generation input", async () => {
  let generationCalls = 0;
  const isolatedWorker = createWorker({
    rateLimiter: () => false,
    generatePuzzleResponse: () => new Response(JSON.stringify({ generationCalls: ++generationCalls }), {
      headers: { "content-type": "application/json" },
    }),
  });
  const fetchGeneration = (query: string, origin = "https://yokaiba.test") => isolatedWorker.fetch(
    new Request(`${origin}/v1/puzzles/generate?${query}`), {}, {} as ExecutionContext,
  );

  const canonical = "templateId=tournament-order-v1&seed=canonical&difficultyLevel=4&allowSeedFallback=true";
  assert.deepEqual(await (await fetchGeneration(canonical)).json(), { generationCalls: 1 });
  assert.deepEqual(await (await fetchGeneration("allowSeedFallback=true&difficultyLevel=4&seed=canonical&templateId=tournament-order-v1", "http://other.test")).json(), { generationCalls: 1 });

  const variants = [
    "templateId=open-division-v2&seed=canonical&difficultyLevel=4&allowSeedFallback=true",
    "templateId=tournament-order-v1&seed=other&difficultyLevel=4&allowSeedFallback=true",
    "templateId=tournament-order-v1&seed=canonical&difficultyLevel=5&allowSeedFallback=true",
    "templateId=tournament-order-v1&seed=canonical&difficultyLevel=4&allowSeedFallback=false",
  ];
  for (const [index, variant] of variants.entries()) {
    assert.deepEqual(await (await fetchGeneration(variant)).json(), { generationCalls: index + 2 });
  }
  assert.equal(generationCalls, 5);
});

test("worker coalesces concurrent deterministic GET generation for the same cache key", async () => {
  let generationCalls = 0;
  let releaseGeneration!: (response: Response) => void;
  const generationResponse = new Promise<Response>(resolve => { releaseGeneration = resolve; });
  const isolatedWorker = createWorker({
    rateLimiter: () => false,
    generatePuzzleResponse: () => {
      generationCalls += 1;
      return generationResponse;
    },
  });
  const request = () => new Request("https://yokaiba.test/v1/puzzles/generate?templateId=tournament-order-v1&seed=concurrent");

  const first = isolatedWorker.fetch(request(), {}, {} as ExecutionContext);
  const second = isolatedWorker.fetch(request(), {}, {} as ExecutionContext);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(generationCalls, 1);

  releaseGeneration(new Response(JSON.stringify({ generated: true }), {
    headers: { "content-type": "application/json" },
  }));
  const responses = await Promise.all([first, second]);
  assert.deepEqual(await Promise.all(responses.map(response => response.json())), [
    { generated: true },
    { generated: true },
  ]);
  assert.equal(generationCalls, 1);
});

test("worker clears rejected in-flight generation so the cache key can be retried", async () => {
  let generationCalls = 0;
  let rejectGeneration!: (reason: Error) => void;
  const failedGeneration = new Promise<Response>((_resolve, reject) => { rejectGeneration = reject; });
  const isolatedWorker = createWorker({
    rateLimiter: () => false,
    generatePuzzleResponse: () => {
      generationCalls += 1;
      if (generationCalls === 1) return failedGeneration;
      return new Response(JSON.stringify({ generationCalls }), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  const request = () => new Request("https://yokaiba.test/v1/puzzles/generate?templateId=tournament-order-v1&seed=retry");

  const first = isolatedWorker.fetch(request(), {}, {} as ExecutionContext);
  const second = isolatedWorker.fetch(request(), {}, {} as ExecutionContext);
  const failures = Promise.allSettled([first, second]);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(generationCalls, 1);
  rejectGeneration(new Error("generation failed"));
  assert.deepEqual((await failures).map(result => result.status), ["rejected", "rejected"]);

  const retried = await isolatedWorker.fetch(request(), {}, {} as ExecutionContext);
  assert.equal(retried.status, 200);
  assert.deepEqual(await retried.json(), { generationCalls: 2 });
  assert.equal(generationCalls, 2);
});

test("worker bounds the documented local generation cache capacity", async () => {
  let generationCalls = 0;
  const generatedPuzzleCache = new GeneratedPuzzleCache();
  const isolatedWorker = createWorker({
    rateLimiter: () => false,
    generatedPuzzleCache,
    generatePuzzleResponse: () => {
      generationCalls += 1;
      return new Response(JSON.stringify({ generationCalls }), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  const request = (seed: number) => new Request(`https://yokaiba.test/v1/puzzles/generate?templateId=tournament-order-v1&seed=capacity-${seed}`);

  for (let seed = 0; seed < 129; seed += 1) {
    assert.equal((await isolatedWorker.fetch(request(seed), {}, {} as ExecutionContext)).status, 200);
  }
  assert.equal(generationCalls, 129);
  assert.equal(generatedPuzzleCache.size, 128);
  assert.ok([...generatedPuzzleCache.values()].every(entry => !("response" in entry) && entry.body instanceof ArrayBuffer));

  await isolatedWorker.fetch(request(128), {}, {} as ExecutionContext);
  assert.equal(generationCalls, 129);
  await isolatedWorker.fetch(request(0), {}, {} as ExecutionContext);
  assert.equal(generationCalls, 130);
});

test("worker caches and conditionally revalidates deterministic unavailable-difficulty responses", async () => {
  const generatedPuzzleCache = new GeneratedPuzzleCache();
  const isolatedWorker = createWorker({ generatedPuzzleCache });
  const url = "https://yokaiba.test/v1/puzzles/generate?templateId=open-division-v2&seed=review-20260904&difficultyLevel=7";
  const first = await isolatedWorker.fetch(new Request(url, { headers: { "cf-connecting-ip": "192.0.2.92" } }), {}, {} as ExecutionContext);

  assert.equal(first.status, 422);
  assert.equal(first.headers.get("cache-control"), "public, max-age=300, s-maxage=300, must-revalidate");
  const etag = first.headers.get("etag");
  assert.match(etag ?? "", /^"yokaiba-v1-[a-f0-9]{64}"$/);
  const snapshot = [...generatedPuzzleCache.values()][0]!;
  assert.equal(snapshot.status, 422);
  assert.equal("response" in snapshot, false);
  assert.ok(snapshot.body.byteLength > 0);
  assert.equal(snapshot.etag, etag);
  const revalidated = await isolatedWorker.fetch(new Request(url, { headers: { "cf-connecting-ip": "192.0.2.92", "if-none-match": etag! } }), {}, {} as ExecutionContext);
  assert.equal(revalidated.status, 304);
  assert.equal(revalidated.headers.get("etag"), etag);
});

test("worker gives scenario discovery and version metadata explicit cache policies", async () => {
  const scenarios = await worker.fetch(new Request("https://yokaiba.test/v1/scenarios"), {}, {} as ExecutionContext);
  assert.equal(scenarios.headers.get("cache-control"), "public, max-age=300, s-maxage=300, must-revalidate");

  const version = await worker.fetch(new Request("https://yokaiba.test/v1/version"), {}, {} as ExecutionContext);
  assert.equal(version.headers.get("cache-control"), "no-cache");
});

test("worker directs the API root to the interactive documentation", async () => {
  const response = await worker.fetch(new Request("https://yokaiba.test/"), {}, {} as ExecutionContext);

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://yokaiba.test/docs");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("worker limits static routes to GET and HEAD and suppresses HEAD bodies", async () => {
  const post = await worker.fetch(new Request("https://yokaiba.test/healthz", { method: "POST" }), {}, {} as ExecutionContext);
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET, HEAD");

  const head = await worker.fetch(new Request("https://yokaiba.test/healthz", { method: "HEAD" }), {}, {} as ExecutionContext);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});

test("worker writes only validated anonymous outcome fields to Analytics Engine", async () => {
  const points: unknown[] = [];
  const isolatedWorker = createWorker();
  const response = await isolatedWorker.fetch(new Request("https://yokaiba.test/v1/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ schemaVersion: 1, event: "puzzle_completed", templateId: "tournament-order-v1", elapsedMs: 1200, hintsUsed: 2, mistakes: 0, seed: "never-store", playerId: "never-store" }),
  }), { PUZZLE_OUTCOMES: { writeDataPoint: point => points.push(point) } }, {} as ExecutionContext);

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { accepted: true });
  assert.equal(points.length, 1);
  assert.deepEqual(points[0], {
    indexes: ["tournament-order-v1"],
    blobs: ["puzzle_completed", "1", "unknown"],
    doubles: [0, 0, 0, 1200, 2, 0, 56],
  });
  assert.doesNotMatch(JSON.stringify(points), /never-store/);
});

test("worker refuses outcome acceptance without a sink and reports its capability accurately", async () => {
  const isolatedWorker = createWorker();
  const event = await isolatedWorker.fetch(new Request("https://yokaiba.test/v1/events", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "puzzle_started", templateId: "tournament-order-v1" }),
  }), {}, {} as ExecutionContext);
  assert.equal(event.status, 503);

  const capabilities = await isolatedWorker.fetch(new Request("https://yokaiba.test/v1/capabilities"), {}, {} as ExecutionContext);
  assert.equal((await capabilities.json() as { features: { outcomeTelemetry: boolean } }).features.outcomeTelemetry, false);
  const ready = await isolatedWorker.fetch(new Request("https://yokaiba.test/readyz"), {}, {} as ExecutionContext);
  assert.equal((await ready.json() as { outcomeTelemetryProvider: string }).outcomeTelemetryProvider, "disabled");
});

test("worker reports outcome storage failures in readiness and rejects the event", async () => {
  const isolatedWorker = createWorker();
  const response = await isolatedWorker.fetch(new Request("https://yokaiba.test/v1/events", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "puzzle_started", templateId: "tournament-order-v1" }),
  }), { PUZZLE_OUTCOMES: { writeDataPoint: () => { throw new Error("storage unavailable"); } } }, {} as ExecutionContext);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: { code: "storage_unavailable", message: "puzzle outcome storage is unavailable" } });

  const ready = await isolatedWorker.fetch(new Request("https://yokaiba.test/readyz"), { PUZZLE_OUTCOMES: { writeDataPoint: () => undefined } }, {} as ExecutionContext);
  assert.equal((await ready.json() as { outcomeTelemetryProvider: string }).outcomeTelemetryProvider, "failing");
});

test("worker protects MCP puzzle actions with their own per-tool quota", async () => {
  const actionKeys: string[] = [];
  const isolatedWorker = createWorker({ rateLimiter: () => { throw new Error("configured provider should handle the quota"); } });
  const response = await isolatedWorker.fetch(new Request("https://yokaiba.test/mcp", {
    method: "POST",
    headers: { authorization: "Bearer secret", host: "yokaiba.test", "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "verify_puzzle_answer", arguments: {} } }),
  }), {
    API_KEY: "secret", MCP_ALLOWED_HOSTNAMES: "yokaiba.test",
    MCP_PREAUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
    MCP_RATE_LIMITER: { limit: async () => ({ success: true }) },
    MCP_PUZZLE_ACTION_RATE_LIMITER: { limit: async ({ key }: { key: string }) => { actionKeys.push(key); return { success: true }; } },
  }, {} as ExecutionContext);

  assert.notEqual(response.status, 429);
  assert.equal(actionKeys.length, 1);
  assert.match(actionKeys[0]!, /^api-key:[a-f0-9]{64}:verify_puzzle_answer$/);
});

test("worker applies a tighter best-effort limit to answer verification", async () => {
  const isolatedWorker = createWorker();
  const env = { PUZZLE_TOKEN_SECRET: "test-token-secret", VERIFY_RATE_LIMIT: "1" };
  const request = () => new Request("https://yokaiba.test/v1/puzzles/verify", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.93" },
    body: JSON.stringify({ puzzleToken: "invalid", answer: {} }),
  });
  assert.equal((await isolatedWorker.fetch(request(), env, {} as ExecutionContext)).status, 400);
  assert.equal((await isolatedWorker.fetch(request(), env, {} as ExecutionContext)).status, 429);
});

test("worker uses the dedicated provider binding for answer verification", async () => {
  const providerKeys: string[] = [];
  const isolatedWorker = createWorker({ rateLimiter: () => { throw new Error("local fallback should not run"); } });
  const env = {
    PUZZLE_TOKEN_SECRET: "test-token-secret",
    REST_RATE_LIMITER: { limit: async () => ({ success: true }) },
    VERIFY_RATE_LIMITER: { limit: async ({ key }: { key: string }) => { providerKeys.push(key); return { success: true }; } },
  };
  const response = await isolatedWorker.fetch(new Request("https://yokaiba.test/v1/puzzles/verify", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.94" },
    body: JSON.stringify({ puzzleToken: "invalid", answer: {} }),
  }), env, {} as ExecutionContext);

  assert.equal(response.status, 400);
  assert.deepEqual(providerKeys, ["192.0.2.94:/v1/puzzles/verify"]);
  assert.equal(response.headers.get("ratelimit-remaining"), null);
});

test("worker uses a separate provider and quota for REST puzzle generation", async () => {
  const providerKeys: string[] = [];
  const isolatedWorker = createWorker({ rateLimiter: () => { throw new Error("local fallback should not run"); } });
  const response = await isolatedWorker.fetch(new Request("https://yokaiba.test/v1/puzzles/generate?templateId=tournament-order-v1&seed=rate-limit-seed", {
    headers: { "cf-connecting-ip": "192.0.2.95" },
  }), {
    REST_RATE_LIMITER: { limit: async () => { throw new Error("general REST provider should not handle generation"); } },
    REST_GENERATE_RATE_LIMITER: { limit: async ({ key }: { key: string }) => { providerKeys.push(key); return { success: true }; } },
  }, {} as ExecutionContext);

  assert.equal(response.status, 200);
  assert.deepEqual(providerKeys, ["192.0.2.95:/v1/puzzles/generate"]);
  assert.equal(response.headers.get("ratelimit-limit"), "10");
});

test("worker serves self-hosted Swagger UI with complete security controls", async () => {
  for (const path of ["/docs", "/docs/"]) {
    const docs = await worker.fetch(new Request(`https://yokaiba.test${path}`), {}, {} as ExecutionContext);
    assert.equal(docs.status, 200);

    const contentSecurityPolicy = docs.headers.get("content-security-policy") ?? "";
    assert.match(contentSecurityPolicy, /(?:^|; )default-src 'none'(?:;|$)/);
    assert.match(contentSecurityPolicy, /(?:^|; )script-src 'self' 'unsafe-inline'(?:;|$)/);
    assert.match(contentSecurityPolicy, /(?:^|; )style-src 'self' 'unsafe-inline'(?:;|$)/);
    assert.match(contentSecurityPolicy, /(?:^|; )img-src 'self' data:(?:;|$)/);
    assert.match(contentSecurityPolicy, /(?:^|; )connect-src 'self'(?:;|$)/);
    assert.match(contentSecurityPolicy, /(?:^|; )base-uri 'none'(?:;|$)/);
    assert.match(contentSecurityPolicy, /(?:^|; )frame-ancestors 'none'(?:;|$)/);
    assert.equal(docs.headers.get("x-content-type-options"), "nosniff");
    assert.ok(docs.headers.get("x-request-id"));

    const docsDocument = await docs.text();
    assert.match(docsDocument, /href="\/swagger-ui\/swagger-ui\.css"/);
    assert.match(docsDocument, /src="\/swagger-ui\/swagger-ui-bundle\.js"/);
    assert.match(docsDocument, /href="\/openapi\/chatgpt-actions-v1\.yaml"/);
    assert.doesNotMatch(docsDocument, /unpkg\.com/);
  }
});

test("the self-hosted Swagger UI assets are included in the deployment bundle", async () => {
  const stylesheet = await readFile(new URL("../public/swagger-ui/swagger-ui.css", import.meta.url), "utf8");
  const bundle = await readFile(new URL("../public/swagger-ui/swagger-ui-bundle.js", import.meta.url), "utf8");
  const wranglerConfiguration = await readFile(new URL("../wrangler.toml", import.meta.url), "utf8");

  assert.match(stylesheet, /^\.swagger-ui\{/);
  assert.match(bundle, /\bSwaggerUIBundle\b/);
  assert.match(wranglerConfiguration, /\[assets\]\s+directory\s*=\s*"\.\/public"/);
});

test("worker delegates OpenAPI requests to their canonical asset paths", async () => {
  const requestedUrls: string[] = [];
  const expectedBody = "mock OpenAPI asset body\n";
  const assets = {
    fetch: async (request: Request) => {
      requestedUrls.push(request.url);
      return new Response(expectedBody, { headers: { "content-type": "text/yaml" } });
    },
  };

  for (const path of ["/openapi/v1.yaml", "/openapi/chatgpt-actions-v1.yaml"]) {
    const specification = await worker.fetch(
      new Request(`https://yokaiba.test${path}?cache-bust=test`),
      { ASSETS: assets },
      {} as ExecutionContext,
    );
    assert.equal(specification.status, 200);
    assert.equal(specification.headers.get("content-type"), "application/yaml; charset=utf-8");
    assert.equal(await specification.text(), expectedBody);
  }
  assert.deepEqual(requestedUrls, ["https://yokaiba.test/openapi/v1.yaml", "https://yokaiba.test/openapi/chatgpt-actions-v1.yaml"]);
});
