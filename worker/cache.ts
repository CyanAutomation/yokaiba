export interface GeneratedPuzzleCacheEntry {
  readonly expiresAt: number;
  readonly status: number;
  readonly statusText: string;
  readonly headers: ReadonlyArray<readonly [string, string]>;
  readonly body: ArrayBuffer;
  readonly etag: string;
}

const GENERATED_PUZZLE_CACHE_TTL_MS = 300_000;
const MAX_GENERATED_PUZZLE_CACHE_ENTRIES = 128;
const MAX_GENERATED_PUZZLE_CACHE_BODY_BYTES = 16 * 1024 * 1024;

/** An LRU cache that owns both entry-count and cached-body byte accounting. */
export class GeneratedPuzzleCache {
  readonly #entries = new Map<string, GeneratedPuzzleCacheEntry>();
  #bodyBytes = 0;

  constructor(
    readonly maxEntries = MAX_GENERATED_PUZZLE_CACHE_ENTRIES,
    readonly maxBodyBytes = MAX_GENERATED_PUZZLE_CACHE_BODY_BYTES,
  ) {}

  get size(): number {
    return this.#entries.size;
  }

  get bodyBytes(): number {
    return this.#bodyBytes;
  }

  has(key: string): boolean {
    return this.#entries.has(key);
  }

  values(): MapIterator<GeneratedPuzzleCacheEntry> {
    return this.#entries.values();
  }

  peek(key: string): GeneratedPuzzleCacheEntry | undefined {
    return this.#entries.get(key);
  }

  get(key: string, now: number): GeneratedPuzzleCacheEntry | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.#delete(key, entry);
      return undefined;
    }
    // Refresh insertion order so the oldest entry is evicted first.
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry;
  }

  set(key: string, entry: GeneratedPuzzleCacheEntry): boolean {
    const replaced = this.#entries.get(key);
    if (replaced) this.#delete(key, replaced);

    const entryBodyBytes = entry.body.byteLength;
    // A response larger than the entire budget can be served, but retaining it
    // would necessarily evict every useful cache entry.
    if (entryBodyBytes > this.maxBodyBytes) return false;

    this.#entries.set(key, entry);
    this.#bodyBytes += entryBodyBytes;
    while (this.#entries.size > this.maxEntries || this.#bodyBytes > this.maxBodyBytes) {
      const oldestKey = this.#entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.#delete(oldestKey, this.#entries.get(oldestKey)!);
    }
    return true;
  }

  #delete(key: string, entry: GeneratedPuzzleCacheEntry): void {
    if (this.#entries.delete(key)) this.#bodyBytes -= entry.body.byteLength;
  }
}

function responseFromGeneratedPuzzleSnapshot(entry: GeneratedPuzzleCacheEntry): Response {
  const headers = new Headers(entry.headers.map(([name, value]) => [name, value]));
  headers.set("etag", entry.etag);
  return new Response(entry.body.slice(0), {
    status: entry.status,
    statusText: entry.statusText,
    headers,
  });
}

const MAX_PUZZLE_TOKEN_NAMESPACE_DIGESTS = 10;
const puzzleTokenNamespaceDigests = new Map<string | undefined, Promise<string>>();

export interface GeneratedPuzzleCacheKeyDependencies {
  /** An isolated cache and digest are useful for deterministic cache-key tests. */
  digestCache?: Map<string | undefined, Promise<string>>;
  digest?: (algorithm: AlgorithmIdentifier, data: BufferSource) => Promise<ArrayBuffer>;
  reportDigestFailure?: (error: unknown) => void;
}

function reportPuzzleTokenDigestFailure(error: unknown): void {
  console.error(JSON.stringify({
    event: "puzzle_token_namespace_digest_failure",
    error: error instanceof Error ? error.message : String(error),
  }));
}

function puzzleTokenNamespace(
  puzzleTokenSecret: string | undefined,
  dependencies: GeneratedPuzzleCacheKeyDependencies,
): Promise<string> {
  const digestCache = dependencies.digestCache ?? puzzleTokenNamespaceDigests;
  let digest = digestCache.get(puzzleTokenSecret);
  if (digest) {
    // Refresh insertion order so secrets that are still active remain cached.
    digestCache.delete(puzzleTokenSecret);
    digestCache.set(puzzleTokenSecret, digest);
  } else {
    // Include the signing mode in the digest input so an explicitly configured
    // empty secret cannot share cache entries with unsigned puzzles.
    const namespaceInput = puzzleTokenSecret === undefined
      ? "unsigned"
      : `signed\0${puzzleTokenSecret}`;
    const digestInput = new TextEncoder().encode(namespaceInput);
    const calculateDigest = dependencies.digest ?? ((algorithm, data) => crypto.subtle.digest(algorithm, data));
    const reportFailure = dependencies.reportDigestFailure ?? reportPuzzleTokenDigestFailure;
    digest = calculateDigest("SHA-256", digestInput)
      .then(value => [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, "0")).join(""))
      .catch(error => {
        // Do not retain rejected promises: a transient Web Crypto failure should
        // not permanently disable caching for this signing configuration.
        if (digestCache.get(puzzleTokenSecret) === digest) {
          digestCache.delete(puzzleTokenSecret);
        }
        reportFailure(error);
        throw error;
      });
    while (digestCache.size >= MAX_PUZZLE_TOKEN_NAMESPACE_DIGESTS) {
      digestCache.delete(digestCache.keys().next().value as string | undefined);
    }
    digestCache.set(puzzleTokenSecret, digest);
  }
  return digest;
}

export async function generatedPuzzleCacheKey(
  request: Request,
  puzzleTokenSecret: string | undefined,
  dependencies: GeneratedPuzzleCacheKeyDependencies = {},
): Promise<string | undefined> {
  try {
    const { templateId, seed, difficultyLevel, allowSeedFallback } = parseGenerationQuery(new URL(request.url));
    // A positional tuple gives the identity a fixed ordering and makes explicit
    // that an absent fallback has the same semantics as `false`.
    return JSON.stringify([templateId, seed, difficultyLevel ?? null, allowSeedFallback ?? false, await puzzleTokenNamespace(puzzleTokenSecret, dependencies)]);
  } catch {
    // Invalid generation requests are routed normally so the router can return
    // its canonical 400 response; they are not eligible for memoization.
    return undefined;
  }
}

export function cachedGeneratedPuzzle(cache: GeneratedPuzzleCache, key: string, now: number): Response | undefined {
  const entry = cache.get(key, now);
  if (!entry) return undefined;
  return responseFromGeneratedPuzzleSnapshot(entry);
}

export async function cacheGeneratedPuzzle(cache: GeneratedPuzzleCache, key: string, response: Response, now: number): Promise<Response> {
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
  return responseFromGeneratedPuzzleSnapshot(entry);
}

async function contentEtag(response: Response): Promise<string> {
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
