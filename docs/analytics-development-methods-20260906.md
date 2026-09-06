# Earlier development comparison: independent neutral xG

The frozen declaration is `analytics-development-ablation-plan-20260906.json`.
It precedes this new real export and fit. The earlier completed experiment and
its future reservations remain byte-for-byte separate. This run cannot turn an
already inspected historical season into an untouched test.

## What this comparison tests

Two expanding chronological folds each have earlier training, later calibration
and still-later validation games. All event files precede July 2024. The same
eligible official-source attempts are scored by constant baselines, geometry,
the preserved numeric context design, and an enhanced context design. Each
nonconstant design is compared raw, sigmoid-calibrated and isotonic-calibrated.
Architecture and tuning budget are fixed in the declaration; this is a bundled
feature/calibration ablation, not an individual-feature causal attribution.

Public descriptions motivate examining shot category and strict preceding-event
context, while keeping neutral chance quality separate from finishing talent
and downstream rebound/flurry accounting. Citrus derives its own measurements
from retained official events and fits its own parameters. No MoneyPuck files,
predictions or fitted constants enter this experiment. [MoneyPuck methodology](https://moneypuck.com/about.htm).

The two calibration alternatives are evaluated, not assumed to improve results.
Their fitting data are disjoint from classifier training and validation.
Isotonic calibration can overfit and introduce probability ties; raw and
calibrated discrimination, probability scores and reliability are retained.
Boundary clipping is declared explicitly. [scikit-learn calibration guidance](https://scikit-learn.org/1.5/modules/calibration.html).

## Measurements and limits

Current geometry uses explicit source orientation. Prior coordinates use the
current shooting team's frame, including when the preceding event belongs to
the opponent. Only the immediate same-period event can supply prior context;
stoppages, goals and penalties cannot be bridged to manufacture motion.
The prior category is retained even when its location is unavailable.

Immediate same-team prior SOG is a recorded-event condition, not confirmation
of a rebound. Circular angle change uses the shortest displacement. Same-clock
angular speed is unavailable rather than infinite or invented zero. Event
location change is not measured puck speed or a tracked pass. Elapsed time since
the last recorded same-period faceoff is not continuous play, fatigue or power-
play age. No shooter/goalie identity, future event, assist, final score or actual
rebound outcome is used as a neutral classifier covariate.

Missing numeric data receive training-only medians and missingness flags.
Raw categorical tokens receive training-only one-hot vocabularies, with separate
unknown and missing columns. Explicit resource bounds reject oversized inputs;
they do not truncate rows, merge categories or pretend missing inputs are zero.
All original source rows, quarantine reasons and geometry exclusions are kept.

## Decision boundary

The declared shortlist first requires no worse Brier score or log loss than raw
geometry in either fold. It then ranks by equal-fold mean log loss, mean Brier,
and a fixed complexity order. Constants remain reported baselines. Paired
whole-game intervals and all declared subgroup/reliability evidence remain
visible; a rank is not automatic serving acceptance or a multiplicity-adjusted
superiority claim. No later observed test result is used for that ranking.

Any new final pipeline needs its own complete fitted-artifact receipt and new
timestamped prospective reservation. Existing reservations are not rewritten.
The entire [method preservation map](analytics-method-preservation-20260906.md)
remains in force: rink adjustment, real shifts, talent, rebound occurrence/value,
flurry, xA, goalie evaluation, GAR, uncertainty and fantasy projections are
separate preserved stages, not silently dropped or claimed as active here.
