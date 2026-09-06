# First source-replayed neutral xG experiment

Status: measured retrospectively; not accepted for serving. This is a new,
independent baseline, not a replacement of Citrus's existing model families.
No production rows, serving selection, or historical source bytes were changed.

## What was actually executed

The fixed [execution plan](analytics-first-neutral-experiment-plan-20260906.json)
was recorded before fitting. Its original `not_executed` status is historical
declaration metadata and remains unchanged because its bytes are part of the
completed pipeline's identity. This result records the subsequent execution.

The first-party runner replayed every selected game's exact official NHL response,
receipt, schedule identity, event inventory, features, labels, and exclusions.
Training-only preprocessing and raw models were fitted first, followed by separate
later-window calibrators. All fitted artifacts and the complete pipeline receipt
were persisted before the test inventory was parsed. Outer completion was recorded
only after source/code rechecks; inner fit completion alone is insufficient.

| Population | Earlier fit | Later calibration | Retrospective test |
|---|---:|---:|---:|
| Inclusive game-date window | 2019-07-01–2024-06-30 | 2024-07-01–2025-06-30 | 2025-07-01–2026-08-31 |
| Scheduled regular/playoff games | 6,365 | 1,398 | 1,394 |
| Source-quarantined games excluded | 93 | 24 | 32 |
| Source-withheld unblocked attempts | 8,205 | 2,068 | 2,851 |
| Geometry-eligible attempts used | 541,067 | 117,884 | 116,506 |
| Eligible observed goals | 38,132 | 8,276 | 8,348 |
| Further geometry exclusions | 1 | 2 | 0 |

The population includes non-shootout goals, shots on goal and misses, with explicit
attacking orientation and usable distance/angle. Blocks and shootouts are retained
in the full source inventory but excluded from this probability target. All six
predictors use identical eligible event membership. Missing context is retained
using training-only medians and fixed missingness indicators; it does not narrow
the comparison to a favorable complete-case cohort. The three additional geometry
exclusions are undefined angles at the goal center and remain explicitly recorded.

This is **current-revision historical evidence**, not historical-as-of or untouched
testing. No MoneyPuck files, predictions, fitted constants, or unknown legacy
serialized models were used. Public ideas can inform independently implemented
methods; this experiment does not establish commercial rights for any source.

## Results on the same 116,506 attempts

The test contains 1,362 eligible games and 8,348 observed goals. Lower Brier and
log loss are better; higher ROC AUC and average precision are better. Average
precision is not trapezoidal PR area. Values below are rounded from the retained
scorecard, not copied from a legacy model claim.

| Predictor | Brier | Log loss | ROC AUC | Average precision | Expected goals |
|---|---:|---:|---:|---:|---:|
| Training prevalence, raw | 0.066520 | 0.257904 | 0.500000 | 0.071653 | 8,210.83 |
| Training prevalence, calibrated | 0.066521 | 0.257910 | 0.500000 | 0.071653 | 8,179.26 |
| Geometry, raw | 0.064597 | 0.242703 | 0.695068 | 0.138499 | 8,422.93 |
| Geometry, calibrated | 0.064554 | 0.242520 | 0.695068 | 0.138499 | 8,583.44 |
| Context, raw | 0.061830 | 0.229451 | 0.741076 | 0.216639 | 8,709.49 |
| Context, calibrated | 0.061753 | 0.229239 | 0.741076 | 0.216639 | 8,673.43 |

The context baseline improves over geometry on this declared cohort. For calibrated
context minus calibrated geometry, paired 95% whole-game percentile intervals are:

| Difference | Estimate | 95% interval |
|---|---:|---:|
| Brier | −0.002801 | [−0.003064, −0.002540] |
| Log loss | −0.013280 | [−0.014296, −0.012217] |
| ROC AUC | +0.046009 | [+0.041439, +0.049997] |

All 256 declared resamples were valid for these differences. The calibrated context
ROC AUC interval is [0.735709, 0.746831]. These intervals condition on this fixed
pipeline and selected cohort; they do not measure training uncertainty, all
cross-game dependence, multiplicity, interval stability, or future-domain shift.
No authorized same-event external peer predictions were supplied, so this is not
evidence of superiority to MoneyPuck or any other public/commercial model.

## Calibration is still a material weakness

Calibrated context expects 8,673.43 goals against 8,348 observed: an excess of
325.43. Its mean predicted rate is 7.4446%, versus 7.1653% observed. The
observed-minus-expected rate is −0.2793 percentage points, with a paired-game
95% interval of [−0.4335, −0.1480] percentage points. Aggregate calibration is
therefore not accepted merely because discrimination improved.

The retrospective diagnostic calibration intercept is −0.169973 and slope
0.942651; their uncertainty was not computed. These are diagnostics, **not new
calibrator parameters**. The actual calibrator was fitted only on the preceding
window and remains unchanged. Fixed-bin reliability results, including empty and
sparse groups, remain in the full scorecard.

