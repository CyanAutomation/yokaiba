import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { PuzzleTemplate } from "../src/domain/types.js";
import { championshipCircuitTemplate } from "../src/templates/championship-circuit.js";
import { openDivisionTemplate } from "../src/templates/open-division.js";
import { tournamentOrderTemplate } from "../src/templates/tournament-order.js";
import { createRestRouter } from "../src/api/router.js";
import { generatePuzzle } from "../src/generation/generator.js";
import { issuePuzzleToken } from "../src/api/puzzle-token.js";

type OpenApiObject = Record<string, any>;

function parseOpenApiYaml(source: string): OpenApiObject {
  // Swagger UI is the project's OpenAPI implementation and bundles the same
  // YAML parser it uses when loading the public contract in the browser.
  const require = createRequire(import.meta.url);
  const originalSelf = Object.getOwnPropertyDescriptor(globalThis, "self");
  let SwaggerUI: OpenApiObject;
  try {
    Object.defineProperty(globalThis, "self", { value: globalThis, configurable: true });
    SwaggerUI = require("swagger-ui-dist/swagger-ui-bundle.js");
  } finally {
    if (originalSelf) Object.defineProperty(globalThis, "self", originalSelf);
    else Reflect.deleteProperty(globalThis, "self");
  }
  const actions = SwaggerUI.plugins.Spec({ getSystem: () => ({}) }).statePlugins.spec.actions;
  let parsed: OpenApiObject | undefined;
  let parseError: unknown;
  actions.parseToJson(source)({
    specActions: { updateJsonSpec: (value: OpenApiObject) => { parsed = value; } },
    specSelectors: { specStr: () => source },
    errActions: {
      clear: () => undefined,
      newSpecErr: (error: unknown) => { parseError = error; },
    },
  });
  assert.ifError(parseError);
  assert.ok(parsed, "Swagger UI must parse the OpenAPI YAML into an object");
  assert.equal(parsed.openapi, "3.1.0", "the parsed document must be OpenAPI 3.1");
  assert.ok(parsed.info?.title && parsed.info?.version, "OpenAPI info is required");
  assert.ok(parsed.paths && parsed.components?.schemas, "OpenAPI paths and component schemas are required");
  return parsed;
}

