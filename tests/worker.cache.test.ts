import test from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter, type RateLimitDecision } from "../worker/index.js";
import { generatedPuzzleCacheKey, cachedGeneratedPuzzle, cacheGeneratedPuzzle } from "../worker/cache.js";

test("createRateLimiter enforces small limits and reports remaining/reset", () => {
  let now = 1_000_000;
  const clock = () => now;
  const rateLimits = new Map();
  const limiter = createRateLimiter(rateLimits, clock);
  const req = { headers: new Headers([["cf-connecting-ip", "1.2.3.4"]]) } as unknown as Request;
  const otherReq = { headers: new Headers([["cf-connecting-ip", "5.6.7.8"]]) } as unknown as Request;
  const resetAt = 1_060;

  const first = limiter(req, "2", "scope") as RateLimitDecision;
  assert.deepEqual(first, { limited: false, remaining: 1, resetAt });

  const second = limiter(req, "2", "scope") as RateLimitDecision;
  assert.deepEqual(second, { limited: false, remaining: 0, resetAt });

  const third = limiter(req, "2", "scope") as RateLimitDecision;
  assert.deepEqual(third, { limited: true, remaining: 0, resetAt });

  const otherIp = limiter(otherReq, "2", "scope") as RateLimitDecision;
  assert.deepEqual(otherIp, { limited: false, remaining: 1, resetAt });

  now = 1_059_999;
  const immediatelyBeforeReset = limiter(req, "2", "scope") as RateLimitDecision;
  assert.deepEqual(immediatelyBeforeReset, { limited: true, remaining: 0, resetAt });

  now = 1_060_000;
  const atReset = limiter(req, "2", "scope") as RateLimitDecision;
  assert.deepEqual(atReset, { limited: false, remaining: 1, resetAt: 1_120 });
});

test("generated puzzle cache stores an immutable response snapshot through its TTL", async () => {
  const cache = new Map();
  const req = new Request("https://example.com/v1/puzzles/generate?templateId=open-division-v2&seed=test-seed");
  const key = await generatedPuzzleCacheKey(req, undefined);
  assert.ok(key);
  const storedAt = 1_700_000_000_000;
  const bodyBytes = new TextEncoder().encode('{"puzzle":"representative"}');
  const response = new Response(bodyBytes, {
    status: 422,
    statusText: "Unprocessable Content",
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-generation-seed": "fixed-seed",
    },
  });

  const returned = await cacheGeneratedPuzzle(cache, key, response, storedAt);
  const cached = cachedGeneratedPuzzle(cache, key, storedAt);
  assert.ok(cached);
  assert.notStrictEqual(returned, response);
  assert.notStrictEqual(cached, response);
  assert.notStrictEqual(cached, returned);

  const entry = cache.get(key);
  assert.ok(entry);
  assert.ok(entry.body instanceof ArrayBuffer);
  assert.ok(Array.isArray(entry.headers));
  assert.notStrictEqual(entry, response);

  // Mutating the inputs and the first materialized response cannot alter the
  // byte/header snapshot used to materialize later cache hits.
  bodyBytes.fill(0);
  response.headers.set("x-generation-seed", "changed-original");

  const expectedHeaders = {
    "content-type": "application/json; charset=utf-8",
    "x-generation-seed": "fixed-seed",
  };
  assert.equal(await returned.text(), '{"puzzle":"representative"}');
  assert.equal(returned.status, 422);
  assert.equal(returned.statusText, "Unprocessable Content");
  assert.equal(returned.headers.get("content-type"), expectedHeaders["content-type"]);
  assert.equal(returned.headers.get("x-generation-seed"), expectedHeaders["x-generation-seed"]);

  returned.headers.set("x-generation-seed", "changed-returned");

  assert.equal(cached.status, 422);
  assert.equal(cached.statusText, "Unprocessable Content");
  assert.equal(cached.headers.get("content-type"), expectedHeaders["content-type"]);
  assert.equal(cached.headers.get("x-generation-seed"), expectedHeaders["x-generation-seed"]);
  assert.equal(await cached.text(), '{"puzzle":"representative"}');

  const immediatelyBeforeExpiry = cachedGeneratedPuzzle(cache, key, storedAt + 300_000 - 1);
  assert.ok(immediatelyBeforeExpiry);
  assert.equal(await immediatelyBeforeExpiry.text(), '{"puzzle":"representative"}');

  assert.equal(cachedGeneratedPuzzle(cache, key, storedAt + 300_000), undefined);
  assert.equal(cache.has(key), false);
});

test("generated puzzle cache keys canonicalize routing inputs", async () => {
  const key = (url: string) => generatedPuzzleCacheKey(new Request(url), "secret");
  const canonical = await key("https://first.example/v1/puzzles/generate?templateId=template&seed=seed&difficultyLevel=4&allowSeedFallback=true");

  assert.equal(await key("http://second.example/v1/puzzles/generate?ignored=value&allowSeedFallback=true&seed=seed&difficultyLevel=4&templateId=template#fragment"), canonical);
  assert.equal(await key("https://first.example/v1/puzzles/generate?seed=seed&templateId=template&allowSeedFallback=false"), await key("https://first.example/v1/puzzles/generate?templateId=template&seed=seed"));

  for (const changed of [
    "https://first.example/v1/puzzles/generate?templateId=other&seed=seed&difficultyLevel=4&allowSeedFallback=true",
    "https://first.example/v1/puzzles/generate?templateId=template&seed=other&difficultyLevel=4&allowSeedFallback=true",
    "https://first.example/v1/puzzles/generate?templateId=template&seed=seed&difficultyLevel=5&allowSeedFallback=true",
    "https://first.example/v1/puzzles/generate?templateId=template&seed=seed&difficultyLevel=4&allowSeedFallback=false",
  ]) assert.notEqual(await key(changed), canonical);

  assert.equal(await key("https://first.example/v1/puzzles/generate?templateId=template&seed=seed&difficultyLevel=invalid"), undefined);
});

test("generated puzzle cache keys namespace secrets without exposing them", async () => {
  const request = new Request("https://example.com/v1/puzzles/generate?templateId=template&seed=seed");
  const firstSecret = "first-private-signing-secret";
  const secondSecret = "second-private-signing-secret";

  const firstKey = await generatedPuzzleCacheKey(request, firstSecret);
  const secondKey = await generatedPuzzleCacheKey(request, secondSecret);

  assert.ok(firstKey);
  assert.ok(secondKey);
  assert.notEqual(firstKey, secondKey);
  for (const key of [firstKey, secondKey]) {
    assert.equal(key.includes(firstSecret), false);
    assert.equal(key.includes(secondSecret), false);
  }
});
