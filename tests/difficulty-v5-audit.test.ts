import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDifficultyV5AuditMarkdown,
  clueMetadata,
  parseDifficultyV5AuditArguments,
  summarizeDifficultyV5Template,
  summarizeNumbers,
  type DifficultyV5AuditSample,
  type DifficultyV5TargetSample,
} from "../scripts/audit-difficulty-v5-support.js";
import { generatePuzzle } from "../src/generation/generator.js";
import { tournamentOrderV2Template } from "../src/templates/tournament-order-v2.js";

test("v5 audit arguments accept independent paired and targeted sample counts", () => {
  assert.deepEqual(parseDifficultyV5AuditArguments([]), { samples: 25, targetSamples: 25, outputBase: undefined });
  assert.deepEqual(parseDifficultyV5AuditArguments(["--samples", "100", "--target-samples", "7", "--out", "reports/run"]), {
    samples: 100, targetSamples: 7, outputBase: "reports/run",
  });
  for (const args of [["--samples", "0"], ["--target-samples", "-1"], ["--out", "reports/run.json"], ["--unknown"]]) {
    assert.throws(() => parseDifficultyV5AuditArguments(args));
  }
});

test("v5 audit summaries retain paired disagreement, target availability, and outlier seeds", () => {
  const sample = (seed: string, legacyLevel: number, v5Level: number, score: number, status: string): DifficultyV5AuditSample => ({
    templateId: tournamentOrderV2Template.id,
    seed,
    legacy: { modelVersion: "yokaiba-difficulty-v4", level: legacyLevel as 1 | 2 | 3 | 4, score: legacyLevel * 10 },
    v5: {
      modelVersion: "yokaiba-difficulty-v5", level: v5Level as 1 | 2 | 3 | 4, score, status,
      stepCount: 12, maximumDependencyDepth: 3, meanDependencyDepth: 1.5,
      crossCategorySteps: 4, workingMemoryMean: 3.25, elapsedMs: 5,
    },
    clueMetadata: [{ clueId: "same-row-color-pet-0", kind: "sameRow", categories: ["color", "pet"] }],
  });
  const targeted = new Map<1, DifficultyV5TargetSample[]>([[1, [
    { seed: "target-1", status: "selected" as const, elapsedMs: 12, score: 15, level: 1 as const, traceStatus: "solved", candidateAttempts: 12 },
    { seed: "target-2", status: "unavailable" as const, elapsedMs: 11, candidateAttempts: 12, observedLevels: [2 as const], error: "unavailable" },
  ]]]);
  const summary = summarizeDifficultyV5Template(tournamentOrderV2Template, [
    sample("paired-1", 2, 1, 15, "complete"),
    sample("paired-2", 4, 3, 41, "stalled"),
  ], targeted);

  assert.deepEqual(summary.comparison, { v5Higher: 0, equal: 0, v5Lower: 2, meanAbsoluteLevelDifference: 1 });
  assert.deepEqual(summary.completion, { complete: 1, incomplete: 1, contradiction: 0 });
  assert.equal(summary.targeted[0]?.availabilityRate, 0.5);
  assert.deepEqual(summary.outlierSeeds, ["paired-2"]);
  assert.deepEqual(summarizeNumbers([1, 2, 3, 4]), { count: 4, minimum: 1, p50: 2, p95: 4, maximum: 4, mean: 2.5 });

  const markdown = buildDifficultyV5AuditMarkdown({
    generatedAt: "2026-10-18T00:00:00.000Z",
    configuration: { samples: 2, targetSamples: 2, seedPrefix: "audit-seed" },
    templates: [summary],
  });
  assert.match(markdown, /same v4-generated clue set/);
  assert.match(markdown, /paired-2/);
  assert.match(markdown, /50\.0%/);
});

test("v5 audit clue metadata contains only clue identity, relation, and categories", () => {
  const puzzle = generatePuzzle(tournamentOrderV2Template, "audit-clue-metadata");
  const metadata = clueMetadata(puzzle);

  assert.equal(metadata.length, puzzle.clues.length);
  for (const [index, clue] of puzzle.clues.entries()) {
    const expectedCategories = "category" in clue.constraint
      ? [clue.constraint.category]
      : [clue.constraint.left.category, clue.constraint.right.category];
    assert.deepEqual(metadata[index], {
      clueId: clue.id,
      kind: clue.constraint.kind,
      categories: [...new Set(expectedCategories)].sort(),
    });
    assert.deepEqual(Object.keys(metadata[index]!).sort(), ["categories", "clueId", "kind"]);
  }
});
