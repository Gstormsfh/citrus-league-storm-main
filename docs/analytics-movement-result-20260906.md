# Corrected movement: full replay and matched experiment completed

This experiment restores explicit lateral displacement, elapsed-time/rate,
cross-centre and legacy-style movement interactions to a first-party development
candidate. It is not the complete original Citrus model or a production rollout.
Original inputs, source observations, scores, failed fits and future reservations
remain retained. No MoneyPuck observations or predictions were used.

## Full source coverage

`scripts/proof/results/movement-coverage-20260906-full/result.json` records
successful replay of 541,067 unique eligible events across 6,272 games. Immediate
recorded-event geometry is available on 403,396 events; prior same-team unblocked
attempt geometry on 146,529. Missing context remains missing. These are recorded
event proxies, not measured passes or goalie tracking.

## Matched primary result

Lower is better for both losses. Same original populations and settings; the
primary calibrator is fitted only on the original earlier calibration slice.

| Fold | Frozen baseline Brier | Movement Brier | Frozen baseline log loss | Movement log loss |
|---|---:|---:|---:|---:|
| 1 | 0.0612283213 | 0.0611268879 | 0.2254148455 | 0.2250946088 |
| 2 | 0.0601003101 | 0.0601017562 | 0.2219929914 | 0.2219653151 |

Primary improves both point losses in fold 1, but fold 2 Brier is slightly worse.
**Declared both-losses/both-fold gate fails.** Do not round that failure away or
promote a fallback winner. All raw/sigmoid/monotone candidates, uncertainty,
subgroups and bins are preserved in the original scorecards.

Evidence root: `scripts/proof/results/official-movement-20260906-full/`.
Independent JS review at `movement-candidate-review-20260906-full/` verifies
12,881 file hashes and exact baseline events/outcomes/groups/probabilities plus
point/bin/subgroup arithmetic. It is not an independent refit or bootstrap.
Source/vector check at `movement-vector-review-20260906-full/` compares all 3,849
selected rows in 45 deterministic games: 92,376 exact values match. It uses the
same frozen projector but independent named flattening, so this establishes
delivery parity, not independently derived physics.

The newly implemented fixed-feature-transform module is separately tested; this
matched run deliberately retains the original development design/imputation to
isolate the appended feature family. Neither this nor the narrower event-memory
experiment is a complete original-feature replacement. Zone/quality, rink,
penalty/shift and downstream-family gates remain explicit in the coverage ledger.

Retrospective inspected development periods are not untouched prospective tests.
No industry-superiority or serving-acceptance claim is supported by this result.
