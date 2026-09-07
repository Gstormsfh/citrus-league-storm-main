# Expanded-population timing diagnosis

Frozen predictions only: no fitting, parameter sweep, source mutation or
production change. This extends the [recovered-shot evaluation](analytics-recovered-xg-evaluation-20260907.md)
with timing × skater strength × defending-goalie-presence slices and monthly
residuals, keeping original/recovered/expanded populations separate.

## Finding

The fast-follow-up bias persists within **five-on-five, goalie-present** play.
It is therefore not explained solely by different strength or empty-net mixes.

| Expanded development slice | Shots | Goals | Calibrated xG | Monthly bias direction |
| --- | --- | --- | --- | --- |
| Fold 1, same-clock prior same-team SOG | 310 | 82 | 101.464 | Over in 8/9 months |
| Fold 1, one-second prior same-team SOG | 2,093 | 240 | 310.828 | Over in 8/9 months |
| Fold 2, same-clock prior same-team SOG | 218 | 4 | 46.659 | Over in 9/9 months |
| Fold 2, one-second prior same-team SOG | 2,485 | 82 | 240.848 | Over in 9/9 months |
| Fold 2, three-to-ten-second prior same-team SOG | 4,354 | 463 | 322.566 | Under in 8/9 months |

The later fold's expanded bias intervals remain away from zero in these three
timing slices: same-clock [+0.172946, +0.214902], one-second [+0.056587, +0.070418],
three-to-ten-second [-0.040783, -0.024887]. These are descriptive 95% percentile
game-bootstrap intervals (512 draws, seed 60908), not multiple-testing-corrected
significance claims or prospective acceptance tests. Models/calibrators are not
refitted in these resamples. Tiny recovered-only cells must not be treated as
stable estimates even when their bootstrap interval is narrow.

In contrast, overall five-on-four expanded bias is approximately +0.00352 and
+0.00392, with both intervals crossing zero. That aggregate does not eliminate
possible timing-by-strength problems, but it does not support prioritizing a
blanket power-play correction ahead of the clear timing residual.

The marked difference in goal rates between historical timing bands is a reason
to investigate source timing semantics and extraction parity. **It does not by
itself prove a feed change, duplicate event, missing physical feature, or causal
mechanism.** The next bounded investigation should compare original raw event
prefixes, saved gap inputs, and independent report clocks for these exact timing
cases before choosing a chronology-safe adaptation experiment. Do not immediately
fit offsets to these evaluated outcomes or continue an undeclared penalty sweep.

## Evidence

Runner: `scripts/proof/diagnose_expanded_timing.py`; tests:
`scripts/proof/test_diagnose_expanded_timing.py`.
Completed result:
`scripts/proof/results/expanded-timing-diagnostic-20260907-retry1`.
Health SHA-256:
`1e564c39f0a10aeb8fcb1903777cb05617cbb1bca2274bbb84b8049cf80169bf`.

Membership: 121,749 and 122,510 events. Original monthly gap inputs are joined by
unique game/event IDs to frozen calibrated predictions and target/group records.
Recovered gaps and goalie indicators come from the exact corrected feature rows.
Unknown goalie status is retained explicitly; it is not folded into goalie-present.

The first attempt stopped before emitting scorecards because historical null
goalie groups were not yet mapped to the explicit unknown category. Its scoped
output directory remains preserved. The retry retains nulls as unknown, with no
source changes. Twelve focused tests cover timing boundaries, unavailable/invalid
gaps, non-prior-SOG handling and residual/bootstrap arithmetic.

Full offline regression: 3,570 passed, 16 network tests deselected, 33 existing
warnings. Receipt: `scripts/proof/results/expanded-timing-diagnostic-20260907-suite.xml`.
No model acceptance, FPAR acceptance or production rollout is implied.
