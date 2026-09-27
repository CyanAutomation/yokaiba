export interface GeneratedPuzzleCacheEntry {
  readonly expiresAt: number;
  readonly status: number;
  readonly statusText: string;
  readonly headers: ReadonlyArray<readonly [string, string]>;
  readonly body: ArrayBuffer;
  readonly etag: string;
}

export function responseFromGeneratedPuzzleSnapshot(entry: GeneratedPuzzleCacheEntry): Response {
  const headers = new Headers(entry.headers.map(([name, value]) => [name, value]));
  headers.set("etag", entry.etag);
  return new Response(entry.body.slice(0), {
    status: entry.status,
    statusText: entry.statusText,
    headers,
  });
}

const puzzleTokenNamespaceDigests = new Map<string | undefined, Promise<string>>();

function puzzleTokenNamespace(puzzleTokenSecret: string | undefined): Promise<string> {
  let digest = puzzleTokenNamespaceDigests.get(puzzleTokenSecret);
  if (!digest) {
    // Include the signing mode in the digest input so an explicitly configured
    // empty secret cannot share cache entries with unsigned puzzles.
    const namespaceInput = puzzleTokenSecret === undefined
      ? "unsigned"
      : `signed\0${puzzleTokenSecret}`;
    digest = crypto.subtle.digest("SHA-256", new TextEncoder().encode(namespaceInput))
      .then(value => [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, "0")).join(""));
    puzzleTokenNamespaceDigests.set(puzzleTokenSecret, digest);
  }
  return digest;
}

export async function generatedPuzzleCacheKey(request: Request, puzzleTokenSecret: string | undefined): Promise<string | undefined> {
  try {
    const { templateId, seed, difficultyLevel, allowSeedFallback } = parseGenerationQuery(new URL(request.url));
    // A positional tuple gives the identity a fixed ordering and makes explicit
    // that an absent fallback has the same semantics as `false`.
    return JSON.stringify([templateId, seed, difficultyLevel ?? null, allowSeedFallback ?? false, await puzzleTokenNamespace(puzzleTokenSecret)]);
  } catch {
    // Invalid generation requests are routed normally so the router can return
    // its canonical 400 response; they are not eligible for memoization.
    return undefined;
  }
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
  const body = await response.arrayBuffer();
  const entry: GeneratedPuzzleCacheEntry = {
    expiresAt: now + GENERATED_PUZZLE_CACHE_TTL_MS,
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers].map(([name, value]) => [name, value] as const),
    body,
    etag: await contentEtagFromBytes(body),
  };
  cache.set(key, entry);
  while (cache.size > MAX_GENERATED_PUZZLE_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
  return responseFromGeneratedPuzzleSnapshot(entry);
}

export async function contentEtag(response: Response): Promise<string> {
  return contentEtagFromBytes(await response.clone().arrayBuffer());
}

async function contentEtagFromBytes(body: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", body);
  return `"yokaiba-v1-${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("")}"`;
}

function validEtag(value: string | null): value is string {
  return value !== null && /^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/.test(value);
}

export async function cachePublicGet(response: Response, request: Request): Promise<Response> {
  if (request.method !== "GET" || (response.status !== 200 && response.status !== 422)) return response;
  const headers = new Headers(response.headers);
  const existingEtag = headers.get("etag");
  const etag = validEtag(existingEtag) ? existingEtag : await contentEtag(response);
  headers.set("etag", etag);
  const ifNone = request.headers.get("if-none-match");
  if (ifNone !== null) {
    const matches = ifNone.split(",").map(value => value.trim()).some(value => value === "*" || value.replace(/^W\//, "") === etag.replace(/^W\//, ""));
    if (matches) return new Response(null, { status: 304, headers });
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
import { parseGenerationQuery } from "../src/api/generation-query.js";
