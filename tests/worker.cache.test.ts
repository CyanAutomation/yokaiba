import test from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter } from "../worker/index.js";
import { generatedPuzzleCacheKey, cachedGeneratedPuzzle, cacheGeneratedPuzzle } from "../worker/cache.js";

test("createRateLimiter enforces small limits and reports remaining/reset", () => {
  const now = 1_000_000;
  const clock = () => now;
  const rateLimits = new Map();
  const limiter = createRateLimiter(rateLimits, clock);
  const req = { headers: new Headers([["cf-connecting-ip", "1.2.3.4"]]) } as unknown as Request;

  const first = limiter(req, "2", "scope") as any;
  assert.equal(first.limited, false);
  assert.equal(first.remaining, 1);

  const second = limiter(req, "2", "scope") as any;
  assert.equal(second.limited, false);
  assert.equal(second.remaining, 0);

  const third = limiter(req, "2", "scope") as any;
  assert.equal(third.limited, true);
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
