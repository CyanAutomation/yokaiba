import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { ClueConstraint, Difficulty, DifficultyCorpusAudit, TargetedDifficultyCorpusAudit } from "../src/index.js";

export const SEMANTIC_ASSESSMENT_SCHEMA_VERSION = "yokaiba-jev-semantic-v1";

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
  resume: boolean;
  puzzleReview: boolean;
}

export interface AuditCheckpoint {
  version: 2;
  startedAt: string;
  configuration: JevRunConfiguration;
  difficultyAudit: DifficultyCorpusAudit[];
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
  const knownFlags = new Set(["--samples", "--difficulty-samples", "--clue-samples", "--batch-size", "--out", "--resume", "--puzzle-review"]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (!arg.startsWith("--")) throw new Error(`unexpected argument: ${arg}`);
    if (!knownFlags.has(arg)) throw new Error(`unknown argument: ${arg}`);
    if (arg === "--resume" || arg === "--puzzle-review") continue;
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
    puzzleReview: args.includes("--puzzle-review"),
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
  const linguisticComplexityAnswer = answers[`${index}_linguisticComplexity`];
  const relationshipExplicitnessAnswer = answers[`${index}_relationshipExplicitness`];
  const faithful = finiteInRange(faithfulAnswer?.noul, 0, 1) ? faithfulAnswer.noul : undefined;
  const ambiguous = finiteInRange(ambiguousAnswer?.noul, 0, 1) ? ambiguousAnswer.noul : undefined;
  const readability = finiteInRange(readabilityAnswer?.score, 0, 2) ? readabilityAnswer.score : undefined;
  const linguisticComplexity = finiteInRange(linguisticComplexityAnswer?.score, 0, 2) ? linguisticComplexityAnswer.score : undefined;
  const relationshipExplicitness = finiteInRange(relationshipExplicitnessAnswer?.score, 0, 2) ? relationshipExplicitnessAnswer.score : undefined;
  const missingAnswers = [
    faithful === undefined ? "faithful" : undefined,
    ambiguous === undefined ? "ambiguous" : undefined,
    readability === undefined ? "readability" : undefined,
    linguisticComplexity === undefined ? "linguisticComplexity" : undefined,
    relationshipExplicitness === undefined ? "relationshipExplicitness" : undefined,
  ].filter((value): value is string => value !== undefined);
  const flagReasons = [
    faithful !== undefined && faithful < JEV_REVIEW_THRESHOLDS.faithfulnessBelow ? `faithfulness below ${JEV_REVIEW_THRESHOLDS.faithfulnessBelow.toFixed(2)}` : undefined,
    ambiguous !== undefined && ambiguous > JEV_REVIEW_THRESHOLDS.ambiguityAbove ? `ambiguity above ${JEV_REVIEW_THRESHOLDS.ambiguityAbove.toFixed(2)}` : undefined,
    readability !== undefined && readability < JEV_REVIEW_THRESHOLDS.readabilityBelow ? `readability below ${JEV_REVIEW_THRESHOLDS.readabilityBelow.toFixed(2)}` : undefined,
    linguisticComplexity !== undefined && linguisticComplexity > JEV_REVIEW_THRESHOLDS.linguisticComplexityAbove ? `linguistic complexity above ${JEV_REVIEW_THRESHOLDS.linguisticComplexityAbove.toFixed(2)}` : undefined,
    relationshipExplicitness !== undefined && relationshipExplicitness < JEV_REVIEW_THRESHOLDS.relationshipExplicitnessBelow ? `relationship explicitness below ${JEV_REVIEW_THRESHOLDS.relationshipExplicitnessBelow.toFixed(2)}` : undefined,
  ].filter((value): value is string => value !== undefined);

  return {
    ...clue,
    faithful,
    faithfulConfidence: optionalConfidence(faithfulAnswer),
    ambiguous,
    ambiguousConfidence: optionalConfidence(ambiguousAnswer),
    readability,
    readabilityConfidence: optionalConfidence(readabilityAnswer),
    linguisticComplexity,
    linguisticComplexityConfidence: optionalConfidence(linguisticComplexityAnswer),
    relationshipExplicitness,
    relationshipExplicitnessConfidence: optionalConfidence(relationshipExplicitnessAnswer),
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
  const repetitionAnswer = answers[`${index}_wordingRepetition`];
  const terminologyAnswer = answers[`${index}_terminologyInconsistency`];
  const varietyAnswer = answers[`${index}_phrasingVariety`];
  const relativeDifficultyAnswer = answers[`${index}_linguisticDifficultyComparedToLogical`];
  const wordingRepetition = finiteInRange(repetitionAnswer?.noul, 0, 1) ? repetitionAnswer.noul : undefined;
  const terminologyInconsistency = finiteInRange(terminologyAnswer?.noul, 0, 1) ? terminologyAnswer.noul : undefined;
  const phrasingVariety = finiteInRange(varietyAnswer?.score, 0, 2) ? varietyAnswer.score : undefined;
  const linguisticDifficultyComparedToLogical = finiteInRange(relativeDifficultyAnswer?.score, 0, 2) ? relativeDifficultyAnswer.score : undefined;
  const missingAnswers = [
    wordingRepetition === undefined ? "wordingRepetition" : undefined,
    terminologyInconsistency === undefined ? "terminologyInconsistency" : undefined,
    phrasingVariety === undefined ? "phrasingVariety" : undefined,
    linguisticDifficultyComparedToLogical === undefined ? "linguisticDifficultyComparedToLogical" : undefined,
  ].filter((value): value is string => value !== undefined);
  const result: AuditedPuzzle = {
    ...puzzle,
    wordingRepetition,
    wordingRepetitionConfidence: optionalConfidence(repetitionAnswer),
    terminologyInconsistency,
    terminologyInconsistencyConfidence: optionalConfidence(terminologyAnswer),
    phrasingVariety,
    phrasingVarietyConfidence: optionalConfidence(varietyAnswer),
    linguisticDifficultyComparedToLogical,
    linguisticDifficultyComparedToLogicalConfidence: optionalConfidence(relativeDifficultyAnswer),
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

export function aggregateSemanticCalibrationEvidence(clues: readonly AuditedClue[], puzzles: readonly AuditedPuzzle[]): SemanticPuzzleEvidence[] {
  return puzzles.map(puzzle => {
    const puzzleClues = clues.filter(clue => clue.templateId === puzzle.templateId && clue.seed === puzzle.seed);
    const mean = (select: (clue: AuditedClue) => number | undefined) => {
      const values = puzzleClues.map(select).filter((value): value is number => value !== undefined);
      return values.length === 0 ? undefined : values.reduce((total, value) => total + value, 0) / values.length;
    };
    const readability = mean(clue => clue.readability);
    const ambiguity = mean(clue => clue.ambiguous);
    const linguisticComplexity = mean(clue => clue.linguisticComplexity);
    const relationshipExplicitness = mean(clue => clue.relationshipExplicitness);
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
  });
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

export async function readAuditCheckpoint(path: string): Promise<AuditCheckpoint | undefined> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  const checkpoint = JSON.parse(source) as AuditCheckpoint;
  if (!checkpoint || checkpoint.version !== 2 || !Array.isArray(checkpoint.clues) || !Array.isArray(checkpoint.puzzles) || !Array.isArray(checkpoint.difficultyAudit) || !Array.isArray(checkpoint.targetedDifficultyAudit)) {
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
    `Semantic assessment schema: ${report.configuration.semanticAssessmentSchemaVersion}`,
    `Provisional review thresholds: ${JSON.stringify(report.configuration.reviewThresholds)}`,
    `Samples: ${report.configuration.difficultySamples} per difficulty template; ${report.configuration.clueSamples} per wording template; batch size ${report.configuration.batchSize}.`,
    `Clues reviewed: ${clueAudit.sampledClues}; status: ${clueAudit.status}; review leads: ${clueAudit.flaggedClues.length}; incomplete: ${clueAudit.incompleteClues.length}; unavailable: ${clueAudit.unavailableClues.length}; reported cost: $${clueAudit.totalCost.toFixed(6)} (${clueAudit.totalInputTokens} input / ${clueAudit.totalOutputTokens} output tokens).`,
    `Puzzle-level review: ${report.puzzleAudit.enabled ? "enabled" : "disabled"}; ${report.puzzleAudit.completePuzzles} complete / ${report.puzzleAudit.sampledPuzzles} sampled; ${report.puzzleAudit.flaggedPuzzles.length} review leads.`,
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
  lines.push(
    "",
    "## Semantic and logical calibration evidence",
    "",
    "Logical level and model version are deterministic. Semantic measurements are probabilistic JEV assessments and remain independent; rows below aggregate each sampled puzzle's clue scores by logical level. The JSON report keeps each template, seed, and paired raw profile for later comparison with player outcomes.",
    "",
    "| Template | Logical level / model | Puzzles | Readability (0–2) | Ambiguity (0–1) | Linguistic complexity (0–2) | Relationship explicitness (0–2) | Language burden vs logical level (0–2) |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
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
  lines.push("", "## JEV wording flags", "");
  if (clueAudit.flaggedClues.length === 0) lines.push("No clue crossed the conservative review thresholds.");
  else {
    lines.push("Scores include JEV confidence in parentheses when supplied.", "");
    lines.push(
      "| Template / clue | Text | Faithfulness | Ambiguity | Readability | Linguistic complexity | Relationship explicitness | Flag reasons | Evaluation |",
      "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |",
    );
    for (const clue of clueAudit.flaggedClues) {
      lines.push(`| ${escapeTableCell(`${clue.templateId} / ${clue.clueId}`)} | ${escapeTableCell(clue.text)} | ${formattedScore(clue.faithful, clue.faithfulConfidence)} | ${formattedScore(clue.ambiguous, clue.ambiguousConfidence)} | ${formattedScore(clue.readability, clue.readabilityConfidence)} | ${formattedScore(clue.linguisticComplexity, clue.linguisticComplexityConfidence)} | ${formattedScore(clue.relationshipExplicitness, clue.relationshipExplicitnessConfidence)} | ${escapeTableCell(clue.flagReasons.join(", "))} | ${clue.evaluationStatus} |`);
    }
  }
  if (report.puzzleAudit.enabled) {
    lines.push("", "## Puzzle-level semantic review leads", "");
    if (report.puzzleAudit.flaggedPuzzles.length === 0) lines.push("No puzzle-level response crossed the provisional review thresholds.");
    else {
      lines.push("These are review leads, not deterministic QA failures.", "", "| Template / seed | Logical level | Repetition | Terminology inconsistency | Phrasing variety | Language burden vs logical level | Evaluation |", "| --- | ---: | ---: | ---: | ---: | ---: | --- |");
      for (const puzzle of report.puzzleAudit.flaggedPuzzles) {
        lines.push(`| ${escapeTableCell(`${puzzle.templateId} / ${puzzle.seed}`)} | ${puzzle.logicalDifficultyLevel} (${puzzle.difficultyModelVersion}) | ${formattedScore(puzzle.wordingRepetition, puzzle.wordingRepetitionConfidence)} | ${formattedScore(puzzle.terminologyInconsistency, puzzle.terminologyInconsistencyConfidence)} | ${formattedScore(puzzle.phrasingVariety, puzzle.phrasingVarietyConfidence)} | ${formattedScore(puzzle.linguisticDifficultyComparedToLogical, puzzle.linguisticDifficultyComparedToLogicalConfidence)} | ${puzzle.evaluationStatus} |`);
      }
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
  if (clueAudit.unavailableClues.length > 0 || report.puzzleAudit.unavailablePuzzles > 0) {
    lines.push("", "JEV provider results were unavailable for some or all semantic assessments. Deterministic difficulty and puzzle QA remain available; keep or resume the checkpoint to retry the semantic review.");
  }
  lines.push("", "JEV thresholds are provisional review leads, not gates or evidence that a deterministic clue contract is broken. Logical difficulty is deterministic, semantic difficulty is probabilistic JEV analysis, and aggregated player outcomes remain the empirical calibration signal. /v1/events currently accepts outcomes but does not produce these aggregates.", "");
  return lines.join("\n");
}
