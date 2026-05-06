# `scripts/_deprecated/` — kept-for-reference, not invoked

Scripts in this directory are **not invoked by any current production code,
workflow, or sibling script**. They're preserved here (rather than deleted)
because:

- The git history alone may be insufficient context if a similar problem
  surfaces in the future.
- The behavioral details of how a particular setup-era seeder worked can
  inform a re-implementation.
- The supersession trail makes it cheaper to onboard new contributors who
  see references in old commits or documentation.

**Do not run anything in this directory without first reviewing what
superseded it.**

## Inventory + supersession map

### Setup-era TS one-offs (Dec 2025 / early 2026)

| Script | Superseded by | Notes |
|---|---|---|
| `fetch-nhl-players.ts` | `data-pipeline/acquisition/data_acquisition.py` + `scripts/utilities/populate_player_directory.py` | The Python ingest path uses the same NHL roster API but writes into `player_directory` (canonical, RLS-enabled, season-tagged) rather than the legacy `players` table this script targeted. |
| `fetch-nhl-schedule.ts` | `data-pipeline/acquisition/ingest_playoff_schedule.py` + the schedule discovery built into `data_scraping_service.py` | Schedule ingest is now Python with proxy rotation + retry logic + `nhl_games` upsert. |
| `import-schedule-from-csv.ts` | None (one-time use case) | Was used during initial setup to import a hand-edited schedule from CSV. The current pipeline pulls schedule directly from the NHL API, so a CSV import path no longer exists. Kept for reference if a future emergency requires offline schedule loading. |
| `import-schedule-from-excel.ts` | None (one-time use case) | Same as the CSV variant — Excel-based offline import. Browser quirk required two formats during initial setup. |

### Destructive duplicate

| Script | Superseded by | Notes |
|---|---|---|
| `delete-all-draft-data.sql` | `scripts/nuke-all-draft-data.sql` | Functionally near-identical (both DELETE from `draft_picks` + `draft_order`). The canonical `nuke-` version uses a safer `WHERE draft_status IN ('in_progress', 'completed')` clause on the `leagues` UPDATE, avoiding redundant writes to leagues already at `not_started`. Use `nuke-` for any future destructive draft cleanup. |

## When to revisit

Periodic (annual?) audit of this directory:
- Has anything graduated back to active use? (Unlikely but possible.)
- Has the supersession path itself been deprecated? (E.g., if `data_acquisition.py` gets replaced, the supersession map here needs updating.)
- Are any kept solely for "lineage documentation" of a model that's no longer in production? Time to archive entirely.

## Adding to this directory

If a future audit moves another script here:
1. `git mv scripts/foo.ts scripts/_deprecated/foo.ts`
2. Add an entry to the supersession map above
3. Update the script's CITRUS-CLASSIFICATION header to `# CATEGORY: DEPRECATED` with a `# Superseded by:` line — re-run `scripts/_one_offs/r4_classify_scripts.py` after adding the manifest entry to refresh the header.
4. Single commit.
