---
name: api-utcp-contracts
description: Use when changing Yokaiba's public REST API, UTCP manual, OpenAPI contracts, puzzle tokens, or client-facing compatibility.
---

# REST and UTCP contracts

Use this skill for changes to src/api, src/utcp, public/openapi, API documentation, or response and token behavior.

## Read the current contracts

- Read [REST API usage](../../../docs/api-usage.md) and [operations and deployment](../../../docs/operations-and-deployment.md).
- Review the relevant route, OpenAPI contract, and tests before editing. The complete REST contract and the ChatGPT Actions contract are maintained separately under public/openapi; UTCP discovery is published at `/utcp`.
- The supported integration surfaces are REST and UTCP. Do not present internal TypeScript modules as a stable published SDK.

## Preserve client safety and compatibility

- Template IDs and generated puzzle behavior are versioned. Follow the documented versioning rules when changing public output.
- Public generation, hints, and verification must not return a hidden solution or answer placement.
- Keep puzzle-token signing, expiry, key rotation, and fingerprint verification consistent across REST and UTCP-declared calls.
- UTCP tools call the same REST routes, so preserve route authentication requirements, host protections, CORS policy, and rate limits in that shared path.
- Keep `/v1/events` and `/v1/feedback` distinct. Events are versioned, anonymous, self-reported calibration telemetry written to Analytics Engine; feedback is idempotent player rating data stored in D1. Both derive puzzle identity from a verified v4 token, but neither proves that a player completed a puzzle. Follow the [feedback and telemetry lifecycle skill](../feedback-data-lifecycle/SKILL.md) for data-path changes.
- Update the OpenAPI contracts, API usage docs, and relevant route/tool tests whenever a public schema or behavior changes.

## Test-first workflow

Add a failing route, token, UTCP manual, or OpenAPI contract test for behavior changes before implementing them. Then run the focused test. When broader validation is requested, use npm test, npm run typecheck, and npm run build. Tests such as tests/rest-api.test.ts, tests/utcp.test.ts, and tests/puzzle-token.test.ts cover common contract boundaries.

For changes to puzzle generation or solver behavior, also follow the puzzle-engine skill. For production bindings or release steps, follow the cloudflare-operations skill.