function resolveLocalRef(document: OpenApiObject, value: OpenApiObject): OpenApiObject {
  assert.equal(typeof value?.$ref, "string", "expected an OpenAPI reference object");
  const reference = value.$ref as string;
  assert.match(reference, /^#\//, "only local OpenAPI references are expected");
  const target = reference.slice(2).split("/").reduce<unknown>((current, token) => {
    assert.ok(current && typeof current === "object" && token in current, `unresolved OpenAPI reference: ${reference}`);
    return (current as OpenApiObject)[token];
  }, document);
  assert.ok(target && typeof target === "object", `invalid OpenAPI reference target: ${reference}`);
  return target as OpenApiObject;
}

function validateOpenApiReferences(document: OpenApiObject, value: unknown = document): void {
  if (!value || typeof value !== "object") return;
  if ("$ref" in value) resolveLocalRef(document, value as OpenApiObject);
  for (const child of Object.values(value)) validateOpenApiReferences(document, child);
}

interface ExpectedOperation {
  statuses: readonly string[];
  headers: readonly string[];
  schema?: string;
  requestSchema?: string;
  successStatus?: string;
}

function assertResponseHeaders(specification: OpenApiObject, path: string, method: string, expected: ExpectedOperation, response: OpenApiObject): void {
  for (const header of expected.headers) {
    const headerDefinition = response.headers?.[header];
    assert.ok(headerDefinition, `${method.toUpperCase()} ${path} must document ${header}`);
    if (typeof headerDefinition === "object" && headerDefinition !== null && "$ref" in headerDefinition) {
      resolveLocalRef(specification, headerDefinition);
    }
  }
}

function assertResponseSchema(specification: OpenApiObject, path: string, method: string, expected: ExpectedOperation, response: OpenApiObject): void {
  if (!expected.schema) return;
  const schema = response?.content?.["application/json"]?.schema;
  assert.ok(schema, `${method.toUpperCase()} ${path} must have application/json schema`);
  assert.equal(schema.$ref, `#/components/schemas/${expected.schema}`);
  resolveLocalRef(specification, schema);
}

function assertRequestSchema(specification: OpenApiObject, path: string, method: string, expected: ExpectedOperation, operation: OpenApiObject): void {
  if (!expected.requestSchema) return;
  const schema = operation.requestBody?.content?.["application/json"]?.schema;
  assert.ok(schema, `${method.toUpperCase()} ${path} must have request body schema`);
  assert.equal(operation.requestBody?.required, true);
  assert.equal(schema.$ref, `#/components/schemas/${expected.requestSchema}`);
  resolveLocalRef(specification, schema);
}

function assertDocumentedOperation(specification: OpenApiObject, path: string, method: string, expected: ExpectedOperation, operation: OpenApiObject): void {
  assert.deepEqual(Object.keys(operation.responses), expected.statuses, `${method.toUpperCase()} ${path} response statuses`);
  const success = operation.responses[expected.successStatus ?? "200"];
  assertResponseHeaders(specification, path, method, expected, success);
  assertResponseSchema(specification, path, method, expected, success);
  assertRequestSchema(specification, path, method, expected, operation);
  for (const response of Object.values(operation.responses) as OpenApiObject[]) {
    if (response.$ref) resolveLocalRef(specification, response);
  }
}

function assertCoreOpenApiSchemas(schemas: OpenApiObject): void {
  for (const name of ["GeneratedPuzzle", "PuzzleVerificationRequest", "Difficulty", "Error", "DifficultyUnavailableError"]) assert.ok(schemas[name]);
  assert.ok(schemas.Clue.properties.phraseVariant);
  assert.ok(schemas.GeneratedPuzzle.properties.generationStrategy);
  assert.ok(schemas.Readiness.properties.mcpPuzzleActionRateLimitProvider);
  assert.ok(schemas.Readiness.properties.generateRateLimitProvider);
  assert.ok(schemas.Readiness.properties.outcomeTelemetryProvider);
  assert.ok(schemas.PuzzleHintRequest.properties.hintIndex);
  assert.ok(schemas.PuzzleHintResult.required.includes("clue"));
  assert.equal(schemas.PuzzleHintResult.properties.placement, undefined, "REST hint output must never include a solution placement");
  assert.deepEqual(schemas.TemplateMetadata.properties.difficultyCalibration.properties.scoreThresholds, {
    type: "array",
    minItems: 1,
    maxItems: 11,
    items: { type: "number" },
  });
}

test("OpenAPI documents every public REST endpoint", async () => {
  const source = await readFile(new URL("../public/openapi/v1.yaml", import.meta.url), "utf8");
  const specification = parseOpenApiYaml(source);
  validateOpenApiReferences(specification);
  const endpoints = {
    "/": {
      get: { statuses: ["302", "405"], headers: ["Location", "Cache-Control", "X-Request-Id"], successStatus: "302" },
      head: { statuses: ["302", "405"], headers: ["Location", "Cache-Control", "X-Request-Id"], successStatus: "302" },
    },
    "/healthz": {
      get: { statuses: ["200", "405"], schema: "Health", headers: ["X-Request-Id"] },
      head: { statuses: ["200", "405"], headers: ["X-Request-Id"] },
    },
    "/readyz": {
      get: { statuses: ["200", "405"], schema: "Readiness", headers: ["X-Request-Id"] },
      head: { statuses: ["200", "405"], headers: ["X-Request-Id"] },
    },
    "/docs": {
      get: { statuses: ["200", "405"], headers: ["X-Request-Id"] },
      head: { statuses: ["200", "405"], headers: ["X-Request-Id"] },
    },
    "/docs/": {
      get: { statuses: ["200", "405"], headers: ["X-Request-Id"] },
      head: { statuses: ["200", "405"], headers: ["X-Request-Id"] },
    },
    "/openapi/v1.yaml": {
      get: { statuses: ["200", "405"], headers: ["X-Request-Id"] },
      head: { statuses: ["200", "405"], headers: ["X-Request-Id"] },
    },
    "/openapi/chatgpt-actions-v1.yaml": {
      get: { statuses: ["200", "405"], headers: ["X-Request-Id"] },
      head: { statuses: ["200", "405"], headers: ["X-Request-Id"] },
    },
    "/v1/scenarios": { get: { statuses: ["200", "304", "405", "429"], schema: "ScenarioList", headers: ["Access-Control-Allow-Origin", "Cache-Control", "ETag", "X-Request-Id"] } },
    "/v1/capabilities": { get: { statuses: ["200", "304", "405", "429"], schema: "Capabilities", headers: ["Access-Control-Allow-Origin", "Cache-Control", "ETag", "X-Request-Id"] } },
    "/v1/version": { get: { statuses: ["200", "304", "405", "429"], schema: "Version", headers: ["Access-Control-Allow-Origin", "Cache-Control", "ETag", "X-Request-Id"] } },
    "/v1/puzzles/generate": {
      get: { statuses: ["200", "304", "400", "404", "405", "422", "429", "500"], schema: "GeneratedPuzzle", headers: ["Access-Control-Allow-Origin", "Cache-Control", "ETag", "X-Request-Id"] },
      post: { statuses: ["200", "400", "404", "405", "422", "429", "500"], schema: "GeneratedPuzzle", requestSchema: "GenerationRequest", headers: ["Access-Control-Allow-Origin", "X-Request-Id"] },
    },
    "/v1/puzzles/verify": { post: { statuses: ["200", "400", "405", "429", "503"], schema: "PuzzleVerificationResult", requestSchema: "PuzzleVerificationRequest", headers: ["Access-Control-Allow-Origin", "X-Request-Id"] } },
    "/v1/puzzles/hint": { post: { statuses: ["200", "400", "405", "429", "503"], schema: "PuzzleHintResult", requestSchema: "PuzzleHintRequest", headers: ["Access-Control-Allow-Origin", "X-Request-Id"] } },
    "/v1/events": { post: { statuses: ["202", "400", "405", "429", "503"], schema: "Accepted", requestSchema: "PuzzleOutcomeEvent", headers: ["Access-Control-Allow-Origin", "X-Request-Id"], successStatus: "202" } },
  } as const;

  assert.deepEqual(Object.keys(specification.paths), Object.keys(endpoints));
  for (const [path, expectedMethods] of Object.entries(endpoints)) {
    const pathItem = specification.paths[path];
    assert.ok(pathItem, `missing OpenAPI path: ${path}`);
    assert.deepEqual(Object.keys(pathItem), Object.keys(expectedMethods), `${path} must expose only its supported methods`);
    for (const [method, expected] of Object.entries(expectedMethods)) {
      assertDocumentedOperation(specification, path, method, expected, pathItem[method]);
    }
  }
  assertCoreOpenApiSchemas(specification.components.schemas);

  const operationIds = (Object.values(specification.paths) as OpenApiObject[]).flatMap((pathItem: OpenApiObject) =>
    Object.values(pathItem).map((operation: OpenApiObject) => operation.operationId));
  assert.ok(operationIds.every(operationId => typeof operationId === "string" && operationId.length > 0), "every REST operation should have an operationId");
  assert.equal(new Set(operationIds).size, operationIds.length, "REST operationIds should be unique");
});

test("the ChatGPT Actions contract is a small, self-contained OpenAPI surface", async () => {
  const source = await readFile(new URL("../public/openapi/chatgpt-actions-v1.yaml", import.meta.url), "utf8");
  const specification = parseOpenApiYaml(source);
  validateOpenApiReferences(specification);
  assert.deepEqual(Object.keys(specification.paths), ["/v1/scenarios", "/v1/puzzles/generate", "/v1/puzzles/verify", "/v1/puzzles/hint"]);
  const generationRequest = resolveLocalRef(specification, specification.paths["/v1/puzzles/generate"].post.requestBody.content["application/json"].schema);
  const hintRequest = resolveLocalRef(specification, specification.paths["/v1/puzzles/hint"].post.requestBody.content["application/json"].schema);
  assert.equal(generationRequest.required.includes("seed"), false);
  assert.equal(hintRequest.properties.kind.enum.includes("placement"), false);
  assert.equal(specification.paths["/v1/events"], undefined, "telemetry ingestion should not be exposed as an assistant action");

  const operationIds = (Object.values(specification.paths) as OpenApiObject[]).flatMap(pathItem =>
    Object.values(pathItem).map((operation: OpenApiObject) => operation.operationId));
  assert.ok(operationIds.every(operationId => typeof operationId === "string" && operationId.length > 0));
  assert.equal(new Set(operationIds).size, operationIds.length, "Action operationIds should be unique");
});

test("REST generation redacts the hidden solution and includes reproducibility metadata", async () => {
  const route = createRestRouter([tournamentOrderTemplate], { puzzleTokenSecret: "test-token-secret" });
  const response = await route(new Request("https://yokaiba.test/v1/puzzles/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ templateId: "tournament-order-v1", seed: "api-seed" }),
  }));

  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.templateId, "tournament-order-v1");
  assert.equal(body.seed, "api-seed");
  assert.equal("solution" in body, false);
  assert.equal(typeof body.puzzleToken, "string");
  const difficulty = body.difficulty as { level: number; label: string; modelVersion: string; evidence: { score: number } };
  assert.ok(Array.from({ length: 12 }, (_value, index) => index + 1).includes(difficulty.level));
  assert.equal(difficulty.modelVersion, "yokaiba-difficulty-v4");
  assert.equal(typeof difficulty.evidence.score, "number");
  assert.ok(Array.isArray(body.clues));
});

