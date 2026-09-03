import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { generatePuzzle, generatePuzzleAtDifficulty } from "../generation/generator.js";
import type { PuzzleTemplate } from "../domain/types.js";
import { scenarioSummary } from "../catalogue.js";

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value };
}

export function createYokaibaMcpHandler(templates: readonly PuzzleTemplate[]) {
  const byId = new Map(templates.map(template => [template.id, template]));
  return createMcpHandler(() => {
    const server = new McpServer({ name: "yokaiba", version: "0.1.0" });
    server.registerTool("list_scenarios", {
      description: "List curated judo logic-puzzle scenarios.", inputSchema: {},
    }, async () => textResult({ scenarios: templates.map(scenarioSummary) }));
    server.registerTool("generate_puzzle", {
      description: "Generate a deterministic, uniquely solvable judo logic-grid puzzle.",
      inputSchema: { templateId: z.string().min(1), seed: z.string().min(1), difficultyLevel: z.number().int().min(1).max(12).optional() },
    }, async ({ templateId, seed, difficultyLevel }) => {
      const template = byId.get(templateId);
      if (!template) return { content: [{ type: "text" as const, text: `Unknown templateId: ${templateId}` }], isError: true };
      const { solution: _solution, generationStrategy: _strategy, ...puzzle } = difficultyLevel === undefined
        ? generatePuzzle(template, seed)
        : generatePuzzleAtDifficulty(template, seed, difficultyLevel as import("../domain/types.js").DifficultyLevel);
      return textResult(puzzle);
    });
    return server;
  }, { legacy: "stateless" });
}
