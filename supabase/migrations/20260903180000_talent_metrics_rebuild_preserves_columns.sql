-- ============================================================================
-- rebuild_player_talent_metrics(): stop wiping every column it does not own
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
-- MIGRATION_SAFETY_GUIDE Rule 1 capture (same day, byte-exact, md5
-- d29db427b148049d82e4c5452085ed41 against live prod):
--   supabase/migrations/captures/2026-09-03_pre_talent_metrics_rebuild_preserves_columns.sql
--
-- (a) WHAT CHANGED
--   public.rebuild_player_talent_metrics(integer) is replaced. Signature,
--   return shape, SECURITY DEFINER, search_path and grants are unchanged.
--   Two statements inside the body change:
--
--     before:  delete from player_talent_metrics where season = p_season;
--              insert ... (8 columns, incl. roster_status / is_ir_eligible
--                          copied from a PRIOR season row, if any)
--
--     after:   delete from player_talent_metrics ptm
--               where ptm.season = p_season
--                 and not exists (select 1 from _tm m
--                                  where m.player_id = ptm.player_id);
--              insert ... (xg_per_60, xg_rating, updated_at, last_updated)
--              on conflict (player_id, season) do update
--                 set xg_per_60, xg_rating, updated_at, last_updated
--
--   The function now owns exactly two data columns, xg_per_60 and xg_rating,
--   plus the two timestamps. Every other column keeps whatever its writer
--   last put there.
--
-- (b) WHY NOW
--   pg_cron job 33 (rebuild-talent-metrics, 58 8 * * *) runs this function
--   daily. The unqualified DELETE erased the whole season every morning,
--   so every column written by any other process during the previous 24h
--   was lost, and the INSERT recreated only the xG columns.
--
--   Measured on production 2026-09-03 (read-only, this session):
--
--     season 2025 rows                     940
--     xg_per_60 populated                  940
--     vopa_score populated                   0
--     avg_toi_per_game populated             0
--     gp_last_10 populated (non-zero)        0
--     roster_status populated                0
--     positional_replacement_level           0
--     ros_projection_xg populated            0
--     created_at (min = max)   2026-09-03 08:58:00.060311+00
--
--   All 940 rows carry the same created_at, two seconds after the cron
--   fires. That is the fingerprint of a nightly delete-and-recreate.
--
--   Writers that this wipe silently defeated (all already upsert on
--   (player_id, season), so they are compatible with the new body as-is):
--     data-pipeline/acquisition/fetch_injury_status.py:532
--         roster_status, is_ir_eligible, roster_status_updated_at,
--         roster_status_source
--     data-pipeline/projections/calculate_daily_projections.py:3075
--         vopa_score, positional_*, ros_projection_xg, avg_toi_per_game
--     scripts/utilities/populate_gp_last_10_metric.py:241,396,402
--         gp_last_10, is_likely_to_play
--
--   Readers that see NULLs today because of it (server + app):
--     PlayerDashboardService (vopa_score, avg_toi_per_game), the player
--     card freshness badge, IR-eligibility gating on lineups.
--
--   The prior-season carry-forward of roster_status / is_ir_eligible in the
--   old body is dropped on purpose: it read the table AFTER the delete, so
--   it could only ever find a stale season, and fetch_injury_status.py is
--   the sole owner of those columns. New players enter with roster_status
--   NULL and is_ir_eligible at its column default (false) until that job
--   runs, which is the same state they were in before this change.
--
--   Precondition, verified on production 2026-09-03:
--     player_talent_metrics_pkey  PRIMARY KEY (player_id, season)
--   so ON CONFLICT (player_id, season) resolves to a real arbiter.
--
--   PROD_CHANGE_LEDGER Rule 2 (history read before authoring), from
--   supabase_migrations.schema_migrations on production:
--     20260811164221 rebuild_player_talent_metrics_on_shipped_model
--       introduced this body; its rationale says roster_status and
--       is_ir_eligible are "PRESERVED, not recomputed" because no injury
--       feed existed then. fetch_injury_status.py is that feed now, and
--       the carry-forward subquery could not preserve anything across the
--       delete anyway. This migration keeps that intent and makes it true.
--     20260811200656 fix_talent_metrics_last_updated_column
--       added last_updated to the insert because the freshness SLA watches
--       that column. Kept: both timestamps are written on insert AND on
--       the conflict update, so the monitor sees every run.
--     20260827155703 roster_status_provenance
--       added roster_status_source; one more column the wipe erased.
--
--   Blast radius: one function, one table, no schema change, no other
--   function/view/trigger references rebuild_player_talent_metrics
--   except cron job 33. The first run after apply upserts 940 rows and
--   deletes 0 (the TOI set is unchanged); from then on the other writers'
--   columns survive.
--
--   Reversibility: CREATE OR REPLACE with the capture file above restores
--   the old body byte-for-byte. Data erased by past runs is not
--   recoverable from this table; the writers listed above repopulate it
--   on their next scheduled run.
--
-- (c) WHO / WORKSTREAM
--   Claude (cloud session 01US5L2zcExdwsmFWdvhT7cp), directed by Garrett
--   Storms, 2026-09-03, data-integrity sweep ahead of the iOS TestFlight
--   build. Applied to production on Garrett's explicit go; staging after.
--
-- Idempotent: CREATE OR REPLACE; a second apply is a no-op. The
-- post-condition below refuses to commit if the live body still contains
-- the unqualified season delete.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.rebuild_player_talent_metrics(p_season integer)
 RETURNS TABLE(rows_written integer, rated integer, below_toi_floor integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_rows int; v_rated int; v_floor int;
begin
  create temp table _tm on commit drop as
  with toi as (
    select pgs.player_id,
           sum(coalesce(pgs.nhl_toi_seconds,0))::numeric as toi_sec
      from player_game_stats pgs
     where substring(pgs.game_id::text,1,4)::int = p_season
       and substring(pgs.game_id::text,5,2) = '02'
       and not pgs.is_goalie
     group by 1
  ),
  xg as (
    select player_id, sum(xg)::numeric as xg
      from player_xg_season
     where season = p_season and game_type = 'regular'
     group by 1
  )
  select t.player_id,
         round(t.toi_sec/60.0, 2) as toi_minutes,
         case when t.toi_sec > 0
              then round(coalesce(x.xg,0) * 3600.0 / t.toi_sec, 4)
              else 0 end as xg_per_60
    from toi t left join xg x on x.player_id = t.player_id
   where t.toi_sec > 0;

  update _tm set xg_per_60 = 0 where xg_per_60 < 0;

  -- Only players who no longer have regular-season TOI this season leave.
  -- Everyone else keeps every column this function does not own.
  delete from player_talent_metrics ptm
   where ptm.season = p_season
     and not exists (select 1 from _tm m where m.player_id = ptm.player_id);

  insert into player_talent_metrics (season, player_id, xg_per_60, xg_rating,
                                     updated_at, last_updated)
  select p_season, m.player_id, m.xg_per_60,
         case when m.toi_minutes < 200 then null
              when m.xg_per_60 <  0.30 then 'Low'
              when m.xg_per_60 <  0.60 then 'Below Avg'
              when m.xg_per_60 <  0.90 then 'Average'
              when m.xg_per_60 <  1.20 then 'Above Avg'
              else 'Elite' end,
         now(), now()          -- last_updated is what the freshness SLA watches
    from _tm m
  on conflict (player_id, season) do update
     set xg_per_60    = excluded.xg_per_60,
         xg_rating    = excluded.xg_rating,
         updated_at   = now(),
         last_updated = now();

  get diagnostics v_rows = row_count;
  select count(*) filter (where xg_rating is not null),
         count(*) filter (where xg_rating is null)
    into v_rated, v_floor
    from player_talent_metrics where season = p_season;
  return query select v_rows, v_rated, v_floor;
end;
$function$;

-- Grants unchanged from the live function (postgres + service_role only).
REVOKE ALL ON FUNCTION public.rebuild_player_talent_metrics(integer) FROM public;
GRANT ALL ON FUNCTION public.rebuild_player_talent_metrics(integer) TO service_role;

-- Post-condition: the live body must no longer contain the unqualified
-- season delete, and must contain the ON CONFLICT arbiter.
DO $$
DECLARE v_body text;
BEGIN
  v_body := pg_get_functiondef('public.rebuild_player_talent_metrics(integer)'::regprocedure);
  IF v_body LIKE '%delete from player_talent_metrics where season = p_season;%' THEN
    RAISE EXCEPTION 'rebuild_player_talent_metrics still contains the unqualified season delete';
  END IF;
  IF v_body NOT LIKE '%on conflict (player_id, season) do update%' THEN
    RAISE EXCEPTION 'rebuild_player_talent_metrics is missing the ON CONFLICT (player_id, season) upsert';
  END IF;
  RAISE NOTICE 'rebuild_player_talent_metrics replaced; body md5 = %', md5(v_body);
END $$;

COMMIT;
