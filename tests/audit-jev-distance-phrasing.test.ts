import assert from "node:assert/strict";
import test from "node:test";
import type { AuditedClue } from "../scripts/audit-jev-support.js";
import { buildDistancePhrasingPairs, renderDistanceComparisonMarkdown, summarizeDistanceMetric } from "../scripts/audit-jev-distance-phrasing-support.js";
import { tournamentOrderTemplate } from "../src/templates/tournament-order.js";

function distanceClue(overrides: Partial<AuditedClue> = {}): AuditedClue {
  return {
    templateId: tournamentOrderTemplate.id,
    seed: "paired-seed",
    clueId: "distance-weight-placing-0-2",
    text: "Exactly one competitor finished between the -60 kg competitor and the competitor who finished 3rd in the tournament order.",
    expectedSemantics: "The positions of -60 kg in weight and 3rd in placing differ by exactly 2.",
    constraintKind: "distance",
    structuredSemantics: {
      kind: "distance",
      left: { category: "weight", value: "-60 kg" },
      right: { category: "placing", value: "3rd" },
      distance: 2,
    },
    phraseVariant: "distance-1",
    languageVersion: "yokaiba-clue-prose-v7",
    logicalDifficultyLevel: 4,
    difficultyModelVersion: "yokaiba-difficulty-v5",
    evaluationStatus: "complete",
    missingAnswers: [],
    flagged: false,
    flagReasons: [],
    ...overrides,
  };
}

test("distance wording pairs preserve saved v5 semantics and render both comparison variants", () => {
  const source = distanceClue({ text: "Text saved before the current wording was rendered." });
  const pair = buildDistancePhrasingPairs([source], [tournamentOrderTemplate])[0]!;

  assert.equal(pair.seed, source.seed);
  assert.equal(pair.sourceClueId, source.clueId);
  assert.equal(pair.betweenCount.text,
    "Exactly one competitor finished between the -60 kg competitor and the competitor who finished 3rd in the tournament order.");
  assert.deepEqual(pair.betweenCount.structuredSemantics, pair.placesApart.structuredSemantics);
  assert.equal(pair.betweenCount.languageVersion, undefined);
  assert.equal(pair.placesApart.languageVersion, undefined);
  assert.equal(pair.betweenCount.phraseVariant, undefined);
  assert.equal(pair.placesApart.phraseVariant, undefined);
  assert.deepEqual({ ...pair.betweenCount, text: "" }, { ...pair.placesApart, text: "" });
  assert.equal(pair.placesApart.text,
    "the -60 kg competitor and the competitor who finished 3rd were exactly two places apart in the tournament order.");
});

test("distance wording pairing ignores other clue kinds and reports paired metric direction", () => {
  const source = distanceClue();
  const other = distanceClue({ clueId: "same-row", constraintKind: "sameRow" });
  const [base] = buildDistancePhrasingPairs([source, other], [tournamentOrderTemplate]);
  const summary = summarizeDistanceMetric([
    {
      templateId: source.templateId,
      seed: source.seed,
      betweenCount: { ...base!.betweenCount, misunderstandingRisk: 0.4 },
      placesApart: { ...base!.placesApart, misunderstandingRisk: 0.2 },
    },
    {
      templateId: source.templateId,
      seed: source.seed,
      betweenCount: { ...base!.betweenCount, misunderstandingRisk: 0.3 },
      placesApart: { ...base!.placesApart, misunderstandingRisk: 0.3 },
    },
  ], "misunderstandingRisk", false);

  assert.equal(buildDistancePhrasingPairs([source, other], [tournamentOrderTemplate]).length, 1);
  assert.equal(summary.pairedCount, 2);
  assert.equal(summary.bootstrapClusterCount, 1);
  assert.equal(summary.betweenCountMean, 0.35);
  assert.equal(summary.placesApartMean, 0.25);
  assert.equal(summary.placesApartMinusBetweenCountMean, -0.1);
  assert.equal(summary.placesApartBetter, 1);
  assert.equal(summary.betweenCountBetter, 0);
  assert.equal(summary.tied, 1);
  assert.equal(summary.confidenceInterval95, null);
});

test("paired distance wording summaries provide stable cluster-bootstrap uncertainty", () => {
  const pair = buildDistancePhrasingPairs([distanceClue()], [tournamentOrderTemplate])[0]!;
  const evaluated = [0.1, 0.2, 0.4].map((difference, index) => ({
    templateId: pair.templateId,
    seed: `seed-${index}`,
    betweenCount: { ...pair.betweenCount, faithful: 0.5 },
    placesApart: { ...pair.placesApart, faithful: 0.5 + difference },
  }));

  const first = summarizeDistanceMetric(evaluated, "faithful", true);
  const second = summarizeDistanceMetric(evaluated, "faithful", true);

  assert.deepEqual(first, second);
  assert.equal(first.pairedCount, 3);
  assert.ok(first.confidenceInterval95);
  assert.ok(first.confidenceInterval95.lower <= first.placesApartMinusBetweenCountMean!);
  assert.ok(first.confidenceInterval95.upper >= first.placesApartMinusBetweenCountMean!);
});

test("distance wording markdown describes variants without assuming which is current", () => {
  const summary = summarizeDistanceMetric([], "faithful", true);
  const markdown = renderDistanceComparisonMarkdown({
    sourceReport: "saved-v5.json",
    requestedModel: "~typesafe/jev-latest",
    resolvedModel: "typesafe/jev-1.14",
    pairCount: 0,
    completePairs: 0,
    totalCost: 0,
    metrics: {
      faithful: summary,
      readability: summary,
      relationshipExplicitness: summary,
      misunderstandingRisk: summary,
      ambiguous: summary,
    },
    byTemplate: {
      "test-template": {
        faithful: summary,
        readability: summary,
        relationshipExplicitness: summary,
        misunderstandingRisk: summary,
        ambiguous: summary,
      },
    },
  });

  assert.match(markdown, /between-count and places-apart variants/);
  assert.match(markdown, /Intervals are n\/a when fewer than two puzzle-seed clusters contribute\./);
  assert.match(markdown, /## By template/);
  assert.match(markdown, /### test-template/);
  assert.doesNotMatch(markdown, /current intervening-competitor|previously shipped places-apart|older wording/);
});