test("REST POST generation creates a replayable seed when the caller omits it", async () => {
  const route = createRestRouter([tournamentOrderTemplate]);
  const response = await route(new Request("https://yokaiba.test/v1/puzzles/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ templateId: "tournament-order-v1" }),
  }));

  assert.equal(response.status, 200);
  const puzzle = await response.json() as { requestedSeed: string; seed: string; id: string };
  assert.ok(puzzle.requestedSeed.length > 0);
  assert.equal(puzzle.seed, puzzle.requestedSeed);
  assert.ok(puzzle.id.endsWith(`:${puzzle.seed}`));
});

test("REST masks unexpected generation failures behind a stable server error", async () => {
  const brokenTemplate = Object.defineProperty({ ...tournamentOrderTemplate }, "metadata", {
    get() { throw new Error("internal detail"); },
  }) as PuzzleTemplate;
  const route = createRestRouter([brokenTemplate]);
  const response = await route(new Request("https://yokaiba.test/v1/puzzles/generate?templateId=tournament-order-v1&seed=error-seed"));

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: { code: "generation_failed", message: "puzzle generation failed" } });
});

test("REST returns 405 with Allow for a known path and 404 for an unknown path", async () => {
  const route = createRestRouter([tournamentOrderTemplate]);
  const wrongMethod = await route(new Request("https://yokaiba.test/v1/scenarios", { method: "POST" }));
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "GET");

  const missing = await route(new Request("https://yokaiba.test/v1/missing", { method: "POST" }));
  assert.equal(missing.status, 404);
});

