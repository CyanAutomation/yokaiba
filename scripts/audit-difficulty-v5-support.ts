import type { DifficultyLevel, GeneratedPuzzle, PuzzleTemplate } from "../src/domain/types.js";

export interface DifficultyV5AuditArguments {
  samples: number;
  targetSamples: number;
  outputBase?: string;
}

export interface DifficultyV5AuditSample {
  templateId: string;
  seed: string;
  legacy: { modelVersion: string; level: DifficultyLevel; score: number };
  v5: {
    modelVersion: string;
    level: DifficultyLevel;
    score: number;
    status: string;
    stepCount: number;
    maximumDependencyDepth: number;
    meanDependencyDepth: number;
    crossCategorySteps: number;
    workingMemoryMean: number;
    elapsedMs: number;
  };
  clueMetadata: Array<{ clueId: string; kind: string; categories: string[] }>;
}

export interface DifficultyV5TargetSample {
  seed: string;
  status: "selected" | "unavailable";
  elapsedMs: number;
  score?: number;
  level?: DifficultyLevel;
  traceStatus?: string;
  candidateAttempts?: number;
  eligibleCandidates?: number;
  selectedRankDistance?: number;
  observedLevels?: DifficultyLevel[];
  candidateScoreRange?: { minimum: number; maximum: number; complete: number; incomplete: number };
  clueMetadata?: DifficultyV5AuditSample["clueMetadata"];
  error?: string;
}

export interface NumericSummary {
  count: number;
  minimum: number | null;
  p50: number | null;
  p95: number | null;
  maximum: number | null;
  mean: number | null;
}

export interface DifficultyV5TemplateSummary {
  templateId: string;
  sampleCount: number;
  legacyLevelCounts: number[];
  v5LevelCounts: number[];
  comparison: { v5Higher: number; equal: number; v5Lower: number; meanAbsoluteLevelDifference: number };
  legacyScore: NumericSummary;
  v5Score: NumericSummary;
  dependencyDepth: NumericSummary;
  deductionCount: NumericSummary;
  completion: { complete: number; incomplete: number; contradiction: number };
  pairedGenerationMs: NumericSummary;
  targeted: Array<{
    requestedLevel: DifficultyLevel;
    sampleCount: number;
    selected: number;
    availabilityRate: number;
    score: NumericSummary;
    generationMs: NumericSummary;
    candidatesTried: NumericSummary;
    samples: DifficultyV5TargetSample[];
  }>;
  outlierSeeds: string[];
}

function positiveInteger(value: string | undefined, option: string): number {
  if (!value || !/^\d+$/.test(value)) throw new Error(`${option} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${option} must be a positive integer`);
  return parsed;
}

export function parseDifficultyV5AuditArguments(args: readonly string[]): DifficultyV5AuditArguments {
  let samples = 25;
  let targetSamples = 25;
  let outputBase: string | undefined;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]!;
    if (seen.has(option)) throw new Error(`duplicate option ${option}`);
    seen.add(option);
    if (option === "--samples") samples = positiveInteger(args[++index], option);
    else if (option === "--target-samples") targetSamples = positiveInteger(args[++index], option);
    else if (option === "--out") {
      outputBase = args[++index];
      if (!outputBase || outputBase.startsWith("--")) throw new Error("--out requires a file path without a JSON or Markdown extension");
      if (/\.(?:json|md)$/i.test(outputBase)) throw new Error("--out takes a base path without a JSON or Markdown extension");
    } else throw new Error(`unknown option ${option}`);
  }
  return { samples, targetSamples, outputBase };
}

function percentile(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
}

export function summarizeNumbers(values: readonly number[]): NumericSummary {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    minimum: sorted[0] ?? null,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    maximum: sorted.at(-1) ?? null,
    mean: sorted.length ? Number((sorted.reduce((sum, value) => sum + value, 0) / sorted.length).toFixed(3)) : null,
  };
}

export function clueMetadata(puzzle: GeneratedPuzzle): DifficultyV5AuditSample["clueMetadata"] {
  return puzzle.clues.map(clue => {
    const constraint = clue.constraint;
    const categories = "category" in constraint
      ? [constraint.category]
      : [constraint.left.category, constraint.right.category];
    return { clueId: clue.id, kind: constraint.kind, categories: [...new Set(categories)].sort() };
  });
}

