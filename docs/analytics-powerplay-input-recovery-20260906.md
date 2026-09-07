# Power-play and shooter-side penalty input recovery

The original design already included `is_power_play`, `time_since_powerplay_started`, skater counts, empty-net flags, `penalty_length` and `penalty_time_left`. These must remain visible in the coverage ledger. The problem is their computation and provenance, not absence of the design.

This checkpoint is diagnostic only: no original modules, fitted artifacts, experiments or production state were changed. `data-pipeline/tests/test_legacy_powerplay_diagnostics.py` contains 16 passing **defect-reproduction** checks. They AST-execute only the inspected parser/timing statements, never import acquisition or deserialize models. Passing these tests confirms the documented legacy behavior; it does not approve that behavior.

## Source and reproduced defects

| Existing path | Direct finding | Required correction |
| --- | --- | --- |
| `data-pipeline/acquisition/data_acquisition.py:1328` and `:2925` | Legacy numeric decoder assigns the middle digits to home/away in the opposite order to the corrected causal projector. Diagnostic `1451` returns home=4, away=5 rather than home=5, away=4. | Preserve the four raw digits and explicitly map away goalie, away skaters, home skaters, home goalie; then derive the current shooter's perspective using authoritative team IDs. |
| Same parser, `:1364` and `:2977` | Empty-net flags are inferred from six skaters, not goalie-presence digits. `0551` loses its leading zero through integer conversion and becomes two apparently occupied nets. Missing/bad codes become 5v5. | Separate shooter/defender goalie presence from skater counts. Missing/invalid codes stay unavailable; never invent even strength. |
| Non-shot skip `:1106` and `:2570`; timing `:1384` and `:3020` | PP clock updates only inside the shot path. First recorded PP shot is assigned zero age; no penalty-start or intervening non-shot state input establishes the origin. | Walk the entire ordered event stream. A first observed advantage is not an exact penalty-start timestamp. |
| Timing `:1384` vs `:3020` | Extraction path does not clear on an own-team even-strength shot; full path clears only the shooting team's clock. An opponent even-strength shot leaves the old team's clock alive in both. A later advantage in the same period inherits the earlier origin. | Track one game-state timeline, not independently sticky shooter-triggered clocks. Changes are observed regardless of which team shoots next. |
| Goal resets `:1396` and `:3050` | Every goal resets both team clocks regardless of which penalty components remain active. The next shot with continuing observed advantage restarts at zero. | Resolve eligible penalty expiration/cancellation under an explicit reviewed rules contract, then reconcile with observed strength. Do not equate every goal with all advantage ending. |
| Per-period map keys `:1388` and `:3028` | A continuing state across the period boundary loses prior elapsed time. | Use ordered game-time coordinates and documented boundary handling; preserve cross-period state only when supported, otherwise mark age unavailable. |
| Record `:1658` and parser `:2932`/`:2985` | `penalty_length` and `penalty_time_left` remain `None`; they are fields, not implemented penalty-clock evidence. | Compute from a validated penalty ledger or retain explicit unavailable status. No fake countdown. |

The diagnostic also verifies an important property worth preserving: current goal/non-goal changes do not change the current emitted PP age; reset occurs after the current value is computed. Recovery must retain that pre-outcome ordering.

## Current experimental inputs: what is and is not recovered

`data-pipeline/projections/causal_feature_projector.py:55` correctly preserves the four-digit situation string, shooter-relative skaters and goalie flags; invalid states are withheld. At `:70`, both `is_power_play` and `time_since_powerplay_started` are explicitly unavailable with reason `penalty_state_not_reconstructed`. `compact_feature_export.py:22` exports skater counts, net flags and skater advantage, but not a true PP clock. `development_feature_export.py:25` appends location/previous-event/faceoff/period measurements, not penalty reconstruction.

