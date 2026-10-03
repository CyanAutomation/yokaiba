import assert from "node:assert/strict";
import test from "node:test";
import { generatePuzzle } from "../src/generation/generator.js";
import { createYokaibaMcpHandler } from "../src/mcp/server.js";
import { tournamentOrderV2Template } from "../src/templates/tournament-order-v2.js";
import { createRestRouter } from "../src/api/router.js";

async function rpc(handler: ReturnType<typeof createYokaibaMcpHandler>, id: number, method: string, params: Record<string, unknown> = {}) {
  const response = await handler.fetch(new Request("https://yokaiba.test/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  }));
  assert.equal(response.status, 200);
  const dataLine = (await response.text()).split(/\r?\n/).find(line => line.startsWith("data: "));
  assert.ok(dataLine, "MCP response should contain a JSON-RPC data event");
  return JSON.parse(dataLine.slice(6)) as { result?: Record<string, unknown>; error?: Record<string, unknown> };
}

async function callTool(handler: ReturnType<typeof createYokaibaMcpHandler>, id: number, name: string, args: Record<string, unknown> = {}) {
  const message = await rpc(handler, id, "tools/call", { name, arguments: args });
  assert.ok(message.result, JSON.stringify(message.error));
  return message.result as Record<string, unknown>;
}

function structuredContent(result: Record<string, unknown>): Record<string, any> {
  assert.ok(result.structuredContent && typeof result.structuredContent === "object");
  return result.structuredContent as Record<string, any>;
}

test("MCP advertises build version and structured schemas for each available tool", async () => {
  const handler = createYokaibaMcpHandler([tournamentOrderV2Template], { serviceVersion: "1.2.3" });
  const initialized = await rpc(handler, 1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test-client", version: "1" } });
  assert.equal((initialized.result?.serverInfo as { version: string }).version, "1.2.3");

  const listed = await rpc(handler, 2, "tools/list");
  const tools = listed.result?.tools as Array<Record<string, unknown>>;
  assert.ok(tools.length >= 2);
  assert.ok(tools.every(tool => tool.outputSchema && typeof tool.outputSchema === "object"), "all tools should declare an output schema");
  assert.deepEqual(tools.map(tool => tool.name).sort(), ["generate_puzzle", "list_scenarios"]);
});

test("MCP puzzle generation matches REST, preserves a token, and never exposes the solution", async () => {
  const options = { puzzleTokenSecret: "mcp-token-secret", serviceVersion: "0.5.0" };
  const handler = createYokaibaMcpHandler([tournamentOrderV2Template], options);
  const mcp = structuredContent(await callTool(handler, 1, "generate_puzzle", { templateId: tournamentOrderV2Template.id, seed: "mcp-parity-seed" }));
  const rest = createRestRouter([tournamentOrderV2Template], options);
  const restResponse = await rest(new Request(`https://yokaiba.test/v1/puzzles/generate?templateId=${tournamentOrderV2Template.id}&seed=mcp-parity-seed`));
  assert.equal(restResponse.status, 200);
  const restPuzzle = await restResponse.json();

  assert.equal("solution" in mcp, false);
  assert.equal(typeof mcp.puzzleToken, "string");
  assert.equal(mcp.difficulty.evidence.humanSolve.solved, true);
  assert.deepEqual(mcp, restPuzzle);
});

test("MCP verifies answers and advances placement hints by hintIndex", async () => {
  const handler = createYokaibaMcpHandler([tournamentOrderV2Template], { puzzleTokenSecret: "mcp-token-secret" });
  const generated = structuredContent(await callTool(handler, 1, "generate_puzzle", { templateId: tournamentOrderV2Template.id, seed: "mcp-play-seed" }));
  const solution = generatePuzzle(tournamentOrderV2Template, "mcp-play-seed").solution;
  const checked = structuredContent(await callTool(handler, 2, "verify_puzzle_answer", { puzzleToken: generated.puzzleToken, answer: solution }));
  assert.deepEqual(checked, { correct: true });

  const first = structuredContent(await callTool(handler, 3, "get_puzzle_hint", { puzzleToken: generated.puzzleToken, kind: "placement", hintIndex: 0 }));
  const second = structuredContent(await callTool(handler, 4, "get_puzzle_hint", { puzzleToken: generated.puzzleToken, kind: "placement", hintIndex: 1 }));
  assert.equal(first.placement.subject, "Aki");
  assert.equal(first.placement.category, "weight");
  assert.equal(second.placement.subject, "Aki");
  assert.equal(second.placement.category, "tatami");
});

test("MCP reports unknown templates as stable tool errors and omits protected tools without token configuration", async () => {
  const handler = createYokaibaMcpHandler([tournamentOrderV2Template]);
  const listed = await rpc(handler, 1, "tools/list");
  const tools = listed.result?.tools as Array<Record<string, unknown>>;
  assert.deepEqual(tools.map(tool => tool.name).sort(), ["generate_puzzle", "list_scenarios"]);

  const result = await callTool(handler, 2, "generate_puzzle", { templateId: "unknown", seed: "seed" });
  assert.equal(result.isError, true);
  assert.deepEqual(structuredContent(result), { error: { code: "not_found", message: "unknown templateId" } });
});
