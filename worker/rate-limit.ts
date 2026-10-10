export type RateLimitStore = Map<string, { count: number; resetAt: number }>;

export interface RateLimitDecision {
  limited: boolean;
  /** Present only when the Worker performed the limiting locally. */
  remaining?: number;
  /** Unix epoch seconds; present only when the Worker performed the limiting locally. */
  resetAt?: number;
}

export type RateLimiter = (request: Request, rawLimit: string | undefined, scope: string) => boolean | RateLimitDecision;

export interface RateLimitProvider {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface RestRateLimitEnvironment {
  REST_RATE_LIMITER?: RateLimitProvider;
  REST_GENERATE_RATE_LIMITER?: RateLimitProvider;
  VERIFY_RATE_LIMITER?: RateLimitProvider;
  REST_RATE_LIMIT?: string;
  REST_GENERATE_RATE_LIMIT?: string;
  VERIFY_RATE_LIMIT?: string;
  HINT_RATE_LIMIT?: string;
}

const RATE_WINDOW_MS = 60_000;
const MAX_RATE_LIMIT_KEYS = 10_000;

function configuredLimit(rawLimit: string | undefined): number {
  const configured = Number(rawLimit ?? 30);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : 30;
}

function requestKey(request: Request, scope: string): string {
  return `${scope}:${request.headers.get("cf-connecting-ip") ?? "unknown"}`;
}

function makeWindowRoom(rateLimits: RateLimitStore, now: number): void {
  if (rateLimits.size < MAX_RATE_LIMIT_KEYS) return;
  for (const [candidate, value] of rateLimits) {
    if (value.resetAt <= now) rateLimits.delete(candidate);
  }
  if (rateLimits.size >= MAX_RATE_LIMIT_KEYS) rateLimits.delete(rateLimits.keys().next().value as string);
}

function startRateLimitWindow(rateLimits: RateLimitStore, key: string, now: number, limit: number): RateLimitDecision {
  const resetAt = now + RATE_WINDOW_MS;
  makeWindowRoom(rateLimits, now);
  rateLimits.set(key, { count: 1, resetAt });
  return { limited: false, remaining: limit - 1, resetAt: Math.ceil(resetAt / 1_000) };
}

function continueRateLimitWindow(current: { count: number; resetAt: number }, limit: number): RateLimitDecision {
  current.count += 1;
  return {
    limited: current.count > limit,
    remaining: Math.max(0, limit - current.count),
    resetAt: Math.ceil(current.resetAt / 1_000),
  };
}

function applyRateLimit(rateLimits: RateLimitStore, request: Request, rawLimit: string | undefined, scope: string, now: number): RateLimitDecision {
  const limit = configuredLimit(rawLimit);
  const key = requestKey(request, scope);
  const current = rateLimits.get(key);
  return !current || current.resetAt <= now
    ? startRateLimitWindow(rateLimits, key, now, limit)
    : continueRateLimitWindow(current, limit);
}

export function createRateLimiter(rateLimits: RateLimitStore = new Map(), clock: () => number = Date.now): RateLimiter {
  return (request, rawLimit, scope) => applyRateLimit(rateLimits, request, rawLimit, scope, clock());
}

export function asRateLimitDecision(result: boolean | RateLimitDecision): RateLimitDecision {
  return typeof result === "boolean" ? { limited: result } : result;
}

export async function providerRateLimitDecision(
  provider: RateLimitProvider | undefined,
  request: Request,
  onProviderFailure: () => void,
  key = `${request.headers.get("cf-connecting-ip") ?? "anonymous"}:${new URL(request.url).pathname}`,
): Promise<RateLimitDecision | undefined> {
  if (provider) {
    try {
      return { limited: !(await provider.limit({ key })).success };
    } catch {
      onProviderFailure();
      console.error(JSON.stringify({ event: "rate_limit_provider_failure", path: new URL(request.url).pathname }));
    }
  }
  return undefined;
}

export async function restRateLimitDecision(
  rateLimited: RateLimiter,
  request: Request,
  env: RestRateLimitEnvironment,
  onRestProviderFailure: () => void,
  onRestGenerateProviderFailure: () => void,
  onVerifyProviderFailure: () => void,
): Promise<RateLimitDecision> {
  const path = new URL(request.url).pathname;
  const protectedPuzzleOperation = ["/v1/puzzles/verify", "/v1/puzzles/hint"].includes(path);
  const puzzleGeneration = path === "/v1/puzzles/generate";
  const provider = protectedPuzzleOperation
    ? env.VERIFY_RATE_LIMITER
    : puzzleGeneration ? env.REST_GENERATE_RATE_LIMITER : env.REST_RATE_LIMITER;
  const onProviderFailure = protectedPuzzleOperation
    ? onVerifyProviderFailure
    : puzzleGeneration ? onRestGenerateProviderFailure : onRestProviderFailure;
  const providerDecision = await providerRateLimitDecision(provider, request, onProviderFailure);
  if (providerDecision) return providerDecision;
  if (protectedPuzzleOperation) {
    const rawLimit = path === "/v1/puzzles/hint" ? env.HINT_RATE_LIMIT ?? "10" : env.VERIFY_RATE_LIMIT ?? "10";
    return asRateLimitDecision(rateLimited(request, rawLimit, "protected-puzzle"));
  }
  if (puzzleGeneration) return asRateLimitDecision(rateLimited(request, env.REST_GENERATE_RATE_LIMIT ?? "10", "rest-generate"));
  return asRateLimitDecision(rateLimited(request, env.REST_RATE_LIMIT ?? "60", "rest"));
}
