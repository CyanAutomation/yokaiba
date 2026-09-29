import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { DifficultyCorpusAudit, TargetedDifficultyCorpusAudit } from "../src/generation/audit.js";

export interface JevAnswer {
  noul?: number;
  score?: number;
  confidence?: number;
}

export function readJevAnswerMap(value: unknown): Record<string, JevAnswer> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, JevAnswer>
    : {};
}

export interface AuditedClue {
  templateId: string;
  seed: string;
  clueId: string;
  text: string;
  expectedSemantics: string;
  phraseVariant?: string;
  languageVersion?: string;
  faithful?: number;
  faithfulConfidence?: number;
  ambiguous?: number;
  ambiguousConfidence?: number;
  readability?: number;
  readabilityConfidence?: number;
  evaluationStatus: "pending" | "complete" | "incomplete";
  missingAnswers: string[];
  evaluatedAt?: string;
  flagged: boolean;
  flagReasons: string[];
}

export interface JevRunConfiguration {
  difficultySamples: number;
  clueSamples: number;
  batchSize: number;
  endpoint: string;
  requestedModel: string;
}

export interface AuditArguments {
  difficultySamples: number;
  clueSamples: number;
  batchSize: number;
  outputBase?: string;
  resume: boolean;
}

export interface AuditCheckpoint {
  version: 1;
  startedAt: string;
  configuration: JevRunConfiguration;
  difficultyAudit: DifficultyCorpusAudit[];
  targetedDifficultyAudit: TargetedDifficultyCorpusAudit[];
  clues: AuditedClue[];
  totalCost: number;
  resolvedModel: string;
}

export interface JevAuditReport {
  startedAt: string;
  generatedAt: string;
  configuration: JevRunConfiguration & { resolvedModel: string };
  difficultyAudit: DifficultyCorpusAudit[];
  targetedDifficultyAudit: TargetedDifficultyCorpusAudit[];
  clueAudit: {
    model: string;
    sampledClues: number;
    totalCost: number;
    flaggedClues: AuditedClue[];
    incompleteClues: AuditedClue[];
    clues: AuditedClue[];
  };
}

