# Yokaiba JEV audit

Started: 2026-09-29T21:44:53.232Z
Generated: 2026-09-29T21:45:24.563Z
JEV model requested: ~typesafe/jev-latest
JEV model resolved: typesafe/jev-1.13-20260917
Samples: 1 per difficulty template; 10 per wording template; batch size 20.
Clues reviewed: 453; flags: 9; incomplete evaluations: 0; reported cost: $0.006120.

## Deterministic difficulty audit

| Template | Level distribution | No-guess trace |
| --- | --- | --- |
| tournament-order-v1 | 2: 1 | 1 complete / 0 incomplete |
| tournament-order-v2 | 3: 1 | 1 complete / 0 incomplete |
| open-division-v2 | 8: 1 | 0 complete / 1 incomplete |
| championship-bridge-v1 | 8: 1 | 1 complete / 0 incomplete |
| championship-circuit-v2 | 12: 1 | 0 complete / 1 incomplete |

## Targeted difficulty audit

| Template | Level | Exact target | No-guess trace | Fallbacks |
| --- | ---: | ---: | ---: | ---: |
| tournament-order-v2 | 1 | 1/1 | 1/1 | 0/1 (maximum attempt 0) |
| tournament-order-v2 | 2 | 1/1 | 1/1 | 0/1 (maximum attempt 0) |
| tournament-order-v2 | 3 | 1/1 | 1/1 | 0/1 (maximum attempt 0) |
| tournament-order-v2 | 4 | 1/1 | 1/1 | 0/1 (maximum attempt 0) |
| open-division-v2 | 5 | 1/1 | 1/1 | 1/1 (maximum attempt 2) |
| open-division-v2 | 6 | 1/1 | 1/1 | 1/1 (maximum attempt 4) |
| open-division-v2 | 7 | 1/1 | 1/1 | 1/1 (maximum attempt 1) |
| open-division-v2 | 8 | 1/1 | 1/1 | 0/1 (maximum attempt 0) |
| championship-bridge-v1 | 8 | 1/1 | 1/1 | 1/1 (maximum attempt 4) |
| championship-bridge-v1 | 9 | 1/1 | 1/1 | 0/1 (maximum attempt 0) |
| championship-circuit-v2 | 9 | 1/1 | 1/1 | 1/1 (maximum attempt 7) |
| championship-circuit-v2 | 10 | 1/1 | 1/1 | 1/1 (maximum attempt 1) |
| championship-circuit-v2 | 11 | 1/1 | 1/1 | 1/1 (maximum attempt 7) |
| championship-circuit-v2 | 12 | 1/1 | 1/1 | 0/1 (maximum attempt 0) |

## JEV wording flags

Scores include JEV confidence in parentheses when supplied.

| Template / clue | Text | Faithfulness | Ambiguity | Readability | Flag reasons | Evaluation |
| --- | --- | ---: | ---: | ---: | --- | --- |
| tournament-order-v1 / distance-weight-tatami-1-3 | The positions of the -73 kg competitor and the competitor on Tatami 1 in the tournament order differed by exactly two. | 0.89 | 0.67 | 1.12 (conf. 0.49) | ambiguity above 0.60 | complete |
| tournament-order-v1 / before-tatami-1-2 | In the tournament order, the competitor on Tatami 2 came before the competitor on Tatami 1. | 0.36 | 0.36 | 1.37 (conf. 0.05) | faithfulness below 0.50 | complete |
| tournament-order-v2 / distance-weight-tatami-0-3 | In the tournament order, the positions of the -66 kg competitor and the competitor on Tatami 2 differed by exactly three. | 0.85 | 0.61 | 1.36 (conf. 0.26) | ambiguity above 0.60 | complete |
| tournament-order-v2 / distance-tatami-placing-1-3 | In the tournament order, the positions of the competitor on Tatami 1 and the competitor who finished 2nd differed by exactly two. | 0.81 | 0.62 | 1.43 (conf. 0.23) | ambiguity above 0.60 | complete |
| open-division-v2 / matches-tatami-3 | Mika competed on Tatami 4. | 0.56 | 0.64 | 1.12 (conf. 0.17) | ambiguity above 0.60 | complete |
| championship-circuit-v2 / distance-tatami-medal-0-2 | The positions of the competitor on Tatami 5 and the quarter-finalist in the championship circuit order differed by exactly two. | 0.63 | 0.66 | 1.03 (conf. 0.59) | ambiguity above 0.60 | complete |
| championship-circuit-v2 / matches-tatami-0 | Aki competed on Tatami 3. | 0.56 | 0.62 | 1.34 (conf. 0.01) | ambiguity above 0.60 | complete |
| championship-circuit-v2 / before-medal-0-1 | In the championship circuit order, the silver medallist was earlier than the bronze medallist. | 0.45 | 0.58 | 1.44 (conf. 0.16) | faithfulness below 0.50 | complete |
| championship-circuit-v2 / distance-tatami-medal-0-2 | The positions of the competitor on Tatami 3 and the bronze medallist in the championship circuit order differed by exactly two. | 0.78 | 0.56 | 0.98 (conf. 0.61) | readability below 1.00 | complete |

Flags are review leads, not evidence that a deterministic clue contract is broken. Existing solver and wording tests remain authoritative.
