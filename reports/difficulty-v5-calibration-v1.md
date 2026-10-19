# Yokaiba difficulty v5 calibration audit

Generated: 2026-10-19T06:58:50.493Z
Paired samples: 25 per template; targeted samples: 3 per advertised level; seed prefix: `difficulty-v5-audit`.

The paired comparison scores v4 and v5 on the same v4-generated clue set. Targeted selection is a separate measurement of v5 clue generation and bounded candidate selection. This is deterministic engineering evidence, not human-player validation.

## Paired model comparison

| Template | Samples | v4 score p50 (range) | v5 score p50 (range) | v4 / v5 mean level gap | v5 higher / equal / lower | v5 trace complete | Depth p50 / p95 | Generation ms p50 / p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| tournament-order-v1 | 25 | 124 (94–152) | 49 (28–65) | 1.40 | 19 / 2 / 4 | 16/25 | 4 / 8 | 2.554 / 4.595 |
| tournament-order-v2 | 25 | 120 (100–149) | 51 (38–68) | 1.68 | 20 / 3 / 2 | 19/25 | 5 / 8 | 1.905 / 3.104 |
| open-division-v2 | 25 | 110 (88–133) | 49 (30–70) | 2.20 | 0 / 3 / 22 | 17/25 | 5 / 8 | 3.031 / 5.14 |
| championship-bridge-v1 | 25 | 152 (126–178) | 54 (39–70) | 3.36 | 0 / 0 / 25 | 17/25 | 6 / 11 | 10.562 / 28.753 |
| championship-circuit-v2 | 25 | 161 (124–181) | 52 (37–71) | 6.12 | 0 / 0 / 25 | 11/25 | 5 / 10 | 11.027 / 25.6 |

## Targeted selection: tournament-order-v1

| Level | Selected / samples | Availability | Selected score p50 (range) | Tried score range | Attempts p50 / p95 | Time ms p50 / p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 3/3 | 100.0% | 15 (15–15) | 15–15 | 12 / 12 | 14.033 / 14.256 |
| 2 | 3/3 | 100.0% | 16 (16–17) | 15–17 | 12 / 12 | 33.272 / 40.236 |
| 3 | 3/3 | 100.0% | 42 (41–42) | 32–64 | 12 / 12 | 46.183 / 78.277 |
| 4 | 3/3 | 100.0% | 48 (48–48) | 35–66 | 12 / 12 | 37.641 / 41.997 |

Paired v5 completion: 16/25; stalled: 9; contradictions: 0. Outlier or incomplete seeds: `difficulty-v5-audit-tournament-order-v1-2`, `difficulty-v5-audit-tournament-order-v1-4`, `difficulty-v5-audit-tournament-order-v1-5`, `difficulty-v5-audit-tournament-order-v1-6`, `difficulty-v5-audit-tournament-order-v1-8`, `difficulty-v5-audit-tournament-order-v1-13`, `difficulty-v5-audit-tournament-order-v1-18`, `difficulty-v5-audit-tournament-order-v1-19`, `difficulty-v5-audit-tournament-order-v1-21`, `difficulty-v5-audit-tournament-order-v1-22`, `difficulty-v5-audit-tournament-order-v1-23`, `difficulty-v5-audit-tournament-order-v1-24`.

## Targeted selection: tournament-order-v2

| Level | Selected / samples | Availability | Selected score p50 (range) | Tried score range | Attempts p50 / p95 | Time ms p50 / p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 3/3 | 100.0% | 15 (15–15) | 15–15 | 12 / 12 | 11.706 / 11.76 |
| 2 | 3/3 | 100.0% | 16 (16–17) | 15–17 | 12 / 12 | 33.557 / 45.773 |
| 3 | 3/3 | 100.0% | 42 (42–43) | 33–61 | 12 / 12 | 46.23 / 75.364 |
| 4 | 3/3 | 100.0% | 48 (48–48) | 34–65 | 12 / 12 | 29.595 / 35.495 |

Paired v5 completion: 19/25; stalled: 6; contradictions: 0. Outlier or incomplete seeds: `difficulty-v5-audit-tournament-order-v2-2`, `difficulty-v5-audit-tournament-order-v2-12`, `difficulty-v5-audit-tournament-order-v2-13`, `difficulty-v5-audit-tournament-order-v2-15`, `difficulty-v5-audit-tournament-order-v2-18`, `difficulty-v5-audit-tournament-order-v2-19`, `difficulty-v5-audit-tournament-order-v2-20`, `difficulty-v5-audit-tournament-order-v2-21`, `difficulty-v5-audit-tournament-order-v2-23`, `difficulty-v5-audit-tournament-order-v2-24`.

## Targeted selection: open-division-v2

