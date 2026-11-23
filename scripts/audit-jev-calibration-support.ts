import { JEV_REVIEW_THRESHOLDS, type AuditedClue } from "./audit-jev-support.js";

const HUMAN_CALIBRATION_METRICS = [
  "faithfulness",
  "ambiguity",
  "readability",
  "linguisticComplexity",
  "relationshipExplicitness",
  "entityClarity",
  "misunderstandingRisk",
] as const;

export type HumanCalibrationMetric = typeof HUMAN_CALIBRATION_METRICS[number];

export interface HumanCalibrationLabel {
  templateId: string;
  seed: string;
  clueId: string;
  concerns: Partial<Record<HumanCalibrationMetric, boolean>>;
  playerOutcome?: { exposures: number; misreads: number };
}

export interface HumanCalibrationLabels {
  version: 1;
  labels: HumanCalibrationLabel[];
}

export interface ConfusionCounts {
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
}

export interface HumanCalibrationMetricResult {
  labeled: number;
  confusion: ConfusionCounts;
  precision: number | null;
  recall: number | null;
  specificity: number | null;
  accuracy: number | null;
  falsePositiveExamples: Array<Pick<HumanCalibrationLabel, "templateId" | "seed" | "clueId">>;
  falseNegativeExamples: Array<Pick<HumanCalibrationLabel, "templateId" | "seed" | "clueId">>;
}

export interface PlayerMisreadGroup {
  clues: number;
  exposures: number;
  misreads: number;
  misreadRate: number | null;
}

