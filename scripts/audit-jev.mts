import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  auditDifficultyCorpus,
  auditTargetedDifficultyCorpus,
  generatePuzzle,
  type Clue,
  type PuzzleTemplate,
} from "../src/index.js";
import { championshipBridgeTemplate } from "../src/templates/championship-bridge.js";
import { championshipCircuitTemplate } from "../src/templates/championship-circuit.js";
import { openDivisionTemplate } from "../src/templates/open-division.js";
import { tournamentOrderTemplate } from "../src/templates/tournament-order.js";
import { tournamentOrderV2Template } from "../src/templates/tournament-order-v2.js";

const ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
const MODEL = "~typesafe/jev-latest";
const templates = [tournamentOrderTemplate, tournamentOrderV2Template, openDivisionTemplate, championshipBridgeTemplate, championshipCircuitTemplate];
const targetedTemplates = [tournamentOrderV2Template, openDivisionTemplate, championshipBridgeTemplate, championshipCircuitTemplate];

interface JevAnswer {
  noul?: number;
  score?: number;
  confidence?: number;
}

interface AuditedClue {
  templateId: string;
  seed: string;
  clueId: string;
  text: string;
  expectedSemantics: string;
  phraseVariant?: string;
  languageVersion?: string;
  faithful?: number;
  ambiguous?: number;
  readability?: number;
  flagged: boolean;
}

function numberArgument(name: string, fallback: number) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function stringArgument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function describeConstraint(clue: Clue): string {
  const constraint = clue.constraint;
  if (constraint.kind === "matches") return `${constraint.subject} is associated with ${constraint.value} in ${constraint.category}.`;
  if (constraint.kind === "notMatches") return `${constraint.subject} is not associated with ${constraint.value} in ${constraint.category}.`;
  if (constraint.kind === "sameRow") return `${constraint.left.value} in ${constraint.left.category} belongs to the same competitor as ${constraint.right.value} in ${constraint.right.category}.`;
  if (constraint.kind === "before") return `${constraint.left.value} in ${constraint.left.category} is earlier than ${constraint.right.value} in ${constraint.right.category}.`;
  if (constraint.kind === "adjacent") return `${constraint.left.value} in ${constraint.left.category} is immediately next to ${constraint.right.value} in ${constraint.right.category}.`;
  return `${constraint.left.value} in ${constraint.left.category} is exactly ${constraint.distance} position${constraint.distance === 1 ? "" : "s"} away from ${constraint.right.value} in ${constraint.right.category}.`;
}

async function decisionBatch(apiKey: string, clues: readonly AuditedClue[]) {
  const state = {
    clues: clues.map(({ clueId, text, expectedSemantics }) => ({ clueId, text, expectedSemantics })),
  };
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
  const body = await response.json() as { model?: string; answers?: Record<string, JevAnswer>; usage?: { input_tokens?: number; output_tokens?: number; cost?: number } };
  if (!body.answers) throw new Error("JEV response did not contain answers");
  return body;
}

function markdown(report: Record<string, unknown>) {
  const clueAudit = report.clueAudit as { sampledClues: number; flaggedClues: AuditedClue[]; totalCost: number; model: string };
  const difficultyAudit = report.difficultyAudit as Array<{ templateId: string; levelCounts: number[]; humanTrace: { complete: number; incomplete: number } }>;
  const lines = [
    "# Yokaiba JEV audit",
    "",
    `Generated: ${report.generatedAt}`,
    `JEV model requested: ${clueAudit.model}`,
    `Clues reviewed: ${clueAudit.sampledClues}; flags: ${clueAudit.flaggedClues.length}; reported cost: $${clueAudit.totalCost.toFixed(6)}.`,
    "",
    "## Deterministic difficulty audit",
    "",
    "| Template | Level distribution | No-guess trace |",
    "| --- | --- | --- |",
    ...difficultyAudit.map(row => `| ${row.templateId} | ${row.levelCounts.map((count, index) => `${index + 1}: ${count}`).filter(entry => !entry.endsWith(": 0")).join(", ")} | ${row.humanTrace.complete} complete / ${row.humanTrace.incomplete} incomplete |`),
    "",
    "## JEV wording flags",
    "",
  ];
  if (clueAudit.flaggedClues.length === 0) lines.push("No clue crossed the conservative review thresholds.");
  else {
    lines.push("| Template / clue | Text | Faithful | Ambiguous | Readability |", "| --- | --- | ---: | ---: | ---: |");
    for (const clue of clueAudit.flaggedClues) lines.push(`| ${clue.templateId} / ${clue.clueId} | ${clue.text.replaceAll("|", "\\|")} | ${clue.faithful?.toFixed(2) ?? "n/a"} | ${clue.ambiguous?.toFixed(2) ?? "n/a"} | ${clue.readability?.toFixed(2) ?? "n/a"} |`);
  }
  lines.push("", "Flags are review leads, not evidence that a deterministic clue contract is broken. Existing solver and wording tests remain authoritative.", "");
  return lines.join("\n");
}

