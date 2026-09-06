# Official report v2: bounded retrospective source variant

This variant changes neither the frozen v1 parser nor its capture receipts,
source PBP, experiment dependencies, or model cohorts. It does not train a model.
It remains `retrospective_candidate_not_training_ready`, with publication and
historical-as-of claims disabled.

## Explicit historical team spellings

The following small mapping is corroborated by frozen official report headers,
their full team names, and the independently frozen schedule/PBP team IDs.
No arbitrary punctuation removal or fuzzy team matching is permitted.

| Official label | Canonical label / team ID | Official header evidence |
|---|---|---|
| S.J | SJS / 28 | [2017020004: San Jose Sharks](https://www.nhl.com/scores/htmlreports/20172018/PL020004.HTM) |
| L.A | LAK / 26 | [2017020012: Los Angeles Kings](https://www.nhl.com/scores/htmlreports/20172018/PL020012.HTM) |
| T.B | TBL / 14 | [2017020014: Tampa Bay Lightning](https://www.nhl.com/scores/htmlreports/20172018/PL020014.HTM) |
| N.J | NJD / 1 | [2017020019: New Jersey Devils](https://www.nhl.com/scores/htmlreports/20172018/PL020019.HTM) |

The parser requires the expected away/home order, game number, date, final marker,
canonical team ID, and full official team name before accepting an alias.
Attempt correspondence additionally requires the original PBP player/team/jersey
roster, period, clock, and event type to identify one report row uniquely.
Unknown actors and ambiguous matches remain unresolved. The report's original
team spelling, description and six raw event cells remain attached.

Example report-body SHA-256 bindings, also retained in the complete replay proof:

- 2017020004: `0963f2fb2ac86a3ab7c5278d2c0b7a11f816ea47ab3bd56869eb7cb436ceaa1a`
- 2017020012: `0c01c4cd79f9b0cf673a1342bdf41f435af30cb6f6b137c2d3bce95e4cea89dd`
- 2017020014: `0f4d87fa5ef56e1e6123709c0a563a2dcafd5b1afbd5c913e2c6f823016bc4f2`
- 2017020019: `69409470ac73b4a6d2277f45436025d9439316fb311ab2baf7d404bde2e2970d`

## Terminal administrative marker

Besides an existing v1-compatible GEND ending, v2 accepts only a final
PEND/GEND/GOFF triple at the same period and elapsed clock, with exactly one
GEND and GOFF in the complete numbered report. Nonterminal or duplicate GOFF
is rejected. All v1 header, clock, contiguous row-number and monotonicity checks
remain in force. No clock is repaired and no raw row is deleted.

Full `report_type_counts` retain every event. Separate
`report_gameplay_type_counts` omit the validated terminal GOFF (and the already
recognized pregame markers). Each GOFF exclusion records row number, period,
clock, raw-cell digest and administrative reason. Shootout/population semantics
are not broadened in this change.

## Evidence and limits

The create-only offline replay script is `scripts/proof/replay_report_v2.py`.
It requires exact requested receipt membership, validates report and original
PBP body/receipt hashes, checks the loaded first-party source-code closure before
and after the run, and retains per-game outcome, correspondence ambiguity and
source references. The parser returns all report rows; compact proof rows bind
their digest to the retained original body.

Report order is a distinct retrospective representation, not proof of original
delivery order. Report distance and PBP coordinates are not independent sensors
or tracking. Diagnostic distance agreement does not approve orientation. Negative
clocks, missing game-end evidence, unknown aliases, and unresolved identities
must remain visible. No statistical accuracy or model-acceptance claim follows
from parser coverage.

## Completed offline replay

The replay covered the exact retained request inventory: 1,355 games from season
2017 and 1,358 from season 2018. Of 2,713 report/source pairs, 2,668 parsed and
passed the unchanged PBP source gates; 45 remain unavailable. This is not a
training-cohort count.

| Remaining gate | Games |
|---|---:|
| Original PBP final/population gate unavailable | 33 |
| Missing supported terminal stream | 4 |
| Unsupported GOFF placement or terminal ordering | 6 |
| Invalid report clock | 2 |

All four reviewed alias spellings resolved at the report-header level. The run
retained 93 validated terminal GOFF rows as explicit administrative exclusions.
Complete attempt correspondence holds for 2,336 games, but parsing success or
that count alone must not authorize training. Only 1,918 have both complete
attempt correspondence and matching gameplay-type counts; all remaining
ambiguities and unmatched rows are retained in the proof.

Specific unresolved terminal/clock cases: 2017020008, 2017021196, 2018020367 and
2018020520 lack a supported ending; 2017020463 and 2018020989 contain invalid
clocks. GOFF cases 2017020096, 2017021233, 2018020773 and 2018020965 place GOFF
before subsequent rows. Games 2018020238 and 2018020416 end GEND/PEND/GOFF rather
than the approved PEND/GEND/GOFF sequence; v2 deliberately does not broaden that
rule or reorder their rows.

The full create-only proof was copied unchanged to
`scripts/proof/results/historical-report-v2-replay-20260906.json`, SHA-256
`eed76ee4e40b4d9aa94673ac4a0f81347a805c11f2f3d7ecfa3f0ce4752eb246`.
Root independently rechecked 10,867 referenced source/code files and reran the
54 combined tests successfully. The proof binds 15 loaded first-party source files and the runtime,
all requested receipt identities, report/PBP body and receipt hashes, per-game
row digests, administrative exclusions, and all unresolved correspondences.
The old v1, v2, and terminal-review tests passed together (54 tests).
