import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  countSolutions,
  exhaustivePuzzleSolver,
  evaluatePuzzleQuality,
  generatePuzzle,
  MAX_SUPPORTED_ROWS,
  satisfiesConstraint,
  solve,
  solveWithTelemetry,
  type Clue,
  type PuzzleSolver,
  type PuzzleTemplate,
} from "../src/index.js";
import { createRestRouter, openDivisionTemplate, tournamentOrderTemplate } from "../src/index.js";
import worker, { createRateLimiter, createWorker } from "../worker/index.js";

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

const qualityFixtureSpec: PuzzleTemplate = {
  id: "quality-fixture",
  title: "Quality evaluator fixture",
  baseCategory: "person",
  categories: [
    { id: "person", label: "Person", values: ["Aki", "Ben"] },
    { id: "color", label: "Color", values: ["Red", "Blue"] },
    { id: "placing", label: "Placing", values: ["1st", "2nd"], ordered: true },
  ],
};

const solverFixtureSpec: PuzzleTemplate = {
  id: "solver-fixture",
  title: "Solver fixture",
  baseCategory: "person",
  categories: [
    { id: "person", label: "Person", values: ["Aki", "Ben", "Cora"] },
    { id: "color", label: "Color", values: ["Red", "Blue", "Green"] },
    { id: "pet", label: "Pet", values: ["Cat", "Dog", "Fox"] },
  ],
};

const clueKindsAndReadabilityFixture: Clue[] = [
  { id: "direct-red", constraint: { kind: "matches", subject: "Aki", category: "color", value: "Red" }, text: "Aki wore red." },
  { id: "blank-negative", constraint: { kind: "notMatches", subject: "Ben", category: "color", value: "Red" }, text: "   " },
  { id: "undefined-order", constraint: { kind: "before", left: { category: "person", value: "Aki" }, right: { category: "person", value: "Ben" } }, text: "undefined finished first." },
  { id: "null-adjacency", constraint: { kind: "adjacent", left: { category: "color", value: "Red" }, right: { category: "color", value: "Blue" } }, text: "Red was beside null." },
];

const noGuessSolveFixture: Clue[] = [
  { id: "aki-red", constraint: { kind: "matches", subject: "Aki", category: "color", value: "Red" }, text: "Aki wore red." },
  { id: "aki-not-second", constraint: { kind: "notMatches", subject: "Aki", category: "placing", value: "2nd" }, text: "Aki did not finish second." },
];

test("Tournament Order uses judoka names for its default working board", () => {
  assert.equal(tournamentOrderTemplate.baseCategory, "judoka");
  assert.deepEqual(tournamentOrderTemplate.categories.map(category => category.id), [
    "judoka", "weight", "tatami", "placing",
  ]);
  assert.deepEqual(tournamentOrderTemplate.categories[0]?.values, ["Aki", "Hana", "Kenji", "Sora"]);
});

test("Open Division publishes its five-row template contract", () => {
  assert.equal(openDivisionTemplate.id, "open-division-v1");
  assert.equal(openDivisionTemplate.baseCategory, "judoka");
  assert.ok(openDivisionTemplate.categories.every(category => category.values.length === 5));
  assert.deepEqual(openDivisionTemplate.metadata!.locales, { default: "en", supported: ["en"] });
});

test("Open Division generation is deterministic and unique for a fixed seed", () => {
  const first = generatePuzzle(openDivisionTemplate, "catalogue-seed");
  const second = generatePuzzle(openDivisionTemplate, "catalogue-seed");

  assert.deepEqual(first, second);
  assert.equal(countSolutions(first.spec, first.clues, 2), 1);
});

test("a seeded puzzle is reproducible and has exactly one solution", () => {
  const first = generatePuzzle(template, "golden-seed");
  const second = generatePuzzle(template, "golden-seed");

  assert.deepEqual(first, second);
  assert.equal(countSolutions(first.spec, first.clues, 2), 1);
});

