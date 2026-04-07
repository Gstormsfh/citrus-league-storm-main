// pipeline-deadman: dead-man switch for the Citrus data pipeline.
//
// What this does:
//   - Reads the most recent `scraped_at` from `raw_nhl_data` (written every
//     sync cycle by data_scraping_service.py -> ingest_live_raw_nhl.upsert_raw_game).
//   - If lag > 15 minutes during active ingestion windows (NHL season, 06:00–01:00 MT),
//     POSTs an alert to DEADMAN_WEBHOOK_URL (Discord/Slack-compatible JSON body).
//   - Writes a row to `pipeline_runs` recording this health check.
//
// Deployment:
//   supabase functions deploy pipeline-deadman
//
// Scheduling (every 5 minutes):
//   Supabase Dashboard -> Edge Functions -> pipeline-deadman -> Cron
//   Cron expression: */5 * * * *
//
// Required env vars (set via `supabase secrets set`):
//   SUPABASE_URL                  (auto-provided)
//   SUPABASE_SERVICE_ROLE_KEY     (auto-provided)
//   DEADMAN_WEBHOOK_URL           (Discord/Slack incoming webhook; optional)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SERVICE_NAME = "pipeline-deadman";
const FRESHNESS_TABLE = "raw_nhl_data";
const FRESHNESS_COLUMN = "scraped_at";
const LAG_THRESHOLD_SECONDS = 15 * 60;

// NHL season window (roughly): October through mid-June.
function inSeason(nowUtc: Date): boolean {
  const month = nowUtc.getUTCMonth(); // 0-indexed
  // Active months: Oct(9), Nov(10), Dec(11), Jan(0), Feb(1), Mar(2), Apr(3), May(4), Jun(5)
  return month >= 9 || month <= 5;
}

// Active ingest window: 06:00–01:00 Mountain Time (i.e. skip 01:00–05:59 MT).
// MT is UTC-7 (MST) or UTC-6 (MDT). We approximate with UTC-6 to be inclusive —
// this only affects a 1-hour boundary and is intentionally loose.
function inActiveHoursMT(nowUtc: Date): boolean {
  const mtHour = (nowUtc.getUTCHours() - 6 + 24) % 24;
  // Active if hour is 6..23 or 0 (i.e. NOT 1..5)
  return mtHour >= 6 || mtHour === 0;
}

serve(async (_req: Request) => {
  const startedAt = new Date();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const webhookUrl = Deno.env.get("DEADMAN_WEBHOOK_URL");

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const respond = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  const logRun = async (
    status: "success" | "failed",
    metadata: Record<string, unknown>,
    errorMessage?: string,
  ) => {
    const { error } = await supabase.from("pipeline_runs").insert({
      service_name: SERVICE_NAME,
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      status,
      metadata,
      error_message: errorMessage ?? null,
    });
    if (error) console.error("[pipeline-deadman] failed to log run:", error);
  };

  try {
    const { data, error } = await supabase
      .from(FRESHNESS_TABLE)
      .select(FRESHNESS_COLUMN)
      .order(FRESHNESS_COLUMN, { ascending: false })
      .limit(1);

    if (error) throw error;

    const lastIngestionAt: string | null = data?.[0]?.[FRESHNESS_COLUMN] ?? null;
    const now = new Date();
    const lagSeconds = lastIngestionAt
      ? Math.floor((now.getTime() - new Date(lastIngestionAt).getTime()) / 1000)
      : Number.POSITIVE_INFINITY;

    const activeWindow = inSeason(now) && inActiveHoursMT(now);
    const stale = lagSeconds > LAG_THRESHOLD_SECONDS;
    const shouldAlert = activeWindow && stale;

    let alerted = false;
    if (shouldAlert) {
      if (!webhookUrl) {
        console.error(
          `[pipeline-deadman] STALE PIPELINE — lag=${lagSeconds}s, last=${lastIngestionAt}, but DEADMAN_WEBHOOK_URL is not set!`,
        );
      } else {
        const content = `:rotating_light: Citrus pipeline dead-man: no writes to ${FRESHNESS_TABLE} in ${Math.floor(
          lagSeconds / 60,
        )} minutes (last: ${lastIngestionAt ?? "never"}).`;
        try {
          const res = await fetch(webhookUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ content, text: content }),
          });
          alerted = res.ok;
          if (!res.ok) {
            console.error(
              `[pipeline-deadman] webhook POST failed: ${res.status} ${await res.text()}`,
            );
          }
        } catch (e) {
          console.error("[pipeline-deadman] webhook error:", e);
        }
      }
    }

    const metadata = {
      last_ingestion_at: lastIngestionAt,
      lag_seconds: Number.isFinite(lagSeconds) ? lagSeconds : null,
      threshold_seconds: LAG_THRESHOLD_SECONDS,
      active_window: activeWindow,
      stale,
      alerted,
      freshness_table: FRESHNESS_TABLE,
    };

    await logRun(stale && activeWindow ? "failed" : "success", metadata);

    return respond({
      status: stale && activeWindow ? "stale" : "ok",
      last_ingestion_at: lastIngestionAt,
      lag_seconds: Number.isFinite(lagSeconds) ? lagSeconds : null,
      alerted,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[pipeline-deadman] error:", msg);
    await logRun("failed", { error: msg }, msg);
    return respond({ status: "error", error: msg }, 500);
  }
});
