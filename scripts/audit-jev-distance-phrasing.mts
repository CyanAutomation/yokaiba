import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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
  parseJevAuditReport,
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
import {
  assertDistanceComparisonOutputPaths,
  assertDistanceComparisonConfiguration,
  hasDistanceComparisonMetrics,
  isDistanceComparisonPairComplete,
  parseDistanceComparisonArguments,
  readDistanceComparisonCheckpoint,
  writeDistanceComparisonCheckpoint,
  type DistanceComparisonCheckpoint,
} from "./audit-jev-distance-checkpoint.js";

const templates = [tournamentOrderTemplate, tournamentOrderV2Template, openDivisionTemplate, championshipBridgeTemplate, championshipCircuitTemplate];
const ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
const METRICS: Array<{ key: DistanceComparisonMetric; higherIsBetter: boolean }> = [
  { key: "faithful", higherIsBetter: true },
  { key: "readability", higherIsBetter: true },
  { key: "relationshipExplicitness", higherIsBetter: true },
  { key: "misunderstandingRisk", higherIsBetter: false },
  { key: "ambiguous", higherIsBetter: false },
];

const args = parseDistanceComparisonArguments(process.argv.slice(2));
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set; the distance wording comparison was not run.");
const sourcePath = resolve(args.report);
const sourceText = await readFile(sourcePath, "utf8");
const source = parseJevAuditReport(sourceText, sourcePath);
if (source.configuration.generationModelVersion !== "yokaiba-difficulty-v5") {
  throw new Error(`source report must use v5, found ${source.configuration.generationModelVersion}`);
}
const pairs = buildDistancePhrasingPairs(source.clueAudit.clues, templates);
if (pairs.length === 0) throw new Error("source report contains no distance clues to compare");
const requestedModel = JEV_REQUESTED_MODEL;
const endpoint = source.configuration.endpoint || ENDPOINT;
const outputBase = resolve(args.outputBase);
const outputPath = resolve(`${args.outputBase}.json`);
const markdownPath = resolve(`${args.outputBase}.md`);
assertDistanceComparisonOutputPaths(sourcePath, [outputPath, markdownPath]);
const checkpointPath = `${outputBase}.checkpoint.json`;
const checkpointConfiguration = {
  sourceReport: sourcePath,
  sourceFingerprint: createHash("sha256").update(sourceText).digest("hex"),
  generationModelVersion: source.configuration.generationModelVersion,
  requestedModel,
  endpoint,
  batchSize: args.batchSize,
  pairCount: pairs.length,
};
let checkpoint: DistanceComparisonCheckpoint;
if (args.resume) {
  const saved = await readDistanceComparisonCheckpoint(checkpointPath);
  if (!saved) throw new Error(`cannot resume: no distance comparison checkpoint found at ${checkpointPath}`);
  assertDistanceComparisonConfiguration(saved.configuration, checkpointConfiguration);
  checkpoint = saved;
} else {
  if (await readDistanceComparisonCheckpoint(checkpointPath)) {
    throw new Error(`distance comparison checkpoint already exists at ${checkpointPath}; use --resume or choose a new --out path`);
  }
  checkpoint = {
    version: 1,
    configuration: checkpointConfiguration,
    pairs,
    usage: {
      resolvedModel: null,
      resolvedModelsByPhase: {
        clue: { models: [], attribution: "phase-specific" },
        puzzle: { models: [], attribution: "phase-specific" },
      },
      totalCost: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
    },
  };
  await writeDistanceComparisonCheckpoint(checkpointPath, checkpoint);
}

try {
  for (let offset = 0; offset < checkpoint.pairs.length; offset += args.batchSize) {
    const batch = checkpoint.pairs.slice(offset, offset + args.batchSize);
    const mapping: Array<{ pairIndex: number; variant: "betweenCount" | "placesApart"; clue: AuditedClue }> = [];
    const inputs: AuditedClue[] = [];
    for (const [batchIndex, pair] of batch.entries()) {
      const pairIndex = offset + batchIndex;
      const orderedVariants: Array<"betweenCount" | "placesApart"> = pairIndex % 2 === 0
        ? ["betweenCount", "placesApart"]
        : ["placesApart", "betweenCount"];
      for (const variant of orderedVariants) {
        const clue = pair[variant];
        if (hasDistanceComparisonMetrics(clue)) continue;
        const indexedClue = { ...clue, clueId: pair.sourceClueId };
        mapping.push({ pairIndex, variant, clue: indexedClue });
        inputs.push(indexedClue);
      }
    }
    if (inputs.length === 0) continue;
    const response = await requestJevDecisionBatch(apiKey, buildLatestClueDecisionPayload(inputs), endpoint);
    if (checkpoint.usage.resolvedModel && response.model && checkpoint.usage.resolvedModel !== response.model) {
      throw new Error(`JEV model changed during paired comparison (${checkpoint.usage.resolvedModel} -> ${response.model})`);
    }
    accumulateResponseUsage(checkpoint.usage, response, "clue");
    for (const [index, item] of mapping.entries()) {
      checkpoint.pairs[item.pairIndex]![item.variant] = applyJevAnswers(item.clue, response.answers, index);
    }
    await writeDistanceComparisonCheckpoint(checkpointPath, checkpoint);
    const complete = checkpoint.pairs.filter(isDistanceComparisonPairComplete).length;
    console.error(`JEV wording comparison ${complete}/${checkpoint.pairs.length} complete distance clue pairs`);
  }
} catch (error) {
  console.error(`JEV distance comparison stopped; checkpoint retained at ${checkpointPath}. Resume with --report ${sourcePath} --out ${outputBase} --batch-size ${args.batchSize} --resume.`);
  throw error;
}

const evaluated = checkpoint.pairs;
const usage = checkpoint.usage;

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
const completePairs = evaluated.filter(isDistanceComparisonPairComplete).length;
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
      evaluationStatus: hasDistanceComparisonMetrics(pair.betweenCount) ? "complete" : "incomplete",
      faithful: pair.betweenCount.faithful,
      readability: pair.betweenCount.readability,
      relationshipExplicitness: pair.betweenCount.relationshipExplicitness,
      misunderstandingRisk: pair.betweenCount.misunderstandingRisk,
      ambiguous: pair.betweenCount.ambiguous,
    },
    placesApart: {
      text: pair.placesApart.text,
      evaluationStatus: hasDistanceComparisonMetrics(pair.placesApart) ? "complete" : "incomplete",
      faithful: pair.placesApart.faithful,
      readability: pair.placesApart.readability,
      relationshipExplicitness: pair.placesApart.relationshipExplicitness,
      misunderstandingRisk: pair.placesApart.misunderstandingRisk,
      ambiguous: pair.placesApart.ambiguous,
    },
  })),
};
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
if (completePairs === evaluated.length) {
  await unlink(checkpointPath).catch(error => {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
  });
} else {
  console.error(`The comparison is incomplete. Checkpoint kept at ${checkpointPath}; rerun with --report ${sourcePath} --out ${outputBase} --batch-size ${args.batchSize} --resume to retry missing metric answers.`);
}
console.log(JSON.stringify({ json: outputPath, markdown: markdownPath, pairCount: pairs.length, completePairs, resolvedModel: usage.resolvedModel, cost: usage.totalCost }, null, 2));
