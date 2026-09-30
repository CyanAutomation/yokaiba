import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  auditDifficultyCorpus,
  auditProductionDifficultyCorpus,
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
  checkpointTargetedDifficultyLevels,
  buildClueDecisionPayload,
  buildAuditMarkdown,
  buildPuzzleDecisionPayload,
  markClueUnavailable,
  markPuzzleUnavailable,
  parseAuditArguments,
  puzzleReviewFlagReasons,
  readAuditCheckpoint,
  readJevAuditReport,
  rebuildPuzzleReviewCorpus,
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
const sourceReport = args.puzzleReviewFrom ? await readJevAuditReport(resolve(args.puzzleReviewFrom)) : undefined;
const sourceOutputPath = args.puzzleReviewFrom ? resolve(args.puzzleReviewFrom) : undefined;
if (sourceOutputPath === target) throw new Error("--puzzle-review-from and --out must identify different report files");
let configuration: JevRunConfiguration;
if (sourceReport) {
  const { resolvedModel: _resolvedModel, ...sourceConfiguration } = sourceReport.configuration;
  configuration = { ...sourceConfiguration, batchSize: args.batchSize, puzzleReview: true };
} else {
  configuration = {
    difficultySamples: args.difficultySamples,
    clueSamples: args.clueSamples,
    batchSize: args.batchSize,
    endpoint: ENDPOINT,
    requestedModel: MODEL,
    semanticAssessmentSchemaVersion: SEMANTIC_ASSESSMENT_SCHEMA_VERSION,
    puzzleReview: args.puzzleReview,
    reviewThresholds: JEV_REVIEW_THRESHOLDS,
  };
}

console.error(`JEV audit output: ${target}`);
if (sourceReport) console.error(`Reusing puzzle samples from: ${sourceOutputPath}`);
else console.error(`Starting deterministic audits: ${configuration.difficultySamples} samples/template, ${configuration.clueSamples} wording samples/template.`);

let checkpoint: AuditCheckpoint | undefined;
if (args.resume) {
  checkpoint = await readAuditCheckpoint(checkpointPath);
  if (!checkpoint) throw new Error(`cannot resume: no checkpoint found at ${checkpointPath}`);
  assertCheckpointConfiguration(checkpoint.configuration, configuration);
  checkpoint.clues = checkpoint.clues.map(clue => clue.evaluationStatus === "unavailable" ? { ...clue, evaluationStatus: "pending", missingAnswers: [] } : clue);
  checkpoint.puzzles = checkpoint.puzzles.map(puzzle => puzzle.evaluationStatus === "unavailable" ? { ...puzzle, evaluationStatus: "pending", missingAnswers: [] } : puzzle);
  console.error(`Resuming checkpoint: ${checkpoint.difficultyAudit.length} raw and ${checkpoint.productionDifficultyAudit.length} progressive templates, ${checkpoint.targetedDifficultyAudit.reduce((sum, row) => sum + row.levels.length, 0)} targeted levels, ${checkpoint.clues.filter(clue => clue.evaluationStatus !== "pending").length}/${checkpoint.clues.length} clues processed.`);
} else if (sourceReport) {
  checkpoint = {
    version: 3,
    startedAt: sourceReport.startedAt,
    configuration,
    difficultyAudit: sourceReport.difficultyAudit,
    productionDifficultyAudit: sourceReport.productionDifficultyAudit,
    targetedDifficultyAudit: sourceReport.targetedDifficultyAudit,
    clues: sourceReport.clueAudit.clues,
    puzzles: rebuildPuzzleReviewCorpus(sourceReport, Object.fromEntries(templates.map(template => [template.id, template.title]))),
    totalCost: sourceReport.clueAudit.totalCost,
    resolvedModel: sourceReport.configuration.resolvedModel ?? sourceReport.clueAudit.model,
    totalInputTokens: sourceReport.clueAudit.totalInputTokens,
    totalOutputTokens: sourceReport.clueAudit.totalOutputTokens,
  };
  await writeAuditCheckpoint(checkpointPath, checkpoint);
  console.error(`Prepared ${checkpoint.puzzles.length} puzzle reviews from ${checkpoint.clues.length} saved clues.`);
} else {
  checkpoint = {
    version: 3,
    startedAt: invocationStartedAt,
    configuration,
    difficultyAudit: [],
    productionDifficultyAudit: [],
    targetedDifficultyAudit: [],
    clues: [],
    puzzles: [],
    totalCost: 0,
    resolvedModel: "unresolved",
    totalInputTokens: 0,
    totalOutputTokens: 0,
  };
  await writeAuditCheckpoint(checkpointPath, checkpoint);
}