That is an honest narrower contract, not preservation of all original PP signal. `event_memory_features.py`'s observed strength-spell age is a different quantity: time since an observed state first appeared, not time remaining in a penalty or verified PP-start age. None should silently fill the original PP-clock field.

## Available first-party evidence

A bounded systematic sample was read from the completed movement run's `source-replay.json` closure. From its 6,365 sorted `.body.json` paths, choose indices `floor(i*(N-1)/99)` for `i=0..99`; each selected body was rehashed against that closure before parsing. This samples the source inventory, **not** a claim about the full eligible training population.

The 100 sampled games contain 31,364 events, with a string `situationCode` on 31,233. All 8,573 sampled goal/on-goal/missed-shot events have a situation string. There are 749 penalty events; all 749 carry `details.duration`, `details.typeCode`, `details.descKey` and `details.eventOwnerTeamId`. `committedByPlayerId` appears on 728, `drawnByPlayerId` on 688 and `servedByPlayerId` on 36. The recorded type mix is MIN=641, MAJ=64, BEN=20, MIS=13, GAM=4 and PS=7.

This is usable provenance for recovery. It is **not** proof that every annotation changes manpower, that duration specifies actual active penalty exposure, or that player participation is complete. Actor fields need their own availability states; a missing drawn-by player must not become a fabricated player or erase the team-level event.

## Next implementable, versioned scope

1. **Restore reliable shooter-side recorded context first.** Add a pure full-prefix projector that retains the raw penalty annotation's event ID, team, recorded type, recorded duration and elapsed game-time since the event. Emit separate same-team/opponent relations using validated home/away IDs. These are recorded-penalty-event predictors, not claims that a penalty is still active. Missing identity/type/duration stays unknown.
2. **Track observed manpower spells separately.** Read every valid situation update, including non-shot events. Preserve shooter-relative skaters and both goalie flags. Distinguish a known observed transition from a left-censored initial observation. Expose `seconds_since_observed_manpower_transition` only under an explicit transition rule; do not call it `time_since_powerplay_started`.
3. **Implement exact penalty clocks as a separate gated layer.** A ledger needs a reviewed, versioned treatment of penalty categories, overlapping/coincidental penalties, delayed penalties, goal cancellation, period carry, overtime transitions and incomplete annotations. Validate against observed state changes and retain unresolved discrepancies. A duration-only countdown is insufficient.
4. **Promote no renamed proxy into legacy PP semantics.** Retain original fields and mapped status in the coverage ledger; add new names for narrower supported measurements. The true PP flag/time fields remain unavailable until their ledger gate passes.

## Required causal and regression tests before any fit

- Flip current goal/non-goal and current outcome-only details: the current vector is unchanged. Append future penalties/goals: all earlier vectors remain unchanged.
- Both home/away shooter perspectives and mirrored team labels preserve the same physical state. Leading-zero goalie flags survive; extra attacker and penalty advantage remain separate concepts.
- Penalty/non-shot state transition between shots updates the next vector even when the next event owner is the opponent. Two distinct advantages in a period cannot share a stale start.
- Unknown state or missing penalty origin cannot become zero elapsed time, ordinary even strength, or a confidently active penalty. A known true zero remains distinguishable from unknown.
- Same-clock events use explicit stable source order; unknown order, duplicate IDs, reversed clocks and inconsistent period identity fail closed.
- Goal cancellation, overlapping penalties and period carry have explicit known/unknown outcomes according to the separately reviewed rules contract, not an unconditional goal reset.
- Source rows, emitted feature names, missingness and original actuals are preserved; train-only transforms and categorical vocabulary are frozen. Raw-to-feature replay agrees across supported invocation paths.
- Evaluate the declared candidate on identical chronological populations and original strength/unknown subgroups, including the existing 5v3 weakness. Do not remove rare situations or infer acceptance from overall total calibration alone.

No predictive gain is claimed by this recovery specification. It establishes a concrete next correction with available recorded inputs and an explicit boundary between observation, proxy and reconstructed penalty state.
