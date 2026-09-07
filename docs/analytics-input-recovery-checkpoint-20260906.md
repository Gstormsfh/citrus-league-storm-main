# Full-input recovery checkpoint

The original Citrus ecosystem is the preservation baseline. The smaller
first-party xG experiment never established feature parity with that ecosystem.
Its measured losses remain valid for its declared scope, not a complete legacy
replacement claim. No original model, raw observation or experiment was deleted.

## Executable coverage, not a memory-based checklist

`scripts/proof/check_analytics_input_coverage.py` checks the canonical
`analytics-input-coverage-ledger-20260906-v5.json`. Earlier ledgers are retained;
v5 adds the retrospective on-ice annotation fields to zone/quality, both
recorded-penalty channels and the separate conditional-calibration component.
The checker inventories each legacy declared training input, each field in both
shot-record builders, development inputs, new movement inputs and named model
families. Repeated names in different paths remain separate obligations.

It also discovers and hashes Python files under projections, acquisition,
scoring and utilities. Changed expressions, source bytes, added/removed files or
missing ledger entries fail coverage until explicitly reconciled. The normal
pipeline test suite invokes this through `test_analytics_scope_coverage.py`;
`test_analytics_input_coverage.py` tests failure cases.

Each item has six explicit gates: source semantics, availability/identity,
causal timing, train/serve parity, chronological quality, and consumer lineage.
Closing or exempting a gate requires file-hashed evidence. Initial gates remain
open rather than inheriting acceptance from a comment or related experiment.
`--require-accepted` fails while unresolved decisions/gates remain. A green
coverage check is **not** a green deployment or model-quality check. Hashed
evidence requires substantive review; a hash alone does not prove its claims.

This is not a promise that undiscovered runtime paths can never exist. Discovery
outside the catalogued directories, actual deployment bundles, SQL and external
schedulers still need reconciliation. Those limits must remain visible.

## Parallel audits completed

- [Feature extraction/training parity](feature_parity_audit-20260906.md):
  previous-pointer overwrite, incompatible coordinate frames, PP state,
  shot-only pass-helper callers, missingness and historical split semantics.
- [Serving audit](analytics-legacy-serving-audit-20260906.md): artifact binding,
  divergent clipping/calibration, category handling and batch-dependent inputs.
- [Model dependency audit](analytics-model-dependency-audit-20260906.md): xA,
  rebound occurrence/continuation, flurry, talent, creation value, goalie outputs,
  physical forecasts, GAR and FPAR, with distinct per-family gates.
- [Every original training input](analytics-legacy-input-parity-20260906.md):
  original feature intent versus newer experimental schema, not merely names.

Source-isolated diagnostics reproduce existing defects without importing model
loaders. They do not measure affected production rows or certify fitted artifacts.

## Implemented recovery components

These are separate non-serving modules; they do not change an old fitted model's
input distribution or silently replace its feature schema.

| Component | Implemented contract | Still required |
|---|---|---|
| `pre_shot_movement.py` | Common-frame signed crossing, lateral/longitudinal/Euclidean displacement, angle change and elapsed-time rates; full source replay and matched fit retained | Matched primary failed; stable chronological quality and serving integration remain open |
| `pre_shot_history.py` | Emit before current update; separate immediate live-event and same-team prior-attempt contexts; boundary/ownership resets; explicit orientation; full source replay | Broader original-family reconciliation and serving integration |
| `pre_shot_zone_context.py` | Original-style zone thresholds, distance normalization and quality weights; common-frame geometry; matched fit and independently reviewed source vectors | Matched primary failed; no tracked-pass or accepted-successor claim |
| `pre_shot_penalty_context.py` | Strict-prefix same-team/opponent recorded annotations; explicit duration/age and missingness; independently tested | Real-source replay, chronological candidate; true active-penalty clocks remain separate |
| `conditional_calibration_shape.py` | Independently tested nonnegative context-specific slopes; matched source replay and independently recomputed point guard pass | Robust/prospective evidence, original-family parity and serving acceptance remain open |
| `pl_onice_membership.py` | Nested official report cells and bidirectionally unique roster/event joins; independent tests and retained-source pilot | Full coverage, pre-shot timing, interval validation and any model admission remain open |
| `fixed_feature_transform.py` | Saved training-only medians, missing indicators and category vocabularies; no inference-batch fitting; strict schema and JSON roundtrip | Bind exact model/transform/calibrator package and consumer routes |

Movement has independent geometric/numeric review. Actual selector → movement →
transform integration tests verify singleton/batch/permutation and current-goal/
future invariance. None proves better predictive accuracy. Same-team prior
attempt context is not a tracked pass; observed event displacement is not goalie
tracking. The original pass/zone/xA ideas remain explicitly open, not discarded.

## Next ordered gates

1. Replay new components on the retained first-party corpus, preserving event
   identities, missingness and all old vectors; finish original-family coverage.
2. Declare matched family ablations before fitting. Validate calibration and
   proper losses across unchanged chronological populations and difficult groups.
3. Bind one immutable input/model/calibrator contract and replay every scoring
   route before deployment; retain raw/calibrated/flurry/talent quantities.
4. Validate continuation, xA, goalie, physical forecasts and on-ice quantities
   independently before downstream GAR/FPAR acceptance.

No production change or new predictive-quality claim is made by this checkpoint.

## Executed local verification

Final on-ice recovery rerun: **2,306 passed**, 16 network tests deselected and
33 existing UTC warnings. Receipt: `onice-input-recovery-full-suite.xml` in the
verification directory below. A separate current proof selection passed 49
tests; selections overlap and must not be summed as unique tests.

Penalty/conditional-calibration rerun: **2,269 passed**, 16 network tests
deselected and 33 existing UTC warnings. Receipt:
`penalty-conditional-full-suite.xml` in the verification directory below.
Canonical v5 coverage records 465 obligations and 3,255 unresolved decisions/
gates; successful enumeration is not acceptance or completed integration.

Zone recovery rerun: **2,170 passed**, 16 network tests deselected and 33 existing
UTC deprecation warnings. Receipt: `zone-recovery-full-suite.xml` in the same
verification directory below. The separate zone runner/module/coverage selection
passed 55 tests; the independent point-reviewer selection passed 18 tests.
These selections overlap the full suite and are not additive totals.

Full offline pipeline suite: **2,132 passed**, 16 network tests deselected;
33 existing UTC deprecation warnings. Separate coverage/legacy diagnostic run:
**20 passed**. Receipts are `input-recovery-full-suite.xml` and
`input-recovery-diagnostics.xml` under
`scripts/proof/results/event-memory-verification-20260906.wlwiM7/`.
These are execution results for the local code, not fitted-model acceptance.

Recorded penalty context additionally passed a source-pinned sample:
`penalty-source-audit-20260906-systematic100/report.json` retains per-season
availability and 44,972 independent comparisons plus 300 prefix/current-goal
checks. This verifies annotation extraction, not active penalty reconstruction
or a measured accuracy gain.
