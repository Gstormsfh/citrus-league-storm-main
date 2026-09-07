# Full PBP pre-shot review and tested addition — 2026-09-07

## Outcome

The recursive census covered 1,394 archived 2025–26 games, 443,569 events and 162 distinct JSON paths. This includes raw games outside the established eligible evaluation cohort. No new provider was added. Production is unchanged.

A new offline residual candidate combines continuous geometry interactions with the **previous** same-team miss/block reason. Legacy acquisition already retains miss reasons; the addition is their causal use as history for the next shot, not a newly collected field.

## Source landscape and disposition

| Available information | Treatment / opportunity |
|---|---|
| Coordinates, event order/type, period clock, team ownership and defending side | Existing oriented shot geometry and recorded-event movement are preserved. Connections between recorded coordinates are not confirmed passes or tracked puck paths. |
| Prior missed-shot reason: post, crossbar, wide, short, high, failed bank attempt | Tested below, strictly from the preceding eligible event. Current-shot reason is forbidden because it reveals the current outcome. Rare/unseen categories receive no added reason correction. |
| Prior blocked-shot reason: blocked, teammate-blocked, other-block | Tested as prior-event context. Blocking-player identity is available, but not a measured defensive screen or puck trajectory. |
| Crossing, angular change, lateral movement, origin behind the net | Tested jointly with elapsed time and current shot distance rather than treating all fast lateral events equally. |
| Faceoff winner/loser, coordinates/zone and elapsed time | Additional candidate: winning-team/zone/time interactions. Not newly tested in this review; do not count as an improvement. |
| Previous/current shooter IDs | Same-versus-different-shooter history is a possible next test, not proof of a pass. Historical shooter/goalie conditioning has already been investigated; retain those results. |
| Situation code, scores and goalie identity | Existing pre-shot strength/score context must remain causal. Post-goal scores and final-game metadata cannot be substituted directly. |
| Penalty type, duration, committed/drawn/served player | Available prefix history, not an exact penalty-expiry clock. Recorded-penalty experiments already exist and did not consistently pass both folds. |
| Hits, turnovers, stoppage reasons and previous attempts | Available event history. Counts/strength-spell/event-memory experiments already exist; mixed results do not establish that every individual component is useless. |
| Roster position and player/team identity | Present. Handedness and shift timelines are not present in `rosterSpots`; do not invent them. |
| `timeRemaining`, final clock/state/outcome, venue and identifiers | Some fields are redundant or metadata. Final-state information is not valid pre-shot context. Identifiers support joins/provenance, not arbitrary numeric predictors. |
| Assists, scorer totals, goal counters and highlight metadata | Current-goal information is outcome-dependent. Keep for retrospective insights, not ordinary xG predictors. |
| Event-envelope `pptReplayUrl` | Important linked tracking source identified in the preceding review. Archived links are goal-selected; the pilot recovered player/puck frames but not representative non-goal tracking. Keep for exploratory retrospective insights, not xG training inputs. |

The complete machine-readable path/type/occurrence inventory, source hashes and reason distributions are in `scripts/proof/results/pbp-field-census-20260907/`. This census describes the inspected archive, not a guarantee that future payloads cannot add fields.

## Experiment

Runner: `scripts/proof/test_prior_reason_geometry.py`.

Two arms were specified: geometry alone, and geometry plus prior reason. Both are regularized log-odds residual adjustments to the saved continuous-event candidate, with no additional intercept. They are not hand-assigned probability percentages.

The geometry arm adds crossing/noncrossing decay, angle-change decay, angle × closeness × decay, lateral distance × closeness × decay, and behind-net-origin decay. Decay is continuous `exp(-elapsed_seconds / 3)`; closeness is `exp(-shot_distance / 20)`. No division by zero-time is used. These are recorded-event proxies, not confirmed goalie movement.

Prior reason is taken only from the immediate eligible same-team missed/blocked event selected by the existing boundary-aware history projection. Supported reason categories require at least 100 earlier events and five examples of each outcome. Reason coefficients also decay with elapsed time. Current-event labels/reasons, future events and goal assists are excluded.

Fitting uses 2023–24 prequential base predictions and earlier labels, ending 2024-06-24. The continuous transform and added residual both use this earlier fitting season; their calibration is not independently fitted. Evaluation uses the existing 2025–26 cohort. That season has informed repeated hypotheses and is **adaptive development, not an untouched holdout**.

## Results on the same 116,506 shots

| Metric | Saved continuous candidate | Geometry | Geometry + prior reason |
|---|---:|---:|---:|
| AUC ↑ | 0.773799557 | 0.774186354 | 0.774266512 |
| Brier ↓ | 0.060218251 | 0.060200679 | 0.060189809 |
| Log loss ↓ | 0.221619369 | 0.221494442 | 0.221448881 |
| Equal-width 10-bin ECE ↓ | 0.005405496 | 0.004703096 | 0.004751950 |
| Mean prediction bias | +0.005305363 | +0.004532798 | +0.004449007 |
| Shot-level Pearson correlation ↑ | 0.309941014 | 0.309993650 | 0.310253943 |
| Fast-lateral expected goals; actual 621 | 720.8193 | 684.7692 | 682.3274 |

Most of the fast-lateral correction comes from geometry. Prior reasons add a smaller gain in AUC/Brier/log loss/correlation and bias, but slightly worsen ECE versus geometry alone. Fast-lateral overprediction remains; these results do not establish finished calibration or industry-leading accuracy.

## Verification and uncertainty

- Independent metric calculations agreed within 1e-11.
- Three focused unit tests passed: current/future outcome isolation, boundary/opponent exclusion, and missing/unseen input handling.
- Full raw-source/full-feature replay reproduced all 116,506 predictions with maximum absolute error **0.0** for all three arms.
- Fixed-fit, paired-game bootstrap: 2,000 resamples. Combined-minus-continuous Brier 95% interval: **[-0.0000428547, -0.0000130935]**. Combined-minus-geometry interval: **[-0.0000225179, +0.0000011599]**. Thus the reason-only incremental improvement remains uncertain.
- Bootstrap intervals do not adjust for adaptive hypothesis selection or refitting uncertainty. They are not a production promotion gate by themselves.

Evidence: `scripts/proof/results/prior-reason-geometry-20260907/{summary,fits,predictions}.json` and `scripts/proof/results/prior-reason-geometry-replay-20260907/{summary,bindings,health}.json`. Replay runner: `scripts/proof/replay_prior_reason_geometry.py`.

## Preserved related evidence

- `analytics-continuous-event-movement-20260907.md`: preceding candidate and continuous timing/lateral transform.
- `analytics-event-memory-result-20260906.md`, `analytics-recorded-penalty-result-20260906.md`, `analytics-forward-shooter-result-20260906.md`: earlier investigated families, including unsuccessful experiments.
- `analytics-linked-tracking-source-revisit-20260907.md`, `analytics-linked-replay-pilot-20260907.md`: linked tracking discovery, repeatability and coverage limitations.
- `analytics-recorded-sequence-maps-20260907.md`: repeatable recorded-event sequences for insights without representing them as confirmed passes.

Disposition: preserve both fitted arms and all evidence. No serving model, production weights, database or deployment changed in this review.
