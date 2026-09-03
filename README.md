# Yokaiba

Yokaiba creates deterministic, uniquely solvable judo logic-grid puzzles for games, REST clients, and MCP clients.

## What it provides

- A 4×4 tournament-order scenario, a 5×5 open-division scenario, a denser 5×5 Championship Circuit scenario, and a portable TypeScript constraint solver.
- Deterministic generation: the same template ID, seed, generator version, and solver version reproduce the same puzzle.
- Minimal clue sets with direct, negative, ordering, adjacency, same-row, and exact-distance clues. The hidden solution is never returned over REST or MCP.
- Server-side browser-answer verification using signed puzzle tokens, plus a deterministic 1–12 difficulty assessment with published human-trace and solver-search evidence.
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

The API root redirects to the interactive [Swagger UI](https://yokaiba.scheimann.workers.dev/docs), and the complete contract is published at [`/openapi/v1.yaml`](https://yokaiba.scheimann.workers.dev/openapi/v1.yaml). The repository source is [public/openapi/v1.yaml](public/openapi/v1.yaml). Swagger UI is bundled from the pinned `swagger-ui-dist` development dependency and served from this Worker, so the documentation page has no runtime CDN dependency. Run `npm run vendor:swagger-ui` after updating that dependency.

- `GET /healthz`
- `GET /readyz`
- `GET /v1/scenarios`
- `GET /v1/version`
- `GET` or `POST /v1/puzzles/generate`
- `POST /v1/puzzles/verify`

### 60-second browser quick start

1. Fetch `/v1/scenarios` and use its categories to build the empty game grid.
2. Generate a deterministic puzzle with a template ID and a player/session seed.
3. Render `clues` and retain the returned `puzzleToken` with the in-progress game.
4. When the board is complete, send the non-base assignments and token to `/v1/puzzles/verify`.

```js
const baseUrl = "https://yokaiba.scheimann.workers.dev";
const scenarios = await fetch(`${baseUrl}/v1/scenarios`).then(response => response.json());
const templateId = scenarios.scenarios[0].id;
const seed = crypto.randomUUID();
const puzzle = await fetch(`${baseUrl}/v1/puzzles/generate?${new URLSearchParams({ templateId, seed })}`)
  .then(response => response.json());

// Render puzzle.spec.categories as the board and puzzle.clues as the clue list.
// Keep puzzle.puzzleToken; submit it with completed assignments to /v1/puzzles/verify.
```

`GET /v1/scenarios` includes each scenario's base category and complete board
categories, allowing clients to build their selection and game UI without first
generating a puzzle.

Template IDs are versioned public contracts. A correction that changes a
template's values or generated output receives a new template ID; clients must
store the template ID, seed, generator version, and solver version together for
replay. The currently supported five-row templates are `open-division-v2` and
`championship-circuit-v2`; both use the IJF sequence `-60 kg`, `-66 kg`,
`-73 kg`, `-81 kg`, `-90 kg`.

For browser games, use the cacheable GET form. Deterministic puzzles and the scenario catalogue are cached for five minutes and then revalidated, so a generator release cannot be held indefinitely by a stale browser or edge cache. `/v1/version` uses `Cache-Control: no-cache`, allowing clients to retain its ETag while always revalidating deployment metadata.

```js
const baseUrl = "https://yokaiba.scheimann.workers.dev";
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

Generated puzzles include `difficulty` (`level` 1–12, label, model identifier, and deterministic evidence). Tournament Order is calibrated to levels 1–4, Open Division to 5–8, and Championship Circuit to 9–12. Each template publishes its locale metadata and its own 1,000-seed calibration strategy. Difficulty combines the deduction trace, relational/cross-category clue structure, and deterministic solver telemetry; retain `modelVersion` and `evidence` when recording scores. The no-guess trace is an engineering diagnostic, not a substitute for player research.

When `difficultyLevel` is supplied, generation searches deterministic clue-order strategies for that exact seed. It never substitutes another seed: if no strategy reaches the requested band, the API returns `422` with `difficulty_unavailable`.

Clues retain their semantic constraint while their surface text is rendered from a deterministic English phrase catalogue. `phraseVariant` and `languageVersion` are returned with every clue, so the wording is reproducible and can be audited independently of puzzle logic.

### Difficulty audit and calibration

Run the deterministic corpus audit before a release or after changing templates, clue selection, or scoring:

```sh
npm run audit:difficulty -- 1000
```

The report includes per-level counts, clue-count range, and completion of the bounded no-guess trace for every template. Treat it as a regression gate, not evidence of player difficulty. For player validation, record anonymized `puzzle_started`, `puzzle_completed`, `hint_used`, `mistake`, and `puzzle_abandoned` events with `templateId`, `seed`, requested/assessed difficulty, generator version, solver version, difficulty model version, elapsed time, and clue count. Recalibrate template-specific thresholds on a held-out player sample, version the model, and retain historic metadata with every outcome.

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

The Worker uses a best-effort per-isolate REST rate limit (60 requests/minute by default; configure `REST_RATE_LIMIT`) when no provider binding is available. Answer verification has a separate tighter 10 requests/minute fallback (`VERIFY_RATE_LIMIT`). REST responses publish `RateLimit-Limit` and `RateLimit-Policy`. When the Worker applies the local fallback, it also publishes `RateLimit-Remaining` and Unix-second `RateLimit-Reset`; the Cloudflare binding reports only allow/deny, so those two quota fields are absent while it is enforcing requests. Rate-limited responses always publish `RateLimit-Remaining: 0` and `Retry-After`.

For production, configure both Cloudflare Rate Limiting bindings: `REST_RATE_LIMITER` for general REST traffic and `VERIFY_RATE_LIMITER` for answer verification. Each is keyed by client IP and route and provides enforcement across isolates; their namespaces must remain distinct because their limits differ. `/readyz` reports `rateLimitProvider` and `verifyRateLimitProvider` separately. A binding exception logs the structured `rate_limit_provider_failure` event and switches the affected readiness field to `fallback`, so configure an alert for that event. Keep the in-memory fallback for local development and temporary binding failures.

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