Empty-net attempts are included and separated: 1,048 attempts/533 goals with the
defending net empty, 115,420 attempts/7,809 goals with a goalie present, and 38
attempts/6 goals with unknown goalie status. Calibrated context expects 567.63,
8,095.44 and 10.36 goals respectively. Unknown-status intervals are withheld for
insufficient original cohort size, not reported as favorable certainty.

## Preserved inputs and remaining model work

The [method-preservation map](analytics-method-preservation-20260906.md) and
[causal-feature plan](analytics-causal-feature-plan-20260906.md) remain the full
scope. This baseline has eleven source-derived numeric features, including encoded
Boolean fields, plus fixed missingness indicators. It does not claim that shot-type encoding, learned rebound stages,
sequence/flurry attribution, tracking-based passes, penalty-state power-play age,
rink adjustment, finishing talent, GSAx, GAR, RAPM, xT, or fantasy replacement
value have all been fitted and validated here. Those are distinct stages or
research directions, not extra names for this score.

The 17 tracked legacy joblib artifacts in the
[byte inventory](analytics-legacy-artifact-inventory-20260906.json) were rehashed
after the fit and all remained unchanged. They were not deserialized, used for
inference, or fed into training. This inventory does not claim to cover every
external artifact. Approved goal/SOG exceptions remain separate exact-revision
overlays; this declared experiment did not silently activate them or change its
quarantined population.

The descriptive coverage report retains every source exclusion and missing field.
`rink_home_id` is a home-team identifier proxy, not a verified physical arena;
neutral/outdoor venues remain unresolved. `strength` records skater counts, not
penalty-confirmed power-play state. Rebound status remains unknown rather than
being invented from an unvalidated threshold.

Next model changes need a separately versioned experiment and earlier-window
validation, not tuning against this now-inspected test. Future prospective
measurement must retain the complete model/calibrator/feature/code identities;
it is separate from production acceptance and does not select a winner here.

All six complete pipelines were reserved at 2026-09-06 07:03:25 UTC for the
inclusive future window 2026-09-15–2027-08-31. No future observations were read.
The create-only reservation requires a matching success-health marker and no
failure marker. Its semantic SHA-256 is
`2c1f293808213b8293ec9024cc057e4ac69e655ca47a6f0b2377e35bd82e4d16`.
This is a local-system-clock reservation, not an independently notarized timestamp
or a completed future evaluation. Any changed pipeline needs a new reservation
before its own future window; no automatic serving acceptance is defined.

## Local evidence locations

Paths below are relative to the repository and are retained locally, not an
off-machine backup. Large source bodies and experiment outputs are ignored by Git.

- `scripts/proof/results/historical-official-freeze-20260906/`: complete scheduled
  capture of 11,870 official game responses across season IDs 2017–2025; all 182
  quarantines remain. The first experiment selects season IDs 2019–2025 only.
- `scripts/proof/results/historical-feature-reports-20260906/`: all 2,713 bounded
  2017/2018 report responses retained; each was HTTP 200 and none reached the body
  truncation limit. Only 1,956 pass the existing parser. The separate completed
  offline review identifies 69 exact terminal-marker candidates, 681 header/
  identity/date/team/final conflicts, five other incomplete endings and two
  invalid clocks. No parser or first-fit population changed. The
  [report proof](analytics-historical-report-proof-20260906.json) binds every body
  and receipt to the completed capture inventory.
- `scripts/proof/results/official-neutral-features-20260906/`: source-bound export,
  split inventories, and the full exclusion inventory.
- `scripts/proof/results/official-neutral-experiment-20260906/`: outer completion,
  source-replay receipt, new fitted artifacts, predictions, full scorecard and
  original fit/calibration/test receipts. Pipeline SHA-256:
  `af5a21eaf28787ab81813ee434cbb86c46a1bafce808152915fec7544c8a0d92`.
- `scripts/proof/results/official-neutral-coverage-20260906.json`: complete
  descriptive coverage with source/output/code checks. File SHA-256:
  `1060bb8679fac0f51275c6f6dd009ad5e8d700bf2089b7d2bd4cb42c1418be40`.
- `scripts/proof/results/official-neutral-prospective-reservation-20260906/`:
  complete six-pipeline reservation and separate success-health marker.

The compact [machine proof](analytics-first-neutral-experiment-proof-20260906.json)
copies exact metrics/intervals and binds the evidence files. Root independently
rehashed all 9,186 coverage evidence/code files, all eleven inner experiment
artifacts/receipts, and the 17 inventoried legacy artifacts. The current full
offline Python suite passed 1,321 tests, with 16 network tests deselected and
34 warnings (33 existing datetime deprecations and one physical-core-detection
fallback). Fit, prediction and scoring use fixed single-thread pools. These
counts are one full-suite result, not a sum of overlapping focused runs.

Database rollout, complete real nightly integration, hosted blocking/load,
field-level consumer coverage and predictive-quality acceptance remain open.
Passing structural tests and obtaining a real baseline are progress, not a
world-class quality certification.
