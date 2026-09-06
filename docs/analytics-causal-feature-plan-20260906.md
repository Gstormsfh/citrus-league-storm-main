# First-party causal feature plan for a new chronological xG fit

This is an implementation plan and executable input-staging contract, not a
trained model, quality result, corpus acceptance or serving change. Existing
features, research, artifacts and published outputs remain preserved. No
MoneyPuck files, predictions, encoders or fitted parameters are inputs to this
new path. Existing artifact names describe legacy code, not approved provenance.
No serialized model was loaded and no trainer was imported or executed.

Read this with `analytics-training-lineage-20260906.md` and
`analytics-method-preservation-20260906.md`. The current historical official-NHL
freeze is separate work: no complete historical corpus is certified here.

## Executable slice and next useful work

`data-pipeline/projections/causal_feature_contract.py` accepts the existing full
`collect_observations` frozen receipt, explicit `real`/`synthetic` evidence kind,
and an explicit list of additional attempt exclusions (`event_id`, `reason`).
It does not accept arbitrary feature expressions, stored xG columns or fitted
values. Its imports are pure source/identity modules, not the legacy acquisition
module or any trainer. Evidence kind is caller-declared, not authenticated.

The reused full-stream gate recomputes prepared observations and source hashes,
checks final-team totals, observation timing and all event identities, sortOrder,
periods and clocks. The staging layer additionally requires an explicit
season-consistent game date, no later than the UTC observation date. The gate's
consecutive-attempt threshold is set to zero solely to reuse complete source
validation; chain membership is not an xG feature or rebound definition here.
Final-total exceptions remain unavailable, not repaired. This conservative gate
does not prove complete non-shot recording, rights, or historical delivery time.

Every source event is inventoried. Nonattempts and shootouts remain in the full
receipt; their exclusion from the unblocked-attempt target is explicit. Every
unblocked attempt has a candidate row, even when explicitly excluded or missing
coordinates/type. Exclusions cannot name nonexistent/nonattempt events, repeat
identities, omit reasons, or smuggle feature fields. They are hash-bound together
with the full source and all output. The function never mutates its inputs.

The staged row separates:

- Identity and source-event hash, game/date, period, clock and source sort order.
- Allowlisted at-shot annotations: raw x/y, owner team, defending side, raw
  situation code and raw shot type, each with explicit missingness. Numeric zero
  is retained; a missing shot type is not converted to wrist.
- Strictly earlier sanitized event context in authoritative source order. Equal
  clocks do not collapse events or let current/future events into the prefix.
  A prior event's type is historical context; the current event's type is not a
  predictor. Current goal score fields, assists, miss reasons, next-event labels,
  final game totals and predictions never enter the allowlisted at-shot view.
- A separate retrospective `is_goal` target. Current goal/non-goal changes do not
  alter its at-shot annotations or strict prior context. Source identities/hashes
  correctly change when the original observation changes.

All existing engineered/learned families remain in an explicit unavailable
catalog. Output is always `training_ready=false`, `publishable=false`, and
`historical_as_of_verified=false`. `staged_not_training_ready` means only that
this input view was constructed consistently. Historical annotations may have
been corrected after a game. The retained raw payload and source-gate report
contain outcomes and MUST NOT be flattened into a predictor matrix. The first
slice keeps explicit prefixes for auditability; a later corpus exporter should
use shared per-game prefix storage rather than repeat the full prefix per row.

The immediate next implementation is a pure, versioned feature projector over
this allowlist: correct attacking orientation, geometry, a complete prefix score
state machine, strength/empty-net decoding, and boundary-safe previous-event
motion. Test it against frozen official games before any fitting. Preserve the
old named variants; a corrected transform gets a new feature version. Then bind
its exact rows, exclusions and code hash to the chronological split planner.
The input-staging contract is not acceptance for training or deployment.

## Existing feature families and required first-party treatment

Paths in this section are repository-relative. The explicit feature lists are
`scripts/utilities/train_xg_v3.py:59` and `train_xg_v4.py:129`; these lists are
code declarations, not independently checked serialized artifact schemas.

