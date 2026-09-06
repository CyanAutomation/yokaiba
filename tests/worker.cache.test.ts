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

test("generated puzzle cache stores and returns snapshots", async () => {
  const cache = new Map();
  const req = new Request("https://example.com/v1/puzzles/generate");
  const key = generatedPuzzleCacheKey(req, undefined);
  const now = Date.now();
  const response = new Response("ok", { status: 200 });

  const cached = await cacheGeneratedPuzzle(cache, key, response, now);
  assert.equal(cached.status, 200);
  const read = await cached.text();
  assert.equal(read, "ok");

  const hit = cachedGeneratedPuzzle(cache, key, now);
  assert.ok(hit);
  const hitText = await hit!.text();
  assert.equal(hitText, "ok");
});
