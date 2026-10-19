import assert from "node:assert/strict";
import test from "node:test";
import { solveWithTelemetry } from "../src/constraints/solver.js";
import { evaluateHumanDeductionTraceV5 } from "../src/generation/human-deduction-v5.js";
import { assessPuzzleDifficultyV5 } from "../src/generation/difficulty-assessment.js";
import { DIFFICULTY_BANDS_V5, DIFFICULTY_MODEL_V5 } from "../src/generation/difficulty-profile.js";
import { DifficultyUnavailableError, generatePuzzle, generatePuzzleAtDifficultyV5 } from "../src/generation/generator.js";
import type { Clue, PuzzleTemplate } from "../src/domain/types.js";
import { tournamentOrderV2Template } from "../src/templates/tournament-order-v2.js";
import { championshipCircuitTemplate } from "../src/templates/championship-circuit.js";

const spec: PuzzleTemplate = {
  id: "trace-fixture",
  title: "Trace fixture",
  baseCategory: "person",
  categories: [
    { id: "person", label: "Person", values: ["Aki", "Ben"] },
    { id: "color", label: "Color", values: ["Red", "Blue"] },
    { id: "pet", label: "Pet", values: ["Cat", "Dog"] },
  ],
};

const clues: Clue[] = [
  { id: "match-aki-red", text: "Aki wore red.", constraint: { kind: "matches", subject: "Aki", category: "color", value: "Red" } },
  { id: "same-red-cat", text: "Red and Cat belong together.", constraint: { kind: "sameRow", left: { category: "color", value: "Red" }, right: { category: "pet", value: "Cat" } } },
];

test("v5 deduction trace records a deterministic prerequisite chain without consulting a solution", () => {
  const first = evaluateHumanDeductionTraceV5(spec, clues);
  const second = evaluateHumanDeductionTraceV5(spec, [...clues].reverse());

  assert.deepEqual(first, second);
  assert.equal(first.status, "solved");
  assert.equal(first.usedGuessing, false);
  assert.equal(first.maximumDependencyDepth, 3);
  assert.ok(first.steps.some(step => step.rule === "direct-fact"));
  assert.ok(first.steps.some(step => step.rule === "constraint-propagation" && step.strategy.includes("same-row")));
  assert.ok(first.steps.some(step => step.strategy.includes("cross-category")));
  assert.ok(first.steps.some(step => step.strategy.includes("multi-step-chain")));

  const knownIds = new Set<string>();
  const eliminations = new Set<string>();
  for (const step of first.steps) {
    assert.ok(step.id && !knownIds.has(step.id));
    assert.ok(step.dependsOn.every(parent => knownIds.has(parent)), "dependencies must point to earlier deductions");
    assert.equal(step.dependencyDepth, step.dependsOn.length === 0
      ? 0
      : Math.max(...step.dependsOn.map(parent => first.steps.find(candidate => candidate.id === parent)!.dependencyDepth)) + 1);
    for (const candidate of step.eliminatedPossibilities) {
      const key = `${candidate.category}:${candidate.row}:${candidate.value}`;
      assert.equal(eliminations.has(key), false, "an eliminated possibility is recorded once");
      eliminations.add(key);
    }
    knownIds.add(step.id);
  }
  assert.equal(first.automaticPropagationSteps, first.steps.filter(step => step.triggeredAutomaticPropagation).length);
  assert.equal(first.unresolvedPossibilities, 0);
});

test("v5 deduction trace distinguishes a stalled puzzle from a contradiction", () => {
  const stalled = evaluateHumanDeductionTraceV5(spec, []);
  const contradictory: Clue[] = [
    clues[0]!,
    { id: "match-aki-blue", text: "Aki wore blue.", constraint: { kind: "matches", subject: "Aki", category: "color", value: "Blue" } },
  ];
  const contradiction = evaluateHumanDeductionTraceV5(spec, contradictory);

  assert.equal(stalled.status, "stalled");
  assert.equal(stalled.solved, false);
  assert.equal(contradiction.status, "contradiction");
  assert.equal(contradiction.solved, false);
});

test("v5 trace distinguishes negative clues and each supported relation strategy", () => {
  const negative = evaluateHumanDeductionTraceV5(spec, [{
    id: "ban-red",
    text: "Aki did not wear red.",
    constraint: { kind: "notMatches", subject: "Aki", category: "color", value: "Red" },
  }]);
  assert.ok(negative.steps.some(step => step.clueIds.includes("ban-red") && step.strategy.includes("elimination")));

  const relations = [
    { kind: "before", strategy: "ordering", constraint: { kind: "before", left: { category: "color", value: "Red" }, right: { category: "pet", value: "Cat" } } },
    { kind: "adjacent", strategy: "adjacency", constraint: { kind: "adjacent", left: { category: "color", value: "Red" }, right: { category: "pet", value: "Cat" } } },
    { kind: "sameRow", strategy: "same-row", constraint: { kind: "sameRow", left: { category: "color", value: "Red" }, right: { category: "pet", value: "Cat" } } },
    { kind: "distance", strategy: "distance", constraint: { kind: "distance", left: { category: "color", value: "Red" }, right: { category: "pet", value: "Cat" }, distance: 1 } },
  ] as const;
  for (const relation of relations) {
    const relationId = `relation-${relation.kind}`;
    const trace = evaluateHumanDeductionTraceV5(spec, [
      clues[0]!,
      { id: relationId, text: "A relationship clue.", constraint: relation.constraint },
    ]);
    assert.notEqual(trace.status, "contradiction", relation.kind);
    assert.ok(trace.steps.some(step => step.clueIds.includes(relationId) && step.strategy.includes(relation.strategy)), relation.kind);
  }
});

