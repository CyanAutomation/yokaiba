import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createPuzzleFeedbackSink, type D1DatabaseLike } from "../worker/puzzle-feedback-storage.js";
import type { PuzzleFeedbackRecord } from "../src/api/feedback-route.js";

function createLocalD1(): { database: DatabaseSync; binding: D1DatabaseLike } {
  const database = new DatabaseSync(":memory:");
  database.exec(readFileSync(new URL("../migrations/0001_puzzle_feedback.sql", import.meta.url), "utf8"));
  const binding: D1DatabaseLike = {
    prepare(query) {
      let values: unknown[] = [];
      return {
        bind(...parameters) { values = parameters; return this; },
        async run() {
          const result = database.prepare(query).run(...values as (string | number | null)[]);
          return { meta: { changes: Number(result.changes) } };
        },
        async first<T>() {
          return database.prepare(query).get(...values as (string | number | null)[]) as T | undefined ?? null;
        },
      };
    },
  };
  return { database, binding };
}

function feedback(overrides: Partial<PuzzleFeedbackRecord> = {}): PuzzleFeedbackRecord {
  return {
    idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
    puzzleFingerprint: "a".repeat(64),
    templateId: "tournament-order-v1",
    requestedSeed: "requested-seed",
    seed: "actual-seed",
    requestedLevel: 2,
    assessedLevel: 3,
    difficultyModelVersion: "yokaiba-difficulty-v5",
    generatorVersion: "yokaiba-generator-v6",
    generationMetadata: { fingerprintVersion: 1, solverVersion: "solver-v1", requestedSeed: "requested-seed", seed: "actual-seed" },
    rating: "too_hard",
    reason: "confusing_clues",
    outcome: "in_progress",
    hintsUsed: 1,
    mistakes: 0,
    elapsedMs: 12_345,
    smartMarkingEnabled: false,
    submittedAt: "2026-10-19T10:00:00.000Z",
    ...overrides,
  };
}

test("the D1 migration applies, enforces constraints, and creates query indexes", () => {
  const { database } = createLocalD1();
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'puzzle_feedback'").get()?.count, 1);
  assert.ok(Number(database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name LIKE 'puzzle_feedback_%'").get()?.count) >= 6);

  const insert = database.prepare(`INSERT INTO puzzle_feedback (
    id, idempotency_key, puzzle_fingerprint, template_id, requested_level, assessed_level,
    difficulty_model_version, generator_version, generation_metadata, rating, reason, outcome,
    hints_used, mistakes, elapsed_ms, smart_marking_enabled, submitted_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const row = (rating: string, reason: string | null, fingerprint = "a".repeat(64)) => [
    crypto.randomUUID(), crypto.randomUUID(), fingerprint, "tournament-order-v1", null, 3,
    "model-v5", "generator-v1", "{}", rating, reason, "completed", 0, 0, null, null, "2026-10-19T10:00:00.000Z",
  ] as const;
  insert.run(...row("just_right", null));
  assert.throws(() => insert.run(...row("five_stars", null)));
  assert.throws(() => insert.run(...row("too_easy", "other")));
  assert.throws(() => insert.run(...row("too_hard", null, "not-a-fingerprint")));
  database.close();
});

test("D1 feedback retries are idempotent and changed payloads conflict", async () => {
  const { database, binding } = createLocalD1();
  const save = createPuzzleFeedbackSink(binding);
  const initial = feedback();
  assert.equal(await save(initial), "inserted");
  assert.equal(await save({ ...initial, submittedAt: "2026-10-19T10:01:00.000Z" }), "duplicate");
  assert.equal(await save({ ...initial, rating: "just_right", reason: null }), "conflict");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM puzzle_feedback").get()?.count, 1);
  database.close();
});
