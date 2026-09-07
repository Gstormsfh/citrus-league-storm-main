# Legacy xG parity: second source audit

This is an additive source/wiring audit, not a deployed-artifact or production
population assessment. It preserves the original feature families and all old
experiment files. No acquisition module was imported, no binary model loaded,
and no database or production state changed. The number-verification skill was
used: source declarations are not reported as deployed feature counts.

## Immediate correctness priorities

1. **Previous-shot state is overwritten too early for royal-road geometry.**
   Both builders assign `previous_play = play` before the crossing computation
   (acquisition lines 1299 / 2848 versus 1597 / 3402). Correcting only the already
   documented absolute-value sign loss is insufficient: the comparison still
   reads the current play as its purported predecessor. Preserve a separate
   immutable prior-event reference until the entire shot row is emitted.
2. **Pass-origin and current-shot coordinates use different orientation rules.**
   Current shot uses explicit home-defending side when available; pass origin
   uses `pass_x < 0` (1255 and the analogous bulk block). For an attacking-+x
   shooter, origin (-10,-20) and shot (70,20) have 40 feet lateral separation;
   the current origin heuristic emits zero. This erases precisely the rapid
   lateral movement interaction the original design intended to capture.
3. **Earlier event coordinates can be transformed twice.** Non-shot state
   makes x positive (1108–1115), and the subsequent shot applies its shooting
   orientation again (1424–1431). Earlier shot state is also stored in already
   normalized coordinates. Store raw coordinates plus event/team/orientation,
   then project both positions once into the current shooter's frame. The
   non-shot branch additionally turns a valid y=0 into None through a truthy
   conditional, losing centre-line event context.
4. **Active and bulk PP-age extraction disagree.** Active extractor's PP branch
   (1383–1395) has no even-strength reset; bulk does (3019–3051). A witnessed
   sequence with first PP shot at 10 seconds, even-strength shot at 130, and
   new PP shot at 300 produces age 290 in active extraction. Both paths update
   only beyond the shot gate, so neither observes actual penalty onset merely
   because that event exists in raw PBP. The v4 training loader (277–281) always
   uses home penalty length/time-left irrespective which side is penalized.
   Exact penalty state needs a separate causal ledger; observed strength age
   must not be relabeled true PP age.

## Feature intent versus actual delivery

- **Original pass features are real existing engineering, not newly invented
  concepts.** Lateral displacement, elapsed-time immediacy, origin-to-net
  distance, zone, and their interactions already exist. However the active
  extractor intentionally supplies a shot-only `previous_plays` buffer
  (1059–1075, 1099–1120, 1300), despite the helper accepting other event types.
  Thus its executed source path is a prior-shot opportunity proxy, not observed
  tracked pass data. The helper-level ability to choose hits is not proof that
  active extraction actually does so. Intervening stoppage/opponent events are
  not in this shot-only buffer; sequence boundaries must be separately enforced.
- **Rink correction is not established by the output column name.** Dataframe
  helper defaults `build_schuckers_cdfs=False` (380); acquisition calls it with
  that default (2201). Empty process globals return raw coordinates. If CDFs
  are populated, dataframe rink key uses shooting-team code for away shots
  rather than the actual home rink (404–423). Public correction research is
  preserved, but it needs train-only fitting, explicit actual rink identity,
  saved metadata, and replay parity. This audit does not prove runtime globals
  were empty in every serving process.
- **Training missingness differs from scoring missingness.** v4 deliberately
  keeps numeric unmatched pass fields NaN for native tree routing (573–591,
  659–667); acquisition zero-fills them (2264–2268). Missing and observed no-pass
  are distinct states. Current-batch medians and fallback category refitting
  further prevent a fixed input contract. Do not fix this by feeding changed
  distributions into an old fitted model without retraining and replay checks.
- **v4 holdout is not a forward-in-time test.** Its train mask includes 2025,
  while holdout contains 2023–2024 (646–650); calibration is a random shot split
  (679–683), not a separated chronological/game unit. This can be a retrospective
  reconstruction experiment but cannot establish future generalization.
- **TOI/rest remain proxies in the inspected extraction path.** Both teams get
  the same faceoff-age arguments (1584–1586), so rest-difference features cannot
  represent independently observed team shifts. A separate TOITracker class
  exists; this audit does not claim every repository shift facility is absent.
- **Previously documented defects still stand:** derived angular speed overwrite,
  coordinate-rounded training joins rather than event identity, and modern NHL
  event taxonomy mismatching legacy categorical semantics. Comments claiming
  trained consistency are not artifact/data parity proof.

## Executed witnesses and acceptance boundary

`scripts/proof/feature_parity_audit_tests.py`: five tests passed on 2026-09-06.
They execute only inspected AST statements and reproduce current defects;
they are not regression tests asserting corrected behavior. They cover early
previous-play overwrite, wrong pass frame, double-normalization/zero-to-null,
and stale active PP age. Existing executable diagnostics cover the other
previously documented crossing and angular-rate defects.

Next implementation must preserve the original concepts in a separately
versioned raw-event projector with unambiguous units and missingness, common
frame geometry, strict prior-event boundaries, and stable train/serve transforms.
Do chronological family ablations on identical populations and check calibration
by strength, shot type, rink, rebound and missingness; do not judge benefit from
feature counts, training importance, or a single favorable fold. No model
promotion is supported by this source audit alone.
