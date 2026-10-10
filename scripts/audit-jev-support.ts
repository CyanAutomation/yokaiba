import { mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { auditTargetedDifficultyLevel } from "../src/generation/audit.js";
import type { ClueConstraint, Difficulty, DifficultyAuditProgressCallback, DifficultyCorpusAudit, PuzzleTemplate, TargetedDifficultyCorpusAudit } from "../src/index.js";
export { parseAuditArguments } from "./audit-jev-arguments.js";
export { buildAuditMarkdown } from "./audit-jev-markdown.js";

export const SEMANTIC_ASSESSMENT_SCHEMA_VERSION = "yokaiba-jev-semantic-v1";

type ConstraintDescriptions = {
  [K in ClueConstraint["kind"]]: (constraint: Extract<ClueConstraint, { kind: K }>) => string;
};

const constraintDescriptions: ConstraintDescriptions = {
  matches: constraint => `${constraint.subject} is associated with ${constraint.value} in ${constraint.category}.`,
  notMatches: constraint => `${constraint.subject} is not associated with ${constraint.value} in ${constraint.category}.`,
  sameRow: constraint => `${constraint.left.value} in ${constraint.left.category} belongs to the same competitor as ${constraint.right.value} in ${constraint.right.category}.`,
  before: constraint => `${constraint.left.value} in ${constraint.left.category} is earlier than ${constraint.right.value} in ${constraint.right.category}.`,
  adjacent: constraint => `${constraint.left.value} in ${constraint.left.category} is immediately next to ${constraint.right.value} in ${constraint.right.category}.`,
  distance: constraint => `The positions of ${constraint.left.value} in ${constraint.left.category} and ${constraint.right.value} in ${constraint.right.category} differ by exactly ${constraint.distance}.`,
};

export function describeConstraint(constraint: ClueConstraint): string {
  return constraintDescriptions[constraint.kind](constraint as never);
}

export interface AuditProgress {
  phase: "difficulty" | "targeted";
  templateId: string;
  requestedDifficultyLevel?: number;
  completed: number;
  total: number;
}

function isAuditProgressMilestone(progress: AuditProgress, interval: number): boolean {
  return progress.completed === 1 || progress.completed === progress.total || progress.completed % interval === 0;
}

export function auditProgressMessage(progress: AuditProgress): string | undefined {
  const interval = Math.max(1, Math.ceil(progress.total / 10));
  if (!isAuditProgressMilestone(progress, interval)) return undefined;
  const scope = progress.requestedDifficultyLevel === undefined ? progress.templateId : `${progress.templateId} level ${progress.requestedDifficultyLevel}`;
  return `${progress.phase} audit ${scope}: ${progress.completed}/${progress.total}`;
}

function withFallback<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value;
}

export function accumulateResponseUsage(
  checkpoint: Pick<AuditCheckpoint, "resolvedModel" | "totalCost" | "totalInputTokens" | "totalOutputTokens">,
  response: JevDecisionResponse,
): void {
  checkpoint.resolvedModel = withFallback(response.model, checkpoint.resolvedModel);
  checkpoint.totalCost += withFallback(response.usage.cost, 0);
  checkpoint.totalInputTokens += withFallback(response.usage.inputTokens, 0);
  checkpoint.totalOutputTokens += withFallback(response.usage.outputTokens, 0);
}

export async function removeCompletedAuditCheckpoint(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
  }
}

/** Provisional review leads; these do not gate generation or deterministic QA. */
export const JEV_REVIEW_THRESHOLDS = {
  faithfulnessBelow: 0.5,
  ambiguityAbove: 0.6,
  readabilityBelow: 1,
  linguisticComplexityAbove: 1.5,
  relationshipExplicitnessBelow: 1,
  puzzleWordingRepetitionAbove: 0.6,
  puzzleTerminologyInconsistencyAbove: 0.6,
  linguisticDifficultyComparedToLogicalAbove: 1.5,
} as const;

