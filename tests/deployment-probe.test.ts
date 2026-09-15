import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error The deployment scripts are intentionally plain JavaScript entry points.
import { waitForExpectedDeployment } from "../scripts/deployment-probe.mjs";

const expected = { expectedBuildVersion: "1.2.3", expectedBuildSha: "abc123" };

function health(version: string, sha: string, requestId: string) {
  return new Response(JSON.stringify({ status: "ok", build: { serviceVersion: version, buildSha: sha } }), {
    headers: { "content-type": "application/json", "x-request-id": requestId },
  });
}

test("deployment probe succeeds immediately for current metadata", async () => {
  const requests: Array<{ url: URL; init: RequestInit }> = [];
  await waitForExpectedDeployment({
    baseUrl: new URL("https://deployment.example"),
    ...expected,
    fetchImpl: (url: URL, init: RequestInit) => {
      requests.push({ url, init });
      return Promise.resolve(health("1.2.3", "abc123", "current-request"));
    },
  });

  assert.equal(requests.length, 1);
  assert.ok(requests[0].url.searchParams.has("deployment-probe"));
  assert.equal(new Headers(requests[0].init.headers).get("cache-control"), "no-cache");
});

test("deployment probe retries stale metadata until the current build arrives", async () => {
  const responses = [health("1.2.2", "oldsha", "old-request"), health("1.2.3", "abc123", "new-request")];
  let elapsed = 0;
  let requestCount = 0;
  await waitForExpectedDeployment({
    baseUrl: "https://deployment.example",
    ...expected,
    fetchImpl: () => Promise.resolve(responses[requestCount++]),
    now: () => elapsed,
    sleep: (delay: number) => {
      elapsed += delay;
      return Promise.resolve();
    },
  });

  assert.equal(requestCount, 2);
  assert.equal(elapsed, 3_000);
});

test("deployment probe reports sanitized context for network failures", async () => {
  const networkError = new TypeError("fetch failed");

  await assert.rejects(
    waitForExpectedDeployment({
      baseUrl: "https://user:password@deployment.example/sensitive-path?token=secret",
      ...expected,
      fetchImpl: () => Promise.reject(networkError),
      now: () => 123,
    }),
    error => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "/healthz fetch failed (origin: https://deployment.example; attempt: 1)");
      assert.equal(error.cause, networkError);
      assert.doesNotMatch(error.message, /user|password|secret|sensitive-path/);
      return true;
    },
  );
});

test("deployment probe timeout reports expected and last received metadata", async () => {
  let elapsed = 0;
  await assert.rejects(
    waitForExpectedDeployment({
      baseUrl: "https://deployment.example/sensitive-path?token=secret",
      ...expected,
      fetchImpl: () => Promise.resolve(health("0.9.0", "stalesha", "request-at-timeout")),
      intervalMs: 2_000,
      timeoutMs: 4_000,
      now: () => elapsed,
      sleep: (delay: number) => {
        elapsed += delay;
        return Promise.resolve();
      },
    }),
    error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /origin: https:\/\/deployment\.example/);
      assert.match(error.message, /expected: \{"serviceVersion":"1\.2\.3","buildSha":"abc123"\}/);
      assert.match(error.message, /last received: \{"serviceVersion":"0\.9\.0","buildSha":"stalesha"\}/);
      assert.match(error.message, /response status: 200/);
      assert.match(error.message, /x-request-id: request-at-timeout/);
      assert.doesNotMatch(error.message, /secret|sensitive-path/);
      return true;
    },
  );
});
