# Raw follow-up clock and report audit

This closes the immediate saved-gap/source-prefix consistency investigation
raised by the [timing residual diagnostic](analytics-expanded-timing-diagnostic-20260907.md).
It does not establish physical shot timing or solve the model's timing bias.

## Raw-source result

All evaluated rows with the immediate-prior-same-team-SOG feature set were checked
against their original raw event and immediately preceding raw play:

- Fold 1: 17,515 pairs verified; zero prior-event or saved-gap mismatches.
- Fold 2: 17,266 pairs verified; zero prior-event or saved-gap mismatches.
- All 34,781 pairs have matching elapsed/countdown-clock differences; none lack
  the second clock.

Checks require previous type 506, same team and period, non-shootout context,
exact nonnegative gap and matching raw outcome. Event hashes and prior IDs are
retained. This audit covers the positive prior-SOG population, not every possible
negative feature-classification error or every other model input.

Same-shooter/same-coordinate records are rare. For example, the original later
fold has 27 such one-second pairs among 3,310 events, with zero goals in that
subset. This cannot account for the broad observed timing residual. Coincident
shooter/location is only a descriptive flag, not proof of a duplicate; nothing
was removed or relabeled.

## Separate official report check

Before retrieval, the collector saved a deterministic selection: earliest
game/event ID in each fold × three timing bands (same clock, one second,
three-to-ten seconds) × goal/non-goal cell, from the original population.
This is a bounded diagnostic sample, not a representative survey.

Twelve pairs across seven NHL PL reports were checked against team/sweater,
event type, period and clock, after report date/game-header validation.
Eleven pairs have distinct unique exact row matches. The remaining pair,
`2022020014/480→481`, has two FLA Balcers shots at 17:59, with distinct reported
distances but otherwise shared matching fields. Both report clocks support the
same-clock grouping; this checker does not establish a unique raw/report row
mapping for that pair. No ordinal correspondence was invented.

The reports and API may share upstream recording systems. Agreement is not
independent video/tracking verification and cannot exclude shared recording bias.
There is **no demonstrated timestamp corruption to correct** from these checks.

## Methodology cross-check

Re-read MoneyPuck's public methodology: event movement rates and angular change
over elapsed time are relevant inputs, but flurry discounts are downstream credit
accounting—not a correction for miscalibrated individual shot probabilities.
Its page also notes an example of inaccurate recorded location. These motivate
source/measurement caution, not importing their files or changing Citrus's
timestamps. [MoneyPuck methodology](https://www.moneypuck.com/about.htm).

NHL documented a 2023–24 site/app technical rebuild; that does not establish a
clock-semantics change. [NHL announcement](https://www.nhl.com/news/nhl-edge-advanced-stats-section-brings-fans-closer-to-game).

## Evidence and tests

Scripts and tests:
`scripts/proof/audit_raw_followup_clocks.py`,
`scripts/proof/test_audit_raw_followup_clocks.py`,
`scripts/proof/check_followup_report_clocks.py`,
`scripts/proof/test_check_followup_report_clocks.py`.

Raw audit: `scripts/proof/results/raw-followup-clock-audit-20260907-full`.
Health SHA-256:
`1ed619dbe91b839ec13f69d881b18f5fa60830a2cfefae1b5be3921b51300d6e`.

Report capture/check: `scripts/proof/results/followup-report-clock-check-20260907-full`.
Health SHA-256:
`8b934a8e2bf0fc6476fc258b2e6df65fb2af05afe7d9fdde8a602626a1271478`.
Raw report bodies, request/retrieval metadata and selection are preserved.

Six new focused tests pass. Full offline regression: **3,576 passed**, 16 network
tests deselected, 33 existing warnings. Receipt:
`scripts/proof/results/raw-followup-clock-audit-20260907-suite.xml`.

## Consequence for the next experiment

Do not alter event times, discard genuine same-clock observations, or apply
flurry credit as if it were corrected xG. Keep frozen predictions and source
evidence intact. A bounded chronology-safe timing-adaptation comparison is now
appropriate, with all non-timing features preserved, training restricted to
earlier completed games, and original and recovered evaluations separate.
Any such comparison remains adaptive historical development—not proof of a
feed change, untouched testing, model acceptance or production readiness.

No new candidate was fitted in this audit. Production, original models and
all recorded goal credits remain unchanged. Finishing/talent and FPAR acceptance
remain open rather than being inferred from completion of this source check.