export interface JevUsage {
  cost: number;
  inputTokens: number;
  outputTokens: number;
}
export interface JevDecisionPayload {
  model: string;
  state: Record<string, unknown>;
  questions: Record<string, unknown>;
}

export interface JevDecisionResponse {
  model?: string;
  answers: Record<string, JevAnswer>;
  usage: Partial<JevUsage>;
}

export interface JevAnswer {
  noul?: number;
  score?: number;
  confidence?: number;
}

export type JevEvaluationStatus = "pending" | "complete" | "incomplete" | "unavailable";

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
  constraintKind: ClueConstraint["kind"];
  structuredSemantics: ClueConstraint;
  phraseVariant?: string;
  languageVersion?: string;
  locale?: string;
  logicalDifficultyLevel: Difficulty["level"];
  difficultyModelVersion: string;
  faithful?: number;
  faithfulConfidence?: number;
  ambiguous?: number;
  ambiguousConfidence?: number;
  readability?: number;
  readabilityConfidence?: number;
  linguisticComplexity?: number;
  linguisticComplexityConfidence?: number;
  relationshipExplicitness?: number;
  relationshipExplicitnessConfidence?: number;
  evaluationStatus: JevEvaluationStatus;
  missingAnswers: string[];
  evaluatedAt?: string;
  flagged: boolean;
  flagReasons: string[];
}

export interface AuditedPuzzle {
  templateId: string;
  templateTitle: string;
  seed: string;
  logicalDifficultyLevel: Difficulty["level"];
  difficultyModelVersion: string;
  clues: Array<Pick<AuditedClue, "clueId" | "text" | "expectedSemantics" | "constraintKind" | "structuredSemantics" | "phraseVariant" | "languageVersion">>;
  wordingRepetition?: number;
  wordingRepetitionConfidence?: number;
  terminologyInconsistency?: number;
  terminologyInconsistencyConfidence?: number;
  phrasingVariety?: number;
  phrasingVarietyConfidence?: number;
  linguisticDifficultyComparedToLogical?: number;
  linguisticDifficultyComparedToLogicalConfidence?: number;
  flagReasons: string[];
  evaluationStatus: JevEvaluationStatus;
  missingAnswers: string[];
  evaluatedAt?: string;
}

export interface SemanticPuzzleEvidence {
  templateId: string;
  seed: string;
  logicalDifficultyLevel: Difficulty["level"];
  difficultyModelVersion: string;
  semanticAssessment: {
    readability?: number;
    ambiguity?: number;
    linguisticComplexity?: number;
    relationshipExplicitness?: number;
    evaluatedClues: number;
    totalClues: number;
  };
  puzzleReview?: {
    wordingRepetition?: number;
    terminologyInconsistency?: number;
    phrasingVariety?: number;
    linguisticDifficultyComparedToLogical?: number;
  };
}

export interface JevRunConfiguration {
  difficultySamples: number;
  clueSamples: number;
  batchSize: number;
  endpoint: string;
  requestedModel: string;
  semanticAssessmentSchemaVersion: string;
  puzzleReview: boolean;
  reviewThresholds: typeof JEV_REVIEW_THRESHOLDS;
}

export interface AuditArguments {
  difficultySamples: number;
  clueSamples: number;
  batchSize: number;
  outputBase?: string;
  puzzleReviewFrom?: string;
  resume: boolean;
  puzzleReview: boolean;
}

