import assert from "node:assert/strict";
import test from "node:test";
import { outcomeRoute } from "../src/api/outcome-route.js";
import { generatePuzzle } from "../src/generation/generator.js";
import { tournamentOrderTemplate } from "../src/templates/tournament-order.js";
import { issuePuzzleToken } from "../src/api/puzzle-token.js";

const templates = new Map([[tournamentOrderTemplate.id, tournamentOrderTemplate]]);
const tokenSecret = "outcome-token-secret";
const puzzleToken = await issuePuzzleToken(generatePuzzle(tournamentOrderTemplate, "outcome-route-test"), tokenSecret);

function outcomeRequest(body: unknown, includeToken = true): Request {
  return new Request("https://yokaiba.test/v1/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(includeToken && body && typeof body === "object" && !Array.isArray(body)
      ? { puzzleToken, ...body }
      : body),
  });
}

test("outcome route normalizes accepted telemetry and drops unapproved fields", async () => {
  const accepted: Record<string, unknown>[] = [];
  const response = await outcomeRoute(outcomeRequest({
    event: "puzzle_completed",
    templateId: tournamentOrderTemplate.id,
    elapsedMs: 1_200,
    hintsUsed: 2,
    smartMarkingEnabled: true,
    seed: "private-seed",
    playerId: "private-player",
  }), templates, event => { accepted.push(event); }, tokenSecret);

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { accepted: true });
  assert.deepEqual(accepted, [{
    schemaVersion: 0,
    event: "puzzle_completed",
    templateId: tournamentOrderTemplate.id,
    assessedDifficultyLevel: generatePuzzle(tournamentOrderTemplate, "outcome-route-test").difficulty.level,
    elapsedMs: 1_200,
    hintsUsed: 2,
    smartMarkingEnabled: true,
  }]);
});

test("outcome route enforces versioned requirements and telemetry ranges", async () => {
  const accepted: Record<string, unknown>[] = [];
  const sink = (event: Record<string, unknown>) => { accepted.push(event); };

  const missingFields = await outcomeRoute(outcomeRequest({
    schemaVersion: 1,
    event: "puzzle_started",
    templateId: tournamentOrderTemplate.id,
  }), templates, sink, tokenSecret);
  assert.equal(missingFields.status, 400);

  const outOfRange = await outcomeRoute(outcomeRequest({
    event: "puzzle_started",
    templateId: tournamentOrderTemplate.id,
    requestedDifficultyLevel: 13,
  }), templates, sink, tokenSecret);
  assert.equal(outOfRange.status, 400);
  assert.equal(accepted.length, 0);

  const validVersionOne = await outcomeRoute(outcomeRequest({
    schemaVersion: 1,
    event: "puzzle_started",
    templateId: tournamentOrderTemplate.id,
    hintsUsed: 0,
    mistakes: 100,
  }), templates, sink, tokenSecret);
  assert.equal(validVersionOne.status, 202);
  assert.deepEqual(accepted[0], {
    schemaVersion: 1,
    event: "puzzle_started",
    templateId: tournamentOrderTemplate.id,
    assessedDifficultyLevel: generatePuzzle(tournamentOrderTemplate, "outcome-route-test").difficulty.level,
    hintsUsed: 0,
    mistakes: 100,
  });
});

test("outcome route reports missing storage without accepting an event", async () => {
  const response = await outcomeRoute(outcomeRequest({
    event: "puzzle_started",
    templateId: tournamentOrderTemplate.id,
  }), templates, undefined, tokenSecret);

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: { code: "not_configured", message: "puzzle outcome storage is not configured" },
  });
});

test("outcome route requires a valid v4 token and rejects mismatched puzzle identity", async () => {
  const accepted: Record<string, unknown>[] = [];
  const sink = (event: Record<string, unknown>) => { accepted.push(event); };
  const missing = await outcomeRoute(outcomeRequest({
    event: "puzzle_started", templateId: tournamentOrderTemplate.id,
  }, false), templates, sink, tokenSecret);
  assert.equal(missing.status, 400);

  const invalid = await outcomeRoute(outcomeRequest({
    event: "puzzle_started", puzzleToken: "invalid-token", templateId: tournamentOrderTemplate.id,
  }), templates, sink, tokenSecret);
  assert.equal(invalid.status, 400);

  const mismatched = await outcomeRoute(outcomeRequest({
    event: "puzzle_started", templateId: "open-division-v1",
  }), templates, sink, tokenSecret);
  assert.equal(mismatched.status, 400);

  const trustedPuzzle = generatePuzzle(tournamentOrderTemplate, "outcome-route-test");
  const forgedDifficulty = await outcomeRoute(outcomeRequest({
    event: "puzzle_started", templateId: tournamentOrderTemplate.id,
    assessedDifficultyLevel: trustedPuzzle.difficulty.level === 12 ? 1 : trustedPuzzle.difficulty.level + 1,
  }), templates, sink, tokenSecret);
  assert.equal(forgedDifficulty.status, 400);
  assert.equal(accepted.length, 0);
});
