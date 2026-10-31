import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { exhaustivePuzzleSolver } from "../src/constraints/solver.js";
import { generatePuzzle } from "../src/generation/generator.js";
import { tournamentOrderTemplate } from "../src/templates/tournament-order.js";
import { tournamentOrderV2Template } from "../src/templates/tournament-order-v2.js";
import type { ClueConstraint, Difficulty, PuzzleTemplate } from "../src/index.js";
import { parseAuditArguments } from "../scripts/audit-jev-arguments.js";
import {
  applyJevAnswers,
  applyJevPuzzleAnswers,
  aggregateSemanticCalibrationEvidence,
  aggregateSemanticPuzzleEvidence,
  accumulateResponseUsage,
  auditProgressMessage,
  assertCheckpointConfiguration,
  checkpointTargetedDifficultyLevels,
  buildClueDecisionPayload,
  buildLatestClueDecisionPayload,
  buildAuditMarkdown,
  buildPuzzleDecisionPayload,
  buildLatestPuzzleDecisionPayload,
  describeConstraint,
  JEV_REVIEW_THRESHOLDS,
  JEV_REQUESTED_MODEL,
  markClueUnavailable,
  puzzleReviewFlagReasons,
  rebuildPuzzleReviewCorpus,
  readJevAnswerMap,
  readJevDecisionResponse,
  readAuditCheckpoint,
  readJevAuditReport,
  removeCompletedAuditCheckpoint,
  requestJevDecisionBatch,
  SEMANTIC_ASSESSMENT_SCHEMA_VERSION,
  JEV_AUDIT_GENERATION_MODEL_VERSION,
  generateJevAuditPuzzle,
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
  uniqueWithoutClue: false,
  humanTraceCompleteWithoutClue: false,
  logicalContribution: "uniqueness-critical",
  flagged: false,
  flagReasons: [],
  missingAnswers: [],
  evaluationStatus: "pending",
});

// Semantic-review contract: docs/difficulty-and-calibration.md#logical-semantic-and-observed-difficulty.
test("JEV review payload semantics describe every supported clue relation", () => {
  const term = { category: "weight", value: "-60 kg" };
  const other = { category: "tatami", value: "Tatami 1" };
  const cases: Array<[ClueConstraint, string]> = [
    [{ kind: "matches", subject: "Aya", category: "weight", value: "-60 kg" }, "Aya is associated with -60 kg in weight."],
    [{ kind: "notMatches", subject: "Aya", category: "weight", value: "-60 kg" }, "Aya is not associated with -60 kg in weight."],
    [{ kind: "sameRow", left: term, right: other }, "-60 kg in weight belongs to the same competitor as Tatami 1 in tatami."],
    [{ kind: "before", left: term, right: other }, "-60 kg in weight is earlier than Tatami 1 in tatami."],
    [{ kind: "adjacent", left: term, right: other }, "-60 kg in weight is immediately next to Tatami 1 in tatami."],
    [{ kind: "distance", left: term, right: other, distance: 2 }, "The positions of -60 kg in weight and Tatami 1 in tatami differ by exactly 2."],
  ];
  for (const [constraint, expected] of cases) assert.equal(describeConstraint(constraint), expected);
});

test("audit progress includes phase context at the first, periodic, and final milestones", () => {
  const first = auditProgressMessage({ phase: "difficulty", templateId: "open-division", completed: 1, total: 20 });
  assert.ok(first);
  assert.match(first, /difficulty/);
  assert.match(first, /open-division/);
  assert.match(first, /1\/20/);

  const periodic = auditProgressMessage({ phase: "targeted", templateId: "open-division", requestedDifficultyLevel: 7, completed: 10, total: 20 });
  assert.ok(periodic);
  assert.match(periodic, /targeted/);
  assert.match(periodic, /open-division/);
  assert.match(periodic, /level 7/);
  assert.match(periodic, /10\/20/);

  assert.equal(auditProgressMessage({ phase: "difficulty", templateId: "open-division", completed: 3, total: 20 }), undefined);

  const final = auditProgressMessage({ phase: "difficulty", templateId: "open-division", completed: 20, total: 20 });
  assert.ok(final);
  assert.match(final, /20\/20/);
});

test("JEV clue samples use the API's latest default difficulty model", () => {
  const generated = generateJevAuditPuzzle(tournamentOrderV2Template, "jev-audit-latest-model");
  assert.equal(JEV_AUDIT_GENERATION_MODEL_VERSION, "yokaiba-difficulty-v5");
  assert.equal(generated.difficulty.modelVersion, JEV_AUDIT_GENERATION_MODEL_VERSION);
});

