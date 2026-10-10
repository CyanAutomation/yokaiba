import test from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter, type RateLimitDecision } from "../worker/rate-limit.js";
import { GeneratedPuzzleCache, generatedPuzzleCacheKey, cachedGeneratedPuzzle, cacheGeneratedPuzzle, cachePublicGet } from "../worker/cache.js";

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
  const cache = new GeneratedPuzzleCache();
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

  const entry = cache.peek(key);
  assert.ok(entry);
  assert.ok(entry.body instanceof ArrayBuffer);
  assert.ok(Array.isArray(entry.headers));
  assert.notStrictEqual(entry, response);
  assert.match(entry.etag, /^"yokaiba-v1-[a-f0-9]{64}"$/);
  assert.equal(returned.headers.get("etag"), entry.etag);
  assert.equal(cached.headers.get("etag"), entry.etag);

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
  returned.headers.set("etag", '"changed-returned"');

  assert.equal(cached.status, 422);
  assert.equal(cached.statusText, "Unprocessable Content");
  assert.equal(cached.headers.get("content-type"), expectedHeaders["content-type"]);
  assert.equal(cached.headers.get("x-generation-seed"), expectedHeaders["x-generation-seed"]);
  assert.equal(cached.headers.get("etag"), entry.etag);
  assert.equal(await cached.text(), '{"puzzle":"representative"}');

  const immediatelyBeforeExpiry = cachedGeneratedPuzzle(cache, key, storedAt + 300_000 - 1);
  assert.ok(immediatelyBeforeExpiry);
  assert.equal(await immediatelyBeforeExpiry.text(), '{"puzzle":"representative"}');

  assert.equal(cachedGeneratedPuzzle(cache, key, storedAt + 300_000), undefined);
  assert.equal(cache.has(key), false);
});

test("generated puzzle cache evicts least-recently-used bodies to meet its byte budget", async () => {
  const cache = new GeneratedPuzzleCache(10, 10);
  await cacheGeneratedPuzzle(cache, "oldest", new Response("1234"), 0);
  await cacheGeneratedPuzzle(cache, "recent", new Response("5678"), 0);

  // A hit makes the first insertion more recent than the second one.
  assert.ok(cachedGeneratedPuzzle(cache, "oldest", 1));
  await cacheGeneratedPuzzle(cache, "new", new Response("abcde"), 1);

  assert.equal(cache.has("oldest"), true);
  assert.equal(cache.has("recent"), false);
  assert.equal(cache.has("new"), true);
});

// Cache contract: README.md#local-response-cache-policy.
test("replaced and expired responses release capacity for later cache entries", async () => {
  const cache = new GeneratedPuzzleCache(10, 5);
  await cacheGeneratedPuzzle(cache, "replace", new Response("12345"), 0);
  await cacheGeneratedPuzzle(cache, "replace", new Response("12"), 1);
  await cacheGeneratedPuzzle(cache, "other", new Response("abc"), 1);

  assert.equal(await cachedGeneratedPuzzle(cache, "replace", 2)?.text(), "12");
  assert.equal(await cachedGeneratedPuzzle(cache, "other", 2)?.text(), "abc");

  assert.equal(cachedGeneratedPuzzle(cache, "replace", 300_001), undefined);
  assert.equal(cachedGeneratedPuzzle(cache, "other", 300_001), undefined);
  await cacheGeneratedPuzzle(cache, "fresh", new Response("12345"), 300_001);
  assert.equal(await cachedGeneratedPuzzle(cache, "fresh", 300_002)?.text(), "12345");
});

test("generated puzzle cache returns but does not retain an individually oversized response", async () => {
  const cache = new GeneratedPuzzleCache(10, 4);
  await cacheGeneratedPuzzle(cache, "retained", new Response("1234"), 0);

  const returned = await cacheGeneratedPuzzle(cache, "oversized", new Response("12345"), 1);

  assert.equal(await returned.text(), "12345");
  assert.match(returned.headers.get("etag") ?? "", /^"yokaiba-v1-[a-f0-9]{64}"$/);
  assert.equal(cache.has("oversized"), false);
  assert.equal(cache.has("retained"), true);
});

test("public GET caching preserves an existing valid ETag", async () => {
  const etag = 'W/"precomputed-validator"';
  const fresh = await cachePublicGet(new Response("content", { headers: { etag } }), new Request("https://example.com/v1/scenarios"));
  assert.equal(fresh.headers.get("etag"), etag);

  const revalidated = await cachePublicGet(new Response("content", { headers: { etag } }), new Request("https://example.com/v1/scenarios", {
    headers: { "if-none-match": '"precomputed-validator"' },
  }));
  assert.equal(revalidated.status, 304);
  assert.equal(revalidated.headers.get("etag"), etag);
});

test("generated puzzle cache keys canonicalize routing inputs", async () => {
  const key = (url: string) => generatedPuzzleCacheKey(new Request(url), "secret");
  const canonical = await key("https://first.example/v1/puzzles/generate?templateId=template&seed=seed&difficultyLevel=4&allowSeedFallback=true");

  assert.equal(await key("http://second.example/v1/puzzles/generate?allowSeedFallback=true&seed=seed&difficultyLevel=4&templateId=template#fragment"), canonical);
  assert.equal(await key("http://second.example/v1/puzzles/generate?ignored=value&allowSeedFallback=true&seed=seed&difficultyLevel=4&templateId=template"), undefined);
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

// Secret-derived cache state is bounded by the policy in README.md#local-response-cache-policy.
test("cache key derivation bounds secret namespace digests with least-recently-used eviction", async () => {
  const request = new Request("https://example.com/v1/puzzles/generate?templateId=template&seed=seed");
  const digestCache = new Map<string | undefined, Promise<string>>();
  let digestCalls = 0;
  const digest = async () => {
    digestCalls += 1;
    return new Uint8Array(32).buffer;
  };
  const key = (secret: string) => generatedPuzzleCacheKey(request, secret, { digestCache, digest });
  const secrets = Array.from({ length: 11 }, (_, index) => `lru-test-secret-${index}`);

  // Fill the cache, then refresh the oldest secret before adding one more.
  // The refreshed entry must survive while the now-oldest secret is evicted.
  for (const secret of secrets.slice(0, 10)) await key(secret);
  assert.equal(digestCalls, 10);

  await key(secrets[0]!);
  assert.equal(digestCalls, 10);

  await key(secrets[10]!);
  assert.equal(digestCalls, 11);

  await key(secrets[0]!);
  assert.equal(digestCalls, 11);

  await key(secrets[1]!);
  assert.equal(digestCalls, 12);
});

// Recovery contract: failed digests are retried under README.md#local-response-cache-policy.
test("cache-key derivation recovers from a transient digest failure", async () => {
  const request = new Request("https://example.com/v1/puzzles/generate?templateId=template&seed=seed");
  const failure = new Error("test digest failure");
  let digestCalls = 0;
  const reportedFailures: unknown[] = [];
  const digestCache = new Map<string | undefined, Promise<string>>();
  const key = () => generatedPuzzleCacheKey(request, "failing-crypto-test-secret", {
    digestCache,
    digest: async () => {
      digestCalls += 1;
      if (digestCalls === 1) throw failure;
      return new Uint8Array(32).buffer;
    },
    reportDigestFailure: error => reportedFailures.push(error),
  });

  assert.equal(await key(), undefined);
  const recoveredKey = await key();
  assert.ok(recoveredKey);
  assert.equal(await key(), recoveredKey);
  assert.equal(digestCalls, 2);
  assert.deepEqual(reportedFailures, [failure]);
});
