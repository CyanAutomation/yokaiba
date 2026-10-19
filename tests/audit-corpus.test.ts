import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateDifficultyAuditRecords,
  auditClueAblation,
  auditTargetedDifficultyCorpus,
  auditDifficultyCorpus,
  auditProductionDifficultyCorpus,
  auditTargetedDifficultyLevel,
  fallbackAttemptPercentiles,
  type DifficultyAuditRecord,
} from "../src/generation/audit.js";
import { DifficultyUnavailableError, generatePuzzleForRequest } from "../src/generation/generator.js";
import { tournamentOrderV2Template } from "../src/templates/tournament-order-v2.js";
import { tournamentOrderTemplate } from "../src/templates/tournament-order.js";
import { openDivisionTemplate } from "../src/templates/open-division.js";

const fourRowOpenDivisionAuditFixture = {
  ...openDivisionTemplate,
  categories: openDivisionTemplate.categories.map(category => ({ ...category, values: category.values.slice(0, 4) })),
};

// Audit report and calibration contract: docs/difficulty-and-calibration.md#difficulty-audit-and-calibration.
test("fallback attempt summaries use nearest-rank p50 and p95", () => {
  assert.deepEqual(fallbackAttemptPercentiles([32, 3, 1, 9, 4, 7, 2, 6, 5, 8]), { p50: 5, p95: 32 });
  assert.deepEqual(fallbackAttemptPercentiles([]), { p50: 0, p95: 0 });
  assert.throws(() => fallbackAttemptPercentiles([0]), /positive integers/);
  assert.throws(() => fallbackAttemptPercentiles([1.5]), /positive integers/);
});

