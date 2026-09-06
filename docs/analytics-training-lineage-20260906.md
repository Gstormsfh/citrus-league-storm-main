# Training lineage: evidence required before a new evaluation

This is a read-only code/artifact audit, not a model-quality measurement. No
pickle/joblib artifact was deserialized and no training, calibration, scoring or
database mutation was run. Version names below identify code paths only.

The documented historical and working-shot CSVs are absent from both this
worktree and the corresponding data directories of `/Users/gstorms/dev/citrus`.
The inventory references an old Windows Downloads copy; the current workflow
manifest points to ignored `data-pipeline/data/historical/` files. Absence here
does not establish absence elsewhere. Subsequent authorized filename-first
discovery also found no historical shot CSV/archive in Downloads, Documents/Codex,
the main repository or Codex worktrees; Spotlight returned no match. Demo
`shots.json` and a containing demo archive provide player-level visualization
aggregates, not event/game/date memberships. The existing data dictionary is
schema documentation, not observations. No large dataset was downloaded.

Later read-only database discovery found a distinct potential historical source:
`raw_nhl_data` contains NHL PBP objects for seasons 2017–2025 with official endpoint
URLs, stored semantic hashes and fetch timestamps. This is not the same source
as the historical `raw_shots` rows labeled `bulk_import_20260730`; those derived
rows must not be assumed free of MoneyPuck lineage.

One archived game per season was exported and checked against a new official
observation. All nine archived rows passed provenance, normalization and final
totals checks separately; all 807 normalized unblocked events matched the new
observations. Three full payloads differ in eight `zoneCode` fields on nonincluded
events. Both full revisions are retained. Original archive timestamps are from
2026-08-11, not the historical game dates, and are never refreshed by replay.
`monitoring/archive_source_receipt.py` reproduces the legacy Python sorted-key
JSON hash (not HTTP bytes); `archive_revision_comparison.py` preserves both
timestamps and distinguishes full-payload, event-evidence and typed-field changes.
See `analytics-sequence-archive-proof-20260906.json` for the retained evidence.
This establishes a promising source and a verified sample, not full historical
coverage, historical-as-of availability, a model-ready corpus or rights to every
derived table. A full scoped source freeze and independent historical schedule
reconciliation remain required before fitting.

The user authorized legitimate reacquisition, then explicitly excluded MoneyPuck
files from new work pending rights confirmation. The public [download terms](https://moneypuck.com/data.htm)
limit free use to non-commercial purposes and direct other uses to permission
inquiries. No MoneyPuck dataset, predictions or fitted parameters will be acquired
or used for new training. The later clarification expressly permits studying
published methods and independently implementing the ideas with Citrus inputs.
Existing local artifacts are preserved; their presence does not settle provenance
or usage rights.

These SHA-256 hashes identify local bytes, not training populations,
compatibility, deployment identity or quality:

| Artifact under `data-pipeline/models/` | SHA-256 |
|---|---|
| `xg_model_moneypuck.joblib` | `6c4cce447cb14b877d8245bc3ba690b8165758434698ca2aebaf65bf5bb9c9cd` |
| `model_features_moneypuck.joblib` | `d079238cd1c3d56a9d038b087067d94881cfce5f70d8c00a4579edd59639a39d` |
| `xg_shot_type_calibration.joblib` | `ab87a3d247b08df2c25e8aeff610651a950c158ce1bd6c9b195e2f0351df9e8e` |

`scripts/utilities/train_xg_v3.py` concatenates historical and Citrus exports,
then performs stratified random row splits. Games and time are not separated by
that split. Missing features and nonfinite values become zero; this does not
establish equivalent feature availability across sources.

`scripts/utilities/train_xg_v4.py:648` trains on seasons 2017–2022 plus 2025 and
evaluates 2023–2024. Its calibration subset is randomly drawn from training rows.
This is not a chronological forward holdout. A comment calling the earlier
period untouched does not demonstrate absence of prior tuning or inspection.
A separate baseline has an earlier-season split, but no executed report or
immutable split-membership receipt was found locally.

`scripts/utilities/train_xg_calibration.py:56` reads supplied shot types,
stored predictions and outcomes, then fits on the entire CSV. It does not enforce
an independent calibration population, bind the prediction-producing model or
record source/split hashes. A held-out description is not an enforced contract.

`scripts/utilities/export_raw_shots_csv.py` exports multiple seasons despite its
2025 filename. The older concatenation path has no visible event-identity
deduplication across historical and Citrus sources. The Markdown training
manifest is workflow documentation, not a content-addressed executed-run receipt,
and retains root `models/` output instructions while committed artifacts live
under `data-pipeline/models/`.

After source gates, a split planner must pin source/feature hashes, explicit game
dates and identities, population/feature versions, exclusions and chronological
boundaries. Train, calibration and test must have disjoint game/event identities
and strictly ordered date windows; no missing-date inference is permitted.
Existing artifacts cannot retrospectively supply that evidence.

The pure `projections/chronological_split.py` planner now enforces this manifest
contract: canonical regular/playoff identities, explicit season-consistent game
dates, timezone-qualified observations, whole-game chronological assignment and
complete source-event membership including reasoned exclusions. All supplied
actual game dates must be no later than the UTC observation/current dates; this
is basic calendar consistency, not proof of the exact game time or availability.
Malformed windows, overlapping dates, unbound feature/source hashes and omitted
events fail before producing a plan. Sixty-nine synthetic tests pass.

An empty future test reservation additionally binds the complete source/event
manifest, feature/population definitions, window specification, and supplied
pipeline/acceptance-criteria digests. Altering earlier training/calibration
membership, observations or feature rows invalidates the declaration. Its output
is explicitly `manifest-consistency-only` / `reserved-not-evaluated`: supplied
hashes and freeze timestamps are not authentication, proof of an actual fitted
pipeline freeze, or an executed evaluation. No real historical split, fit,
calibrator or prospective declaration was run by these tests.

Historical evaluation will be labeled retrospective unless an actually unused
period can be established. The user approved the defensible path: freeze the
complete pipeline and reserve a new prospective test window with predeclared
criteria. No historical period has been relabeled untouched. No trained-model
improvement or fantasy-value result is claimed. Foundation work and independently
implemented flurry/rebound mathematical contracts continue without publishing
unvalidated metrics.
