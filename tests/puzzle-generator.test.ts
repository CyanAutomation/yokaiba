import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  countSolutions,
  evaluatePuzzleQuality,
  generatePuzzle,
  type PuzzleTemplate,
} from "../src/index.js";
import { createRestRouter, tournamentOrderTemplate } from "../src/index.js";
import worker from "../worker/index.js";

const template: PuzzleTemplate = {
  id: "test-tournament",
  title: "Test tournament",
  baseCategory: "judoka",
  categories: [
    { id: "judoka", label: "Judoka", values: ["Aki", "Ben", "Cora", "Dan"] },
    { id: "club", label: "Club", values: ["Falcons", "Lions", "Tigers", "Wolves"] },
    { id: "tatami", label: "Tatami", values: ["1", "2", "3", "4"] },
    { id: "placing", label: "Placing", values: ["1st", "2nd", "3rd", "4th"], ordered: true },
  ],
};

test("a seeded puzzle is reproducible and has exactly one solution", () => {
  const first = generatePuzzle(template, "golden-seed");
  const second = generatePuzzle(template, "golden-seed");

  assert.deepEqual(first, second);
  assert.equal(countSolutions(first.spec, first.clues, 2), 1);
});

test("the generated clue set is minimal for uniqueness", () => {
  const puzzle = generatePuzzle(template, "minimal-seed");
  const quality = evaluatePuzzleQuality(puzzle.spec, puzzle.clues);

  assert.equal(quality.unique, true);
  assert.deepEqual(quality.redundantClueIds, []);
  for (const clue of puzzle.clues) {
    assert.notEqual(countSolutions(puzzle.spec, puzzle.clues.filter(candidate => candidate.id !== clue.id), 2), 1);
  }
});

test("quality reports clue diversity, readability, and no-guess human trace", () => {
  const puzzle = generatePuzzle(template, "quality-seed");
  const quality = evaluatePuzzleQuality(puzzle.spec, puzzle.clues);

  assert.ok(quality.clueDiversity.distinctKinds >= 2);
  assert.equal(quality.readability.unreadableClueIds.length, 0);
  assert.equal(quality.humanSolve.usedGuessing, false);
  assert.equal(quality.humanSolve.solved, true);
});

test("OpenAPI documents every public REST endpoint", async () => {
  const specification = await readFile(new URL("../openapi/v1.yaml", import.meta.url), "utf8");
  for (const path of ["/healthz", "/v1/scenarios", "/v1/version", "/v1/puzzles/generate"]) {
    assert.match(specification, new RegExp(`^  ${path.replace(/[/.]/g, "\\$&")}:`, "m"));
  }
  assert.match(specification, /GeneratedPuzzle:/);
  assert.match(specification, /Error:/);
});

test("REST generation redacts the hidden solution and includes reproducibility metadata", async () => {
  const route = createRestRouter([tournamentOrderTemplate]);
  const response = await route(new Request("https://yokaiba.test/v1/puzzles/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ templateId: "tournament-order-v1", seed: "api-seed" }),
  }));

  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.templateId, "tournament-order-v1");
  assert.equal(body.seed, "api-seed");
  assert.equal("solution" in body, false);
  assert.ok(Array.isArray(body.clues));
});

test("REST supports cacheable deterministic GET generation", async () => {
  const route = createRestRouter([tournamentOrderTemplate]);
  const response = await route(new Request("https://yokaiba.test/v1/puzzles/generate?templateId=tournament-order-v1&seed=api-seed"));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=3600, s-maxage=86400, immutable");
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.seed, "api-seed");
  assert.equal("solution" in body, false);
});

test("REST rejects excessively long generation inputs", async () => {
  const route = createRestRouter([tournamentOrderTemplate]);
  const response = await route(new Request("https://yokaiba.test/v1/puzzles/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ templateId: "tournament-order-v1", seed: "a".repeat(129) }),
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: { code: "bad_request", message: "seed must be at most 128 characters" } });
});

test("REST router returns a bad request for an invalid URL", async () => {
  const route = createRestRouter([tournamentOrderTemplate]);
  const response = await route({ method: "GET", url: "not a URL" } as Request);

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: { code: "bad_request", message: "Invalid URL" } });
});

test("solver handles the maximum supported row count", () => {
  const fiveRows: PuzzleTemplate = {
    id: "five-rows",
    title: "Five rows",
    baseCategory: "person",
    categories: [
      { id: "person", label: "Person", values: ["A", "B", "C", "D", "E"] },
      { id: "place", label: "Place", values: ["1", "2", "3", "4", "5"] },
    ],
  };

  assert.equal(countSolutions(fiveRows, [], 200), 120);
});

