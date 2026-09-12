# Citrus configurable draft guide

Local league-scoring interface and complete PDF generator. Open `Open Citrus Guide.command`, change league weights, then choose **Generate PDF**. Save/load settings preserves your league configuration. The interface runs at http://127.0.0.1:8765 and uses the checked-in workbook snapshot; it does not query or write production.

## Reproduce

Requires Python 3.12+, Node 22.18+ (TypeScript stripping), and the dependencies in `requirements.txt`. The launcher finds the bundled Codex runtimes when available. `CITRUS_NODE` can select a Node executable.

```sh
python3 -m pip install -r scripts/draft-guide/requirements.txt
python3 scripts/draft-guide/build.py
python3 scripts/draft-guide/build.py --settings /path/to/citrus-league-settings.json --output /path/to/my-guide.pdf
python3 -m unittest discover -s scripts/draft-guide -p test_scoring.py -v
python3 scripts/draft-guide/verify_pdf.py output/pdf/Citrus-Draft-Kit-2026-27-Complete.pdf
```

To launch the interface from Terminal, run `python3 scripts/draft-guide/server.py --open`. It runs until you press Ctrl-C; use a separate Terminal for build/test commands while it is running.

The CLI accepts either the UI's saved `{league, weights}` object or a raw weights object. `--league` overrides the saved name. PDF generation writes an adjacent manifest containing source fingerprint, settings, page coverage and featured players.

## Update the source

```sh
python3 scripts/draft-guide/import_workbook.py '/path/to/authoritative.xlsx'
python3 scripts/draft-guide/build.py
```

Restart the local server and refresh the browser after importing a revised workbook. The importer reads cached numeric formula results; the source must contain calculated caches. It preserves the supplied Draft Board/Goalies sheet schemas, all team rows and notes, and rookie commentary. Missing rookie or team projections are shown as unavailable, never fabricated as zero. Original source files remain untouched.

`workbook-data.json` is the numeric source of truth for this renderer. Its SHA-256 identifies the exact workbook. The superseded original-PDF snapshot `edition.json` is retained only for source-art reconstruction. The override JSON is not ingested: its historical `rates_per_game` label requires separate lineage reconciliation.

## Scoring contract

`score.mjs` executes the repository's actual shared `reweightProjections` scorer. Source category values divided by their source games define category rates (new per-game rows use a source exposure of 1); applying projected games/starts and fantasy weights derives fantasy points. Changing weights changes fantasy points, contributions and competition ranks. It does not change underlying category totals, source games, projected games, source labels, roster probabilities or editorial tiers. Source roster probability is applied separately to adjusted points.

Source provenance is visible: MODEL, MANUAL, and DEFAULT. DEFAULT identifies a supplied rookie cohort prior; its projected games already include cohort availability assumptions. Ranking category columns show comparable projected season totals even when source exposure bases differ. The intentional skater model ceiling of 83 is preserved; the workbook’s season setting does not force every skater to 84 games. The interface changes fantasy weights, not season length or player games. Unsupported categories, missing weights and nonfinite numbers are rejected. Plus/minus is absent from this source. Ties use competition ranks; effectively identical Excel totals can have inconsistent cached ranks from floating-point artifacts.

## Design and retained assets

Cream, evergreen and Citrus orange, Barlow typography, authentic hockey action photography, original Citrus/team marks and all eleven unique original photo subjects. Each orange ranking row names the player featured immediately below it. A photo subject appears once per guide. All feature values and bars use the current league settings.

The complete edition covers the entire skater/goalie source, position boards, individual rookie profiles and commentary, and every team lineup and player note. Contents links and bookmarks support navigation. Internal ADP/value fields are omitted as instructed by the source.

See `assets/PHOTO-CREDITS.md` for original added-photo URLs and CC BY-SA 2.0 credits. Existing player photos and brand marks retain their source provenance; their commercial rights were not supplied. Font licenses are included.

## Scope and release status

This tool is standalone and local. It changes no native app, backend, deployment, App Store submission or production data. Build 18 compatibility is unaffected by running it. Integrating new UI into a native binary would be separate app work and may require build 19; this delivery does not certify live player cards or draft rooms. The separate source reconciliation task owns that end-to-end audit.

See `WORKLOG.md` for concrete evidence, pending source reconciliation, tests and launch dependencies. Monday 14 September is the launch target; work is being completed as soon as possible, not deferred until Monday.
