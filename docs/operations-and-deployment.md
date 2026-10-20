# Operations and deployment

## Browser CORS and abuse controls

REST does not enable CORS until explicitly configured. Set `REST_ALLOWED_ORIGINS` to a comma-separated list of exact browser origins; include each Vercel production and preview origin that should call the API. Do not use `*`.

```sh
npx wrangler secret put REST_ALLOWED_ORIGINS
npx wrangler secret put PUZZLE_TOKEN_SECRET
# Optional rotation grace: JSON array of previous signing keys, e.g. ["previous-key"]
npx wrangler secret put PUZZLE_TOKEN_PREVIOUS_SECRETS
# Optional token lifetime in seconds (default 604800; maximum 2592000)
npx wrangler secret put PUZZLE_TOKEN_TTL_SECONDS
# Example value: https://game.example,https://my-game.vercel.app
```

For key rotation, set a new `PUZZLE_TOKEN_SECRET` and include the former key(s) in `PUZZLE_TOKEN_PREVIOUS_SECRETS` as a JSON array. Remove previous keys after the longest token lifetime (at most 30 days). Tokens issued before expiry support was added have no expiry claim; they remain valid only while their signing key is configured.

Allowed origins receive `GET, POST, OPTIONS` CORS headers, including `Access-Control-Max-Age: 86400` (24-hour preflight cache). Public GET responses also provide an ETag and return `304 Not Modified` for a matching `If-None-Match` request.

The Worker uses a best-effort per-isolate REST rate limit (60 requests/minute by default; configure `REST_RATE_LIMIT`) when no provider binding is available. Puzzle generation has a separate 10 requests/minute limit (`REST_GENERATE_RATE_LIMIT` / `REST_GENERATE_RATE_LIMITER`) because it can perform multiple solver searches. Answer verification, puzzle hints, and feedback use the dedicated `VERIFY_RATE_LIMITER` provider, with local fallback defaults of 10 requests/minute via `VERIFY_RATE_LIMIT`, `HINT_RATE_LIMIT`, and `FEEDBACK_RATE_LIMIT`. Feedback has its own path-specific counter and never stores the rate-limiting IP. REST responses publish `RateLimit-Limit` and `RateLimit-Policy`. When the Worker applies the local fallback, it also publishes `RateLimit-Remaining` and Unix-second `RateLimit-Reset`; the Cloudflare binding reports only allow/deny, so those two quota fields are absent while it is enforcing requests. Rate-limited responses always publish `RateLimit-Remaining: 0` and `Retry-After`. Allowed browser origins can send `If-None-Match` and read ETag, request ID, and rate-limit headers. Each Worker isolate also keeps a bounded, five-minute LRU response cache for deterministic GET generation as a second layer behind edge caching; verification and POST generation are never retained there.

### Local response cache policy

The generated-puzzle response cache retains at most 128 entries and 16 MiB of response bodies. It evicts least-recently-used entries to stay within those bounds, expires entries after five minutes, and returns an individually oversized response without retaining it. Cache keys use a digest namespace for the puzzle-token signing secret, never the secret itself. The per-isolate namespace digest memoization is bounded to 10 LRU entries and does not retain failed digest attempts, so a later request can retry.

For production, configure the Cloudflare Rate Limiting bindings in `wrangler.toml`: `REST_RATE_LIMITER` for general REST traffic, `REST_GENERATE_RATE_LIMITER` for puzzle generation, `VERIFY_RATE_LIMITER` for answer verification, hints and feedback, and the four MCP bindings described below. Their namespaces must remain distinct because their limits differ. The `PUZZLE_OUTCOMES` Analytics Engine binding is also declared there and writes to `yokaiba_puzzle_outcomes`; confirm the dataset is available to the account and review its retention/access settings before relying on it. `/readyz` reports every provider separately. A rate-limit binding exception logs `rate_limit_provider_failure` and changes the affected readiness field to `fallback`; an Analytics Engine write exception makes `outcomeTelemetryProvider` report `failing` for that Worker isolate and returns `503` for the event. Every rate-limit rejection logs `rate_limited`. The readiness status remains `ready` while an optional provider is disabled or falling back; inspect the provider fields when checking deployment configuration.

### Anonymous puzzle difficulty feedback

