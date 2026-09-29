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
  assertCheckpointConfiguration,
  buildAuditMarkdown,
  parseAuditArguments,
  readJevAnswerMap,
  readAuditCheckpoint,
  writeAuditCheckpoint,
  type AuditCheckpoint,
  type AuditedClue,
  type JevAuditReport,
  type JevRunConfiguration,
} from "./audit-jev-support.js";

const ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
const MODEL = "~typesafe/jev-latest";
const templates = [tournamentOrderTemplate, tournamentOrderV2Template, openDivisionTemplate, championshipBridgeTemplate, championshipCircuitTemplate];
const targetedTemplates = [tournamentOrderV2Template, openDivisionTemplate, championshipBridgeTemplate, championshipCircuitTemplate];

function describeConstraint(clue: Clue): string {
  const constraint = clue.constraint;
  if (constraint.kind === "matches") return `${constraint.subject} is associated with ${constraint.value} in ${constraint.category}.`;
  if (constraint.kind === "notMatches") return `${constraint.subject} is not associated with ${constraint.value} in ${constraint.category}.`;
  if (constraint.kind === "sameRow") return `${constraint.left.value} in ${constraint.left.category} belongs to the same competitor as ${constraint.right.value} in ${constraint.right.category}.`;
  if (constraint.kind === "before") return `${constraint.left.value} in ${constraint.left.category} is earlier than ${constraint.right.value} in ${constraint.right.category}.`;
  if (constraint.kind === "adjacent") return `${constraint.left.value} in ${constraint.left.category} is immediately next to ${constraint.right.value} in ${constraint.right.category}.`;
  return `The positions of ${constraint.left.value} in ${constraint.left.category} and ${constraint.right.value} in ${constraint.right.category} differ by exactly ${constraint.distance}.`;
}

async function decisionBatch(apiKey: string, clues: readonly AuditedClue[]) {
  const state = { clues: clues.map(({ clueId, text, expectedSemantics }) => ({ clueId, text, expectedSemantics })) };
  const questions: Record<string, unknown> = {};
  for (const [index] of clues.entries()) {
    const path = `clues[${index}]`;
    questions[`${index}_faithful`] = {
      type: "noul",
      instructions: `Does \`${path}.text\` accurately and completely express \`${path}.expectedSemantics\`? Treat a reversed ordering, missing exactness, changed negation, or changed relationship as inaccurate.`,
      criteria: { true: "The wording preserves every semantic constraint.", false: "The wording changes, omits, or contradicts a semantic constraint." },
    };
    questions[`${index}_ambiguous`] = {
      type: "noul",
      instructions: `Could a typical English-speaking logic-puzzle player reasonably interpret \`${path}.text\` in more than one way that changes its constraint?`,
      criteria: { true: "Materially ambiguous to a player.", false: "Has one clear constraint interpretation." },
    };
    questions[`${index}_readability`] = {
      type: "score",
      instructions: `How readable and natural is \`${path}.text\` for a judo logic-puzzle player? Judge wording only, not puzzle difficulty.`,
      criteria: ["Awkward or unclear", "Understandable but awkward", "Clear and natural"],
    };
  }
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: MODEL, state, questions }),
  });
  if (!response.ok) throw new Error(`JEV request failed (${response.status}): ${await response.text()}`);
  const rawBody = await response.json() as unknown;
  const body = rawBody !== null && typeof rawBody === "object" && !Array.isArray(rawBody)
    ? rawBody as { model?: string; answers?: unknown; usage?: { input_tokens?: number; output_tokens?: number; cost?: number } }
    : {};
  return { ...body, answers: readJevAnswerMap(body.answers) };
}

function reportAuditProgress(progress: { phase: "difficulty" | "targeted"; templateId: string; requestedDifficultyLevel?: number; completed: number; total: number }) {
  const interval = Math.max(1, Math.ceil(progress.total / 10));
  if (progress.completed !== 1 && progress.completed !== progress.total && progress.completed % interval !== 0) return;
  const scope = progress.requestedDifficultyLevel === undefined ? progress.templateId : `${progress.templateId} level ${progress.requestedDifficultyLevel}`;
  console.error(`${progress.phase} audit ${scope}: ${progress.completed}/${progress.total}`);
}

function initialClue(clue: Clue, templateId: string, seed: string): AuditedClue {
  return {
    templateId,
    seed,
    clueId: clue.id,
    text: clue.text,
    expectedSemantics: describeConstraint(clue),
    phraseVariant: clue.phraseVariant,
    languageVersion: clue.languageVersion,
    evaluationStatus: "pending",
    missingAnswers: [],
    flagged: false,
    flagReasons: [],
  };
}

const args = parseAuditArguments(process.argv.slice(2));
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("OPENROUTER_API_KEY must be set; the key is intentionally not read from project files.");

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
};

