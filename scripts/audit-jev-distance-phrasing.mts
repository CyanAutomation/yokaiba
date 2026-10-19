import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { championshipBridgeTemplate } from "../src/templates/championship-bridge.js";
import { championshipCircuitTemplate } from "../src/templates/championship-circuit.js";
import { openDivisionTemplate } from "../src/templates/open-division.js";
import { tournamentOrderTemplate } from "../src/templates/tournament-order.js";
import { tournamentOrderV2Template } from "../src/templates/tournament-order-v2.js";
import {
  accumulateResponseUsage,
  applyJevAnswers,
  buildClueDecisionPayload,
  readJevAuditReport,
  requestJevDecisionBatch,
  type AuditedClue,
} from "./audit-jev-support.js";
import { buildDistancePhrasingPairs, summarizeDistanceMetric, type DistanceComparisonMetric } from "./audit-jev-distance-phrasing-support.js";

const templates = [tournamentOrderTemplate, tournamentOrderV2Template, openDivisionTemplate, championshipBridgeTemplate, championshipCircuitTemplate];
const ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
const METRICS: Array<{ key: DistanceComparisonMetric; higherIsBetter: boolean }> = [
  { key: "faithful", higherIsBetter: true },
  { key: "readability", higherIsBetter: true },
  { key: "relationshipExplicitness", higherIsBetter: true },
  { key: "misunderstandingRisk", higherIsBetter: false },
  { key: "ambiguous", higherIsBetter: false },
];

function parseArguments(argv: readonly string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]!;
    if (!["--report", "--out", "--batch-size"].includes(option)) throw new Error(`unknown option ${option}`);
    if (values.has(option)) throw new Error(`duplicate option ${option}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
    values.set(option, value);
  }
  const report = values.get("--report");
  const outputBase = values.get("--out");
  if (!report) throw new Error("--report requires a saved v5 JEV report");
  if (!outputBase) throw new Error("--out requires a base path without a JSON or Markdown extension");
  if (/\.(?:json|md)$/i.test(outputBase)) throw new Error("--out takes a base path without a JSON or Markdown extension");
  const batchSize = Number(values.get("--batch-size") ?? 10);
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) throw new Error("--batch-size must be a positive integer");
  return { report, outputBase, batchSize };
}

function renderMarkdown(report: {
  sourceReport: string;
  requestedModel: string;
  resolvedModel: string | null;
  pairCount: number;
  completePairs: number;
  totalCost: number;
  metrics: Record<DistanceComparisonMetric, ReturnType<typeof summarizeDistanceMetric>>;
}) {
  const rows = METRICS.map(({ key }) => {
    const metric = report.metrics[key];
    return `| ${key} | ${metric.pairedCount} | ${metric.betweenCountMean ?? "n/a"} | ${metric.placesApartMean ?? "n/a"} | ${metric.placesApartMinusBetweenCountMean ?? "n/a"} | ${metric.placesApartBetter} / ${metric.betweenCountBetter} / ${metric.tied} |`;
  });
  return [
    "# JEV distance wording comparison",
    "",
    `Source report: \`${report.sourceReport}\``,
    `JEV model requested: \`${report.requestedModel}\`; resolved: \`${report.resolvedModel ?? "unknown"}\`.`,
    `Matched distance clues: ${report.pairCount}; complete pairs: ${report.completePairs}; provider cost: $${report.totalCost.toFixed(6)}.`,
    "",
    "The same saved v5 distance clue semantics were evaluated with both the current intervening-competitor wording and the previously shipped places-apart wording. Positive deltas favor places-apart for higher-is-better metrics; negative deltas favor it for risk and ambiguity metrics.",
    "",
    "| Metric | Paired | Between-count mean | Places-apart mean | Places-apart minus between-count | Places-apart better / between-count better / tied |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...rows,
    "",
    "Treat this comparison as a triage signal. Consider the older wording only if its faithfulness or misunderstanding-risk results improve while readability does not fall; if paired results do not show that pattern, keep the current wording.",
    "",
  ].join("\n");
}

const args = parseArguments(process.argv.slice(2));
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set; the distance wording comparison was not run.");
const sourcePath = resolve(args.report);
const source = await readJevAuditReport(sourcePath);
if (source.configuration.generationModelVersion !== "yokaiba-difficulty-v5") {
  throw new Error(`source report must use v5, found ${source.configuration.generationModelVersion}`);
}
const pairs = buildDistancePhrasingPairs(source.clueAudit.clues, templates);
if (pairs.length === 0) throw new Error("source report contains no distance clues to compare");
const requestedModel = source.configuration.resolvedModel ?? source.clueAudit.model;
if (!requestedModel) throw new Error("source report does not identify a resolved JEV model for a controlled comparison");
const endpoint = source.configuration.endpoint || ENDPOINT;
const usage = { resolvedModel: null as string | null, totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0 };
const evaluated: Array<{ betweenCount: AuditedClue; placesApart: AuditedClue }> = [];