const sampleSize = numberArgument("--samples", 100);
const batchSize = numberArgument("--batch-size", 20);
const outputBase = stringArgument("--out") ?? `reports/jev-audit-${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}`;
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("OPENROUTER_API_KEY must be set; the key is intentionally not read from project files.");

const difficultyAudit = templates.map(template => ({ templateId: template.id, ...auditDifficultyCorpus(template, { sampleSize }) }));
const targetedDifficultyAudit = targetedTemplates.map(template => ({ templateId: template.id, ...auditTargetedDifficultyCorpus(template, { sampleSize }) }));
const sampledClues: AuditedClue[] = [];
for (const template of templates) {
  for (let sample = 0; sample < sampleSize; sample += 1) {
    const seed = `jev-wording-${sample}`;
    for (const clue of generatePuzzle(template, seed).clues) {
      sampledClues.push({ templateId: template.id, seed, clueId: clue.id, text: clue.text, expectedSemantics: describeConstraint(clue), phraseVariant: clue.phraseVariant, languageVersion: clue.languageVersion, flagged: false });
    }
  }
}

let totalCost = 0;
let resolvedModel = MODEL;
for (let offset = 0; offset < sampledClues.length; offset += batchSize) {
  const batch = sampledClues.slice(offset, offset + batchSize);
  const response = await decisionBatch(apiKey, batch);
  resolvedModel = response.model ?? resolvedModel;
  totalCost += response.usage?.cost ?? 0;
  for (const [index, clue] of batch.entries()) {
    clue.faithful = response.answers![`${index}_faithful`]?.noul;
    clue.ambiguous = response.answers![`${index}_ambiguous`]?.noul;
    clue.readability = response.answers![`${index}_readability`]?.score;
    // These are high-signal review thresholds. JEV's moderate uncertainty is expected
    // for otherwise ordinary wording, so it must not create a noisy release gate.
    clue.flagged = (clue.faithful ?? 0) < 0.5 || (clue.ambiguous ?? 1) > 0.6 || (clue.readability ?? -1) < 1;
  }
  console.error(`JEV reviewed ${Math.min(offset + batch.length, sampledClues.length)}/${sampledClues.length} clues`);
}

const report = {
  generatedAt: new Date().toISOString(),
  configuration: { sampleSize, batchSize, endpoint: ENDPOINT, requestedModel: MODEL, resolvedModel },
  difficultyAudit,
  targetedDifficultyAudit,
  clueAudit: { model: resolvedModel, sampledClues: sampledClues.length, totalCost, flaggedClues: sampledClues.filter(clue => clue.flagged), clues: sampledClues },
};
const target = resolve(`${outputBase}.json`);
await mkdir(dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(target.replace(/\.json$/, ".md"), markdown(report as Record<string, unknown>));
console.log(JSON.stringify({ json: target, markdown: target.replace(/\.json$/, ".md"), reviewedClues: sampledClues.length, flaggedClues: sampledClues.filter(clue => clue.flagged).length, cost: totalCost }, null, 2));
