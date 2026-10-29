# REST API usage and puzzle actions

## REST API

The API root redirects to the [API documentation page](https://yokaiba.scheimann.workers.dev/docs), and the complete contract is published at [`/openapi/v1.yaml`](https://yokaiba.scheimann.workers.dev/openapi/v1.yaml). A compact, ChatGPT Actions-oriented REST contract is also published at [`/openapi/chatgpt-actions-v1.yaml`](https://yokaiba.scheimann.workers.dev/openapi/chatgpt-actions-v1.yaml). The repository sources are [public/openapi/v1.yaml](../public/openapi/v1.yaml) and [public/openapi/chatgpt-actions-v1.yaml](../public/openapi/chatgpt-actions-v1.yaml). The `/docs` page is plain HTML and links to both machine-readable OpenAPI contracts.

- `GET /healthz`
- `GET /readyz`
- `GET /v1/scenarios`
- `GET /v1/capabilities`
- `GET /v1/version`
- `GET` or `POST /v1/puzzles/generate`
- `POST /v1/puzzles/verify`
- `POST /v1/puzzles/hint`
- `POST /v1/events`
- `POST /v1/feedback`

### 60-second browser quick start

1. Fetch `/v1/capabilities` to detect supported features, then `/v1/scenarios` to build the empty game grid.
2. Generate a deterministic puzzle with a template ID and a player/session seed.
3. Render `clues` and retain the returned `puzzleToken` with the in-progress game.
4. When the board is complete, send the non-base assignments and token to `/v1/puzzles/verify`.

```js
const baseUrl = "https://yokaiba.scheimann.workers.dev";
const capabilities = await fetch(`${baseUrl}/v1/capabilities`).then(response => response.json());
const scenarios = await fetch(`${baseUrl}/v1/scenarios`).then(response => response.json());
const templateId = scenarios.scenarios[0].id;
const seed = crypto.randomUUID();
const puzzle = await fetch(`${baseUrl}/v1/puzzles/generate?${new URLSearchParams({ templateId, seed })}`)
  .then(response => response.json());

// Render puzzle.spec.categories as the board and puzzle.clues as the clue list.
// Keep puzzle.puzzleToken; submit it with completed assignments to /v1/puzzles/verify.
```

For POST generation, `seed` is optional. When omitted, the Worker generates a random seed and returns it as both `requestedSeed` and `seed` for replay. GET generation continues to require a seed so the URL identifies a cacheable deterministic result.

`GET /v1/scenarios` includes each scenario's base category and complete board
categories, allowing clients to build their selection and game UI without first
generating a puzzle.

Template IDs are versioned public contracts. A correction that changes a
template's values or generated output receives a new template ID; clients must
store the template ID, seed, generator version, and solver version together for
replay. The currently supported five-row templates are `open-division-v2`,
`championship-bridge-v1`, and `championship-circuit-v2`; all use the IJF sequence `-60 kg`, `-66 kg`,
`-73 kg`, `-81 kg`, `-90 kg`. `championship-bridge-v1` overlaps levels 8–9 with a five-row, three-category board so players can practise the Championship Circuit's board shape before entering its expert range.

For browser games, use the cacheable GET form. Deterministic puzzle and scenario catalogue GET endpoints are cached by Workers Cache and return `Cache-Control: public, max-age=300, s-maxage=300, must-revalidate`. Tokenized puzzle responses shorten that window to end at least one second before the configured puzzle-token expiry; a token lifetime of one second disables response caching. Browsers and edge caches must revalidate once a response is stale. `/v1/version` uses `Cache-Control: no-cache`, allowing clients to retain its ETag while always revalidating deployment metadata. Health, readiness, and authenticated MCP responses use `no-store`.

```js
const baseUrl = "https://yokaiba.scheimann.workers.dev";
const params = new URLSearchParams({ templateId: "tournament-order-v2", seed: "round-42" });
const response = await fetch(`${baseUrl}/v1/puzzles/generate?${params}`);
if (!response.ok) throw new Error(`Puzzle request failed: ${response.status}`);
const puzzle = await response.json();
```

POST remains available for clients that cannot use query parameters:

```sh
curl -X POST http://localhost:8787/v1/puzzles/generate \
  -H 'content-type: application/json' \
  -d '{"templateId":"tournament-order-v2","seed":"round-42"}'
```

`templateId` and `seed` must be non-empty strings of at most 128 characters. Every response includes `X-Request-Id`, which is also included in Worker logs.

Generated puzzles include `difficulty` (`level` 1–12, label, model identifier, and deterministic evidence). Tournament Order is calibrated to levels 1–4, Open Division to 5–8, and Championship Circuit to 9–12. Each template publishes its locale metadata and its own 1,000-seed calibration strategy. Difficulty combines the deduction trace, relational/cross-category clue structure, and deterministic solver telemetry; retain `modelVersion` and `evidence` when recording scores. The no-guess trace is an engineering diagnostic, not a substitute for player research.

## Anonymous puzzle outcome telemetry

When `/v1/capabilities` reports `outcomeTelemetry: true`, send the current puzzle's `puzzleToken` with each event. The Worker verifies an unexpired v4 token and derives `templateId`, `assessedDifficultyLevel`, and any requested difficulty from its signed claims; supplied identity or difficulty fields must match. The token is available only when `PUZZLE_TOKEN_SECRET` is configured. `elapsedMs`, `hintsUsed`, `mistakes`, `clueCount`, and completion state remain client-reported. A token can be reused, so accepted telemetry is not proof that a person played or completed the puzzle.

```js
await fetch(`${baseUrl}/v1/events`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    schemaVersion: 1,
    event: "puzzle_completed",
    puzzleToken: puzzle.puzzleToken,
    elapsedMs: 120_000,
    hintsUsed: 1,
    mistakes: 0,
  }),
});
```

## Anonymous puzzle difficulty feedback

Puzzle applications can send a three-choice rating after solving or while a puzzle is in progress. Submit `too_easy`, `just_right`, or `too_hard`; only `too_hard` may include one of `difficult_to_start`, `confusing_clues`, `too_many_deductions`, `took_too_long`, or `other`. Include a UUID v4 `idempotencyKey` and retry the same payload with that key after a transient failure. A repeated matching key returns `200` without another insert; reusing it for changed feedback returns `409`.

```sh
curl -X POST https://yokaiba.scheimann.workers.dev/v1/feedback \
  -H 'content-type: application/json' \
  -d '{"puzzleToken":"SIGNED_TOKEN","rating":"too_hard","reason":"confusing_clues","outcome":"in_progress","hintsUsed":1,"mistakes":0,"smartMarkingEnabled":false,"idempotencyKey":"123e4567-e89b-42d3-a456-426614174000"}'
```

The API accepts only the signed puzzle token as puzzle identity. It derives the fingerprint, template, seeds, difficulty/model versions, and generation policy from the verified token. The `outcome` and gameplay measurements are self-reported, not proof of completion. Ratings are stored in D1 and are separate from `/v1/events` telemetry. Configure the `PUZZLE_FEEDBACK` D1 binding and apply `migrations/0001_puzzle_feedback.sql` before enabling submissions; see [operations and deployment](operations-and-deployment.md#anonymous-puzzle-difficulty-feedback).
