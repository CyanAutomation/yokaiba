import { createRestRouter } from "../src/api/router.js";
import { createYokaibaMcpHandler } from "../src/mcp/server.js";
import { tournamentOrderTemplate } from "../src/templates/tournament-order.js";
import { hostHeaderValidationResponse } from "@modelcontextprotocol/server";

interface Env {
  MCP_API_KEY?: string;
  /** Required comma-separated hostnames, e.g. yokaiba.example.com,yokaiba.workers.dev. */
  MCP_ALLOWED_HOSTNAMES?: string;
  /** Optional requests-per-minute override. Defaults to 30. */
  MCP_RATE_LIMIT?: string;
}

const templates = [tournamentOrderTemplate];
const rest = createRestRouter(templates);
const mcp = createYokaibaMcpHandler(templates);

function json(value: unknown, status: number) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

const encoder = new TextEncoder();

function constantTimeEqual(expected: string, candidate: string): boolean {
  const expectedBytes = encoder.encode(expected);
  const candidateBytes = encoder.encode(candidate);
  const length = Math.max(expectedBytes.length, candidateBytes.length);
  let difference = expectedBytes.length ^ candidateBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (expectedBytes[index] ?? 0) ^ (candidateBytes[index] ?? 0);
  }
  return difference === 0;
}

function authorized(request: Request, key: string | undefined) {
  if (!key) return false;
  const candidate = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? request.headers.get("x-api-key");
  return candidate !== null && constantTimeEqual(key, candidate);
}

const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 60_000;
const MAX_RATE_LIMIT_KEYS = 10_000;

function rateLimited(request: Request, rawLimit: string | undefined, now = Date.now()): boolean {
  const configured = Number(rawLimit ?? 30);
  const limit = Number.isSafeInteger(configured) && configured > 0 ? configured : 30;
  const key = request.headers.get("cf-connecting-ip") ?? "unknown";
  const current = rateLimits.get(key);
  if (!current || current.resetAt <= now) {
    if (rateLimits.size >= MAX_RATE_LIMIT_KEYS) {
      for (const [candidate, value] of rateLimits) {
        if (value.resetAt <= now) rateLimits.delete(candidate);
      }
      if (rateLimits.size >= MAX_RATE_LIMIT_KEYS) rateLimits.delete(rateLimits.keys().next().value as string);
    }
    rateLimits.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > limit;
}

function allowedOrigin(request: Request, hostnames: string[]) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return hostnames.includes(new URL(origin).hostname); } catch { return false; }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    let path: string;
    try {
      path = new URL(request.url).pathname;
    } catch {
      return json({ error: { code: "bad_request", message: "Invalid URL" } }, 400);
    }
    if (path !== "/mcp") return rest(request);
    if (rateLimited(request, env.MCP_RATE_LIMIT)) {
      return new Response(JSON.stringify({ error: { code: "rate_limited", message: "Too many requests" } }), {
        status: 429,
        headers: { "content-type": "application/json; charset=utf-8", "retry-after": "60" },
      });
    }
    if (!env.MCP_API_KEY || !env.MCP_ALLOWED_HOSTNAMES) return json({ error: { code: "not_configured", message: "MCP credentials and allowed hosts are required" } }, 503);
    if (!authorized(request, env.MCP_API_KEY)) return json({ error: { code: "unauthorized", message: "A valid API key is required" } }, 401);
    const hostnames = env.MCP_ALLOWED_HOSTNAMES.split(",").map(value => value.trim()).filter(Boolean);
    const rejectedHost = hostHeaderValidationResponse(request, hostnames);
    if (rejectedHost) return rejectedHost;
    if (!allowedOrigin(request, hostnames)) return json({ error: { code: "forbidden", message: "Origin is not allowed" } }, 403);
    return mcp.fetch(request);
  },
} satisfies ExportedHandler<Env>;
