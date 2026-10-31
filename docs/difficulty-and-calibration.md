# Difficulty and calibration

## Logical, semantic, and observed difficulty

Yokaiba keeps three calibration signals separate:

- **Logical difficulty** is deterministic and authoritative for the existing 1–12 level contract. The solver owns solvability, uniqueness, correctness, hints, redundancy, deduction traces, and solver telemetry.
- **Semantic difficulty** is optional, probabilistic JEV review of human-facing clue language. The offline `npm run audit:jev` report records readability, ambiguity, linguistic complexity, relationship explicitness, the structured constraint, rendered wording, language/template metadata, seed, logical level/model version, requested/resolved JEV model, schema version, confidence, and usage where returned. JEV findings are review leads; they never change puzzle validity or generation.
- **Observed player difficulty** is estimated from submitted outcomes such as completion time, hints, mistakes, and abandonment. When the `PUZZLE_OUTCOMES` Analytics Engine binding and `PUZZLE_TOKEN_SECRET` are configured, `POST /v1/events` requires an unexpired v4 puzzle token and derives template and difficulty identity from its signed claims. Gameplay measurements remain self-reported and a token can be reused, so events do not prove that a person played or completed a puzzle. Events use an explicit schema version (legacy version 0 or current version 1); unknown fields, including seeds and player identifiers, are discarded. The endpoint has no public query path. Review the game’s analytics disclosure and Cloudflare dataset retention/access settings before enabling collection. No production thresholds are automatically recalibrated; use aggregate cohort analysis and held-out player samples before changing calibration.

JEV review requests include a human-readable `expectedSemantics` description of each clue's structured relation. These descriptions let reviewers compare the wording with the intended relation; they do not replace the structured constraint or deterministic puzzle checks.

Clue-level semantic review batches its typed questions together and sends rendered text with the corresponding structured constraint, without puzzle solutions. Add `--puzzle-review` to `npm run audit:jev` for bounded clue-set questions about wording repetition, terminology consistency, phrasing variety, and language burden compared with deterministic logical difficulty. To review the same sampled puzzles from an existing JSON report without repeating deterministic generation or clue review, use `npm run audit:jev -- --puzzle-review-from reports/previous-audit.json`. The report keeps these profiles paired by template and seed; it does not collapse them into one score. For example, a high language-burden response alongside logical level 3 is calibration evidence, not a new difficulty level. JEV is never called by puzzle generation, solving, hinting, or answer verification. Provider failures are reported as unavailable semantic results and leave a resumable checkpoint.

Clue prose uses language version `yokaiba-clue-prose-v11`. Ordered clues refer to the event order and name exact positions so their meaning does not depend on a template title. Medal clues name the medal, and every tournament template labels its category as “Weight division”. Weight categories use unique official IJF senior men's divisions in competition order. Phrase assignments remain stable from v9; the between-count form remains available for paired review of saved clues.

An earlier paired review of 1,109 saved v5 distance clues reported mean places-apart-minus-between-count differences of 0.023 for faithfulness, 0.0364 for readability, 0.2123 for relationship explicitness, -0.0223 for misunderstanding risk, and -0.0018 for ambiguity. That run did not include uncertainty intervals or template-level summaries. A separate merged rerun compared both wordings on 1,021 saved v5 distance clues; all 1,021 pairs were complete and came from 448 template-and-seed clusters. The requested model was `~typesafe/jev-latest`, resolved to `typesafe/jev-1.14-20261014`. Places-apart-minus-between-count mean differences and 95% cluster-bootstrap intervals were +0.0267 [0.0223, 0.0310] for faithfulness, +0.0526 [0.0467, 0.0591] for readability, +0.2254 [0.2111, 0.2402] for relationship explicitness, -0.0234 [-0.0275, -0.0196] for misunderstanding risk, and -0.0046 [-0.0064, -0.0026] for ambiguity. Positive differences favor places-apart for the first three metrics; negative differences favor it for the last two. The first four metrics had favorable intervals in all five templates; the ambiguity differences were smaller and less consistent by template. Keep the two runs separate because they used different saved samples.

