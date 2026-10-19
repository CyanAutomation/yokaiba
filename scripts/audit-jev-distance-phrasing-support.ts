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

/** Pair the same saved v5 distance clue semantics with both wording variants. */
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
    const betweenCount = renderDistanceConstraintText(template, clue.structuredSemantics, variant, "between-count");
    const placesApart = renderDistanceConstraintText(template, clue.structuredSemantics, variant, "places-apart");
    const { phraseVariant: _phraseVariant, languageVersion: _languageVersion, ...pairedClue } = clue;
    return {
      templateId: clue.templateId,
      seed: clue.seed,
      sourceClueId: clue.clueId,
      // Keep every payload field except text identical so JEV cannot infer a
      // variant from version or phrase metadata.
      betweenCount: { ...pairedClue, text: betweenCount },
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
  bootstrapClusterCount: number;
  betweenCountMean: number | null;
  placesApartMean: number | null;
  placesApartMinusBetweenCountMean: number | null;
  confidenceInterval95: { lower: number; upper: number } | null;
  placesApartBetter: number;
  betweenCountBetter: number;
  tied: number;
}

export const DISTANCE_BOOTSTRAP_RESAMPLES = 2_000;

type DistanceMetricPair = {
  templateId?: string;
  seed?: string;
  betweenCount: AuditedClue;
  placesApart: AuditedClue;
};

type MetricObservation = { betweenCount: number; placesApart: number; clusterKey: string };

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    let value = state += 0x6d2b79f5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function clusterBootstrapMeanInterval(
  observations: readonly MetricObservation[],
  seedKey: string,
): { lower: number; upper: number } | null {
  if (observations.length === 0) return null;
  const clusters = new Map<string, number[]>();
  for (const [index, observation] of observations.entries()) {
    const clusterKey = observation.clusterKey || `unidentified-${index}`;
    const values = clusters.get(clusterKey) ?? [];
    values.push(observation.placesApart - observation.betweenCount);
    clusters.set(clusterKey, values);
  }
  const clusterValues = [...clusters.values()];
  if (clusterValues.length < 2) return null;
  const random = seededRandom(stableHash(seedKey));
  const means: number[] = [];
  for (let sample = 0; sample < DISTANCE_BOOTSTRAP_RESAMPLES; sample += 1) {
    let sum = 0;
    let count = 0;
    for (let draw = 0; draw < clusterValues.length; draw += 1) {
      const cluster = clusterValues[Math.floor(random() * clusterValues.length)]!;
      for (const difference of cluster) {
        sum += difference;
        count += 1;
      }
    }
    means.push(sum / count);
  }
  means.sort((left, right) => left - right);
  return {
    lower: Number(means[Math.floor((means.length - 1) * 0.025)]!.toFixed(4)),
    upper: Number(means[Math.ceil((means.length - 1) * 0.975)]!.toFixed(4)),
  };
}

export function summarizeDistanceMetric(
  pairs: readonly DistanceMetricPair[],
  metric: DistanceComparisonMetric,
  higherIsBetter: boolean,
): DistanceComparisonMetricSummary {
  const observations = pairs.flatMap((pair, index) => {
    const betweenCount = pair.betweenCount[metric];
    const placesApart = pair.placesApart[metric];
    if (betweenCount === undefined || placesApart === undefined) return [];
    const clusterKey = pair.templateId !== undefined && pair.seed !== undefined
      ? JSON.stringify([pair.templateId, pair.seed])
      : `unidentified-${index}`;
    return [{ betweenCount, placesApart, clusterKey }];
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
  const confidenceInterval95 = clusterBootstrapMeanInterval(observations, `${metric}:${observations.map(row => row.clusterKey).join("|")}`);
  return {
    pairedCount: observations.length,
    bootstrapClusterCount: new Set(observations.map(row => row.clusterKey)).size,
    betweenCountMean,
    placesApartMean,
    placesApartMinusBetweenCountMean: betweenCountMean === null || placesApartMean === null
      ? null
      : Number((placesApartMean - betweenCountMean).toFixed(4)),
    confidenceInterval95,
    placesApartBetter,
    betweenCountBetter,
    tied,
  };
}

export interface DistanceComparisonMarkdownInput {
  sourceReport: string;
  requestedModel: string;
  resolvedModel: string | null;
  pairCount: number;
  completePairs: number;
  totalCost: number;
  metrics: Record<DistanceComparisonMetric, DistanceComparisonMetricSummary>;
  byTemplate: Record<string, Record<DistanceComparisonMetric, DistanceComparisonMetricSummary>>;
}

export function renderDistanceComparisonMarkdown(report: DistanceComparisonMarkdownInput): string {
  const metricRows = (metrics: Record<DistanceComparisonMetric, DistanceComparisonMetricSummary>) =>
    (Object.keys(metrics) as DistanceComparisonMetric[]).map(key => {
      const metric = metrics[key];
      const interval = metric.confidenceInterval95
        ? `[${metric.confidenceInterval95.lower}, ${metric.confidenceInterval95.upper}]`
        : "n/a";
      return `| ${key} | ${metric.pairedCount} | ${metric.betweenCountMean ?? "n/a"} | ${metric.placesApartMean ?? "n/a"} | ${metric.placesApartMinusBetweenCountMean ?? "n/a"} | ${interval} | ${metric.placesApartBetter} / ${metric.betweenCountBetter} / ${metric.tied} |`;
    });
  const tableHeader = [
    "| Metric | Paired clues | Between-count mean | Places-apart mean | Places-apart minus between-count | 95% cluster-bootstrap CI for paired difference | Places-apart better / between-count better / tied |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  const templateTables = Object.entries(report.byTemplate).flatMap(([templateId, metrics]) => [
    `### ${templateId}`,
    "",
    ...tableHeader,
    ...metricRows(metrics),
    "",
  ]);
  return [
    "# JEV distance wording comparison",
    "",
    `Source report: \`${report.sourceReport}\``,
    `JEV model requested: \`${report.requestedModel}\`; resolved: \`${report.resolvedModel ?? "unknown"}\`.`,
    `Matched distance clues: ${report.pairCount}; complete pairs: ${report.completePairs}; provider cost: $${report.totalCost.toFixed(6)}.`,
    "",
    "The same saved v5 semantics were evaluated with the between-count and places-apart variants. Variant labels describe the tested text and do not imply which wording is current in the product.",
    `Uncertainty uses a deterministic 95% cluster bootstrap over puzzle seeds (${DISTANCE_BOOTSTRAP_RESAMPLES} resamples); clues from the same puzzle are sampled together.`,
    "Intervals are n/a when fewer than two puzzle-seed clusters contribute.",
    "",
    "## Overall",
    "",
    ...tableHeader,
    ...metricRows(report.metrics),
    "",
    "## By template",
    "",
    ...(templateTables.length ? templateTables : ["No per-template results were collected.", ""]),
    "Use the paired differences and intervals as triage evidence; validate wording choices with player observations before changing the product default.",
    "",
  ].join("\n");
}
