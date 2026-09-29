import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { exhaustivePuzzleSolver } from "../src/constraints/solver.js";
import { generatePuzzle } from "../src/generation/generator.js";
import { tournamentOrderTemplate } from "../src/templates/tournament-order.js";
import {
  applyJevAnswers,
  applyJevPuzzleAnswers,
  aggregateSemanticCalibrationEvidence,
  assertCheckpointConfiguration,
  buildClueDecisionPayload,
  buildAuditMarkdown,
  buildPuzzleDecisionPayload,
  JEV_REVIEW_THRESHOLDS,
  markClueUnavailable,
  parseAuditArguments,
  puzzleReviewFlagReasons,
  readJevAnswerMap,
  readJevDecisionResponse,
  readAuditCheckpoint,
  requestJevDecisionBatch,
  SEMANTIC_ASSESSMENT_SCHEMA_VERSION,
  writeAuditCheckpoint,
  type AuditCheckpoint,
  type AuditedClue,
  type AuditedPuzzle,
  type JevAuditReport,
  type JevRunConfiguration,
} from "../scripts/audit-jev-support.js";

const clue = (): AuditedClue => ({
  templateId: "test-template",
  seed: "seed-1",
  clueId: "distance-weight-tatami-0-1",
  text: "The positions of the -60 kg competitor and the competitor on Tatami 1 differed by exactly one.",
  expectedSemantics: "-60 kg and Tatami 1 differ in position by exactly 1.",
  constraintKind: "distance",
  structuredSemantics: { kind: "distance", left: { category: "weight", value: "-60 kg" }, right: { category: "tatami", value: "Tatami 1" }, distance: 1 },
  logicalDifficultyLevel: 3,
  difficultyModelVersion: "yokaiba-difficulty-v4",
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
  semanticAssessmentSchemaVersion: SEMANTIC_ASSESSMENT_SCHEMA_VERSION,
  puzzleReview: false,
  reviewThresholds: JEV_REVIEW_THRESHOLDS,
};

const puzzle = (): AuditedPuzzle => ({
  templateId: "test-template",
  templateTitle: "Test Order",
  seed: "seed-1",
  logicalDifficultyLevel: 3,
  difficultyModelVersion: "yokaiba-difficulty-v4",
  clues: [{ clueId: clue().clueId, text: clue().text, expectedSemantics: clue().expectedSemantics, constraintKind: "distance", structuredSemantics: clue().structuredSemantics }],
  flagReasons: [],
  evaluationStatus: "pending",
  missingAnswers: [],
});

test("audit arguments support shared and independent sample sizes and explicit resume paths", () => {
  assert.deepEqual(parseAuditArguments(["--samples", "10"]), {
    difficultySamples: 10,
    clueSamples: 10,
    batchSize: 20,
    outputBase: undefined,
    resume: false,
    puzzleReview: false,
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
    puzzleReview: false,
  });
  assert.equal(parseAuditArguments(["--puzzle-review"]).puzzleReview, true);
  assert.throws(() => parseAuditArguments(["--resume"]), /--resume requires --out/);
  assert.throws(() => parseAuditArguments(["--clue-samples", "0"]), /positive integer/);
});

test("JEV answers preserve confidence and report incomplete metrics without inventing flags", () => {
  const partial = applyJevAnswers(clue(), {
    "0_faithful": { noul: 0.4, confidence: 0.91 },
  }, 0, "2026-09-29T00:00:00.000Z");

  assert.equal(partial.evaluationStatus, "incomplete");
  assert.deepEqual(partial.missingAnswers, ["ambiguous", "readability", "linguisticComplexity", "relationshipExplicitness"]);
  assert.equal(partial.faithfulConfidence, 0.91);
  assert.equal(partial.flagged, true);
  assert.deepEqual(partial.flagReasons, ["faithfulness below 0.50"]);
});

test("complete JEV answers are explicitly marked complete and retain each metric confidence", () => {
  const complete = applyJevAnswers(clue(), {
    "0_faithful": { noul: 0.95, confidence: 0.88 },
    "0_ambiguous": { noul: 0.1, confidence: 0.79 },
    "0_readability": { score: 1.8, confidence: 0.72 },
    "0_linguisticComplexity": { score: 0.4, confidence: 0.81 },
    "0_relationshipExplicitness": { score: 1.9, confidence: 0.92 },
  }, 0, "2026-09-29T00:00:00.000Z");

  assert.equal(complete.evaluationStatus, "complete");
  assert.deepEqual(complete.missingAnswers, []);
  assert.equal(complete.faithfulConfidence, 0.88);
  assert.equal(complete.ambiguousConfidence, 0.79);
  assert.equal(complete.readabilityConfidence, 0.72);
  assert.equal(complete.linguisticComplexity, 0.4);
  assert.equal(complete.linguisticComplexityConfidence, 0.81);
  assert.equal(complete.relationshipExplicitness, 1.9);
  assert.equal(complete.relationshipExplicitnessConfidence, 0.92);
  assert.equal(complete.flagged, false);
});

test("JEV answer values outside their expected ranges are incomplete rather than flags", () => {
  const invalid = applyJevAnswers(clue(), {
    "0_faithful": { noul: 1.2 },
    "0_ambiguous": { noul: -0.1 },
    "0_readability": { score: 3 },
    "0_linguisticComplexity": { score: Number.NaN },
    "0_relationshipExplicitness": { score: Number.POSITIVE_INFINITY },
  }, 0, "2026-09-29T00:00:00.000Z");

  assert.equal(invalid.evaluationStatus, "incomplete");
  assert.deepEqual(invalid.missingAnswers, ["faithful", "ambiguous", "readability", "linguisticComplexity", "relationshipExplicitness"]);
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
      totalInputTokens: 10, totalOutputTokens: 20, status: "partial",
      flaggedClues: [partial], incompleteClues: [partial], unavailableClues: [], clues: [partial],
    },
    semanticCalibrationEvidence: [{
      templateId: "test-template", seed: "seed-1", logicalDifficultyLevel: 3, difficultyModelVersion: "yokaiba-difficulty-v4",
      semanticAssessment: { readability: 1.8, ambiguity: 0.1, linguisticComplexity: 0.4, relationshipExplicitness: 1.9, evaluatedClues: 1, totalClues: 1 },
    }],
    puzzleAudit: { enabled: false, sampledPuzzles: 0, completePuzzles: 0, incompletePuzzles: 0, unavailablePuzzles: 0, flaggedPuzzles: [], puzzles: [] },
  };

  const markdown = buildAuditMarkdown(report);
  assert.match(markdown, /Targeted difficulty audit/);
  assert.match(markdown, /Fallback/);
  assert.match(markdown, /maximum attempt 3/);
  assert.match(markdown, /Incomplete JEV evaluations/);
  assert.match(markdown, /faithful, readability/);
  assert.match(markdown, /confidence/i);
  assert.match(markdown, /Semantic and logical calibration evidence/);
  assert.match(markdown, /yokaiba-difficulty-v4/);
  assert.match(markdown, /probabilistic JEV assessments/);
});

