const MAX_FAILURE_BODY_LENGTH = 500;

export interface PublicGenerationProbeResult {
  path: string;
  response: Response;
}

function clippedBody(body: string): string {
  return body.length > MAX_FAILURE_BODY_LENGTH
    ? `${body.slice(0, MAX_FAILURE_BODY_LENGTH)}…`
    : body;
}

function failureDetails(path: string, response: Response, body: string): string {
  const requestId = response.headers.get("x-request-id") ?? "missing";
  const rayId = response.headers.get("cf-ray") ?? "missing";
  return `${path} returned ${response.status} (x-request-id: ${requestId}; cf-ray: ${rayId}; body: ${JSON.stringify(clippedBody(body))})`;
}

/** Probe deterministic public generation candidates and preserve diagnostics for failed attempts. */
export async function probePublicGeneration(
  baseUrl: URL,
  smokeSeed: string,
  templateIds: readonly string[],
  fetcher: typeof fetch = fetch,
): Promise<PublicGenerationProbeResult> {
  const failures: string[] = [];
  for (const templateId of templateIds) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidateSeed = attempt === 0 ? smokeSeed : `${smokeSeed}-${attempt}`;
      const path = `/v1/puzzles/generate?templateId=${templateId}&seed=${encodeURIComponent(candidateSeed)}`;
      const response = await fetcher(new URL(path, baseUrl));
      if (response.ok) return { path, response };

      const body = await response.text();
      const details = failureDetails(path, response, body);
      if (response.status !== 500) throw new Error(details);
      failures.push(details);
    }
  }

  throw new Error(`public generation failed for all deterministic deployment smoke seeds and templates: ${failures.join("; ")}`);
}
