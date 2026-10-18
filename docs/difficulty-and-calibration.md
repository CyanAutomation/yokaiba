# Difficulty and calibration

## Logical, semantic, and observed difficulty

Yokaiba keeps three calibration signals separate:

- **Logical difficulty** is deterministic and authoritative for the existing 1–12 level contract. The solver owns solvability, uniqueness, correctness, hints, redundancy, deduction traces, and solver telemetry.
- **Semantic difficulty** is optional, probabilistic JEV review of human-facing clue language. The offline `npm run audit:jev` report records readability, ambiguity, linguistic complexity, relationship explicitness, the structured constraint, rendered wording, language/template metadata, seed, logical level/model version, requested/resolved JEV model, schema version, confidence, and usage where returned. JEV findings are review leads; they never change puzzle validity or generation.
- **Observed player difficulty** comes from real outcomes such as completion time, hints, mistakes, and abandonment. When the `PUZZLE_OUTCOMES` Analytics Engine binding is configured, `POST /v1/events` validates and writes anonymous events with an explicit schema version (legacy version 0 or current version 1). It discards unrecognized fields, including seeds and player identifiers, and has no public query endpoint. Review the game’s analytics disclosure and Cloudflare dataset retention/access settings before enabling collection. No production thresholds are automatically recalibrated; use aggregate cohort analysis and held-out player samples before changing calibration.

Clue-level semantic review batches its typed questions together and sends rendered text with the corresponding structured constraint, without puzzle solutions. Add `--puzzle-review` to `npm run audit:jev` for bounded clue-set questions about wording repetition, terminology consistency, phrasing variety, and language burden compared with deterministic logical difficulty. To review the same sampled puzzles from an existing JSON report without repeating deterministic generation or clue review, use `npm run audit:jev -- --puzzle-review-from reports/previous-audit.json`. The report keeps these profiles paired by template and seed; it does not collapse them into one score. For example, a high language-burden response alongside logical level 3 is calibration evidence, not a new difficulty level. JEV is never called by puzzle generation, solving, hinting, or answer verification. Provider failures are reported as unavailable semantic results and leave a resumable checkpoint.

JEV audit checkpoints are written before generation begins, after each distribution template, after each targeted difficulty level, and after each wording template. If a deterministic or semantic phase is interrupted, rerun with the same `--out` values and `--resume` to continue from completed units. Reports show both raw-generator and progressive-delivery difficulty distributions; targeted fallback use includes nearest-rank p50 and p95 attempts among seeds that required fallback.

The audit review thresholds are centralized provisional leads, not validated cutoffs or CI gates. Evaluate them against labelled examples before relying on them for release decisions. Use `OPENROUTER_API_KEY` only in the invoking environment; it is not read from project files or written into reports.

### Targeted seed fallback

When `difficultyLevel` is supplied, generation searches deterministic clue-order strategies for that exact seed. It never substitutes another seed by default: if no strategy reaches the requested band, the API returns `422` with `difficulty_unavailable` and `availableDifficultyLevels`. Set `allowSeedFallback=true` to opt into a bounded deterministic search of derived seeds; the response retains `requestedSeed`, returns the replayable selected `seed`, and includes `seedFallbackAttempt`. The fallback search tries the requested seed followed by at most the configured number of derived seeds. All targeted curriculum levels reject clue sets that the bounded no-guess model cannot complete.

For a production browser client, handle validation, unavailable-difficulty, rate-limit, and conditional-cache responses explicitly:

```js
async function getPuzzle({ templateId, seed, difficultyLevel, etag }) {
  const params = new URLSearchParams({ templateId, seed, ...(difficultyLevel ? { difficultyLevel: String(difficultyLevel) } : {}) });
  const response = await fetch(`${baseUrl}/v1/puzzles/generate?${params}`, { headers: etag ? { "If-None-Match": etag } : {} });
  if (response.status === 304) return { notModified: true, etag };
  if (response.status === 422) return { unavailable: await response.json() };
  if (response.status === 429) throw new Error(`Try again after ${response.headers.get("Retry-After") ?? "a moment"}.`);
  if (!response.ok) throw new Error(`Puzzle request failed: ${response.status} (${response.headers.get("X-Request-Id") ?? "no request ID"})`);
  return { puzzle: await response.json(), etag: response.headers.get("ETag") };
}
```

Clues retain their semantic constraint while their surface text is rendered from a deterministic English phrase catalogue. `phraseVariant` and `languageVersion` are returned with every clue, so the wording is reproducible and can be audited independently of puzzle logic.

## Clue wording compatibility

Generated clue text must describe the tournament domain rather than the renderer's implementation. The legacy phrases `associated with`, `entry associated`, and `was not the competitor to` are prohibited compatibility regressions: clients and editorial checks may rely on generated clues never containing them. New catalogue variants should preserve that rule while keeping every referenced value visible and using the named competitor as the grammatical subject of direct and negative clues.

## Difficulty audit and calibration

Run the deterministic corpus audit before a release or after changing templates, clue selection, or scoring:

```sh
npm run audit:difficulty -- 1000
npm run audit:difficulty:targeted -- 1000
```

The distribution report includes per-level counts, clue-count range, and completion of the bounded no-guess trace for every template. The targeted report exercises every advertised level through the same deterministic fallback path used by the course, reporting fallback use and no-guess completion per level. Treat both as regression gates, not evidence of player difficulty. For player validation, send anonymized `puzzle_started`, `puzzle_completed`, `hint_used`, `mistake`, and `puzzle_abandoned` outcomes to `POST /v1/events` with `schemaVersion: 1`, template, difficulty, clue-count, hint/mistake totals, elapsed time, and optional `smartMarkingEnabled`. The version field is optional for older clients; omitted versions are stored as legacy version 0. Version 1 requires `hintsUsed` and `mistakes` on every event, plus `elapsedMs` for completions and abandonment. Never send a seed, player identifier, or answer cells. Segment calibration by smart-marking use: it is an advanced-player efficiency feature, not a hint or assist. Recalibrate template-specific thresholds on a held-out player sample, version the model, and retain historic metadata with every outcome.

A standalone targeted audit also accepts a template without `difficultyCalibration` metadata. For those templates, the audit accepts requested levels 1–12; pass `sampleSize` explicitly when you want a smaller run.

They also include a **signed** `puzzleToken` when `PUZZLE_TOKEN_SECRET` is configured. New tokens expire after seven days by default; `PUZZLE_TOKEN_TTL_SECONDS` can set a lifetime from one second to 30 days. The token payload is base64url-encoded, readable reproducibility metadata (including the seed), followed by an HMAC signature. It protects against tampering; it does not encrypt the seed, hide the puzzle solution from a determined caller, or make public deterministic puzzles cheat-proof. Keep it with the puzzle in the browser and submit only the player’s completed non-base category assignments:

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

The answer must contain each non-base category exactly once, with every category value exactly once, in base-row order. Verification returns only `{ correct: boolean }`; it never reveals correct cells or the solution. `POST /v1/puzzles/hint` accepts the puzzle token, a `kind` of `clue` or `elimination`, and an optional `hintIndex` from 0 to 100. The index selects a public clue deterministically and wraps when the clue pool is exhausted. Hints do not return solution placements; the generated puzzle already contains its full clue list.
