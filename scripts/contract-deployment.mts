import { waitForExpectedDeployment } from "./deployment-probe.mjs";
import { readDeploymentConfig } from "./deployment-config.mjs";

const { baseUrl, expectedBuildVersion, expectedBuildSha } = readDeploymentConfig(process.env);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

async function request(path: string): Promise<Response> {
  const response = await fetch(new URL(path, baseUrl));
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response;
}

async function requestObject(path: string): Promise<Record<string, unknown>> {
  const body: unknown = await (await request(path)).json();
  const object = asRecord(body);
  if (!object) throw new Error(`${path} returned an invalid response body`);
  return object;
}

await waitForExpectedDeployment({ baseUrl, expectedBuildVersion, expectedBuildSha });

const specification = await (await request("/openapi/v1.yaml")).text();
for (const path of ["/healthz", "/readyz", "/v1/scenarios", "/v1/version", "/v1/puzzles/generate", "/v1/puzzles/verify", "/openapi/chatgpt-actions-v1.yaml"]) {
  if (!specification.includes(`  ${path}:`)) throw new Error(`deployed OpenAPI document does not define ${path}`);
}

const actionsSpecification = await (await request("/openapi/chatgpt-actions-v1.yaml")).text();
for (const path of ["/v1/scenarios", "/v1/puzzles/generate", "/v1/puzzles/verify", "/v1/puzzles/hint"]) {
  if (!actionsSpecification.includes(`  ${path}:`)) throw new Error(`deployed ChatGPT Actions document does not define ${path}`);
}
if (actionsSpecification.includes("  /v1/events:")) throw new Error("deployed ChatGPT Actions document must not expose telemetry ingestion");

const ready = await requestObject("/readyz");
const supportedRateLimitProvider = (value: unknown) => value === "configured" || value === "fallback";
if (ready.status !== "ready"
  || !supportedRateLimitProvider(ready.rateLimitProvider)
  || !supportedRateLimitProvider(ready.generateRateLimitProvider)) {
  throw new Error("readiness does not satisfy the deployed contract");
}
const version = await requestObject("/v1/version");
if (version.serviceVersion !== expectedBuildVersion || version.buildSha !== expectedBuildSha) {
  throw new Error("version does not identify the deployment that this workflow released");
}
if (!version.generatorVersion || !version.solverVersion) throw new Error("version does not satisfy the deployed contract");
const scenarioResponse = await requestObject("/v1/scenarios");
const scenarios = scenarioResponse.scenarios;
const hasDefaultLocale = (scenario: unknown): boolean => {
  const locales = asRecord(asRecord(asRecord(scenario)?.metadata)?.locales);
  return Boolean(locales?.default);
};
if (!Array.isArray(scenarios) || scenarios.length < 2 || !scenarios.every(hasDefaultLocale)) {
  throw new Error("scenario catalogue does not satisfy the deployed contract");
}

console.log(`Yokaiba deployed contract test passed for ${baseUrl.origin}`);
