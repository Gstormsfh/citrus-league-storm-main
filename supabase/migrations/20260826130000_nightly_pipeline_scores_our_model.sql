-- ═════════════════════════════════════════════════════════════════════════════
-- The nightly pipeline was never going to score a single live game with our
-- model. This is the one that would have cost the season.
--
-- WHAT IT DID
--   nightly_xg_pipeline() ran at 08:35 and called score_xg_sql_v2(season),
--   which writes nhl_shots.xg_sql — the legacy SQL model. Separately,
--   data_acquisition.py loads xg_model_moneypuck.joblib on every ingest and
--   writes its prediction into raw_shots.xg_value.
--
--   Nothing anywhere called citrus_score_v5_batch.
--
--   So on 29 September, every shot of every game would have arrived carrying
--   MoneyPuck's number and the legacy model's number, and xg_v5 — the model
--   rebuilt on Citrus features and calibrated to exactly 1.0000 in all nine
--   seasons — would have been NULL. rebuild_onice_xg reads coalesce(xg_v5, 0),
--   so every player's on-ice expected goals for the new season would have been
--   ZERO, and nothing would have raised a single error.
--
--   Nine seasons of correct history and a live season of zeroes, silently.
--
-- WHAT IT DOES NOW, in order
--   1. our scorer, in batches, until nothing is unscored
--   2. citrus_repair_shift_clocks, so a shift whose clock failed to parse is
--      corrected before anything derives intervals from it
--   3. the shift chain: strength timeline, TOI by state, on-ice attribution
--   4. GAR components for the current season
--   5. the legacy layers, untouched — goalie GSAx still reads xg_sql
--
--   Bounded at twenty batches per stage per run so a pathological night cannot
--   hold the connection open. What it cannot finish it reports, and the next
--   run continues: every one of these drivers is resumable by construction.
--
--   Steps 2 and 4 are wrapped so a failure in either is reported and does not
--   stop the night's scoring. A repair that cannot run is a bad night; a
--   pipeline that stops because of it is a worse one.
--
-- AND TWO CHECKS, so the same silence cannot happen twice
--   xg_v5_coverage        fails when a shot from the last seven days has no
--                         score of ours
--   gar_components_real   fails when the valuation table goes stale or its
--                         components go back to zero
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.citrus_xg_coverage_invariant()
returns table(check_name text, status text, measured text, threshold text, detail text)
language sql stable security invoker
set search_path = public, pg_temp
as $fn$
  with recent as (
    select count(*) as n, count(*) filter (where xg_v5 is null) as unscored
    from public.raw_shots
    where coalesce(period_type,'REG') <> 'SO'
      and created_at > now() - interval '7 days'
  ),
  allshots as (
    select count(*) filter (where xg_v5 is null) as unscored_ever
    from public.raw_shots where coalesce(period_type,'REG') <> 'SO'
  )
  select 'xg_v5_coverage'::text,
         case when r.n = 0 then 'info'
              when r.unscored > 0 then 'fail'
              when a.unscored_ever > 0 then 'warn'
              else 'pass' end::text,
         case when r.n = 0 then 'no shots ingested in seven days'
              else r.unscored::text || ' of ' || r.n::text || ' recent shots unscored' end,
         '0 unscored'::text,
         'Our model must score every shot that arrives. Until 2026-08-26 nothing '
           || 'called citrus_score_v5_batch outside a manual run, so a live season '
           || 'would have carried MoneyPuck''s number and the legacy model''s number '
           || 'and left ours NULL — and on-ice expected goals read coalesce(xg_v5, 0). '
           || 'Total unscored across all seasons: ' || a.unscored_ever::text || '.'
  from recent r cross join allshots a
$fn$;

grant execute on function public.citrus_xg_coverage_invariant() to anon, authenticated, service_role;

-- The pipeline body itself is applied to production and recorded in
-- supabase_migrations.schema_migrations under
-- 'nightly_rebuilds_gar_and_gar_invariant', which is the authoritative text.
-- The order it runs in is the thing to preserve: OURS FIRST, then the chain
-- that reads it, then valuation, then the legacy layers. Anything that scores
-- shots must come before anything that sums them.
