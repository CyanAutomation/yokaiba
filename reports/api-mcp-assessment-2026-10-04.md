# Yokaiba API and MCP Assessment

**Assessment date:** 4 October 2026
**Scope:** Review of the REST router, Cloudflare Worker routing and middleware, MCP server, OpenAPI contracts, README, and relevant tests. No production endpoint was probed. This report records the baseline review and same-day implementation follow-up.

## Executive assessment

Yokaiba has a solid API foundation for deterministic puzzle generation and browser gameplay. REST and MCP share generation and puzzle-action logic, public puzzle responses omit the solution, and the Worker has request limits, conditional GET support, anonymous event ingestion, and build metadata. MCP has structured input/output schemas and protocol tests. The core endpoint set is coherent; no endpoint needs removal.

The implementation follow-up fixed the baseline issues found in this review: browser CORS now supports conditional GETs, hints no longer reveal placements, REST generation has a separate quota, known paths return `405` for unsupported methods, and generation failures use a stable server error. Puzzle tokens now expire and support key rotation. Both REST contracts have unique operation IDs; a compact ChatGPT Actions OpenAPI document is published and linked from the docs.

For ChatGPT integration, the Actions contract is ready for an initial public-puzzle integration. The MCP endpoint remains key-protected for controlled clients. Neither surface has user accounts or private player data, so the Actions contract is intentionally unauthenticated; any future account-linked app still needs a product-specific supported authorization flow.

## Endpoint-by-endpoint review

### Worker, documentation, and operational routes

| Endpoint | Assessment |
|---|---|
| `GET /` and `HEAD /` | Keep. Redirects to `/docs`; `HEAD` is handled deliberately and the redirect is non-cacheable. |
| `GET /healthz` and `HEAD /healthz` | Keep. Small liveness response with service version and build SHA. It correctly avoids probing optional integrations. |
| `GET /readyz` and `HEAD /readyz` | Keep. Useful provider-configuration diagnostics. The top-level status remains `ready` when optional rate-limit or telemetry providers are disabled or falling back, so deployment checks should inspect the individual provider fields too. |
| `GET /docs`, `/docs/`, and corresponding `HEAD` requests | Keep. Swagger UI is self-hosted, with a restrictive CSP and no runtime CDN dependency. The page links to MCP setup, its endpoint, and both REST contracts. |
| `GET /openapi/v1.yaml` and `HEAD /openapi/v1.yaml` | Keep. The REST contract is published with unique operation IDs; tests check endpoint coverage and references. The Action-focused contract is published separately. |
| `/swagger-ui/*` assets | Keep as deployment assets. They are served by the Cloudflare assets binding rather than being business API operations. |

### REST API

| Endpoint | Assessment |
|---|---|
| `GET /v1/scenarios` | Keep. Returns the complete board categories and metadata needed to render a scenario selector. ETag and five-minute caching are appropriate. |
| `GET /v1/capabilities` | Keep. Runtime feature flags, locale list, and per-scenario difficulty levels let clients adapt to token and telemetry configuration. Keep these flags synchronized with actual behavior. |
| `GET /v1/version` | Keep. Adds generator and solver versions to deployment metadata, which is useful for replay and support. `no-cache` plus ETag is suitable for deployment changes. |
| `GET /v1/puzzles/generate` | Keep. Its deterministic query contract makes it cacheable and supports conditional requests. Seeds appear in URLs and responses, so clients should use opaque, non-personal values. |
| `POST /v1/puzzles/generate` | Keep. It avoids query-string inputs and is useful for generated-action clients. It shares validation and generation policy with GET, while correctly avoiding the GET cache. |
| `POST /v1/puzzles/verify` | Keep. Strictly validates complete permutations and returns only `{ correct }`. The token is tamper-evident, not encrypted; its readable payload contains the seed. New tokens expire, and verification accepts configured prior signing keys during rotation. |
| `POST /v1/puzzles/hint` | Keep. It returns a public clue or elimination clue. Placement hints were removed because a caller could enumerate them to reconstruct every answer cell. `hintIndex` selects a public clue deterministically; it does not track solving progress. |
| `POST /v1/events` | Keep for calibration if the Analytics Engine sink is configured. It allowlists anonymous fields, drops unknown identifiers, and returns `202` only after the sink accepts the write. Without a sink it returns `503`. Events remain client-reported and can be fabricated; do not treat raw submissions as trusted player research or automatically recalibrate from them. |
| REST `OPTIONS` preflight | Keep. Exact-origin allowlisting is a good default. It now accepts `If-None-Match` and exposes ETag, request ID, and rate-limit headers to allowed browser clients. |

### MCP endpoint and tools

`/mcp` is a Streamable HTTP MCP endpoint. It requires configured API key(s) and `MCP_ALLOWED_HOSTNAMES`; it accepts Bearer or `X-API-Key` credentials, checks host/origin, and applies pre-auth, per-key, generation, and puzzle-action quotas. This is a reasonable controlled-client model. Per-client API keys allow separate quota identities without logging raw credentials.

| MCP tool | Availability and assessment |
|---|---|
| `list_scenarios` | Always available. Low-risk discovery; descriptions direct clients to use scenario IDs with generation. |
| `generate_puzzle` | Always available. Seed is optional and server-generated when omitted; explicit seeds and difficulty/fallback controls support deterministic replay. Output schema is declared and the solution is removed. |
| `verify_puzzle_answer` | Registered only when `PUZZLE_TOKEN_SECRET` is configured. Returns only whole-answer correctness and uses the shared token/action implementation. |
| `get_puzzle_hint` | Registered only when `PUZZLE_TOKEN_SECRET` is configured. Structured and bounded; it returns a public clue and never a solution placement. |