test("the exhaustive solver fulfils the public solver contract", () => {
  const clues = [{ id: "aki-red", constraint: { kind: "matches" as const, subject: "Aki", category: "color", value: "Red" }, text: "Aki wore red." }];
  assert.equal(exhaustivePuzzleSolver.version, "yokaiba-exhaustive-v1");
  assert.deepEqual(exhaustivePuzzleSolver.solve(qualityFixtureSpec, clues, 1), solve(qualityFixtureSpec, clues, 1));
  assert.equal(exhaustivePuzzleSolver.countSolutions(qualityFixtureSpec, clues, 1), countSolutions(qualityFixtureSpec, clues, 1));
});

test("solver preserves the semantics of every clue kind", () => {
  const count = (constraint: Clue["constraint"]) => countSolutions(solverFixtureSpec, [{ id: constraint.kind, constraint, text: constraint.kind }], 100);

  assert.equal(count({ kind: "matches", subject: "Aki", category: "color", value: "Red" }), 12);
  assert.equal(count({ kind: "notMatches", subject: "Aki", category: "color", value: "Red" }), 24);
  assert.equal(count({ kind: "before", left: { category: "color", value: "Red" }, right: { category: "color", value: "Blue" } }), 18);
  assert.equal(count({ kind: "adjacent", left: { category: "color", value: "Red" }, right: { category: "color", value: "Blue" } }), 24);
});

test("solver evaluates relational clues across categories", () => {
  const before: Clue = {
    id: "red-before-cat",
    constraint: { kind: "before", left: { category: "color", value: "Red" }, right: { category: "pet", value: "Cat" } },
    text: "Red comes before Cat.",
  };
  const adjacent: Clue = {
    id: "blue-next-to-dog",
    constraint: { kind: "adjacent", left: { category: "color", value: "Blue" }, right: { category: "pet", value: "Dog" } },
    text: "Blue is next to Dog.",
  };

  assert.equal(countSolutions(solverFixtureSpec, [before], 100), 12);
  assert.equal(countSolutions(solverFixtureSpec, [adjacent], 100), 16);
});

test("solver returns no solution for contradictory clues", () => {
  const contradictory: Clue[] = [
    { id: "aki-red", constraint: { kind: "matches", subject: "Aki", category: "color", value: "Red" }, text: "Aki is Red." },
    { id: "aki-not-red", constraint: { kind: "notMatches", subject: "Aki", category: "color", value: "Red" }, text: "Aki is not Red." },
  ];

  assert.equal(countSolutions(solverFixtureSpec, contradictory, 2), 0);
  assert.deepEqual(solve(solverFixtureSpec, contradictory), []);
});

test("solver honours limits while retaining deterministic exhaustive results", () => {
  const first = solve(solverFixtureSpec, [], 2);
  const second = solve(solverFixtureSpec, [], 2);

  assert.equal(countSolutions(solverFixtureSpec, [], 100), 36);
  assert.equal(countSolutions(solverFixtureSpec, [], 2), 2);
  assert.deepEqual(first, second);
  assert.equal(first.length, 2);
  assert.deepEqual(solve(solverFixtureSpec, [], 0), []);
});

test("solver telemetry reports searched nodes, evaluated constraints, and elapsed time", () => {
  const clue: Clue = {
    id: "aki-cat",
    constraint: { kind: "matches", subject: "Aki", category: "pet", value: "Cat" },
    text: "Aki has Cat.",
  };
  const result = solveWithTelemetry(solverFixtureSpec, [clue], 2);

  assert.equal(result.solutions.length, 2);
  for (const counter of [result.telemetry.nodesVisited, result.telemetry.constraintChecks]) {
    assert.ok(Number.isFinite(counter));
    assert.ok(Number.isInteger(counter));
    assert.ok(counter >= 0);
  }
  assert.ok(result.telemetry.constraintChecks > 0);
  assert.ok(Number.isFinite(result.telemetry.elapsedMs));
  assert.ok(result.telemetry.elapsedMs >= 0);
  assert.ok(result.solutions.every(solution => satisfiesConstraint(solverFixtureSpec, solution, clue.constraint)));
});