test("REST supports cacheable deterministic GET generation", async () => {
  const route = createRestRouter([tournamentOrderTemplate], { puzzleTokenSecret: "test-token-secret" });
  const response = await route(new Request("https://yokaiba.test/v1/puzzles/generate?templateId=tournament-order-v1&seed=api-seed"));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=300, s-maxage=300, must-revalidate");
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.seed, "api-seed");
  assert.equal("solution" in body, false);
});

test("REST generation rejects undeclared body fields and query parameters", async () => {
  const route = createRestRouter([tournamentOrderTemplate]);
  const body = await route(new Request("https://yokaiba.test/v1/puzzles/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ templateId: "tournament-order-v1", seed: "strict-seed", difficultyLevell: 2 }),
  }));
  assert.equal(body.status, 400);
  assert.match((await body.json() as { error: { message: string } }).error.message, /unknown field.*difficultyLevell/i);

  const query = await route(new Request("https://yokaiba.test/v1/puzzles/generate?templateId=tournament-order-v1&seed=strict-seed&difficultyLevell=2"));
  assert.equal(query.status, 400);
  assert.match((await query.json() as { error: { message: string } }).error.message, /unknown query parameter.*difficultyLevell/i);
});

test("REST scenario catalogue publishes valid boards for every template", async () => {
  const templates = [tournamentOrderTemplate, openDivisionTemplate, championshipCircuitTemplate];
  const route = createRestRouter(templates);
  const response = await route(new Request("https://yokaiba.test/v1/scenarios"));

  assert.equal(response.status, 200);
  const body = await response.json() as {
    scenarios: Array<{
      id: string;
      title: string;
      baseCategory: string;
      categories: Array<{ id: string; values: string[] }>;
      metadata?: PuzzleTemplate["metadata"];
    }>;
  };
  assert.equal(body.scenarios.length, templates.length);

  for (const template of templates) {
    const templateBase = template.categories.find(category => category.id === template.baseCategory);
    assert.ok(templateBase, `${template.id} must declare an existing base category`);

    const scenario = body.scenarios.find(candidate => candidate.id === template.id);
    assert.ok(scenario, `${template.id} must be present in the catalogue`);
    assert.deepEqual(scenario, {
      id: template.id,
      title: template.title,
      baseCategory: template.baseCategory,
      categories: template.categories,
      ...(template.metadata ? { metadata: template.metadata } : {}),
    });
    const categoryIds = scenario.categories.map(category => category.id);
    assert.equal(new Set(categoryIds).size, categoryIds.length, `${scenario.id} category IDs must be unique`);

    const publishedBase = scenario.categories.find(category => category.id === scenario.baseCategory);
    assert.ok(publishedBase, `${scenario.id} must publish its base category`);
    assert.deepEqual(publishedBase.values, templateBase.values);
    assert.ok(scenario.categories.every(category => category.values.length === publishedBase.values.length),
      `${scenario.id} categories must have one value per board row`);
  }
});

