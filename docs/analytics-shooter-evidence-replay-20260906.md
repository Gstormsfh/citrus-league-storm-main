# Saved shooter evidence: replayed, not promoted

Completed replay: `scripts/proof/results/shooter-evidence-replay-20260906-full/`.
The saved shooter-only identity component reproduced its predictions on the
exact validation shots and reconciled player totals. No model was fitted and
no future shot exposure was forecast.

## Evidence recovered

The source is the retained identity-v2 experiment, not the newer movement xG
candidate. Its primary was the joint shooter/goalie model, which failed its
declared guard. The shooter-only secondary result cannot retroactively replace
that primary or erase the failed experiment.

| Period | Model | Brier | Log loss |
|---|---|---:|---:|
| Earlier | Frozen neutral control | 0.061228321 | 0.225414845 |
| Earlier | Shooter-only secondary | 0.061215094 | 0.225242286 |
| Later | Frozen neutral control | 0.060100310 | 0.221992991 |
| Later | Shooter-only secondary | 0.060093080 | 0.221913537 |

These are existing development point results reproduced from saved predictions,
not a newly demonstrated improvement or a fresh confirmatory test. Better proper
losses do not settle aggregate calibration: in the earlier period the shooter
output sums to 9,157.42 expected goals versus 8,648 observed, while the neutral
control sums to 9,120.21. The later sums are 8,515.86 versus 8,478 observed.
Do not correct those totals by fitting on the validation outcomes.

## Dates and quantities

Earlier shooter fit: 2021-07-02 through 2022-06-26; validation: 2022-10-07
through 2023-06-13. Later shooter fit: 2022-10-07 through 2023-06-13;
validation: 2023-10-10 through 2024-06-24. The model's existing validator checks
strictly later dates and whole-game disjointness. These are event-date checks,
not proof of historical publication availability.

The artifact predicts via additive log-odds adjustments. For a given observed
shot set, summing its probabilities gives an expected count conditional on that
set. Dividing that sum by the neutral sum gives a **shot-mix-specific ratio**,
not a constant talent multiplier. The replay also retains the identity-free
global control so intercept changes are not mislabeled as shooter skill.
Unknown/unattributed players are retained, not reassigned to a fabricated player.

Do not plug this ratio into `finishing_quantity_contract.py` as a fitted
goal-rate multiplier. Nor should a log-odds coefficient be multiplied by xG.
No GSAx, daily goals, uncertainty or FPAR quantity is replaced by this replay.

## Verification and remaining work

`scripts/proof/replay_shooter_evidence.py` verifies source health-bound bytes and
the original declared code hashes, validates and replays saved JSON models,
rejects duplicate/missing identities, checks complete finite prediction outputs,
and conserves player-to-total expected goals. It rechecks consumed bytes after
use and seals its new outputs. It does not deserialize legacy binaries or write
to hosted systems. Both fold point losses independently match the retained
result within 1e-12; bootstrap intervals were not recomputed.

The replay/helper and identity-model test selection passed 60 tests. Receipt:
`scripts/proof/results/shooter-evidence-replay-20260906-final-tests.xml`.
The earlier smaller test receipt remains intact. Numerical replay is not an
independent fit or empirical acceptance.

The original probability map and identity effects reused the same earlier
calibration period: sequential fitting, not cross-fitted baseline probabilities.
The actor source is retrospective. Those limitations remain open. Before
reusing the concept with the movement baseline, construct earlier-only
out-of-fold baseline probabilities, declare the shooter-only comparison in
advance, and evaluate both proper losses and calibration. Then separately bind
future shot exposure and verify finishing is counted exactly once in forecasts.
The inspected outer folds cannot serve as a fresh final test. Existing original
artifacts, failed results and production remain unchanged.
