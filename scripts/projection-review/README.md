# Canonical source review

Local, league-neutral review of every canonical team and player, including TEAM NOTES, rates, workload, roles, structured availability, immutable source evidence, and review history. Availability and forecast coverage are separate. The server reads the configured canonical file afresh; browser edits exist only in memory until a patch is downloaded. There is no database connection or apply endpoint.

```sh
python3 scripts/projection-review/server.py --source /absolute/path/canonical.json
```

Open http://127.0.0.1:8766. The current source in the reconciliation task is `/Users/gstorms/.codex/worktrees/4304/citrus/tmp/projection-audit/canonical/canonical.json`. A different checkout must supply its own explicit source path. The server checks the schema and revision digest; authoritative semantic validation belongs to `data-pipeline/draftkit/canonical_review.py` in the reconciliation task.

Review changes, supply a reason and at least one evidence reference, and download the patch. Export checks that the source revision still matches the loaded base. A stale source leaves your draft intact but blocks export. No automatic rebase or publication occurs.

Patch contract:

```json
{"base_revision":"loaded SHA-256","reason":"Why this change is warranted","evidence":["dated URL or document reference"],"player_updates":[{"player_id":"stable NHL ID","changes":{"exposure":{"used":80}}}],"team_updates":[]}
```

Rates use a complete replacement map; other supported player sections use partial changes. Team notes preserve every original record and its coordinates/evidence; appended notes carry `manual_review` authority. Blank nullable fields remain null; zero stays zero. Counts preview is rate × exposure once. Roster probability never applies another implicit multiplier. The editor does not show league-bound fantasy points or rankings.

Apply using the reconciliation owner's CLI, with a new output filename:

```sh
python3 /path/to/data-pipeline/draftkit/canonical_review.py apply /path/to/canonical.json --patch /path/to/downloaded-patch.json --output /path/to/new-reviewed-revision.json
```

That CLI validates fields, rejects stale revisions, rebuilds derived counts, records before/after history and evidence, and hashes the new revision. Point the review server at the new file to continue. Publication remains a separate workflow; exported patches and guide drafts do not activate anything.

## Guide export

The completed workbook guide remains unchanged. Import a specific canonical revision into a separate snapshot, then build a separate review PDF:

```sh
python3 scripts/draft-guide/import_canonical.py /path/to/canonical.json --revision FULL_HASH --output /path/to/canonical-guide-data.json
python3 scripts/draft-guide/build.py --data /path/to/canonical-guide-data.json --settings /path/to/selected-league-settings.json --league "Selected league name" --output /path/to/Canonical-Review-DRAFT.pdf
```

Without a settings file, the guide explicitly selects and labels **Citrus default scoring**. The manifest records the full weights and their SHA-256 identity. No live league identity is inferred. Canonical imports remain marked DRAFT until a verified published-run contract is available. Unknown forecasts receive no score or rank; metadata probability is not reapplied. The guide's supported scoring categories exclude plus/minus; the complete canonical rates remain in the snapshot.

## Verification

```sh
python3 -m unittest discover -s scripts/projection-review -p test_server.py
python3 -m unittest discover -s scripts/draft-guide -p 'test_*py'
```

See `REVIEW-CHECKLIST.md` for coverage and owner-boundary checks. Existing source files and previous revisions are never overwritten by the review server or canonical importer.

A formula-driven workbook can be exported from the same revision and weights:

```sh
python3 scripts/draft-guide/export_canonical_xlsx.py /path/to/canonical.json --revision FULL_HASH --settings /path/to/selected-league-settings.json --league "Selected league name" --output /path/to/Canonical-Review-DRAFT.xlsx
```

It contains all player rows, 32 team tabs with their actual TEAM NOTES text, source history and editable supported scoring weights. Workbook edits are local preview edits; use the source review patch workflow to change canonical inputs. The initial scoring fingerprint does not claim to track later Excel edits. The exporter uses Codex's bundled Node/artifact-tool runtime. PDF generation and the full Python test suite require the bundled Python runtime with PyMuPDF, reportlab and openpyxl; on this host it is `/Users/gstorms/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3`.

UI boundary regression: `node scripts/projection-review/test_ui.mjs /path/to/canonical.json`. This executes the actual UI script and verifies validation, full rate maps, note preservation, and failed/stale source checks without applying patches.

## Published source lineage

The server also accepts an explicit exported-view wrapper:

```json
{"publication_view":"canonical_published_runs","run_id":"current derived run ID","revision":"current runtime revision","source_run_id":"original reviewed source run ID","source_revision":"original source SHA-256","source_payload":{},"exported_at":"dated export timestamp"}
```

`source_payload` must contain the complete original canonical input document, whose `revision` and Python digest match `source_revision`. The marker is added by the exporter; it is not a database column. Optional `exported_at` and `as_of` are displayed when supplied. A marker identifies an exported view snapshot, not a live verification of active publication.

The atomic `/api/review` response contains `{source, publication_context}`. Edits and patch `base_revision` use only the original source revision. Runtime run/revision and export context remain separate readonly metadata and never enter the strict patch schema. `/api/source` returns the unmodified source document for compatible readers. Derived nightly remaining counts and their PostgreSQL hash are not editable inputs.

A changed source revision blocks patch export. A runtime-only change preserves a valid source patch but warns that publication needs the reconciliation owner's current-active-revision comparison. Activation requires `p_expected_active_revision` whenever a run is already active. This editor neither applies patches nor invokes activation. The source importer/workbook exporter still require a raw source document and label outputs DRAFT; do not substitute a derived runtime payload or infer publication approval from a local file.


## Manual injury/status authority

Citrus's owner is the operational source for injury/status updates until another source is adopted. An automated feed is not required for this workflow. Missing or expired evidence remains Unknown; do not infer health, injury, suspension or IR eligibility from games/starts or forecast coverage.

Open the existing local source editor (currently http://127.0.0.1:8766), check the displayed source/runtime identity, select a player, and choose **Record a manual confirmation**. Enter the actual status, evidence date (`as of`), next review date (`review after`), reason, your name, a dated review reference and confirmation date. External reports still require an HTTPS article URL; a manual confirmation does not require one. A review reference can be a dated Citrus review or retained user instruction. Record only facts you are confirming; this button does not confirm every player or turn Unknown into Healthy.

The manual source is a structured `manual_confirmation` record under the existing `reviewed_report` authority. Display provenance reads “Manual confirmation by [name]: [reference]”. Names/references/reason and valid dates are required, confirmation dates cannot be in the future, and the review deadline must follow the confirmation date. Existing external reports retain their HTTPS provenance requirements. This describes attribution of the owner's confirmation, not independent verification by an external publisher.

Review the change set; add the overall reason and evidence reference; download the review patch. This remains an unpublished draft. Use the existing canonical review CLI against the exact base revision, then ordinary reviewed source staging, actual validation and guarded metadata-only runtime activation. Preserve every numerical value and the model-refresh timestamp; never activate old source-number payloads over the effective runtime or run model refresh to change a status. A retained before-image and reasoning log record the old availability. Status changes do not alter rates, workload, scoring, lineup or fantasy IR eligibility.

Reconfirm before the review deadline when warranted. Expiry means Unknown, not recovery. The current baseline must be reconciled against actual owner-confirmed facts; the presence of old workbook notes alone does not make it current.
