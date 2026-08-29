const rawBaseUrl = process.env.DEPLOYMENT_URL;
if (!rawBaseUrl) throw new Error("DEPLOYMENT_URL must contain the canonical deployed Worker origin");

const baseUrl = new URL(rawBaseUrl);
if (baseUrl.pathname !== "/" || baseUrl.search || baseUrl.hash) throw new Error("DEPLOYMENT_URL must be an origin without a path, query, or fragment");

async function get(path, options) {
  const response = await fetch(new URL(path, baseUrl), options);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response;
}

const health = await get("/healthz");
const healthBody = await health.json();
if (healthBody.status !== "ok") throw new Error("health response did not report ok");

const version = await get("/v1/version");
const versionBody = await version.json();
if (!versionBody.serviceVersion || !versionBody.generatorVersion || !versionBody.solverVersion) throw new Error("version response is incomplete");

const puzzlePath = "/v1/puzzles/generate?templateId=tournament-order-v1&seed=deployment-smoke";
const puzzle = await get(puzzlePath);
const etag = puzzle.headers.get("etag");
const puzzleBody = await puzzle.json();
if (!Array.isArray(puzzleBody.clues) || "solution" in puzzleBody) throw new Error("puzzle response has an invalid public shape");
if (!etag) throw new Error("cacheable puzzle response did not include an ETag");

const cached = await fetch(new URL(puzzlePath, baseUrl), { headers: { "if-none-match": etag } });
if (cached.status !== 304) throw new Error(`conditional puzzle request returned ${cached.status}, expected 304`);

console.log(`Yokaiba deployment smoke test passed for ${baseUrl.origin}`);
