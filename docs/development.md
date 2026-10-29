# Local development and contributions

## Prerequisites

- Node.js 24.x. The supported range is declared in `package.json`, and `.nvmrc` supplies the version used by CI and local version managers.
- npm, which is bundled with Node.js.

Install and start the local Cloudflare Worker:

```sh
npm ci
npm run dev
```

Wrangler normally serves the Worker at `http://localhost:8787`. The public REST routes can be tried without secrets:

```sh
curl -fsS 'http://localhost:8787/v1/scenarios'
curl -fsS 'http://localhost:8787/v1/puzzles/generate?templateId=tournament-order-v2&seed=local-example'
```

For browser calls, local REST CORS is disabled until `REST_ALLOWED_ORIGINS` is configured. Answer verification and hints need `PUZZLE_TOKEN_SECRET` so generated puzzles contain signed tokens. MCP requires an API key and `MCP_ALLOWED_HOSTNAMES`. See [operations and deployment](operations-and-deployment.md) for the complete configuration reference. Use a local `.dev.vars` file for local-only values; never put production credentials in source control.

If Wrangler cannot bind its default port, stop the process already using port 8787 or choose a different port with Wrangler's `--port` option. Missing optional secrets do not block the public REST generation quick start.

## Build and validation

Run the checks relevant to your change:

```sh
npm run docs:check
npm run typecheck
npm test
npm run build
```

`npm run docs:check` validates local Markdown links and heading anchors, checks referenced `npm run` scripts, and runs Markdown lint. `npm test` runs the Node test suite. The repository also provides `npm run audit:difficulty` and `npm run audit:difficulty:targeted` for deterministic generation audits; see [difficulty and calibration](difficulty-and-calibration.md) before interpreting their results.

The weekly external-link workflow checks the README's linked destinations with `npm run docs:links`. It also supports manual runs; external checks are kept separate from pull-request validation because third-party sites can be temporarily unavailable.

## Architecture

- `worker/main.ts` is the Cloudflare Worker entry point. It keeps the default gateway uncached and exports a dedicated `CachedPublic` entrypoint for reusable public GET responses. `worker/index.ts` contains routing, rate limiting, local generation caching, and response handling.
- `src/api/` contains REST routing and request handlers. `src/mcp/` registers the Streamable HTTP MCP tools.
- `src/generation/` builds deterministic puzzles and difficulty evidence. `src/constraints/` and `src/domain/` provide the solver and puzzle model used by generation and answer actions.
- `public/openapi/` contains the REST contracts served through the Worker asset binding.

## Solver internals

Generation and quality evaluation depend on the internal `PuzzleSolver` contract. The built-in exhaustive solver supports grids with 2–5 rows. Any internal alternative must preserve clue semantics, solution-limit behavior, deterministic solution ordering, and a stable version; generated puzzles record the solver version for replay. These modules are not a published SDK API.

`solveWithTelemetry(spec, clues, limit)` supports local profiling and returns the normal solutions with visited permutation nodes, evaluated ready constraints, and elapsed milliseconds. Telemetry is diagnostic-only. Profiling tools and tests can provide a fourth `now` function when deterministic elapsed timing is required.

## Contributions and support

For larger changes, open a [GitHub issue](https://github.com/CyanAutomation/yokaiba/issues) to discuss the intended behavior before starting implementation. Pull requests should explain the change, include tests for behavior changes, update relevant documentation, and pass the validation commands above. Keep API and template changes compatible with the versioning rules documented in the [API usage guide](api-usage.md).

Use [GitHub Issues](https://github.com/CyanAutomation/yokaiba/issues) for bug reports and questions. See the repository [license](../LICENSE) for reuse and contribution terms.