| Family / current fields | Actual code and causal risk | New official-source requirement |
|---|---|---|
| Geometry: distance, signed angle, slot score, shot x/y, absolute coordinates, distance-angle interaction | `_extract_shots_from_game` in `data_acquisition.py:1030`; v3/v4 slot functions. Missing x/y default to zero, x=0 shots are skipped, and missing defending side falls back to x-sign. | Retain raw coordinates including zero; require valid owner and explicit attacking orientation before transforming both axes. Keep each chosen signed/absolute convention versioned. Slot boundaries/weights are design choices, not learned or externally verified constants. |
| Rink/arena adjustment and adjusted distance/x/y | `feature_calculations.py:41,120,190,380`: empirical radial quantile mapping; global caches; away-shot wrapper can use shooting team as rink proxy. No CDF gives original coordinates under an adjusted name. | First-party train-only empirical distributions, correct home venue identity, shot-type population, cutoff, algorithm hash and unknown-rink status. Do not build CDFs on calibration/test rows or reuse legacy fitted maps. Retain raw and adjusted measurements separately. |
| Shot type and categorical encoders | Acquisition defaults unknown type to wrist and may fit a last-event encoder per game (`:2207`); v3/v4 encode fixed enumerations. | Preserve unknown raw tokens. Freeze explicit vocabulary/unknown handling from training or an independently versioned domain definition; never learn codes from scoring batches. Correct modern event-code semantics in a NEW compatible model/encoder version. |
| Score, home/away, period/clock, manpower, empty net, PP age | Acquisition pre-event running score is an existing leak fix, but score increments occur after shot inclusion (`:1787`), so a skipped goal can corrupt subsequent context. Strength parser defaults five skaters and infers empty net from six skaters (`:1320`). PP age starts at first qualifying shot, not proven penalty start. | Reconstruct score from the complete preceding stream, including goals excluded from feature eligibility; reconcile but never read current post-goal totals as predictors. Decode all four situation digits with shooting perspective. Separate manpower advantage from penalty power play. PP age requires a reviewed penalty/state transition machine or stays unavailable. |
| Prior event category/team/location/distance/time/speed/log-speed | Acquisition `:1400` preserves a known legacy event-code mapping; last-event state updates only when coordinates are present and some coordinates are flipped twice. Current prediction medians use the full game's frame (`:2262`). | Identify actual immediate prior event independently of last event with known coordinates; preserve both definitions if useful. Same-period monotone order, tandem orientation, explicit zero-time/unavailable-speed policy, no future/game-wide imputation. Fit any imputer only on training data. |
| Rush, rebound indicator, angle/distance change, squared change, royal-road and angular-speed interactions | Shot-only `previous_play` can bridge nonshot stoppages; it is reassigned to the current shot before later rebound-angle logic. The long scraper's royal-road code takes absolute lateral values before testing sign crossing (`:3390`). `feature_calculations.py:281,454` can replace rebound-speed with another formula. | Preserve rush as a research/legacy feature (v4 omits it, not a universal removal). Choose a documented prefix-only boundary/gap rule; source-order stop/opponent/goal/period boundaries and signed coordinates are required. Zero angle change is observed zero, not missing. Do not call this inferred possession. |
| Pass context: has-pass, lateral/net distance, zone, immediacy, quality, goalie movement, normalized lateral and zone-relative distances; xA angle/time fields | `find_pass_before_shot` (`:259`) is a prior same-team event proxy, called with a shot-only buffer. No actual pass observation is established. Zone/immediacy/movement/quality helpers (`:359–584`) are hand-designed transforms, not measured goalie tracking. | Independently version the prior-event proxy and preserve it under honest semantics. No qualifying recorded proxy is not proof of no actual pass. True pass completion/population and goalie displacement remain unavailable from this evidence. Do not reuse unexplained proxy weights as learned first-party parameters. |
| Shift/TOI/rest: shooter; shooting/defending average/min/max; forwards/defencemen; since-faceoff variants; rest differences | `TOITracker`, `calculate_toi_features_proxy` (`:670,859`) and `feature_calculations.py:304`. Proxy duplicates faceoff age across players, with sentinel defaults. | Dated official shift intervals and validated on-ice joins for true shift duration; elapsed time since faceoff may be a separately named causal feature. Full-game boxscore TOI is retrospective and not current-shot fatigue. Missing shifts do not become zero/999 or identical team exposures. |
| Composition, position, handedness/off-wing, defender geometry/screens | Acquisition fields remain None for composition/position; `feature_calculations.py:336,466` contains off-wing helper/skipped enrichment. Defender coordinates are not supplied by inspected PBP paths. | Dated roster/player metadata and exact event on-ice identity for composition. Correct orientation plus handedness for off-wing. Explicit independent tracking feed required for defender distance/screens; preserve the family as unavailable, not invented coordinates. |
| Shooting talent / finishing | `calculate_shooting_talent.py:205`: aggregate goals/xG, hand-set normal prior/grid, normal-approximation likelihood and clipping; optional long-scraper artifact use (`data_acquisition.py:3972`). | Learn prior/hyperparameters from eligible earlier official games, bind denominator model, and use prior-only or chronological out-of-fold predictions for training rows. No own-shot or future-season outcomes. Keep neutral xG and talent-adjusted forecasts separate. Existing artifact presence proves neither fit lineage nor authorization to reuse it. |
| Rebound occurrence, expected rebound xG, created xG and flurry | Long scraper loads optional rebound model (`:159,3866`); short per-game path uses flurry helper but not the same learned rebound branch. `feature_calculations.py:475,674,822`; `sequence_value.py`; actual shadow calls in both current per-game/nightly paths. | Separate P(rebound given non-goal/context), value conditional on rebound, and the joint expected continuation value; bind horizon/censoring and source boundaries. Current event outcome and next-event labels are targets only. Flurry/creation are downstream accounting, not base-xG covariates. Existing heuristic values remain unverified, new shadow cannot publish. |
| Goalie ID/opportunity, freeze/rebound/zone continuation and GSAx | Acquisition `:1540` looks ahead for shot outcomes; its freeze condition uses prior-event time rather than measured next-event interval. Goalie/GAR utilities are downstream. | Goalie identity as a separately declared player-effect model if justified; outcome labels get independent target definitions. Do not include goalie-froze, generated-rebound, shot-was-on-goal, assist IDs, miss reason, next-event or final-stat fields in neutral goal-probability inputs. GSAx needs the neutral baseline and compatible opportunity population. |
| Season/era scaling; daily opportunity/rest/home/opponent/DDR and uncertainty; on-ice/GAR/replacement | `calculate_daily_projections.py`, `projection_uncertainty.py`, GAR/era SQL and preservation map. These are not all features of the base shot classifier. | Preserve each as a separate model/aggregation stage, with prior-time inputs, units, exposures and fitted-parameter receipts. Same-season outcome calibration is descriptive unless learned on a separate earlier population. Do not substitute shot-chain values for forecasts, GAR, xT or league-specific fantasy scoring. |

