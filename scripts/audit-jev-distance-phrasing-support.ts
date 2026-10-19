import type { PuzzleTemplate } from "../src/domain/types.js";
import { renderDistanceConstraintText } from "../src/generation/clue-language.js";
import type { AuditedClue } from "./audit-jev-support.js";

export interface DistancePhrasingPair {
  templateId: string;
  seed: string;
  sourceClueId: string;
  betweenCount: AuditedClue;
  placesApart: AuditedClue;
}

/** Pair the saved v5 distance clue with the previous shipped distance wording. */
export function buildDistancePhrasingPairs(
  clues: readonly AuditedClue[],
  templates: readonly PuzzleTemplate[],
): DistancePhrasingPair[] {
  const templateById = new Map(templates.map(template => [template.id, template]));
  return clues.filter(clue => clue.constraintKind === "distance").map(clue => {
    if (clue.structuredSemantics.kind !== "distance") {
      throw new Error(`distance clue ${clue.templateId}/${clue.seed}/${clue.clueId} has non-distance semantics`);
    }
    const template = templateById.get(clue.templateId);
    if (!template) throw new Error(`unknown template ${clue.templateId} for distance clue ${clue.clueId}`);
    const variant = Number(/distance-(\d+)/.exec(clue.phraseVariant ?? "")?.[1] ?? 0);
    const placesApart = renderDistanceConstraintText(template, clue.structuredSemantics, variant, "places-apart");
    const { phraseVariant: _phraseVariant, languageVersion: _languageVersion, ...pairedClue } = clue;
    return {
      templateId: clue.templateId,
      seed: clue.seed,
      sourceClueId: clue.clueId,
      // Keep every payload field except text identical so JEV cannot infer a
      // variant from version or phrase metadata.
      betweenCount: { ...pairedClue },
      placesApart: {
        ...pairedClue,
        text: placesApart,
      },
    };
  });
}

export type DistanceComparisonMetric = "faithful" | "readability" | "relationshipExplicitness" | "misunderstandingRisk" | "ambiguous";

export interface DistanceComparisonMetricSummary {
  pairedCount: number;
  betweenCountMean: number | null;
  placesApartMean: number | null;
  placesApartMinusBetweenCountMean: number | null;
  placesApartBetter: number;
  betweenCountBetter: number;
  tied: number;
}

export function summarizeDistanceMetric(
  pairs: readonly { betweenCount: AuditedClue; placesApart: AuditedClue }[],
  metric: DistanceComparisonMetric,
  higherIsBetter: boolean,
): DistanceComparisonMetricSummary {
  const observations = pairs.flatMap(pair => {
    const betweenCount = pair.betweenCount[metric];
    const placesApart = pair.placesApart[metric];
    return betweenCount === undefined || placesApart === undefined ? [] : [{ betweenCount, placesApart }];
  });
  const mean = (values: readonly number[]) => values.length
    ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4))
    : null;
  let placesApartBetter = 0;
  let betweenCountBetter = 0;
  let tied = 0;
  for (const pair of observations) {
    const delta = pair.placesApart - pair.betweenCount;
    if (delta === 0) tied += 1;
    else if ((delta > 0) === higherIsBetter) placesApartBetter += 1;
    else betweenCountBetter += 1;
  }
  const betweenCountMean = mean(observations.map(pair => pair.betweenCount));
  const placesApartMean = mean(observations.map(pair => pair.placesApart));
  return {
    pairedCount: observations.length,
    betweenCountMean,
    placesApartMean,
    placesApartMinusBetweenCountMean: betweenCountMean === null || placesApartMean === null
      ? null
      : Number((placesApartMean - betweenCountMean).toFixed(4)),
    placesApartBetter,
    betweenCountBetter,
    tied,
  };
}
