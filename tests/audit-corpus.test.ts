import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateDifficultyAuditRecords,
  auditTargetedDifficultyCorpus,
  auditDifficultyCorpus,
  auditProductionDifficultyCorpus,
  auditTargetedDifficultyLevel,
  fallbackAttemptPercentiles,
  type DifficultyAuditRecord,
} from "../src/generation/audit.js";
import { tournamentOrderV2Template } from "../src/templates/tournament-order-v2.js";
import { tournamentOrderTemplate } from "../src/templates/tournament-order.js";
import { openDivisionTemplate } from "../src/templates/open-division.js";

const fourRowOpenDivisionAuditFixture = {
  ...openDivisionTemplate,
  categories: openDivisionTemplate.categories.map(category => ({ ...category, values: category.values.slice(0, 4) })),
};

// Audit report and calibration contract: README.md#difficulty-audit-and-calibration.
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

test("targeted audits support templates without calibration metadata", () => {
  const templateWithoutCalibration = { ...tournamentOrderTemplate, metadata: undefined };
  const result = auditTargetedDifficultyLevel(templateWithoutCalibration, 1, { sampleSize: 1 });

  assert.equal(result.level.requestedDifficultyLevel, 1);
  assert.equal(result.level.generated, 1);
});

test("production distribution audit follows the progressive no-guess path", () => {
  const report = auditProductionDifficultyCorpus(tournamentOrderV2Template, { sampleSize: 4, seedPrefix: "test-progressive" });
  assert.equal(report.sampleSize, 4);
  assert.equal(report.generated, 4);
  assert.equal(report.unavailable, 0);
  assert.equal(report.humanTrace.complete, 4);
  assert.equal(report.humanTrace.incomplete, 0);
});

test("production distribution reports the calibrated levels for a fixed seed sample", () => {
  const report = auditProductionDifficultyCorpus(openDivisionTemplate, { sampleSize: 4, seedPrefix: "difficulty-audit" });
  assert.equal(report.templateId, openDivisionTemplate.id);
  assert.equal(report.modelVersion, "yokaiba-difficulty-v4");
  assert.equal(report.seedPrefix, "difficulty-audit");
  assert.equal(report.sampleSize, 4);
  assert.equal(report.generated + report.unavailable, report.sampleSize);
  assert.deepEqual(report.levelCounts, [0, 0, 0, 0, 1, 1, 0, 2, 0, 0, 0, 0]);
  assert.deepEqual(report.humanTrace, { complete: 4, incomplete: 0 });
  assert.deepEqual(report.clues, { average: 8, minimum: 8, maximum: 8 });
});

test("progressive audit counts a deterministic unavailable sample and reports zeroed statistics", () => {
  const progress: unknown[] = [];
  const report = auditProductionDifficultyCorpus(fourRowOpenDivisionAuditFixture, {
    sampleSize: 1,
    seedPrefix: "audit-progressive-small-4-17",
    onProgress: event => progress.push(event),
  });

  assert.equal(report.modelVersion, "unavailable");
  assert.equal(report.generated, 0);
  assert.equal(report.unavailable, 1);
  assert.deepEqual(report.levelCounts, Array(12).fill(0));
  assert.deepEqual(report.humanTrace, { complete: 0, incomplete: 0 });
  assert.deepEqual(report.clues, { average: 0, minimum: 0, maximum: 0 });
  assert.deepEqual(progress, [{ phase: "difficulty", templateId: fourRowOpenDivisionAuditFixture.id, completed: 1, total: 1 }]);
});

test("progressive audits can report an unavailable sample without a progress callback", () => {
  assert.doesNotThrow(() => auditProductionDifficultyCorpus(fourRowOpenDivisionAuditFixture, {
    sampleSize: 1,
    seedPrefix: "audit-progressive-small-4-17",
  }));
});

test("a targeted course level can be audited independently", () => {
  const result = auditTargetedDifficultyLevel(tournamentOrderV2Template, 1, { sampleSize: 3, seedPrefix: "test-level" });
  assert.equal(result.level.generated, 3);
  assert.equal(result.modelVersion, "yokaiba-difficulty-v4");
  assert.equal(result.level.humanTrace.complete, 3);
  assert.equal(result.level.fallback.used, 0);
  assert.equal(result.level.fallback.maximumAttempt, 0);
  assert.deepEqual(result.level.fallback.attempts, { p50: 0, p95: 0 });
});

test("targeted audit reports the fallback count and attempt percentiles for a replayable seed", () => {
  const result = auditTargetedDifficultyLevel(openDivisionTemplate, 5, {
    sampleSize: 2,
    seedPrefix: "audit-fallback-0",
  });

  assert.equal(result.level.generated, 2);
  assert.deepEqual(result.level.fallback, { used: 2, maximumAttempt: 9, attempts: { p50: 3, p95: 9 } });
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
  assert.notEqual(report.modelVersion, "unavailable");
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
  assert.equal(targeted.level.generated, 1);
  assert.deepEqual(targeted.level.fallback.attempts, { p50: 0, p95: 0 });
});

test("targeted corpus audits generate and assess each advertised course level", () => {
  const report = auditTargetedDifficultyCorpus(tournamentOrderV2Template, { sampleSize: 1 });

  assert.equal(report.templateId, tournamentOrderV2Template.id);
  assert.equal(report.sampleSize, 1);
  assert.equal(report.seedPrefix, "targeted-difficulty-audit");
  assert.equal(report.modelVersion, "yokaiba-difficulty-v4");
  assert.deepEqual(report.levels.map(level => level.requestedDifficultyLevel), [1, 2, 3, 4]);
  assert.ok(report.levels.every(level => level.generated === 1 && level.humanTrace.incomplete === 0));
  assert.ok(report.levels.every(level => level.assessedLevelCounts[level.requestedDifficultyLevel - 1] === 1));
});
