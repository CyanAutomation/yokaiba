import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  DifficultyUnavailableError,
  generatePuzzle,
  generatePuzzleAtDifficultyV5,
} from "../src/generation/generator.js";
import { DIFFICULTY_MODEL_VERSION } from "../src/generation/difficulty-assessment.js";
import { DIFFICULTY_MODEL_V5 } from "../src/generation/difficulty-profile.js";
import { championshipBridgeTemplate } from "../src/templates/championship-bridge.js";
import { championshipCircuitTemplate } from "../src/templates/championship-circuit.js";
import { openDivisionTemplate } from "../src/templates/open-division.js";
import { tournamentOrderTemplate } from "../src/templates/tournament-order.js";
import { tournamentOrderV2Template } from "../src/templates/tournament-order-v2.js";
import {
  buildDifficultyV5AuditMarkdown,
  clueMetadata,
  parseDifficultyV5AuditArguments,
  summarizeDifficultyV5Template,
  type DifficultyV5AuditSample,
  type DifficultyV5TargetSample,
} from "./audit-difficulty-v5-support.js";

const templates = [
  tournamentOrderTemplate,
  tournamentOrderV2Template,
  openDivisionTemplate,
  championshipBridgeTemplate,
  championshipCircuitTemplate,
];
const args = parseDifficultyV5AuditArguments(process.argv.slice(2));
const generatedAt = new Date().toISOString();
const seedPrefix = "difficulty-v5-audit";
const outputBase = args.outputBase ?? `reports/difficulty-v5-${generatedAt.replaceAll(":", "-").replaceAll(".", "-")}`;
const jsonPath = resolve(`${outputBase}.json`);
const markdownPath = resolve(`${outputBase}.md`);
const pairedSamples: DifficultyV5AuditSample[] = [];
const targetedByTemplate = new Map<string, Map<number, DifficultyV5TargetSample[]>>();

for (const template of templates) {
  for (let index = 0; index < args.samples; index += 1) {
    const seed = `${seedPrefix}-${template.id}-${index}`;
    const started = performance.now();
    const puzzle = generatePuzzle(template, seed, undefined, { difficultyModel: "compare" });
    const elapsedMs = Number((performance.now() - started).toFixed(3));
    const profile = puzzle.difficultyProfile!;
    const steps = profile.logical.trace.steps;
    const depths = steps.map(step => step.dependencyDepth);
    const workingMemory = steps.map(step => step.workingMemoryDemand);
    pairedSamples.push({
      templateId: template.id,
      seed,
      legacy: {
        modelVersion: puzzle.difficulty.modelVersion,
        level: puzzle.difficulty.level,
        score: puzzle.difficulty.evidence.score,
      },
      v5: {
        modelVersion: profile.logical.modelVersion,
        level: profile.logical.level,
        score: profile.logical.score,
        status: profile.logical.status,
        stepCount: steps.length,
        maximumDependencyDepth: profile.logical.trace.maximumDependencyDepth,
        meanDependencyDepth: depths.length ? Number((depths.reduce((sum, depth) => sum + depth, 0) / depths.length).toFixed(3)) : 0,
        crossCategorySteps: profile.logical.trace.crossCategorySteps,
        workingMemoryMean: workingMemory.length ? Number((workingMemory.reduce((sum, count) => sum + count, 0) / workingMemory.length).toFixed(3)) : 0,
        elapsedMs,
      },
      clueMetadata: clueMetadata(puzzle),
    });
  }

  const targetMap = new Map<number, DifficultyV5TargetSample[]>();
  const [firstLevel, lastLevel] = template.metadata?.difficultyCalibration.levelRange ?? [1, 12];
  for (let level = firstLevel; level <= lastLevel; level += 1) {
    const samples: DifficultyV5TargetSample[] = [];
    for (let index = 0; index < args.targetSamples; index += 1) {
      const seed = `${seedPrefix}-target-${template.id}-${level}-${index}`;
      const started = performance.now();
      try {
        const puzzle = generatePuzzleAtDifficultyV5(template, seed, level as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12);
        const elapsedMs = Number((performance.now() - started).toFixed(3));
        samples.push({
          seed,
          status: "selected",
          elapsedMs,
          score: puzzle.difficultyProfile!.logical.score,
          level: puzzle.difficultyProfile!.logical.level,
          traceStatus: puzzle.difficultyProfile!.logical.status,
          candidateAttempts: puzzle.selectionDiagnostics?.strategiesAttempted,
          eligibleCandidates: puzzle.selectionDiagnostics?.eligibleCandidates,
          selectedRankDistance: puzzle.selectionDiagnostics?.selectedRankDistance,
          candidateScoreRange: puzzle.selectionDiagnostics?.candidateScoreRange,
          clueMetadata: clueMetadata(puzzle),
        });
      } catch (error) {
        const elapsedMs = Number((performance.now() - started).toFixed(3));
        if (!(error instanceof DifficultyUnavailableError)) throw error;
        samples.push({
          seed,
          status: "unavailable",
          elapsedMs,
          candidateAttempts: error.diagnostics?.strategiesAttempted,
          eligibleCandidates: error.diagnostics?.eligibleCandidates,
          candidateScoreRange: error.diagnostics?.candidateScoreRange,
          observedLevels: [...error.availableDifficultyLevels],
          error: error.message,
        });
      }
    }
    targetMap.set(level, samples);
  }
  targetedByTemplate.set(template.id, targetMap);
}

const summaries = templates.map(template => summarizeDifficultyV5Template(
  template,
  pairedSamples,
  targetedByTemplate.get(template.id) ?? new Map(),
));
const report = {
  reportVersion: 1,
  generatedAt,
  configuration: {
    samples: args.samples,
    targetSamples: args.targetSamples,
    seedPrefix,
    legacyModel: DIFFICULTY_MODEL_VERSION,
    v5Model: DIFFICULTY_MODEL_V5,
    v5Bands: (await import("../src/generation/difficulty-profile.js")).DIFFICULTY_BANDS_V5,
    note: "Paired scores use the same v4-generated clue set; targeted selection is measured separately.",
  },
  templates: summaries,
  pairedSamples,
};

await mkdir(dirname(jsonPath), { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(markdownPath, buildDifficultyV5AuditMarkdown({
  generatedAt,
  configuration: { samples: args.samples, targetSamples: args.targetSamples, seedPrefix },
  templates: summaries,
}));
console.log(`Wrote difficulty v5 audit: ${jsonPath}`);
console.log(`Wrote difficulty v5 audit summary: ${markdownPath}`);