for (let offset = 0; offset < pairs.length; offset += args.batchSize) {
  const batch = pairs.slice(offset, offset + args.batchSize);
  const inputs = batch.flatMap((pair, index) => {
    const sharedClueId = pair.sourceClueId;
    const betweenCount = { ...pair.betweenCount, clueId: sharedClueId };
    const placesApart = { ...pair.placesApart, clueId: sharedClueId };
    return (offset + index) % 2 === 0 ? [betweenCount, placesApart] : [placesApart, betweenCount];
  });
  const response = await requestJevDecisionBatch(apiKey, buildClueDecisionPayload(requestedModel, inputs), endpoint);
  if (usage.resolvedModel && response.model && usage.resolvedModel !== response.model) {
    throw new Error(`JEV model changed during paired comparison (${usage.resolvedModel} -> ${response.model})`);
  }
  accumulateResponseUsage(usage, response);
  for (let index = 0; index < batch.length; index += 1) {
    const isReversed = (offset + index) % 2 === 1;
    const betweenCount = inputs[index * 2 + (isReversed ? 1 : 0)]!;
    const placesApart = inputs[index * 2 + (isReversed ? 0 : 1)]!;
    const betweenCountIndex = index * 2 + (isReversed ? 1 : 0);
    const placesApartIndex = index * 2 + (isReversed ? 0 : 1);
    evaluated.push({
      betweenCount: applyJevAnswers(betweenCount, response.answers, betweenCountIndex),
      placesApart: applyJevAnswers(placesApart, response.answers, placesApartIndex),
    });
  }
  console.error(`JEV wording comparison ${Math.min(offset + batch.length, pairs.length)}/${pairs.length} distance clues`);
}

const metrics = Object.fromEntries(METRICS.map(({ key, higherIsBetter }) => [
  key,
  summarizeDistanceMetric(evaluated, key, higherIsBetter),
])) as Record<DistanceComparisonMetric, ReturnType<typeof summarizeDistanceMetric>>;
const completePairs = evaluated.filter(pair => pair.betweenCount.evaluationStatus === "complete" && pair.placesApart.evaluationStatus === "complete").length;
const report = {
  reportVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceReport: sourcePath,
  generationModelVersion: source.configuration.generationModelVersion,
  requestedModel,
  resolvedModel: usage.resolvedModel,
  endpoint,
  pairCount: pairs.length,
  completePairs,
  totalCost: usage.totalCost,
  totalInputTokens: usage.totalInputTokens,
  totalOutputTokens: usage.totalOutputTokens,
  metrics,
  pairs: evaluated.map((pair, index) => ({
    templateId: pairs[index]!.templateId,
    seed: pairs[index]!.seed,
    sourceClueId: pairs[index]!.sourceClueId,
    betweenCount: {
      text: pair.betweenCount.text,
      evaluationStatus: pair.betweenCount.evaluationStatus,
      faithful: pair.betweenCount.faithful,
      readability: pair.betweenCount.readability,
      relationshipExplicitness: pair.betweenCount.relationshipExplicitness,
      misunderstandingRisk: pair.betweenCount.misunderstandingRisk,
      ambiguous: pair.betweenCount.ambiguous,
    },
    placesApart: {
      text: pair.placesApart.text,
      evaluationStatus: pair.placesApart.evaluationStatus,
      faithful: pair.placesApart.faithful,
      readability: pair.placesApart.readability,
      relationshipExplicitness: pair.placesApart.relationshipExplicitness,
      misunderstandingRisk: pair.placesApart.misunderstandingRisk,
      ambiguous: pair.placesApart.ambiguous,
    },
  })),
};
const outputPath = resolve(`${args.outputBase}.json`);
const markdownPath = resolve(`${args.outputBase}.md`);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(markdownPath, renderMarkdown({
  sourceReport: sourcePath,
  requestedModel,
  resolvedModel: usage.resolvedModel,
  pairCount: pairs.length,
  completePairs,
  totalCost: usage.totalCost,
  metrics,
}));
console.log(JSON.stringify({ json: outputPath, markdown: markdownPath, pairCount: pairs.length, completePairs, resolvedModel: usage.resolvedModel, cost: usage.totalCost }, null, 2));