test("generation and quality evaluation use an injected solver and record its version", () => {
  const calls: string[] = [];
  const solver: PuzzleSolver = {
    version: "contract-test-v1",
    solve: (spec, clues, limit) => exhaustivePuzzleSolver.solve(spec, clues, limit),
    countSolutions: (spec, clues, limit) => {
      calls.push(`count:${clues.length}:${limit}`);
      return exhaustivePuzzleSolver.countSolutions(spec, clues, limit);
    },
  };
  const puzzle = generatePuzzle(template, "injected-solver", solver);
  const quality = evaluatePuzzleQuality(puzzle.spec, puzzle.clues, solver);

  assert.equal(puzzle.solverVersion, "contract-test-v1");
  assert.equal(quality.unique, true);
  assert.ok(calls.length > 0);
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

test("quality reports the exact clue kinds in a controlled fixture", () => {
  const quality = evaluatePuzzleQuality(qualityFixtureSpec, clueKindsAndReadabilityFixture);

  assert.deepEqual(quality.clueDiversity, {
    distinctKinds: 4,
    kinds: ["adjacent", "before", "matches", "notMatches"],
  });
});

test("quality reports the exact unreadable clue IDs in a controlled fixture", () => {
  const quality = evaluatePuzzleQuality(qualityFixtureSpec, clueKindsAndReadabilityFixture);

  assert.deepEqual(quality.readability.unreadableClueIds, [
    "blank-negative",
    "undefined-order",
    "null-adjacency",
  ]);
});

test("quality records a completed human trace without guessing", () => {
  const quality = evaluatePuzzleQuality(qualityFixtureSpec, noGuessSolveFixture);

  assert.deepEqual(quality.humanSolve, {
    solved: true,
    usedGuessing: false,
    totalCost: 2,
    hardestStep: 1,
  });
});

test("quality reports an incomplete human trace when clues cannot finish the puzzle", () => {
  const incompleteFixture = noGuessSolveFixture.slice(0, 1);
  const quality = evaluatePuzzleQuality(qualityFixtureSpec, incompleteFixture);

  assert.deepEqual(quality.humanSolve, {
    solved: false,
    usedGuessing: false,
    totalCost: 1,
    hardestStep: 1,
  });
});

test("difficulty is reproducible and publishes deterministic human and solver evidence", () => {
  const fixtures = ["recalibrate-7", "recalibrate-18", "recalibrate-3", "recalibrate-1", "recalibrate-0"];
  for (const seed of fixtures) {
    const difficulty = generatePuzzle(tournamentOrderTemplate, seed).difficulty;
    assert.equal(difficulty.modelVersion, "yokaiba-difficulty-v2");
    assert.ok(difficulty.evidence.score > 0);
    assert.ok(difficulty.evidence.solver.nodesVisited > 0);
    assert.ok(difficulty.evidence.solver.constraintChecks > 0);
    assert.equal(typeof difficulty.evidence.humanSolve.solved, "boolean");
  }

  const reproducibleSeed = fixtures[2]!;
  const first = generatePuzzle(tournamentOrderTemplate, reproducibleSeed);
  const second = generatePuzzle(tournamentOrderTemplate, reproducibleSeed);
  assert.deepEqual(first.difficulty, second.difficulty);
});

test("OpenAPI documents every public REST endpoint", async () => {
  const specification = await readFile(new URL("../public/openapi/v1.yaml", import.meta.url), "utf8");
  for (const path of ["/healthz", "/readyz", "/docs", "/openapi/v1.yaml", "/v1/scenarios", "/v1/version", "/v1/puzzles/generate", "/v1/puzzles/verify"]) {
    assert.match(specification, new RegExp(`^  ${path.replace(/[/.]/g, "\\$&")}:`, "m"));
  }
  assert.match(specification, /GeneratedPuzzle:/);
  assert.match(specification, /PuzzleVerificationRequest:/);
  assert.match(specification, /Difficulty:/);
  assert.match(specification, /Error:/);
  assert.match(specification, /X-Request-Id:/);
  assert.match(specification, /Access-Control-Allow-Origin:/);
  assert.match(specification, /'304':/);
});

test("REST generation redacts the hidden solution and includes reproducibility metadata", async () => {
  const route = createRestRouter([tournamentOrderTemplate], { puzzleTokenSecret: "test-token-secret" });
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
  assert.equal(typeof body.puzzleToken, "string");
  const difficulty = body.difficulty as { level: number; label: string; modelVersion: string; evidence: { score: number } };
  assert.ok([1, 2, 3, 4, 5].includes(difficulty.level));
  assert.ok(["Very easy", "Easy", "Moderate", "Hard", "Very hard"].includes(difficulty.label));
  assert.equal(difficulty.modelVersion, "yokaiba-difficulty-v2");
  assert.equal(typeof difficulty.evidence.score, "number");
  assert.ok(Array.isArray(body.clues));
});

test("REST supports cacheable deterministic GET generation", async () => {
  const route = createRestRouter([tournamentOrderTemplate], { puzzleTokenSecret: "test-token-secret" });
  const response = await route(new Request("https://yokaiba.test/v1/puzzles/generate?templateId=tournament-order-v1&seed=api-seed"));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=300, s-maxage=300, must-revalidate");
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.seed, "api-seed");
  assert.equal("solution" in body, false);
});

test("REST can deterministically select every calibrated difficulty level", async () => {
  for (const template of [tournamentOrderTemplate, openDivisionTemplate]) {
    const route = createRestRouter([template]);
    for (const level of [1, 2, 3, 4, 5]) {
      const path = `https://yokaiba.test/v1/puzzles/generate?templateId=${template.id}&seed=level-picker&difficultyLevel=${level}`;
      const first = await route(new Request(path));
      const second = await route(new Request(path));
      assert.equal(first.status, 200);
      assert.deepEqual(await first.json(), await second.json());
      const replay = await route(new Request(path));
      assert.equal((await replay.json() as { difficulty: { level: number } }).difficulty.level, level);
    }
  }
});

test("REST verifies a complete submitted answer without exposing the solution", async () => {
  const route = createRestRouter([tournamentOrderTemplate], { puzzleTokenSecret: "test-token-secret" });
  const generated = await route(new Request("https://yokaiba.test/v1/puzzles/generate?templateId=tournament-order-v1&seed=verify-seed"));
  const publicPuzzle = await generated.json() as { puzzleToken: string };
  const solution = generatePuzzle(tournamentOrderTemplate, "verify-seed").solution;

  const correct = await route(new Request("https://yokaiba.test/v1/puzzles/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ puzzleToken: publicPuzzle.puzzleToken, answer: solution }),
  }));
  assert.equal(correct.status, 200);
  assert.deepEqual(await correct.json(), { correct: true });

  const categoryId = Object.keys(solution.assignments)[0]!;

  const incorrect = await route(new Request("https://yokaiba.test/v1/puzzles/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ puzzleToken: publicPuzzle.puzzleToken, answer: { assignments: { ...solution.assignments, [categoryId]: [...solution.assignments[categoryId]!].reverse() } } }),
  }));
  assert.equal(incorrect.status, 200);
  assert.deepEqual(await incorrect.json(), { correct: false });
});

