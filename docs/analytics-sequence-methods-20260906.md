# Independent Citrus sequence and rebound methods

The user requested published methodological inspiration, not MoneyPuck files,
data, predictions or fitted parameters. The conceptual reference is
[MoneyPuck's methodology](https://moneypuck.com/about.htm); the implementations
and test values here are independently authored. No performance, superiority or
calibration result follows from these mathematical checks.

`data-pipeline/projections/sequence_value.py` separates three contracts:

- Observed-sequence flurry contributions: each input probability is multiplied
  by the preceding non-goal survival product. Contributions never boost an
  input and cumulative sequence value remains bounded by one. This is
  retrospective accounting over an observed chain, not a prospective possession
  forecast.
- Rebound creation: explicitly distinguish goal probability `p` from
  `q = P(rebound opportunity | no goal)`. Unconditional rebound probability is
  `(1-p)q`; one-hop future goal value multiplies this by a separately estimated
  next-shot goal expectation. No observed rebound is required, and no arbitrary
  rate multiplier supplies missing estimates.
- Creation credit: non-rebound direct xG plus expected rebound value. Direct
  rebound-shot xG is not counted again in this allocation. This credit must not
  be added to flurry totals or presented as a calibrated team-goal probability.

Every probability has explicit conditioning and declared source/model/feature/
calibrator lineage. Unknown, nonfinite, boolean or out-of-range inputs reject;
valid zero and one remain valid. Source membership and rebound classification
require explicit receipts. These are caller attestations: a nonempty identifier
does not authenticate a source or establish calibration.

`acquisition/observed_sequences.py` supplies a separate source-only boundary:
full frozen PBP, recomputed normalization/identity, final statistical checks and
strict authoritative order/clock validation. Citrus's declared conservative
definition uses consecutive unblocked attempts from one team/period within a
caller-specified gap. Every intervening non-attempt, opposing attempt, period
change or goal ends the chain. It does not infer possession or claim to duplicate
another site's sequence definition. The illustrative three-second source audit
is not a learned or validated predictive threshold.

The existing active flurry helper has survival arithmetic but unsafe boundary
selection: it groups out intervening events, can join distant shots via the
latest unrelated-event gap, and replaces missing inputs with zero. The separate
probability-boost helper has no discovered callers and will not be integrated.
Legacy rebound-value code contains unvalidated fixed multipliers and ambiguous
conditioning. None of those constants is reused in the new module.

This sequence work is only one part of the full database/model effort.
`analytics-method-preservation-20260906.md` maps the broader methods and sources
that remain in scope; no inputs, raw actuals or prior artifacts are retired here.

An actual saver defect is fixed locally: absent/invalid rebound probability,
expected rebound value and creation credit now remain explicit NULL rather than
zero or ordinary xG. Legitimate finite zero is preserved. Existing heuristic
values are still legacy/unverified, not certified by this missingness fix.

`projections/sequence_shadow.py` now supplies one shared post-prediction stage,
called by both actual per-game and nightly processing functions. It requires the
full frozen canonical source and event-bound Citrus prediction receipts matching
actual dataframe probabilities and artifact digests. Evidence must explicitly
declare synthetic or real origin; supplied validation remains an attestation,
not independently established calibration. Every result is nonpublishable.
Legacy callers without receipts report unavailable. Tests execute both actual
function bodies with synthetic models/DB fakes and prove full-column preservation,
not a deployed run. No model binary was loaded for this implementation.

The complete season source-only audit reconciles against the independent frozen
schedule: 1394 expected games, 1362 verified source sequences and 32 withheld for
unresolved final goal/SOG totals. The illustrative three-second definition yields
107107 chains, of which 8183 contain multiple attempts, over 116506 included
attempts in verified games. These are descriptive membership counts, not trained
probabilities or model performance. Raw non-shot events and all rejected game
receipts remain intact. The full audit exits 2 because quarantine is not success.

Until source, target, model and calibration evidence pass, no new probability or
creation metric is published and no historical legacy value is overwritten by
this implementation. The prior Citrus model can be an explicitly identified
baseline, not assumed accurate or leakage-free.
