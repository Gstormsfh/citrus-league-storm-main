# Shift and rink inputs: recovery specification

Scope: inspected local source and retained receipts only. No database queries,
downloads, model loading, fitting, code changes or production operations.

## Priority 1 — establish what rink-adjusted actually means

This family directly enters the declared legacy training vector, unlike the
emitted shift proxies. `train_xg_v4.py:138` selects
`arena_adjusted_shot_distance`; its historical loader at 287 reads the external
corpus's adjusted distance. It must not supply new training data under the
current rights boundary. First-party serving instead calls
`apply_calculated_features_to_dataframe` at acquisition 2201 with its default
`build_schuckers_cdfs=False`. Its module globals begin empty and fallback returns
raw coordinates (`feature_calculations.py:38`, 76). This is not proof that every
process's globals are empty, but no populated transform is established by this
call chain.

If explicitly fitted, the dataframe key uses shooting-team code for away shots
(404–423), not home rink. The fitter groups away shots by home-team/shot-type
(167–179), whereas its target league CDF combines shot types (160). Home-team
code is also not a guaranteed physical venue identifier. Rebuilding does not
clear old per-rink globals before replacing populated groups, creating stale
key risk in a reused process. These are distribution and lineage hazards, not
evidence that a corrected column is better than raw geometry.

Recovery contract:

1. Preserve raw coordinates and explicit shooting orientation permanently.
2. Add an audited game-to-physical-venue identity with effective dates; mark
   unknown venues rather than silently treating away-team identity as rink.
3. Freeze train-only eligible coordinate rows, shot-type taxonomy, empirical
   mapping, sparse-rink fallback and cutoff in an immutable JSON transform.
   Decide explicitly whether league reference is shot-type-conditional; the
   original pooled reference is a comparator, not an assumed correct method.
4. Apply without mutable caches, per-batch fitting or current validation data.
   Test away/home consistency, repeated-process isolation, unseen venue/type,
   rotations, invalid coordinates, ties and zero-distance geometry.
5. Compare raw versus corrected candidates on unchanged chronological rows;
   preserve venue/missingness calibration and actual raw inputs. No legacy
   serving hot-patch using changed geometry under an old fitted artifact.

Recoverable now: raw event geometry, explicit sides where published, game/home
team identity, and existing method source. Not established by current evidence:
complete physical-venue mapping and accepted first-party fitted correction.

## Priority 2 — separate true shifts from existing faceoff-age proxies

Both shot builders call `calculate_toi_features_proxy` with identical faceoff
age for shooting and defending teams (1584–1586 and 3358–3359). The helper
(859–971) copies that one value into shooter/team/position min/max/mean fields;
the rest-difference helper then subtracts equal values (974–1006). Missing-state
sentinels are 999/0/None, not observed shifts. These proxy fields are persisted
by the save mapping around 1926–1967: they are not merely unused local variables.
They are absent from the inspected declared v3/v4 training lists, so do not
assert they influenced those fitted artifacts merely because columns exist.

`TOITracker` exists at acquisition 670; the bounded repository Python search
found no `TOITracker(` construction. It requires externally maintained player
on-ice sets, positions and shift starts; those are not created by its class
definition. `feature_calculations.calculate_time_on_ice_metrics` (304–334) is
separately a placeholder returning None. Neither substitutes for a verified
shift-interval join.

Recovery contract:

1. Inventory already-retained shift/start/end/on-ice sources by exact game and
   player identity before any fetch. Treat availability as unproved until that
   inventory exists; do not infer continuous shifts from sparse PBP actor IDs.
2. Require interval ordering, period boundaries, team/position eligibility,
   overlap checks, same-clock endpoint semantics and source revision metadata.
   Current shot uses pre-event membership only; goal outcome cannot reset its
   own predictors. A faceoff does not universally prove every player changed.
3. Reconcile summed intervals against independent official player-game TOI;
   reconciliation is necessary but does not uniquely identify shift timing.
4. Derive per-player shift age and genuinely distinct team aggregates only
   where interval/on-ice coverage passes. Keep faceoff age as its own named
   proxy comparator. Unknown membership yields None, not 0/999 or a synthetic
   opponent average. Restrict position subsets to known positions.
5. Admit to a separate chronological ablation only after availability by
   season/strength is measured; do not discard uncovered shots to improve
   comparison. No tracking claims from shift age alone.

## Existing availability evidence must be preserved, not overextended

`toi-stored-20260906/manifest.json` records player-game `nhl_toi_seconds`, not
shift intervals. `analytics-toi-replay-proof-20260906.json` reports 939 verified
players of 940, withholding one event-set mismatch. That is frozen-current
aggregate exposure evidence, explicitly not historical-as-of availability;
it does not establish who was on ice at each shot. Keep its original receipts
and withheld identity unchanged.

Likewise, movement coverage proves recorded-event geometry availability, not
tracked pass reception, goalie position/velocity, screens, or player fatigue.
Those additional measurements require their own actual source and rights
evidence. The original hypotheses remain valuable even where measured inputs
are not yet verified.