async function verificationSetup() {
  const route = createRestRouter([tournamentOrderTemplate], { puzzleTokenSecret: "test-token-secret" });
  const generated = await route(new Request("https://yokaiba.test/v1/puzzles/generate?templateId=tournament-order-v1&seed=verify-invalid"));
  const { puzzleToken } = await generated.json() as { puzzleToken: string };
  return { route, puzzleToken };
}

test("REST rejects malformed verification assignments", async () => {
  const { route, puzzleToken } = await verificationSetup();
  const malformed = await route(new Request("https://yokaiba.test/v1/puzzles/verify", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ puzzleToken, answer: { assignments: { club: ["Wolves"] } } }),
  }));

  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), {
    error: { code: "bad_request", message: "answer must include every non-base category exactly once" },
  });
});

test("REST rejects a puzzle token with a tampered signature", async () => {
  const { route, puzzleToken } = await verificationSetup();
  const signatureStart = puzzleToken.indexOf(".") + 1;
  const replacement = puzzleToken[signatureStart] === "A" ? "B" : "A";
  const tamperedPuzzleToken = `${puzzleToken.slice(0, signatureStart)}${replacement}${puzzleToken.slice(signatureStart + 1)}`;
  const tampered = await route(new Request("https://yokaiba.test/v1/puzzles/verify", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ puzzleToken: tamperedPuzzleToken, answer: generatePuzzle(tournamentOrderTemplate, "verify-invalid").solution }),
  }));

  assert.equal(tampered.status, 400);
  assert.deepEqual(await tampered.json(), {
    error: { code: "bad_request", message: "puzzleToken is invalid" },
  });
});

