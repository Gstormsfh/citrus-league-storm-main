# Original Citrus inputs: preserve intent, prove delivery

The original model already contained pre-shot movement, timing, pass-context and
rebound interactions. Calling these newly discovered ideas was incorrect. The
new first-party development model is a narrower experimental baseline, not a
feature-complete replacement for the legacy system.

## Source-backed inventory

`scripts/proof/audit_legacy_xg_inputs.py` parses source without importing model
loaders. Its receipt at
`scripts/proof/results/event-memory-verification-20260906.wlwiM7/legacy-input-inventory.json`
records **all 145 keys in each of two shot_record builders**, including their
expressions and source lines, the **31 v3 / 30 v4 declared training inputs**, and
the newer development schema. These are source counts, not deployed model
feature counts, populated-data counts, or evidence of more information than a
competitor. Outcome/identity fields are deliberately retained in the inventory;
they must not all become pre-shot predictors.

## Every declared v4 input, with v3-only rush retained

Related measurements are not asserted to be numerically equivalent. “Absent”
means absent from the newer development feature schema, not deleted from Citrus.

| Original training input | Newer development path / preservation requirement |
|---|---|
| distance | distance_to_goal_ft; verify orientation and distance convention |
| angle | signed_angle_deg; preserve behind-net and circular geometry |
| is_slot_shot | Explicit legacy composite absent; distance/coordinates present |
| shot_type_encoded | Categorical shot_type; encoding differs |
| is_rebound | Immediate same-team prior SOG indicator is related, not full legacy rule |
| is_empty_net | Separate shooting/defending empty-net indicators |
| is_power_play | Skater counts and advantage; not identical flag semantics |
| score_differential | score_differential_pre_shot; current goal excluded |
| defending_team_skaters_on_ice | defending_skaters |
| period | period_number |
| time_since_powerplay_started | Absent; new observed-strength-spell age is NOT PP start age |
| east_west_location_of_shot | x_attacking; legacy label refers to rink length |
| north_south_location_of_shot | y_attacking; legacy label refers to rink width |
| east_west_location_of_last_event | previous_x_in_shooting_frame_ft; frame eligibility differs |
| arena_adjusted_shot_distance | Absent; preserve rink correction research and train-only fitted adjustment |
| distance_angle_interaction | Explicit product absent; constituent inputs retained |
| last_event_category_encoded | Categorical previous_event_type; taxonomy differs |
| time_since_last_event | seconds_since_immediate_event |
| distance_from_last_event | distance_from_immediate_event_ft |
| speed_from_last_event | event_location_change_ft_per_second; not tracked puck speed |
| speed_from_last_event_log | Explicit log transform absent |
| shot_angle_plus_rebound_speed | prior_sog_angular_rate_deg_per_second is related; legacy overwrite defect below |
| shot_angle_rebound_royal_road | Explicit crossing indicator absent; legacy sign-loss defect below |
| has_pass_before_shot | Multi-event inferred-pass detector absent; immediate-event ownership is not equivalent |
| pass_lateral_distance | Explicit inferred-pass lateral displacement absent |
| pass_to_net_distance | Explicit inferred-pass origin-to-net distance absent |
| pass_immediacy_score | Explicit inferred-pass time transform absent |
| goalie_movement_score | Explicit lateral-distance × immediacy interaction absent |
| pass_quality_score | Explicit zone/timing/movement/distance composite absent |
| pass_zone_encoded | Explicit inferred-pass zone absent |
| is_rush (v3 only) | v4 deliberately excludes it because inference did not populate it; preserve concept, require real causal implementation |

The original goalie-movement intent is explicit in
`data-pipeline/acquisition/data_acquisition.py:415`: immediacy is
`max(0, 1 - elapsed_seconds / 3)`; movement combines it with
`min(1, lateral_distance / 50)`. Larger lateral displacement with less settling
time is already encoded in Citrus. Preserve this hypothesis and test its
components/interactions; the hand-selected constants are not validated biology
or measured goalie motion.

## Executed defect witnesses and delivery risks

`scripts/proof/test_legacy_xg_feature_diagnostics.py`: **6 passing diagnostic
tests** reproduce current behavior, not correctness of that behavior. They run
only inspected AST blocks/functions, never acquisition startup or old binaries.

1. **Crossing signal erased in both builders.** At acquisition lines 1597 and
   3402, negative prior/current y values are made positive before checking
   opposite signs. Opposite-side examples therefore return zero. A correction
   must first orient both locations in one frame; blindly comparing raw signs
   is not a sufficient fix.
2. **Angular speed overwritten downstream.** Extraction computes angle change
   divided by elapsed time. `feature_calculations.py:281` returns an angle-based
   surrogate; its dataframe helper overwrites `shot_angle_plus_rebound_speed`.
   The executed witness changes an input rate of 8 to 27 for a 30-degree rebound,
   and a non-rebound zero to 30. Units and upstream intent are lost. Actual
   acquisition invokes this helper before model feature selection. No deployed
   artifact parity or exact historical affected-row count is claimed.
3. **Inferred pass is broader than an observed pass.** `find_pass_before_shot`
   searches same-team coordinate events within three seconds. It can choose a
   hit and skips rather than terminates at a faceoff. The idea remains valuable,
   but boundary, ownership, missingness and sequence validity need explicit tests.
   **Caller audit correction:** the active extractor actually passes a shot-only
   buffer. Helper eligibility is not actual caller coverage: in that path this
   is prior-shot context, and intervening non-shot boundaries are invisible to
   the helper. See [the second parity audit](feature_parity_audit-20260906.md).
4. **Training join may collapse distinct events.** v4 rounds coordinates and
   joins game/player/location/event-type, keeping the first duplicate right row
   (`train_xg_v4.py:530`). That is not exact event identity. Its implemented
   unmatched handling preserves numeric NaN and an unmatched zone token; the
   script's older introductory zero-fill description is stale. Do not rerun its
   MoneyPuck-data loader. Rebuild analogous inputs from first-party event IDs.
5. **Inference fallbacks can obscure missing inputs.** Acquisition creates absent
   columns as zero, can fit category encodings on the current batch if the saved
   encoder is missing, and uses current-batch medians for some values. These are
   source-wiring risks, not proof the deployed process encountered each fallback.
6. **Additional emitted fields are not all model inputs.** Zone-normalized
   lateral distance, raw time-before-shot, xA fields, player/team identity,
   penalty context, TOI/rest, composition and advanced geometry remain visible
   in the full receipt. TOI proxy calls feed both teams the same faceoff age;
   composition and position placeholders are missing. A separate TOITracker
   class exists, so it would be wrong to say Citrus has no shift-related code.
   Outcomes, assists and later continuation labels are preserved as actuals or
   targets, not admitted into a neutral pre-shot feature vector.

## Completion gate for a full replacement

This is an expanded source audit, **not yet an exhaustive runtime/data audit**.
For every inventory field, close: source event and units → availability by
season/strength/shot type → extractor parity → training selection and imputation
→ actual serving artifact/schema → chronological ablation and calibration.
Preserve the research families in `analytics-method-preservation-20260906.md`.
Do not silently drop a family because the clean-room baseline omitted it.

Next implementation priority is a separately versioned pre-shot movement family:
correct common-frame lateral/angular changes, exact elapsed time, explicit
inferred-event eligibility and boundaries, and preserved legacy composites as
comparators. Validate the original-style interactions versus their raw
constituents on unchanged populations. Correcting a legacy input distribution
requires retraining/parity validation before serving; do not hot-patch the input
of an old fitted model and assume improved accuracy.

No production change, legacy file deletion, restricted-data training or model
promotion was made by this audit.
