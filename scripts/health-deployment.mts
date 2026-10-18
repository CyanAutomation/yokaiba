import { waitForExpectedDeployment } from "./deployment-probe.mjs";
import { readDeploymentConfig } from "./deployment-config.mjs";

const { baseUrl, expectedBuildVersion, expectedBuildSha } = readDeploymentConfig(process.env, "freshly deployed Worker origin");

await waitForExpectedDeployment({ baseUrl, expectedBuildVersion, expectedBuildSha });
console.log(`Yokaiba deployment health probe passed for ${baseUrl.origin}`);
