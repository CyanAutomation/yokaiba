import type { DifficultyCorpusAudit, TargetedDifficultyCorpusAudit } from "../src/index.js";
import type { JevAuditReport, SemanticPuzzleEvidence } from "./audit-jev-support.js";

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

function auditHeaderLines(report: JevAuditReport): string[] {
  const { clueAudit } = report;
  return [
    "# Yokaiba JEV audit",
    "",
    `Started: ${report.startedAt}`,
    `Generated: ${report.generatedAt}`,
    `JEV model requested: ${report.configuration.requestedModel}`,
    `JEV model resolved: ${report.configuration.resolvedModel}`,
    `Semantic assessment schema: ${report.configuration.semanticAssessmentSchemaVersion}`,
    `Provisional review thresholds: ${JSON.stringify(report.configuration.reviewThresholds)}`,
    `Samples: ${report.configuration.difficultySamples} per difficulty template; ${report.configuration.clueSamples} per wording template; batch size ${report.configuration.batchSize}.`,
    `Clues reviewed: ${clueAudit.sampledClues}; status: ${clueAudit.status}; review leads: ${clueAudit.flaggedClues.length}; incomplete: ${clueAudit.incompleteClues.length}; unavailable: ${clueAudit.unavailableClues.length}; reported cost: $${clueAudit.totalCost.toFixed(6)} (${clueAudit.totalInputTokens} input / ${clueAudit.totalOutputTokens} output tokens).`,
    `Puzzle-level review: ${report.puzzleAudit.enabled ? "enabled" : "disabled"}; ${report.puzzleAudit.completePuzzles} complete / ${report.puzzleAudit.sampledPuzzles} sampled; ${report.puzzleAudit.flaggedPuzzles.length} review leads.`,
  ];
}

function difficultyDistributionLines(
  title: string,
  rows: DifficultyCorpusAudit[],
  emptyMessage?: string,
): string[] {
  const lines = [
    `## ${title}`,
    "",
    "| Template | Generated / requested | Unavailable | Level distribution | No-guess trace |",
    "| --- | ---: | ---: | --- | --- |",
    ...rows.map(row => `| ${row.templateId} | ${row.generated}/${row.sampleSize} | ${row.unavailable} | ${row.levelCounts.map((count, index) => `${index + 1}: ${count}`).filter(entry => !entry.endsWith(": 0")).join(", ")} | ${row.humanTrace.complete} complete / ${row.generated} generated (${row.humanTrace.incomplete} incomplete) |`),
  ];
  if (rows.length === 0 && emptyMessage) lines.push(emptyMessage);
  return lines;
}

function targetedDifficultyLines(report: JevAuditReport): string[] {
  const lines = [
    "## Targeted difficulty audit",
    "",
    "| Template | Level | Exact target | No-guess trace | Fallback use | Fallback attempt p50 / p95 / max |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const template of report.targetedDifficultyAudit) {
    for (const level of template.levels) {
      const percentiles = level.fallback.attempts
        ? `p50 ${level.fallback.attempts.p50}, p95 ${level.fallback.attempts.p95}`
        : "p50 n/a, p95 n/a";
      lines.push(`| ${template.templateId} | ${level.requestedDifficultyLevel} | ${targetedExactCount(level)}/${level.generated} | ${level.humanTrace.complete}/${level.generated} | ${level.fallback.used}/${level.generated} | ${percentiles}, max ${level.fallback.maximumAttempt} |`);
    }
  }
  if (report.targetedDifficultyAudit.length === 0) lines.push("No targeted difficulty results were collected.");
  lines.push("Fallback attempt percentiles include only seeds that required fallback and use the nearest-rank definition.");
  return lines;
}

