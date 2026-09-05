export interface GeneratedPuzzleCacheEntry {
  readonly expiresAt: number;
  readonly status: number;
  readonly statusText: string;
  readonly headers: ReadonlyArray<readonly [string, string]>;
  readonly body: ArrayBuffer;
}

export function responseFromGeneratedPuzzleSnapshot(entry: GeneratedPuzzleCacheEntry): Response {
  return new Response(entry.body.slice(0), {
    status: entry.status,
    statusText: entry.statusText,
    headers: entry.headers.map(([name, value]) => [name, value]),
  });
}

export function generatedPuzzleCacheKey(request: Request, puzzleTokenSecret: string | undefined): string {
  return `${request.url}\u0000${puzzleTokenSecret ?? ""}`;
}

export function cachedGeneratedPuzzle(cache: Map<string, GeneratedPuzzleCacheEntry>, key: string, now: number): Response | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    cache.delete(key);
    return undefined;
  }
  // Refresh insertion order so the oldest entry is evicted first.
  cache.delete(key);
  cache.set(key, entry);
  return responseFromGeneratedPuzzleSnapshot(entry);
}

const GENERATED_PUZZLE_CACHE_TTL_MS = 300_000;
const MAX_GENERATED_PUZZLE_CACHE_ENTRIES = 128;

export async function cacheGeneratedPuzzle(cache: Map<string, GeneratedPuzzleCacheEntry>, key: string, response: Response, now: number): Promise<Response> {
  if (response.status !== 200 && response.status !== 422) return response;
  const entry: GeneratedPuzzleCacheEntry = {
    expiresAt: now + GENERATED_PUZZLE_CACHE_TTL_MS,
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers].map(([name, value]) => [name, value] as const),
    body: await response.arrayBuffer(),
  };
  cache.set(key, entry);
  while (cache.size > MAX_GENERATED_PUZZLE_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
  return responseFromGeneratedPuzzleSnapshot(entry);
}

export async function contentEtag(response: Response): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await response.clone().arrayBuffer());
  return `"yokaiba-v1-${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("")}"`;
}

export async function cachePublicGet(response: Response, request: Request): Promise<Response> {
  if (request.method !== "GET" || (response.status !== 200 && response.status !== 422)) return response;
  const etag = await contentEtag(response);
  const headers = new Headers(response.headers);
  headers.set("etag", etag);
  const ifNone = request.headers.get("if-none-match");
  if (ifNone !== null) {
    const matches = ifNone.split(",").map(value => value.trim()).some(value => value === "*" || value.replace(/^W\//, "") === etag);
    if (matches) return new Response(null, { status: 304, headers });
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