test("REST reports unavailable difficulty, reachable alternatives, and keeps the requested seed", async () => {
  for (const template of [tournamentOrderTemplate, openDivisionTemplate]) {
    const route = createRestRouter([template]);
    const [minimumLevel, maximumLevel] = template.metadata!.difficultyCalibration.levelRange;
    for (let level = minimumLevel; level <= maximumLevel; level += 1) {
      const path = `https://yokaiba.test/v1/puzzles/generate?templateId=${template.id}&seed=level-picker&difficultyLevel=${level}`;
      const first = await route(new Request(path));
      const second = await route(new Request(path));
      assert.ok([200, 422].includes(first.status));
      const firstBody = await first.json() as { seed?: string; requestedSeed?: string; templateId?: string; requestedDifficultyLevel?: number; difficulty?: { level: number }; error?: { code: string }; availableDifficultyLevels?: number[] };
      assert.deepEqual(firstBody, await second.json());
      if (first.status === 200) {
        assert.equal(firstBody.seed, "level-picker");
        assert.equal(firstBody.requestedSeed, "level-picker");
        assert.equal(firstBody.difficulty?.level, level);
      } else {
        assert.equal(firstBody.error?.code, "difficulty_unavailable");
        assert.equal(firstBody.templateId, template.id);
        assert.equal(firstBody.requestedDifficultyLevel, level);
        assert.equal(first.headers.get("cache-control"), "public, max-age=300, s-maxage=300, must-revalidate");
        assert.ok(firstBody.availableDifficultyLevels?.every(available => available >= minimumLevel && available <= maximumLevel));
        assert.equal(firstBody.availableDifficultyLevels?.includes(level), false);
      }
    }
  }
});

test("REST capabilities expose client-safe feature flags and catalogue metadata", async () => {
  const route = createRestRouter([tournamentOrderTemplate, openDivisionTemplate]);
  const response = await route(new Request("https://yokaiba.test/v1/capabilities"));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=300, s-maxage=300, must-revalidate");
  assert.deepEqual(await response.json(), {
    apiVersion: "v1",
    features: { answerVerification: false, conditionalGet: true, difficultySelection: true, hints: false, outcomeTelemetry: false, seedFallback: true },
    locales: ["en"],
    scenarios: [
      { id: "tournament-order-v1", difficultyLevels: [1, 2, 3, 4] },
      { id: "open-division-v2", difficultyLevels: [5, 6, 7, 8] },
    ],
  });

  const enabled = createRestRouter([tournamentOrderTemplate], { recordOutcome: () => undefined });
  const enabledCapabilities = await enabled(new Request("https://yokaiba.test/v1/capabilities"));
  assert.equal((await enabledCapabilities.json() as { features: { outcomeTelemetry: boolean } }).features.outcomeTelemetry, true);
});

test("REST can deterministically fall back to a nearby seed for an unavailable selected level", async () => {
  const route = createRestRouter([openDivisionTemplate]);
  const response = await route(new Request("https://yokaiba.test/v1/puzzles/generate?templateId=open-division-v2&seed=course-anchor&difficultyLevel=5&allowSeedFallback=true"));
  assert.equal(response.status, 200);
  const body = await response.json() as { requestedSeed: string; seed: string; seedFallbackAttempt?: number; difficulty: { level: number } };
  assert.equal(body.requestedSeed, "course-anchor");
  assert.equal(body.difficulty.level, 5);
  assert.ok(body.seedFallbackAttempt === undefined || body.seedFallbackAttempt > 0);
  if (body.seedFallbackAttempt) assert.notEqual(body.seed, body.requestedSeed);
});

