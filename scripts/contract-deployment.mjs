const rawBaseUrl = process.env.DEPLOYMENT_URL;
if (!rawBaseUrl) throw new Error("DEPLOYMENT_URL must contain the canonical deployed Worker origin");
const baseUrl = new URL(rawBaseUrl);
if (baseUrl.pathname !== "/" || baseUrl.search || baseUrl.hash) throw new Error("DEPLOYMENT_URL must be an origin without a path, query, or fragment");

async function request(path) {
  const response = await fetch(new URL(path, baseUrl));
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response;
}

const specification = await (await request("/openapi/v1.yaml")).text();
for (const path of ["/healthz", "/readyz", "/v1/scenarios", "/v1/version", "/v1/puzzles/generate", "/v1/puzzles/verify"]) {
  if (!specification.includes(`  ${path}:`)) throw new Error(`deployed OpenAPI document does not define ${path}`);
}

const health = await (await request("/healthz")).json();
if (health.status !== "ok" || !health.build?.buildSha) throw new Error("health does not satisfy the deployed contract");
const ready = await (await request("/readyz")).json();
if (ready.status !== "ready" || !["configured", "fallback"].includes(ready.rateLimitProvider)) throw new Error("readiness does not satisfy the deployed contract");
const version = await (await request("/v1/version")).json();
if (!version.serviceVersion || !version.buildSha || !version.generatorVersion || !version.solverVersion) throw new Error("version does not satisfy the deployed contract");
const scenarios = await (await request("/v1/scenarios")).json();
if (!Array.isArray(scenarios.scenarios) || scenarios.scenarios.length < 2 || !scenarios.scenarios.every(scenario => scenario.metadata?.locales?.default)) throw new Error("scenario catalogue does not satisfy the deployed contract");

console.log(`Yokaiba deployed contract test passed for ${baseUrl.origin}`);
