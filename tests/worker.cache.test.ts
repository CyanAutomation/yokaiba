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
  const req = new Request("https://example.com/v1/puzzles/generate");
  const key = generatedPuzzleCacheKey(req, undefined);
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
