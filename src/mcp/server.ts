import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { generatePuzzle } from "../generation/generator.js";
import type { PuzzleTemplate } from "../domain/types.js";

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value };
}

export function createYokaibaMcpHandler(templates: readonly PuzzleTemplate[]) {
  const byId = new Map(templates.map(template => [template.id, template]));
  return createMcpHandler(() => {
    const server = new McpServer({ name: "yokaiba", version: "0.1.0" });
    server.registerTool("list_scenarios", {
      description: "List curated judo logic-puzzle scenarios.", inputSchema: {},
    }, async () => textResult({ scenarios: templates.map(({ id, title, metadata }) => ({ id, title, ...(metadata ? { metadata } : {}) })) }));
    server.registerTool("generate_puzzle", {
      description: "Generate a deterministic, uniquely solvable judo logic-grid puzzle.",
      inputSchema: { templateId: z.string().min(1), seed: z.string().min(1) },
    }, async ({ templateId, seed }) => {
      const template = byId.get(templateId);
      if (!template) return { content: [{ type: "text" as const, text: `Unknown templateId: ${templateId}` }], isError: true };
      const { solution: _solution, ...puzzle } = generatePuzzle(template, seed);
      return textResult(puzzle);
    });
    return server;
  }, { legacy: "stateless" });
}
