import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  auditDifficultyCorpus,
  auditTargetedDifficultyCorpus,
  generatePuzzle,
  type Clue,
} from "../src/index.js";
import { championshipBridgeTemplate } from "../src/templates/championship-bridge.js";
import { championshipCircuitTemplate } from "../src/templates/championship-circuit.js";
import { openDivisionTemplate } from "../src/templates/open-division.js";
import { tournamentOrderTemplate } from "../src/templates/tournament-order.js";
import { tournamentOrderV2Template } from "../src/templates/tournament-order-v2.js";
import {
  applyJevAnswers,
  applyJevPuzzleAnswers,
  aggregateSemanticCalibrationEvidence,
  assertCheckpointConfiguration,
  buildClueDecisionPayload,
  buildAuditMarkdown,
  buildPuzzleDecisionPayload,
  markClueUnavailable,
  markPuzzleUnavailable,
  parseAuditArguments,
  puzzleReviewFlagReasons,
  readAuditCheckpoint,
  requestJevDecisionBatch,
  writeAuditCheckpoint,
  SEMANTIC_ASSESSMENT_SCHEMA_VERSION,
  JEV_REVIEW_THRESHOLDS,
  type AuditCheckpoint,
  type AuditedClue,
  type AuditedPuzzle,
  type JevAuditReport,
  type JevRunConfiguration,
} from "./audit-jev-support.js";

const ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
const MODEL = "~typesafe/jev-latest";
const templates = [tournamentOrderTemplate, tournamentOrderV2Template, openDivisionTemplate, championshipBridgeTemplate, championshipCircuitTemplate];
const targetedTemplates = [tournamentOrderV2Template, openDivisionTemplate, championshipBridgeTemplate, championshipCircuitTemplate];
const apiKey = process.env.OPENROUTER_API_KEY;

function requestSemanticBatch(payload: Parameters<typeof requestJevDecisionBatch>[1]) {
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set; JEV semantic results are unavailable.");
  return requestJevDecisionBatch(apiKey, payload, ENDPOINT);
}

function describeConstraint(clue: Clue): string {
  const constraint = clue.constraint;
  if (constraint.kind === "matches") return `${constraint.subject} is associated with ${constraint.value} in ${constraint.category}.`;
  if (constraint.kind === "notMatches") return `${constraint.subject} is not associated with ${constraint.value} in ${constraint.category}.`;
  if (constraint.kind === "sameRow") return `${constraint.left.value} in ${constraint.left.category} belongs to the same competitor as ${constraint.right.value} in ${constraint.right.category}.`;
  if (constraint.kind === "before") return `${constraint.left.value} in ${constraint.left.category} is earlier than ${constraint.right.value} in ${constraint.right.category}.`;
  if (constraint.kind === "adjacent") return `${constraint.left.value} in ${constraint.left.category} is immediately next to ${constraint.right.value} in ${constraint.right.category}.`;
  return `The positions of ${constraint.left.value} in ${constraint.left.category} and ${constraint.right.value} in ${constraint.right.category} differ by exactly ${constraint.distance}.`;
}

function reportAuditProgress(progress: { phase: "difficulty" | "targeted"; templateId: string; requestedDifficultyLevel?: number; completed: number; total: number }) {
  const interval = Math.max(1, Math.ceil(progress.total / 10));
  if (progress.completed !== 1 && progress.completed !== progress.total && progress.completed % interval !== 0) return;
  const scope = progress.requestedDifficultyLevel === undefined ? progress.templateId : `${progress.templateId} level ${progress.requestedDifficultyLevel}`;
  console.error(`${progress.phase} audit ${scope}: ${progress.completed}/${progress.total}`);
}

