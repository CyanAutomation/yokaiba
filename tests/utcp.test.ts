import assert from "node:assert/strict";
import test from "node:test";
import { createUtcpManual } from "../src/utcp/manual.js";
import { createCachedPublicWorker, createWorker } from "../worker/index.js";

const BASE_URL = "https://yokaiba.example";

test("UTCP manual advertises the REST-backed tools and current feature set", () => {
  const manual = createUtcpManual({ publicApiBaseUrl: BASE_URL, serviceVersion: "1.2.3", puzzleActionsAvailable: true });

  assert.equal(manual.manual_version, "1.0.0");
  assert.equal(manual.utcp_version, "1.0.1");
  assert.deepEqual(manual.info, {
    title: "Yokaiba API",
    version: "1.2.3",
    description: "Discover and use Yokaiba's REST puzzle tools directly over HTTP.",
  });
  assert.deepEqual(manual.tools.map(tool => tool.name).sort(), [
    "generate_puzzle",
    "get_puzzle_hint",
    "list_scenarios",
    "verify_puzzle_answer",
  ]);

  const calls = Object.fromEntries(manual.tools.map(tool => [tool.name, tool.tool_call_template]));
  assert.deepEqual(calls.list_scenarios, {
    call_template_type: "http",
    url: `${BASE_URL}/v1/scenarios`,
    http_method: "GET",
  });
  assert.deepEqual(calls.generate_puzzle, {
    call_template_type: "http",
    url: `${BASE_URL}/v1/puzzles/generate`,
    http_method: "POST",
    content_type: "application/json",
    body_field: "body",
  });
  assert.deepEqual(calls.verify_puzzle_answer, {
    call_template_type: "http",
    url: `${BASE_URL}/v1/puzzles/verify`,
    http_method: "POST",
    content_type: "application/json",
    body_field: "body",
  });
  assert.deepEqual(calls.get_puzzle_hint, {
    call_template_type: "http",
    url: `${BASE_URL}/v1/puzzles/hint`,
    http_method: "POST",
    content_type: "application/json",
    body_field: "body",
  });

  const generation = manual.tools.find(tool => tool.name === "generate_puzzle");
  const generationInputs = generation?.inputs as { properties?: { body?: { properties?: Record<string, unknown> } } } | undefined;
  assert.deepEqual(Object.keys(generationInputs?.properties?.body?.properties ?? {}).sort(), [
    "allowSeedFallback", "difficultyLevel", "difficultyModel", "seed", "templateId",
  ]);
  assert.ok(manual.tools.every(tool => tool.inputs && tool.outputs));
  assert.equal(JSON.stringify(manual).includes('"solution"'), false, "the manual must not advertise a hidden solution field");
});

test("UTCP manual omits token actions without a puzzle token secret", () => {
  const manual = createUtcpManual({ publicApiBaseUrl: BASE_URL, serviceVersion: "1.2.3", puzzleActionsAvailable: false });

  assert.deepEqual(manual.tools.map(tool => tool.name).sort(), ["generate_puzzle", "list_scenarios"]);
});

test("UTCP POST tool arguments send the nested body directly to the existing REST route", async () => {
  const worker = createWorker();
  const manual = createUtcpManual({ publicApiBaseUrl: BASE_URL, serviceVersion: "1.2.3", puzzleActionsAvailable: true });
  const tool = manual.tools.find(candidate => candidate.name === "generate_puzzle");
  assert.ok(tool);
  assert.equal(tool.tool_call_template.body_field, "body");

  const args = {
    body: {
      templateId: "tournament-order-v2",
      seed: "utcp-http-body-test",
    },
  };
  const template = tool.tool_call_template;
  const response = await worker.fetch(new Request(template.url, {
    method: template.http_method,
    headers: { "content-type": template.content_type ?? "application/json" },
    body: JSON.stringify(args[template.body_field ?? "body"]),
  }), { PUZZLE_TOKEN_SECRET: "utcp-test-token-secret" }, {} as ExecutionContext);

  assert.equal(response.status, 200);
  const puzzle = await response.json() as { seed: string; puzzleToken?: string; solution?: unknown };
  assert.equal(puzzle.seed, "utcp-http-body-test");
  assert.equal(typeof puzzle.puzzleToken, "string");
  assert.equal("solution" in puzzle, false);
});