To compare both variants on saved v5 clue semantics, run `npm run audit:jev:distance-wording -- --report reports/jev-audit-v5.json --out reports/jev-distance-wording-v5`. The comparison requests `~typesafe/jev-latest`, checks that the provider's resolved model stays consistent across batches when returned, and reports paired differences with deterministic 95% cluster-bootstrap intervals overall and by template. Clues from the same puzzle seed are resampled together; intervals are reported as n/a when fewer than two puzzle-seed clusters contribute. Its Markdown report also lists the largest adverse paired examples for exploratory inspection; these are not evidence about player outcomes. The labels describe the tested text variants without implying which is current. This review is probabilistic triage evidence, not a gate for generation or CI.

Validate the wording with players before changing the default. Randomize the two wordings across otherwise identical clues, balance one-place distances against multi-place distances and cover all five templates. Record whether players infer the correct rank difference, their response time, and the type of any misunderstanding; compare results by distance class and template. The JEV scores above are not player-outcome evidence.

## Difficulty Calibration v5

The v4 score combines the costs of supplied clue types, no-guess propagation passes, clue counts and exhaustive-solver work. It does not identify which clues produced deductions or whether a later deduction depended on an earlier one. A clue can therefore affect the score without helping the no-guess trace, and repeated solver passes are not a measure of human inference depth.

The opt-in `yokaiba-difficulty-v5` profile adds a deterministic deduction trace. It processes public clue constraints in stable clue-ID order and records only new candidate eliminations and placements. Each step includes its rule and strategy tags, source clues, categories, prerequisite step IDs, eliminated candidates, placements, dependency depth, estimated cognitive cost, relevant alternatives before the deduction, and whether it enabled a later step. The evaluator accepts no solution argument. The exhaustive solver remains the authority for uniqueness and correctness; v5 separately reports `complete`, `incomplete`, or `contradiction` for its bounded no-guess reasoning.

The following normalized metrics are reported from 0 to 100. Higher values mean harder for the first four and the residual metric; starting accessibility and automatic cascade are easier signals and are inverted in the final score.

| Metric | Calculation | Weight |
| --- | --- | ---: |
| Reasoning dependency depth | 70% of `min(maximum depth / 8, 1)` plus 30% of `min(mean step depth / 4, 1)`. | 25% |
| Deduction complexity | Equal blend of mean and maximum step cognitive cost on the 1–5 strategy scale, normalized to 0–100. | 20% |
| Working-memory demand | Mean unresolved alternatives in the clue and inherited prerequisite categories for each productive deduction, divided by `row count² × min(4, non-base category count)`. It does not use solver memory. | 15% |
| Cross-category reasoning | Share of deductions whose clue or dependency chain spans multiple non-base categories. | 15% |
| Starting accessibility | Three independent deductions with no prerequisites saturate the easier score. | 10% |
| Automatic cascade behaviour | Share of deductions that become prerequisites for later propagation; higher is easier. | 10% |
| Residual logical complexity | Half the bounded `log2(nodes + 1) / 18` signal plus half `log2(constraint checks + 1) / 22`. | 5% |

The weighted difficulty score inverts the two easier signals and sums the dimensions. Raw trace fields and metric scores remain available beside the final 1–12 level. Dependency depth counts prerequisite steps, not solver loops. These weights, cost estimates, and the following inclusive bands are provisional engineering hypotheses; they have not been validated against players.

| Level | Score band | Intended experience |
| ---: | ---: | --- |
| 1 | 14–15 | Very accessible, with a small amount of direct reasoning. |
| 2 | 16–39 | Simple facts and exclusions with shallow dependencies. |
| 3 | 40–44 | Several connected deductions. |
| 4 | 45–52 | Moderate beginner reasoning. |
| 5 | 53–60 | Early intermediate reasoning. |
| 6 | 61–65 | Increasingly connected deductions. |
| 7 | 66–69 | Hard intermediate reasoning. |
| 8 | 70–72 | Transitional advanced reasoning. |
| 9 | 73–76 | Advanced reasoning with multiple dependencies. |
| 10 | 77–80 | Sustained advanced reasoning. |
| 11 | 81–90 | Long and varied dependency chains. |
| 12 | 91–100 | Highest provisional difficulty band. |

