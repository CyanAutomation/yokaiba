import assert from "node:assert/strict";
import test from "node:test";
import { feedbackRoute, type PuzzleFeedbackRecord } from "../src/api/feedback-route.js";
import { generatePuzzle } from "../src/generation/generator.js";
import { issuePuzzleToken } from "../src/api/puzzle-token.js";
import { tournamentOrderTemplate } from "../src/templates/tournament-order.js";

const secret = "feedback-route-test-secret";
const templateMap = new Map([[tournamentOrderTemplate.id, tournamentOrderTemplate]]);
const idempotencyKey = "123e4567-e89b-42d3-a456-426614174000";

function submission(puzzleToken: string, extra: Record<string, unknown> = {}) {
  return {
    puzzleToken,
    rating: "too_hard",
    reason: "confusing_clues",
    outcome: "in_progress",
    hintsUsed: 1,
    mistakes: 2,
    elapsedMs: 120_000,
    smartMarkingEnabled: true,
    idempotencyKey,
    ...extra,
  };
}

async function post(body: unknown): Promise<Request> {
  return new Request("https://yokaiba.test/v1/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("feedback stores identity and generation metadata from the signed puzzle token", async () => {
  const puzzle = generatePuzzle(tournamentOrderTemplate, "feedback-trusted-identity");
  const token = await issuePuzzleToken(puzzle, secret);
  let saved: PuzzleFeedbackRecord | undefined;
  const response = await feedbackRoute(await post(submission(token)), templateMap, secret, value => { saved = value; return "inserted"; });
  const body = await response.json() as { accepted?: boolean };

  assert.equal(response.status, 202);
  assert.equal(body.accepted, true);
  assert.equal(saved?.puzzleFingerprint.length, 64);
  assert.equal(saved?.templateId, puzzle.templateId);
  assert.equal(saved?.seed, puzzle.seed);
  assert.equal(saved?.requestedSeed, puzzle.requestedSeed);
  assert.equal(saved?.assessedLevel, puzzle.difficulty.level);
  assert.equal(saved?.difficultyModelVersion, puzzle.difficulty.modelVersion);
  assert.equal(saved?.generatorVersion, puzzle.generatorVersion);
  assert.equal(saved?.rating, "too_hard");
  assert.equal(saved?.reason, "confusing_clues");
  assert.equal(saved?.outcome, "in_progress");
});

test("feedback accepts a reasonless too-hard rating and no reason for other ratings", async () => {
  const token = await issuePuzzleToken(generatePuzzle(tournamentOrderTemplate, "feedback-optional-reason"), secret);
  const saved: PuzzleFeedbackRecord[] = [];
  for (const body of [
    submission(token, { reason: undefined }),
    submission(token, { rating: "just_right", reason: undefined, outcome: "completed" }),
  ]) {
    const response = await feedbackRoute(await post(body), templateMap, secret, value => { saved.push(value); return "inserted"; });
    assert.equal(response.status, 202);
  }
  assert.equal(saved[0]?.reason, null);
  assert.equal(saved[1]?.reason, null);
});

test("feedback rejects invalid values, unsigned identity claims, and excessive payloads", async () => {
  const token = await issuePuzzleToken(generatePuzzle(tournamentOrderTemplate, "feedback-invalid"), secret);
  for (const body of [
    submission(token, { rating: "five_stars" }),
    submission(token, { rating: "too_easy", reason: "confusing_clues" }),
    submission(token, { rating: "too_hard", reason: "free text" }),
    submission(token, { puzzleFingerprint: "forged" }),
    submission(token, { elapsedMs: 86_400_001 }),
    submission(token, { hintsUsed: -1 }),
  ]) {
    const response = await feedbackRoute(await post(body), templateMap, secret, () => "inserted");
    assert.equal(response.status, 400);
  }
  const oversized = await feedbackRoute(await post(submission("x".repeat(5_000))), templateMap, secret, () => "inserted");
  assert.equal(oversized.status, 400);
});

test("feedback requires a valid, unexpired v4 signed puzzle token", async () => {
  const puzzle = generatePuzzle(tournamentOrderTemplate, "feedback-token-validation");
  const token = await issuePuzzleToken(puzzle, secret);
  const [payload, signature] = token.split(".");
  const requests = [
    await post(submission("not-a-token")),
    await post(submission(`${payload}.${signature!.startsWith("A") ? "B" : "A"}${signature!.slice(1)}`)),
    await post(submission(await issuePuzzleToken(puzzle, secret, { now: Math.floor(Date.now() / 1_000) - 2_000, ttlSeconds: 1 }))),
  ];
  for (const request of requests) {
    const response = await feedbackRoute(request, templateMap, secret, () => "inserted");
    assert.equal(response.status, 400);
  }
});

test("feedback storage failures are generic and idempotency conflicts are explicit", async () => {
  const token = await issuePuzzleToken(generatePuzzle(tournamentOrderTemplate, "feedback-storage-errors"), secret);
  const originalError = console.error;
  const logs: string[] = [];
  console.error = (...values: unknown[]) => { logs.push(values.map(String).join(" ")); };
  let failed: Response;
  try {
    failed = await feedbackRoute(await post(submission(token)), templateMap, secret, () => { throw new Error("private database detail"); });
  } finally {
    console.error = originalError;
  }
  assert.equal(failed.status, 503);
  assert.doesNotMatch(await failed.text(), /private database detail/);
  assert.deepEqual(logs, ['{"event":"puzzle_feedback_storage_failure"}']);
  assert.equal(logs.join(" ").includes(token), false);
  assert.equal(logs.join(" ").includes("confusing_clues"), false);
  assert.equal(logs.join(" ").includes("feedback-storage-errors"), false);

  const duplicate = await feedbackRoute(await post(submission(token)), templateMap, secret, () => "duplicate");
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await duplicate.json(), { accepted: true, duplicate: true });
  const conflict = await feedbackRoute(await post(submission(token)), templateMap, secret, () => "conflict");
  assert.equal(conflict.status, 409);
});
