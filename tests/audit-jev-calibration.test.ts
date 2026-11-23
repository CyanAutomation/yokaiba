import assert from "node:assert/strict";
import test from "node:test";
import type { AuditedClue } from "../scripts/audit-jev-support.js";
import {
  compareJevWithHumanCalibration,
  parseHumanCalibrationLabels,
  renderHumanCalibrationMarkdown,
} from "../scripts/audit-jev-calibration-support.js";

function clue(overrides: Partial<AuditedClue> = {}): AuditedClue {
  return {
    templateId: "cup",
    seed: "seed-1",
    clueId: "clue-1",
    text: "The clue text.",
    expectedSemantics: "Expected relation.",
    constraintKind: "matches",
    structuredSemantics: { kind: "matches", subject: "Aya", category: "weight", value: "-60 kg" },
    logicalDifficultyLevel: 3,
    difficultyModelVersion: "yokaiba-difficulty-v5",
    faithful: 0.4,
    ambiguous: 0.1,
    readability: 1.5,
    linguisticComplexity: 0.2,
    relationshipExplicitness: 1.5,
    entityClarity: 1.5,
    misunderstandingRisk: 0.1,
    evaluationStatus: "complete",
    missingAnswers: [],
    flagged: true,
    flagReasons: ["faithfulness below 0.50"],
    ...overrides,
  };
}

test("human calibration compares threshold leads with adjudicated concern labels and player misreads", () => {
  const flagged = clue();
  const unflagged = clue({
    seed: "seed-2",
    clueId: "clue-2",
    faithful: 0.95,
    ambiguous: 0.1,
    readability: 1.8,
    linguisticComplexity: 0.4,
    relationshipExplicitness: 1.9,
    entityClarity: 1.8,
    misunderstandingRisk: 0.1,
    flagged: false,
    flagReasons: [],
  });
  const labels = parseHumanCalibrationLabels({
    version: 1,
    labels: [
      {
        templateId: "cup", seed: "seed-1", clueId: "clue-1",
        concerns: { faithfulness: true, ambiguity: false },
        playerOutcome: { exposures: 10, misreads: 3 },
      },
      {
        templateId: "cup", seed: "seed-2", clueId: "clue-2",
        concerns: { faithfulness: false, ambiguity: false },
        playerOutcome: { exposures: 10, misreads: 0 },
      },
    ],
  });
  const report = compareJevWithHumanCalibration([flagged, unflagged], labels);

  assert.equal(report.matchedLabels, 2);
  assert.equal(report.unmatchedLabels, 0);
  assert.deepEqual(report.metrics.faithfulness.confusion, { truePositive: 1, falsePositive: 0, trueNegative: 1, falseNegative: 0 });
  assert.equal(report.metrics.faithfulness.precision, 1);
  assert.equal(report.metrics.faithfulness.recall, 1);
  assert.equal(report.playerOutcomes.flagged.exposures, 10);
  assert.equal(report.playerOutcomes.flagged.misreads, 3);
  assert.equal(report.playerOutcomes.flagged.misreadRate, 0.3);
  assert.equal(report.playerOutcomes.unflagged.misreadRate, 0);
  assert.equal(report.playerOutcomes.misreadRateDifference, 0.3);
  assert.deepEqual(report.metrics.ambiguity.falsePositiveExamples, []);
  assert.match(renderHumanCalibrationMarkdown(report, "source.json", "labels.json"), /Precision \| Recall \| Specificity \| Accuracy/);
});

test("player misread comparison excludes incomplete JEV assessments", () => {
  const incomplete = clue({ evaluationStatus: "incomplete", faithful: 0.2, flagged: true });
  const labels = parseHumanCalibrationLabels({
    version: 1,
    labels: [{
      templateId: "cup", seed: "seed-1", clueId: "clue-1",
      concerns: { faithfulness: true },
      playerOutcome: { exposures: 4, misreads: 2 },
    }],
  });
  const report = compareJevWithHumanCalibration([incomplete], labels);
  assert.equal(report.excludedIncompletePlayerOutcomeClues, 1);
  assert.equal(report.playerOutcomes.flagged.exposures, 0);
  assert.equal(report.playerOutcomes.misreadRateDifference, null);
});

test("human calibration retains false-positive and false-negative clue examples", () => {
  const falsePositive = clue({ seed: "seed-fp", clueId: "clue-fp", faithful: 0.2 });
  const falseNegative = clue({ seed: "seed-fn", clueId: "clue-fn", faithful: 0.9 });
  const labels = parseHumanCalibrationLabels({
    version: 1,
    labels: [
      { templateId: "cup", seed: "seed-fp", clueId: "clue-fp", concerns: { faithfulness: false } },
      { templateId: "cup", seed: "seed-fn", clueId: "clue-fn", concerns: { faithfulness: true } },
    ],
  });
  const faithfulness = compareJevWithHumanCalibration([falsePositive, falseNegative], labels).metrics.faithfulness;

  assert.deepEqual(faithfulness.confusion, { truePositive: 0, falsePositive: 1, trueNegative: 0, falseNegative: 1 });
  assert.deepEqual(faithfulness.falsePositiveExamples, [{ templateId: "cup", seed: "seed-fp", clueId: "clue-fp" }]);
  assert.deepEqual(faithfulness.falseNegativeExamples, [{ templateId: "cup", seed: "seed-fn", clueId: "clue-fn" }]);
});

test("human calibration rejects duplicate clue keys and invalid player counts", () => {
  const row = { templateId: "cup", seed: "seed", clueId: "clue", concerns: { faithfulness: true } };
  assert.throws(() => parseHumanCalibrationLabels({ version: 1, labels: [row, row] }), /duplicate label key/);
  assert.throws(() => parseHumanCalibrationLabels({
    version: 1,
    labels: [{ ...row, playerOutcome: { exposures: 2, misreads: 3 } }],
  }), /misreads cannot exceed exposures/);
  assert.throws(() => parseHumanCalibrationLabels({
    version: 1,
    labels: [{ ...row, concerns: { faithfulness: "yes" } }],
  }), /must be boolean/);
  assert.throws(() => parseHumanCalibrationLabels({
    version: 1,
    labels: [{ ...row, concerns: { unrecognizedMetric: true } }],
  }), /unknown human calibration metric/);
});