Targeted v5 generation searches 12 deterministic clue-order strategies on every board size. On levels 6–12, those strategies span three clue-family priority profiles as well as stable tie-order rotations. Circuit levels 11–12 also search cross-grid before and adjacency clues; lower targets and the legacy v4 candidate pool keep their existing clue sets. A candidate must be inside the requested band and complete under the no-guess trace. Once uniqueness is reached, generation can add up to 16 supporting clues when the current minimal clue set stalls the trace; pruning retains a clue only when uniqueness and no-guess completion both remain. Eligible candidates rank by distance from the score-band midpoint, then receive a penalty of 3 per level below the band's preferred minimum dependency depth, small penalties for starting accessibility below 30 and cascade ease above 80, and up to 0.75 credit for distinct strategy tags. The lowest rank wins; stable strategy order resolves ties. Success diagnostics include the selected score/rank, candidate score range, strategy budget and eligible count. If no candidate meets both gates, the API returns `422` with the attempted score range, completion counts, and observed levels. Explicit v5 seed fallback tries the requested seed plus at most two derived seeds. The comparison mode assesses v5 on the exact v4 clue set and keeps v4 as the top-level difficulty.

The v5 target audit exercises every advertised template level through the same exact-level fallback path used by the course. Run `npm run audit:difficulty:v5 -- --samples 1 --target-samples 100 --out reports/difficulty-v5-targeted` to record availability, candidate score ranges and generation latency for 100 deterministic seeds per level. This is a diagnostic report rather than a CI gate; check that selected puzzles retain the requested v5 level, uniqueness and a complete no-guess trace.

Omitting `difficultyModel` selects v5 for REST and MCP requests. Pass `difficultyModel=v4` to reproduce the previous production selection policy, `difficultyModel=v5` to pin the new model, or `compare` to assess both profiles on the v4 clue set. V5 uses a distinct puzzle identity and signed-token model field. Explicit v4 responses and tokens carry the v4 selection; historical tokens without a model continue to replay through v4. Tako-Bako uses v5 for newly started challenge courses where target coverage is supported and pins Levels 7, 11, and 12 to v4 until v5 target availability improves. Seeded URLs without a model remain on v4 for replay compatibility. The v5 score bands remain provisional.

The v2 JEV review adds clue-level entity clarity and misunderstanding risk, plus puzzle-level clue-set cognitive burden and first-read clarity. These scores remain separate from logical difficulty, include confidence when returned, and do not affect generation. The report records the requested JEV model and resolved model sets separately for clue and puzzle review, as well as an overall resolved model only when there is exactly one. Older reports and checkpoints retain a legacy-aggregate attribution label where phase-specific provenance cannot be recovered. The semantic audit always requests `~typesafe/jev-latest`.

The current semantic prompt schema is `yokaiba-jev-semantic-v3`. Faithfulness instructions explicitly accept equivalent paraphrases while still checking ordering, exactness, negation, and relation changes; this reduces false alarms caused by wording differences such as “won Gold” or “did not finish in 5th place.” Puzzle review sends clue count as context for its whole-set cognitive-burden score. Markdown summaries group that score by clue count so larger clue sets can be compared with similarly sized sets; do not treat count alone as a wording defect or retune the provisional 1.5 threshold from these model scores. Because the question framing changed, v2 checkpoints cannot resume under the v3 schema; start a new output path rather than mixing answers from both prompts. Completed older JSON reports remain readable.

JEV requests retry transient network failures and HTTP 408, 425, 429, and 5xx responses at most twice with exponential backoff. Authentication and other non-retryable 4xx responses fail immediately; after retries are exhausted the affected batch is recorded unavailable. Targeted difficulty summaries preserve aggregate strategy attempts, eligible candidates, score ranges, completion counts, fallback seed attempts, and alternate observed levels for unavailable samples. Older audit reports remain readable, but they do not contain diagnostics or clue-count context that was not recorded when they were created. A “not assessed” result is not a clean bill of health.

