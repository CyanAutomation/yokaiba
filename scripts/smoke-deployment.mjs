import { waitForExpectedDeployment } from "./deployment-probe.mjs";
import { readDeploymentConfig } from "./deployment-config.mjs";

const { baseUrl, expectedBuildVersion, expectedBuildSha } = readDeploymentConfig(process.env);

async function get(path, options) {
  const response = await fetch(new URL(path, baseUrl), options);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response;
}

await waitForExpectedDeployment({ baseUrl, expectedBuildVersion, expectedBuildSha });

const ready = await get("/readyz");
const readyBody = await ready.json();
if (readyBody.status !== "ready"
  || readyBody.rateLimitProvider !== "configured"
  || readyBody.generateRateLimitProvider !== "configured") {
  throw new Error("readiness did not confirm the production REST and generation rate-limit bindings");
}

const version = await get("/v1/version");
const versionBody = await version.json();
if (versionBody.serviceVersion !== expectedBuildVersion || versionBody.buildSha !== expectedBuildSha) {
  throw new Error("version response does not identify the deployment that this workflow released");
}
if (!versionBody.generatorVersion || !versionBody.solverVersion) throw new Error("version response is incomplete");

const puzzlePath = "/v1/puzzles/generate?templateId=tournament-order-v1&seed=deployment-smoke";
const puzzle = await get(puzzlePath);
const etag = puzzle.headers.get("etag");
const puzzleBody = await puzzle.json();
if (!Array.isArray(puzzleBody.clues) || "solution" in puzzleBody) throw new Error("puzzle response has an invalid public shape");
if (!etag) throw new Error("cacheable puzzle response did not include an ETag");

const cached = await fetch(new URL(puzzlePath, baseUrl), { headers: { "if-none-match": etag } });
if (cached.status !== 304) {
  const body = await cached.text();
  const requestId = cached.headers.get("x-request-id") ?? "missing";
  throw new Error(`conditional puzzle request returned ${cached.status}, expected 304 (x-request-id: ${requestId}; body: ${JSON.stringify(body)})`);
}

console.log(`Yokaiba deployment smoke test passed for ${baseUrl.origin}`);