function initialClue(clue: Clue, templateId: string, seed: string, difficulty: { level: AuditedClue["logicalDifficultyLevel"]; modelVersion: string }, locale?: string): AuditedClue {
  return {
    templateId,
    seed,
    clueId: clue.id,
    text: clue.text,
    expectedSemantics: describeConstraint(clue),
    constraintKind: clue.constraint.kind,
    structuredSemantics: clue.constraint,
    phraseVariant: clue.phraseVariant,
    languageVersion: clue.languageVersion,
    ...(locale === undefined ? {} : { locale }),
    logicalDifficultyLevel: difficulty.level,
    difficultyModelVersion: difficulty.modelVersion,
    evaluationStatus: "pending",
    missingAnswers: [],
    flagged: false,
    flagReasons: [],
  };
}

function initialPuzzle(puzzle: ReturnType<typeof generatePuzzle>, templateTitle: string): AuditedPuzzle {
  return {
    templateId: puzzle.templateId,
    templateTitle,
    seed: puzzle.seed,
    logicalDifficultyLevel: puzzle.difficulty.level,
    difficultyModelVersion: puzzle.difficulty.modelVersion,
    clues: puzzle.clues.map(clue => ({
      clueId: clue.id,
      text: clue.text,
      expectedSemantics: describeConstraint(clue),
      constraintKind: clue.constraint.kind,
      structuredSemantics: clue.constraint,
      phraseVariant: clue.phraseVariant,
      languageVersion: clue.languageVersion,
    })),
    flagReasons: [],
    evaluationStatus: "pending",
    missingAnswers: [],
  };
}

const args = parseAuditArguments(process.argv.slice(2));

const invocationStartedAt = new Date().toISOString();
const defaultBase = `reports/jev-audit-${invocationStartedAt.replaceAll(":", "-").replaceAll(".", "-")}`;
const outputBase = args.outputBase ?? defaultBase;
const target = resolve(`${outputBase}.json`);
const markdownTarget = target.replace(/\.json$/, ".md");
const checkpointPath = resolve(`${outputBase}.checkpoint.json`);
const configuration: JevRunConfiguration = {
  difficultySamples: args.difficultySamples,
  clueSamples: args.clueSamples,
  batchSize: args.batchSize,
  endpoint: ENDPOINT,
  requestedModel: MODEL,
  semanticAssessmentSchemaVersion: SEMANTIC_ASSESSMENT_SCHEMA_VERSION,
  puzzleReview: args.puzzleReview,
  reviewThresholds: JEV_REVIEW_THRESHOLDS,
};

console.error(`JEV audit output: ${target}`);
console.error(`Starting deterministic audits: ${args.difficultySamples} difficulty samples/template, ${args.clueSamples} wording samples/template.`);

let checkpoint: AuditCheckpoint | undefined;
if (args.resume) {
  checkpoint = await readAuditCheckpoint(checkpointPath);
  if (!checkpoint) throw new Error(`cannot resume: no checkpoint found at ${checkpointPath}`);
  assertCheckpointConfiguration(checkpoint.configuration, configuration);
  checkpoint.clues = checkpoint.clues.map(clue => clue.evaluationStatus === "unavailable" ? { ...clue, evaluationStatus: "pending", missingAnswers: [] } : clue);
  checkpoint.puzzles = checkpoint.puzzles.map(puzzle => puzzle.evaluationStatus === "unavailable" ? { ...puzzle, evaluationStatus: "pending", missingAnswers: [] } : puzzle);
console.error(`Resuming checkpoint: ${checkpoint.clues.filter(clue => clue.evaluationStatus !== "pending").length}/${checkpoint.clues.length} clues already processed.`);
}

