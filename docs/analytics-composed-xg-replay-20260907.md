# Composed neutral xG candidate: completed retrospective replay

## Delivered

`data-pipeline/projections/xg_candidate_inference.py` provides one callable path:
full declared feature vector → portable numeric tree model → timing-aware
ridge-10 calibration → neutral xG. Calibration context and applicable timing
come from that same feature vector, not a separately supplied context payload.
Targets are not used for inference. This is a packaged retrospective candidate,
not an authorized live model or a claim of industry-leading accuracy.

Create-only results: `scripts/proof/results/composed-xg-replay-20260907-full`.
The manifest lists 18 monthly bundles with exact file hashes and bounded replay
dates. Each embeds its full raw model, schema, calibration map, and pinned
calibration-source health hash. No fitting or production changes occurred.

| Cohort | Events | Raw prediction maximum error | Calibrated maximum error |
| --- | ---: | ---: | ---: |
| fold1 | 120080 | 0 | 2.220446049250313e-16 |
| fold2 | 121033 | 0 | 2.220446049250313e-16 |

All events use the complete certified 47 numeric / 2 categorical feature view.
The raw scores match the frozen calibration-transfer source; final scores match
the completed ridge-10 candidate. This proves composition parity, **not another
accuracy improvement**. Accuracy findings and remaining subgroup weaknesses are
in `analytics-timing-ridge10-result-20260906.md`.

## Use

With the pinned Python dependencies available and `PYTHONPATH=data-pipeline`:

```python
from projections.xg_candidate_inference import XGCandidate

candidate = XGCandidate.load(bundle_path, expected_sha256=manifest_sha256)
predictions = candidate.predict(certified_feature_rows)
```

Rows require unique integer `game_id,event_id`, canonical `game_date` within
the bundle window, `features` in exact schema order, exact categorical keys,
and the original `feature_sha256`. Outputs contain identity, `raw_xg`,
`neutral_xg`, bundle fingerprint, and `publishable: false`. The feature hash
checks integrity against the declared schema; by itself it does not establish
data provenance. Use certified source vectors and trusted manifest hashes.

Reproduce the full source-verified packaging and replay into a **new** directory:

```sh
PYTHONPATH=data-pipeline:scripts/proof python3 scripts/proof/run_composed_xg_replay.py \
  --output scripts/proof/results/composed-xg-replay-new
```

Runtime used: Python 3.12 with NumPy 1.26.4, SciPy 1.13.1 and scikit-learn 1.5.2.
The source closure is rehashed before use and reverified at completion. The
replay reconstructs certified saved movement vectors, not fresh raw-event
features. Applicable prior-SOG gaps and all derived calibration contexts match
the saved calibration inputs. Non-prior-SOG gaps need not share the raw timing
audit's broader predecessor semantics; they receive no timing adjustment.

## Guards and remaining work

- Exact nonpublishing bundle, complete schema view, finite coefficients, earlier
  fit dates, bounded replay dates, unique event IDs, feature hashes, bounded
  chunking, and nonsymlink/hash-checked bundle loading are enforced.
- Focused tests cover scalar/engine parity, target independence, caller-copy
  isolation, order/chunk invariance, malformed inputs and file integrity.
- Inventory v9 adds the new module and emitted contract fields while retaining
  every v8 item and gate. Registration does not mark unresolved inputs accepted.
- Current-season/prospective validation is not supplied by historical monthly
  bundles. Loading one does not authorize extrapolation beyond its date window.
- Remaining timing subgroup bias, special-state source adjudication, finishing
  and talent validation, real appearance/TOI identity, live serving integration,
  and FPAR's physical-forecast foundations are not closed by this replay.
- No MoneyPuck files, predictions or weights were consumed. Official actuals,
  prior experiments, and original ledgers were preserved.

The initial full regression run correctly rejected unregistered source changes;
its receipt is preserved as `composed-xg-20260907-suite.xml`. The post-ledger
run has its own `composed-xg-20260907-reconciled-suite.xml` receipt:
3492 passed, 16 network tests deselected, 33 warnings. Inventory reconciliation
reports 566 items and 3962 unresolved decisions/gates; none is silently accepted.