test("REST provides spoiler-safe clue and elimination hints from a signed puzzle", async () => {
  const route = createRestRouter([tournamentOrderTemplate], { puzzleTokenSecret: "test-token-secret" });
  const generated = await route(new Request("https://yokaiba.test/v1/puzzles/generate?templateId=tournament-order-v1&seed=hint-seed"));
  const { puzzleToken, clues } = await generated.json() as { puzzleToken: string; clues: Array<{ id: string }> };
  const clue = await route(new Request("https://yokaiba.test/v1/puzzles/hint", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ puzzleToken, kind: "clue" }) }));
  assert.equal(clue.status, 200);
  const clueBody = await clue.json() as { kind: string; clue: { id: string } };
  assert.equal(clueBody.kind, "clue");
  assert.equal(clueBody.clue.id, clues[0]!.id);

  const nextClue = await route(new Request("https://yokaiba.test/v1/puzzles/hint", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ puzzleToken, kind: "clue", hintIndex: 1 }) }));
  const nextClueBody = await nextClue.json() as { kind: string; clue: { id: string } };
  assert.equal(nextClueBody.clue.id, clues[1]!.id);

  const unknownField = await route(new Request("https://yokaiba.test/v1/puzzles/hint", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ puzzleToken, kind: "clue", tracking: "ignored" }) }));
  assert.equal(unknownField.status, 400);
});

test("REST rejects placement hints so callers cannot enumerate the hidden solution", async () => {
  const route = createRestRouter([tournamentOrderTemplate], { puzzleTokenSecret: "test-token-secret" });
  const generated = await route(new Request("https://yokaiba.test/v1/puzzles/generate?templateId=tournament-order-v1&seed=no-placement-hint"));
  const { puzzleToken } = await generated.json() as { puzzleToken: string };
  const response = await route(new Request("https://yokaiba.test/v1/puzzles/hint", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ puzzleToken, kind: "placement" }),
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: { code: "bad_request", message: "kind must be clue or elimination" } });
});

