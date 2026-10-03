# Yokaiba API and MCP Assessment

**Assessment date:** 3 October 2026
**Scope:** Source review of the REST router, Worker routes and middleware, MCP handler, OpenAPI document, README, and relevant tests. This is not a live-production probe; tests were not run.

## Implementation follow-up

The changes prompted by this assessment were implemented after resetting the Yokaiba checkout to the fetched `main` revision. The baseline statement above records the original review; the implementation has its own test and build results, recorded in the completion summary shared with the user.

- No public route was removed. Tako-Bako uses the outcome proxy and hint/verification flow, while GET and POST generation serve distinct cache and request-body needs.
- REST and MCP now share progressive and targeted generation; MCP can generate with optional server-side seeds, issue tokens, verify answers, and return indexed hints. Protected tools are available only when `PUZZLE_TOKEN_SECRET` is configured.
- Generation input validation and OpenAPI behavior are aligned; static routes constrain methods and handle `HEAD`; MCP tool outputs declare schemas and use the deployed service version.
- Outcome events now write only allowlisted anonymous fields to the `PUZZLE_OUTCOMES` Analytics Engine binding. The event contract stores unversioned legacy submissions as version 0; version 1 requires the event-specific hint/mistake counters and elapsed time for completion/abandonment. Unknown versions are rejected, ingestion failures are reported, and there is no public event query API.
- Tako-Bako now forwards cumulative hint progress as `hintIndex`, includes its mistake count and event schema version in outcome payloads, and keeps the event proxy's allowlist behavior.
- OAuth/delegated account linking and token expiry/rotation remain future integration decisions. They are not required for controlled API-key MCP access and need a concrete ChatGPT product target plus a compatibility plan for existing signed tokens. Legacy event version 0 remains accepted to preserve existing clients; new clients use the stricter version 1 payload contract.

Verification completed: Yokaiba `npm test` (164 passed), `npm run typecheck`, and `npm run build`; Tako-Bako `npm run check` (lint, 214 tests, and production build); Wrangler `deploy --dry-run`; and `git diff --check` in both repositories. No production deployment was run.

## Executive summary

Yokaiba has a strong REST foundation for a browser puzzle game: deterministic generation, a scenario catalogue, capability discovery, conditional caching, signed tokens for answer checking, rate limits, and an OpenAPI 3.1 document. The main gaps are at the REST/MCP boundary and in contract fidelity.

The current MCP service is a useful first step, but exposes only `list_scenarios` and `generate_puzzle`. It cannot check an answer or provide a hint, requires callers to invent a seed, and its default generation path bypasses the REST API's progressive-generation wrapper. It also has no declared output schemas or MCP-level protocol tests in the reviewed test suite.

**Recommendation:** keep the core REST endpoints and `/mcp`; update contracts and behavior before promoting this as a general developer API. There is no endpoint that clearly needs unconditional removal. `POST /v1/events` is the exception: remove or disable it if its log-only output is not being collected and used; otherwise give it a documented, privacy-conscious ingestion destination before relying on it for calibration.

For the future ChatGPT target, build around the current MCP tool interface for a ChatGPT app, while retaining OpenAPI as a path for REST clients and GPT Actions where supported. Treat “ChatGPT plugin” as a product goal to validate against the integration requirements at implementation time: the existing static API-key setup is suitable for controlled clients, but is not a complete user-facing authorization/onboarding story.

## Endpoint-by-endpoint review

### Worker and documentation routes

| Endpoint | Decision | Assessment |
|---|---|---|
| `GET /` | Keep | Convenient redirect to `/docs`. Document the redirect and restrict it to `GET`/`HEAD`; the current static dispatcher does not check methods. |
| `GET /healthz` | Keep | Small liveness response with build identity. Good for deployment probes. Restrict methods and keep this independent of optional integrations. |
| `GET /readyz` | Keep, update contract | Useful diagnostic of rate-limit provider state. The response currently reports five providers, while the OpenAPI `Readiness` schema only declares the REST and verification providers. Its `ready` status also remains `ready` when a provider is falling back, so document that this describes service availability/configuration rather than strict production readiness. |
| `GET /docs` | Keep | Bundled Swagger UI is useful and avoids a runtime CDN dependency. It currently documents the REST contract only; add a clear MCP link/section so the two interfaces are discoverable together. |
| `GET /openapi/v1.yaml` | Keep, update | Important for clients and a possible GPT Actions integration. Fix the schema drift described below. Keep MCP protocol discovery separate; MCP tools are not REST paths and need tool docs or protocol discovery rather than being forced into this OpenAPI file. |