if (!checkpoint) {
  const difficultyAudit = templates.map(template => ({
    ...auditDifficultyCorpus(template, { sampleSize: args.difficultySamples, onProgress: reportAuditProgress }),
  }));
  const targetedDifficultyAudit = targetedTemplates.map(template => ({
    ...auditTargetedDifficultyCorpus(template, { sampleSize: args.difficultySamples, onProgress: reportAuditProgress }),
  }));
  const clues: AuditedClue[] = [];
  const puzzles: AuditedPuzzle[] = [];
  for (const template of templates) {
    const reportInterval = Math.max(1, Math.ceil(args.clueSamples / 10));
    for (let sample = 0; sample < args.clueSamples; sample += 1) {
      const seed = `jev-wording-${sample}`;
      const puzzle = generatePuzzle(template, seed);
      clues.push(...puzzle.clues.map(clue => initialClue(clue, template.id, seed, puzzle.difficulty, template.metadata?.locales.default)));
      puzzles.push(initialPuzzle(puzzle, template.title));
      if ((sample + 1) % reportInterval === 0 || sample + 1 === args.clueSamples) {
        console.error(`generated wording clues ${template.id}: ${sample + 1}/${args.clueSamples}`);
      }
    }
  }
  checkpoint = {
    version: 2,
    startedAt: invocationStartedAt,
    configuration,
    difficultyAudit,
    targetedDifficultyAudit,
    clues,
    puzzles,
    totalCost: 0,
    resolvedModel: "unresolved",
    totalInputTokens: 0,
    totalOutputTokens: 0,
  };
  await writeAuditCheckpoint(checkpointPath, checkpoint);
}

const totalBatches = Math.ceil(checkpoint.clues.length / configuration.batchSize);
const processedBeforeRun = checkpoint.clues.filter(clue => clue.evaluationStatus !== "pending").length;
console.error(`JEV semantic audit: ${processedBeforeRun}/${checkpoint.clues.length} clues processed; ${totalBatches} total batches.`);
let providerUnavailable = false;
try {
  for (let offset = 0; offset < checkpoint.clues.length; offset += configuration.batchSize) {
    const batch = checkpoint.clues.slice(offset, offset + configuration.batchSize);
    const pending = batch.filter(clue => clue.evaluationStatus === "pending");
    if (pending.length === 0) continue;
    const response = await requestSemanticBatch(buildClueDecisionPayload(MODEL, pending));
    checkpoint.resolvedModel = response.model ?? checkpoint.resolvedModel;
    checkpoint.totalCost += response.usage.cost ?? 0;
    checkpoint.totalInputTokens += response.usage.inputTokens ?? 0;
    checkpoint.totalOutputTokens += response.usage.outputTokens ?? 0;
    for (const [index, clue] of pending.entries()) {
      checkpoint.clues[offset + batch.indexOf(clue)] = applyJevAnswers(clue, response.answers, index);
    }
    await writeAuditCheckpoint(checkpointPath, checkpoint);
    const reviewed = checkpoint.clues.filter(clue => clue.evaluationStatus !== "pending").length;
    console.error(`JEV reviewed ${reviewed}/${checkpoint.clues.length} clues; batch ${Math.ceil((offset + 1) / configuration.batchSize)}/${totalBatches}`);
  }
  if (configuration.puzzleReview) {
    for (let offset = 0; offset < checkpoint.puzzles.length; offset += configuration.batchSize) {
      const batch = checkpoint.puzzles.slice(offset, offset + configuration.batchSize);
      const pending = batch.filter(puzzle => puzzle.evaluationStatus === "pending");
      if (pending.length === 0) continue;
      const response = await requestSemanticBatch(buildPuzzleDecisionPayload(MODEL, pending));
      checkpoint.resolvedModel = response.model ?? checkpoint.resolvedModel;
      checkpoint.totalCost += response.usage.cost ?? 0;
      checkpoint.totalInputTokens += response.usage.inputTokens ?? 0;
      checkpoint.totalOutputTokens += response.usage.outputTokens ?? 0;
      for (const [index, puzzle] of pending.entries()) {
        checkpoint.puzzles[offset + batch.indexOf(puzzle)] = applyJevPuzzleAnswers(puzzle, response.answers, index);
      }
      await writeAuditCheckpoint(checkpointPath, checkpoint);
      const reviewed = checkpoint.puzzles.filter(puzzle => puzzle.evaluatedAt).length;
      console.error(`JEV reviewed ${reviewed}/${checkpoint.puzzles.length} puzzle sets`);
    }
  }
} catch (error) {
  providerUnavailable = true;
  checkpoint.clues = checkpoint.clues.map(clue => clue.evaluationStatus === "pending" ? markClueUnavailable(clue) : clue);
  if (configuration.puzzleReview) checkpoint.puzzles = checkpoint.puzzles.map(puzzle => puzzle.evaluationStatus === "pending" ? markPuzzleUnavailable(puzzle) : puzzle);
  console.error(`JEV provider unavailable: ${error instanceof Error ? error.message : String(error)}. Semantic results are marked unavailable; checkpoint kept at ${checkpointPath} for retry with --out ${outputBase} --resume.`);
  await writeAuditCheckpoint(checkpointPath, checkpoint);
}