export interface HumanCalibrationComparison {
  labeledRows: number;
  matchedLabels: number;
  unmatchedLabels: number;
  unmatchedJevClues: number;
  excludedIncompletePlayerOutcomeClues: number;
  metrics: Record<HumanCalibrationMetric, HumanCalibrationMetricResult>;
  playerOutcomes: {
    flagged: PlayerMisreadGroup;
    unflagged: PlayerMisreadGroup;
    misreadRateDifference: number | null;
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function clueKey(row: Pick<HumanCalibrationLabel, "templateId" | "seed" | "clueId">): string {
  return JSON.stringify([row.templateId, row.seed, row.clueId]);
}

export function parseHumanCalibrationLabels(value: unknown): HumanCalibrationLabels {
  if (!isPlainObject(value) || value.version !== 1 || !Array.isArray(value.labels)) {
    throw new Error("human calibration labels must be an object with version 1 and a labels array");
  }
  const seen = new Set<string>();
  const labels = value.labels.map((raw, index): HumanCalibrationLabel => {
    if (!isPlainObject(raw)) throw new Error(`label at index ${index} must be an object`);
    const templateId = nonEmptyString(raw.templateId, `labels[${index}].templateId`);
    const seed = nonEmptyString(raw.seed, `labels[${index}].seed`);
    const clueId = nonEmptyString(raw.clueId, `labels[${index}].clueId`);
    const key = clueKey({ templateId, seed, clueId });
    if (seen.has(key)) throw new Error(`duplicate label key: ${templateId}/${seed}/${clueId}`);
    seen.add(key);
    if (!isPlainObject(raw.concerns)) throw new Error(`labels[${index}].concerns must be an object`);
    const concerns: Partial<Record<HumanCalibrationMetric, boolean>> = {};
    for (const [metric, concern] of Object.entries(raw.concerns)) {
      if (!(HUMAN_CALIBRATION_METRICS as readonly string[]).includes(metric)) throw new Error(`unknown human calibration metric: ${metric}`);
      if (typeof concern !== "boolean") throw new Error(`labels[${index}].concerns.${metric} must be boolean`);
      concerns[metric as HumanCalibrationMetric] = concern;
    }
    if (Object.keys(concerns).length === 0 && raw.playerOutcome === undefined) {
      throw new Error(`labels[${index}] must include a concern label or player outcome`);
    }
    let playerOutcome: HumanCalibrationLabel["playerOutcome"];
    if (raw.playerOutcome !== undefined) {
      if (!isPlainObject(raw.playerOutcome)) throw new Error(`labels[${index}].playerOutcome must be an object`);
      const { exposures, misreads } = raw.playerOutcome;
      if (!Number.isSafeInteger(exposures) || (exposures as number) < 0) throw new Error(`labels[${index}].playerOutcome.exposures must be a non-negative integer`);
      if (!Number.isSafeInteger(misreads) || (misreads as number) < 0) throw new Error(`labels[${index}].playerOutcome.misreads must be a non-negative integer`);
      if ((misreads as number) > (exposures as number)) throw new Error(`labels[${index}].playerOutcome misreads cannot exceed exposures`);
      playerOutcome = { exposures: exposures as number, misreads: misreads as number };
    }
    return { templateId, seed, clueId, concerns, ...(playerOutcome ? { playerOutcome } : {}) };
  });
  return { version: 1, labels };
}

function metricValue(clue: AuditedClue, metric: HumanCalibrationMetric): number | undefined {
  const field: Record<HumanCalibrationMetric, keyof AuditedClue> = {
    faithfulness: "faithful",
    ambiguity: "ambiguous",
    readability: "readability",
    linguisticComplexity: "linguisticComplexity",
    relationshipExplicitness: "relationshipExplicitness",
    entityClarity: "entityClarity",
    misunderstandingRisk: "misunderstandingRisk",
  };
  const value = clue[field[metric]];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function jevConcernForMetric(metric: HumanCalibrationMetric, value: number): boolean {
  switch (metric) {
    case "faithfulness": return value < JEV_REVIEW_THRESHOLDS.faithfulnessBelow;
    case "ambiguity": return value > JEV_REVIEW_THRESHOLDS.ambiguityAbove;
    case "readability": return value < JEV_REVIEW_THRESHOLDS.readabilityBelow;
    case "linguisticComplexity": return value > JEV_REVIEW_THRESHOLDS.linguisticComplexityAbove;
    case "relationshipExplicitness": return value < JEV_REVIEW_THRESHOLDS.relationshipExplicitnessBelow;
    case "entityClarity": return value < JEV_REVIEW_THRESHOLDS.entityClarityBelow;
    case "misunderstandingRisk": return value > JEV_REVIEW_THRESHOLDS.misunderstandingRiskAbove;
  }
}

function rate(successes: number, total: number): number | null {
  return total === 0 ? null : Number((successes / total).toFixed(4));
}

function emptyMetricResult(): HumanCalibrationMetricResult {
  return {
    labeled: 0,
    confusion: { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0 },
    precision: null,
    recall: null,
    specificity: null,
    accuracy: null,
    falsePositiveExamples: [],
    falseNegativeExamples: [],
  };
}

function emptyPlayerGroup(): PlayerMisreadGroup {
  return { clues: 0, exposures: 0, misreads: 0, misreadRate: null };
}

export function compareJevWithHumanCalibration(
  clues: readonly AuditedClue[],
  labels: HumanCalibrationLabels,
): HumanCalibrationComparison {
  const cluesByKey = new Map<string, AuditedClue>();
  for (const clue of clues) {
    const key = clueKey(clue);
    if (cluesByKey.has(key)) throw new Error(`duplicate JEV clue key: ${clue.templateId}/${clue.seed}/${clue.clueId}`);
    cluesByKey.set(key, clue);
  }
  const metricResults = Object.fromEntries(HUMAN_CALIBRATION_METRICS.map(metric => [metric, emptyMetricResult()])) as Record<HumanCalibrationMetric, HumanCalibrationMetricResult>;
  const playerGroups = { flagged: emptyPlayerGroup(), unflagged: emptyPlayerGroup() };
  let matchedLabels = 0;
  let excludedIncompletePlayerOutcomeClues = 0;
  for (const label of labels.labels) {
    const clue = cluesByKey.get(clueKey(label));
    if (!clue) continue;
    matchedLabels += 1;
    for (const metric of HUMAN_CALIBRATION_METRICS) {
      const humanConcern = label.concerns[metric];
      const value = metricValue(clue, metric);
      if (humanConcern === undefined || value === undefined) continue;
      const jevConcern = jevConcernForMetric(metric, value);
      const confusion = metricResults[metric].confusion;
      if (jevConcern && humanConcern) confusion.truePositive += 1;
      else if (jevConcern) {
        confusion.falsePositive += 1;
        if (metricResults[metric].falsePositiveExamples.length < 20) metricResults[metric].falsePositiveExamples.push({ templateId: label.templateId, seed: label.seed, clueId: label.clueId });
      } else if (humanConcern) {
        confusion.falseNegative += 1;
        if (metricResults[metric].falseNegativeExamples.length < 20) metricResults[metric].falseNegativeExamples.push({ templateId: label.templateId, seed: label.seed, clueId: label.clueId });
      } else confusion.trueNegative += 1;
      metricResults[metric].labeled += 1;
    }
    if (label.playerOutcome) {
      if (clue.evaluationStatus !== "complete") {
        excludedIncompletePlayerOutcomeClues += 1;
        continue;
      }
      const group = clue.flagged ? playerGroups.flagged : playerGroups.unflagged;
      group.clues += 1;
      group.exposures += label.playerOutcome.exposures;
      group.misreads += label.playerOutcome.misreads;
    }
  }
  for (const metric of HUMAN_CALIBRATION_METRICS) {
    const result = metricResults[metric];
    const { truePositive: tp, falsePositive: fp, trueNegative: tn, falseNegative: fn } = result.confusion;
    result.precision = rate(tp, tp + fp);
    result.recall = rate(tp, tp + fn);
    result.specificity = rate(tn, tn + fp);
    result.accuracy = rate(tp + tn, result.labeled);
  }
  for (const group of [playerGroups.flagged, playerGroups.unflagged]) {
    group.misreadRate = rate(group.misreads, group.exposures);
  }
  const flaggedRate = playerGroups.flagged.misreadRate;
  const unflaggedRate = playerGroups.unflagged.misreadRate;
  return {
    labeledRows: labels.labels.length,
    matchedLabels,
    unmatchedLabels: labels.labels.length - matchedLabels,
    unmatchedJevClues: clues.length - matchedLabels,
    excludedIncompletePlayerOutcomeClues,
    metrics: metricResults,
    playerOutcomes: {
      flagged: playerGroups.flagged,
      unflagged: playerGroups.unflagged,
      misreadRateDifference: flaggedRate === null || unflaggedRate === null ? null : Number((flaggedRate - unflaggedRate).toFixed(4)),
    },
  };
}

export function renderHumanCalibrationMarkdown(report: HumanCalibrationComparison, sourceReport: string, labelsFile: string): string {
  const lines = [
    "# JEV human calibration",
    "",
    `JEV source report: \`${sourceReport}\``,
    `Adjudicated labels: \`${labelsFile}\``,
    `Matched labels: ${report.matchedLabels}/${report.labeledRows}; unmatched labels: ${report.unmatchedLabels}; JEV clues without labels: ${report.unmatchedJevClues}.`,
    `Excluded player-outcome rows with incomplete JEV reviews: ${report.excludedIncompletePlayerOutcomeClues}.`,
    "",
    "Threshold predictions are compared with supplied human concern labels. These summaries do not tune thresholds automatically; inspect false positives and false negatives and keep a held-out label set for evaluation.",
    "The JSON output includes up to 20 clue keys for false positives and false negatives per metric to support review.",
    "",
    "| Metric | Labeled | TP | FP | TN | FN | Precision | Recall | Specificity | Accuracy |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const metric of HUMAN_CALIBRATION_METRICS) {
    const result = report.metrics[metric];
    lines.push(`| ${metric} | ${result.labeled} | ${result.confusion.truePositive} | ${result.confusion.falsePositive} | ${result.confusion.trueNegative} | ${result.confusion.falseNegative} | ${result.precision ?? "n/a"} | ${result.recall ?? "n/a"} | ${result.specificity ?? "n/a"} | ${result.accuracy ?? "n/a"} |`);
  }
  const playerRows = [
    ["JEV-flagged clues", report.playerOutcomes.flagged],
    ["Unflagged clues", report.playerOutcomes.unflagged],
  ];
  lines.push(
    "",
    "## Player misreads by JEV flag status",
    "",
    "Rates are exposure-weighted descriptive comparisons. They are observational and do not show that a JEV flag caused a misread.",
    "",
    "| Group | Clues | Exposures | Misreads | Misread rate |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...playerRows.map(([name, group]) => `| ${name} | ${(group as PlayerMisreadGroup).clues} | ${(group as PlayerMisreadGroup).exposures} | ${(group as PlayerMisreadGroup).misreads} | ${(group as PlayerMisreadGroup).misreadRate ?? "n/a"} |`),
    `Flagged minus unflagged misread rate: ${report.playerOutcomes.misreadRateDifference ?? "n/a"}.`,
    "",
  );
  return lines.join("\n");
}