### REST API

| Endpoint | Decision | Assessment |
|---|---|---|
| `GET /v1/scenarios` | Keep | Good client bootstrap: returns full board categories and metadata, with ETag and five-minute caching. This is also the data source for MCP scenario listing. No separate per-scenario endpoint is needed yet. |
| `GET /v1/capabilities` | Keep | Good startup negotiation for feature flags and scenario difficulty ranges. Token-dependent verification/hint flags are useful. Keep the feature list tied to runtime behavior when new features are added. |
| `GET /v1/version` | Keep | Useful support/replay information: service, generator, and solver versions. It overlaps partly with health/readiness build data, but adds generator/solver identity and should remain. |
| `GET /v1/puzzles/generate` | Keep | Best fit for cacheable browser generation; supports ETags and deterministic inputs. Keep seeds opaque and non-personal because they appear in URLs and puzzle responses. |
| `POST /v1/puzzles/generate` | Keep | Not redundant with GET: it avoids putting inputs in URLs and works well for generated-action clients. It intentionally does not use the GET response cache. Keep both and keep their validation and error semantics aligned. |
| `POST /v1/puzzles/verify` | Keep | Useful server-side check without returning the answer. Signed tokens bind the request to reproducibility metadata. The `correct` result is appropriately minimal. Consider documenting token expiry/rotation policy; tokens currently have no expiry and depend on generator compatibility. |
| `POST /v1/puzzles/hint` | Keep, improve | Token-authorized and bounded, but the selected placement is always the same first cell and the clue/elimination responses do not model player progress. Add an explicit progression/cursor or client-provided revealed-state contract before presenting this as an adaptive hint service. Preserve spoiler control and rate limits. |
| `POST /v1/events` | Conditional remove or update | It validates anonymous outcome fields and returns `202`, but the implementation only writes a JSON event to `console.log`; there is no durable event store or aggregation endpoint. Remove/disable it if no log consumer and retention plan exist. If calibration depends on it, send to a defined durable sink, document retention/consent, add event-specific required fields and event/schema versioning, and make the response mean what the ingestion system guarantees. |

### MCP transport and tools

`/mcp` is the single Streamable HTTP MCP transport endpoint. Keep the transport and its pre-auth, authenticated, and generation-specific quotas. The current API-key and hostname allowlist model is appropriate for controlled partner access, but manual key distribution and rotation are friction for a user-facing ChatGPT integration. Plan an OAuth 2.1 option or a supported delegated authorization provider if the target integration requires user authorization. Continue to retain API keys for service-to-service clients if useful.

| MCP tool | Decision | Assessment |
|---|---|---|
| `list_scenarios` | Keep | Clear and low-risk discovery tool; reuses the REST catalogue shape. Add an output schema and make the description say that it returns scenario IDs suitable for `generate_puzzle`. |
| `generate_puzzle` | Keep, update | Correctly redacts the solution and returns both text and structured content. It requires a caller-supplied seed without a length cap, has no `allowSeedFallback` option, does not return a puzzle token, and has no paired MCP hint/verification operation. Its un-targeted path calls `generatePuzzle` directly; REST calls `generateProgressivePuzzle`. For several listed templates marked `requiresHumanSolve`, those paths can produce different results. Use the same generation policy as REST and test parity. Add bounded input validation and a declared output schema. |

## Remove, update, and add

### Remove or deprecate

- **No unconditional endpoint removals recommended.** The REST routes have distinct client or operational purposes; GET and POST generation serve different caching/privacy/client constraints.
- **Conditionally remove `POST /v1/events`:** retire it if the service will not collect and use the emitted logs. A public endpoint that returns `202` but has no owned ingestion and retention contract creates unclear expectations. Otherwise, keep it and build the ingestion path first.

### Update first

1. **Make REST and MCP generation semantics match.** Use the progressive generation path for MCP's default mode and preserve enough generation metadata for exact replay.
2. **Repair the published contract.** Add the three MCP provider fields to `Readiness`; add the emitted `generationStrategy` field to `GeneratedPuzzle`; decide whether unknown request properties/query parameters are rejected or ignored and make runtime behavior agree with OpenAPI. The JSON generation schema says `additionalProperties: false`, while the REST normalizer accepts known fields and silently ignores extras; the GET parser explicitly ignores unconsumed query parameters.
3. **Enforce HTTP methods on static Worker routes.** `/`, `/healthz`, `/readyz`, `/docs`, and `/openapi/v1.yaml` are currently selected by pathname without checking the method. Return `405` with `Allow` for unsupported methods (while handling `HEAD` intentionally).
4. **Specify MCP outputs, errors, and version.** Register output schemas for both tools, give invalid templates and unavailable difficulty stable structured errors, cap `templateId`/`seed` lengths consistently with REST, and cover `initialize`, `tools/list`, and `tools/call` in protocol-level tests. Source the MCP server version from build metadata; it is currently hard-coded to `0.1.0` while REST reports the injected build version.
5. **Make hint behavior state-aware.** Repeated requests should have an explicit, documented result: either the same hint is intentional or the API should accept progress and advance predictably.
6. **Align event acceptance with the actual data path.** Decide on persistence, aggregation, retention, and consent or disable the endpoint.