const flaggedClues = checkpoint.clues.filter(clue => clue.flagged);
const incompleteClues = checkpoint.clues.filter(clue => clue.evaluationStatus === "incomplete");
const unavailableClues = checkpoint.clues.filter(clue => clue.evaluationStatus === "unavailable");
const completePuzzles = checkpoint.puzzles.filter(puzzle => puzzle.evaluationStatus === "complete");
const incompletePuzzles = checkpoint.puzzles.filter(puzzle => puzzle.evaluationStatus === "incomplete");
const unavailablePuzzles = checkpoint.puzzles.filter(puzzle => puzzle.evaluationStatus === "unavailable");
const completeClueCount = checkpoint.clues.filter(clue => clue.evaluationStatus === "complete").length;
const clueAuditStatus = completeClueCount === checkpoint.clues.length
  ? "complete"
  : completeClueCount === 0 && unavailableClues.length === checkpoint.clues.length
    ? "unavailable"
    : "partial";
const report: JevAuditReport = {
  startedAt: checkpoint.startedAt,
  generatedAt: new Date().toISOString(),
  configuration: { ...configuration, resolvedModel: checkpoint.resolvedModel },
  difficultyAudit: checkpoint.difficultyAudit,
  targetedDifficultyAudit: checkpoint.targetedDifficultyAudit,
  semanticCalibrationEvidence: aggregateSemanticCalibrationEvidence(checkpoint.clues, checkpoint.puzzles),
  clueAudit: {
    model: checkpoint.resolvedModel,
    sampledClues: checkpoint.clues.length,
    totalCost: checkpoint.totalCost,
    totalInputTokens: checkpoint.totalInputTokens,
    totalOutputTokens: checkpoint.totalOutputTokens,
    status: clueAuditStatus,
    flaggedClues,
    incompleteClues,
    unavailableClues,
    clues: checkpoint.clues,
  },
  puzzleAudit: {
    enabled: configuration.puzzleReview,
    sampledPuzzles: configuration.puzzleReview ? checkpoint.puzzles.length : 0,
    completePuzzles: completePuzzles.length,
    incompletePuzzles: incompletePuzzles.length,
    unavailablePuzzles: configuration.puzzleReview ? unavailablePuzzles.length : 0,
    flaggedPuzzles: configuration.puzzleReview ? checkpoint.puzzles.filter(puzzle => puzzleReviewFlagReasons(puzzle).length > 0) : [],
    puzzles: configuration.puzzleReview ? checkpoint.puzzles : [],
  },
};

await mkdir(dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(markdownTarget, buildAuditMarkdown(report));
if (!providerUnavailable) await unlink(checkpointPath).catch(error => {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
});
console.log(JSON.stringify({
  json: target,
  markdown: markdownTarget,
  reviewedClues: checkpoint.clues.length,
  flaggedClues: flaggedClues.length,
  incompleteEvaluations: incompleteClues.length,
  unavailableEvaluations: unavailableClues.length,
  semanticAssessmentSchemaVersion: configuration.semanticAssessmentSchemaVersion,
  puzzleReview: configuration.puzzleReview,
  cost: checkpoint.totalCost,
}, null, 2));