export function summarizeDifficultyV5Template(
  template: PuzzleTemplate,
  pairedSamples: readonly DifficultyV5AuditSample[],
  targeted: ReadonlyMap<DifficultyLevel, DifficultyV5TargetSample[]>,
): DifficultyV5TemplateSummary {
  const rows = pairedSamples.filter(sample => sample.templateId === template.id);
  const legacyLevelCounts = Array<number>(12).fill(0);
  const v5LevelCounts = Array<number>(12).fill(0);
  let v5Higher = 0;
  let equal = 0;
  let v5Lower = 0;
  let absoluteLevelDifference = 0;
  const completion = { complete: 0, incomplete: 0, contradiction: 0 };
  for (const row of rows) {
    legacyLevelCounts[row.legacy.level - 1] = legacyLevelCounts[row.legacy.level - 1]! + 1;
    v5LevelCounts[row.v5.level - 1] = v5LevelCounts[row.v5.level - 1]! + 1;
    if (row.v5.level > row.legacy.level) v5Higher += 1;
    else if (row.v5.level < row.legacy.level) v5Lower += 1;
    else equal += 1;
    absoluteLevelDifference += Math.abs(row.v5.level - row.legacy.level);
    if (row.v5.status === "complete") completion.complete += 1;
    else if (row.v5.status === "contradiction") completion.contradiction += 1;
    else completion.incomplete += 1;
  }
  const targetRows = [...targeted.entries()].map(([requestedLevel, samples]) => {
    const selected = samples.filter(sample => sample.status === "selected");
    const attempts = samples.map(sample => sample.candidateAttempts).filter((value): value is number => value !== undefined);
    return {
      requestedLevel,
      sampleCount: samples.length,
      selected: selected.length,
      availabilityRate: samples.length ? Number((selected.length / samples.length).toFixed(3)) : 0,
      score: summarizeNumbers(selected.map(sample => sample.score!)),
      generationMs: summarizeNumbers(samples.map(sample => sample.elapsedMs)),
      candidatesTried: summarizeNumbers(attempts),
      samples,
    };
  }).sort((left, right) => left.requestedLevel - right.requestedLevel);

  const values = rows.map(row => row.v5.score).sort((left, right) => left - right);
  const p10 = percentile(values, 0.1);
  const p90 = percentile(values, 0.9);
  const outlierSeeds = rows.filter(row => row.v5.status !== "complete"
    || (p10 !== null && p90 !== null && (row.v5.score < p10 || row.v5.score > p90)))
    .map(row => row.seed);
  return {
    templateId: template.id,
    sampleCount: rows.length,
    legacyLevelCounts,
    v5LevelCounts,
    comparison: {
      v5Higher,
      equal,
      v5Lower,
      meanAbsoluteLevelDifference: rows.length ? Number((absoluteLevelDifference / rows.length).toFixed(3)) : 0,
    },
    legacyScore: summarizeNumbers(rows.map(row => row.legacy.score)),
    v5Score: summarizeNumbers(rows.map(row => row.v5.score)),
    dependencyDepth: summarizeNumbers(rows.map(row => row.v5.maximumDependencyDepth)),
    deductionCount: summarizeNumbers(rows.map(row => row.v5.stepCount)),
    completion,
    pairedGenerationMs: summarizeNumbers(rows.map(row => row.v5.elapsedMs)),
    targeted: targetRows,
    outlierSeeds,
  };
}

const fmt = (value: number | null) => value === null ? "n/a" : String(value);

export function buildDifficultyV5AuditMarkdown(report: {
  generatedAt: string;
  configuration: { samples: number; targetSamples: number; seedPrefix: string };
  templates: DifficultyV5TemplateSummary[];
}): string {
  const lines = [
    "# Yokaiba difficulty v5 calibration audit",
    "",
    `Generated: ${report.generatedAt}`,
    `Paired samples: ${report.configuration.samples} per template; targeted samples: ${report.configuration.targetSamples} per advertised level; seed prefix: \`${report.configuration.seedPrefix}\`.`,
    "",
    "The paired comparison scores v4 and v5 on the same v4-generated clue set. Targeted selection is a separate measurement of v5 clue generation and bounded candidate selection. This is deterministic engineering evidence, not human-player validation.",
    "",
    "## Paired model comparison",
    "",
    "| Template | Samples | v4 score p50 (range) | v5 score p50 (range) | v4 / v5 mean level gap | v5 higher / equal / lower | v5 trace complete | Depth p50 / p95 | Generation ms p50 / p95 |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const template of report.templates) {
    lines.push(`| ${template.templateId} | ${template.sampleCount} | ${fmt(template.legacyScore.p50)} (${fmt(template.legacyScore.minimum)}–${fmt(template.legacyScore.maximum)}) | ${fmt(template.v5Score.p50)} (${fmt(template.v5Score.minimum)}–${fmt(template.v5Score.maximum)}) | ${template.comparison.meanAbsoluteLevelDifference.toFixed(2)} | ${template.comparison.v5Higher} / ${template.comparison.equal} / ${template.comparison.v5Lower} | ${template.completion.complete}/${template.sampleCount} | ${fmt(template.dependencyDepth.p50)} / ${fmt(template.dependencyDepth.p95)} | ${fmt(template.pairedGenerationMs.p50)} / ${fmt(template.pairedGenerationMs.p95)} |`);
  }
  for (const template of report.templates) {
    lines.push("", `## Targeted selection: ${template.templateId}`, "", "| Level | Selected / samples | Availability | Selected score p50 (range) | Tried score range | Attempts p50 / p95 | Time ms p50 / p95 |", "| ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const row of template.targeted) {
      const triedRanges = row.samples.map(sample => sample.candidateScoreRange).filter((range): range is NonNullable<typeof range> => range !== undefined);
      const triedMinimum = triedRanges.length ? Math.min(...triedRanges.map(range => range.minimum)) : null;
      const triedMaximum = triedRanges.length ? Math.max(...triedRanges.map(range => range.maximum)) : null;
      lines.push(`| ${row.requestedLevel} | ${row.selected}/${row.sampleCount} | ${(row.availabilityRate * 100).toFixed(1)}% | ${fmt(row.score.p50)} (${fmt(row.score.minimum)}–${fmt(row.score.maximum)}) | ${fmt(triedMinimum)}–${fmt(triedMaximum)} | ${fmt(row.candidatesTried.p50)} / ${fmt(row.candidatesTried.p95)} | ${fmt(row.generationMs.p50)} / ${fmt(row.generationMs.p95)} |`);
    }
    lines.push("", `Paired v5 completion: ${template.completion.complete}/${template.sampleCount}; stalled: ${template.completion.incomplete}; contradictions: ${template.completion.contradiction}. Outlier or incomplete seeds: ${template.outlierSeeds.length ? template.outlierSeeds.map(seed => `\`${seed}\``).join(", ") : "none"}.`);
  }
  lines.push("", "## Interpretation limits", "", "Difficulty bands are provisional. Availability gaps, incomplete no-guess traces, or long p95 generation times are release risks to address with deterministic evidence. JEV semantic scores are optional and probabilistic; player outcomes are outside this audit and are not required to complete this implementation.", "");
  return lines.join("\n");
}