The map preserves implemented and unavailable families; it does not assert every
stored column is part of the active serialized model. Model loading is required
only later in an approved isolated artifact-verification workflow, not for this
audit. Comments claiming feature counts, empirical quality or deployment were
not treated as verification.

## Learnable stages and execution boundary

1. **Source and target population:** freeze complete official PBP revisions,
   endpoint/observation/semantic hashes, actual game dates and exact event IDs.
   Independently reconcile requested schedules and final totals. Retain source
   defects, shootouts, blocked attempts and missing-feature rows with reasons.
   Goal on an unblocked attempt is the initial target, not goal conditional on
   recorded SOG. Awarded-goal exceptions require explicit adjudication.
2. **Preprocessing:** train-only categorical vocabularies, optional missing-data
   policy, rink transforms and any learned representation. Raw measured fields
   and hand-specified geometry require code/version receipts, not fake fit hashes.
3. **Neutral xG:** fit the first-party classifier using chronological training
   games only; tune within earlier chronological subwindows, not the final test.
   Persist exact features/order, population, model bytes, environment, seed and
   code/source/split digests. New first-party names must not overwrite old models.
4. **Calibration:** generate raw predictions from that frozen model on the later
   calibration window. Fit global/conditional calibrators only there with a
   predeclared sparse-group policy. Calibrator receipt binds model and membership.
   The existing `train_xg_calibration.py:56` whole-CSV fit is not this contract;
   v4's `train_and_eval` uses random calibration rows and a nonchronological test.
5. **Talent and rebound models:** independently fit first-party empirical priors,
   rebound occurrence and conditional value only after their target/coverage
   gates. Use temporal out-of-fold baseline predictions when fitting on training
   games. Calibrate on disjoint later populations. These stages cannot be
   replaced by a string saying calibrated or by legacy multipliers.
