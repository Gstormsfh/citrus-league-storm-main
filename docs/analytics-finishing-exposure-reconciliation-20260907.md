# Finishing exposure reconciliation

Completed `scripts/proof/reconcile_finishing_exposure.py` against the pinned
development export and the completed source-bound player-finishing ledger.
Results: `scripts/proof/results/finishing-exposure-reconciliation-20260907-full`.
No source exclusion, model, official actual, or production data was changed.

| Captured-source diagnostic | Fold 1 | Fold 2 |
| --- | ---: | ---: |
| Captured games in the season inventory | 1400 | 1400 |
| Whole games excluded by the source gate | 22 | 17 |
| Captured non-shootout unblocked attempts | 122066 | 122529 |
| Attempts represented by the composed model | 120080 | 121033 |
| Captured attempts not modeled | 1986 | 1496 |
| Captured goals not modeled | 153 | 112 |
| Captured shots on goal not modeled, including goals | 1409 | 1008 |
| Affected player/season/game-type records | 439 | 394 |
| Attempts with unresolved roster/player identity | 0 | 0 |

These are counts in retained captures, **not assertions that quarantined records
are accurate official actuals**. They do not establish complete official season
exposure or justify promoting rejected games. Player records separately expose
captured, modeled and missing exposure. A player with no missing captured events
still receives no talent-training or official-completeness authorization.

## Reasons made explicit

All 1986 missing fold-1 attempts are from whole-game
`source_gate:receipt_not_complete` exclusions. Fold 2 has 1495 attempts excluded
for the same reason and one otherwise source-accepted goal excluded for
`signed_angle_deg`: game/event **2023020594/488**, player **8478178**.

Inspection of the pinned receipts for all 39 excluded games found
`final_attempt_totals_mismatch` in their final-game evidence. All recorded
differences concern SOG: 22 team-field differences in fold 1 and 18 in fold 2.
This establishes the reason the existing gate rejected those games; it does not
identify which individual event or reported total is wrong. Do not repair these
by arbitrarily deleting a shot or redistributing its xG.

## Verification and preserved boundaries

The runner checks exact unique raw-stream membership and event hashes,
independently distinguishes non-shootout attempts using raw type/period fields,
and requires composed-model membership to equal the frozen geometry/source
eligibility. Included player, team and goal labels must match the source.
Every absent attempt needs an explicit exclusion reason. Unresolved actors would
remain visible in an unavailable bucket instead of being dropped. The source
closure is rehashed at completion.

Outputs retain missing event IDs, source hashes, actors, reasons and affected
games. Players remain separated by season and regular/playoff population.
The existing full-event player ledger retains team stints; this additional
coverage report does not overwrite it. No source-event omission is automatically
interpreted as zero exposure or zero finishing ability.

Thirteen focused tests cover missing geometry, whole-game quarantine, shootout
separation, unresolved actors, order and population invariance, duplicate or
tampered source events, detached outcomes, incorrect model membership, and
unexplained exclusions. Full-suite receipt:
`scripts/proof/results/finishing-exposure-reconciliation-20260907-suite.xml`.
Result: 3523 passed, 16 network tests deselected, 33 existing warnings.

## Concrete remaining work

Adjudicate the quarantined games against trustworthy independent event/boxscore
evidence, retaining all original captures and corrections in separate versions.
Separately handle the missing-angle event under an explicitly validated policy;
do not invent its location. Only then regenerate appropriate cohorts and test
whether expanded coverage improves calibration. Talent fitting still requires
strictly earlier evidence and a compatible out-of-fold neutral baseline.

A bounded retrieval attempt for NHL's PL020158 (2022–23) and PL020068
(2023–24) HTML play-by-play reports returned no usable page content through
web retrieval. That attempt supplies no independent adjudication and changes
none of the preserved exclusions.

A read-only current NHL API check of games 2022020158 and 2023020068 returned
the exact retained body hashes and unchanged plays. Both SOG disagreements
persist. A simple refresh therefore does not repair these two cases. The
timestamped diagnostic is `analytics-finishing-live-source-check-20260907.json`;
this is not independent adjudication of the events or all 39 games.