function semanticCalibrationLines(report: JevAuditReport): string[] {
  const lines = [
    "",
    "## Semantic and logical calibration evidence",
    "",
    "Logical level and model version are deterministic. Semantic measurements are probabilistic JEV assessments and remain independent; rows below aggregate each sampled puzzle's clue scores by logical level. The JSON report keeps each template, seed, and paired raw profile for later comparison with player outcomes.",
    "",
    "| Template | Logical level / model | Puzzles | Readability (0–2) | Ambiguity (0–1) | Linguistic complexity (0–2) | Relationship explicitness (0–2) | Language burden vs logical level (0–2) |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  const groups = new Map<string, SemanticPuzzleEvidence[]>();
  for (const evidence of report.semanticCalibrationEvidence) {
    const key = `${evidence.templateId}\u0000${evidence.difficultyModelVersion}\u0000${evidence.logicalDifficultyLevel}`;
    groups.set(key, [...(groups.get(key) ?? []), evidence]);
  }
  const formatMean = (values: Array<number | undefined>) => {
    const present = values.filter((value): value is number => value !== undefined);
    return present.length ? (present.reduce((sum, value) => sum + value, 0) / present.length).toFixed(2) : "n/a";
  };
  for (const rows of groups.values()) {
    const first = rows[0]!;
    lines.push(`| ${first.templateId} | ${first.logicalDifficultyLevel} / ${first.difficultyModelVersion} | ${rows.length} | ${formatMean(rows.map(row => row.semanticAssessment.readability))} | ${formatMean(rows.map(row => row.semanticAssessment.ambiguity))} | ${formatMean(rows.map(row => row.semanticAssessment.linguisticComplexity))} | ${formatMean(rows.map(row => row.semanticAssessment.relationshipExplicitness))} | ${formatMean(rows.map(row => row.puzzleReview?.linguisticDifficultyComparedToLogical))} |`);
  }
  if (report.semanticCalibrationEvidence.length === 0) lines.push("No paired semantic and logical sample evidence was collected.");
  return lines;
}

function clueFlagLines(report: JevAuditReport): string[] {
  const lines = ["", "## JEV wording flags", ""];
  if (report.clueAudit.flaggedClues.length === 0) {
    lines.push("No clue crossed the conservative review thresholds.");
    return lines;
  }
  lines.push(
    "Scores include JEV confidence in parentheses when supplied.",
    "",
    "| Template / clue | Text | Faithfulness | Ambiguity | Readability | Linguistic complexity | Relationship explicitness | Flag reasons | Evaluation |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |",
  );
  for (const clue of report.clueAudit.flaggedClues) {
    lines.push(`| ${escapeTableCell(`${clue.templateId} / ${clue.clueId}`)} | ${escapeTableCell(clue.text)} | ${formattedScore(clue.faithful, clue.faithfulConfidence)} | ${formattedScore(clue.ambiguous, clue.ambiguousConfidence)} | ${formattedScore(clue.readability, clue.readabilityConfidence)} | ${formattedScore(clue.linguisticComplexity, clue.linguisticComplexityConfidence)} | ${formattedScore(clue.relationshipExplicitness, clue.relationshipExplicitnessConfidence)} | ${escapeTableCell(clue.flagReasons.join(", "))} | ${clue.evaluationStatus} |`);
  }
  return lines;
}

function puzzleReviewLines(report: JevAuditReport): string[] {
  if (!report.puzzleAudit.enabled) return [];
  const lines = ["", "## Puzzle-level semantic review leads", ""];
  if (report.puzzleAudit.flaggedPuzzles.length === 0) {
    lines.push("No puzzle-level response crossed the provisional review thresholds.");
    return lines;
  }
  lines.push(
    "These are review leads, not deterministic QA failures.",
    "",
    "| Template / seed | Logical level | Repetition | Terminology inconsistency | Phrasing variety | Language burden vs logical level | Evaluation |",
    "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
  );
  for (const puzzle of report.puzzleAudit.flaggedPuzzles) {
    lines.push(`| ${escapeTableCell(`${puzzle.templateId} / ${puzzle.seed}`)} | ${puzzle.logicalDifficultyLevel} (${puzzle.difficultyModelVersion}) | ${formattedScore(puzzle.wordingRepetition, puzzle.wordingRepetitionConfidence)} | ${formattedScore(puzzle.terminologyInconsistency, puzzle.terminologyInconsistencyConfidence)} | ${formattedScore(puzzle.phrasingVariety, puzzle.phrasingVarietyConfidence)} | ${formattedScore(puzzle.linguisticDifficultyComparedToLogical, puzzle.linguisticDifficultyComparedToLogicalConfidence)} | ${puzzle.evaluationStatus} |`);
  }
  return lines;
}

function incompleteClueLines(report: JevAuditReport): string[] {
  if (report.clueAudit.incompleteClues.length === 0) return [];
  return [
    "",
    "## Incomplete JEV evaluations",
    "",
    "These responses were missing required scores or returned values outside the expected ranges.",
    "",
    "| Template / clue | Missing answers | Text |",
    "| --- | --- | --- |",
    ...report.clueAudit.incompleteClues.map(clue => `| ${escapeTableCell(`${clue.templateId} / ${clue.clueId}`)} | ${escapeTableCell(clue.missingAnswers.join(", "))} | ${escapeTableCell(clue.text)} |`),
  ];
}

function providerAvailabilityLines(report: JevAuditReport): string[] {
  if (report.clueAudit.unavailableClues.length === 0 && report.puzzleAudit.unavailablePuzzles === 0) return [];
  return [
    "",
    "JEV provider results were unavailable for some or all semantic assessments. Deterministic difficulty and puzzle QA remain available; keep or resume the checkpoint to retry the semantic review.",
  ];
}

export function buildAuditMarkdown(report: JevAuditReport): string {
  return [
    ...auditHeaderLines(report),
    "",
    ...difficultyDistributionLines("Raw generation distribution", report.difficultyAudit),
    "",
    "The raw distribution calls the base generator directly. Templates with `requiresHumanSolve` use a progressive strategy search on the ordinary production API path.",
    "",
    ...difficultyDistributionLines("Progressive delivery distribution", report.productionDifficultyAudit, "No progressive delivery results were collected."),
    "",
    ...targetedDifficultyLines(report),
    ...semanticCalibrationLines(report),
    ...clueFlagLines(report),
    ...puzzleReviewLines(report),
    ...incompleteClueLines(report),
    ...providerAvailabilityLines(report),
    "",
    "JEV thresholds are provisional review leads, not gates or evidence that a deterministic clue contract is broken. Logical difficulty is deterministic, semantic difficulty is probabilistic JEV analysis, and aggregated player outcomes remain the empirical calibration signal. /v1/events currently accepts outcomes but does not produce these aggregates.",
    "",
  ].join("\n");
}
