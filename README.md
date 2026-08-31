# Yokaiba

Yokaiba creates deterministic, uniquely solvable judo logic-grid puzzles for games, REST clients, and MCP clients.

## What it provides

- A 4×4 tournament-order scenario, a 5×5 open-division scenario, and a portable TypeScript constraint solver.
- Deterministic generation: the same template ID, seed, generator version, and solver version reproduce the same puzzle.
- Minimal clue sets with direct, negative, ordering, and adjacency clues. The hidden solution is never returned over REST or MCP.
- Server-side browser-answer verification using signed puzzle tokens, plus a deterministic 1–5 difficulty assessment with published human-trace and solver-search evidence.
- A Cloudflare Worker with public REST and an API-key-protected Streamable HTTP MCP endpoint.

## Solver implementations

Generation and quality evaluation depend on the exported `PuzzleSolver` contract,
not directly on the exhaustive implementation. The built-in
`exhaustivePuzzleSolver` supports 2–5-row grids and is the default. Alternative
solvers must preserve clue semantics, solution-limit behaviour, deterministic
solution ordering, and expose a stable `version`; that version is recorded on
each generated puzzle so deterministic replay remains auditable.

For local solver profiling, `solveWithTelemetry(spec, clues, limit)` returns
the normal solutions together with visited permutation nodes, evaluated ready
constraints, and elapsed milliseconds. It is diagnostic-only; the default
`solve` and `countSolutions` APIs retain the same exhaustive-solver contract.

## Develop and verify

```sh
npm ci
npm test
npm run typecheck
npm run dev
```

`npm test` includes generator guarantees, REST request/response behavior, CORS, rate-limiting, health, and OpenAPI endpoint coverage.

## REST API

The complete contract is published at [`/openapi/v1.yaml`](https://yokaiba.scheimann.workers.dev/openapi/v1.yaml), with an interactive [Swagger UI](https://yokaiba.scheimann.workers.dev/docs). The repository source is [public/openapi/v1.yaml](public/openapi/v1.yaml). Public endpoints are:

- `GET /healthz`
- `GET /readyz`
- `GET /v1/scenarios`
- `GET /v1/version`
- `GET` or `POST /v1/puzzles/generate`
- `POST /v1/puzzles/verify`

For browser games, use the cacheable GET form. Deterministic responses are cached for five minutes and then revalidated, so a generator release cannot be held indefinitely by a stale browser or edge cache.

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

Generated puzzles include `difficulty` (`level` 1–5, label, model identifier, and deterministic evidence). Each template publishes its locale metadata and its own 1,000-seed calibration strategy. Difficulty combines the no-guess human trace with deterministic solver-search nodes and constraint checks; retain `modelVersion` and `evidence` when recording scores.

They also include a **signed** `puzzleToken` when `PUZZLE_TOKEN_SECRET` is configured. The token payload is base64url-encoded, readable reproducibility metadata (including the seed), followed by an HMAC signature. It protects against tampering; it does not encrypt the seed, hide the puzzle solution from a determined caller, or make public deterministic puzzles cheat-proof. Keep it with the puzzle in the browser and submit only the player’s completed non-base category assignments:

```js
const check = await fetch(`${baseUrl}/v1/puzzles/verify`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    puzzleToken: puzzle.puzzleToken,
    answer: {
      assignments: {
        weight: ["-73 kg", "-66 kg", "-81 kg", "-60 kg"],
        tatami: ["Tatami 2", "Tatami 4", "Tatami 3", "Tatami 1"],
        placing: ["3rd", "2nd", "1st", "4th"],
      },
    },
  }),
});
const { correct } = await check.json();
```

The answer must contain each non-base category exactly once, with every category value exactly once, in base-row order. Verification returns only `{ correct: boolean }`; it never reveals correct cells or the solution. It prevents a browser from declaring itself complete without the server, but it does not make a public deterministic puzzle cheat-proof. Leaderboards need user identity and server-side game/session persistence.

## Browser CORS and abuse controls

REST does not enable CORS until explicitly configured. Set `REST_ALLOWED_ORIGINS` to a comma-separated list of exact browser origins; include each Vercel production and preview origin that should call the API. Do not use `*`.

```sh
npx wrangler secret put REST_ALLOWED_ORIGINS
npx wrangler secret put PUZZLE_TOKEN_SECRET
# Example value: https://game.example,https://my-game.vercel.app
```

Allowed origins receive `GET, POST, OPTIONS` CORS headers. Public GET responses also provide an ETag and return `304 Not Modified` for a matching `If-None-Match` request.

The Worker uses a best-effort per-isolate REST rate limit (60 requests/minute by default; configure `REST_RATE_LIMIT`) when no provider binding is available. Answer verification has a tighter 10 requests/minute per-isolate limit (`VERIFY_RATE_LIMIT`). REST responses publish `RateLimit-Limit` and `RateLimit-Policy`; rate-limited responses additionally publish `RateLimit-Remaining: 0` and `Retry-After`.

For production, configure a Cloudflare Rate Limiting binding named `REST_RATE_LIMITER`; it is keyed by client IP and route and provides enforcement across isolates. `/readyz` reports whether that binding is configured for the active isolate. A binding exception logs the structured `rate_limit_provider_failure` event and switches readiness to `fallback`, so configure an alert for that event. Keep the in-memory fallback for local development and temporary binding failures.

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

For GitHub deployment automation, configure `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository secrets, plus `CLOUDFLARE_DEPLOYMENT_URL` as a repository variable containing the canonical Worker origin (for example `https://yokaiba.example.workers.dev`). CI injects the package version and immutable Git SHA into the deployed Worker; `/healthz`, `/readyz`, and `/v1/version` expose them for support and cache diagnostics. The deploy workflow verifies health, readiness, version metadata, public puzzle redaction, conditional GET caching, and a deployed OpenAPI contract check after each deployment.
