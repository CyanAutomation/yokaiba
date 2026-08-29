# Yokaiba

Yokaiba generates reproducible judo-themed logic-grid (zebra) puzzles for REST and MCP consumers.

## Current MVP

The first vertical slice supplies a 4×4 tournament-order scenario, a portable TypeScript constraint solver, a deterministic generator, a REST API, and a Cloudflare Worker with an authenticated Streamable HTTP MCP endpoint.

Generation is deliberately conservative: it uses direct-assignment clues while the domain and solver already support negative, ordering, and adjacency constraints. The next content phase should add those richer clue candidates and template-specific prose.

## Quality rubric

Every generated puzzle is rejected unless it has exactly one solution. The generator then removes each clue in turn and retains no individually redundant clue; each published clue is necessary for uniqueness.

`evaluatePuzzleQuality` also reports clue-kind diversity, basic text readability checks, and a no-guess simulated-human trace. The initial human solver performs direct assignment and one-value-left elimination. It explicitly does not pretend to assess relational chains or case analysis yet; those belong in the next solver iteration.

## Local development

```sh
npm install
npm test
npm run typecheck
npm run dev
```

Generate a puzzle locally:

```sh
curl -X POST http://localhost:8787/v1/puzzles/generate \
  -H 'content-type: application/json' \
  -d '{"templateId":"tournament-order-v1","seed":"round-42"}'
```

## API

- `GET /v1/scenarios`
- `GET /v1/version`
- `POST /v1/puzzles/generate` with `templateId` and `seed`

The response never includes the hidden solution. The seed, template ID, generator version, and solver version reproduce the same puzzle.

## MCP and deployment

The MCP server exposes `list_scenarios` and `generate_puzzle` at `/mcp`. It uses Cloudflare's stateless Streamable HTTP handler and requires both `API_KEY` and `MCP_ALLOWED_HOSTNAMES` as Worker secrets before it will serve requests. `API_KEY` matches the Budokon Worker convention, and clients may supply it as `Authorization: Bearer <key>` or `X-API-Key: <key>`:

```sh
npx wrangler secret put API_KEY
npx wrangler secret put MCP_ALLOWED_HOSTNAMES
npm run deploy
```

Use a real comma-separated hostname allowlist for `MCP_ALLOWED_HOSTNAMES`; do not use a wildcard. REST is public in this initial read-only implementation, while MCP generation is protected because it is an agent-facing interface.
