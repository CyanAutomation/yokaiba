const RETRYABLE_ROLLOUT_STATUSES = new Set([404, 408, 425, 429, 500, 502, 503, 504]);

interface LastHealthProbe {
  serviceVersion: unknown;
  buildSha: unknown;
  responseStatus: number | string;
  requestId: string;
}

interface HealthInspection {
  matches: boolean;
  last: LastHealthProbe;
}

export interface WaitForExpectedDeploymentOptions {
  baseUrl: URL | string;
  expectedBuildVersion: string;
  expectedBuildSha: string;
  fetchImpl?: (input: URL, init: RequestInit) => Promise<Response>;
  intervalMs?: number;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (delay: number) => Promise<void>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

async function inspectHealthResponse(
  response: Response,
  origin: string,
  expectedBuildVersion: string,
  expectedBuildSha: string,
): Promise<HealthInspection> {
  const last: LastHealthProbe = {
    serviceVersion: undefined,
    buildSha: undefined,
    responseStatus: response.status,
    requestId: response.headers.get("x-request-id") ?? "missing",
  };
  if (!response.ok) {
    if (!RETRYABLE_ROLLOUT_STATUSES.has(response.status)) {
      throw new Error(`/healthz returned non-retryable status ${response.status} (origin: ${origin}; x-request-id: ${last.requestId})`);
    }
    return { matches: false, last };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new Error(`/healthz returned malformed JSON (origin: ${origin}; status: ${response.status}; x-request-id: ${last.requestId})`, { cause: error });
  }
  const health = asRecord(body);
  if (health?.status !== "ok") {
    throw new Error(`/healthz returned invalid status ${JSON.stringify(health?.status)} (origin: ${origin}; response status: ${response.status}; x-request-id: ${last.requestId})`);
  }
  const build = asRecord(health.build);
  last.serviceVersion = build?.serviceVersion;
  last.buildSha = build?.buildSha;
  return {
    matches: last.serviceVersion === expectedBuildVersion && last.buildSha === expectedBuildSha,
    last,
  };
}

function timeoutError(origin: string, expectedBuildVersion: string, expectedBuildSha: string, last: LastHealthProbe): Error {
  return new Error(
    `deployment health probe timed out (origin: ${origin}; expected: ${JSON.stringify({ serviceVersion: expectedBuildVersion, buildSha: expectedBuildSha })}; ` +
      `last received: ${JSON.stringify({ serviceVersion: last.serviceVersion, buildSha: last.buildSha })}; response status: ${last.responseStatus}; x-request-id: ${last.requestId})`,
  );
}

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
  sleep = delay => new Promise<void>(resolve => setTimeout(resolve, delay)),
}: WaitForExpectedDeploymentOptions): Promise<Response> {
  const origin = new URL(baseUrl).origin;
  const deadline = now() + timeoutMs;
  let attempt = 0;
  let last: LastHealthProbe = {
    serviceVersion: undefined,
    buildSha: undefined,
    responseStatus: "not received",
    requestId: "missing",
  };

  while (true) {
    const url = new URL("/healthz", origin);
    url.searchParams.set("deployment-probe", `${now()}-${attempt++}`);
    let response: Response;
    try {
      response = await fetchImpl(url, { headers: { "cache-control": "no-cache" } });
    } catch (error) {
      throw new Error(`/healthz fetch failed (origin: ${origin}; attempt: ${attempt})`, { cause: error });
    }
    const inspected = await inspectHealthResponse(response, origin, expectedBuildVersion, expectedBuildSha);
    last = inspected.last;
    if (inspected.matches) return response;

    const remainingMs = deadline - now();
    if (remainingMs <= 0) throw timeoutError(origin, expectedBuildVersion, expectedBuildSha, last);
    await sleep(Math.min(intervalMs, remainingMs));
  }
}
