# Yokaiba difficulty v5 calibration audit

Generated: 2026-11-23T10:37:31.893Z
Paired samples: 1 per template; targeted samples: 100 per advertised level; seed prefix: `difficulty-v5-audit`.

The paired comparison scores v4 and v5 on the same v4-generated clue set. Targeted selection is a separate measurement of v5 clue generation and bounded candidate selection. This is deterministic engineering evidence, not human-player validation.

## Paired model comparison

| Template | Samples | v4 score p50 (range) | v5 score p50 (range) | v4 / v5 mean level gap | v5 higher / equal / lower | v5 trace complete | Depth p50 / p95 | Generation ms p50 / p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| tournament-order-v1 | 1 | 94 (94–94) | 39 (39–39) | 1.00 | 1 / 0 / 0 | 1/1 | 4 / 4 | 12.598 / 12.598 |
| tournament-order-v2 | 1 | 107 (107–107) | 51 (51–51) | 2.00 | 1 / 0 / 0 | 1/1 | 6 / 6 | 0.851 / 0.851 |
| open-division-v2 | 1 | 99 (99–99) | 35 (35–35) | 3.00 | 0 / 0 / 1 | 1/1 | 3 / 3 | 1.53 / 1.53 |
| championship-bridge-v1 | 1 | 163 (163–163) | 56 (56–56) | 4.00 | 0 / 0 / 1 | 1/1 | 6 / 6 | 13.73 / 13.73 |
| championship-circuit-v2 | 1 | 162 (162–162) | 64 (64–64) | 5.00 | 0 / 0 / 1 | 1/1 | 8 / 8 | 3.994 / 3.994 |

## Targeted selection: tournament-order-v1

| Level | Selected / samples | Availability | Selected score p50 (range) | Tried score range | Attempts p50 / p95 | Time ms p50 / p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 100/100 | 100.0% | 15 (15–15) | 15–15 | 12 / 12 | 8.667 / 12.673 |
| 2 | 100/100 | 100.0% | 16 (16–17) | 15–17 | 12 / 12 | 18.705 / 28.02 |
| 3 | 100/100 | 100.0% | 42 (40–44) | 27–65 | 12 / 12 | 28.911 / 34.407 |
| 4 | 100/100 | 100.0% | 48 (46–51) | 27–67 | 12 / 12 | 22.677 / 25.196 |

Paired v5 completion: 1/1; stalled: 0; contradictions: 0. Outlier or incomplete seeds: none.

## Targeted selection: tournament-order-v2

| Level | Selected / samples | Availability | Selected score p50 (range) | Tried score range | Attempts p50 / p95 | Time ms p50 / p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 100/100 | 100.0% | 15 (15–15) | 15–15 | 12 / 12 | 8.222 / 8.729 |
| 2 | 100/100 | 100.0% | 16 (16–17) | 15–17 | 12 / 12 | 19.553 / 82.26 |
| 3 | 100/100 | 100.0% | 42 (40–44) | 27–66 | 12 / 12 | 28.603 / 35.42 |
| 4 | 100/100 | 100.0% | 49 (46–51) | 32–67 | 12 / 12 | 24.005 / 37.241 |

Paired v5 completion: 1/1; stalled: 0; contradictions: 0. Outlier or incomplete seeds: none.

## Targeted selection: open-division-v2

| Level | Selected / samples | Availability | Selected score p50 (range) | Tried score range | Attempts p50 / p95 | Time ms p50 / p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 5 | 100/100 | 100.0% | 57 (54–60) | 41–76 | 12 / 12 | 61.195 / 83.252 |
| 6 | 99/100 | 99.0% | 63 (61–65) | 47–83 | 12 / 12 | 298.501 / 719.012 |
| 7 | 100/100 | 100.0% | 67 (66–69) | 47–83 | 12 / 12 | 226.911 / 473.446 |
| 8 | 99/100 | 99.0% | 71 (70–72) | 47–83 | 12 / 12 | 318.067 / 617.907 |

Paired v5 completion: 1/1; stalled: 0; contradictions: 0. Outlier or incomplete seeds: none.

## Targeted selection: championship-bridge-v1

| Level | Selected / samples | Availability | Selected score p50 (range) | Tried score range | Attempts p50 / p95 | Time ms p50 / p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 8 | 99/100 | 99.0% | 71 (70–72) | 47–83 | 12 / 12 | 1131.452 / 3202.401 |
| 9 | 100/100 | 100.0% | 74 (73–76) | 50–84 | 12 / 12 | 918.809 / 1058.129 |

Paired v5 completion: 1/1; stalled: 0; contradictions: 0. Outlier or incomplete seeds: none.

## Targeted selection: championship-circuit-v2

| Level | Selected / samples | Availability | Selected score p50 (range) | Tried score range | Attempts p50 / p95 | Time ms p50 / p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 9 | 100/100 | 100.0% | 75 (73–76) | 50–83 | 12 / 12 | 934.969 / 1074.285 |
| 10 | 100/100 | 100.0% | 78 (77–80) | 47–84 | 12 / 12 | 947.631 / 1179.677 |
| 11 | 97/100 | 97.0% | 81 (81–83) | 53–83 | 12 / 12 | 885.611 / 1869.173 |
| 12 | 0/100 | 0.0% | n/a (n/a–n/a) | 48–83 | 36 / 36 | 2501.1 / 2792.736 |

Paired v5 completion: 1/1; stalled: 0; contradictions: 0. Outlier or incomplete seeds: none.

## Interpretation limits

Difficulty bands are provisional. Availability gaps, incomplete no-guess traces, or long p95 generation times are release risks to address with deterministic evidence. JEV semantic scores are optional and probabilistic; player outcomes are outside this audit and are not required to complete this implementation.