test("UTCP manual accepts HTTPS origins and local loopback HTTP but rejects unsafe bases", () => {
  const localManual = createUtcpManual({ publicApiBaseUrl: "http://localhost:8787/", serviceVersion: "dev", puzzleActionsAvailable: false });
  assert.equal(new URL(localManual.tools[0]!.tool_call_template.url).origin, "http://localhost:8787");
  for (const url of [
    "http://yokaiba.example",
    "https://user:password@yokaiba.example",
    "https://yokaiba.example/api",
    "https://yokaiba.example/?unsafe=true",
    "https://yokaiba.example/#fragment",
  ]) {
    assert.throws(() => createUtcpManual({ publicApiBaseUrl: url, serviceVersion: "1.0.0", puzzleActionsAvailable: false }));
  }
});

test("Worker serves the UTCP manual as cacheable JSON and returns 404 on the removed tool route", async () => {
  const worker = createWorker();
  const env = { PUBLIC_API_BASE_URL: BASE_URL, BUILD_VERSION: "1.2.3" };
  const get = await worker.fetch(new Request("https://worker.example/utcp"), env, {} as ExecutionContext);

  assert.equal(get.status, 200);
  assert.match(get.headers.get("content-type") ?? "", /^application\/json/);
  assert.match(get.headers.get("cache-control") ?? "", /max-age=300/);
  const manual = await get.json() as ReturnType<typeof createUtcpManual>;
  assert.equal(manual.info.version, "1.2.3");
  assert.ok(manual.tools.every(tool => new URL(tool.tool_call_template.url).origin === BASE_URL));

  const head = await worker.fetch(new Request("https://worker.example/utcp", { method: "HEAD" }), env, {} as ExecutionContext);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");

  const post = await worker.fetch(new Request("https://worker.example/utcp", { method: "POST" }), env, {} as ExecutionContext);
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET, HEAD");

  const retired = await worker.fetch(new Request("https://worker.example/mcp", { method: "POST" }), env, {} as ExecutionContext);
  assert.equal(retired.status, 404);
});

test("UTCP discovery supports allowlisted browser origins and GET preflight only", async () => {
  const worker = createWorker();
  const env = { REST_ALLOWED_ORIGINS: "https://game.example" };
  const response = await worker.fetch(new Request("https://worker.example/utcp", {
    headers: { origin: "https://game.example" },
  }), env, {} as ExecutionContext);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://game.example");
  assert.equal(response.headers.get("access-control-allow-methods"), "GET, HEAD, OPTIONS");

  const allowed = await worker.fetch(new Request("https://worker.example/utcp", {
    method: "OPTIONS",
    headers: {
      origin: "https://game.example",
      "access-control-request-method": "GET",
      "access-control-request-headers": "If-None-Match",
    },
  }), env, {} as ExecutionContext);
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://game.example");

  const rejected = await worker.fetch(new Request("https://worker.example/utcp", {
    method: "OPTIONS",
    headers: {
      origin: "https://game.example",
      "access-control-request-method": "POST",
    },
  }), env, {} as ExecutionContext);
  assert.equal(rejected.status, 403);
});

test("cached public Worker serves the UTCP manual", async () => {
  const cached = createCachedPublicWorker();
  const response = await cached.fetch(
    new Request("https://worker.example/utcp"),
    { PUBLIC_API_BASE_URL: BASE_URL } as never,
    {} as ExecutionContext,
  );

  assert.equal(response.status, 200);
  const manual = await response.json() as ReturnType<typeof createUtcpManual>;
  assert.ok(manual.tools.some(tool => tool.name === "generate_puzzle"));
});
