# Yokaiba difficulty v5 calibration audit

Generated: 2026-10-19T07:21:58.955Z
Paired samples: 25 per template; targeted samples: 3 per advertised level; seed prefix: `difficulty-v5-audit`.

The paired comparison scores v4 and v5 on the same v4-generated clue set. Targeted selection is a separate measurement of v5 clue generation and bounded candidate selection. This is deterministic engineering evidence, not human-player validation.

## Paired model comparison

| Template | Samples | v4 score p50 (range) | v5 score p50 (range) | v4 / v5 mean level gap | v5 higher / equal / lower | v5 trace complete | Depth p50 / p95 | Generation ms p50 / p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| tournament-order-v1 | 25 | 124 (94–152) | 49 (28–65) | 1.40 | 19 / 2 / 4 | 16/25 | 4 / 8 | 3.047 / 6.043 |
| tournament-order-v2 | 25 | 120 (100–149) | 51 (38–68) | 1.68 | 20 / 3 / 2 | 19/25 | 5 / 8 | 2.059 / 3.477 |
| open-division-v2 | 25 | 110 (88–133) | 49 (30–70) | 2.20 | 0 / 3 / 22 | 17/25 | 5 / 8 | 3.34 / 8.418 |
| championship-bridge-v1 | 25 | 152 (126–178) | 54 (39–70) | 3.36 | 0 / 0 / 25 | 17/25 | 6 / 11 | 11.077 / 26.044 |
| championship-circuit-v2 | 25 | 161 (124–181) | 52 (37–71) | 6.12 | 0 / 0 / 25 | 11/25 | 5 / 10 | 10.328 / 25.997 |

## Targeted selection: tournament-order-v1

| Level | Selected / samples | Availability | Selected score p50 (range) | Tried score range | Attempts p50 / p95 | Time ms p50 / p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 3/3 | 100.0% | 15 (15–15) | 15–15 | 12 / 12 | 16.855 / 21.273 |
| 2 | 3/3 | 100.0% | 16 (16–17) | 15–17 | 12 / 12 | 57.32 / 61.618 |
| 3 | 3/3 | 100.0% | 42 (41–42) | 32–64 | 12 / 12 | 55.414 / 57.98 |
| 4 | 3/3 | 100.0% | 48 (48–48) | 35–66 | 12 / 12 | 40.157 / 52.178 |

Paired v5 completion: 16/25; stalled: 9; contradictions: 0. Outlier or incomplete seeds: `difficulty-v5-audit-tournament-order-v1-2`, `difficulty-v5-audit-tournament-order-v1-4`, `difficulty-v5-audit-tournament-order-v1-5`, `difficulty-v5-audit-tournament-order-v1-6`, `difficulty-v5-audit-tournament-order-v1-8`, `difficulty-v5-audit-tournament-order-v1-13`, `difficulty-v5-audit-tournament-order-v1-18`, `difficulty-v5-audit-tournament-order-v1-19`, `difficulty-v5-audit-tournament-order-v1-21`, `difficulty-v5-audit-tournament-order-v1-22`, `difficulty-v5-audit-tournament-order-v1-23`, `difficulty-v5-audit-tournament-order-v1-24`.

## Targeted selection: tournament-order-v2

| Level | Selected / samples | Availability | Selected score p50 (range) | Tried score range | Attempts p50 / p95 | Time ms p50 / p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 3/3 | 100.0% | 15 (15–15) | 15–15 | 12 / 12 | 9.81 / 11.526 |
| 2 | 3/3 | 100.0% | 16 (16–17) | 15–17 | 12 / 12 | 35.757 / 40.187 |
| 3 | 3/3 | 100.0% | 42 (42–43) | 33–61 | 12 / 12 | 41.939 / 51.24 |
| 4 | 3/3 | 100.0% | 48 (48–48) | 34–65 | 12 / 12 | 28.88 / 43.517 |

Paired v5 completion: 19/25; stalled: 6; contradictions: 0. Outlier or incomplete seeds: `difficulty-v5-audit-tournament-order-v2-2`, `difficulty-v5-audit-tournament-order-v2-12`, `difficulty-v5-audit-tournament-order-v2-13`, `difficulty-v5-audit-tournament-order-v2-15`, `difficulty-v5-audit-tournament-order-v2-18`, `difficulty-v5-audit-tournament-order-v2-19`, `difficulty-v5-audit-tournament-order-v2-20`, `difficulty-v5-audit-tournament-order-v2-21`, `difficulty-v5-audit-tournament-order-v2-23`, `difficulty-v5-audit-tournament-order-v2-24`.

## Targeted selection: open-division-v2