6. **xA/action models:** remain separate from neutral xG. The source population
   must contain real eligible actions and negative examples, not only recognized
   shots or goal assists. `xa_model_trainer.py:19,81` generates dummy passes and
   executes fitting/saving at module scope. `model_trainer.py:19,224` likewise
   generates synthetic shots and writes artifacts at import. NEVER import either
   from the new training path; their headers are not execution provenance.
7. **Downstream forecasts:** once shot probabilities are measured, validate
   opportunity/TOI, finishing, goalie, opponent/home/rest, joint uncertainty,
   GAR and fantasy conversion separately. Their preservation does not make them
   prerequisites for the first honest neutral-xG scorecard.

Do not execute `data_acquisition.py` to obtain a supposedly pure feature builder:
its module-level joblib loads and live services are outside this contract.
`process_xg_stats.py` imports that module and duplicates some prediction handling.
After independent feature validation, an explicit adapter can share the new
projector across training and both actual scoring entry points. Until then all
existing runtime output remains unchanged.

## Required xG scorecard before any quality claim

Quality measurement is the objective after validated data, not an indefinitely
deferred cleanup task. Freeze the complete neutral pipeline and acceptance
criteria before opening the final evaluation window. Use the chronological
planner's exact whole-game train/calibration/test membership; historical test
results are **retrospective**, never relabeled untouched. A prospective reserved
window is not an evaluated result and needs an actual pipeline freeze receipt.

The executed report must retain per-event predictions and targets, source/model/
feature/calibrator/split hashes, every inclusion/exclusion and subgroup count:

- Proper probability scores: Brier and log loss on exactly the same eligible
  events; document probability-boundary handling rather than hide clipping.
  Include the train-derived constant baseline and a simple train-only geometry
  baseline to make added feature value measurable.
- Calibration: observed-versus-expected totals, reliability curves with frozen
  bins and uncertainty, calibration intercept/slope where estimable; report raw
  and independently calibrated predictions. A favorable average ratio alone is
  not calibration validation.
- Discrimination: ROC AUC and precision-recall performance with prevalence and
  event counts. No single AUC number substitutes for probability accuracy.
- Paired uncertainty: resample whole games for confidence intervals and paired
  model differences, preserving within-game dependence. State method, seed and
  failed/degenerate resamples; report sparse groups as insufficient evidence.
- Subgroups: strength/manpower, shot type, rebound status, empty net, rink and
  season, with unknown groups retained. Report regular/playoff population
  separately and avoid pooled improvements concealing regressions.
- Ablations: geometry/context, rink adjustment, prior-event/pass proxies and
  missingness behavior on the same cohort. Compare neutral xG separately from
  talent-adjusted xG; the latter has a different conditioning set and purpose.
- External peer comparisons only when rights permit and event definitions,
  identities, dates and cohort match. No MoneyPuck files/predictions are allowed
  under the user's current instruction. Unknown peer training periods or tuning
  exposure prevent an honest untouched-head-to-head claim. Published peer scores
  on other cohorts are context, not a benchmark result for Citrus.
- No serving promotion from this report alone: predeclared probability-quality
  and operational checks must pass, including old/new payload behavior and no
  loss of official actuals. State any unmeasured production/load limitations.

Minimum implementation after source freeze: build and validate the pure feature
projector, choose explicit chronological windows with the user/root, then run a
new first-party neutral baseline plus context model and independent calibration
to produce this scorecard. Rink/talent/rebound/true-pass extensions stay visible
and unavailable until their own evidence exists; they must not block measuring
the initial explicitly scoped model forever or silently disappear from the plan.

## Outstanding evidence, not assumed absence

Source export completion/reconciliation and actual feature availability by
season must be measured from the frozen receipts. Exact live historical arrival
times are not recoverable merely from game dates or a later archive timestamp.
True shifts/on-ice rosters, dated handedness, tracking/pass data and adjudicated
source exceptions require distinct evidence; current full PBP may contain some
useful fields but the inspected paths do not establish those complete datasets.
Final split dates, target horizons, tuning budget and acceptance thresholds need
an explicit declaration before fitting; no dates or fitted constants were chosen
here. No external data acquisition or user-rights decision was inferred.

## Implemented bounded projector and frozen-byte adapter

