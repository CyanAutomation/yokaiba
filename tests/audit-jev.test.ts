import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  applyJevAnswers,
  assertCheckpointConfiguration,
  buildAuditMarkdown,
  parseAuditArguments,
  readJevAnswerMap,
  readAuditCheckpoint,
  writeAuditCheckpoint,
  type AuditCheckpoint,
  type AuditedClue,
  type JevAuditReport,
  type JevRunConfiguration,
} from "../scripts/audit-jev-support.js";

const clue = (): AuditedClue => ({
  templateId: "test-template",
  seed: "seed-1",
  clueId: "distance-weight-tatami-0-1",
  text: "The positions of the -60 kg competitor and the competitor on Tatami 1 differed by exactly one.",
  expectedSemantics: "-60 kg and Tatami 1 differ in position by exactly 1.",
  flagged: false,
  flagReasons: [],
  missingAnswers: [],
  evaluationStatus: "pending",
});

const configuration: JevRunConfiguration = {
  difficultySamples: 2,
  clueSamples: 3,
  batchSize: 20,
  endpoint: "https://example.test/decisions",
  requestedModel: "test-model",
};

test("audit arguments support shared and independent sample sizes and explicit resume paths", () => {
  assert.deepEqual(parseAuditArguments(["--samples", "10"]), {
    difficultySamples: 10,
    clueSamples: 10,
    batchSize: 20,
    outputBase: undefined,
    resume: false,
  });
  assert.deepEqual(parseAuditArguments([
    "--samples", "10", "--difficulty-samples", "3", "--clue-samples", "7",
    "--batch-size", "5", "--out", "reports/run", "--resume",
  ]), {
    difficultySamples: 3,
    clueSamples: 7,
    batchSize: 5,
    outputBase: "reports/run",
    resume: true,
  });
  assert.throws(() => parseAuditArguments(["--resume"]), /--resume requires --out/);
  assert.throws(() => parseAuditArguments(["--clue-samples", "0"]), /positive integer/);
});

test("JEV answers preserve confidence and report incomplete metrics without inventing flags", () => {
  const partial = applyJevAnswers(clue(), {
    "0_faithful": { noul: 0.4, confidence: 0.91 },
  }, 0, "2026-09-29T00:00:00.000Z");

  assert.equal(partial.evaluationStatus, "incomplete");
  assert.deepEqual(partial.missingAnswers, ["ambiguous", "readability"]);
  assert.equal(partial.faithfulConfidence, 0.91);
  assert.equal(partial.flagged, true);
  assert.deepEqual(partial.flagReasons, ["faithfulness below 0.50"]);
});

test("complete JEV answers are explicitly marked complete and retain each metric confidence", () => {
  const complete = applyJevAnswers(clue(), {
    "0_faithful": { noul: 0.95, confidence: 0.88 },
    "0_ambiguous": { noul: 0.1, confidence: 0.79 },
    "0_readability": { score: 1.8, confidence: 0.72 },
  }, 0, "2026-09-29T00:00:00.000Z");

  assert.equal(complete.evaluationStatus, "complete");
  assert.deepEqual(complete.missingAnswers, []);
  assert.equal(complete.faithfulConfidence, 0.88);
  assert.equal(complete.ambiguousConfidence, 0.79);
  assert.equal(complete.readabilityConfidence, 0.72);
  assert.equal(complete.flagged, false);
});

test("JEV answer values outside their expected ranges are incomplete rather than flags", () => {
  const invalid = applyJevAnswers(clue(), {
    "0_faithful": { noul: 1.2 },
    "0_ambiguous": { noul: -0.1 },
    "0_readability": { score: 3 },
  }, 0, "2026-09-29T00:00:00.000Z");

  assert.equal(invalid.evaluationStatus, "incomplete");
  assert.deepEqual(invalid.missingAnswers, ["faithful", "ambiguous", "readability"]);
  assert.equal(invalid.flagged, false);
  assert.deepEqual(invalid.flagReasons, []);
});

test("missing or malformed answer maps are treated as empty so the batch can be reported incomplete", () => {
  assert.deepEqual(readJevAnswerMap(undefined), {});
  assert.deepEqual(readJevAnswerMap(null), {});
  assert.deepEqual(readJevAnswerMap(["not", "an", "answer", "map"]), {});
});

test("audit Markdown reports targeted delivery, fallbacks, confidence, and incomplete evaluations", () => {
  const partial = applyJevAnswers(clue(), { "0_ambiguous": { noul: 0.8, confidence: 0.7 } }, 0);
  const report: JevAuditReport = {
    startedAt: "2026-09-29T00:00:00.000Z",
    generatedAt: "2026-09-29T00:01:00.000Z",
    configuration: { ...configuration, resolvedModel: "test-model" },
    difficultyAudit: [{
      templateId: "test-template", modelVersion: "difficulty-v1", sampleSize: 1, seedPrefix: "seed",
      levelCounts: [1, ...Array<number>(11).fill(0)], humanTrace: { complete: 1, incomplete: 0 },
      clues: { average: 4, minimum: 4, maximum: 4 },
    }],
    targetedDifficultyAudit: [{
      templateId: "test-template", modelVersion: "difficulty-v1", sampleSize: 1, seedPrefix: "seed",
      levels: [{
        requestedDifficultyLevel: 1, generated: 1, assessedLevelCounts: [1, ...Array<number>(11).fill(0)],
        humanTrace: { complete: 1, incomplete: 0 }, fallback: { used: 1, maximumAttempt: 3 },
        clues: { average: 4, minimum: 4, maximum: 4 },
      }],
    }],
    clueAudit: {
      model: "test-model", sampledClues: 1, totalCost: 0.01,
      flaggedClues: [partial], incompleteClues: [partial], clues: [partial],
    },
  };

  const markdown = buildAuditMarkdown(report);
  assert.match(markdown, /Targeted difficulty audit/);
  assert.match(markdown, /Fallback/);
  assert.match(markdown, /maximum attempt 3/);
  assert.match(markdown, /Incomplete JEV evaluations/);
  assert.match(markdown, /faithful, readability/);
  assert.match(markdown, /confidence/i);
});

test("audit checkpoints round-trip atomically and reject mismatched run settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-audit-test-"));
  const checkpointPath = join(directory, "audit.checkpoint.json");
  const checkpoint: AuditCheckpoint = {
    version: 1,
    startedAt: "2026-09-29T00:00:00.000Z",
    configuration,
    difficultyAudit: [],
    targetedDifficultyAudit: [],
    clues: [clue()],
    totalCost: 0,
    resolvedModel: "test-model",
  };
  try {
    await writeAuditCheckpoint(checkpointPath, checkpoint);
    assert.deepEqual(await readAuditCheckpoint(checkpointPath), checkpoint);
    assert.doesNotThrow(() => assertCheckpointConfiguration(checkpoint.configuration, configuration));
    assert.throws(() => assertCheckpointConfiguration(checkpoint.configuration, { ...configuration, clueSamples: 4 }), /does not match/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
