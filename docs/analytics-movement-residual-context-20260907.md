# Additional movement context: diagnostic findings

Read-only diagnosis of the continuous candidate's original fast-lateral cohort. No model parameters or production data changed. These are exploratory 2025–26 development findings, not evidence of causality or prospective performance.

The continuous correction already has smooth distance/time effects. It still combines hits, takeaways, giveaways and blocked shots into one movement surface, and does not interact that surface with angle change, centerline crossing or final shot location. Those geometry/context inputs already exist in the underlying base model; this finding is about residual interaction modeling, not newly discovering their existence.

## Where the excess predicted goals occur

| Recorded event pair | Events | Actual goals | Continuous xG |
|---|---:|---:|---:|
| Does not cross lateral y=0 (goal-to-goal centerline) | 3,355 | 198 | 281.008 |
| Crosses lateral y=0 | 3,819 | 423 | 439.811 |

About 83 of the cohort's 99.819 excess xG comes from non-crossing event pairs. This is not a confirmed pass-crossing measurement and does not hold other shot characteristics constant.

| Prior event | Actual goals | Continuous xG |
|---|---:|---:|
| Saved shot / shot-on-goal | 378 | 403.768 |
| Missed shot | 128 | 128.608 |
| Blocked shot | 70 | 95.608 |
| Takeaway | 36 | 64.442 |
| Hit | 7 | 23.508 |
| Giveaway | 2 | 4.885 |

Missed-shot sequences are close in aggregate, while several categories currently sharing the "other" movement surface are overestimated. Final shot location also matters: under-10-foot shots total 281.166 xG against 277 goals; 20–35-foot shots total 135.711 xG against 90 goals. These tables overlap; their errors cannot be added across tables.

## Source information and limits

The inspected source details include event type, coordinates, zone, shot type and player/goalie identifiers. The preceding shot records can support checking whether the next shot is taken by the same or a different recorded shooter, subject to identifier availability. This is not proof of a completed pass or continuous possession.

The inspected fields do not provide a complete pre-shot pass trajectory, pass-release timestamp, or goalie-position track. Current-event assist identifiers appear only on goals in this cohort; using their availability or values as a pre-shot feature would leak the outcome. Goal-specific scores, scoring totals and highlight fields must likewise not become predictors.

## Next test supported by this diagnosis

Test continuous movement interactions with angular change, centerline crossing and final shot geometry; separate sufficiently supported prior blocked-shot/turnover/contact contexts. Do not indiscriminately reduce missed-shot or close-range sequences. Fit on earlier data and check separate calibration evidence; do not fit to these latest-season totals.

Evidence: `scripts/proof/inspect_movement_residual_context.mjs` and `scripts/proof/results/movement-residual-context-20260907.json`. Candidate prediction and feature hashes were verified, all 7,174 cohort rows joined to full features and raw preceding events, labels checked, and raw source body hashes recorded.
