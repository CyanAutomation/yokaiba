import { PuzzleActionError } from "./puzzle-actions.js";
import { json } from "./json-response.js";

const MAX_GENERATION_BODY_BYTES = 16 * 1024;
const INVALID_JSON_BODY_MESSAGE = "request body must be valid JSON";

/** Read bounded bytes instead of trusting a spoofable or absent Content-Length header. */
export async function readJsonBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_GENERATION_BODY_BYTES) throw new TypeError(INVALID_JSON_BODY_MESSAGE);
  if (!request.body) throw new TypeError(INVALID_JSON_BODY_MESSAGE);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_GENERATION_BODY_BYTES) {
        await reader.cancel();
        throw new TypeError(INVALID_JSON_BODY_MESSAGE);
      }
      chunks.push(value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new TypeError(INVALID_JSON_BODY_MESSAGE);
  } finally {
    reader.releaseLock();
  }
}

export function badRequest(error: unknown): Response {
  const code = error instanceof PuzzleActionError ? error.code : "bad_request";
  return json({ error: { code, message: error instanceof Error ? error.message : "invalid request" } }, 400);
}
