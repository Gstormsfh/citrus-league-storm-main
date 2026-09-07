# Improved neutral xG connected to source-verified player finishing

Completed offline bridge: `scripts/proof/compose_player_finishing.py`.
Create-only evidence: `scripts/proof/results/composed-player-finishing-20260907-full`.
No fitting, external download, database write, deployment or original replacement.

The bridge verifies the completed composed-inference and actor-review source
closures, rechecks each raw NHL body's hash, and reruns raw-event actor/roster
verification. Every newly calibrated prediction must join exactly one eligible
event and its declared monthly bundle. Raw type codes independently distinguish
goals, saved shots on goal, and misses. Old actor-ledger probabilities are not
reused as the improved model's xG.

| Check | Fold 1 | Fold 2 |
| --- | ---: | ---: |
| Joined eligible events | 120080 | 121033 |
| Eligible goals | 8648 | 8478 |
| Eligible shots on goal, including goals | 86129 | 83426 |
| Improved neutral xG total | 8960.922423068925 | 8441.125820413905 |
| Player/season/game-type records with eligible attempts | 1269 | 1237 |
| Records retaining multiple team stints | 92 | 68 |

These are **eligible model-event totals, not official complete season actuals**.
An excluded source event is absent from these denominators. Consequently these
percentages must not replace official dashboard shooting percentages or totals.
Roster members with no eligible attempts are not emitted as zero-talent players.
Goalies who shoot remain legitimate shooters. Regular season and playoffs stay
separate, and historical team stints are retained rather than rewritten using
current-team identity.

Each player record exposes eligible-event shooting percentage, goals/neutral-xG,
percentage above expected, and goals-minus-xG using the existing explicit quantity
contract. `estimated_talent` remains null: observed overperformance is not a
shrunk persistent talent estimate. Appearances, TOI and per-60 rates remain null.
The baseline hash identifies the complete monthly-bundle manifest, not a claim
that every historical event used one identical fitted calibration map. Per-event
records retain the exact applied bundle fingerprint and source hashes.

The first fold's summed xG still exceeds observed goals. Correct identity and
quantity accounting does not fix that residual calibration bias or establish
prospective quality. This work closes the mechanical source-to-player bridge;
it does not accept the broader shooting-talent family or FPAR foundation.

## Verification

Focused tests: 18 passed. They cover independent SOG/attempt denominators,
zero-denominator missingness, quantity distinctions, trade and playoff isolation,
order invariance, invalid/missing IDs, duplicate events, source miss/SOG tampering,
wrong bundles, date mismatch and publication rejection. The real run checks
whole-cohort joins, aggregate goal/attempt conservation and reversed-order totals.
Both original source closures are rehashed at completion.

Full-suite receipt: `scripts/proof/results/composed-player-finishing-20260907-suite.xml`.
Result: 3510 passed, 16 network tests deselected, 33 existing warnings.

Reproduce with the pinned runtime and a new output directory:

```sh
PYTHONPATH=data-pipeline:scripts/proof python3 scripts/proof/compose_player_finishing.py \
  --output scripts/proof/results/composed-player-finishing-new
```

Before talent fitting: construct strictly earlier player evidence with a
compatible out-of-fold neutral baseline, reconcile eligible-event versus full
official exposure, validate shrinkage prospectively, and test finishing exactly
once through physical goal forecasts and uncertainty. This ledger supplies
source-linked observations; it is not itself that estimator or acceptance.
