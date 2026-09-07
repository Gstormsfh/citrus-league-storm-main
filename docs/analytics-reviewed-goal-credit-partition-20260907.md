# Reviewed goal credit and shot-event partition

Offline continuation of the [source review](analytics-development-sog-review-20260907.md).
No original play, receipt, completed experiment, cohort, model, or production data
was changed. This is statistical/source validation, not a new accuracy result.

`scripts/proof/partition_reviewed_goal_credit.py` binds the exact v2 review health
and consumed source hashes. It verifies each reviewed overlay against the raw
event hash, player/team identity and non-shot semantics. Duplicate IDs, absent
events, shootout substitutions and changed statistical totals fail closed.

The sidecar retains an ordered entry for every raw play. Awarded/own-goal credits
stay in that history; they must still affect downstream score state. It separates
official goal credits, shot-event goals, recorded SOG and statistical shot attempts.
No model probability, neutral xG or estimated talent is fabricated. A descriptive
credited-goals/SOG percentage may exceed 100%; shot conversion cannot. Neither is
an estimate of persistent finishing talent.

The additional PL check compares full actor/type/period/clock multisets for GOAL,
SHOT and MISS, with multiplicity. It does not pretend that otherwise identical
same-clock events establish a unique report-row join.

## Result

Of the 37 statistically supported games, **36 pass this stronger correspondence
check**. They retain 11,387 raw-history entries and 238 official goal credits:
201 shot-event goals plus 37 reviewed non-shot goal credits. Their statistical
exposure is 2,169 SOG and 3,146 shot attempts. These are **not newly feature-complete
or scored model rows**.

Game `2022020673` remains statistically supported but fails the stronger source
check: official PL row `PL-208`, period 2 at 11:24, identifies a VGK miss without
a sweater number (`VGK # , ...`). No shooter is inferred to close this gap. Its
previous statistical evidence remains preserved. Games `2022020489` and
`2022020677` still lack sufficient reviewed non-shot-goal evidence and never
enter this partition. The separate missing-angle event is unchanged.

Result: `scripts/proof/results/reviewed-goal-credit-partition-20260907-full`.
Health SHA-256:
`939dd885644ff900afd86d582b9ec1c136c7c22d3177859a6f8b42e1ed9184d1`.
A separate Node arithmetic/hash check reproduced the totals and verified every
health-listed output. This is not independent human/agent adjudication.

Focused tests: 13 passed. Full offline suite: **3,545 passed**, 16 network tests
deselected, 33 existing warnings. Full-suite receipt:
`scripts/proof/results/reviewed-goal-credit-partition-20260907-suite.xml`.

## Remaining implementation gates

The partition is not wired into feature export or production. Next is a separately
versioned, exact-review-bound feature path with full causal feature reconstruction,
including preserving non-shot goal score-state effects without counting them as
prior shot attempts. That path must establish geometry, movement and context
availability before replaying frozen candidate probabilities. Expanded-cohort
evaluation remains retrospective development, not an untouched holdout. Official
appearance/TOI coverage, validated talent estimation and FPAR acceptance remain
separate open gates.
