# Phase 0 — FUT Games Awaiting Re-scrape

Institutional memory for **0b** (Oct-Dec 2025-26 gap fill + stale-FUT refresh): 17 games in `raw_nhl_data` were marked `processed=true` on **2026-05-11** despite containing zero extractable plays. These are scheduled-but-never-played-as-LIVE games whose `raw_json` snapshot is from before the game actually ran (or has been postponed). Their `raw_json->>'gameState' = 'FUT'` with `jsonb_array_length(raw_json->'plays') = 0`.

The processed-flag flip unblocks the **6b** extraction-backlog drain (without it, the drain loop got stuck retrying these games, hitting `MAX_RETRIES` and exhausting `max_batches` before the actually-drainable OFF games at the bottom of the desc-ordered queue ever got a turn).

## Target for 0b re-scrape

When 0b runs, each of these games should be **re-scraped from the NHL API**, replacing the empty raw_json with real PbP data. After re-scrape:

1. Reset `processed = FALSE` on the game so the standard drain can re-process it.
2. Re-run `data-pipeline/scoring/run_daily_pbp_processing.py` (or the equivalent extraction wrapper) to populate `raw_shots`.
3. Validate the game's shots land at the expected TOI population rate (per 6a pilot v4: ~90-95% TOI populated, moat features 100%, no errors).

## The 17 game_ids

| game_id | game_date | Notes |
|---|---|---|
| `2025020828` | 2026-01-26 | Mid-season regular — postponed game; likely rescheduled later |
| `2025021207` | 2026-04-04 | First of 15 same-date FUT games — possible labor stoppage / scheduling anomaly |
| `2025021208` | 2026-04-04 | |
| `2025021209` | 2026-04-04 | |
| `2025021210` | 2026-04-04 | |
| `2025021211` | 2026-04-04 | |
| `2025021212` | 2026-04-04 | |
| `2025021213` | 2026-04-04 | |
| `2025021214` | 2026-04-04 | |
| `2025021215` | 2026-04-04 | |
| `2025021216` | 2026-04-04 | |
| `2025021217` | 2026-04-04 | |
| `2025021218` | 2026-04-04 | |
| `2025021219` | 2026-04-04 | |
| `2025021220` | 2026-04-04 | |
| `2025021221` | 2026-04-04 | |
| `2025030234` | 2026-05-11 | Today's playoff game — genuinely not yet played at flag-flip time |

## How to detect this state in the future

```sql
SELECT game_id, game_date, raw_json->>'gameState' AS state,
       jsonb_array_length(raw_json->'plays') AS plays_count,
       processed
FROM raw_nhl_data
WHERE raw_json->>'gameState' = 'FUT'
  AND jsonb_array_length(raw_json->'plays') = 0;
```

If the row has `processed = TRUE` but the game has since been played, the raw_json needs a re-fetch from NHL API to pick up the real plays.

## Operational note for `0b`

The April 4 cluster (15 games same date, all FUT) is the most striking pattern. Worth investigating during 0b:

- Were these games genuinely cancelled (lockout day, weather event, etc.) and the schedule never updated?
- Or did our scraper run before the games were played, the games then played, and we never re-scraped?

The diff in NHL's official schedule for 2026-04-04 vs what's in `nhl_games` will answer this. If the games **were** played, 0b is non-optional for those 15 + the January 26 + today's playoff. If they **were** cancelled, the FUT/empty state is correct forever and the `processed=true` flag is permanent.

## Related references

- `apps/web/docs/PHASE_0_EXECUTION_PLAN.md` § 1 (0b sub-phase scope)
- `apps/web/docs/PHASE_0_VALIDATION_QUERIES.md` § D (0b validation gates)
- The 6b drain that surfaced this state: commit (this commit)
