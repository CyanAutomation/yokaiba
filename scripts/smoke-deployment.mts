import { waitForExpectedDeployment } from "./deployment-probe.mjs";
import { readDeploymentConfig } from "./deployment-config.mjs";

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

const smokeSeed = `deployment-smoke-${expectedBuildSha}`;
const smokeTemplateIds = ["tournament-order-v2", "tournament-order-v1"] as const;
let puzzlePath: string | undefined;
let puzzle: Response | undefined;
for (const templateId of smokeTemplateIds) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidateSeed = attempt === 0 ? smokeSeed : `${smokeSeed}-${attempt}`;
    const candidatePath = `/v1/puzzles/generate?templateId=${templateId}&seed=${encodeURIComponent(candidateSeed)}`;
    const response = await fetch(new URL(candidatePath, baseUrl));
    if (response.ok) {
      puzzlePath = candidatePath;
      puzzle = response;
      break;
    }
    if (response.status !== 500) throw new Error(`${candidatePath} returned ${response.status}`);
  }
  if (puzzle) break;
}
if (!puzzle) throw new Error("public generation failed for all deterministic deployment smoke seeds and templates");
const etag = puzzle.headers.get("etag");
const puzzleValue: unknown = await puzzle.json();
const puzzleBody = asRecord(puzzleValue);
if (!puzzleBody || !Array.isArray(puzzleBody.clues) || "solution" in puzzleBody) {
  throw new Error("puzzle response has an invalid public shape");
}
if (!etag) throw new Error("cacheable puzzle response did not include an ETag");

if (!puzzlePath) throw new Error("puzzlePath is undefined before cache validation");
const cached = await fetch(new URL(puzzlePath, baseUrl), { headers: { "if-none-match": etag } });
if (cached.status !== 304) {
  const body = await cached.text();
  const requestId = cached.headers.get("x-request-id") ?? "missing";
  throw new Error(`cached puzzle request returned ${cached.status} (x-request-id: ${requestId}; body: ${JSON.stringify(body)})`);
}
if (cached.headers.get("etag") !== etag) throw new Error("cached puzzle response changed its ETag");

const docs = await get("/docs");
if (!docs.headers.get("cache-control")?.includes("max-age=300")) throw new Error("interactive docs page is missing its five-minute cache policy");
const cachedDocs = await get("/docs");
if (cachedDocs.headers.get("etag") !== docs.headers.get("etag")) throw new Error("interactive docs page changed its ETag between repeated requests");

console.log(`Yokaiba deployment smoke test passed for ${baseUrl.origin}`);
