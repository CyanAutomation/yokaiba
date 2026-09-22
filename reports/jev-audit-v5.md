# Yokaiba JEV audit

Generated: 2026-09-22T22:13:43.425Z
JEV model requested: typesafe/jev-1.13-20260917
Clues reviewed: 453; flags: 11; reported cost: $0.006105.

## Deterministic difficulty audit

| Template | Level distribution | No-guess trace |
| --- | --- | --- |
| tournament-order-v1 | 1: 1, 2: 5, 3: 2, 4: 2 | 9 complete / 1 incomplete |
| tournament-order-v2 | 1: 2, 2: 1, 3: 5, 4: 2 | 8 complete / 2 incomplete |
| open-division-v2 | 5: 2, 6: 1, 7: 3, 8: 4 | 6 complete / 4 incomplete |
| championship-bridge-v1 | 8: 6, 9: 4 | 5 complete / 5 incomplete |
| championship-circuit-v2 | 9: 4, 10: 2, 11: 1, 12: 3 | 6 complete / 4 incomplete |

## JEV wording flags

| Template / clue | Text | Faithful | Ambiguous | Readability |
| --- | --- | ---: | ---: | ---: |
| tournament-order-v1 / distance-weight-tatami-1-3 | In the tournament order order, the -73 kg competitor was exactly two positions away from the competitor on Tatami 1. | 0.86 | 0.70 | 0.91 |
| tournament-order-v1 / before-tatami-1-2 | In the tournament order order, the competitor on Tatami 2 came before the competitor on Tatami 1. | 0.35 | 0.32 | 1.17 |
| tournament-order-v2 / distance-weight-placing-0-3 | In the tournament order order, the -66 kg competitor and the competitor who finished 4th were exactly three positions apart. | 0.87 | 0.68 | 1.01 |
| tournament-order-v2 / distance-weight-tatami-0-1 | In the tournament order order, the -81 kg competitor and the competitor on Tatami 2 were exactly one position apart. | 0.89 | 0.57 | 0.98 |
| open-division-v2 / adjacent-tatami-0-1 | In the open division order, the competitor on Tatami 3 and the competitor on Tatami 5 occupied consecutive positions. | 0.63 | 0.61 | 1.38 |
| open-division-v2 / distance-weight-tatami-0-3 | In the open division order, the -90 kg competitor and the competitor on Tatami 2 were exactly three positions apart. | 0.87 | 0.63 | 1.49 |
| open-division-v2 / matches-tatami-3 | Mika competed on Tatami 4. | 0.58 | 0.66 | 1.12 |
| championship-bridge-v1 / distance-tatami-result-0-3 | In the championship bridge order, the competitor on Tatami 5 was exactly three positions away from the competitor who finished 4th. | 0.87 | 0.66 | 1.34 |
| championship-circuit-v2 / matches-tatami-0 | Aki competed on Tatami 3. | 0.61 | 0.63 | 1.18 |
| championship-circuit-v2 / before-medal-0-1 | In the championship circuit order, the silver medallist was earlier than the bronze medallist. | 0.55 | 0.62 | 1.45 |
| championship-circuit-v2 / distance-tatami-medal-0-2 | In the championship circuit order, the competitor on Tatami 3 was exactly two positions away from the bronze medallist. | 0.86 | 0.61 | 1.37 |

Flags are review leads, not evidence that a deterministic clue contract is broken. Existing solver and wording tests remain authoritative.