### Missing capabilities or interface pieces

- **MCP answer verification and hint tools.** These are present in REST but absent in MCP, so an MCP/ChatGPT client cannot complete the same puzzle flow. Add `verify_puzzle_answer` and `get_puzzle_hint` (names illustrative) only after MCP generation has a safe per-puzzle token/handle contract. Do not expose the solution as a shortcut.
- **A puzzle lifecycle handle for MCP.** REST returns `puzzleToken`; MCP strips no token because it never creates one. For stateless MCP, extend the signed-token approach and return a token with each generated puzzle, or use a small server-side puzzle store with expiry. Avoid making the model resend seeds as authorization.
- **Optional server-generated seed.** Make `seed` optional for the natural “give me a puzzle” workflow; generate a random seed server-side and return it with version metadata for replay. Keep explicit seeds available for deterministic clients.
- **MCP output schemas and a protocol quick-start.** Document the remote URL, transport, authentication options, required headers, tool descriptions, error behavior, and a connection example. MCP's built-in tool discovery remains authoritative; do not imitate it with REST routes.
- **An authorization onboarding path if required.** If the ChatGPT target requires per-user authorization, add an OAuth-backed flow and required discovery metadata through an identity provider or authorization service. Keep the current key path for trusted integrations unless it becomes unnecessary.

There is no current need for a separate scenario-detail endpoint, public solution endpoint, telemetry query endpoint, or locale-list endpoint. The catalogue/capabilities already cover public discovery, and solutions should remain hidden.

## ChatGPT compatibility direction

“Plugin” can mean different integration surfaces. The implementation should choose explicitly between:

1. **A ChatGPT app backed by MCP:** the existing `/mcp` Streamable HTTP endpoint and tool registration are the right architectural starting point. The highest-value work is tool completeness, stable structured inputs/outputs, user-friendly tool descriptions, authentication onboarding, and protocol tests.
2. **A GPT Action backed by OpenAPI:** the public REST API and `public/openapi/v1.yaml` are the starting point. Prioritize the OpenAPI drift and strict schemas, retain the JSON `POST /v1/puzzles/generate` action for generation, and expose only the operations a GPT needs. Verify supported OpenAPI and auth constraints when implementing the specific ChatGPT product surface.

Avoid building legacy plugin-manifest infrastructure unless a concrete target still supports and requires it. Keeping REST and MCP as first-class interfaces gives the project flexibility without coupling the core puzzle engine to either client.

## Improvement opportunities

- Generate OpenAPI schemas and MCP Zod schemas from shared types or contracts to reduce drift. Add a contract check that compares representative runtime responses to the declared schemas.
- Share a generation service function between REST and MCP so default, targeted, and fallback behavior cannot diverge.
- Add stable error codes and retry semantics across REST and MCP. Keep `422 difficulty_unavailable` actionable in both interfaces.
- Add token rotation/expiry design before treating tokens as long-lived user credentials. Current signed payloads are readable and include the seed; they are tamper-evident, not secret.
- Keep public gameplay operations minimal in any future ChatGPT Action/OpenAPI surface. Do not expose telemetry ingestion to a general assistant unless it has a clear product purpose and abuse controls.
- Add MCP integration tests that assert the solution is absent, structured content is valid, generation follows the same policy as REST, and verification/hint operations cannot reveal more than intended.

## Main implementation references

- REST routes and request behavior: [`src/api/router.ts`](../src/api/router.ts)
- REST parameter parsing: [`src/api/generation-query.ts`](../src/api/generation-query.ts)
- MCP tool definitions: [`src/mcp/server.ts`](../src/mcp/server.ts)
- Worker routing, auth, method dispatch, and limits: [`worker/index.ts`](../worker/index.ts)
- OpenAPI contract: [`public/openapi/v1.yaml`](../public/openapi/v1.yaml)
- Client/deployment documentation: [`README.md`](../README.md)