`projections/frozen_feature_source.py` now accepts the exact HTTP `.body.json`
bytes and parsed `.receipt.json` produced by `freeze_historical_corpus.py`.
It checks byte length/SHA-256, semantic hash, official request/response URL,
HTTP success, requested/observed timing, exact scheduled game/date/type/teams,
saved normalization/final evidence and status. Duplicate JSON keys fail. It
retains the complete original transport receipt and full payload, names the
original body hash, and uses the **original observed instant**, not adapter time.
It creates a compatible prepared view, not a replacement HTTP observation.
Quarantined source stays quarantined. This is consistency checking, not source
authentication or a proof of historical arrival time.

`projections/causal_feature_projector.py` rebuilds the staged input from its
frozen receipt and rejects altered rows, rather than trusting a recomputed hash
on user-supplied features. It adds these versioned derived views:

- Explicit owner/team plus `homeTeamDefendingSide` determines attacking
  orientation; both axes flip together. Missing side never falls back to x-sign.
  Raw zero coordinates are retained. The finite rink-bounded geometry uses goal
  center (89,0) feet in attacking coordinates, distance, and a signed full
  `atan2(y,89-x)` angle. Behind-goal angles are intentionally not folded into
  the legacy ±90-degree convention. Angle exactly at goal center is undefined.
  This is a new feature variant, not a compatible old-model input substitution.
- Strict situation code digits are away goalie, away skaters, home skaters,
  home goalie; accepted normal-play domains are goalie 0/1 and skaters 3–6,
  with at most six total players per side. Shooting/defending skaters and goalie
  absence are exposed separately. Manpower advantage is **not** asserted to be
  a power play; PP flag/age remain unavailable without penalty-state reconstruction.
  Special encodings such as `1010` remain explicitly unknown, not five-on-five.
- Pre-shot score starts only with a recorded opening period-start. All strict
  prior nonshootout goals count, including goals excluded from feature eligibility;
  current/post-goal scores never enter the feature. Missing origin/owner withholds.
- Immediate prior-event motion uses the last recorded prefix event, never the
  most recent event with usable coordinates. It refuses period changes,
  goals/stoppages/penalties/unknown boundaries and missing coordinates. Same-clock
  displacement is retained but speed is unavailable. The output is named
  `event_location_change_ft_per_second`: it is not measured puck or goalie speed.

Families not implemented remain preserved in the original catalog, including
slot design, rink correction, encoders, rush/rebound/royal-road, pass proxies,
shift/rest, talent and auxiliary models. The family catalog records the original
staging prerequisites; computed subfeatures are enumerated in each row's
`features` and availability summary. Outputs still cannot train or publish.