if (!sourceReport) {
  for (const template of templates) {
    if (checkpoint.difficultyAudit.some(row => row.templateId === template.id)) continue;
    checkpoint.difficultyAudit.push(auditDifficultyCorpus(template, { sampleSize: configuration.difficultySamples, onProgress: reportAuditProgress }));
    await writeAuditCheckpoint(checkpointPath, checkpoint);
    console.error(`checkpoint saved after raw difficulty template ${template.id}`);
  }
  for (const template of templates) {
    if (checkpoint.productionDifficultyAudit.some(row => row.templateId === template.id)) continue;
    checkpoint.productionDifficultyAudit.push(auditProductionDifficultyCorpus(template, { sampleSize: configuration.difficultySamples, onProgress: reportAuditProgress }));
    await writeAuditCheckpoint(checkpointPath, checkpoint);
    console.error(`checkpoint saved after progressive difficulty template ${template.id}`);
  }
  for (const template of targetedTemplates) {
    const priorLevels = new Set(checkpoint.targetedDifficultyAudit.find(row => row.templateId === template.id)?.levels.map(row => row.requestedDifficultyLevel) ?? []);
    await checkpointTargetedDifficultyLevels(checkpoint, checkpointPath, template, reportAuditProgress);
    const completedLevels = checkpoint.targetedDifficultyAudit.find(row => row.templateId === template.id)?.levels ?? [];
    for (const result of completedLevels) {
      if (!priorLevels.has(result.requestedDifficultyLevel)) console.error(`checkpoint saved after targeted ${template.id} level ${result.requestedDifficultyLevel}`);
    }
  }
  for (const template of templates) {
    if (checkpoint.clues.some(clue => clue.templateId === template.id)) continue;
    const clues: AuditedClue[] = [];
    const puzzles: AuditedPuzzle[] = [];
    const reportInterval = Math.max(1, Math.ceil(configuration.clueSamples / 10));
    for (let sample = 0; sample < configuration.clueSamples; sample += 1) {
      const seed = `jev-wording-${sample}`;
      const puzzle = generatePuzzle(template, seed);
      clues.push(...puzzle.clues.map(clue => initialClue(clue, template.id, seed, puzzle.difficulty, template.metadata?.locales.default)));
      puzzles.push(initialPuzzle(puzzle, template.title));
      if ((sample + 1) % reportInterval === 0 || sample + 1 === configuration.clueSamples) {
        console.error(`generated wording clues ${template.id}: ${sample + 1}/${configuration.clueSamples}`);
      }
    }
    checkpoint.clues.push(...clues);
    checkpoint.puzzles.push(...puzzles);
    await writeAuditCheckpoint(checkpointPath, checkpoint);
  }
} else if (checkpoint.productionDifficultyAudit.length < templates.length) {
  for (const template of templates) {
    if (checkpoint.productionDifficultyAudit.some(row => row.templateId === template.id)) continue;
    checkpoint.productionDifficultyAudit.push(auditProductionDifficultyCorpus(template, { sampleSize: configuration.difficultySamples, onProgress: reportAuditProgress }));
    await writeAuditCheckpoint(checkpointPath, checkpoint);
    console.error(`checkpoint saved after progressive difficulty template ${template.id}`);
  }
}

if (checkpoint) {
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
  const resumePuzzleFlag = configuration.puzzleReview ? " --puzzle-review" : "";
  console.error(`JEV provider unavailable: ${error instanceof Error ? error.message : String(error)}. Semantic results are marked unavailable; checkpoint kept at ${checkpointPath}. Resume with --out ${outputBase} --difficulty-samples ${configuration.difficultySamples} --clue-samples ${configuration.clueSamples} --batch-size ${configuration.batchSize}${resumePuzzleFlag} --resume.`);
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
  productionDifficultyAudit: checkpoint.productionDifficultyAudit,
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
