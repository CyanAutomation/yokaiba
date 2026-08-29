# Yokaiba

Yokaiba creates deterministic, uniquely solvable judo logic-grid puzzles for games, REST clients, and MCP clients.

## What it provides

- A 4×4 tournament-order scenario and a portable TypeScript constraint solver.
- Deterministic generation: the same template ID, seed, generator version, and solver version reproduce the same puzzle.
- Minimal clue sets with direct, negative, ordering, and adjacency clues. The hidden solution is never returned over REST or MCP.
- A Cloudflare Worker with public REST and an API-key-protected Streamable HTTP MCP endpoint.

## Develop and verify

```sh
npm ci
npm test
npm run typecheck
npm run dev
```

`npm test` includes generator guarantees, REST request/response behavior, CORS, rate-limiting, health, and OpenAPI endpoint coverage.

## REST API

The complete contract is [openapi/v1.yaml](openapi/v1.yaml). Public endpoints are:

- `GET /healthz`
- `GET /v1/scenarios`
- `GET /v1/version`
- `GET` or `POST /v1/puzzles/generate`

For browser games, use the cacheable GET form. Deterministic responses include `Cache-Control: public, max-age=3600, s-maxage=86400, immutable`.

```js
const baseUrl = "https://your-worker.workers.dev";
const params = new URLSearchParams({ templateId: "tournament-order-v1", seed: "round-42" });
const response = await fetch(`${baseUrl}/v1/puzzles/generate?${params}`);
if (!response.ok) throw new Error(`Puzzle request failed: ${response.status}`);
const puzzle = await response.json();
```

POST remains available for clients that cannot use query parameters:

```sh
curl -X POST http://localhost:8787/v1/puzzles/generate \
  -H 'content-type: application/json' \
  -d '{"templateId":"tournament-order-v1","seed":"round-42"}'
```

`templateId` and `seed` must be non-empty strings of at most 128 characters. Every response includes `X-Request-Id`, which is also included in Worker logs.

## Browser CORS and abuse controls

REST does not enable CORS until explicitly configured. Set `REST_ALLOWED_ORIGINS` to a comma-separated list of exact browser origins; include each Vercel production and preview origin that should call the API. Do not use `*`.

```sh
npx wrangler secret put REST_ALLOWED_ORIGINS
# Example value: https://game.example,https://my-game.vercel.app
```

Allowed origins receive `GET, POST, OPTIONS` CORS headers. Public GET responses also provide an ETag and return `304 Not Modified` for a matching `If-None-Match` request.

The Worker uses a best-effort per-isolate REST rate limit (60 requests/minute by default; configure `REST_RATE_LIMIT`) when no provider binding is available. For production, configure a Cloudflare Rate Limiting binding named `REST_RATE_LIMITER`; it is keyed by client IP and route and provides enforcement across isolates. Keep the in-memory fallback for local development and temporary binding failures.

## MCP and deployment

MCP serves `list_scenarios` and `generate_puzzle` at `/mcp`. It requires both `API_KEY` and `MCP_ALLOWED_HOSTNAMES`; clients may authenticate with `Authorization: Bearer <key>` or `X-API-Key: <key>`.

```sh
npx wrangler secret put API_KEY
npx wrangler secret put MCP_ALLOWED_HOSTNAMES
npx wrangler secret put REST_ALLOWED_ORIGINS
npm run deploy
curl -fsS https://your-worker.workers.dev/healthz
```

`MCP_ALLOWED_HOSTNAMES` is a comma-separated hostname allowlist (for example `yokaiba.example.com,yokaiba.workers.dev`), not an origin list. MCP is rate-limited to 30 requests/minute per isolate by default; configure `MCP_RATE_LIMIT` if needed.

For GitHub deployment automation, configure `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository secrets, plus `CLOUDFLARE_DEPLOYMENT_URL` as a repository variable containing the canonical Worker origin (for example `https://yokaiba.example.workers.dev`). The deploy workflow verifies health, version metadata, public puzzle redaction, and conditional GET caching after each deployment.
