import assert from "node:assert/strict";
import test from "node:test";
import type { AuditedClue } from "../scripts/audit-jev-support.js";
import { buildDistancePhrasingPairs, renderDistanceComparisonMarkdown, selectAdverseDistanceExamples, summarizeDistanceMetric } from "../scripts/audit-jev-distance-phrasing-support.js";
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
    "The -60 kg competitor and the competitor who finished 3rd were exactly two places apart in the tournament order.");
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
    adverseExamples: { faithful: [], readability: [], relationshipExplicitness: [], misunderstandingRisk: [], ambiguous: [] },
  });

  assert.match(markdown, /between-count and places-apart variants/);
  assert.match(markdown, /Intervals are n\/a when fewer than two puzzle-seed clusters contribute\./);
  assert.match(markdown, /variation across generated puzzle clusters under this JEV model; they are not estimates of player outcomes\./);
  assert.match(markdown, /## By template/);
  assert.match(markdown, /### test-template/);
  assert.doesNotMatch(markdown, /current intervening-competitor|previously shipped places-apart|older wording/);
});

test("adverse distance examples follow metric direction, severity, deterministic ties, and skip missing scores", () => {
  const makePair = (templateId: string, seed: string, clueId: string, between: number | undefined, places: number | undefined) => ({
    templateId,
    seed,
    sourceClueId: clueId,
    betweenCount: distanceClue({ clueId, faithful: between, ambiguous: between, text: `between ${clueId}` }),
    placesApart: distanceClue({ clueId, faithful: places, ambiguous: places, text: `places ${clueId}` }),
  });
  const pairs = [
    makePair("z-template", "seed-2", "less-adverse", 0.5, 0.4),
    makePair("b-template", "seed-2", "tie-b", 0.5, 0.3),
    makePair("a-template", "seed-2", "tie-a", 0.5, 0.3),
    makePair("c-template", "seed-1", "most-adverse", 0.5, 0.1),
    makePair("d-template", "seed-1", "missing", undefined, 0.1),
    makePair("e-template", "seed-1", "favorable", 0.5, 0.6),
  ];

  const higherIsBetter = selectAdverseDistanceExamples(pairs, "faithful", true);
  assert.deepEqual(higherIsBetter.map(example => example.sourceClueId), ["most-adverse", "tie-a", "tie-b"]);
  assert.deepEqual(higherIsBetter.map(example => example.placesApartMinusBetweenCount), [-0.4, -0.2, -0.2]);
  assert.deepEqual(selectAdverseDistanceExamples([...pairs].reverse(), "faithful", true), higherIsBetter);

  const lowerIsBetter = selectAdverseDistanceExamples(pairs, "ambiguous", false);
  assert.deepEqual(lowerIsBetter.map(example => example.sourceClueId), ["favorable"]);
  assert.deepEqual(lowerIsBetter.map(example => Number(example.placesApartMinusBetweenCount.toFixed(4))), [0.1]);
});

test("distance wording markdown renders exploratory adverse examples with paired scores and text", () => {
  const summary = summarizeDistanceMetric([], "faithful", true);
  const adverseExamples = {
    faithful: [{ templateId: "cup", seed: "seed-1", sourceClueId: "distance-1", betweenCountScore: 0.8, placesApartScore: 0.4, placesApartMinusBetweenCount: -0.4, betweenCountText: "Exactly one competitor finished between A and B.", placesApartText: "A and B were exactly two places apart." }],
    readability: [],
    relationshipExplicitness: [],
    misunderstandingRisk: [],
    ambiguous: [],
  };
  const markdown = renderDistanceComparisonMarkdown({
    sourceReport: "saved-v5.json",
    requestedModel: "~typesafe/jev-latest",
    resolvedModel: "typesafe/jev-1.14",
    pairCount: 1,
    completePairs: 1,
    totalCost: 0,
    metrics: {
      faithful: summary,
      readability: summary,
      relationshipExplicitness: summary,
      misunderstandingRisk: summary,
      ambiguous: summary,
    },
    byTemplate: {},
    adverseExamples,
  });

  assert.match(markdown, /## Exploratory adverse paired examples/);
  assert.match(markdown, /cup \| seed-1 \| distance-1 \| 0\.8000 \| 0\.4000 \| -0\.4000/);
  assert.match(markdown, /Exactly one competitor finished between A and B\./);
  assert.match(markdown, /A and B were exactly two places apart\./);
  assert.match(markdown, /exploratory examples.*not evidence about player outcomes/i);
});