test("clue and puzzle review payloads use the stable latest model alias", () => {
  const cluePayload = buildLatestClueDecisionPayload([clue()]);
  const puzzlePayload = buildLatestPuzzleDecisionPayload([{
    templateId: "test-template",
    templateTitle: "Test template",
    seed: "seed-1",
    logicalDifficultyLevel: 3,
    difficultyModelVersion: "yokaiba-difficulty-v5",
    clues: [{
      clueId: "distance-weight-tatami-0-1",
      text: "The positions of the -60 kg competitor and the competitor on Tatami 1 differed by exactly one.",
      expectedSemantics: "-60 kg and Tatami 1 differ in position by exactly 1.",
      constraintKind: "distance",
      structuredSemantics: { kind: "distance", left: { category: "weight", value: "-60 kg" }, right: { category: "tatami", value: "Tatami 1" }, distance: 1 },
    }],
    flagReasons: [],
    evaluationStatus: "pending",
    missingAnswers: [],
  }]);

  assert.equal(cluePayload.model, "~typesafe/jev-latest");
  assert.equal(puzzlePayload.model, "~typesafe/jev-latest");
  assert.equal(JEV_REQUESTED_MODEL, cluePayload.model);
});

test("audit usage aggregation adds provider totals and preserves missing values", () => {
  const checkpoint = {
    resolvedModel: "previous-model",
    resolvedModelsByPhase: {
      clue: { models: ["clue-model"], attribution: "phase-specific" as const },
      puzzle: { models: [], attribution: "phase-specific" as const },
    },
    totalCost: 1,
    totalInputTokens: 2,
    totalOutputTokens: 3,
  };
  accumulateResponseUsage(checkpoint, {
    model: "puzzle-model",
    answers: {},
    usage: { cost: 0.5, inputTokens: 4, outputTokens: 6 },
  }, "puzzle");
  accumulateResponseUsage(checkpoint, { model: "clue-model", answers: {}, usage: {} }, "clue");
  assert.deepEqual(checkpoint, {
    resolvedModel: "clue-model",
    resolvedModelsByPhase: {
      clue: { models: ["clue-model"], attribution: "phase-specific" },
      puzzle: { models: ["puzzle-model"], attribution: "phase-specific" },
    },
    totalCost: 1.5,
    totalInputTokens: 6,
    totalOutputTokens: 9,
  });
});

const configuration: JevRunConfiguration = {
  difficultySamples: 2,
  clueSamples: 3,
  batchSize: 20,
  endpoint: "https://example.test/decisions",
  requestedModel: "test-model",
  semanticAssessmentSchemaVersion: SEMANTIC_ASSESSMENT_SCHEMA_VERSION,
  generationModelVersion: JEV_AUDIT_GENERATION_MODEL_VERSION,
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
    puzzleReviewFrom: undefined,
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
    puzzleReviewFrom: undefined,
    resume: true,
    puzzleReview: false,
  });
  assert.equal(parseAuditArguments(["--puzzle-review"]).puzzleReview, true);
  assert.equal(parseAuditArguments(["--puzzle-review-from", "reports/previous.json"]).puzzleReview, true);
  assert.throws(() => parseAuditArguments(["--resume", "--out", "reports/run", "--puzzle-review-from", "reports/previous.json"]), /cannot be combined/);
  assert.equal(parseAuditArguments(["--puzzle-review-from", "reports/previous.json"]).puzzleReviewFrom, "reports/previous.json");
  assert.throws(() => parseAuditArguments(["--resume"]), /--resume requires --out/);
  assert.throws(() => parseAuditArguments(["--clue-samples", "0"]), /positive integer/);
});

test("audit arguments reject unknown, positional, missing, and malformed options", () => {
  for (const args of [
    ["unexpected"],
    ["--unknown", "value"],
    ["--samples"],
    ["--out", "--resume"],
    ["--batch-size", "1.5"],
    ["--difficulty-samples", "-1"],
    ["--puzzle-review-from"],
  ]) {
    assert.throws(() => parseAuditArguments(args));
  }
});

