import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
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
  const values = new Map<string, string>();
  let resume = false;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]!;
    if (option === "--resume") {
      if (resume) throw new Error("duplicate option --resume");
      resume = true;
      continue;
    }
    if (!["--report", "--out", "--batch-size"].includes(option)) throw new Error(`unknown option ${option}`);
    if (values.has(option)) throw new Error(`duplicate option ${option}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
    values.set(option, value);
  }
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
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(checkpoint, null, 2)}\n`, { flag: "wx" });
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function readDistanceComparisonCheckpoint(path: string): Promise<DistanceComparisonCheckpoint | undefined> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  const checkpoint = JSON.parse(source) as Partial<DistanceComparisonCheckpoint>;
  if (!checkpoint || checkpoint.version !== 1 || !checkpoint.configuration || !Array.isArray(checkpoint.pairs)
    || !checkpoint.usage || typeof checkpoint.usage !== "object") {
    throw new Error(`invalid distance comparison checkpoint: ${path}`);
  }
  return checkpoint as DistanceComparisonCheckpoint;
}
