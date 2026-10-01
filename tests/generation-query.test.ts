import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGenerationParameters, parseGenerationQuery } from "../src/api/generation-query.js";

test("generation parameters accept optional difficulty and opt-in seed fallback", () => {
  assert.deepEqual(normalizeGenerationParameters({ templateId: "open-division-v2", seed: "cup-final" }), {
    templateId: "open-division-v2",
    seed: "cup-final",
  });
  assert.deepEqual(normalizeGenerationParameters({
    templateId: "open-division-v2",
    seed: "cup-final",
    difficultyLevel: 12,
    allowSeedFallback: true,
  }), {
    templateId: "open-division-v2",
    seed: "cup-final",
    difficultyLevel: 12,
    allowSeedFallback: true,
  });
  assert.deepEqual(normalizeGenerationParameters({
    templateId: "open-division-v2",
    seed: "cup-final",
    allowSeedFallback: false,
  }), { templateId: "open-division-v2", seed: "cup-final" });
});

test("generation parameters reject missing, blank, oversized, and out-of-range values", () => {
  for (const value of [
    {},
    { templateId: " ", seed: "seed" },
    { templateId: "template", seed: "\t" },
    { templateId: "x".repeat(129), seed: "seed" },
    { templateId: "template", seed: "x".repeat(129) },
    { templateId: "template", seed: "seed", difficultyLevel: 0 },
    { templateId: "template", seed: "seed", difficultyLevel: 13 },
    { templateId: "template", seed: "seed", difficultyLevel: 1.5 },
    { templateId: "template", seed: "seed", difficultyLevel: "1" },
    { templateId: "template", seed: "seed", allowSeedFallback: "true" },
  ]) {
    assert.throws(() => normalizeGenerationParameters(value));
  }
});

test("GET query parsing converts supported values and ignores unrelated parameters", () => {
  assert.deepEqual(parseGenerationQuery(new URL(
    "https://example.test/v1/puzzles/generate?templateId=open-division-v2&seed=cup-final&difficultyLevel=7&allowSeedFallback=true&ignored=anything",
  )), {
    templateId: "open-division-v2",
    seed: "cup-final",
    difficultyLevel: 7,
    allowSeedFallback: true,
  });
  assert.deepEqual(parseGenerationQuery(new URL(
    "https://example.test/v1/puzzles/generate?templateId=open-division-v2&seed=cup-final&allowSeedFallback=false",
  )), { templateId: "open-division-v2", seed: "cup-final" });
});

test("GET query parsing rejects malformed difficulty and fallback values", () => {
  for (const query of [
    "templateId=template&seed=seed&difficultyLevel=1x",
    "templateId=template&seed=seed&difficultyLevel=0",
    "templateId=template&seed=seed&allowSeedFallback=yes",
  ]) {
    assert.throws(() => parseGenerationQuery(new URL(`https://example.test/v1/puzzles/generate?${query}`)));
  }
});
