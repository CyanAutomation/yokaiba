import { waitForExpectedDeployment } from "./deployment-probe.mjs";
import { readDeploymentConfig } from "./deployment-config.mjs";

const { baseUrl, expectedBuildVersion, expectedBuildSha } = readDeploymentConfig(process.env);

async function request(path) {
  const response = await fetch(new URL(path, baseUrl));
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response;
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

const ready = await (await request("/readyz")).json();
if (ready.status !== "ready"
  || !["configured", "fallback"].includes(ready.rateLimitProvider)
  || !["configured", "fallback"].includes(ready.generateRateLimitProvider)) {
  throw new Error("readiness does not satisfy the deployed contract");
}
const version = await (await request("/v1/version")).json();
if (version.serviceVersion !== expectedBuildVersion || version.buildSha !== expectedBuildSha) {
  throw new Error("version does not identify the deployment that this workflow released");
}
if (!version.generatorVersion || !version.solverVersion) throw new Error("version does not satisfy the deployed contract");
const scenarios = await (await request("/v1/scenarios")).json();
if (!Array.isArray(scenarios.scenarios) || scenarios.scenarios.length < 2 || !scenarios.scenarios.every(scenario => scenario.metadata?.locales?.default)) throw new Error("scenario catalogue does not satisfy the deployed contract");

console.log(`Yokaiba deployed contract test passed for ${baseUrl.origin}`);