`POST /v1/feedback` stores player ratings in the `PUZZLE_FEEDBACK` D1 binding. It is independent of Analytics Engine outcome telemetry. Feedback requests need a current v4 signed puzzle token; the token carries a stable SHA-256 fingerprint of the complete generated clue configuration, template, seeds, assessed difficulty, generator/solver versions, model version, and generation strategy. The endpoint verifies that signature without regenerating the puzzle. Completion state and gameplay measurements are explicitly self-reported; the API does not verify that a puzzle was completed.

Create the database once, copy the ID printed by Wrangler into `wrangler.toml`, then apply the versioned migration:

```sh
npx wrangler d1 create yokaiba-puzzle-feedback
npx wrangler d1 migrations apply yokaiba-puzzle-feedback --remote
```

For local development, use Wrangler's local D1 emulator; the configured database ID does not make local commands write to production:

```sh
npx wrangler d1 migrations apply yokaiba-puzzle-feedback --local
npm run dev
```

The table stores the fingerprint, template and difficulty versions, generation metadata (including replay seeds), rating, optional fixed reason, self-reported outcome, hint/mistake/time measurements, smart-marking state, and server submission time. It does not store puzzle tokens, solutions, answer grids, IP addresses, names, or email addresses. D1 is the authoritative feedback store; Analytics Engine remains optional and is not used as a fallback.

Keep records for up to 12 months, then delete older submissions during routine maintenance:

```sh
npx wrangler d1 execute yokaiba-puzzle-feedback --remote --command="DELETE FROM puzzle_feedback WHERE datetime(submitted_at) < datetime('now', '-365 days')"
```

Example read-only queries for future calibration work:

```sql
-- Ratings by requested and assessed difficulty level
SELECT requested_level, assessed_level, rating, COUNT(*) AS responses
FROM puzzle_feedback GROUP BY requested_level, assessed_level, rating ORDER BY requested_level, rating;

-- Ratings by template
SELECT template_id, rating, COUNT(*) AS responses
FROM puzzle_feedback GROUP BY template_id, rating ORDER BY template_id, rating;

-- Ratings for an exact generated puzzle fingerprint
SELECT puzzle_fingerprint, rating, reason, outcome, submitted_at
FROM puzzle_feedback WHERE puzzle_fingerprint = 'REPLACE_WITH_FINGERPRINT' ORDER BY submitted_at;

-- Most frequent reasons selected for difficult puzzles
SELECT reason, COUNT(*) AS responses
FROM puzzle_feedback WHERE rating = 'too_hard' AND reason IS NOT NULL
GROUP BY reason ORDER BY responses DESC;

-- Feedback grouped by difficulty-model version
SELECT difficulty_model_version, rating, COUNT(*) AS responses
FROM puzzle_feedback GROUP BY difficulty_model_version, rating ORDER BY difficulty_model_version, rating;
```

## MCP and deployment

MCP serves `list_scenarios` and `generate_puzzle` at `/mcp`. When `PUZZLE_TOKEN_SECRET` is configured, it also serves `verify_puzzle_answer` and `get_puzzle_hint`. The endpoint uses Streamable HTTP and requires both `API_KEY` (or `MCP_API_KEYS`) and `MCP_ALLOWED_HOSTNAMES`; clients may authenticate with `Authorization: Bearer <key>` or `X-API-Key: <key>`. `tools/list` is the authoritative tool catalogue. Generation supports optional server-generated seeds, deterministic replay, targeted difficulty, and opt-in seed fallback. Hints return clues only; no tool returns a solution placement.

For a Streamable HTTP MCP client, use `https://yokaiba.scheimann.workers.dev/mcp` and send the configured key in the `Authorization` header:

```json
{
  "transport": "streamable-http",
  "url": "https://yokaiba.scheimann.workers.dev/mcp",
  "headers": { "Authorization": "Bearer YOUR_API_KEY" }
}
```

Set `MCP_ALLOWED_HOSTNAMES` to the service hostname used by the client. Connect with the MCP `initialize` handshake, then request `tools/list`; the returned schemas describe the available tools and arguments.

```sh
npx wrangler secret put API_KEY
# Optional: replaces API_KEY with a JSON map of client labels to distinct keys.
npx wrangler secret put MCP_API_KEYS
npx wrangler secret put MCP_ALLOWED_HOSTNAMES
npx wrangler secret put REST_ALLOWED_ORIGINS
npm run deploy
curl -fsS https://your-worker.workers.dev/healthz
```

