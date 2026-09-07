# Timing loss gate — rejected as a replacement

The [declared past-loss gate](analytics-timing-loss-gate-plan-20260907.md) does
**not** improve on the completed ungated recent-timing candidate. It worsens
both original-fold losses relative to that comparator. Retain the negative
result; do not promote this gate or quietly remove an inconvenient timing band.

| Original fold | Ungated recent Brier → gated | Ungated recent log loss → gated |
| --- | --- | --- |
| Fold 1 | 0.061002466 → 0.061008322 | 0.224631879 → 0.224647110 |
| Fold 2 | 0.059212396 → 0.059262863 | 0.218619669 → 0.218826199 |

Both still beat the older ridge-10 baseline, but that does not make the gate a
replacement for the better recent candidate. The comparison preserves all
three probability streams and original/recovered/expanded scorecards.

## What was tested

For every timing band and month, the gate inspects only earlier original-population
shadow predictions within the preceding 90 days. It enables an adjustment only
with at least 30 events and 10 games and strictly better Brier and log loss.
Recovered outcomes never influence the decision. The shadow predictions already
used strictly earlier fits. No coefficient or new raw model was fitted here.

The deterministic rule activates 42 of 72 band/month decisions. A separate Node
implementation verifies all decisions, exact past-key membership, declared
90-day windows, output hashes and routing of all 244,259 predictions. Neither
implementation independently establishes physical timing or prospective skill.

An initial descriptive month/band inspection showed the later fold's two-second
regression concentrated in November. The equal-band gate was declared to avoid
simply disabling that band after observing its outcomes. The observed failure
of this guard is retained as adaptive development evidence, not optimized away.

## Evidence

Result: `scripts/proof/results/timing-loss-gate-20260907-full`.
Health SHA-256:
`5b7ecd5822bfa2ebad014291938f638c87a93e3eed96c03fbc41035b240e443e`.

Runner/tests: `scripts/proof/run_timing_loss_gate.py`,
`scripts/proof/test_run_timing_loss_gate.py`.
Separate checker: `scripts/proof/review_timing_loss_gate.mjs`.

Three focused tests pass. Full offline regression: **3,583 passed**, 16 network
tests deselected, 33 existing warnings. Receipt:
`scripts/proof/results/timing-loss-gate-20260907-suite.xml`.

The [ungated recent-timing result](analytics-recent-timing-result-20260907.md)
remains the stronger tested timing comparator, not an accepted production model.
Same-clock overprediction, remaining band regressions, exact serving integration,
finishing/talent exposure and FPAR acceptance remain open. Original evidence,
goal credits and production are unchanged.