The physical rink convention is supported by the NHL's description of 100-foot
half-rinks and goal lines 11 feet from the end boards.
[NHL rink dimensions](https://www.nhl.com/kraken/news/dimensions-and-markings-of-regulation-ice-sheets-322765100).
An independent official landing response labels away goal event 212 in game
2017020001 as PP with situation `1541`, consistent with the decoder's away-five,
home-four interpretation. This is a source example, not a comprehensive API
schema specification. [Official game summary](https://api-web.nhle.com/v1/gamecenter/2017020001/landing).
No MoneyPuck source was consulted for this implementation.

### Executed real frozen checks, not a training acceptance

Two hash-pinned optional local-file tests run without network: historical
2017020001 is withheld; modern 2025020014 projects 86 candidates, with geometry,
strength and pre-shot score available for all 86 and motion rate for 83. These
tests explicitly skip when the separate ignored proof artifacts are absent.

A separate bounded run used the first ten lexicographic 2025 files in
`/private/tmp/citrus-official-observations-20260906-0211`: game suffixes 0014,
0015,0033,0035,0043,0045,0049,0054,0063,0067. It staged 892 attempts; geometry,
strength and pre-score were available for 892, motion rate for 876, and PP
flag/age for zero. This is measured availability on these receipts only, not
season coverage or predictive quality.

The one-per-season frozen sample at
`/private/tmp/citrus-nhl-archive-current-samples-20260906-0420` gives:

| Game | Candidate rows | Geometry / strength / pre-score available | Motion rate available |
|---|---:|---|---:|
| 2017020001 | 0 (source order withheld) | not projected | not projected |
| 2018020001 | 0 (source order withheld) | not projected | not projected |
| 2019020001 | 102 | 102 / 102 / 102 | 98 |
| 2020020001 | 76 | 76 / 76 / 76 | 75 |
| 2021020001 | 87 | 87 / 87 / 87 | 86 |
| 2022020001 | 92 | 92 / 92 / 92 | 87 |
| 2023020001 | 96 | 96 / 95 / 96 | 92 |
| 2024020001 | 90 | 90 / 90 / 90 | 87 |
| 2025020001 | 82 | 82 / 82 / 82 | 80 |

The unknown strength row is game2023020001 event171, REG3 03:07, code `1010`.
No default replaces it. The explicit-side/monotone samples from 2019 onward are
a concrete potential initial cohort, subject to full-season measurement and
chronological windows—not a promise that those entire seasons are eligible.
An initial neutral baseline can use validated available features/cohorts without
waiting indefinitely for every research feature or silently discarding them.

### Historical ordering and missing-side pathology

The first three frozen games each from 2017 and 2018 pass transport consistency
but are withheld for nonmonotone clocks. In 2017020001, source sort139 stoppage
11:21 precedes sort140 shot07:31; sort243 period-end20:00 precedes sort246
shot15:43. In 2018020001, sort140 goal12:57 precedes sort143 shot12:49.
Neither sample has a `homeTeamDefendingSide` field on any event.

Comparison with the original archived rows at
`scripts/proof/results/nhl-archive-provenance-sample-20260906` confirms the same
pathology already existed at the saved August11 observation: 2017020001 has
seven adjacent same-period clock inversions and 2018020001 ten, with zero
sort-order inversions. Their September6 samples have exactly the same counts.
The seven later one-per-season sample games have zero clock inversions in both
revisions. This rules out treating the first two examples as newly introduced
by this freeze; it does not establish their original historical order.

Sorting by period/clock is a **new retrospective hypothesis**, not an authoritative
repair. A future reconstruction version must preserve raw order, report every
permutation, separate equal-clock partial orders, and withhold score/motion where
event placement is ambiguous. Independent official play-by-play reports may
corroborate event clocks/distances and resolve some correspondences; a report
distance alone does not automatically identify rink direction. No side is
inferred from x-sign or a learned test-period coordinate distribution. The
existing strict source gate has not been relaxed.

### Report-backed retrospective reconstruction: now supported as a next version

The separately frozen official PL reports under
`scripts/proof/results/historical-report-samples-20260906` provide concrete
corroboration. Their `receipt.json` records original URLs, request window and
body hashes: 2017 report SHA-256
`e29915ee95ea1a6c94d3c2f53f66a9f0c3fba5a430a89bd738a073a5ba16e8f2`;
2018 report SHA-256
`0d294bc046e869b0d500b3c4a317a1d8612d01988dfc1a7434c4aacbeffc1eb6`.
They have respectively 308 and 360 report rows, both with zero clock inversions.
Each has three pregame rows absent from JSON (PGSTR, PGEND, ANTHEM); all remaining
gameplay type counts agree. The report independently numbers the 2018 12:49 shot
before the 12:57 goal. [Official 2017 report](https://www.nhl.com/scores/htmlreports/20172018/PL020001.HTM),
[official 2018 report](https://www.nhl.com/scores/htmlreports/20182019/PL020001.HTM).

An exploratory exact join on period, clock, type, team and shooter sweater
(resolved through the full official roster) matched every unblocked attempt:
86 in 2017 and 96 in 2018, without ambiguous attempt matches. The report supplies
explicit integer-foot distances. Comparing those distances to both possible goal
centers with a **diagnostic**, not acceptance, ±1-foot band uniquely distinguishes
one net for all 86 events in 2017 and 86 of 96 in 2018. The remaining ten 2018
events have coordinate/report distance discrepancies up to two feet; they stay
unresolved rather than widening the band after seeing results. Corroborated
directions are internally consistent by team/period. Both documents may share
the NHL's upstream scoring system: they are distinct recorded representations,
not independent sensors or proof of historical live availability.

A safe next implementation is therefore a NEW report-backed retrospective
contract, not sorting/rewriting the old PBP:

1. Parse and hash the complete official report, bind its game identity and
   exact numbered rows, and preserve both original observations/timestamps.
2. Record a one-to-one event correspondence using explicit fields, not fuzzy
   text/nearest clock or source ordinal guesses. Retain unmatched and ambiguous
   events. For 2017 the basic period/clock/type key is unique throughout; 2018
   has two duplicate groups. Shooter identities resolve its two same-clock
   shots, but two identical 17:26 stoppages remain identity-ambiguous.
3. Use uniquely corroborated report row order as a separately named retrospective
   order. Bound unresolved equal-clock equivalence classes explicitly; exclude
   boundary-sensitive features where ordering matters. Do not infer an original
   publish order or quietly replace source sortOrder.
4. An initial alternative can use **official reported distance directly**, with
   a new source/feature version, avoiding missing x/y orientation entirely.
   Reconcile report target population and preserve disagreement with calculated
   distance. For oriented coordinates, require predeclared quantization tolerance
   and report-bound direction evidence; no x-sign, outcome-trained direction
   model or fitting on the test cohort. Keep unresolved distance discrepancies
   explicit even if other events establish a period's net direction.
5. Compare feature availability by full season before choosing chronological
   train/calibration/test windows. A verified available-season neutral baseline
   can proceed first; reconstructing 2017–2018 is useful additional evidence,
   not a reason to postpone all actual xG measurement indefinitely.

These exploratory joins did not themselves establish a reconstruction gate.
Neither they nor the subsequent separate variant change frozen artifacts or make
the strict current projector accept the rejected historical games.

### Implemented separate report variant and collection handoff

Following the exploratory checks, `projections/report_feature_source.py` now
implements a distinct `citrus-official-pl-retrospective-features-v1` candidate.
It parses the complete numbered report rows, verifies header game/date/final/team
identity, refuses nonmonotone report clocks and binds report transport bytes and
PBP receipts. It rechecks PBP normalization and final population without pretending
the nonmonotone JSON sort order became authoritative. It preserves original
PBP ordinals/sort orders beside exact report row correspondences, all report rows,
unmatched report rows and unresolved source identities.

The direct reported-distance feature and report-prefix score are available only
for uniquely matched attempt identities. They are distinct from oriented raw
geometry. The ±1-foot comparison remains diagnostic only and does not produce
accepted orientation. Two pinned real report tests reproduce 86 and 96 matched
attempts; 2018's two identical stoppages remain unresolved and its ten coordinate
distance discrepancies remain visible. Every previous feature family remains in
the preserved catalog. Neither candidate is training-ready or publishable.

The earlier multi-document HTML capture is adapted without inventing response
times: its original manifest is retained and its observed timestamp is explicitly
a **capture-window upper bound**, unlike the new collector's per-response time.
Full HTML bytes remain in their original content-addressed files; the result
retains their digest and complete parsed rows, not a rewritten source document.

`acquisition/collect_feature_reports.py` supplies the create-only bounded CLI:

```sh
# From data-pipeline, using the configured Python environment:
python -m acquisition.collect_feature_reports \
  --freeze-dir ../scripts/proof/results/historical-official-freeze-20260906 \
  --output ../scripts/proof/results/historical-feature-reports-20260906 \
  --seasons 2017,2018 --max-games 3000 --delay 0.5
```

It validates all selected frozen schedule/PBP identities before requesting any
report. Read-only preflight selected 2,713 games and bound schedule-manifest
SHA-256 `17e23b533a25b3ffce7460f54643600bbec67538e157db0eeb5a93c61dcc2a50`.
The collector uses one worker and one request per game, rejects redirects and
caps each streamed body at four million bytes by default. It preserves failed
or truncated bodies with explicit unavailable receipts; no retry bypass,
overwrite or silent resume exists. Exact source body/receipt byte hashes,
request inventory and code digests are checked again after capture. Any failure
leaves a non-success health result, with stdout fallback if health persistence
fails. Arbitrary exception text is not persisted or printed.

Local tests verify capture/identity/selection, no retries or overwrite, sanitized
failure health, byte-limit preservation and end-run source/inventory drift.
Passing preflight/tests is not a completed report collection; root launches and
verifies the capacity-approved actual run separately.

For full modern-corpus export, do not persist the audit staging object's repeated
prefixes. A compact implementation should validate one full game at a time and
emit source/projector/code hashes, allowlisted feature rows and separate labels,
plus complete source-event membership/exclusion sidecars. The implemented
feature subset only needs a running score and immediate prior event; factoring
the same row arithmetic into a shared helper permits linear traversal without
duplicating a growing prefix. Full raw receipts stay immutable and externally
hash-bound. This is a feasible next implementation, not an export already run.
