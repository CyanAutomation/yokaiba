import assert from "node:assert/strict";
import test from "node:test";
import { hintRoute, verificationRoute } from "../src/api/puzzle-action-routes.js";
import { puzzleHint } from "../src/api/puzzle-hints.js";
import { issuePuzzleToken } from "../src/api/puzzle-token.js";
import { generatePuzzle } from "../src/generation/generator.js";
import { tournamentOrderTemplate } from "../src/templates/tournament-order.js";

const routeSecret = "puzzle-action-route-test-secret";

function actionRequest(body: unknown): Request {
  return new Request("https://yokaiba.test/v1/puzzles/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("clue and elimination hints never contain a solution placement", () => {
  const puzzle = generatePuzzle(tournamentOrderTemplate, "spoiler-safe-hint");
  for (const kind of ["clue", "elimination"] as const) {
    const hint = puzzleHint(puzzle, kind);
    assert.equal("placement" in hint, false);
    assert.deepEqual(Object.keys(hint).sort(), ["clue", "kind"]);
  }
});

test("hints reject a puzzle with no available clues", () => {
  const generated = generatePuzzle(tournamentOrderTemplate, "empty-clue-hint");
  const puzzle = { ...generated, clues: [] };

  for (const kind of ["clue", "elimination"] as const) {
    assert.throws(() => puzzleHint(puzzle, kind), /No clues available for hints/);
  }
});

test("puzzle action routes use signed puzzle tokens and keep their responses spoiler-safe", async () => {
  const puzzle = generatePuzzle(tournamentOrderTemplate, "direct-puzzle-action-route");
  const puzzleToken = await issuePuzzleToken(puzzle, routeSecret);
  const templates = new Map([[tournamentOrderTemplate.id, tournamentOrderTemplate]]);

  const hintResponse = await hintRoute(actionRequest({ puzzleToken }), templates, [routeSecret]);
  assert.equal(hintResponse.status, 200);
  assert.deepEqual(await hintResponse.json(), {
    kind: "clue",
    clue: { id: puzzle.clues[0]!.id, text: puzzle.clues[0]!.text },
  });

  const verificationResponse = await verificationRoute(
    actionRequest({ puzzleToken, answer: puzzle.solution }),
    templates,
    [routeSecret],
  );
  assert.equal(verificationResponse.status, 200);
  assert.deepEqual(await verificationResponse.json(), { correct: true });
});

test("puzzle action routes reject invalid request fields and report missing configuration", async () => {
  const puzzle = generatePuzzle(tournamentOrderTemplate, "invalid-puzzle-action-route");
  const puzzleToken = await issuePuzzleToken(puzzle, routeSecret);
  const templates = new Map([[tournamentOrderTemplate.id, tournamentOrderTemplate]]);

  const invalidHint = await hintRoute(actionRequest({ puzzleToken, hintIndex: 101 }), templates, [routeSecret]);
  assert.equal(invalidHint.status, 400);
  assert.match((await invalidHint.json() as { error: { message: string } }).error.message, /hintIndex/);

  const invalidVerification = await verificationRoute(
    actionRequest({ puzzleToken, answer: puzzle.solution, tracking: "unexpected" }),
    templates,
    [routeSecret],
  );
  assert.equal(invalidVerification.status, 400);
  assert.match((await invalidVerification.json() as { error: { message: string } }).error.message, /unknown field tracking/);

  const unconfigured = await hintRoute(new Request("https://yokaiba.test/v1/puzzles/hint"), templates, []);
  assert.equal(unconfigured.status, 503);
  assert.deepEqual(await unconfigured.json(), {
    error: { code: "not_configured", message: "puzzle hints are not configured" },
  });
});