function positiveIntegerArgument(args: readonly string[], name: string, fallback: number): number {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const raw = args[index + 1];
  const value = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function stringArgument(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

export function parseAuditArguments(args: readonly string[]): AuditArguments {
  const knownFlags = new Set(["--samples", "--difficulty-samples", "--clue-samples", "--batch-size", "--out", "--resume"]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (!arg.startsWith("--")) throw new Error(`unexpected argument: ${arg}`);
    if (!knownFlags.has(arg)) throw new Error(`unknown argument: ${arg}`);
    if (arg === "--resume") continue;
    if (args[index + 1] === undefined || args[index + 1]!.startsWith("--")) throw new Error(`${arg} requires a value`);
    index += 1;
  }

  const sharedSamples = positiveIntegerArgument(args, "--samples", 100);
  const outputBase = stringArgument(args, "--out");
  const resume = args.includes("--resume");
  if (resume && !outputBase) throw new Error("--resume requires --out so the checkpoint path stays stable");
  return {
    difficultySamples: positiveIntegerArgument(args, "--difficulty-samples", sharedSamples),
    clueSamples: positiveIntegerArgument(args, "--clue-samples", sharedSamples),
    batchSize: positiveIntegerArgument(args, "--batch-size", 20),
    outputBase,
    resume,
  };
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function optionalConfidence(answer: JevAnswer | undefined) {
  return finiteInRange(answer?.confidence, 0, 1) ? answer.confidence : undefined;
}

export function applyJevAnswers(
  clue: AuditedClue,
  answers: Record<string, JevAnswer | undefined>,
  index: number,
  evaluatedAt = new Date().toISOString(),
): AuditedClue {
  const faithfulAnswer = answers[`${index}_faithful`];
  const ambiguousAnswer = answers[`${index}_ambiguous`];
  const readabilityAnswer = answers[`${index}_readability`];
  const faithful = finiteInRange(faithfulAnswer?.noul, 0, 1) ? faithfulAnswer.noul : undefined;
  const ambiguous = finiteInRange(ambiguousAnswer?.noul, 0, 1) ? ambiguousAnswer.noul : undefined;
  const readability = finiteInRange(readabilityAnswer?.score, 0, 2) ? readabilityAnswer.score : undefined;
  const missingAnswers = [
    faithful === undefined ? "faithful" : undefined,
    ambiguous === undefined ? "ambiguous" : undefined,
    readability === undefined ? "readability" : undefined,
  ].filter((value): value is string => value !== undefined);
  const flagReasons = [
    faithful !== undefined && faithful < 0.5 ? "faithfulness below 0.50" : undefined,
    ambiguous !== undefined && ambiguous > 0.6 ? "ambiguity above 0.60" : undefined,
    readability !== undefined && readability < 1 ? "readability below 1.00" : undefined,
  ].filter((value): value is string => value !== undefined);

  return {
    ...clue,
    faithful,
    faithfulConfidence: optionalConfidence(faithfulAnswer),
    ambiguous,
    ambiguousConfidence: optionalConfidence(ambiguousAnswer),
    readability,
    readabilityConfidence: optionalConfidence(readabilityAnswer),
    evaluationStatus: missingAnswers.length === 0 ? "complete" : "incomplete",
    missingAnswers,
    evaluatedAt,
    flagged: flagReasons.length > 0,
    flagReasons,
  };
}

export function assertCheckpointConfiguration(actual: JevRunConfiguration, expected: JevRunConfiguration): void {
  const keys: (keyof JevRunConfiguration)[] = ["difficultySamples", "clueSamples", "batchSize", "endpoint", "requestedModel"];
  const mismatches = keys.filter(key => actual[key] !== expected[key]);
  if (mismatches.length > 0) throw new Error(`audit checkpoint configuration does not match this run: ${mismatches.join(", ")}`);
}

export async function writeAuditCheckpoint(path: string, checkpoint: AuditCheckpoint): Promise<void> {
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

export async function readAuditCheckpoint(path: string): Promise<AuditCheckpoint | undefined> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  const checkpoint = JSON.parse(source) as AuditCheckpoint;
  if (!checkpoint || checkpoint.version !== 1 || !Array.isArray(checkpoint.clues) || !Array.isArray(checkpoint.difficultyAudit) || !Array.isArray(checkpoint.targetedDifficultyAudit)) {
    throw new Error(`invalid audit checkpoint: ${path}`);
  }
  return checkpoint;
}

function escapeTableCell(value: string) {
  return value.replaceAll("|", "\\|").replaceAll("\r", " ").replaceAll("\n", " ");
}

function formattedScore(value: number | undefined, confidence: number | undefined) {
  if (value === undefined) return "n/a";
  return confidence === undefined ? value.toFixed(2) : `${value.toFixed(2)} (conf. ${confidence.toFixed(2)})`;
}

function targetedExactCount(row: TargetedDifficultyCorpusAudit["levels"][number]) {
  return row.assessedLevelCounts[row.requestedDifficultyLevel - 1] ?? 0;
}

export function buildAuditMarkdown(report: JevAuditReport): string {
  const { clueAudit } = report;
  const lines = [
    "# Yokaiba JEV audit",
    "",
    `Started: ${report.startedAt}`,
    `Generated: ${report.generatedAt}`,
    `JEV model requested: ${report.configuration.requestedModel}`,
    `JEV model resolved: ${report.configuration.resolvedModel}`,
    `Samples: ${report.configuration.difficultySamples} per difficulty template; ${report.configuration.clueSamples} per wording template; batch size ${report.configuration.batchSize}.`,
    `Clues reviewed: ${clueAudit.sampledClues}; flags: ${clueAudit.flaggedClues.length}; incomplete evaluations: ${clueAudit.incompleteClues.length}; reported cost: $${clueAudit.totalCost.toFixed(6)}.`,
    "",
    "## Deterministic difficulty audit",
    "",
    "| Template | Level distribution | No-guess trace |",
    "| --- | --- | --- |",
    ...report.difficultyAudit.map(row => `| ${row.templateId} | ${row.levelCounts.map((count, index) => `${index + 1}: ${count}`).filter(entry => !entry.endsWith(": 0")).join(", ")} | ${row.humanTrace.complete} complete / ${row.humanTrace.incomplete} incomplete |`),
    "",
    "## Targeted difficulty audit",
    "",
    "| Template | Level | Exact target | No-guess trace | Fallbacks |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];
  for (const template of report.targetedDifficultyAudit) {
    for (const level of template.levels) {
      lines.push(`| ${template.templateId} | ${level.requestedDifficultyLevel} | ${targetedExactCount(level)}/${level.generated} | ${level.humanTrace.complete}/${level.generated} | ${level.fallback.used}/${level.generated} (maximum attempt ${level.fallback.maximumAttempt}) |`);
    }
  }
  if (report.targetedDifficultyAudit.length === 0) lines.push("No targeted difficulty results were collected.");
  lines.push("", "## JEV wording flags", "");
  if (clueAudit.flaggedClues.length === 0) lines.push("No clue crossed the conservative review thresholds.");
  else {
    lines.push("Scores include JEV confidence in parentheses when supplied.", "");
    lines.push(
      "| Template / clue | Text | Faithfulness | Ambiguity | Readability | Flag reasons | Evaluation |",
      "| --- | --- | ---: | ---: | ---: | --- | --- |",
    );
    for (const clue of clueAudit.flaggedClues) {
      lines.push(`| ${escapeTableCell(`${clue.templateId} / ${clue.clueId}`)} | ${escapeTableCell(clue.text)} | ${formattedScore(clue.faithful, clue.faithfulConfidence)} | ${formattedScore(clue.ambiguous, clue.ambiguousConfidence)} | ${formattedScore(clue.readability, clue.readabilityConfidence)} | ${escapeTableCell(clue.flagReasons.join(", "))} | ${clue.evaluationStatus} |`);
    }
  }
  if (clueAudit.incompleteClues.length > 0) {
    lines.push(
      "",
      "## Incomplete JEV evaluations",
      "",
      "These responses were missing required scores or returned values outside the expected ranges.",
      "",
      "| Template / clue | Missing answers | Text |",
      "| --- | --- | --- |",
    );
    for (const clue of clueAudit.incompleteClues) {
      lines.push(`| ${escapeTableCell(`${clue.templateId} / ${clue.clueId}`)} | ${escapeTableCell(clue.missingAnswers.join(", "))} | ${escapeTableCell(clue.text)} |`);
    }
  }
  lines.push("", "Flags are review leads, not evidence that a deterministic clue contract is broken. Existing solver and wording tests remain authoritative.", "");
  return lines.join("\n");
}