console.error(`JEV audit output: ${target}`);
console.error(`Starting deterministic audits: ${args.difficultySamples} difficulty samples/template, ${args.clueSamples} wording samples/template.`);

let checkpoint: AuditCheckpoint | undefined;
if (args.resume) {
  checkpoint = await readAuditCheckpoint(checkpointPath);
  if (!checkpoint) throw new Error(`cannot resume: no checkpoint found at ${checkpointPath}`);
  assertCheckpointConfiguration(checkpoint.configuration, configuration);
  console.error(`Resuming checkpoint: ${checkpoint.clues.filter(clue => clue.evaluatedAt).length}/${checkpoint.clues.length} clues already processed.`);
}

if (!checkpoint) {
  const difficultyAudit = templates.map(template => ({
    ...auditDifficultyCorpus(template, { sampleSize: args.difficultySamples, onProgress: reportAuditProgress }),
  }));
  const targetedDifficultyAudit = targetedTemplates.map(template => ({
    ...auditTargetedDifficultyCorpus(template, { sampleSize: args.difficultySamples, onProgress: reportAuditProgress }),
  }));
  const clues: AuditedClue[] = [];
  for (const template of templates) {
    const reportInterval = Math.max(1, Math.ceil(args.clueSamples / 10));
    for (let sample = 0; sample < args.clueSamples; sample += 1) {
      const seed = `jev-wording-${sample}`;
      clues.push(...generatePuzzle(template, seed).clues.map(clue => initialClue(clue, template.id, seed)));
      if ((sample + 1) % reportInterval === 0 || sample + 1 === args.clueSamples) {
        console.error(`generated wording clues ${template.id}: ${sample + 1}/${args.clueSamples}`);
      }
    }
  }
  checkpoint = {
    version: 1,
    startedAt: invocationStartedAt,
    configuration,
    difficultyAudit,
    targetedDifficultyAudit,
    clues,
    totalCost: 0,
    resolvedModel: MODEL,
  };
  await writeAuditCheckpoint(checkpointPath, checkpoint);
}

const totalBatches = Math.ceil(checkpoint.clues.length / configuration.batchSize);
const processedBeforeRun = checkpoint.clues.filter(clue => clue.evaluatedAt).length;
console.error(`JEV wording audit: ${processedBeforeRun}/${checkpoint.clues.length} clues processed; ${totalBatches} total batches.`);
try {
  for (let offset = 0; offset < checkpoint.clues.length; offset += configuration.batchSize) {
    const batch = checkpoint.clues.slice(offset, offset + configuration.batchSize);
    const pending = batch.filter(clue => !clue.evaluatedAt);
    if (pending.length === 0) continue;
    const response = await decisionBatch(apiKey, pending);
    checkpoint.resolvedModel = response.model ?? checkpoint.resolvedModel;
    checkpoint.totalCost += response.usage?.cost ?? 0;
    for (const [index, clue] of pending.entries()) {
      checkpoint.clues[offset + batch.indexOf(clue)] = applyJevAnswers(clue, response.answers!, index);
    }
    await writeAuditCheckpoint(checkpointPath, checkpoint);
    const reviewed = checkpoint.clues.filter(clue => clue.evaluatedAt).length;
    console.error(`JEV reviewed ${reviewed}/${checkpoint.clues.length} clues; batch ${Math.ceil((offset + 1) / configuration.batchSize)}/${totalBatches}`);
  }
} catch (error) {
  console.error(`Audit stopped. Checkpoint saved at ${checkpointPath}; resume with --out ${outputBase} --resume.`);
  throw error;
}

const flaggedClues = checkpoint.clues.filter(clue => clue.flagged);
const incompleteClues = checkpoint.clues.filter(clue => clue.evaluationStatus === "incomplete");
const report: JevAuditReport = {
  startedAt: checkpoint.startedAt,
  generatedAt: new Date().toISOString(),
  configuration: { ...configuration, resolvedModel: checkpoint.resolvedModel },
  difficultyAudit: checkpoint.difficultyAudit,
  targetedDifficultyAudit: checkpoint.targetedDifficultyAudit,
  clueAudit: {
    model: checkpoint.resolvedModel,
    sampledClues: checkpoint.clues.length,
    totalCost: checkpoint.totalCost,
    flaggedClues,
    incompleteClues,
    clues: checkpoint.clues,
  },
};

await mkdir(dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(markdownTarget, buildAuditMarkdown(report));
await unlink(checkpointPath).catch(error => {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
});
console.log(JSON.stringify({
  json: target,
  markdown: markdownTarget,
  reviewedClues: checkpoint.clues.length,
  flaggedClues: flaggedClues.length,
  incompleteEvaluations: incompleteClues.length,
  cost: checkpoint.totalCost,
}, null, 2));