export interface AuditCheckpoint {
  version: 3;
  startedAt: string;
  configuration: JevRunConfiguration;
  difficultyAudit: DifficultyCorpusAudit[];
  productionDifficultyAudit: DifficultyCorpusAudit[];
  targetedDifficultyAudit: TargetedDifficultyCorpusAudit[];
  clues: AuditedClue[];
  puzzles: AuditedPuzzle[];
  totalCost: number;
  resolvedModel: string;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface JevAuditReport {
  startedAt: string;
  generatedAt: string;
  configuration: JevRunConfiguration & { resolvedModel: string };
  difficultyAudit: DifficultyCorpusAudit[];
  productionDifficultyAudit: DifficultyCorpusAudit[];
  targetedDifficultyAudit: TargetedDifficultyCorpusAudit[];
  semanticCalibrationEvidence: SemanticPuzzleEvidence[];
  clueAudit: {
    model: string;
    sampledClues: number;
    totalCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    status: "complete" | "partial" | "unavailable";
    flaggedClues: AuditedClue[];
    incompleteClues: AuditedClue[];
    unavailableClues: AuditedClue[];
    clues: AuditedClue[];
  };
  puzzleAudit: {
    enabled: boolean;
    sampledPuzzles: number;
    completePuzzles: number;
    incompletePuzzles: number;
    unavailablePuzzles: number;
    flaggedPuzzles: AuditedPuzzle[];
    puzzles: AuditedPuzzle[];
  };
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function optionalConfidence(answer: JevAnswer | undefined) {
  return finiteInRange(answer?.confidence, 0, 1) ? answer.confidence : undefined;
}

function readMetricAnswer(
  answers: Record<string, JevAnswer | undefined>,
  index: number,
  metric: string,
  field: "noul" | "score",
  maximum: number,
) {
  const answer = answers[`${index}_${metric}`];
  const value = answer?.[field];
  return {
    value: finiteInRange(value, 0, maximum) ? value : undefined,
    confidence: optionalConfidence(answer),
  };
}

function missingMetricNames(metrics: Record<string, { value: number | undefined }>): string[] {
  return Object.entries(metrics).filter(([, metric]) => metric.value === undefined).map(([name]) => name);
}

function belowThreshold(value: number | undefined, threshold: number, label: string): string | undefined {
  return value !== undefined && value < threshold ? `${label} below ${threshold.toFixed(2)}` : undefined;
}

function aboveThreshold(value: number | undefined, threshold: number, label: string): string | undefined {
  return value !== undefined && value > threshold ? `${label} above ${threshold.toFixed(2)}` : undefined;
}

export function applyJevAnswers(
  clue: AuditedClue,
  answers: Record<string, JevAnswer | undefined>,
  index: number,
  evaluatedAt = new Date().toISOString(),
): AuditedClue {
  const metrics = {
    faithful: readMetricAnswer(answers, index, "faithful", "noul", 1),
    ambiguous: readMetricAnswer(answers, index, "ambiguous", "noul", 1),
    readability: readMetricAnswer(answers, index, "readability", "score", 2),
    linguisticComplexity: readMetricAnswer(answers, index, "linguisticComplexity", "score", 2),
    relationshipExplicitness: readMetricAnswer(answers, index, "relationshipExplicitness", "score", 2),
  };
  const missingAnswers = missingMetricNames(metrics);
  const flagReasons = [
    belowThreshold(metrics.faithful.value, JEV_REVIEW_THRESHOLDS.faithfulnessBelow, "faithfulness"),
    aboveThreshold(metrics.ambiguous.value, JEV_REVIEW_THRESHOLDS.ambiguityAbove, "ambiguity"),
    belowThreshold(metrics.readability.value, JEV_REVIEW_THRESHOLDS.readabilityBelow, "readability"),
    aboveThreshold(metrics.linguisticComplexity.value, JEV_REVIEW_THRESHOLDS.linguisticComplexityAbove, "linguistic complexity"),
    belowThreshold(metrics.relationshipExplicitness.value, JEV_REVIEW_THRESHOLDS.relationshipExplicitnessBelow, "relationship explicitness"),
  ].filter((value): value is string => value !== undefined);

  return {
    ...clue,
    faithful: metrics.faithful.value,
    faithfulConfidence: metrics.faithful.confidence,
    ambiguous: metrics.ambiguous.value,
    ambiguousConfidence: metrics.ambiguous.confidence,
    readability: metrics.readability.value,
    readabilityConfidence: metrics.readability.confidence,
    linguisticComplexity: metrics.linguisticComplexity.value,
    linguisticComplexityConfidence: metrics.linguisticComplexity.confidence,
    relationshipExplicitness: metrics.relationshipExplicitness.value,
    relationshipExplicitnessConfidence: metrics.relationshipExplicitness.confidence,
    evaluationStatus: missingAnswers.length === 0 ? "complete" : "incomplete",
    missingAnswers,
    evaluatedAt,
    flagged: flagReasons.length > 0,
    flagReasons,
  };
}

export function applyJevPuzzleAnswers(
  puzzle: AuditedPuzzle,
  answers: Record<string, JevAnswer | undefined>,
  index: number,
  evaluatedAt = new Date().toISOString(),
): AuditedPuzzle {
  const metrics = {
    wordingRepetition: readMetricAnswer(answers, index, "wordingRepetition", "noul", 1),
    terminologyInconsistency: readMetricAnswer(answers, index, "terminologyInconsistency", "noul", 1),
    phrasingVariety: readMetricAnswer(answers, index, "phrasingVariety", "score", 2),
    linguisticDifficultyComparedToLogical: readMetricAnswer(answers, index, "linguisticDifficultyComparedToLogical", "score", 2),
  };
  const missingAnswers = missingMetricNames(metrics);
  const result: AuditedPuzzle = {
    ...puzzle,
    wordingRepetition: metrics.wordingRepetition.value,
    wordingRepetitionConfidence: metrics.wordingRepetition.confidence,
    terminologyInconsistency: metrics.terminologyInconsistency.value,
    terminologyInconsistencyConfidence: metrics.terminologyInconsistency.confidence,
    phrasingVariety: metrics.phrasingVariety.value,
    phrasingVarietyConfidence: metrics.phrasingVariety.confidence,
    linguisticDifficultyComparedToLogical: metrics.linguisticDifficultyComparedToLogical.value,
    linguisticDifficultyComparedToLogicalConfidence: metrics.linguisticDifficultyComparedToLogical.confidence,
    evaluationStatus: missingAnswers.length === 0 ? "complete" : "incomplete",
    missingAnswers,
    evaluatedAt,
    flagReasons: [],
  };
  result.flagReasons = puzzleReviewFlagReasons(result);
  return result;
}

export function puzzleReviewFlagReasons(puzzle: AuditedPuzzle): string[] {
  return [
    puzzle.wordingRepetition !== undefined && puzzle.wordingRepetition > JEV_REVIEW_THRESHOLDS.puzzleWordingRepetitionAbove
      ? `wording repetition above ${JEV_REVIEW_THRESHOLDS.puzzleWordingRepetitionAbove.toFixed(2)}` : undefined,
    puzzle.terminologyInconsistency !== undefined && puzzle.terminologyInconsistency > JEV_REVIEW_THRESHOLDS.puzzleTerminologyInconsistencyAbove
      ? `terminology inconsistency above ${JEV_REVIEW_THRESHOLDS.puzzleTerminologyInconsistencyAbove.toFixed(2)}` : undefined,
    puzzle.linguisticDifficultyComparedToLogical !== undefined && puzzle.linguisticDifficultyComparedToLogical > JEV_REVIEW_THRESHOLDS.linguisticDifficultyComparedToLogicalAbove
      ? `linguistic difficulty substantially above logical level (${JEV_REVIEW_THRESHOLDS.linguisticDifficultyComparedToLogicalAbove.toFixed(2)})` : undefined,
  ].filter((value): value is string => value !== undefined);
}

export function markClueUnavailable(clue: AuditedClue): AuditedClue {
  return { ...clue, evaluationStatus: "unavailable", missingAnswers: ["provider unavailable"] };
}

export function markPuzzleUnavailable(puzzle: AuditedPuzzle): AuditedPuzzle {
  return { ...puzzle, evaluationStatus: "unavailable", missingAnswers: ["provider unavailable"] };
}

function meanClueMetric(clues: readonly AuditedClue[], select: (clue: AuditedClue) => number | undefined): number | undefined {
  const values = clues.map(select).filter((value): value is number => value !== undefined);
  return values.length === 0 ? undefined : values.reduce((total, value) => total + value, 0) / values.length;
}

export function aggregateSemanticPuzzleEvidence(puzzle: AuditedPuzzle, clues: readonly AuditedClue[]): SemanticPuzzleEvidence {
  const puzzleClues = clues.filter(clue => clue.templateId === puzzle.templateId && clue.seed === puzzle.seed);
  const readability = meanClueMetric(puzzleClues, clue => clue.readability);
  const ambiguity = meanClueMetric(puzzleClues, clue => clue.ambiguous);
  const linguisticComplexity = meanClueMetric(puzzleClues, clue => clue.linguisticComplexity);
  const relationshipExplicitness = meanClueMetric(puzzleClues, clue => clue.relationshipExplicitness);
  const semanticAssessment = {
    ...(readability === undefined ? {} : { readability }),
    ...(ambiguity === undefined ? {} : { ambiguity }),
    ...(linguisticComplexity === undefined ? {} : { linguisticComplexity }),
    ...(relationshipExplicitness === undefined ? {} : { relationshipExplicitness }),
    evaluatedClues: puzzleClues.filter(clue => clue.evaluationStatus === "complete").length,
    totalClues: puzzleClues.length,
  };
  const hasPuzzleReview = puzzle.wordingRepetition !== undefined || puzzle.terminologyInconsistency !== undefined || puzzle.phrasingVariety !== undefined || puzzle.linguisticDifficultyComparedToLogical !== undefined;
  return {
    templateId: puzzle.templateId,
    seed: puzzle.seed,
    logicalDifficultyLevel: puzzle.logicalDifficultyLevel,
    difficultyModelVersion: puzzle.difficultyModelVersion,
    semanticAssessment,
    ...(hasPuzzleReview ? {
      puzzleReview: {
        ...(puzzle.wordingRepetition === undefined ? {} : { wordingRepetition: puzzle.wordingRepetition }),
        ...(puzzle.terminologyInconsistency === undefined ? {} : { terminologyInconsistency: puzzle.terminologyInconsistency }),
        ...(puzzle.phrasingVariety === undefined ? {} : { phrasingVariety: puzzle.phrasingVariety }),
        ...(puzzle.linguisticDifficultyComparedToLogical === undefined ? {} : { linguisticDifficultyComparedToLogical: puzzle.linguisticDifficultyComparedToLogical }),
      },
    } : {}),
  };
}

export function aggregateSemanticCalibrationEvidence(clues: readonly AuditedClue[], puzzles: readonly AuditedPuzzle[]): SemanticPuzzleEvidence[] {
  return puzzles.map(puzzle => aggregateSemanticPuzzleEvidence(puzzle, clues));
}

export function buildClueDecisionPayload(model: string, clues: readonly AuditedClue[]): JevDecisionPayload {
  const state = { clues: clues.map(({ clueId, text, expectedSemantics, constraintKind, structuredSemantics, templateId, phraseVariant, languageVersion, locale }) => ({
    clueId, text, expectedSemantics, constraintKind, structuredSemantics, templateId, phraseVariant, languageVersion, locale,
  })) };
  const questions: Record<string, unknown> = {};
  for (const [index] of clues.entries()) {
    const path = `clues[${index}]`;
    questions[`${index}_faithful`] = {
      type: "noul",
      instructions: `Does ${path}.text accurately and completely express ${path}.expectedSemantics? Treat a reversed ordering, missing exactness, changed negation, or changed relationship as inaccurate. Judge the wording only; structuredSemantics is the deterministic contract.`,
      criteria: { true: "The wording preserves every semantic constraint.", false: "The wording changes, omits, or contradicts a semantic constraint." },
    };
    questions[`${index}_ambiguous`] = {
      type: "noul",
      instructions: `Could a typical English-speaking logic-puzzle player reasonably interpret ${path}.text in more than one way that changes its logical meaning?`,
      criteria: { true: "Materially ambiguous to a player.", false: "Has one clear constraint interpretation." },
    };
    questions[`${index}_readability`] = {
      type: "score",
      instructions: `How natural and easy is ${path}.text for a typical judo logic-puzzle player to parse? Judge wording only, not puzzle difficulty.`,
      criteria: ["Difficult or awkward to parse", "Understandable but takes effort", "Clear and natural"],
    };
    questions[`${index}_linguisticComplexity`] = {
      type: "score",
      instructions: `How much linguistic processing does ${path}.text require independently of its logical constraint? Assess sentence structure and vocabulary, not reasoning complexity.`,
      criteria: ["Plain and direct", "Some extra phrasing to unpack", "Syntactically or lexically demanding"],
    };
    questions[`${index}_relationshipExplicitness`] = {
      type: "score",
      instructions: `How explicitly does ${path}.text state the relationship in ${path}.expectedSemantics?`,
      criteria: ["Relationship is indirect or must be unpacked", "Relationship is mostly clear", "Relationship is explicit and direct"],
    };
  }
  return { model, state, questions };
}

export function buildPuzzleDecisionPayload(model: string, puzzles: readonly AuditedPuzzle[]): JevDecisionPayload {
  const state = { puzzles: puzzles.map(({ templateId, templateTitle, seed, logicalDifficultyLevel, difficultyModelVersion, clues }) => ({
    templateId, templateTitle, seed, logicalDifficultyLevel, difficultyModelVersion, clues,
  })) };
  const questions: Record<string, unknown> = {};
  for (const [index] of puzzles.entries()) {
    const path = `puzzles[${index}]`;
    questions[`${index}_wordingRepetition`] = {
      type: "noul",
      instructions: `Do any clues in ${path}.clues use unnecessarily repetitive wording beyond what is needed to state their constraints? Judge wording patterns only.`,
      criteria: { true: "Several clues repeat phrasing in a way likely to feel monotonous.", false: "Wording repetition is not a notable issue." },
    };
    questions[`${index}_terminologyInconsistency`] = {
      type: "noul",
      instructions: `Is terminology used inconsistently across ${path}.clues in a way that could confuse a player?`,
      criteria: { true: "Terminology shifts could confuse the reader.", false: "Terminology is consistent enough to follow." },
    };
    questions[`${index}_phrasingVariety`] = {
      type: "score",
      instructions: `How varied and clear is the phrasing across ${path}.clues? Consider variety without rewarding unnecessary complexity.`,
      criteria: ["Overly repetitive or confusing", "Adequate variety and clarity", "Clear, useful variety"],
    };
    questions[`${index}_linguisticDifficultyComparedToLogical`] = {
      type: "score",
      instructions: `Compared with the deterministic logical difficulty level ${path}.logicalDifficultyLevel, how much harder is this clue set to parse because of language alone? Do not reassess puzzle truth or logical difficulty.`,
      criteria: ["Language is no harder than the logical level suggests", "Language adds some extra effort", "Language makes the puzzle much harder to parse than its logical level suggests"],
    };
  }
  return { model, state, questions };
}

export function readJevDecisionResponse(value: unknown): JevDecisionResponse {
  const body = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as { model?: unknown; answers?: unknown; usage?: unknown }
    : {};
  const usage = body.usage !== null && typeof body.usage === "object" && !Array.isArray(body.usage)
    ? body.usage as Record<string, unknown>
    : {};
  const metric = (...names: string[]) => {
    const value = names.map(name => usage[name]).find(candidate => finiteInRange(candidate, 0, Number.MAX_SAFE_INTEGER));
    return finiteInRange(value, 0, Number.MAX_SAFE_INTEGER) ? value : undefined;
  };
  return {
    ...(typeof body.model === "string" ? { model: body.model } : {}),
    answers: readJevAnswerMap(body.answers),
    usage: {
      ...(metric("cost") === undefined ? {} : { cost: metric("cost") }),
      ...(metric("input_tokens", "prompt_tokens") === undefined ? {} : { inputTokens: metric("input_tokens", "prompt_tokens") }),
      ...(metric("output_tokens", "completion_tokens") === undefined ? {} : { outputTokens: metric("output_tokens", "completion_tokens") }),
    },
  };
}

export async function requestJevDecisionBatch(
  apiKey: string,
  payload: JevDecisionPayload,
  endpoint: string,
  fetcher: typeof fetch = fetch,
): Promise<JevDecisionResponse> {
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`JEV request failed (${response.status}): ${await response.text()}`);
  return readJevDecisionResponse(await response.json() as unknown);
}

export function assertCheckpointConfiguration(actual: JevRunConfiguration, expected: JevRunConfiguration): void {
  const keys: (keyof JevRunConfiguration)[] = ["difficultySamples", "clueSamples", "batchSize", "endpoint", "requestedModel", "semanticAssessmentSchemaVersion", "puzzleReview"];
  const mismatches = keys.filter(key => actual[key] !== expected[key]);
  if (JSON.stringify(actual.reviewThresholds) !== JSON.stringify(expected.reviewThresholds)) mismatches.push("reviewThresholds");
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

function integerOr(value: unknown, fallback: number): number {
  return Number.isInteger(value) ? value as number : fallback;
}

function normalizeDifficultyAuditRow(item: unknown, index: number): DifficultyCorpusAudit {
  if (item === null || typeof item !== "object" || Array.isArray(item)) throw new Error(`invalid difficulty audit row at index ${index}`);
  const row = item as Partial<DifficultyCorpusAudit>;
  if (typeof row.sampleSize !== "number") throw new Error(`invalid difficulty audit sample size at index ${index}`);
  return {
    ...row,
    generated: integerOr(row.generated, row.sampleSize),
    unavailable: integerOr(row.unavailable, 0),
  } as DifficultyCorpusAudit;
}

function normalizeDifficultyAuditRows(value: unknown): DifficultyCorpusAudit[] {
  return Array.isArray(value) ? value.map(normalizeDifficultyAuditRow) : [];
}

/** Complete missing targeted levels, persisting after each one for resumable long audits. */
export async function checkpointTargetedDifficultyLevels(
  checkpoint: AuditCheckpoint,
  checkpointPath: string,
  template: PuzzleTemplate,
  onProgress?: DifficultyAuditProgressCallback,
  auditLevel: typeof auditTargetedDifficultyLevel = auditTargetedDifficultyLevel,
): Promise<void> {
  const [minimumLevel, maximumLevel] = template.metadata?.difficultyCalibration.levelRange ?? [1, 12];
  let audit = checkpoint.targetedDifficultyAudit.find(row => row.templateId === template.id);
  if (!audit) {
    audit = {
      templateId: template.id,
      modelVersion: "unresolved",
      sampleSize: checkpoint.configuration.difficultySamples,
      seedPrefix: "targeted-difficulty-audit",
      levels: [],
    };
    checkpoint.targetedDifficultyAudit.push(audit);
    await writeAuditCheckpoint(checkpointPath, checkpoint);
  }
  if (audit.sampleSize !== checkpoint.configuration.difficultySamples) {
    throw new Error(`targeted difficulty checkpoint sample size does not match ${template.id}`);
  }
  for (let level = minimumLevel; level <= maximumLevel; level += 1) {
    if (audit.levels.some(result => result.requestedDifficultyLevel === level)) continue;
    const result = auditLevel(template, level as Difficulty["level"], {
      sampleSize: checkpoint.configuration.difficultySamples,
      seedPrefix: audit.seedPrefix,
      onProgress,
    });
    if (audit.modelVersion !== "unresolved" && audit.modelVersion !== result.modelVersion) {
      throw new Error(`difficulty model version changed while auditing ${template.id}`);
    }
    audit.modelVersion = result.modelVersion;
    audit.levels.push(result.level);
    audit.levels.sort((left, right) => left.requestedDifficultyLevel - right.requestedDifficultyLevel);
    await writeAuditCheckpoint(checkpointPath, checkpoint);
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
  const checkpoint = JSON.parse(source) as {
    version?: unknown;
    clues?: unknown;
    puzzles?: unknown;
    difficultyAudit?: unknown;
    productionDifficultyAudit?: unknown;
    targetedDifficultyAudit?: unknown;
    [key: string]: unknown;
  };
  if (!checkpoint || (checkpoint.version !== 2 && checkpoint.version !== 3) || !Array.isArray(checkpoint.clues) || !Array.isArray(checkpoint.puzzles) || !Array.isArray(checkpoint.difficultyAudit) || !Array.isArray(checkpoint.targetedDifficultyAudit)) {
    throw new Error(`invalid audit checkpoint: ${path}`);
  }
  return {
    ...checkpoint as unknown as AuditCheckpoint,
    version: 3,
    difficultyAudit: normalizeDifficultyAuditRows(checkpoint.difficultyAudit),
    productionDifficultyAudit: normalizeDifficultyAuditRows(checkpoint.productionDifficultyAudit),
  };
}

/** Read current or pre-production-path JEV reports for reusable puzzle review. */
export async function readJevAuditReport(path: string): Promise<JevAuditReport> {
  const report = JSON.parse(await readFile(path, "utf8")) as Partial<JevAuditReport>;
  if (!report || typeof report.startedAt !== "string" || !report.configuration || !Array.isArray(report.difficultyAudit)
    || !Array.isArray(report.targetedDifficultyAudit) || !Array.isArray(report.semanticCalibrationEvidence)
    || !report.clueAudit || !Array.isArray(report.clueAudit.clues) || !report.puzzleAudit) {
    throw new Error(`invalid JEV audit report: ${path}`);
  }
  return {
    ...report,
    difficultyAudit: normalizeDifficultyAuditRows(report.difficultyAudit),
    productionDifficultyAudit: normalizeDifficultyAuditRows(report.productionDifficultyAudit),
  } as JevAuditReport;
}

/** Rebuild puzzle-level review inputs from a report's paired semantic clue sample. */
export function rebuildPuzzleReviewCorpus(
  report: JevAuditReport,
  templateTitles: Readonly<Record<string, string>>,
): AuditedPuzzle[] {
  if (report.puzzleAudit.enabled && report.puzzleAudit.puzzles.length > 0) return report.puzzleAudit.puzzles;
  const cluesByPuzzle = new Map<string, AuditedClue[]>();
  for (const clue of report.clueAudit.clues) {
    const key = JSON.stringify([clue.templateId, clue.seed]);
    cluesByPuzzle.set(key, [...(cluesByPuzzle.get(key) ?? []), clue]);
  }
  return report.semanticCalibrationEvidence.map(evidence => {
    const clues = cluesByPuzzle.get(JSON.stringify([evidence.templateId, evidence.seed])) ?? [];
    if (clues.length === 0) throw new Error(`report has no clue sample for ${evidence.templateId} / ${evidence.seed}`);
    return {
      templateId: evidence.templateId,
      templateTitle: templateTitles[evidence.templateId] ?? evidence.templateId,
      seed: evidence.seed,
      logicalDifficultyLevel: evidence.logicalDifficultyLevel,
      difficultyModelVersion: evidence.difficultyModelVersion,
      clues: clues.map(({ clueId, text, expectedSemantics, constraintKind, structuredSemantics, phraseVariant, languageVersion }) => ({
        clueId, text, expectedSemantics, constraintKind, structuredSemantics, phraseVariant, languageVersion,
      })),
      flagReasons: [],
      evaluationStatus: "pending",
      missingAnswers: [],
    };
  });
}
