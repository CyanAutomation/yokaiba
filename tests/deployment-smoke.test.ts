import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parse } from "smol-toml";
import { deploymentSmokeCandidates, entityTagsMatchWeakly, formatSmokeFailure, probePublicGeneration } from "../scripts/deployment-smoke-support.mjs";

test("conditional cache validation compares entity tags using HTTP weak comparison", () => {
  assert.equal(entityTagsMatchWeakly('"same-representation"', '"same-representation"'), true);
  assert.equal(entityTagsMatchWeakly('W/"same-representation"', '"same-representation"'), true);
  assert.equal(entityTagsMatchWeakly('"same-representation"', 'W/"same-representation"'), true);
  assert.equal(entityTagsMatchWeakly('W/"different-representation"', '"same-representation"'), false);
  assert.equal(entityTagsMatchWeakly('"W/abc"', '"abc"'), false);
  assert.equal(entityTagsMatchWeakly('W/abc', 'abc'), false);
  assert.equal(entityTagsMatchWeakly(null, '"same-representation"'), false);
});

test("deployment smoke candidates use the released build identity and supported templates", () => {
  assert.deepEqual(deploymentSmokeCandidates("abc123"), {
    seed: "deployment-smoke-abc123",
    templateIds: ["tournament-order-v2", "tournament-order-v1"],
  });
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
  const wrangler = parse(await readFile(new URL("../wrangler.toml", import.meta.url), "utf8")) as {
    observability?: { enabled?: boolean; logs?: { invocation_logs?: boolean } };
  };

  assert.equal(wrangler.observability?.enabled, true);
  assert.equal(wrangler.observability?.logs?.invocation_logs, true);
});

test("Worker config binds the puzzle outcome Analytics Engine dataset", async () => {
  const wrangler = await readFile(new URL("../wrangler.toml", import.meta.url), "utf8");

  assert.match(wrangler, /\[\[analytics_engine_datasets\]\]\s+binding\s*=\s*"PUZZLE_OUTCOMES"\s+dataset\s*=\s*"yokaiba_puzzle_outcomes"/);
});
