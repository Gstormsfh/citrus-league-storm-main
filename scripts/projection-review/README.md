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
