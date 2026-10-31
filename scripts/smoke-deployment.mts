import { waitForExpectedDeployment } from "./deployment-probe.mjs";
import { readDeploymentConfig } from "./deployment-config.mjs";
import { deploymentSmokeCandidates, entityTagsMatchWeakly, formatSmokeFailure, probePublicGeneration } from "./deployment-smoke-support.mjs";

const { baseUrl, expectedBuildVersion, expectedBuildSha } = readDeploymentConfig(process.env);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

async function get(path: string, options?: RequestInit): Promise<Response> {
  const response = await fetch(new URL(path, baseUrl), options);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response;
}

async function getObject(path: string): Promise<Record<string, unknown>> {
  const body: unknown = await (await get(path)).json();
  const object = asRecord(body);
  if (!object) throw new Error(`${path} returned an invalid response body`);
  return object;
}

await waitForExpectedDeployment({ baseUrl, expectedBuildVersion, expectedBuildSha });

const readyBody = await getObject("/readyz");
if (readyBody.status !== "ready"
  || readyBody.rateLimitProvider !== "configured"
  || readyBody.generateRateLimitProvider !== "configured") {
  throw new Error("readiness did not confirm the production REST and generation rate-limit bindings");
}

const versionBody = await getObject("/v1/version");
if (versionBody.serviceVersion !== expectedBuildVersion || versionBody.buildSha !== expectedBuildSha) {
  throw new Error("version response does not identify the deployment that this workflow released");
}
if (!versionBody.generatorVersion || !versionBody.solverVersion) throw new Error("version response is incomplete");

const smokeCandidates = deploymentSmokeCandidates(expectedBuildSha);
const { path: puzzlePath, response: puzzle } = await probePublicGeneration(baseUrl, smokeCandidates.seed, smokeCandidates.templateIds);
const etag = puzzle.headers.get("etag");
const puzzleValue: unknown = await puzzle.json();
const puzzleBody = asRecord(puzzleValue);
if (!puzzleBody || !Array.isArray(puzzleBody.clues) || "solution" in puzzleBody) {
  throw new Error("puzzle response has an invalid public shape");
}
if (!etag) throw new Error("cacheable puzzle response did not include an ETag");

const cached = await fetch(new URL(puzzlePath, baseUrl), { headers: { "if-none-match": etag } });
if (cached.status !== 304) {
  const body = await cached.text();
  throw new Error(formatSmokeFailure("cached puzzle request", cached, body));
}
const cachedEtag = cached.headers.get("etag");
if (!entityTagsMatchWeakly(etag, cachedEtag)) {
  const details = `expected ETag ${etag}; received ${cachedEtag ?? "missing"}`;
  throw new Error(formatSmokeFailure("cached puzzle response ETag", cached, details));
}

const docs = await get("/docs");
if (!docs.headers.get("cache-control")?.includes("max-age=300")) throw new Error("interactive docs page is missing its five-minute cache policy");
const cachedDocs = await get("/docs");
if (cachedDocs.headers.get("etag") !== docs.headers.get("etag")) throw new Error("interactive docs page changed its ETag between repeated requests");

console.log(`Yokaiba deployment smoke test passed for ${baseUrl.origin}`);
