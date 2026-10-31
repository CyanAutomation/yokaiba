import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { entityTagsMatchWeakly, formatSmokeFailure, probePublicGeneration } from "../scripts/deployment-smoke-support.mjs";

test("conditional cache validation compares entity tags using HTTP weak comparison", () => {
  assert.equal(entityTagsMatchWeakly('"same-representation"', '"same-representation"'), true);
  assert.equal(entityTagsMatchWeakly('W/"same-representation"', '"same-representation"'), true);
  assert.equal(entityTagsMatchWeakly('"same-representation"', 'W/"same-representation"'), true);
  assert.equal(entityTagsMatchWeakly('W/"different-representation"', '"same-representation"'), false);
  assert.equal(entityTagsMatchWeakly('"W/abc"', '"abc"'), false);
  assert.equal(entityTagsMatchWeakly('W/abc', 'abc'), false);
  assert.equal(entityTagsMatchWeakly(null, '"same-representation"'), false);
});

test("deployment smoke probe uses a build-specific public generation seed", async () => {
  const smokeScript = await readFile(new URL("../scripts/smoke-deployment.mts", import.meta.url), "utf8");
  const smokeSupport = await readFile(new URL("../scripts/deployment-smoke-support.mts", import.meta.url), "utf8");

  assert.match(smokeScript, /const smokeSeed = `deployment-smoke-\$\{expectedBuildSha\}`;/);
  assert.match(smokeScript, /const smokeTemplateIds = \["tournament-order-v2", "tournament-order-v1"\] as const;/);
  assert.match(smokeScript, /probePublicGeneration\(baseUrl, smokeSeed, smokeTemplateIds\)/);
  assert.match(smokeSupport, /const candidateSeed = attempt === 0 \? smokeSeed : `\$\{smokeSeed\}-\$\{attempt\}`;/);
  assert.match(smokeSupport, /for \(let attempt = 0; attempt < 5; attempt \+= 1\)/);
  assert.doesNotMatch(smokeScript, /seed=first-puzzle/);
});

test("public generation failures include the response body and Cloudflare Ray ID", async () => {
  const fetcher = async () => new Response("error code: 1101", {
    status: 500,
    headers: { "cf-ray": "a5222eb5ba037054-WAW", "x-request-id": "smoke-request-123" },
  });

  await assert.rejects(
    probePublicGeneration(new URL("https://example.workers.dev"), "smoke-sha", ["tournament-order-v2"], fetcher),
    /error code: 1101.*smoke-request-123.*a5222eb5ba037054-WAW/s,
  );
});

test("conditional cache failures include the Cloudflare Ray ID", () => {
  const response = new Response("cache validation failed", {
    status: 502,
    headers: { "cf-ray": "cache-ray-456", "x-request-id": "cache-request-123" },
  });

  assert.match(
    formatSmokeFailure("cached puzzle request", response, "cache validation failed"),
    /cached puzzle request returned 502.*cache-request-123.*cache-ray-456.*cache validation failed/,
  );
});

test("deployment smoke retries generation failures and returns the first successful candidate", async () => {
  const requests: string[] = [];
  const fetcher = async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    requests.push(url.pathname + url.search);
    return requests.length === 1
      ? new Response("generation unavailable", { status: 500 })
      : new Response(JSON.stringify({ clues: [] }), { status: 200 });
  };

  const result = await probePublicGeneration(new URL("https://example.workers.dev"), "smoke-sha", ["tournament-order-v2"], fetcher);

  assert.equal(result.path, "/v1/puzzles/generate?templateId=tournament-order-v2&seed=smoke-sha-1");
  assert.equal(result.response.status, 200);
  assert.equal(requests.length, 2);
});

test("Worker config enables invocation logs for deploy diagnostics", async () => {
  const wrangler = await readFile(new URL("../wrangler.toml", import.meta.url), "utf8");

  assert.match(wrangler, /\[observability\][\s\S]*?enabled\s*=\s*true/);
  assert.match(wrangler, /\[observability\.logs\][\s\S]*?invocation_logs\s*=\s*true/);
});

test("Worker config binds the puzzle outcome Analytics Engine dataset", async () => {
  const wrangler = await readFile(new URL("../wrangler.toml", import.meta.url), "utf8");

  assert.match(wrangler, /\[\[analytics_engine_datasets\]\]\s+binding\s*=\s*"PUZZLE_OUTCOMES"\s+dataset\s*=\s*"yokaiba_puzzle_outcomes"/);
});
