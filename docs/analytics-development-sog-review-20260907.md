# Development source discrepancies: exact-event statistical review

Completed a source-review milestone, not a model release: **37 of 39** previously
quarantined development games now have corroborated exact-snapshot statistical
treatment. The original source gates, exports, models and production remain
unchanged. Two games still need affirmative event-level evidence.

## What changed

The existing first-party report collector successfully retrieved and retained
all **117** PL, ES and GS reports for the 39 games. Earlier browser retrieval
failures were not evidence that those reports were unavailable through every
route. This pass reused existing collection/parsing work; it did not copy
MoneyPuck files, predictions, weights or data.

The first review supported 28 games and 29 own-goal events. The additive v2
review retains that result and additionally handles:

- One exact team/sweater/period/clock match whose NHL roster surname is
  `Välimäki` but whose report spells it `VALIMAKI`. Accent normalization does not
  change original report bytes or their row hashes, and ambiguous matches fail.
- Eight specific awarded/displaced-net cases with manually inspected, separately
  captured official NHL narratives. Each locator binds the exact article bytes,
  retrieval timestamp and paragraph hash to the reviewed original event.

The completed v2 supports **38 non-shot goal events in 37 games**. These games
contain 3289 captured non-shootout attempt-coded events and 244 goal credits.
Separating the 38 non-shot goal credits leaves **3251 potential shot attempts**
for a future validated feature replay. This is not 3251 newly scored predictions
and does not establish complete missed-shot correspondence or feature eligibility.

## Statistical evidence and semantics

Every supported case requires:

1. Exact original NHL body and receipt hashes, and preserved raw goal identities.
2. Matching game/date report headers and full original roster identities.
3. Exact PL goal team, sweater, surname, period and clock matches. PL row numbers
   remain report locators, never substitutes for JSON event IDs.
4. Matching unadjusted JSON/PL player distributions for goals and shots on goal.
5. Either an explicit PL own-goal label or the separately reviewed official
   explanation of the specific awarded goal—not a missing-shot-type heuristic.
6. Corrected counts matching every ES player and team, plus both GS goalie/team
   totals. Aggregate agreement alone never selects an event for correction.

Each supported overlay preserves `goal_credit: 1`, specifies
`recorded_sog_contribution: 0`, excludes that event from the base-shot model, and
assigns **no probability** (`model_probability: null`), not zero probability.
The entire original event and all prior probabilities remain unchanged.

Examples of affirmative official evidence include the
[Cousins displaced-net decision](https://www.nhl.com/news/florida-panthers-vegas-golden-knights-game-recap-339531474),
[Coleman awarded goal](https://www.nhl.com/news/florida-panthers-calgary-flames-game-recap-december-18),
and [Jarvis awarded goal](https://www.nhl.com/hurricanes/news/necas-first-nhl-hat-trick-guides-canes-past-avalanche).
The executable v2 review contains the exact case/event/paragraph bindings; these
general links alone are not reusable statistical approval for other events.

## Unresolved and next gates

- **2022020489 / event 805 (Kakko)**: the captured NHL recap records the final
  empty-net goal but does not explicitly explain the award. Secondary reports
  and aggregate agreement were not substituted for the required primary proof.
- **2022020677 / event 757 (Pavelski)**: independent event-level narrative/video
  evidence remains insufficient in this pass. SOG reconciliation alone does not
  approve a correction. Legacy clip links returned no usable video-page content.
- The separate missing-angle goal **2023020594/488** remains unresolved by this
  SOG review; its source game did not have a SOG discrepancy.

No existing cohort may silently absorb these changes. Next implementation must
bind the exact reviewed overlays to a separately versioned source/feature path,
preserve credited goals outside the shot-model population, verify full relevant
event correspondence and causal features, and then evaluate the expanded cohort.
The already inspected validation periods remain development data.

Finishing statistics must distinguish **all goal credits** from **shot-event
goals**. A no-shot awarded goal is still an official goal; it must neither be
deleted from actuals nor treated as evidence of converting a modeled shot.
Do not feed such aggregate credits into the earlier quantity contract's
`goals <= shots_on_goal` assumption without a separately typed exposure contract.

## Artifacts and verification

- `development-sog-reports-20260907-full`: report bodies, HTTP receipts, all
  affected-team goal candidates, preliminary own-goal matches and complete ES rows.
- `development-own-goal-review-20260907-full`: preserved first review, including
  its unresolved accent match; no result was overwritten.
- `development-award-narratives-20260907-full`: nine captured NHL explanations
  and locators; retrieval alone does not adjudicate them.
- `development-sog-review-v2-20260907-full`: 39 case results, exact supported
  overlays, full statistical comparisons, source closure and summary.

All paths above are under `scripts/proof/results`. The v2 health SHA-256 is
`16680815820947089d05942a82f599580369ec9aa014b0d394890f85ebdb8542`.

Full offline regression: **3532 passed**, 16 network tests deselected, 33 existing
warnings. Receipt: `development-sog-review-20260907-suite.xml`. Focused additions
check all-goal candidate preservation, exact report headers, multiple corrections,
goal-credit preservation, negative/missing exposure, accent matching, ambiguity
rejection, and withholding when player or goalie totals disagree. Legacy report
and source-adjudication tests also remain in the full suite.

This is a solo review using separate source/statistical checks, not a new agent's
independent sign-off or a claim of prospective model improvement.
