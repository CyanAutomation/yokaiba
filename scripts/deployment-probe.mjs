const RETRYABLE_ROLLOUT_STATUSES = new Set([404, 408, 425, 429, 500, 502, 503, 504]);

/**
 * Wait for the health endpoint to identify the build that was just deployed.
 * Dependencies are injectable so the bounded polling behavior can be tested
 * without making tests wait in real time.
 */
export async function waitForExpectedDeployment({
  baseUrl,
  expectedBuildVersion,
  expectedBuildSha,
  fetchImpl = fetch,
  intervalMs = 3_000,
  timeoutMs = 60_000,
  now = Date.now,
  sleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
}) {
  const origin = new URL(baseUrl).origin;
  const deadline = now() + timeoutMs;
  let attempt = 0;
  let last = { serviceVersion: undefined, buildSha: undefined, responseStatus: "not received", requestId: "missing" };

  while (true) {
    const url = new URL("/healthz", origin);
    url.searchParams.set("deployment-probe", `${now()}-${attempt++}`);
    let response;
    try {
      response = await fetchImpl(url, { headers: { "cache-control": "no-cache" } });
    } catch (error) {
      throw new Error(`/healthz fetch failed (origin: ${origin}; attempt: ${attempt})`, { cause: error });
    }
    last = {
      serviceVersion: undefined,
      buildSha: undefined,
      responseStatus: response.status,
      requestId: response.headers.get("x-request-id") ?? "missing",
    };

    if (!response.ok) {
      if (!RETRYABLE_ROLLOUT_STATUSES.has(response.status)) {
        throw new Error(`/healthz returned non-retryable status ${response.status} (origin: ${origin}; x-request-id: ${last.requestId})`);
      }
    } else {
      let body;
      try {
        body = await response.json();
      } catch (error) {
        throw new Error(`/healthz returned malformed JSON (origin: ${origin}; status: ${response.status}; x-request-id: ${last.requestId})`, { cause: error });
      }
      if (body?.status !== "ok") {
        throw new Error(`/healthz returned invalid status ${JSON.stringify(body?.status)} (origin: ${origin}; response status: ${response.status}; x-request-id: ${last.requestId})`);
      }
      last.serviceVersion = body.build?.serviceVersion;
      last.buildSha = body.build?.buildSha;
      if (last.serviceVersion === expectedBuildVersion && last.buildSha === expectedBuildSha) return response;
    }

    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      throw new Error(
        `deployment health probe timed out (origin: ${origin}; expected: ${JSON.stringify({ serviceVersion: expectedBuildVersion, buildSha: expectedBuildSha })}; ` +
          `last received: ${JSON.stringify({ serviceVersion: last.serviceVersion, buildSha: last.buildSha })}; response status: ${last.responseStatus}; x-request-id: ${last.requestId})`,
      );
    }
    await sleep(Math.min(intervalMs, remainingMs));
  }
}
