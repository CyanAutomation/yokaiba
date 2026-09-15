import { waitForExpectedDeployment } from "./deployment-probe.mjs";

const rawBaseUrl = process.env.DEPLOYMENT_URL;
if (!rawBaseUrl) throw new Error("DEPLOYMENT_URL must contain the freshly deployed Worker origin");
const expectedBuildSha = process.env.EXPECTED_BUILD_SHA;
if (!expectedBuildSha) throw new Error("EXPECTED_BUILD_SHA must contain the Git SHA being deployed");
const expectedBuildVersion = process.env.EXPECTED_BUILD_VERSION;
if (!expectedBuildVersion) throw new Error("EXPECTED_BUILD_VERSION must contain the package version being deployed");

const baseUrl = new URL(rawBaseUrl);
if (baseUrl.pathname !== "/" || baseUrl.search || baseUrl.hash) {
  throw new Error("DEPLOYMENT_URL must be an origin without a path, query, or fragment");
}

await waitForExpectedDeployment({ baseUrl, expectedBuildVersion, expectedBuildSha });
console.log(`Yokaiba deployment health probe passed for ${baseUrl.origin}`);
