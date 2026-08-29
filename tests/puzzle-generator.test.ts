import assert from "node:assert/strict";
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

  assert.ok(quality.clueDiversity.distinctKinds >= 1);
  assert.equal(quality.readability.unreadableClueIds.length, 0);
  assert.equal(quality.humanSolve.usedGuessing, false);
  assert.equal(quality.humanSolve.solved, true);
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
    MCP_API_KEY: "secret",
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
  const response = await worker.fetch(request, {}, {} as ExecutionContext);
  assert.equal(response.status, 400);
});