| Level | Selected / samples | Availability | Selected score p50 (range) | Tried score range | Attempts p50 / p95 | Time ms p50 / p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 5 | 3/3 | 100.0% | 55 (53–60) | 50–70 | 4 / 4 | 34.398 / 50.026 |
| 6 | 2/3 | 66.7% | 61 (61–62) | 60–82 | 4 / 4 | 127.348 / 130.02 |
| 7 | 1/3 | 33.3% | 69 (69–69) | 46–74 | 4 / 4 | 33.229 / 39.171 |
| 8 | 2/3 | 66.7% | 70 (70–71) | 58–80 | 4 / 4 | 129.009 / 134.382 |

Paired v5 completion: 17/25; stalled: 8; contradictions: 0. Outlier or incomplete seeds: `difficulty-v5-audit-open-division-v2-2`, `difficulty-v5-audit-open-division-v2-3`, `difficulty-v5-audit-open-division-v2-5`, `difficulty-v5-audit-open-division-v2-8`, `difficulty-v5-audit-open-division-v2-10`, `difficulty-v5-audit-open-division-v2-12`, `difficulty-v5-audit-open-division-v2-15`, `difficulty-v5-audit-open-division-v2-16`, `difficulty-v5-audit-open-division-v2-21`, `difficulty-v5-audit-open-division-v2-23`, `difficulty-v5-audit-open-division-v2-24`.

## Targeted selection: championship-bridge-v1

| Level | Selected / samples | Availability | Selected score p50 (range) | Tried score range | Attempts p50 / p95 | Time ms p50 / p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 8 | 2/3 | 66.7% | 70 (70–71) | 66–79 | 4 / 4 | 479.342 / 515.73 |
| 9 | 2/3 | 66.7% | 73 (73–74) | 62–77 | 4 / 4 | 532.574 / 536.425 |

Paired v5 completion: 17/25; stalled: 8; contradictions: 0. Outlier or incomplete seeds: `difficulty-v5-audit-championship-bridge-v1-2`, `difficulty-v5-audit-championship-bridge-v1-4`, `difficulty-v5-audit-championship-bridge-v1-5`, `difficulty-v5-audit-championship-bridge-v1-6`, `difficulty-v5-audit-championship-bridge-v1-13`, `difficulty-v5-audit-championship-bridge-v1-14`, `difficulty-v5-audit-championship-bridge-v1-16`, `difficulty-v5-audit-championship-bridge-v1-20`, `difficulty-v5-audit-championship-bridge-v1-22`, `difficulty-v5-audit-championship-bridge-v1-23`.

## Targeted selection: championship-circuit-v2

| Level | Selected / samples | Availability | Selected score p50 (range) | Tried score range | Attempts p50 / p95 | Time ms p50 / p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 9 | 3/3 | 100.0% | 75 (73–76) | 51–77 | 4 / 4 | 517.228 / 749.497 |
| 10 | 1/3 | 33.3% | 79 (79–79) | 61–79 | 4 / 4 | 605.058 / 610.243 |
| 11 | 0/3 | 0.0% | n/a (n/a–n/a) | 62–76 | 4 / 4 | 274.991 / 337.405 |
| 12 | 0/3 | 0.0% | n/a (n/a–n/a) | 60–80 | 4 / 4 | 567.466 / 655.691 |

Paired v5 completion: 11/25; stalled: 14; contradictions: 0. Outlier or incomplete seeds: `difficulty-v5-audit-championship-circuit-v2-1`, `difficulty-v5-audit-championship-circuit-v2-3`, `difficulty-v5-audit-championship-circuit-v2-5`, `difficulty-v5-audit-championship-circuit-v2-6`, `difficulty-v5-audit-championship-circuit-v2-7`, `difficulty-v5-audit-championship-circuit-v2-10`, `difficulty-v5-audit-championship-circuit-v2-11`, `difficulty-v5-audit-championship-circuit-v2-12`, `difficulty-v5-audit-championship-circuit-v2-13`, `difficulty-v5-audit-championship-circuit-v2-15`, `difficulty-v5-audit-championship-circuit-v2-16`, `difficulty-v5-audit-championship-circuit-v2-17`, `difficulty-v5-audit-championship-circuit-v2-18`, `difficulty-v5-audit-championship-circuit-v2-19`, `difficulty-v5-audit-championship-circuit-v2-21`, `difficulty-v5-audit-championship-circuit-v2-23`.

## Interpretation limits

Difficulty bands are provisional. Availability gaps, incomplete no-guess traces, or long p95 generation times are release risks to address with deterministic evidence. JEV semantic scores are optional and probabilistic; player outcomes are outside this audit and are not required to complete this implementation.