| Level | Selected / samples | Availability | Selected score p50 (range) | Tried score range | Attempts p50 / p95 | Time ms p50 / p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 5 | 3/3 | 100.0% | 55 (53–60) | 50–70 | 4 / 4 | 33.541 / 35.766 |
| 6 | 2/3 | 66.7% | 61 (61–62) | 60–82 | 4 / 4 | 119.142 / 127.231 |
| 7 | 1/3 | 33.3% | 69 (69–69) | 46–74 | 4 / 4 | 28.626 / 29.802 |
| 8 | 2/3 | 66.7% | 70 (70–71) | 58–80 | 4 / 4 | 116.735 / 132.538 |

Paired v5 completion: 17/25; stalled: 8; contradictions: 0. Outlier or incomplete seeds: `difficulty-v5-audit-open-division-v2-2`, `difficulty-v5-audit-open-division-v2-3`, `difficulty-v5-audit-open-division-v2-5`, `difficulty-v5-audit-open-division-v2-8`, `difficulty-v5-audit-open-division-v2-10`, `difficulty-v5-audit-open-division-v2-12`, `difficulty-v5-audit-open-division-v2-15`, `difficulty-v5-audit-open-division-v2-16`, `difficulty-v5-audit-open-division-v2-21`, `difficulty-v5-audit-open-division-v2-23`, `difficulty-v5-audit-open-division-v2-24`.

## Targeted selection: championship-bridge-v1

| Level | Selected / samples | Availability | Selected score p50 (range) | Tried score range | Attempts p50 / p95 | Time ms p50 / p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 8 | 2/3 | 66.7% | 70 (70–71) | 66–79 | 4 / 4 | 509.833 / 515.834 |
| 9 | 2/3 | 66.7% | 73 (73–75) | 55–79 | 4 / 4 | 501.908 / 524.359 |

Paired v5 completion: 17/25; stalled: 8; contradictions: 0. Outlier or incomplete seeds: `difficulty-v5-audit-championship-bridge-v1-2`, `difficulty-v5-audit-championship-bridge-v1-4`, `difficulty-v5-audit-championship-bridge-v1-5`, `difficulty-v5-audit-championship-bridge-v1-6`, `difficulty-v5-audit-championship-bridge-v1-13`, `difficulty-v5-audit-championship-bridge-v1-14`, `difficulty-v5-audit-championship-bridge-v1-16`, `difficulty-v5-audit-championship-bridge-v1-20`, `difficulty-v5-audit-championship-bridge-v1-22`, `difficulty-v5-audit-championship-bridge-v1-23`.

## Targeted selection: championship-circuit-v2

| Level | Selected / samples | Availability | Selected score p50 (range) | Tried score range | Attempts p50 / p95 | Time ms p50 / p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 9 | 3/3 | 100.0% | 75 (75–75) | 61–79 | 4 / 4 | 503.365 / 651.088 |
| 10 | 1/3 | 33.3% | 79 (79–79) | 61–79 | 4 / 4 | 583.123 / 645.153 |
| 11 | 0/3 | 0.0% | n/a (n/a–n/a) | 58–78 | 4 / 4 | 414.037 / 429.695 |
| 12 | 0/3 | 0.0% | n/a (n/a–n/a) | 60–80 | 4 / 4 | 511.375 / 598.192 |

Paired v5 completion: 11/25; stalled: 14; contradictions: 0. Outlier or incomplete seeds: `difficulty-v5-audit-championship-circuit-v2-1`, `difficulty-v5-audit-championship-circuit-v2-3`, `difficulty-v5-audit-championship-circuit-v2-5`, `difficulty-v5-audit-championship-circuit-v2-6`, `difficulty-v5-audit-championship-circuit-v2-7`, `difficulty-v5-audit-championship-circuit-v2-10`, `difficulty-v5-audit-championship-circuit-v2-11`, `difficulty-v5-audit-championship-circuit-v2-12`, `difficulty-v5-audit-championship-circuit-v2-13`, `difficulty-v5-audit-championship-circuit-v2-15`, `difficulty-v5-audit-championship-circuit-v2-16`, `difficulty-v5-audit-championship-circuit-v2-17`, `difficulty-v5-audit-championship-circuit-v2-18`, `difficulty-v5-audit-championship-circuit-v2-19`, `difficulty-v5-audit-championship-circuit-v2-21`, `difficulty-v5-audit-championship-circuit-v2-23`.

## Interpretation limits

Difficulty bands are provisional. Availability gaps, incomplete no-guess traces, or long p95 generation times are release risks to address with deterministic evidence. JEV semantic scores are optional and probabilistic; player outcomes are outside this audit and are not required to complete this implementation.
