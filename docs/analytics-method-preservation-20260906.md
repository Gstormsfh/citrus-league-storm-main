# Preserve the complete Citrus analytics system

Scope is **database, organization, and models together**, not a flurry-only
replacement. The user expressly requires preserving existing inputs, actuals,
artifacts, and the wider research foundation. This map records discovered code
and references; it is not a deployment, data-rights, or predictive-quality audit.

## Preservation rules

- Retain full raw observations, including non-shot events, shootouts and fields
  outside a particular model's population. Derived inclusion/exclusion rules
  must not erase the source. Preserve old revisions beside later observations.
- Quarantine means retained but ineligible for a specific verified calculation.
  It does not mean deletion, substitution with zero, or loss of official actuals.
- Keep raw measurements distinct from adjusted features, observed G−xG from
  inferred finishing talent, and descriptive values from forecasts.
- Retain previous model artifacts and their byte identities. No silent
  overwriting, training on restricted files, or relabeling legacy outputs as new
  validated predictions. Baseline reuse needs explicit compatible lineage.
- Organization is additive: inventories, source receipts, dependency maps and
  content-addressed evidence. No bulk moves, deletion, archive pruning or
  replacement of the existing pipeline is authorized by this work.
- New sequence output is diagnostic-only. Both actual Python writer boundaries
  preserve existing dataframe columns; no new serving flag or database field
  promotes these diagnostics to production metrics.

## Method and dependency map

Paths below are repository-relative. “Wired” means a code call path was found,
not that a deployed fit or its accuracy was verified.

| Dimension to preserve | Existing implementation / dependency | Present evidence and required next gate |
|---|---|---|
| Raw NHL game/event identity, outcomes, coordinates and clocks | `acquisition/canonical_events.py`, full PBP receipts, existing `raw_nhl_data` archive | Full payloads retained. Normalized unblocked-shot membership is a derived view, not a replacement for the event stream. Final-total exceptions remain retained and quarantined. |
| Rink/recording adjustment | `scripts/utilities/feature_calculations.py`: coordinate wrapper, radial quantile transform, empirical CDF builder | Narrow boolean/callable masking bug fixed; default remains off for building. Radial mapping is Citrus's adaptation, not the coordinatewise Schuckers–Curro method. Fit population, rink identity, orientation, stale cache behavior and cutoff still need validation. |
| Geometry and pre-shot context | `scripts/utilities/feature_calculations.py`, `acquisition/data_acquisition.py`: distance/angle, prior event and timing, pass context and goalie-movement proxies | Existing inputs/code preserved. A proxy or inferred pass is not newly observed tracking data. Feature availability and pre-outcome timing need source-level receipts; unknown must not become an observed zero. |
| Shooting talent and Bayesian estimates | `scripts/utilities/calculate_shooting_talent.py`; optional acquisition artifact use | Preserve prior artifact. Its fit population, empirical prior, cutoff and rights are unresolved; do not confuse it with daily finishing adjustments. |
| Rebounds, creation allocation and flurry | Legacy feature helpers and acquisition paths; independent `projections/sequence_value.py` and `sequence_shadow.py` | Separate conditioned targets. Legacy heuristics remain explicitly unverified; new math supplies no fitted coefficients. Actual per-game/nightly shadow paths cannot publish and withhold without complete source/prediction receipts. |
| Daily projections and opportunity | `projections/calculate_daily_projections.py`, imported by `nightly_projection_batch.py` | Preserve shrinkage, finishing, exposure, opponent/defensive context, home/rest and goalie roles. Validate every factor's population, units and chronological inputs; do not substitute a shot-chain value for a player forecast. |
| Joint uncertainty | `projections/projection_uncertainty.py`, optional daily enrichment | Gaussian-copula/Cholesky and finishing-posterior code retained. Correlations, priors, intervals and calibration still require executed evidence. |
| On-ice impact and GAR | `20260826010000_onice_attribution_and_gar.sql`, `20260826120000_gar_components_in_sql.sql`, GAR utility scripts | Preserve EV offense/defense, PP offense, PK defense and penalties, replacement and shrinkage. On-ice component rates are not proof of teammate/opponent-adjusted RAPM. Keep population and exposure checks. |
| Goalie evaluation | GSAx and rebound-control utility scripts, goalie GAR configuration and season outputs | Preserve actual goals/shots/TOI and distinct model variants. Missing components must not imply measured zero; season keys, opportunity and baseline compatibility remain gates. |
| Season/era adjustment | `20260826110000_xg_v5_refit_and_era_layer.sql` and new unapplied exclusion/input guards | Existing season × rebound adjustment retained. Same-period outcome fitting is not held-out validation. Guarded refresh must preserve prior output on incomplete input. |
| Possession/action value | `docs/XT_MODEL_SPEC.md`: Markov-grid value iteration and arrival context | Preserve the specification and references. Bounded search found no matching implemented value-iteration path; do not relabel the new observed-chain accounting as xT or possession inference. |
| Wider research roadmap | `apps/web/docs/HOCKEY_ANALYTICS_LANDSCAPE_2026.md` | Preserve DQ+, SPAR, possession/visibility/reachability, playing styles, reliability, aging, OBV/DxT and other catalogued references. Landscape entries are research candidates, not evidence they are deployed. |
| Fantasy value | `packages/shared/src/utils/scoring.ts` (`ScoringCalculator`) and league settings | Preserve official actuals and league-specific scoring. FPAR requires validated forecasts, eligibility, horizon, replacement opportunity and feasible roster allocation; it is not generic NHL GAR renamed. |

## Primary-source checks

MoneyPuck's published discussion includes pre-shot geometry and event movement,
shooting talent, goalie/opportunity context, rebound creation and sequence
accounting—not only flurry. These remain conceptual references; no data files,
predictions or fitted constants are reused in new work.
[MoneyPuck methodology](https://moneypuck.com/about.htm).

Schuckers's own chapter distinguishes shot difficulty, goalie ability, rebound
control and recording bias. Its discussion of Schuckers–Curro describes separate
coordinate-distribution adjustments, supporting the explicit distinction from
Citrus's radial adaptation. This source does not validate Citrus's implementation
or supply fitted rink parameters.
[Statistical Evaluation of Ice Hockey Goaltending, pp. 12–13](https://myslu.stlawu.edu/~msch/sports/StatEvalofGoalies2016Schuckers.pdf).
Event-count rink effects are a different modeling problem from transforming shot
coordinates. [Schuckers and Macdonald](https://arxiv.org/abs/1412.1035).

The Hockey Graphs PAV article uses spatial/temporal transition and continuation
models to value actions, a broader problem than discounting an observed shot
chain. It identifies the existing specification's “Yu 2020” reference as the
ISOLHAC talk *A comprehensive analysis of pass difficulty, value and tendencies
in ice hockey*. That talk was identified through the bibliography, not reviewed
directly. [Kumagai, Nahabedian, Châtel and Stokes](https://hockey-graphs.com/2021/07/06/bayesian-space-time-models-for-expected-possession-added-value-part-1-of-2/).
Singh's original grid-based xT explanation is also retained as a conceptual
reference, not an assertion of equivalence across sports.
[Introducing Expected Threat](https://karun.in/blog/expected-threat.html).

No author/site performance statistic is adopted as a Citrus result. References
whose source or implementation remains uncertain stay visible in the research
inventory rather than being silently removed or promoted to verified features.
