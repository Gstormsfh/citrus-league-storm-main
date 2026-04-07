# pipeline-deadman

Dead-man switch for the Citrus data pipeline. Catches silent pipeline failures
within ~15 minutes instead of the previous ~3-day horizon.

## What it checks

Queries `raw_nhl_data` for the most recent `scraped_at` timestamp. This table
is written every sync cycle by `data-pipeline/acquisition/data_scraping_service.py`
via `ingest_live_raw_nhl.upsert_raw_game()`, making it the most reliable
"pipeline is alive" signal in the system.

If the last ingestion is older than **15 minutes** AND we are inside the
active ingestion window (NHL season, 06:00–01:00 Mountain Time), the function
posts an alert to `DEADMAN_WEBHOOK_URL` (Discord/Slack-compatible JSON body with
both `content` and `text` fields).

Every invocation writes a row to `public.pipeline_runs` with
`service_name = 'pipeline-deadman'` and metadata containing the observed lag,
so you get a permanent audit trail of health checks.

Returns JSON: `{ status, last_ingestion_at, lag_seconds, alerted }`.

## Deploy

```bash
supabase functions deploy pipeline-deadman
```

## Schedule

Supabase Dashboard → Edge Functions → `pipeline-deadman` → Cron.
Recommended cron expression:

```
*/5 * * * *
```

(Every 5 minutes. With a 15-minute threshold this gives 2–3 checks before the
alert fires, avoiding transient false positives.)

## Required env vars

| Name                        | Source                                                 |
|-----------------------------|--------------------------------------------------------|
| `SUPABASE_URL`              | Auto-provided by the Edge Functions runtime            |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-provided by the Edge Functions runtime            |
| `DEADMAN_WEBHOOK_URL`       | Set via `supabase secrets set DEADMAN_WEBHOOK_URL=...` |

If `DEADMAN_WEBHOOK_URL` is unset and the pipeline goes stale, the function
logs loudly (`console.error`) and still returns 200 so the schedule keeps
firing. Set the secret before relying on this alerting path.

## Migration dependency

Requires the `public.pipeline_runs` table, created by
`supabase/migrations/20260407032726_pipeline_runs_table.sql`. Apply that
migration before deploying the function.