Before using semantic flags to change wording or thresholds, compare them with a small human-reviewed reference set. Include paraphrases, each supported clue relation, multiple templates, and multiple clue counts. Record adjudicated semantic correctness and player misreadings separately; check JEV agreement and false-positive examples by relation and clue-count group. For difficulty calibration, use held-out player outcomes rather than model scores or deterministic seed samples.

Run the paired and targeted v5 audit with:

```sh
npm run audit:difficulty:v5 -- --samples 25 --target-samples 25 --out reports/difficulty-v5-calibration
```

It compares v4 and v5 on the same v4-generated clue sets, then separately measures v5 target availability, selected score, candidate attempts, and generation time for every advertised level across all templates. JSON retains deterministic seeds, trace summaries, and public clue IDs/kinds/categories for outliers without recording answer assignments. Increase both sample counts for release calibration. A seeded corpus is reproducible implementation evidence, not human-player validation.

The checked-in audit (`reports/difficulty-v5-calibration-v1.md`) contains 25 paired seeds per template but only 3 direct target seeds per advertised level. Treat its availability percentages as exploratory; the targeted-sample default is now 25 to give a more useful estimate. Tako-Bako's bounded seed fallback improves availability for supported courses, but keeps Levels 7, 11, and 12 on v4 pending stronger v5 coverage and player evidence. The v5 score bands remain provisional and must not be retuned from v4 comparisons alone. The audit JSON preserves seeds and clue metadata for follow-up.

JEV audit checkpoints are written before generation begins, after each distribution template, after each targeted difficulty level, and after each wording template. If a deterministic or semantic phase is interrupted, rerun with the same `--out` values and `--resume` to continue from completed units. The audit always samples the API's default difficulty model (currently v5); its model version is saved in the checkpoint, and resume rejects checkpoints generated with another version. Older checkpoints without the version field infer it from their saved samples; legacy-model checkpoints need a new output path to regenerate samples with the current model. Targeted levels use the bounded v5 seed-fallback path and report unavailable attempts separately. Fallback use includes nearest-rank p50 and p95 attempts among seeds that required fallback. Do not retune provisional v5 score bands from comparisons with the legacy model; validate them against player outcomes first.

For every sampled v5 clue, the report removes that clue and checks whether the remaining clues still produce one solution and complete the no-guess deduction trace. It classifies the clue as uniqueness-critical, no-guess-critical, or not essential. It also records how many full-trace steps cite the clue, the reduced trace length, and the trace-length change. Among clues that are individually not essential, it checks pairs whose joint removal breaks uniqueness or no-guess completion; this identifies pairwise redundancy and does not claim to detect larger interactions. This deterministic ablation evidence complements JEV's linguistic assessment; it does not change puzzle generation or difficulty bands.

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

The distribution report includes per-level counts, clue-count range, and completion of the bounded no-guess trace for every template. The targeted report exercises every advertised level through the same deterministic fallback path used by the course, reporting fallback use and no-guess completion per level. Treat both as regression gates, not evidence of player difficulty. For player validation, send anonymized `puzzle_started`, `puzzle_completed`, `hint_used`, `mistake`, and `puzzle_abandoned` outcomes to `POST /v1/events` with `schemaVersion: 1`, the current `puzzleToken`, clue-count, hint/mistake totals, elapsed time, and optional `smartMarkingEnabled`. The server takes template and difficulty identity from the signed token. The version field is optional for older clients; omitted versions are stored as legacy version 0. Version 1 requires `hintsUsed` and `mistakes` on every event, plus `elapsedMs` for completions and abandonment. Never send a seed, player identifier, or answer cells. Segment calibration by smart-marking use: it is an advanced-player efficiency feature, not a hint or assist. Recalibrate template-specific thresholds on a held-out player sample, version the model, and retain historic metadata with every outcome.

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
