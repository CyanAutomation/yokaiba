import { parseCliOptions } from "./audit-jev-cli-arguments.js";
import { readJsonFileIfExists, writeJsonFileAtomically } from "./audit-json-file.js";
import type { AuditedClue } from "./audit-jev-support.js";
import type { DistancePhrasingPair } from "./audit-jev-distance-phrasing-support.js";

export interface DistanceComparisonConfiguration {
  sourceReport: string;
  sourceFingerprint: string;
  generationModelVersion: string;
  requestedModel: string;
  endpoint: string;
  batchSize: number;
  pairCount: number;
}

export interface EvaluatedDistancePhrasingPair extends DistancePhrasingPair {
  betweenCount: AuditedClue;
  placesApart: AuditedClue;
}

export interface DistanceComparisonCheckpoint {
  version: 1;
  configuration: DistanceComparisonConfiguration;
  pairs: EvaluatedDistancePhrasingPair[];
  usage: {
    resolvedModel: string | null;
    resolvedModelsByPhase: {
      clue: { models: string[]; attribution: "phase-specific" };
      puzzle: { models: string[]; attribution: "phase-specific" };
    };
    totalCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  };
}

export function parseDistanceComparisonArguments(argv: readonly string[]) {
  const { values, flags } = parseCliOptions(argv, ["--report", "--out", "--batch-size"], ["--resume"]);
  const resume = flags.has("--resume");
  const report = values.get("--report");
  const outputBase = values.get("--out");
  if (!report) throw new Error("--report requires a saved v5 JEV report");
  if (resume && !outputBase) throw new Error("--resume requires --out");
  if (!outputBase) throw new Error("--out requires a base path without a JSON or Markdown extension");
  if (/\.(?:json|md)$/i.test(outputBase)) throw new Error("--out takes a base path without a JSON or Markdown extension");
  const batchSize = Number(values.get("--batch-size") ?? 10);
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) throw new Error("--batch-size must be a positive integer");
  return { report, outputBase, batchSize, resume };
}

export function assertDistanceComparisonOutputPaths(sourcePath: string, outputPaths: readonly string[]): void {
  if (outputPaths.includes(sourcePath)) throw new Error("--out must identify files different from --report");
}

const comparisonMetrics: Array<keyof Pick<AuditedClue, "faithful" | "readability" | "relationshipExplicitness" | "misunderstandingRisk" | "ambiguous">> = [
  "faithful", "readability", "relationshipExplicitness", "misunderstandingRisk", "ambiguous",
];

export function hasDistanceComparisonMetrics(clue: AuditedClue): boolean {
  return comparisonMetrics.every(metric => typeof clue[metric] === "number" && Number.isFinite(clue[metric]));
}

export function isDistanceComparisonPairComplete(pair: DistancePhrasingPair): boolean {
  return hasDistanceComparisonMetrics(pair.betweenCount) && hasDistanceComparisonMetrics(pair.placesApart);
}

export function assertDistanceComparisonConfiguration(
  actual: DistanceComparisonConfiguration,
  expected: DistanceComparisonConfiguration,
): void {
  const keys: (keyof DistanceComparisonConfiguration)[] = [
    "sourceReport", "sourceFingerprint", "generationModelVersion", "requestedModel", "endpoint", "batchSize", "pairCount",
  ];
  const mismatches = keys.filter(key => actual[key] !== expected[key]);
  if (mismatches.length > 0) throw new Error(`distance comparison checkpoint configuration does not match: ${mismatches.join(", ")}`);
}

export async function writeDistanceComparisonCheckpoint(path: string, checkpoint: DistanceComparisonCheckpoint): Promise<void> {
  await writeJsonFileAtomically(path, checkpoint);
}

export async function readDistanceComparisonCheckpoint(path: string): Promise<DistanceComparisonCheckpoint | undefined> {
  const source = await readJsonFileIfExists(path);
  if (source === undefined) return undefined;
  const checkpoint = source as Partial<DistanceComparisonCheckpoint>;
  if (!checkpoint || checkpoint.version !== 1 || !checkpoint.configuration || !Array.isArray(checkpoint.pairs)
    || !checkpoint.usage || typeof checkpoint.usage !== "object") {
    throw new Error(`invalid distance comparison checkpoint: ${path}`);
  }
  return checkpoint as DistanceComparisonCheckpoint;
}