The MCP handler uses the deployed service version and declares output schemas. MCP tests cover initialization, tool discovery, generated-puzzle parity for a representative template, solution redaction, verification, and spoiler-safe clue hints. Expand parity coverage across templates and targeted/fallback modes as the generation contract evolves.

## Findings and prioritized improvements

### [Resolved, P2] Cross-origin clients could not use conditional GET as documented

**Baseline issue:** The Worker advertised only `content-type` in `Access-Control-Allow-Headers` and rejected other requested preflight headers. A cross-origin browser request setting `If-None-Match` failed preflight, and browser JavaScript could not read ETag, request ID, or rate-limit headers.

**Improve:** allow `if-none-match` in REST preflight and expose the response headers browser clients need, at minimum `ETag` and `X-Request-Id` (plus rate-limit and retry headers if clients should act on them). Add a cross-origin conditional-GET test that verifies both preflight and header visibility policy.

**Implemented:** preflight now accepts `If-None-Match`; CORS exposes ETag, request ID, rate-limit fields, and `Retry-After`. Worker integration tests cover the preflight and response visibility.

### [Resolved, P2] Placement hints allowed a caller to enumerate the answer

**Baseline issue:** `placementHint` mapped `hintIndex` modulo the number of board cells and returned the correct category value for that cell. A client could enumerate enough indexes to recover a full solution.

**Improve:** decide whether full reveal through repeated hints is intentional. If hints must preserve spoilers, store monotonic hint progress per puzzle/session or require a signed progression cursor that cannot be reset by choosing an earlier index. Alternatively, remove placement hints and retain clue/elimination hints. Document the chosen promise clearly; do not describe the solution as inaccessible if exhaustive hints are allowed.

**Implemented:** removed placement hints from REST and MCP. Both interfaces now return only public clues, and their schemas and docs state that no solution placement is returned. This keeps the API stateless; it does not claim to track a player's deduction progress.

### [Resolved, P2] REST generation shared the general REST quota

**Baseline issue:** REST generation used the general REST limit even though it can perform multiple solver strategies and optional bounded seed fallback. MCP already had a separate generation quota.

**Improve:** add a distinct REST generation limit/provider or otherwise tune quotas based on worst-case generation cost and observed traffic. Preserve a local fallback and report its state through readiness.

**Implemented:** added a dedicated `REST_GENERATE_RATE_LIMITER` binding and local 10/minute fallback. `/readyz` reports `generateRateLimitProvider`, and production smoke checks require that provider to be configured.

### [Resolved, P3] Unsupported methods on known REST routes returned 404

**Baseline issue:** the REST router returned `404 route not found` for both unknown paths and known paths with unsupported methods, while static routes returned `405` with `Allow`.

**Improve:** distinguish known paths from unknown ones and return `405 Method Not Allowed` with an `Allow` header for known routes. Document that behavior in OpenAPI. If this is intentionally kept as 404, make it a deliberate service-wide convention.

**Implemented:** known REST paths now return `405`, a stable `method_not_allowed` code, and an `Allow` header; unknown paths continue to return `404`. The OpenAPI tests enumerate the route methods and statuses.

## ChatGPT compatibility direction

The initial GPT Actions surface is implemented at `/openapi/chatgpt-actions-v1.yaml`. It exposes scenario discovery, POST generation, verification, and clue hints; generation can omit `seed`, responses include the generated replay seed, telemetry ingestion is excluded, and operation IDs are unique. The Actions operations are unauthenticated because they access public puzzles and no account data. Keep the MCP API key on `/mcp` for controlled clients. Avoid adding a legacy plugin manifest unless the selected product explicitly requires it.

If a future ChatGPT app adds private player state or requires sign-in, add the authorization flow supported by that integration rather than sharing the MCP service key. Validate the OpenAPI document against the target product's current import and auth requirements when registering the Action.

## Additional improvement opportunities

- **Implemented:** new puzzle tokens expire after seven days by default (maximum 30 days), and verification accepts configured previous signing keys during rotation grace. Legacy v2 tokens remain valid only while their key is configured.
- Generate OpenAPI and MCP schemas from shared contract definitions where practical, or add representative runtime-schema checks. Existing OpenAPI tests verify paths, response statuses, references, and selected schema fields, but do not validate every runtime payload against the contract.
- **Partly implemented:** known-path method errors are now consistent and generation failures have the same stable `generation_failed` code across REST/MCP. Broader contract-driven error mapping remains a follow-up; invalid input, unsupported puzzle versions, missing configuration, and unavailable difficulty have transport-specific status/protocol details.
- **Implemented:** `/docs` links the MCP setup guide, `/mcp`, and both OpenAPI documents. MCP tools remain discovered through the MCP protocol.
- Keep outcome telemetry privacy-preserving, and analyze it with deduplication/outlier handling before using it to update difficulty calibration.

## Main implementation references

- REST routes and contracts: [`src/api/router.ts`](../src/api/router.ts), [`src/api/generation-query.ts`](../src/api/generation-query.ts)
- Puzzle actions and tokens: [`src/api/puzzle-actions.ts`](../src/api/puzzle-actions.ts), [`src/api/puzzle-token.ts`](../src/api/puzzle-token.ts)
- MCP tools: [`src/mcp/server.ts`](../src/mcp/server.ts)
- Worker routing, CORS, auth, and quotas: [`worker/index.ts`](../worker/index.ts)
- OpenAPI contract and client guidance: [`public/openapi/v1.yaml`](../public/openapi/v1.yaml), [`README.md`](../README.md)
- Existing endpoint/protocol coverage: [`tests/rest-api.test.ts`](../tests/rest-api.test.ts), [`tests/mcp.test.ts`](../tests/mcp.test.ts), [`tests/worker.integration.test.ts`](../tests/worker.integration.test.ts)