test("REST rejects verification without a configured PUZZLE_TOKEN_SECRET", async () => {
  const unconfigured = createRestRouter([tournamentOrderTemplate]);
  const response = await unconfigured(new Request("https://yokaiba.test/v1/puzzles/verify", { method: "POST" }));

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: { code: "not_configured", message: "puzzle verification is not configured" },
  });
});

test("REST rejects excessively long generation inputs", async () => {
  const route = createRestRouter([tournamentOrderTemplate], { puzzleTokenSecret: "test-token-secret" });
  const response = await route(new Request("https://yokaiba.test/v1/puzzles/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ templateId: "tournament-order-v1", seed: "a".repeat(129) }),
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: { code: "bad_request", message: "seed must be at most 128 characters" } });
});

test("REST does not disclose why a JSON request body was rejected", async () => {
  const route = createRestRouter([tournamentOrderTemplate]);
  const requests = [
    new Request("https://yokaiba.test/v1/puzzles/generate", { method: "POST" }),
    new Request("https://yokaiba.test/v1/puzzles/generate", { method: "POST", body: "{" }),
    new Request("https://yokaiba.test/v1/puzzles/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ templateId: "tournament-order-v1", seed: "x".repeat(16 * 1024) }),
    }),
    new Request("https://yokaiba.test/v1/puzzles/generate", {
      method: "POST", headers: { "content-length": `${16 * 1024 + 1}` }, body: "{}",
    }),
  ];

  for (const request of requests) {
    const response = await route(request);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: { code: "bad_request", message: "request body must be valid JSON" } });
  }
});

test("version and readiness expose deployed build and rate-limit configuration", async () => {
  const isolatedWorker = createWorker({ rateLimiter: () => false });
  const env = { BUILD_VERSION: "0.1.0-test", BUILD_SHA: "deadbeef", REST_RATE_LIMITER: { limit: async () => ({ success: true }) } };
  const version = await isolatedWorker.fetch(new Request("https://yokaiba.test/v1/version"), env, {} as ExecutionContext);
  assert.deepEqual(await version.json(), {
    serviceVersion: "0.1.0-test", buildSha: "deadbeef", generatorVersion: "yokaiba-generator-v1", solverVersion: "yokaiba-exhaustive-v1",
  });
  const ready = await isolatedWorker.fetch(new Request("https://yokaiba.test/readyz"), env, {} as ExecutionContext);
  assert.deepEqual(await ready.json(), { status: "ready", build: { serviceVersion: "0.1.0-test", buildSha: "deadbeef" }, rateLimitProvider: "configured" });
});

