/** Read and validate the deployment metadata shared by post-deploy checks. */
export function readDeploymentConfig(env, baseUrlDescription = "canonical deployed Worker origin") {
  const rawBaseUrl = env.DEPLOYMENT_URL;
  if (!rawBaseUrl) throw new Error(`DEPLOYMENT_URL must contain the ${baseUrlDescription}`);
  const expectedBuildSha = env.EXPECTED_BUILD_SHA;
  if (!expectedBuildSha) throw new Error("EXPECTED_BUILD_SHA must contain the Git SHA being deployed");
  const expectedBuildVersion = env.EXPECTED_BUILD_VERSION;
  if (!expectedBuildVersion) throw new Error("EXPECTED_BUILD_VERSION must contain the package version being deployed");

  const baseUrl = new URL(rawBaseUrl);
  if (baseUrl.pathname !== "/" || baseUrl.search || baseUrl.hash) {
    throw new Error("DEPLOYMENT_URL must be an origin without a path, query, or fragment");
  }
  return { baseUrl, expectedBuildVersion, expectedBuildSha };
}