`MCP_ALLOWED_HOSTNAMES` is a comma-separated hostname allowlist (for example `yokaiba.example.com,yokaiba.workers.dev`), not an origin list. Production MCP rate limiting has four layers: `MCP_PREAUTH_RATE_LIMITER` allows 10 requests per 10-second window per IP before authentication; `MCP_RATE_LIMITER` allows 30 requests per minute for the authenticated API-key fingerprint; `MCP_GENERATE_RATE_LIMITER` separately allows 10 `generate_puzzle` calls per minute; and `MCP_PUZZLE_ACTION_RATE_LIMITER` allows 10 verification or hint calls per minute, per tool. The fingerprint is SHA-256, so the API key is never supplied to the provider or logs. If a binding is unavailable, matching local fallbacks are used: `MCP_PREAUTH_RATE_LIMIT` (default 10), `MCP_RATE_LIMIT` (default 30), `MCP_GENERATE_RATE_LIMIT` (default 10), and `MCP_PUZZLE_ACTION_RATE_LIMIT` (default 10). `API_KEY` remains the simple single-key setup. For genuinely per-customer quotas, instead configure `MCP_API_KEYS` as a Worker secret holding a JSON object of client labels to distinct keys, for example `{"game":"key-1","partner":"key-2"}`; it replaces `API_KEY` when present.

The current key-based MCP authentication is intended for controlled clients. The Actions contract uses no authentication because its operations work with public puzzles and do not access account data. If a future ChatGPT app adds private user state or the chosen product requires sign-in, use the authorization flow supported by that integration rather than sharing the MCP service key. This project does not include a legacy plugin manifest or an OAuth server.

For GitHub deployment automation, configure a protected `production` environment containing `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, plus `CLOUDFLARE_DEPLOYMENT_URL` as a repository or environment variable containing the canonical HTTPS Worker origin (for example `https://yokaiba.example.workers.dev`). The variable must resolve to the `yokaiba` Worker deployed under that exact `CLOUDFLARE_ACCOUNT_ID`; a custom domain or route that targets another account or Worker will fail the deployment checks. After configuring the variable, verify its target from a shell where it is set:

```sh
curl -fsS "${CLOUDFLARE_DEPLOYMENT_URL%/}/healthz"
```

The response must identify the expected `serviceVersion` and full `buildSha`. Restrict the production environment to the `main` branch and require the appropriate reviewers. CI injects the package version and immutable Git SHA into the deployed Worker; `/healthz`, `/readyz`, and `/v1/version` expose them for support and cache diagnostics. The deploy workflow first verifies the machine-reported direct Worker endpoint as a control, then verifies the configured canonical endpoint's health, readiness, version metadata, public puzzle redaction, conditional GET caching, and deployed OpenAPI contract. Both endpoints must report a package version and Git SHA that exactly match the commit released by the workflow; if only the direct endpoint succeeds, check the canonical route and `CLOUDFLARE_DEPLOYMENT_URL` configuration.

The weekly Kaseki documentation sweep requires a stable HTTPS `KASEKI_BASE_URL` repository or organization variable and a `KASEKI_API_TOKEN` secret in a protected `kaseki-agent` environment. Restrict that environment to `main` and require appropriate reviewers. Both Kaseki sweeps run only from `main` and submit the literal `main` branch ref to Kaseki; their shared concurrency group prevents a manual run from overlapping the other sweep. The documentation sweep uses `README.md,docs/**/*.md` and `npm run docs:check && npm run typecheck && npm test && npm run build`; it runs weekly and can also be started manually from `main`. The DRY sweep can modify `src/`, `worker/`, `scripts/`, and `tests/`. GitHub Actions waits for Kaseki's terminal run status and fails when the agent fails or exceeds its three-hour budget.

### GitHub workflow policy

Both Kaseki workflows validate `KASEKI_BASE_URL` against the approved HTTPS controller origin, rejecting HTTP URLs and lookalike hosts. Their wait steps share a fixed 185-minute deadline, write completed and failed states to the workflow output, and fail if the controller never reports a terminal state. Kaseki validation commands must reference scripts declared in `package.json`. Pull requests and main-branch deployments call the same reusable validation workflow, so main pushes validate once before deployment; newer commits to a PR cancel its superseded validation run. External documentation links are checked weekly and on PRs that change `README.md` or Markdown under `docs/`, with transient curl errors retried twice. Dependabot checks GitHub Actions, npm dependencies, and the pinned actionlint Docker image weekly. Workflow jobs use explicitly versioned Ubuntu runner labels instead of `ubuntu-latest`, so runner-image changes are deliberate and reviewed. Repository rules should require the `Validate` check before merge, and protected `production` and `kaseki-agent` environments should be restricted to `main` with the intended reviewers.
