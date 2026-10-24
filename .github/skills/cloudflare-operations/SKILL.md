---
name: cloudflare-operations
description: Use when changing Yokaiba's Cloudflare Worker configuration, bindings, secrets, D1 migrations, readiness checks, or deployment workflow.
---

# Cloudflare operations

Use this skill for worker configuration, production operations, and changes under worker/, wrangler.toml, migrations/, or the deployment workflow.

## Read the operating guide

Start with [Operations and deployment](../../../docs/operations-and-deployment.md) and [Local development](../../../docs/development.md). Inspect wrangler.toml and the relevant deployment or health script before changing bindings or release behavior.

## Keep local and production operations separate

- Use local Wrangler development and local D1 migrations for local work. Do not copy production credentials into .dev.vars or commit secrets.
- A migration with --remote and npm run deploy affect external production resources. Run them only when the user explicitly asks for that operation.
- Keep secrets in the documented Worker secret or protected GitHub environment. Do not print credentials while diagnosing configuration.
- Preserve distinct provider bindings for rate limits and telemetry. Check readiness provider fields; a top-level ready status does not mean every optional provider is enabled or healthy.
- Keep the deployment checks for build version and SHA, direct Worker health, canonical URL health, public response redaction, cache behavior, and deployed API contract.

## Validate operational changes

Write focused tests for configuration parsing, readiness, binding failure, migration selection, or deployment probes before changing implementation. For local validation, use the repository's documented docs check, typecheck, and test commands when requested or required. Do not use a production deploy as a substitute for local validation.

For changes to REST or MCP authentication and public response shape, also follow the api-mcp-contracts skill.