test("REST accepts anonymized puzzle outcomes with their smart-marking cohort and rejects malformed telemetry", async () => {
  const acceptedEvents: Record<string, unknown>[] = [];
  const route = createRestRouter([tournamentOrderTemplate], { recordOutcome: event => { acceptedEvents.push(event); } });
  const accepted = await route(new Request("https://yokaiba.test/v1/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "puzzle_completed", templateId: "tournament-order-v1", assessedDifficultyLevel: 2, elapsedMs: 120_000, clueCount: 8, hintsUsed: 1, smartMarkingEnabled: true }) }));
  assert.equal(accepted.status, 202);
  assert.deepEqual(await accepted.json(), { accepted: true });
  assert.equal(acceptedEvents.length, 1);
  assert.equal(acceptedEvents[0]?.schemaVersion, 0);
  assert.equal(acceptedEvents[0]?.event, "puzzle_completed");
  assert.equal("seed" in acceptedEvents[0]!, false);
  const rejected = await route(new Request("https://yokaiba.test/v1/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "identity_captured", templateId: "tournament-order-v1" }) }));
  assert.equal(rejected.status, 400);
  const malformed = await route(new Request("https://yokaiba.test/v1/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "puzzle_completed", templateId: "tournament-order-v1", smartMarkingEnabled: "true" }) }));
  assert.equal(malformed.status, 400);
  const unsupportedVersion = await route(new Request("https://yokaiba.test/v1/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ schemaVersion: 2, event: "puzzle_started", templateId: "tournament-order-v1" }) }));
  assert.equal(unsupportedVersion.status, 400);
  const nullVersion = await route(new Request("https://yokaiba.test/v1/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ schemaVersion: null, event: "puzzle_started", templateId: "tournament-order-v1" }) }));
  assert.equal(nullVersion.status, 400);
  const incompleteVersionOne = await route(new Request("https://yokaiba.test/v1/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ schemaVersion: 1, event: "puzzle_completed", templateId: "tournament-order-v1" }) }));
  assert.equal(incompleteVersionOne.status, 400);
  const completeVersionOne = await route(new Request("https://yokaiba.test/v1/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ schemaVersion: 1, event: "puzzle_completed", templateId: "tournament-order-v1", elapsedMs: 1000, hintsUsed: 2, mistakes: 1 }) }));
  assert.equal(completeVersionOne.status, 202);
  assert.equal(acceptedEvents[1]?.schemaVersion, 1);
});

test("REST reports telemetry as unavailable unless an event sink accepts the outcome", async () => {
  const route = createRestRouter([tournamentOrderTemplate]);
  const response = await route(new Request("https://yokaiba.test/v1/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "puzzle_started", templateId: "tournament-order-v1" }) }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: { code: "not_configured", message: "puzzle outcome storage is not configured" } });
});

test("REST verifies a complete submitted answer without exposing the solution", async () => {
  const route = createRestRouter([tournamentOrderTemplate], { puzzleTokenSecret: "test-token-secret" });
  const generated = await route(new Request("https://yokaiba.test/v1/puzzles/generate?templateId=tournament-order-v1&seed=verify-seed"));
  const publicPuzzle = await generated.json() as { puzzleToken: string };
  const solution = generatePuzzle(tournamentOrderTemplate, "verify-seed").solution;

  const correct = await route(new Request("https://yokaiba.test/v1/puzzles/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ puzzleToken: publicPuzzle.puzzleToken, answer: solution }),
  }));
  assert.equal(correct.status, 200);
  assert.deepEqual(await correct.json(), { correct: true });

  const unknownField = await route(new Request("https://yokaiba.test/v1/puzzles/verify", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ puzzleToken: publicPuzzle.puzzleToken, answer: solution, tracking: "ignored" }),
  }));
  assert.equal(unknownField.status, 400);

  const categoryId = Object.keys(solution.assignments)[0]!;

  const incorrect = await route(new Request("https://yokaiba.test/v1/puzzles/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ puzzleToken: publicPuzzle.puzzleToken, answer: { assignments: { ...solution.assignments, [categoryId]: [...solution.assignments[categoryId]!].reverse() } } }),
  }));
  assert.equal(incorrect.status, 200);
  assert.deepEqual(await incorrect.json(), { correct: false });
});

test("REST accepts a v2 token when verifying this prose-only generator upgrade", async () => {
  const route = createRestRouter([tournamentOrderTemplate], { puzzleTokenSecret: "test-token-secret" });
  const puzzle = generatePuzzle(tournamentOrderTemplate, "v2-token-compatibility");
  const v2Token = await issuePuzzleToken({ ...puzzle, generatorVersion: "yokaiba-generator-v2" }, "test-token-secret");
  const response = await route(new Request("https://yokaiba.test/v1/puzzles/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ puzzleToken: v2Token, answer: puzzle.solution }),
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { correct: true });
});

test("REST verifies tokens signed by a previous key and rejects expired tokens", async () => {
  const puzzle = generatePuzzle(tournamentOrderTemplate, "token-rotation-session");
  const now = Math.floor(Date.now() / 1_000);
  const previousKeyToken = await issuePuzzleToken(puzzle, "previous-signing-key", { now, ttlSeconds: 60 });
  const expiredToken = await issuePuzzleToken(puzzle, "active-signing-key", { now: now - 120, ttlSeconds: 60 });
  const route = createRestRouter([tournamentOrderTemplate], {
    puzzleTokenSecret: "active-signing-key",
    puzzleTokenPreviousSecrets: ["previous-signing-key"],
  });
  const verify = (puzzleToken: string) => route(new Request("https://yokaiba.test/v1/puzzles/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ puzzleToken, answer: puzzle.solution }),
  }));

  const accepted = await verify(previousKeyToken);
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { correct: true });
  const expired = await verify(expiredToken);
  assert.equal(expired.status, 400);
  assert.equal((await expired.json() as { error: { code: string } }).error.code, "invalid_puzzle_token");
});

async function verificationSetup() {
  const route = createRestRouter([tournamentOrderTemplate], { puzzleTokenSecret: "test-token-secret" });
  const generated = await route(new Request("https://yokaiba.test/v1/puzzles/generate?templateId=tournament-order-v1&seed=verify-invalid"));
  const { puzzleToken } = await generated.json() as { puzzleToken: string };
  return { route, puzzleToken };
}

test("REST rejects malformed verification assignments", async () => {
  const { route, puzzleToken } = await verificationSetup();
  const malformed = await route(new Request("https://yokaiba.test/v1/puzzles/verify", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ puzzleToken, answer: { assignments: { club: ["Wolves"] } } }),
  }));

  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), {
    error: { code: "bad_request", message: "answer must include every non-base category exactly once" },
  });
});

test("REST answer verification rejects malformed objects and incomplete permutations", async () => {
  const { route, puzzleToken } = await verificationSetup();
  const solution = generatePuzzle(tournamentOrderTemplate, "verify-invalid").solution;
  const invalidAnswers = [
    null,
    [],
    {},
    { assignments: null },
    { assignments: solution.assignments, tracking: "ignored" },
    { assignments: { club: ["Wolves"], tatami: ["1", "2", "3", "4"], placing: ["1st", "2nd", "3rd", "4th"] } },
    { assignments: { club: ["Wolves", "Wolves", "Tigers", "Lions"], tatami: ["1", "2", "3", "4"], placing: ["1st", "2nd", "3rd", "4th"] } },
    { assignments: { club: ["Wolves", "Lions", "Tigers", 4], tatami: ["1", "2", "3", "4"], placing: ["1st", "2nd", "3rd", "4th"] } },
    { assignments: { club: ["Wolves", "Lions", "Tigers", "Unknown"], tatami: ["1", "2", "3", "4"], placing: ["1st", "2nd", "3rd", "4th"] } },
    { assignments: { judoka: ["Aki", "Ben", "Cora", "Dan"], club: ["Wolves", "Lions", "Tigers", "Falcons"], tatami: ["1", "2", "3", "4"], placing: ["1st", "2nd", "3rd", "4th"] } },
  ];

  for (const answer of invalidAnswers) {
    const response = await route(new Request("https://yokaiba.test/v1/puzzles/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ puzzleToken, answer }),
    }));
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { error: { code: string } }).error.code, "bad_request");
  }
});

test("REST hint endpoint rejects unsupported hint kinds and missing tokens", async () => {
  const { route, puzzleToken } = await verificationSetup();
  const unsupportedKind = await route(new Request("https://yokaiba.test/v1/puzzles/hint", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ puzzleToken, kind: "solution" }),
  }));
  assert.equal(unsupportedKind.status, 400);
  assert.deepEqual(await unsupportedKind.json(), {
    error: { code: "bad_request", message: "kind must be clue or elimination" },
  });

  const missingToken = await route(new Request("https://yokaiba.test/v1/puzzles/hint", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "clue" }),
  }));
  assert.equal(missingToken.status, 400);
});

