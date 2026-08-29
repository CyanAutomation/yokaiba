import { createRestRouter } from "../src/api/router.js";
import { createYokaibaMcpHandler } from "../src/mcp/server.js";
import { tournamentOrderTemplate } from "../src/templates/tournament-order.js";
import { hostHeaderValidationResponse } from "@modelcontextprotocol/server";

interface Env {
  MCP_API_KEY?: string;
  /** Required comma-separated hostnames, e.g. yokaiba.example.com,yokaiba.workers.dev. */
  MCP_ALLOWED_HOSTNAMES?: string;
}

const templates = [tournamentOrderTemplate];
const rest = createRestRouter(templates);
const mcp = createYokaibaMcpHandler(templates);

function json(value: unknown, status: number) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

function authorized(request: Request, key: string | undefined) {
  if (!key) return false;
  const candidate = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? request.headers.get("x-api-key");
  return candidate !== undefined && key.length === candidate.length && crypto.subtle.timingSafeEqual(new TextEncoder().encode(key), new TextEncoder().encode(candidate));
}

function allowedOrigin(request: Request, hostnames: string[]) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return hostnames.includes(new URL(origin).hostname); } catch { return false; }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path !== "/mcp") return rest(request);
    if (!env.MCP_API_KEY || !env.MCP_ALLOWED_HOSTNAMES) return json({ error: { code: "not_configured", message: "MCP credentials and allowed hosts are required" } }, 503);
    if (!authorized(request, env.MCP_API_KEY)) return json({ error: { code: "unauthorized", message: "A valid API key is required" } }, 401);
    const hostnames = env.MCP_ALLOWED_HOSTNAMES.split(",").map(value => value.trim()).filter(Boolean);
    const rejectedHost = hostHeaderValidationResponse(request, hostnames);
    if (rejectedHost) return rejectedHost;
    if (!allowedOrigin(request, hostnames)) return json({ error: { code: "forbidden", message: "Origin is not allowed" } }, 403);
    return mcp.fetch(request);
  },
} satisfies ExportedHandler<Env>;