test("v5 assessment keeps normalized metrics separate from the trace and versioned band", () => {
  const trace = evaluateHumanDeductionTraceV5(spec, clues);
  const telemetry = solveWithTelemetry(spec, clues, 2).telemetry;
  const assessment = assessPuzzleDifficultyV5(spec, clues, trace, telemetry);

  assert.equal(assessment.modelVersion, DIFFICULTY_MODEL_V5);
  assert.equal(assessment.status, "complete");
  assert.ok(assessment.score >= 0 && assessment.score <= 100);
  for (const metric of Object.values(assessment.metrics)) {
    assert.ok(metric.score >= 0 && metric.score <= 100);
    assert.ok(metric.interpretation.length > 0);
  }
  assert.equal(assessment.metrics.reasoningDependencyDepth.raw.maximum, trace.maximumDependencyDepth);
  assert.equal(assessment.metrics.reasoningDependencyDepth.raw.distribution instanceof Array, true);
  assert.equal(DIFFICULTY_BANDS_V5.length, 12);
  assert.ok(DIFFICULTY_BANDS_V5.every((band, index) => band.minimumScore <= band.maximumScore
    && (index === 0 || band.minimumScore > DIFFICULTY_BANDS_V5[index - 1]!.maximumScore)));
});

test("comparison mode assesses the same v4 clue set and leaves the default response unchanged", () => {
  const baseline = generatePuzzle(spec, "compare-same-clues");
  const compared = generatePuzzle(spec, "compare-same-clues", undefined, { difficultyModel: "compare" });
  const optedIn = generatePuzzle(spec, "compare-same-clues", undefined, { difficultyModel: "v5" });

  assert.deepEqual(compared.clues, baseline.clues);
  assert.deepEqual(compared.difficulty, baseline.difficulty);
  assert.equal(baseline.difficultyProfile, undefined);
  assert.equal(compared.difficultyModel, "compare");
  assert.equal(compared.difficultyProfile?.legacy.modelVersion, baseline.difficulty.modelVersion);
  assert.equal(compared.difficultyProfile?.logical.modelVersion, DIFFICULTY_MODEL_V5);
  assert.equal(optedIn.difficulty.modelVersion, DIFFICULTY_MODEL_V5);
  assert.equal(optedIn.difficultyProfile?.logical.status, "complete");
  assert.equal(optedIn.id.includes(DIFFICULTY_MODEL_V5), true);
});

test("v5 target selection reports in-band candidates and measured score gaps", () => {
  const levelThreeBand = DIFFICULTY_BANDS_V5.find(band => band.level === 3)!;
  const selected = generatePuzzleAtDifficultyV5(tournamentOrderV2Template, "difficulty-v5-audit-target-tournament-order-v2-3-0", 3);
  const replayed = generatePuzzleAtDifficultyV5(tournamentOrderV2Template, "difficulty-v5-audit-target-tournament-order-v2-3-0", 3);

  assert.equal(selected.difficultyProfile?.logical.inDifficultyBand, true);
  assert.equal(selected.difficultyProfile?.logical.level, 3);
  assert.ok(selected.difficultyProfile!.logical.score >= levelThreeBand.minimumScore);
  assert.equal(selected.selectionDiagnostics?.modelVersion, DIFFICULTY_MODEL_V5);
  assert.ok((selected.selectionDiagnostics?.candidateScoreRange?.complete ?? 0) > 0);
  assert.equal(replayed.generationStrategy, selected.generationStrategy);
  assert.deepEqual(replayed.selectionDiagnostics, selected.selectionDiagnostics);
  assert.deepEqual(replayed.clues, selected.clues);

  const circuitLevelTenBand = DIFFICULTY_BANDS_V5.find(band => band.level === 10)!;
  assert.throws(() => generatePuzzleAtDifficultyV5(championshipCircuitTemplate, "difficulty-v5-audit-target-championship-circuit-v2-10-0", 10), error => {
    assert.ok(error instanceof DifficultyUnavailableError);
    assert.equal(error.diagnostics?.strategiesAttempted, 4);
    assert.equal(error.diagnostics?.eligibleCandidates, 0);
    assert.ok((error.diagnostics?.candidateScoreRange?.maximum ?? 100) < circuitLevelTenBand.minimumScore);
    return true;
  });
});
