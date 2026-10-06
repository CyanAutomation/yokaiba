import assert from "node:assert/strict";
import test from "node:test";
import {
  auditProductionDifficultyCorpus,
  auditTargetedDifficultyLevel,
  fallbackAttemptPercentiles,
} from "../src/generation/audit.js";
import { tournamentOrderV2Template } from "../src/templates/tournament-order-v2.js";
import { openDivisionTemplate } from "../src/templates/open-division.js";

test("fallback attempt summaries use nearest-rank p50 and p95", () => {
  assert.deepEqual(fallbackAttemptPercentiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 32]), { p50: 5, p95: 32 });
  assert.deepEqual(fallbackAttemptPercentiles([]), { p50: 0, p95: 0 });
  assert.throws(() => fallbackAttemptPercentiles([0]), /positive integers/);
});

test("production distribution audit follows the progressive no-guess path", () => {
  const report = auditProductionDifficultyCorpus(tournamentOrderV2Template, { sampleSize: 4, seedPrefix: "test-progressive" });
  assert.equal(report.sampleSize, 4);
  assert.equal(report.generated, 4);
  assert.equal(report.unavailable, 0);
  assert.equal(report.humanTrace.complete, 4);
  assert.equal(report.humanTrace.incomplete, 0);
});

test("production distribution accounts for every sampled seed", () => {
  const report = auditProductionDifficultyCorpus(openDivisionTemplate, { sampleSize: 10, seedPrefix: "difficulty-audit" });
  assert.equal(report.sampleSize, 10);
  assert.equal(report.generated + report.unavailable, report.sampleSize);
  assert.equal(report.levelCounts.reduce((sum, count) => sum + count, 0), report.generated);
});

test("a targeted course level can be audited independently", () => {
  const result = auditTargetedDifficultyLevel(tournamentOrderV2Template, 1, { sampleSize: 3, seedPrefix: "test-level" });
  assert.equal(result.level.generated, 3);
  assert.equal(result.level.humanTrace.complete, 3);
  assert.equal(result.level.fallback.used, 0);
  assert.deepEqual(result.level.fallback.attempts, { p50: 0, p95: 0 });
});