test("audit checkpoints round-trip atomically and reject mismatched run settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-audit-test-"));
  const checkpointPath = join(directory, "audit.checkpoint.json");
  const checkpoint: AuditCheckpoint = {
    version: 2,
    startedAt: "2026-09-29T00:00:00.000Z",
    configuration,
    difficultyAudit: [],
    targetedDifficultyAudit: [],
    clues: [clue()],
    puzzles: [puzzle()],
    totalCost: 0,
    resolvedModel: "test-model",
    totalInputTokens: 0,
    totalOutputTokens: 0,
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

test("clue decision batches ask bounded semantic questions against structured semantics only", () => {
  const payload = buildClueDecisionPayload("test-model", [clue()]);
  assert.equal(payload.model, "test-model");
  assert.equal(Object.keys(payload.questions).length, 5);
  assert.deepEqual(Object.keys(payload.state), ["clues"]);
  const state = (payload.state.clues as Array<Record<string, unknown>>)[0]!;
  assert.equal(state.constraintKind, "distance");
  assert.deepEqual(state.structuredSemantics, clue().structuredSemantics);
  assert.equal("solution" in payload.state, false);
  assert.equal((payload.questions["0_linguisticComplexity"] as { type: string }).type, "score");
  assert.equal((payload.questions["0_ambiguous"] as { type: string }).type, "noul");
  assert.equal(typeof JEV_REVIEW_THRESHOLDS.linguisticComplexityAbove, "number");
});

test("optional puzzle review records language-versus-logic evidence without replacing logical level", () => {
  const assessed = applyJevPuzzleAnswers(puzzle(), {
    "0_wordingRepetition": { noul: 0.7, confidence: 0.8 },
    "0_terminologyInconsistency": { noul: 0.1 },
    "0_phrasingVariety": { score: 1.4 },
    "0_linguisticDifficultyComparedToLogical": { score: 1.8, confidence: 0.9 },
  }, 0, "2026-09-29T00:00:00.000Z");
  const payload = buildPuzzleDecisionPayload("test-model", [puzzle()]);
  assert.equal(Object.keys(payload.questions).length, 4);
  assert.equal(assessed.evaluationStatus, "complete");
  assert.equal(assessed.logicalDifficultyLevel, 3);
  assert.equal(assessed.linguisticDifficultyComparedToLogical, 1.8);
  assert.equal(assessed.linguisticDifficultyComparedToLogicalConfidence, 0.9);
  assert.deepEqual(puzzleReviewFlagReasons(assessed), [
    "wording repetition above 0.60",
    "linguistic difficulty substantially above logical level (1.50)",
  ]);
  const assessedClue = applyJevAnswers(clue(), {
    "0_faithful": { noul: 1 },
    "0_ambiguous": { noul: 0 },
    "0_readability": { score: 2 },
    "0_linguisticComplexity": { score: 0.4 },
    "0_relationshipExplicitness": { score: 1.8 },
  }, 0);
  const evidence = aggregateSemanticCalibrationEvidence([assessedClue], [assessed]);
  assert.equal(evidence[0]?.logicalDifficultyLevel, 3);
  assert.equal(evidence[0]?.semanticAssessment.readability, 2);
  assert.equal(evidence[0]?.puzzleReview?.linguisticDifficultyComparedToLogical, 1.8);
});

test("provider failure marks the semantic assessment unavailable without changing deterministic evidence", async () => {
  const original = clue();
  const unavailable = markClueUnavailable(original);
  await assert.rejects(
    requestJevDecisionBatch(
      "test-secret",
      buildClueDecisionPayload("test-model", [original]),
      "https://example.test/decisions",
      async () => new Response("offline", { status: 503 }),
    ),
    /JEV request failed \(503\)/,
  );
  assert.equal(unavailable.evaluationStatus, "unavailable");
  assert.equal(unavailable.logicalDifficultyLevel, original.logicalDifficultyLevel);
  assert.equal(unavailable.difficultyModelVersion, original.difficultyModelVersion);
  assert.deepEqual(unavailable.structuredSemantics, original.structuredSemantics);
  assert.equal("solution" in unavailable, false);
});

test("semantic review cannot alter deterministic difficulty or solver uniqueness", () => {
  const before = generatePuzzle(tournamentOrderTemplate, "semantic-review-independence");
  const sourceClue = before.clues[0]!;
  const auditClue: AuditedClue = {
    ...clue(),
    text: sourceClue.text,
    clueId: sourceClue.id,
    constraintKind: sourceClue.constraint.kind,
    structuredSemantics: sourceClue.constraint,
    logicalDifficultyLevel: before.difficulty.level,
    difficultyModelVersion: before.difficulty.modelVersion,
  };
  const semantic = applyJevAnswers(auditClue, {
    "0_faithful": { noul: 0.9 },
    "0_ambiguous": { noul: 0.9 },
    "0_readability": { score: 0.5 },
    "0_linguisticComplexity": { score: 1.9 },
    "0_relationshipExplicitness": { score: 0.2 },
  }, 0);
  const after = generatePuzzle(tournamentOrderTemplate, "semantic-review-independence");
  assert.equal(semantic.flagged, true);
  assert.equal(semantic.logicalDifficultyLevel, before.difficulty.level);
  assert.deepEqual(after.difficulty, before.difficulty);
  assert.equal(exhaustivePuzzleSolver.countSolutions(before.spec, before.clues, 2), 1);
  assert.equal(exhaustivePuzzleSolver.countSolutions(after.spec, after.clues, 2), 1);
});

test("decision metadata preserves the resolved model and valid usage while ignoring malformed fields", () => {
  assert.deepEqual(readJevDecisionResponse({
    model: "resolved-model-v2",
    answers: { "0_readability": { score: 1.4 } },
    usage: { cost: 0.012, input_tokens: 120, output_tokens: 30 },
  }), {
    model: "resolved-model-v2",
    answers: { "0_readability": { score: 1.4 } },
    usage: { cost: 0.012, inputTokens: 120, outputTokens: 30 },
  });
  assert.deepEqual(readJevDecisionResponse({ model: 3, answers: "broken", usage: { cost: -1, input_tokens: Number.NaN } }), {
    answers: {},
    usage: {},
  });
});