test("MCP rate limiting runs before authentication", async () => {
  const env = {
    API_KEY: "secret",
    MCP_ALLOWED_HOSTNAMES: "yokaiba.test",
    MCP_RATE_LIMIT: "2",
  };
  const makeRequest = () => new Request("https://yokaiba.test/mcp", {
    headers: { "cf-connecting-ip": "192.0.2.10" },
  });

  assert.equal((await worker.fetch(makeRequest(), env, {} as ExecutionContext)).status, 401);
  assert.equal((await worker.fetch(makeRequest(), env, {} as ExecutionContext)).status, 401);
  const limited = await worker.fetch(makeRequest(), env, {} as ExecutionContext);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
});

test("worker rejects malformed URLs without throwing", async () => {
  const request = { method: "GET", url: "invalid" } as Request;
  const response = await worker.fetch(request, {
    REST_RATE_LIMITER: {
      limit: async () => { throw new Error("rate limiter should not receive an invalid URL"); },
    },
  }, {} as ExecutionContext);
  assert.equal(response.status, 400);
});

test("worker falls back to local REST rate limiting when the provider fails", async () => {
  const env = {
    REST_RATE_LIMIT: "1",
    REST_RATE_LIMITER: {
      limit: async () => { throw new Error("provider unavailable"); },
    },
  };
  const makeRequest = () => new Request("https://yokaiba.test/v1/scenarios", {
    headers: { "cf-connecting-ip": "192.0.2.90" },
  });

  assert.equal((await worker.fetch(makeRequest(), env, {} as ExecutionContext)).status, 200);
  assert.equal((await worker.fetch(makeRequest(), env, {} as ExecutionContext)).status, 429);
});

test("worker provides health, browser CORS, and REST rate limiting", async () => {
  const env = {
    REST_ALLOWED_ORIGINS: "https://game.example,https://preview.example",
    REST_RATE_LIMIT: "2",
  };
  const corsRequest = new Request("https://yokaiba.test/v1/puzzles/generate", {
    method: "OPTIONS",
    headers: {
      origin: "https://game.example",
      "access-control-request-method": "POST",
    },
  });
  const preflight = await worker.fetch(corsRequest, env, {} as ExecutionContext);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://game.example");
  assert.equal(preflight.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");
  assert.equal(preflight.headers.get("vary"), "Origin");

  const rejectedPreflight = await worker.fetch(new Request("https://yokaiba.test/v1/puzzles/generate", {
    method: "OPTIONS",
    headers: {
      origin: "https://game.example",
      "access-control-request-method": "POST",
      "access-control-request-headers": "x-unexpected-header",
    },
  }), env, {} as ExecutionContext);
  assert.equal(rejectedPreflight.status, 403);

  const health = await worker.fetch(new Request("https://yokaiba.test/healthz"), env, {} as ExecutionContext);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });

  const makeRequest = () => new Request("https://yokaiba.test/v1/scenarios", {
    headers: { origin: "https://game.example", "cf-connecting-ip": "192.0.2.88" },
  });
  const first = await worker.fetch(makeRequest(), env, {} as ExecutionContext);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("access-control-allow-origin"), "https://game.example");
  assert.ok(first.headers.get("x-request-id"));
  assert.equal((await worker.fetch(makeRequest(), env, {} as ExecutionContext)).status, 200);
  assert.equal((await worker.fetch(makeRequest(), env, {} as ExecutionContext)).status, 429);
});

test("worker returns an ETag and honors conditional public GETs", async () => {
  const env = { REST_ALLOWED_ORIGINS: "https://game.example" };
  const url = "https://yokaiba.test/v1/puzzles/generate?templateId=tournament-order-v1&seed=etag-seed";
  const first = await worker.fetch(new Request(url, { headers: { origin: "https://game.example", "cf-connecting-ip": "192.0.2.89" } }), env, {} as ExecutionContext);
  assert.equal(first.status, 200);
  const etag = first.headers.get("etag");
  assert.ok(etag);
  const second = await worker.fetch(new Request(url, { headers: { origin: "https://game.example", "if-none-match": etag!, "cf-connecting-ip": "192.0.2.89" } }), env, {} as ExecutionContext);
  assert.equal(second.status, 304);
});
