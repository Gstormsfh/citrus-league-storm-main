# Development-era timing audit

## Result and scope

The create-only `scripts/proof/results/timing-era-audit-20260906-full` run reconciles every original eligible development event: **541,067 events, 6,272 represented games, 38,132 goals**. Health SHA256: `a34674802dcdbc52d875c738d2a5278a40535dcd6484e2495a998d8b642bd499`.

The fixed plan is [analytics-timing-era-audit-plan-20260906.md](analytics-timing-era-audit-plan-20260906.md), SHA256 `160481f8b77a2d833546077cb8ffc27ba77730d85c2ddd94b000c64ce8a77d9a`. Original source seasons are 2019–2023, not later-year evaluation bodies. No fitting, changed labels, invented training predictions, removed events, production changes or model acceptance occurred. Original excluded/quarantined evidence remains unchanged.

Every eligible event's date, target, saved numeric prior-SOG state, categorical predecessor type, feature hash and source-envelope hash reconciled with the pinned export and raw body/receipt. This verifies those fields and membership; it is not a fresh reconstruction of every movement feature. Signed raw coordinates and unknown actor comparisons remain explicit. Actor equality is retrospective source diagnostics, not a prediction input.

## Timing pattern

The following counts come directly from `accounting.json` → `season_state_gap`, for an immediate same-team shot-on-goal predecessor. This original state has **no rebound-time cutoff**. Rates are descriptive goals divided by eligible events, not predictions or causal estimates.

| Season start year | Same clock: goals/events (rate) | Exactly one second: goals/events (rate) | Exactly two seconds: goals/events (rate) |
| --- | --- | --- | --- |
| 2019 | 173/444 (38.96%) | 326/1,812 (17.99%) | 314/1,547 (20.30%) |
| 2020 | 108/282 (38.30%) | 250/1,443 (17.33%) | 242/1,076 (22.49%) |
| 2021 | 172/458 (37.55%) | 376/2,267 (16.59%) | 376/1,859 (20.23%) |
| 2022 | 110/403 (27.30%) | 359/2,824 (12.71%) | 388/2,127 (18.24%) |
| 2023 | 7/279 (2.51%) | 134/3,310 (4.05%) | 415/2,353 (17.64%) |

The short-gap decline is not confined to a playoff mix change. Regular-season same-clock rates are 101/382 in 2022 versus 6/265 in 2023; one-second rates are 326/2,621 versus 131/3,127 (`season_state_gap_game_type`). Playoff denominators are smaller and must remain visible.

Nor is the pattern solely an increase in identical-coordinate records or a switch between same and different shooters. For different coordinates and different actors, same-clock counts are 84/257 versus 5/130; with different coordinates and the same actor they are 26/142 versus 2/146 (`season_state_gap_coords_actor`). These are coarse descriptive strata, not controls for every confounder.

The low rates are already visible in October 2023: 1/32 same-clock events and 12/332 one-second events (`month_state_gap`). This is a retrospective observation, not an independently selected change-point estimate. It does not establish when the stored source records acquired their current form.

## Public methodology and limits

MoneyPuck publicly describes event distance divided by elapsed time and rebound angle change divided by elapsed time. Its writeup does not specify the handling of zero elapsed time or explain the source-era discontinuity found here. Citrus's existing temporal and movement inputs remain relevant; this audit does not mean they were absent. [MoneyPuck methodology](https://moneypuck.com/about.htm)

The hockeyR author's README documents the NHL API replacement and scraper changes in November 2023. An API migration is not proof of changed clock semantics, and an October pattern in currently retained records cannot establish the historical timing of revisions. [hockeyR author documentation](https://github.com/danmorse314/hockeyR)

No MoneyPuck data files, predictions or model artifacts were acquired for this audit. Recording-system changes, scoring/event ordering, clock conventions and event composition remain hypotheses. Consistent recorded inputs do not certify physical shot chronology or historical live availability.

## Next model gate

Preserve the original timing values. Do not add arbitrary seconds, erase same-clock events, or apply a post-outcome correction. The next candidate should test whether a predeclared, earlier-data-only timing-conditioned calibration policy improves Brier score and log loss relative to the already completed expanding calibration baseline, while retaining all movement, talent and finishing work. These already inspected years remain adaptive development evidence, not an untouched acceptance set. FPAR and production promotion remain unaccepted until their foundation gates pass.

## Verification

Author and independent Python checks: 48 passing. Full offline Python regression: 3,334 passing, 16 network tests deselected, 33 existing deprecation warnings; receipt `scripts/proof/results/timing-era-audit-20260906-suite.xml`. Independent Node checker unit tests: 26 passing.

The separate `scripts/proof/results/timing-era-review-20260906-full` checker completed successfully. Health SHA256: `8c07fe4a099ceaf0e265116141c5d473dd6c6d3f09f2d5749cdde8a79394e077`. It independently joined every event to the original export, recomputed saved clock/state/coordinate/actor arithmetic, compared all 1,157 accounting cells, and verified 13,166 source/code hashes. This second implementation checks retained row diagnostics and exact membership, not a separate full raw-body feature reconstruction or physical chronology.
