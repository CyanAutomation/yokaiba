---
name: api-mcp-contracts
description: Use when changing Yokaiba's public REST API, MCP tools, OpenAPI contracts, puzzle tokens, or client-facing compatibility.
---

# REST and MCP contracts

Use this skill for changes to src/api, src/mcp, public/openapi, API documentation, or response and token behavior.

## Read the current contracts

- Read [REST API usage](../../../docs/api-usage.md) and [operations and deployment](../../../docs/operations-and-deployment.md).
- Review the relevant route, OpenAPI contract, and tests before editing. The complete REST contract and the ChatGPT Actions contract are maintained separately under public/openapi.
- The supported integration surfaces are REST and MCP. Do not present internal TypeScript modules as a stable published SDK.

## Preserve client safety and compatibility

- Template IDs and generated puzzle behavior are versioned. Follow the documented versioning rules when changing public output.
- Public generation, hints, and verification must not return a hidden solution or answer placement.
- Keep puzzle-token signing, expiry, key rotation, and fingerprint verification consistent across REST and MCP flows.
- Keep REST authentication, MCP authentication, host allowlists, and rate limits distinct; do not weaken them to make a test pass.
- Update the OpenAPI contracts, API usage docs, and relevant route/tool tests whenever a public schema or behavior changes.

## Test-first workflow

Add a failing route, token, or MCP contract test for behavior changes before implementing them. Then run the focused test. When broader validation is requested, use npm test, npm run typecheck, and npm run build. Tests such as tests/rest-api.test.ts, tests/mcp.test.ts, and tests/puzzle-token.test.ts cover common contract boundaries.

For changes to puzzle generation or solver behavior, also follow the puzzle-engine skill. For production bindings or release steps, follow the cloudflare-operations skill.