test("JEV decision requests send the structured payload and normalize the provider response", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const result = await requestJevDecisionBatch(
    "test-secret",
    buildClueDecisionPayload("test-model", [clue()]),
    "https://example.test/decisions",
    async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(JSON.stringify({
        model: "resolved-model",
        answers: { "0_readability": { score: 1.8 } },
        usage: { prompt_tokens: 14, completion_tokens: 6 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  );

  assert.equal(capturedUrl, "https://example.test/decisions");
  assert.equal(capturedInit?.method, "POST");
  assert.equal(new Headers(capturedInit?.headers).get("authorization"), "Bearer test-secret");
  assert.equal(JSON.parse(String(capturedInit?.body)).model, "test-model");
  assert.deepEqual(result, {
    model: "resolved-model",
    answers: { "0_readability": { score: 1.8 } },
    usage: { inputTokens: 14, outputTokens: 6 },
  });
});

test("JEV decision requests retry transient provider failures but do not retry authentication failures", async () => {
  const payload = buildClueDecisionPayload("test-model", [clue()]);
  const sleeps: number[] = [];
  let transientAttempts = 0;
  const recovered = await requestJevDecisionBatch(
    "test-secret",
    payload,
    "https://example.test/decisions",
    async () => {
      transientAttempts += 1;
      if (transientAttempts === 1) return new Response("busy", { status: 503 });
      if (transientAttempts === 2) return new Response("rate limited", { status: 429 });
      return new Response(JSON.stringify({ answers: {} }), { status: 200 });
    },
    { maxRetries: 2, baseDelayMs: 10, sleep: async milliseconds => { sleeps.push(milliseconds); } },
  );
  assert.equal(transientAttempts, 3);
  assert.deepEqual(sleeps, [10, 20]);
  assert.deepEqual(recovered.answers, {});

  let networkAttempts = 0;
  await requestJevDecisionBatch(
    "test-secret",
    payload,
    "https://example.test/decisions",
    async () => {
      networkAttempts += 1;
      if (networkAttempts === 1) throw new TypeError("temporary network failure");
      return new Response(JSON.stringify({ answers: {} }), { status: 200 });
    },
    { maxRetries: 1, baseDelayMs: 0, sleep: async () => {} },
  );
  assert.equal(networkAttempts, 2);

  let authenticationAttempts = 0;
  await assert.rejects(requestJevDecisionBatch(
    "test-secret",
    payload,
    "https://example.test/decisions",
    async () => {
      authenticationAttempts += 1;
      return new Response("unauthorized", { status: 401 });
    },
    { maxRetries: 3, sleep: async () => {} },
  ), /JEV request failed \(401\)/);
  assert.equal(authenticationAttempts, 1);
});

test("JEV answers preserve confidence and report incomplete metrics without inventing flags", () => {
  const partial = applyJevAnswers(clue(), {
    "0_faithful": { noul: 0.4, confidence: 0.91 },
  }, 0, "2026-09-29T00:00:00.000Z");

  assert.equal(partial.evaluationStatus, "incomplete");
  assert.deepEqual(partial.missingAnswers, ["ambiguous", "readability", "linguisticComplexity", "relationshipExplicitness", "entityClarity", "misunderstandingRisk"]);
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
    "0_entityClarity": { score: 1.7, confidence: 0.9 },
    "0_misunderstandingRisk": { noul: 0.1, confidence: 0.87 },
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
  assert.equal(complete.entityClarity, 1.7);
  assert.equal(complete.entityClarityConfidence, 0.9);
  assert.equal(complete.misunderstandingRisk, 0.1);
  assert.equal(complete.misunderstandingRiskConfidence, 0.87);
  assert.equal(complete.flagged, false);
});

test("JEV answer values outside their expected ranges are incomplete rather than flags", () => {
  const invalid = applyJevAnswers(clue(), {
    "0_faithful": { noul: 1.2 },
    "0_ambiguous": { noul: -0.1 },
    "0_readability": { score: 3 },
    "0_linguisticComplexity": { score: Number.NaN },
    "0_relationshipExplicitness": { score: Number.POSITIVE_INFINITY },
    "0_entityClarity": { score: -0.5 },
    "0_misunderstandingRisk": { noul: 1.1 },
  }, 0, "2026-09-29T00:00:00.000Z");

  assert.equal(invalid.evaluationStatus, "incomplete");
  assert.deepEqual(invalid.missingAnswers, ["faithful", "ambiguous", "readability", "linguisticComplexity", "relationshipExplicitness", "entityClarity", "misunderstandingRisk"]);
  assert.equal(invalid.flagged, false);
  assert.deepEqual(invalid.flagReasons, []);
});

test("missing or malformed answer maps are treated as empty so the batch can be reported incomplete", () => {
  for (const rawAnswers of [undefined, null, ["not", "an", "answer", "map"]]) {
    const answers = readJevAnswerMap(rawAnswers);
    assert.deepEqual(answers, {});

    const evaluated = applyJevAnswers(clue(), answers, 0, "2026-09-29T00:00:00.000Z");
    assert.equal(evaluated.evaluationStatus, "incomplete");
    assert.deepEqual(evaluated.missingAnswers, ["faithful", "ambiguous", "readability", "linguisticComplexity", "relationshipExplicitness", "entityClarity", "misunderstandingRisk"]);
    assert.equal(evaluated.flagged, false);
  }
});

test("audit Markdown reports targeted delivery, fallbacks, confidence, and incomplete evaluations", () => {
  const partial = applyJevAnswers(clue(), { "0_ambiguous": { noul: 0.8, confidence: 0.7 } }, 0);
  const report: JevAuditReport = {
    startedAt: "2026-09-29T00:00:00.000Z",
    generatedAt: "2026-09-29T00:01:00.000Z",
    configuration: { ...configuration, resolvedModel: "test-model" },
    difficultyAudit: [{
      templateId: "test-template", modelVersion: "difficulty-v1", sampleSize: 1, generated: 1, unavailable: 0, seedPrefix: "seed",
      levelCounts: [1, ...Array<number>(11).fill(0)], humanTrace: { complete: 1, incomplete: 0 },
      clues: { average: 4, minimum: 4, maximum: 4 },
    }],
    productionDifficultyAudit: [{
      templateId: "test-template", modelVersion: "difficulty-v1", sampleSize: 1, generated: 0, unavailable: 1, seedPrefix: "seed",
      levelCounts: Array<number>(12).fill(0), humanTrace: { complete: 0, incomplete: 0 },
      clues: { average: 0, minimum: 0, maximum: 0 },
    }],
    targetedDifficultyAudit: [{
      templateId: "test-template", modelVersion: "difficulty-v1", sampleSize: 1, seedPrefix: "seed",
      levels: [{
        requestedDifficultyLevel: 1, generated: 1, assessedLevelCounts: [1, ...Array<number>(11).fill(0)],
        humanTrace: { complete: 1, incomplete: 0 }, fallback: { used: 1, maximumAttempt: 3, attempts: { p50: 3, p95: 3 } },
        clues: { average: 4, minimum: 4, maximum: 4 },
      }],
    }],
    clueAudit: {
      model: "test-model", models: ["test-model"], modelAttribution: "phase-specific", sampledClues: 1, totalCost: 0.01,
      totalInputTokens: 10, totalOutputTokens: 20, status: "partial",
      flaggedClues: [partial], incompleteClues: [partial], unavailableClues: [], clues: [partial],
    },
    semanticCalibrationEvidence: [{
      templateId: "test-template", seed: "seed-1", logicalDifficultyLevel: 3, difficultyModelVersion: "yokaiba-difficulty-v4",
      semanticAssessment: { readability: 1.8, ambiguity: 0.1, linguisticComplexity: 0.4, relationshipExplicitness: 1.9, evaluatedClues: 1, totalClues: 1 },
    }],
    puzzleAudit: { model: null, models: [], modelAttribution: "phase-specific", enabled: false, sampledPuzzles: 0, completePuzzles: 0, incompletePuzzles: 0, unavailablePuzzles: 0, flaggedPuzzles: [], puzzles: [] },
  };

  const markdown = buildAuditMarkdown(report);
  assert.match(markdown, /Targeted difficulty audit/);
  assert.match(markdown, /JEV clue-review model: test-model/);
  assert.match(markdown, /JEV puzzle-review model: not returned/);
  assert.match(markdown, /Puzzle generation model: yokaiba-difficulty-v5/);
  assert.match(markdown, /Logical clue contribution by removal/);
  assert.match(markdown, /Ablation was measured for 1\/1 sampled clues/);
  assert.match(markdown, /Raw generation distribution/);
  assert.match(markdown, /Progressive delivery distribution/);
  assert.match(markdown, /1\/1 \| 0\/1 \| 1\/1/);
  assert.match(markdown, /Fallback/);
  assert.match(markdown, /p50 3, p95 3, max 3/);
  assert.match(markdown, /Incomplete JEV evaluations/);
  assert.match(markdown, /faithful, readability/);
  assert.match(markdown, /confidence/i);
  assert.match(markdown, /Semantic and logical calibration evidence/);
  assert.match(markdown, /yokaiba-difficulty-v4/);
  assert.match(markdown, /probabilistic JEV assessments/);
  assert.match(markdown, /Clue count/);
  const legacyReport: JevAuditReport = {
    ...report,
    targetedDifficultyAudit: report.targetedDifficultyAudit.map(template => ({
      ...template,
      levels: template.levels.map(level => ({
        ...level,
        fallback: { used: level.fallback.used, maximumAttempt: level.fallback.maximumAttempt },
      })),
    })),
  };
  assert.match(buildAuditMarkdown(legacyReport), /p50 n\/a, p95 n\/a, max 3/);
  const failedTargetReport: JevAuditReport = {
    ...report,
    targetedDifficultyAudit: report.targetedDifficultyAudit.map(template => ({
      ...template,
      levels: template.levels.map(level => ({
        ...level,
        generated: 0,
        unavailable: 1,
        assessedLevelCounts: Array<number>(12).fill(0),
        humanTrace: { complete: 0, incomplete: 0 },
        fallback: { used: 0, maximumAttempt: 0 },
        unavailableDiagnostics: {
          samplesWithDiagnostics: 1,
          strategiesAttempted: 36,
          eligibleCandidates: 0,
          fallbackSeedsAttempted: 3,
          candidateScoreRange: { minimum: 51, maximum: 92, complete: 21, incomplete: 3 },
          availableDifficultyCounts: [0, 1, 2, ...Array<number>(9).fill(0)],
        },
      })),
    })),
  };
  const failedTargetMarkdown = buildAuditMarkdown(failedTargetReport);
  assert.match(failedTargetMarkdown, /scores 51\.0–92\.0/);
  assert.match(failedTargetMarkdown, /alternate levels 2 \(1\), 3 \(2\)/);

  const unavailable = markClueUnavailable(clue());
  const unassessedReport: JevAuditReport = {
    ...report,
    clueAudit: {
      ...report.clueAudit,
      status: "unavailable",
      flaggedClues: [],
      incompleteClues: [],
      unavailableClues: [unavailable],
      clues: [unavailable],
    },
    puzzleAudit: {
      ...report.puzzleAudit,
      enabled: true,
      sampledPuzzles: 1,
      completePuzzles: 0,
      incompletePuzzles: 0,
      unavailablePuzzles: 1,
      flaggedPuzzles: [],
      puzzles: [{ ...puzzle(), evaluationStatus: "unavailable", missingAnswers: ["provider unavailable"] }],
    },
  };
  const unassessedMarkdown = buildAuditMarkdown(unassessedReport);
  assert.match(unassessedMarkdown, /No clue was fully assessed/);
  assert.match(unassessedMarkdown, /No puzzle was fully assessed/);
});

test("audit checkpoints round-trip, migrate older versions, and remove completed files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-audit-test-"));
  const checkpointPath = join(directory, "audit.checkpoint.json");
  const checkpoint: AuditCheckpoint = {
    version: 4,
    startedAt: "2026-09-29T00:00:00.000Z",
    configuration,
    difficultyAudit: [],
    productionDifficultyAudit: [],
    targetedDifficultyAudit: [{
      templateId: "test-template", modelVersion: JEV_AUDIT_GENERATION_MODEL_VERSION, sampleSize: 1, seedPrefix: "seed",
      levels: [{
        requestedDifficultyLevel: 1, generated: 1, assessedLevelCounts: [1, ...Array<number>(11).fill(0)],
        humanTrace: { complete: 1, incomplete: 0 }, fallback: { used: 0, maximumAttempt: 0, attempts: { p50: 0, p95: 0 } },
        clues: { average: 4, minimum: 4, maximum: 4 },
      }],
    }],
    clues: [{ ...clue(), difficultyModelVersion: JEV_AUDIT_GENERATION_MODEL_VERSION }],
    puzzles: [{ ...puzzle(), difficultyModelVersion: JEV_AUDIT_GENERATION_MODEL_VERSION }],
    totalCost: 0,
    resolvedModel: "test-model",
    resolvedModelsByPhase: {
      clue: { models: ["test-model"], attribution: "phase-specific" },
      puzzle: { models: [], attribution: "phase-specific" },
    },
    totalInputTokens: 0,
    totalOutputTokens: 0,
  };
  try {
    await writeAuditCheckpoint(checkpointPath, checkpoint);
    assert.deepEqual(await readAuditCheckpoint(checkpointPath), checkpoint);
    assert.doesNotThrow(() => assertCheckpointConfiguration(checkpoint.configuration, configuration));
    assert.throws(() => assertCheckpointConfiguration(checkpoint.configuration, { ...configuration, clueSamples: 4 }), /does not match/);
    assert.throws(() => assertCheckpointConfiguration(checkpoint.configuration, { ...configuration, generationModelVersion: "yokaiba-difficulty-v4" }), /does not match/);

    const priorV5Checkpoint = JSON.parse(JSON.stringify(checkpoint)) as Record<string, unknown>;
    delete (priorV5Checkpoint.configuration as Record<string, unknown>).generationModelVersion;
    delete priorV5Checkpoint.resolvedModelsByPhase;
    priorV5Checkpoint.version = 2;
    await writeFile(checkpointPath, `${JSON.stringify(priorV5Checkpoint)}\n`);
    const resumedPriorV5 = await readAuditCheckpoint(checkpointPath);
    assert.equal(resumedPriorV5?.configuration.generationModelVersion, JEV_AUDIT_GENERATION_MODEL_VERSION);
    assert.equal(resumedPriorV5?.resolvedModelsByPhase.clue.attribution, "legacy-aggregate");
    assert.deepEqual(resumedPriorV5?.resolvedModelsByPhase.clue.models, ["test-model"]);
    assert.doesNotThrow(() => assertCheckpointConfiguration(resumedPriorV5!.configuration, configuration));

    const legacyCheckpoint = JSON.parse(JSON.stringify(checkpoint)) as Record<string, unknown>;
    delete legacyCheckpoint.productionDifficultyAudit;
    delete legacyCheckpoint.resolvedModelsByPhase;
    legacyCheckpoint.version = 2;
    delete (legacyCheckpoint.configuration as Record<string, unknown>).generationModelVersion;
    legacyCheckpoint.clues = [{ ...clue(), difficultyModelVersion: "yokaiba-difficulty-v4" }];
    legacyCheckpoint.puzzles = [{ ...puzzle(), difficultyModelVersion: "yokaiba-difficulty-v4" }];
    legacyCheckpoint.targetedDifficultyAudit = (legacyCheckpoint.targetedDifficultyAudit as Array<Record<string, unknown>>)
      .map(target => ({ ...target, modelVersion: "yokaiba-difficulty-v4" }));
    legacyCheckpoint.difficultyAudit = [{
      templateId: "legacy-template",
      modelVersion: "yokaiba-difficulty-v4",
      sampleSize: 1,
      seedPrefix: "legacy-seed",
    }];
    const legacyTargets = legacyCheckpoint.targetedDifficultyAudit as Array<Record<string, unknown>>;
    for (const target of legacyTargets) {
      const levels = target.levels as Array<Record<string, unknown>>;
      for (const level of levels) {
        const fallback = level.fallback as Record<string, unknown>;
        delete fallback.attempts;
      }
    }
    await writeFile(checkpointPath, `${JSON.stringify(legacyCheckpoint)}\n`);
    const migrated = await readAuditCheckpoint(checkpointPath);
    assert.equal(migrated?.version, 4);
    assert.equal(migrated?.resolvedModelsByPhase.clue.attribution, "legacy-aggregate");
    assert.deepEqual(migrated?.productionDifficultyAudit, []);
    assert.deepEqual(migrated?.difficultyAudit, [{
      templateId: "legacy-template",
      modelVersion: "yokaiba-difficulty-v4",
      sampleSize: 1,
      generated: 1,
      unavailable: 0,
      seedPrefix: "legacy-seed",
    }]);
    assert.equal(migrated?.configuration.generationModelVersion, "yokaiba-difficulty-v4");
    assert.throws(() => assertCheckpointConfiguration(migrated!.configuration, configuration), /checkpoint yokaiba-difficulty-v4, current yokaiba-difficulty-v5; use a new output path/);

    const legacyPuzzleReviewCheckpoint = JSON.parse(JSON.stringify(checkpoint)) as Record<string, unknown>;
    delete legacyPuzzleReviewCheckpoint.resolvedModelsByPhase;
    (legacyPuzzleReviewCheckpoint.configuration as Record<string, unknown>).puzzleReview = true;
    (legacyPuzzleReviewCheckpoint.puzzles as Array<Record<string, unknown>>)[0]!.evaluationStatus = "complete";
    await writeFile(checkpointPath, `${JSON.stringify(legacyPuzzleReviewCheckpoint)}\n`);
    const migratedPuzzleReview = await readAuditCheckpoint(checkpointPath);
    assert.equal(migratedPuzzleReview?.resolvedModelsByPhase.clue.attribution, "legacy-aggregate");
    assert.equal(migratedPuzzleReview?.resolvedModelsByPhase.puzzle.attribution, "legacy-aggregate");
    assert.deepEqual(migratedPuzzleReview?.resolvedModelsByPhase.puzzle.models, ["test-model"]);

    await removeCompletedAuditCheckpoint(checkpointPath);
    await assert.rejects(readFile(checkpointPath), { code: "ENOENT" });
    await assert.doesNotReject(() => removeCompletedAuditCheckpoint(checkpointPath));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("targeted difficulty checkpoint resumes at the first unfinished level", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-level-checkpoint-test-"));
  const checkpointPath = join(directory, "audit.checkpoint.json");
  const checkpoint: AuditCheckpoint = {
    version: 4,
    startedAt: "2026-09-29T00:00:00.000Z",
    configuration,
    difficultyAudit: [],
    productionDifficultyAudit: [],
    targetedDifficultyAudit: [],
    clues: [],
    puzzles: [],
    totalCost: 0,
    resolvedModel: "test-model",
    resolvedModelsByPhase: {
      clue: { models: [], attribution: "phase-specific" },
      puzzle: { models: [], attribution: "phase-specific" },
    },
    totalInputTokens: 0,
    totalOutputTokens: 0,
  };
  const calls: number[] = [];
  let interruptAtLevelThree = true;
  const fakeAuditLevel = (_template: PuzzleTemplate, level: Difficulty["level"]) => {
    calls.push(level);
    if (interruptAtLevelThree && level === 3) throw new Error("simulated interruption");
    const levelCounts = Array<number>(12).fill(0);
    levelCounts[level - 1] = 1;
    return {
      modelVersion: "difficulty-v1",
      level: {
        requestedDifficultyLevel: level,
        generated: 1,
        assessedLevelCounts: levelCounts,
        humanTrace: { complete: 1, incomplete: 0 },
        fallback: { used: 0, maximumAttempt: 0, attempts: { p50: 0, p95: 0 } },
        clues: { average: 4, minimum: 4, maximum: 4 },
      },
    };
  };
  try {
    await writeAuditCheckpoint(checkpointPath, checkpoint);
    await assert.rejects(
      checkpointTargetedDifficultyLevels(checkpoint, checkpointPath, tournamentOrderV2Template, undefined, fakeAuditLevel),
      /simulated interruption/,
    );
    assert.deepEqual(checkpoint.targetedDifficultyAudit[0]?.levels.map(level => level.requestedDifficultyLevel), [1, 2]);
    calls.length = 0;
    interruptAtLevelThree = false;
    await checkpointTargetedDifficultyLevels(checkpoint, checkpointPath, tournamentOrderV2Template, undefined, fakeAuditLevel);
    assert.deepEqual(calls, [3, 4]);
    assert.deepEqual(checkpoint.targetedDifficultyAudit[0]?.levels.map(level => level.requestedDifficultyLevel), [1, 2, 3, 4]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("older JEV reports can be loaded for follow-up puzzle review", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-report-test-"));
  const reportPath = join(directory, "audit.json");
  const source: Record<string, unknown> = {
    startedAt: "2026-09-29T00:00:00.000Z",
    generatedAt: "2026-09-29T00:01:00.000Z",
    configuration: { ...configuration, resolvedModel: "test-model" },
    difficultyAudit: [],
    targetedDifficultyAudit: [],
    semanticCalibrationEvidence: [],
    clueAudit: { model: "test-model", sampledClues: 0, totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0, status: "complete", flaggedClues: [], incompleteClues: [], unavailableClues: [], clues: [] },
    puzzleAudit: { enabled: false, sampledPuzzles: 0, completePuzzles: 0, incompletePuzzles: 0, unavailablePuzzles: 0, flaggedPuzzles: [], puzzles: [] },
  };
  try {
    await writeFile(reportPath, `${JSON.stringify(source)}\n`);
    const report = await readJevAuditReport(reportPath);
    assert.deepEqual(report.productionDifficultyAudit, []);
    assert.deepEqual(report.clueAudit.clues, []);
    assert.deepEqual(report.clueAudit.models, ["test-model"]);
    assert.equal(report.clueAudit.modelAttribution, "legacy-aggregate");
    assert.deepEqual(report.puzzleAudit.models, []);
    assert.match(buildAuditMarkdown(report), /legacy aggregate attribution/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("clue decision batches ask bounded semantic questions against structured semantics only", () => {
  const payload = buildClueDecisionPayload("test-model", [clue()]);
  assert.equal(payload.model, "test-model");
  assert.equal(Object.keys(payload.questions).length, 7);
  assert.deepEqual(Object.keys(payload.state), ["clues"]);
  const state = (payload.state.clues as Array<Record<string, unknown>>)[0]!;
  assert.equal(state.constraintKind, "distance");
  assert.deepEqual(state.structuredSemantics, clue().structuredSemantics);
  assert.equal("solution" in payload.state, false);
  assert.equal((payload.questions["0_linguisticComplexity"] as { type: string }).type, "score");
  assert.equal((payload.questions["0_ambiguous"] as { type: string }).type, "noul");
  assert.equal((payload.questions["0_entityClarity"] as { type: string }).type, "score");
  assert.equal((payload.questions["0_misunderstandingRisk"] as { type: string }).type, "noul");
  const faithfulnessPrompt = (payload.questions["0_faithful"] as { instructions: string }).instructions;
  assert.match(faithfulnessPrompt, /meaning-preserving paraphrase/i);
  assert.match(faithfulnessPrompt, /won Gold/i);
  assert.match(faithfulnessPrompt, /did not finish in 5th place/i);
  assert.equal(typeof JEV_REVIEW_THRESHOLDS.linguisticComplexityAbove, "number");
  assert.equal(SEMANTIC_ASSESSMENT_SCHEMA_VERSION, "yokaiba-jev-semantic-v3");
});

test("optional puzzle review records language-versus-logic evidence without replacing logical level", () => {
  const assessed = applyJevPuzzleAnswers(puzzle(), {
    "0_wordingRepetition": { noul: 0.7, confidence: 0.8 },
    "0_terminologyInconsistency": { noul: 0.1 },
    "0_phrasingVariety": { score: 1.4 },
    "0_linguisticDifficultyComparedToLogical": { score: 1.8, confidence: 0.9 },
    "0_cognitiveBurden": { score: 1.6 },
    "0_initialReadingClarity": { score: 0.8 },
  }, 0, "2026-09-29T00:00:00.000Z");
  const payload = buildPuzzleDecisionPayload("test-model", [puzzle()]);
  assert.equal(Object.keys(payload.questions).length, 6);
  assert.match((payload.questions["0_cognitiveBurden"] as { instructions: string }).instructions, /clue count as a separate structural contributor/i);
  assert.equal(assessed.evaluationStatus, "complete");
  assert.equal(assessed.logicalDifficultyLevel, 3);
  assert.equal(assessed.linguisticDifficultyComparedToLogical, 1.8);
  assert.equal(assessed.linguisticDifficultyComparedToLogicalConfidence, 0.9);
  assert.equal(assessed.cognitiveBurden, 1.6);
  assert.equal(assessed.initialReadingClarity, 0.8);
  assert.deepEqual(puzzleReviewFlagReasons(assessed), [
    "wording repetition above 0.60",
    "linguistic difficulty substantially above logical level (1.50)",
    "clue-set cognitive burden above 1.50",
    "initial reading clarity below 1.00",
  ]);
  const assessedClue = applyJevAnswers(clue(), {
    "0_faithful": { noul: 1 },
    "0_ambiguous": { noul: 0 },
    "0_readability": { score: 2 },
    "0_linguisticComplexity": { score: 0.4 },
    "0_relationshipExplicitness": { score: 1.8 },
    "0_entityClarity": { score: 1.8 },
    "0_misunderstandingRisk": { noul: 0.1 },
  }, 0);
  const evidence = aggregateSemanticCalibrationEvidence([assessedClue], [assessed]);
  assert.deepEqual(aggregateSemanticPuzzleEvidence(assessed, [assessedClue]), evidence[0]);
  assert.equal(evidence[0]?.logicalDifficultyLevel, 3);
  assert.equal(evidence[0]?.clueCount, 1);
  assert.equal(evidence[0]?.semanticAssessment.readability, 2);
  assert.equal(evidence[0]?.semanticAssessment.entityClarity, 1.8);
  assert.equal(evidence[0]?.semanticAssessment.misunderstandingRisk, 0.1);
  assert.equal(evidence[0]?.puzzleReview?.linguisticDifficultyComparedToLogical, 1.8);
  assert.equal(evidence[0]?.puzzleReview?.cognitiveBurden, 1.6);
  assert.equal(evidence[0]?.puzzleReview?.initialReadingClarity, 0.8);
});

test("puzzle review rebuilds sampled puzzle clue sets from an earlier report", () => {
  const sourceClue = { ...clue(), evaluationStatus: "complete" as const, evaluatedAt: "2026-09-29T00:00:00.000Z" };
  const report: JevAuditReport = {
    startedAt: "2026-09-29T00:00:00.000Z",
    generatedAt: "2026-09-29T00:01:00.000Z",
    configuration: { ...configuration, resolvedModel: "test-model" },
    difficultyAudit: [],
    productionDifficultyAudit: [],
    targetedDifficultyAudit: [],
    semanticCalibrationEvidence: [{
      templateId: "test-template", seed: "seed-1", logicalDifficultyLevel: 3, difficultyModelVersion: "yokaiba-difficulty-v4",
      semanticAssessment: { evaluatedClues: 1, totalClues: 1 },
    }],
    clueAudit: {
      model: "test-model", models: ["test-model"], modelAttribution: "phase-specific", sampledClues: 1, totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0,
      status: "complete", flaggedClues: [], incompleteClues: [], unavailableClues: [], clues: [sourceClue],
    },
    puzzleAudit: { model: null, models: [], modelAttribution: "phase-specific", enabled: false, sampledPuzzles: 0, completePuzzles: 0, incompletePuzzles: 0, unavailablePuzzles: 0, flaggedPuzzles: [], puzzles: [] },
  };

  const [rebuilt] = rebuildPuzzleReviewCorpus(report, { "test-template": "Test Order" });
  assert.equal(rebuilt?.templateTitle, "Test Order");
  assert.equal(rebuilt?.seed, "seed-1");
  assert.equal(rebuilt?.logicalDifficultyLevel, 3);
  assert.equal(rebuilt?.clues[0]?.text, sourceClue.text);
  assert.equal(rebuilt?.evaluationStatus, "pending");
});

test("provider failure marks the semantic assessment unavailable without changing deterministic evidence", async () => {
  const original = clue();
  const unavailable = markClueUnavailable(original);
  let attempts = 0;
  await assert.rejects(
    requestJevDecisionBatch(
      "test-secret",
      buildClueDecisionPayload("test-model", [original]),
      "https://example.test/decisions",
      async () => {
        attempts += 1;
        return new Response("offline", { status: 503 });
      },
      { maxRetries: 2, sleep: async () => {} },
    ),
    /JEV request failed \(503\)/,
  );
  assert.equal(attempts, 3);
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