test("audit aggregation counts levels and summarizes trace and clue observations", () => {
  const statistics = aggregateDifficultyAuditRecords([
    { level: 2, humanTraceComplete: true, clueCount: 5 },
    { level: 2, humanTraceComplete: false, clueCount: 8 },
    { level: 12, humanTraceComplete: true, clueCount: 11 },
  ]);

  assert.deepEqual(statistics, {
    levelCounts: [0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    humanTrace: { complete: 2, incomplete: 1 },
    clues: { average: 8, minimum: 5, maximum: 11 },
  });
});

test("audit aggregation requires records with an integer level from 1 through 12", () => {
  const record = (level: number): DifficultyAuditRecord => ({
    level: level as DifficultyAuditRecord["level"],
    humanTraceComplete: true,
    clueCount: 5,
  });

  assert.throws(() => aggregateDifficultyAuditRecords([]), { name: "RangeError" });
  for (const level of [0, 13, 1.5, Number.NaN]) {
    assert.throws(
      () => aggregateDifficultyAuditRecords([record(level)]),
      { name: "RangeError", message: `difficulty level must be an integer between 1 and 12, received ${level}` },
    );
  }
});

test("difficulty audits require a positive integer sample size", () => {
  assert.throws(() => auditDifficultyCorpus(tournamentOrderV2Template, { sampleSize: 0 }), /sampleSize must be a positive integer/);
  assert.throws(() => auditProductionDifficultyCorpus(tournamentOrderV2Template, { sampleSize: 1.5 }), /sampleSize must be a positive integer/);
  assert.throws(() => auditTargetedDifficultyLevel(tournamentOrderV2Template, 1, { sampleSize: 0 }), /sampleSize must be a positive integer/);
  assert.throws(() => auditTargetedDifficultyCorpus(tournamentOrderV2Template, { sampleSize: -1 }), /sampleSize must be a positive integer/);
});

test("distribution audits propagate generation errors other than unavailable difficulty", () => {
  const invalidTemplate = { ...tournamentOrderV2Template, baseCategory: "missing-category" };

  assert.throws(
    () => auditDifficultyCorpus(invalidTemplate, { sampleSize: 1 }),
    { name: "Error", message: "template baseCategory must exist" },
  );
});

test("targeted difficulty audits reject levels outside the template's advertised range", () => {
  assert.throws(
    () => auditTargetedDifficultyLevel(tournamentOrderV2Template, 5, { sampleSize: 1 }),
    /tournament-order-v2 does not advertise difficulty level 5/,
  );
  assert.throws(
    () => auditTargetedDifficultyLevel(openDivisionTemplate, 4, { sampleSize: 1 }),
    /open-division-v2 does not advertise difficulty level 4/,
  );
});

// Standalone targeted-audit contract: docs/difficulty-and-calibration.md#difficulty-audit-and-calibration.
test("targeted audits default to levels 1 through 12 without calibration metadata", () => {
  const templateWithoutCalibration = { ...tournamentOrderTemplate, metadata: undefined };
  const result = auditTargetedDifficultyLevel(templateWithoutCalibration, 1, { sampleSize: 1 });
  const maximumLevelResult = auditTargetedDifficultyLevel(templateWithoutCalibration, 12, { sampleSize: 1 });

  assert.equal(result.level.requestedDifficultyLevel, 1);
  assert.equal(result.level.generated + (result.level.unavailable ?? 0), 1);
  assert.equal(maximumLevelResult.level.requestedDifficultyLevel, 12);
  assert.equal(maximumLevelResult.level.generated + (maximumLevelResult.level.unavailable ?? 0), 1);
  assert.equal(result.modelVersion, "yokaiba-difficulty-v5");
  assert.equal(result.level.assessedLevelCounts.reduce((total, count) => total + count, 0), result.level.generated);
  assert.equal(result.level.humanTrace.complete + result.level.humanTrace.incomplete, result.level.generated);
  if (result.level.fallback.used === 0) assert.deepEqual(result.level.fallback.attempts, { p50: 0, p95: 0 });
});

test("production distribution audit follows the progressive no-guess path", () => {
  const report = auditProductionDifficultyCorpus(tournamentOrderV2Template, { sampleSize: 4, seedPrefix: "test-progressive" });
  assert.equal(report.sampleSize, 4);
  assert.equal(report.generated + report.unavailable, 4);
  assert.equal(report.modelVersion, "yokaiba-difficulty-v5");
  assert.equal(report.humanTrace.complete, report.generated);
  assert.equal(report.humanTrace.incomplete, 0);
});

test("production distribution reports the calibrated levels for a fixed seed sample", () => {
  const report = auditProductionDifficultyCorpus(openDivisionTemplate, { sampleSize: 4, seedPrefix: "difficulty-audit" });
  assert.equal(report.templateId, openDivisionTemplate.id);
  assert.equal(report.modelVersion, "yokaiba-difficulty-v5");
  assert.equal(report.seedPrefix, "difficulty-audit");
  assert.equal(report.sampleSize, 4);
  assert.equal(report.generated + report.unavailable, report.sampleSize);
  assert.equal(report.levelCounts.reduce((total, count) => total + count, 0), report.generated);
  assert.equal(report.humanTrace.complete + report.humanTrace.incomplete, report.generated);
  assert.ok(report.clues.minimum > 0);
  assert.ok(report.clues.average >= report.clues.minimum && report.clues.average <= report.clues.maximum);
});

test("progressive audit reports unavailable samples with or without a progress callback", () => {
  const progress: unknown[] = [];
  const report = auditProductionDifficultyCorpus(fourRowOpenDivisionAuditFixture, {
    sampleSize: 1,
    seedPrefix: "audit-progressive-small-4-17",
    onProgress: event => progress.push(event),
    generator: (template, seed) => { throw new DifficultyUnavailableError(template.id, seed, undefined); },
  });

  assert.equal(report.modelVersion, "yokaiba-difficulty-v5");
  assert.equal(report.generated, 0);
  assert.equal(report.unavailable, 1);
  assert.deepEqual(report.levelCounts, Array(12).fill(0));
  assert.deepEqual(report.humanTrace, { complete: 0, incomplete: 0 });
  assert.deepEqual(report.clues, { average: 0, minimum: 0, maximum: 0 });
  assert.deepEqual(progress, [{ phase: "difficulty", templateId: fourRowOpenDivisionAuditFixture.id, completed: 1, total: 1 }]);

  const withoutProgress = auditProductionDifficultyCorpus(fourRowOpenDivisionAuditFixture, {
    sampleSize: 1,
    seedPrefix: "audit-progressive-small-4-17",
    generator: (template, seed) => { throw new DifficultyUnavailableError(template.id, seed, undefined); },
  });
  assert.deepEqual(withoutProgress, report);
});

test("a targeted course level can be audited independently", () => {
  const result = auditTargetedDifficultyLevel(tournamentOrderV2Template, 1, { sampleSize: 3, seedPrefix: "test-level" });
  assert.equal(result.level.generated + (result.level.unavailable ?? 0), 3);
  assert.equal(result.modelVersion, "yokaiba-difficulty-v5");
  assert.equal(result.level.humanTrace.incomplete, 0);
  assert.ok(result.level.fallback.used <= result.level.generated);
  assert.ok(result.level.fallback.maximumAttempt <= 2);
  if (result.level.fallback.used === 0) assert.deepEqual(result.level.fallback.attempts, { p50: 0, p95: 0 });
  else assert.ok(result.level.fallback.attempts!.p50 <= result.level.fallback.attempts!.p95);
});

test("targeted v5 unavailability is recorded for each failed seed instead of aborting the audit", () => {
  const progress: unknown[] = [];
  const result = auditTargetedDifficultyLevel(tournamentOrderV2Template, 1, {
    sampleSize: 2,
    onProgress: event => progress.push(event),
    generateTargeted: (template, seed, level) => {
      throw new DifficultyUnavailableError(template.id, seed, level);
    },
  });

  assert.equal(result.modelVersion, "yokaiba-difficulty-v5");
  assert.equal(result.level.generated, 0);
  assert.equal(result.level.unavailable, 2);
  assert.deepEqual(result.level.assessedLevelCounts, Array(12).fill(0));
  assert.deepEqual(result.level.humanTrace, { complete: 0, incomplete: 0 });
  assert.deepEqual(progress, [1, 2].map(completed => ({ phase: "targeted", templateId: tournamentOrderV2Template.id, requestedDifficultyLevel: 1, completed, total: 2 })));
});

test("targeted audit reports the fallback count and attempt percentiles for a replayable seed", () => {
  const result = auditTargetedDifficultyLevel(openDivisionTemplate, 5, {
    sampleSize: 2,
    seedPrefix: "difficulty-v5-audit-target-open-division-v2-5",
  });

  assert.equal(result.modelVersion, "yokaiba-difficulty-v5");
  assert.equal(result.level.generated + (result.level.unavailable ?? 0), 2);
  assert.ok(result.level.fallback.used <= result.level.generated);
  assert.ok(result.level.fallback.maximumAttempt <= 2);
});

test("difficulty audit reports each progressive sample in order", () => {
  const templateId = tournamentOrderV2Template.id;
  const progress: unknown[] = [];

  auditDifficultyCorpus(tournamentOrderV2Template, {
    sampleSize: 2,
    seedPrefix: "progressive-progress",
    onProgress: event => progress.push(event),
  });

  assert.deepEqual(progress, [
    { phase: "difficulty", templateId, completed: 1, total: 2 },
    { phase: "difficulty", templateId, completed: 2, total: 2 },
  ]);
});

test("targeted audit reports each sample in order for every advertised level", () => {
  const templateId = tournamentOrderV2Template.id;
  const progress: unknown[] = [];

  auditTargetedDifficultyCorpus(tournamentOrderV2Template, {
    sampleSize: 2,
    seedPrefix: "targeted-progress",
    onProgress: event => progress.push(event),
  });

  assert.deepEqual(progress, [1, 2, 3, 4].flatMap(requestedDifficultyLevel => [
    { phase: "targeted", templateId, requestedDifficultyLevel, completed: 1, total: 2 },
    { phase: "targeted", templateId, requestedDifficultyLevel, completed: 2, total: 2 },
  ]));
});

test("a single-seed distribution audit reports its generated puzzle's statistics", () => {
  const report = auditDifficultyCorpus(tournamentOrderTemplate, { seedPrefix: "audit-integration", sampleSize: 1 });

  assert.equal(report.templateId, tournamentOrderTemplate.id);
  assert.equal(report.sampleSize, 1);
  assert.equal(report.generated, 1);
  assert.equal(report.unavailable, 0);
  assert.equal(report.modelVersion, "yokaiba-difficulty-v5");
  assert.equal(report.levelCounts.reduce((total, count) => total + count, 0), report.generated);
  assert.equal(report.humanTrace.complete + report.humanTrace.incomplete, report.generated);
  assert.ok(report.clues.minimum > 0);
  assert.equal(report.clues.minimum, report.clues.maximum);
  assert.equal(report.clues.average, report.clues.minimum);
});

test("audit defaults use template sample size and documented seed prefixes", () => {
  const templateWithOneSampleDefault = {
    ...tournamentOrderV2Template,
    metadata: {
      ...tournamentOrderV2Template.metadata!,
      difficultyCalibration: {
        ...tournamentOrderV2Template.metadata!.difficultyCalibration,
        corpus: { ...tournamentOrderV2Template.metadata!.difficultyCalibration.corpus, sampleSize: 1 },
      },
    },
  };
  const distribution = auditDifficultyCorpus(templateWithOneSampleDefault);
  const targeted = auditTargetedDifficultyLevel(templateWithOneSampleDefault, 1);

  assert.equal(distribution.sampleSize, 1);
  assert.equal(distribution.seedPrefix, "difficulty-audit");
  assert.equal(targeted.level.generated + (targeted.level.unavailable ?? 0), 1);
});

test("targeted corpus audits generate and assess each advertised course level", () => {
  const report = auditTargetedDifficultyCorpus(tournamentOrderV2Template, { sampleSize: 1 });

  assert.equal(report.templateId, tournamentOrderV2Template.id);
  assert.equal(report.sampleSize, 1);
  assert.equal(report.seedPrefix, "targeted-difficulty-audit");
  assert.equal(report.modelVersion, "yokaiba-difficulty-v5");
  assert.deepEqual(report.levels.map(level => level.requestedDifficultyLevel), [1, 2, 3, 4]);
  assert.ok(report.levels.every(level => level.generated + (level.unavailable ?? 0) === 1));
  assert.ok(report.levels.every(level => level.humanTrace.incomplete === 0));
  assert.ok(report.levels.every(level => level.assessedLevelCounts[level.requestedDifficultyLevel - 1] === level.generated));
});

test("clue ablation reports whether removing each latest-version clue breaks uniqueness or no-guess completion", () => {
  const puzzle = generatePuzzleForRequest(tournamentOrderV2Template, "audit-clue-ablation");
  const ablation = auditClueAblation(tournamentOrderV2Template, puzzle.clues);

  assert.equal(puzzle.difficulty.modelVersion, "yokaiba-difficulty-v5");
  assert.equal(ablation.length, puzzle.clues.length);
  assert.deepEqual(ablation.map(result => result.clueId), puzzle.clues.map(clue => clue.id));
  assert.ok(ablation.every(result => result.logicalContribution !== "not-essential"));
  for (const result of ablation) {
    assert.equal(result.logicalContribution, !result.uniqueWithout
      ? "uniqueness-critical"
      : !result.humanTraceCompleteWithout ? "no-guess-critical" : "not-essential");
  }
});
