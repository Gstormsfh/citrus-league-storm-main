# Canonical projection input contract

`canonical_inputs.py` is an offline, deterministic importer. It does not connect to a database, allocate unassigned goalie starts, train a model, or publish an active version.

Run from the repository root:

```sh
python3 data-pipeline/draftkit/canonical_inputs.py \
  --input-dir tmp/projection-audit \
  --output-dir tmp/projection-audit/canonical
python3 -m unittest discover -s data-pipeline/tests -p 'test_canonical_inputs.py'
```

`build(input_dir: pathlib.Path) -> dict` returns the same document as the CLI. Inputs are `edits.json`, `workbook-full.json`, `directory.json`, `model.json`, `roster-findings.json`, and `overrides.json`. Every input is SHA-256 pinned. The revision is the SHA-256 of the sorted compact JSON document before adding its `revision` field. No wall-clock timestamp enters the build.

The CLI emits `canonical.json`, one player per line in `players.jsonl`, one team per line in `team-ledger.jsonl`, and `coverage.json`. The contract version is `citrus.canonical-projection-inputs.v1`. `scope_player_ids` contains the exact current-directory population; `players` also preserves verified workbook outsiders and required unresolved profiles.

## Numerical meaning

Reviewed workbook edits take precedence over the original workbook. Source workbook component counts divided by their explicit `baseline` produce rates. Final counts equal those rates times `exposure.used`, exactly once. Added model rows already contain rates and explicitly use baseline one. There is no extra 84/82 rescaling, roster probability multiplication, injury multiplier, or goalie share adjustment.

Zero-baseline, zero-exposure, zero-count records retain zero counts with unknown rates. Nonzero counts or destination exposure on a zero baseline are rejected. Missing components remain missing. The old override JSON's misleading `rates_per_game` name does not change the meaning of its contents: that JSON is preserved as historical evidence and is never reapplied over newer workbook edits.

`provenance` preserves MODEL, MANUAL, and DEFAULT distinctions. The explicit `rate_policy` is `refresh_model`, `refresh_cohort`, or `preserve_override`, respectively. Workbook `exposure_policy` is `preserve_season_override`; nonworkbook projected rows use `model_remaining`, and rates-only/unresolved rows use `unallocated`. Initial staging preserves all imported numbers; these policies govern subsequent refreshes. Original workbook inputs and attached legacy override records survive in each affected row. Rates for uncurated directory skaters come from the source model; their existing GP prior is preserved, including cohort GP that already incorporates debut probability. These camp candidates may overlap: their summed totals are not a team forecast. Extra model goalies retain their rates and model exposure priors but have null canonical exposure/counts until a reviewer allocates starts within the team's schedule budget.

## Identity, availability, and roles

Joins use stable NHL player IDs. Duplicate IDs fail validation. Reviewed workbook IDs remain traceable to their source; the importer contains three explicit NHL-profile identity mappings for previously missing Tij Iginla, Matt/Mathew Dumba, and Caleb Desnoyers. An identity alone never supplies forecast rates. Caleb remains explicitly unresolved.

Availability comes only from structured status cells, marked `imported_scenario`; other players stay `unknown`. The importer does not diagnose injuries from notes or statistics. Return windows remain null without structured evidence. Primary injury-review findings remain attached to the player's evidence. Existing exposure already incorporates the imported injury scenario.

Team records retain all qualitative cells with row/column locations. Lineup slots identify a player only when the reviewed slot and canonical team agree; conflicting and ambiguous names remain unresolved placeholders. All inherited lineups are marked assumed. Special-team text is retained without guessing surname joins. Role/PP labels and notes are inputs for review, not proof that a model was conditioned on a particular line or unit.

## Publication boundary

`contract.publication_ready` is false. Structured `publish_blockers` identify unresolved forecasts, unallocated goalies, unresolved slots, and overlapping skater scenarios. Staging this document must not silently clear those blockers or convert a directory record into a confirmed opening-night role. An explicit reviewed workflow should produce a new revision before publication.