test("solver handles the maximum supported row count", () => {
  assert.equal(MAX_SUPPORTED_ROWS, 5);
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

test("solver rejects a grid one row above the supported maximum", () => {
  const values = Array.from({ length: MAX_SUPPORTED_ROWS + 1 }, (_, index) => String(index + 1));
  const tooManyRows: PuzzleTemplate = {
    id: "too-many-rows",
    title: "Too many rows",
    baseCategory: "person",
    categories: [
      { id: "person", label: "Person", values },
      { id: "place", label: "Place", values: [...values] },
    ],
  };

  assert.throws(
    () => countSolutions(tooManyRows, []),
    new Error("MVP solver supports grids with 2 through 5 rows"),
  );
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
  assert.equal((await ready.json() as { rateLimitProvider: string }).rateLimitProvider, "fallback");
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
  assert.equal(preflight.headers.get("access-control-allow-headers"), "content-type");
  assert.equal(preflight.headers.get("vary"), "Origin");
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
  assert.ok(response.headers.get("x-request-id"));
  assert.equal(response.headers.get("ratelimit-limit"), "60");
  assert.equal(response.headers.get("ratelimit-policy"), "60;w=60");
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

test("worker serves Swagger UI with complete security controls", async () => {
  for (const path of ["/docs", "/docs/"]) {
    const docs = await worker.fetch(new Request(`https://yokaiba.test${path}`), {}, {} as ExecutionContext);
    assert.equal(docs.status, 200);

    const contentSecurityPolicy = docs.headers.get("content-security-policy") ?? "";
    assert.match(contentSecurityPolicy, /(?:^|; )default-src 'none'(?:;|$)/);
    assert.match(contentSecurityPolicy, /(?:^|; )script-src 'self' 'unsafe-inline' https:\/\/unpkg\.com(?:;|$)/);
    assert.match(contentSecurityPolicy, /(?:^|; )style-src 'self' 'unsafe-inline' https:\/\/unpkg\.com(?:;|$)/);
    assert.match(contentSecurityPolicy, /(?:^|; )img-src 'self' data: https:(?:;|$)/);
    assert.match(contentSecurityPolicy, /(?:^|; )connect-src 'self'(?:;|$)/);
    assert.match(contentSecurityPolicy, /(?:^|; )base-uri 'none'(?:;|$)/);
    assert.match(contentSecurityPolicy, /(?:^|; )frame-ancestors 'none'(?:;|$)/);
    assert.equal(docs.headers.get("x-content-type-options"), "nosniff");
    assert.ok(docs.headers.get("x-request-id"));

    const docsDocument = await docs.text();
    assert.match(docsDocument, /swagger-ui\.css" integrity="sha384-[A-Za-z0-9+/]+={0,2}" crossorigin="anonymous"/);
    assert.match(docsDocument, /swagger-ui-bundle\.js" integrity="sha384-[A-Za-z0-9+/]+={0,2}" crossorigin="anonymous"/);
  }
});

test("worker delegates OpenAPI requests to the canonical asset path", async () => {
  const requestedUrls: string[] = [];
  const expectedBody = "mock OpenAPI asset body\n";
  const assets = {
    fetch: async (request: Request) => {
      requestedUrls.push(request.url);
      return new Response(expectedBody, { headers: { "content-type": "application/yaml" } });
    },
  };

  const specification = await worker.fetch(
    new Request("https://yokaiba.test/openapi/v1.yaml?cache-bust=test"),
    { ASSETS: assets },
    {} as ExecutionContext,
  );

  assert.deepEqual(requestedUrls, ["https://yokaiba.test/openapi/v1.yaml"]);
  assert.equal(specification.status, 200);
  assert.equal(specification.headers.get("content-type"), "application/yaml");
  assert.equal(await specification.text(), expectedBody);
});
