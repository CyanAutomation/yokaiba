import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { scenarioSummary } from "../catalogue.js";
import type { GeneratedPuzzle, PuzzleTemplate } from "../domain/types.js";
import { DifficultyUnavailableError, generatePuzzleForRequest } from "../generation/generator.js";
import { issuePuzzleToken } from "../api/puzzle-token.js";
import { puzzleFromToken, puzzleHint, PuzzleActionError, verifyPuzzleAnswer } from "../api/puzzle-actions.js";

export interface YokaibaMcpOptions {
  puzzleTokenSecret?: string;
  serviceVersion?: string;
}

const ErrorOutputSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
  templateId: z.string().optional(),
  requestedDifficultyLevel: z.number().int().min(1).max(12).optional(),
  availableDifficultyLevels: z.array(z.number().int().min(1).max(12)).optional(),
});

const CategoryOutputSchema = z.object({
  id: z.string(),
  label: z.string(),
  values: z.array(z.string()),
  ordered: z.boolean().optional(),
});

const ScenarioOutputSchema = z.object({
  id: z.string(),
  title: z.string(),
  baseCategory: z.string(),
  categories: z.array(CategoryOutputSchema),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const ListScenariosOutputSchema = z.object({ scenarios: z.array(ScenarioOutputSchema) });

const PuzzleOutputSchema = z.object({
  id: z.string(),
  requestedSeed: z.string(),
  seed: z.string(),
  requestedDifficultyLevel: z.number().int().min(1).max(12).optional(),
  seedFallbackAttempt: z.number().int().min(1).optional(),
  generationStrategy: z.number().int().min(0).optional(),
  templateId: z.string(),
  generatorVersion: z.string(),
  solverVersion: z.string(),
  puzzleToken: z.string().optional(),
  spec: z.object({
    id: z.string(),
    title: z.string(),
    baseCategory: z.string(),
    categories: z.array(CategoryOutputSchema),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  clues: z.array(z.object({
    id: z.string(),
    constraint: z.record(z.string(), z.unknown()),
    text: z.string(),
    phraseVariant: z.string().optional(),
    languageVersion: z.string().optional(),
  })),
  difficulty: z.object({
    level: z.number().int().min(1).max(12),
    label: z.string(),
    modelVersion: z.string(),
    evidence: z.record(z.string(), z.unknown()),
  }),
});

const GeneratePuzzleOutputSchema = z.union([PuzzleOutputSchema, ErrorOutputSchema]);
const VerifyAnswerOutputSchema = z.union([z.object({ correct: z.boolean() }), ErrorOutputSchema]);
const HintOutputSchema = z.union([
  z.object({ kind: z.enum(["clue", "elimination"]), clue: z.object({ id: z.string(), text: z.string() }) }),
  z.object({ kind: z.literal("placement"), placement: z.object({ subject: z.string(), category: z.string(), value: z.string() }) }),
  ErrorOutputSchema,
]);

function textResult(value: unknown, isError = false) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value, ...(isError ? { isError: true } : {}) };
}

function errorResult(code: string, message: string, extra: Record<string, unknown> = {}) {
  return textResult({ error: { code, message }, ...extra }, true);
}

function puzzleOutput(puzzle: GeneratedPuzzle, puzzleToken?: string) {
  const { solution: _solution, ...publicPuzzle } = puzzle;
  return { ...publicPuzzle, ...(puzzleToken ? { puzzleToken } : {}) };
}

function actionError(error: unknown) {
  return error instanceof PuzzleActionError
    ? { code: error.code, message: error.message }
    : { code: "bad_request", message: error instanceof Error ? error.message : "invalid request" };
}

export function createYokaibaMcpHandler(templates: readonly PuzzleTemplate[], options: YokaibaMcpOptions = {}) {
  const byId = new Map(templates.map(template => [template.id, template]));
  return createMcpHandler(() => {
    const server = new McpServer({ name: "yokaiba", version: options.serviceVersion ?? "0.1.0" });
    server.registerTool("list_scenarios", {
      description: "List curated judo logic-puzzle scenarios. Use a returned scenario id with generate_puzzle.",
      inputSchema: {},
      outputSchema: ListScenariosOutputSchema,
    }, async () => textResult({ scenarios: templates.map(scenarioSummary) }));

    server.registerTool("generate_puzzle", {
      description: "Generate a deterministic, uniquely solvable judo logic-grid puzzle. The solution is never returned. If seed is omitted, one is generated and returned for replay.",
      inputSchema: {
        templateId: z.string().min(1).max(128),
        seed: z.string().min(1).max(128).optional(),
        difficultyLevel: z.number().int().min(1).max(12).optional(),
        allowSeedFallback: z.boolean().optional(),
      },
      outputSchema: GeneratePuzzleOutputSchema,
    }, async ({ templateId, seed, difficultyLevel, allowSeedFallback }) => {
      const template = byId.get(templateId);
      if (!template) return errorResult("not_found", "unknown templateId");
      const requestedSeed = seed ?? crypto.randomUUID();
      try {
        const puzzle = generatePuzzleForRequest(template, requestedSeed, difficultyLevel as GeneratedPuzzle["requestedDifficultyLevel"], allowSeedFallback ?? false);
        const puzzleToken = options.puzzleTokenSecret ? await issuePuzzleToken(puzzle, options.puzzleTokenSecret) : undefined;
        return textResult(puzzleOutput(puzzle, puzzleToken));
      } catch (error) {
        if (error instanceof DifficultyUnavailableError) {
          return errorResult("difficulty_unavailable", error.message, {
            templateId: error.templateId,
            requestedDifficultyLevel: error.requestedDifficultyLevel,
            availableDifficultyLevels: error.availableDifficultyLevels,
          });
        }
        return errorResult("generation_failed", "puzzle generation failed");
      }
    });

    if (options.puzzleTokenSecret) {
      server.registerTool("verify_puzzle_answer", {
        description: "Check a complete puzzle answer using its puzzleToken. Returns only whether the whole answer is correct.",
        inputSchema: {
          puzzleToken: z.string().min(1).max(16_384),
          answer: z.object({ assignments: z.record(z.string(), z.array(z.string())) }),
        },
        outputSchema: VerifyAnswerOutputSchema,
      }, async ({ puzzleToken, answer }) => {
        try {
          const puzzle = await puzzleFromToken(puzzleToken, byId, options.puzzleTokenSecret!);
          return textResult({ correct: verifyPuzzleAnswer(puzzle, answer) });
        } catch (error) {
          const failure = actionError(error);
          return errorResult(failure.code, failure.message);
        }
      });

      server.registerTool("get_puzzle_hint", {
        description: "Return one bounded puzzle hint. Increase hintIndex to advance deterministically through clues or placements; indices wrap when a hint pool is exhausted.",
        inputSchema: {
          puzzleToken: z.string().min(1).max(16_384),
          kind: z.enum(["clue", "elimination", "placement"]).optional(),
          hintIndex: z.number().int().min(0).max(100).optional(),
        },
        outputSchema: HintOutputSchema,
      }, async ({ puzzleToken, kind, hintIndex }) => {
        try {
          const puzzle = await puzzleFromToken(puzzleToken, byId, options.puzzleTokenSecret!);
          return textResult(puzzleHint(puzzle, kind, hintIndex));
        } catch (error) {
          const failure = actionError(error);
          return errorResult(failure.code, failure.message);
        }
      });
    }

    return server;
  }, { legacy: "stateless" });
}