test("REST rejects a puzzle token with a tampered signature", async () => {
  const { route, puzzleToken } = await verificationSetup();
  const signatureStart = puzzleToken.indexOf(".") + 1;
  const replacement = puzzleToken[signatureStart] === "A" ? "B" : "A";
  const tamperedPuzzleToken = `${puzzleToken.slice(0, signatureStart)}${replacement}${puzzleToken.slice(signatureStart + 1)}`;
  const tampered = await route(new Request("https://yokaiba.test/v1/puzzles/verify", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ puzzleToken: tamperedPuzzleToken, answer: generatePuzzle(tournamentOrderTemplate, "verify-invalid").solution }),
  }));

  assert.equal(tampered.status, 400);
  assert.deepEqual(await tampered.json(), {
    error: { code: "invalid_puzzle_token", message: "puzzleToken is invalid" },
  });
});

test("REST rejects verification without a configured PUZZLE_TOKEN_SECRET", async () => {
  const unconfigured = createRestRouter([tournamentOrderTemplate]);
  const response = await unconfigured(new Request("https://yokaiba.test/v1/puzzles/verify", { method: "POST" }));

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: { code: "not_configured", message: "puzzle verification is not configured" },
  });
});

test("REST rejects excessively long generation inputs", async () => {
  const route = createRestRouter([tournamentOrderTemplate], { puzzleTokenSecret: "test-token-secret" });
  const response = await route(new Request("https://yokaiba.test/v1/puzzles/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ templateId: "tournament-order-v1", seed: "a".repeat(129) }),
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: { code: "bad_request", message: "seed must be at most 128 characters" } });
});

test("REST does not disclose why a JSON request body was rejected", async () => {
  const route = createRestRouter([tournamentOrderTemplate]);
  const requests = [
    new Request("https://yokaiba.test/v1/puzzles/generate", { method: "POST" }),
    new Request("https://yokaiba.test/v1/puzzles/generate", { method: "POST", body: "{" }),
    new Request("https://yokaiba.test/v1/puzzles/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ templateId: "tournament-order-v1", seed: "x".repeat(16 * 1024) }),
    }),
    new Request("https://yokaiba.test/v1/puzzles/generate", {
      method: "POST", headers: { "content-length": `${16 * 1024 + 1}` }, body: "{}",
    }),
  ];

  for (const request of requests) {
    const response = await route(request);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: { code: "bad_request", message: "request body must be valid JSON" } });
  }
});
