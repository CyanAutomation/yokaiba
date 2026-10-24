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
  buildLatestClueDecisionPayload,
  readJevAuditReport,
  requestJevDecisionBatch,
  JEV_REQUESTED_MODEL,
  type AuditedClue,
} from "./audit-jev-support.js";
import {
  buildDistancePhrasingPairs,
  DISTANCE_BOOTSTRAP_RESAMPLES,
  renderDistanceComparisonMarkdown,
  selectAdverseDistanceExamples,
  summarizeDistanceMetric,
  type DistanceComparisonMetric,
} from "./audit-jev-distance-phrasing-support.js";

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
const requestedModel = JEV_REQUESTED_MODEL;
const endpoint = source.configuration.endpoint || ENDPOINT;
const usage = {
  resolvedModel: null as string | null,
  resolvedModelsByPhase: {
    clue: { models: [] as string[], attribution: "phase-specific" as const },
    puzzle: { models: [] as string[], attribution: "phase-specific" as const },
  },
  totalCost: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
};
const evaluated: Array<{ templateId: string; seed: string; sourceClueId: string; betweenCount: AuditedClue; placesApart: AuditedClue }> = [];

for (let offset = 0; offset < pairs.length; offset += args.batchSize) {
  const batch = pairs.slice(offset, offset + args.batchSize);
  const inputs = batch.flatMap((pair, index) => {
    const sharedClueId = pair.sourceClueId;
    const betweenCount = { ...pair.betweenCount, clueId: sharedClueId };
    const placesApart = { ...pair.placesApart, clueId: sharedClueId };
    return (offset + index) % 2 === 0 ? [betweenCount, placesApart] : [placesApart, betweenCount];
  });
  const response = await requestJevDecisionBatch(apiKey, buildLatestClueDecisionPayload(inputs), endpoint);
  if (usage.resolvedModel && response.model && usage.resolvedModel !== response.model) {
    throw new Error(`JEV model changed during paired comparison (${usage.resolvedModel} -> ${response.model})`);
  }
  accumulateResponseUsage(usage, response, "clue");
  for (let index = 0; index < batch.length; index += 1) {
    const isReversed = (offset + index) % 2 === 1;
    const betweenCount = inputs[index * 2 + (isReversed ? 1 : 0)]!;
    const placesApart = inputs[index * 2 + (isReversed ? 0 : 1)]!;
    const betweenCountIndex = index * 2 + (isReversed ? 1 : 0);
    const placesApartIndex = index * 2 + (isReversed ? 0 : 1);
    evaluated.push({
      templateId: batch[index]!.templateId,
      seed: batch[index]!.seed,
      sourceClueId: batch[index]!.sourceClueId,
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
const templateIds = [...new Set(pairs.map(pair => pair.templateId))];
const byTemplate = Object.fromEntries(templateIds.map(templateId => [
  templateId,
  Object.fromEntries(METRICS.map(({ key, higherIsBetter }) => [
    key,
    summarizeDistanceMetric(evaluated.filter(pair => pair.templateId === templateId), key, higherIsBetter),
  ])) as Record<DistanceComparisonMetric, ReturnType<typeof summarizeDistanceMetric>>,
])) as Record<string, Record<DistanceComparisonMetric, ReturnType<typeof summarizeDistanceMetric>>>;
const adverseExamples = Object.fromEntries(METRICS.map(({ key, higherIsBetter }) => [
  key,
  selectAdverseDistanceExamples(evaluated, key, higherIsBetter),
])) as Parameters<typeof renderDistanceComparisonMarkdown>[0]["adverseExamples"];
const completePairs = evaluated.filter(pair => pair.betweenCount.evaluationStatus === "complete" && pair.placesApart.evaluationStatus === "complete").length;
const report = {
  reportVersion: 2,
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
  uncertainty: { method: "cluster-bootstrap-percentile", confidenceLevel: 0.95, resamples: DISTANCE_BOOTSTRAP_RESAMPLES, clusterKey: "templateId+seed" },
  metrics,
  byTemplate,
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
await writeFile(markdownPath, renderDistanceComparisonMarkdown({
  sourceReport: sourcePath,
  requestedModel,
  resolvedModel: usage.resolvedModel,
  pairCount: pairs.length,
  completePairs,
  totalCost: usage.totalCost,
  metrics,
  byTemplate,
  adverseExamples,
}));
console.log(JSON.stringify({ json: outputPath, markdown: markdownPath, pairCount: pairs.length, completePairs, resolvedModel: usage.resolvedModel, cost: usage.totalCost }, null, 2));
