# Migrations for Claude to apply — PR #291 (gameplay schedulers)

Standing constraint: no `supabase db push` from the repo. Everything below is
staged for Claude to apply via the Supabase MCP path. Each block is
self-contained and gated on behaviour (existence checks + smoke assertions
where practical).

Every migration includes:
- **Rationale** — why it's needed, what census finding drove it.
- **Verification** — the exact query to run pre-apply and post-apply.
- **Rollback shape** — one-liner in case it's needed.

---

## M1 — Backfill `faab_budgets` for existing FAAB leagues

**Rationale.** Task B3 census: `faab_budgets` has 0 rows in prod despite the
`create_league` / `join_league_with_code` paths having seed logic since
`20260226000000_a_plus_audit_fixes.sql`. Either (a) no FAAB league has been
created since that migration, or (b) leagues that were flipped to FAAB via
`updateWaiverSettings` never received budget rows because that path had no
seed logic — closed on the app side in this PR
(`server/src/services/LeagueService.ts::updateWaiverSettings`), but any
already-flipped FAAB leagues need a one-time backfill.

**Verification pre-apply.**
```sql
SELECT
  l.id,
  l.name,
  l.waiver_type,
  COALESCE((l.settings->>'faabBudget')::NUMERIC, 100) AS budget,
  (SELECT COUNT(*) FROM public.teams WHERE league_id = l.id) AS team_count,
  (SELECT COUNT(*) FROM public.faab_budgets WHERE league_id = l.id) AS budget_count
FROM public.leagues l
WHERE l.waiver_type = 'faab';
```
If any row shows `budget_count < team_count`, M1 is load-bearing.

**Migration.**
```sql
-- M1: seed faab_budgets for every team in every FAAB league that has no
-- row yet. Idempotent via ON CONFLICT DO NOTHING against the existing
-- UNIQUE (league_id, team_id) constraint.
INSERT INTO public.faab_budgets (league_id, team_id, initial_budget, remaining_budget)
SELECT
  l.id AS league_id,
  t.id AS team_id,
  COALESCE((l.settings->>'faabBudget')::NUMERIC, 100) AS initial_budget,
  COALESCE((l.settings->>'faabBudget')::NUMERIC, 100) AS remaining_budget
FROM public.leagues l
JOIN public.teams t ON t.league_id = l.id
WHERE l.waiver_type = 'faab'
  AND NOT EXISTS (
    SELECT 1 FROM public.faab_budgets fb
    WHERE fb.league_id = l.id AND fb.team_id = t.id
  );
```

**Verification post-apply.** Re-run the pre-apply query; every FAAB league
must show `budget_count = team_count`.

**Rollback.**
```sql
-- Only rows created by this specific backfill (idempotent + narrow):
DELETE FROM public.faab_budgets fb
WHERE fb.created_at IS NULL  -- new rows have no created_at because the
                             -- table has no such column; if it's added
                             -- later, switch this to a timestamp filter.
  AND NOT EXISTS (
    SELECT 1 FROM public.waiver_claims wc
    WHERE wc.league_id = fb.league_id
      AND wc.team_id = fb.team_id
      AND wc.status = 'successful'
  );
```

---

## M2 — `calculate_roto_standings`: game-id season derivation

**Rationale.** Task C2 census: the current `calculate_roto_standings`
(migration `20260225000000_close_all_gaps_world_class.sql:195`) derives the
`player_directory` season via a calendar-based expression on lines 259-267:

```sql
AND pd.season = CASE WHEN EXTRACT(MONTH FROM NOW()) >= 10
                     THEN EXTRACT(YEAR FROM NOW())
                     ELSE EXTRACT(YEAR FROM NOW()) - 1 END
```

That's the same shape D-08 already closed for scoring: it returns 2025 on
2026-09-29 and 2026-09-30, misjoining goalies/skaters for the first two
days of the 2026-27 season. The scoring RPCs were fixed by deriving season
from `game_id` (migration `derive_scoring_season_from_game_id_not_calendar`).
The Roto standings path is identical in shape and needs the same treatment.

**Verification pre-apply.**
```sql
-- Show that today's Roto standings goalie/skater split is calendar-derived:
SELECT pg_get_functiondef('public.calculate_roto_standings(uuid, text[], int)'::regprocedure)
  ~ 'EXTRACT\(MONTH FROM NOW\(\)\) >= 10' AS still_calendar_derived;
```
Expect `true`.

**Migration.** Rewrite the goalie/skater filter to derive season from any
game this player has in `player_game_stats` for the league's active season
window. In roto the "which season" is determined by the WEEKLY-STATS ROWS
being aggregated, not by wall-clock time — so the correct derivation is
"the season the stat row's game_id encodes." Weekly stats have a
week_number but not a season column; join to nhl_games via game_id from
`player_game_stats` for the same week, take the season from the game_id
prefix.

```sql
-- M2: derive player_directory season from game_id, mirror of Claude's
-- derive_scoring_season_from_game_id_not_calendar for scoring RPCs.
CREATE OR REPLACE FUNCTION public.calculate_roto_standings(
  p_league_id UUID,
  p_categories TEXT[],
  p_through_week INT DEFAULT NULL
)
RETURNS TABLE (
  team_id UUID,
  team_name TEXT,
  category_name TEXT,
  stat_value NUMERIC,
  category_rank INT,
  roto_points INT
) AS $roto$
DECLARE
  v_cat TEXT;
  v_higher_is_better BOOLEAN;
  v_num_teams INT;
  v_effective_season INT;
BEGIN
  SELECT COUNT(*) INTO v_num_teams FROM public.teams WHERE league_id = p_league_id;

  -- Derive the effective season from the MOST RECENT game this league has
  -- weekly stats for — never from the calendar. The single-source-of-truth
  -- is the game_id prefix (2026020001 → 2026), same rule the scoring RPCs
  -- use post-D-08.
  SELECT MAX(SUBSTRING(pgs.game_id::text FROM 1 FOR 4)::int)
    INTO v_effective_season
  FROM public.player_weekly_stats pws
  JOIN public.player_game_stats pgs ON pgs.player_id = pws.player_id
    AND pgs.game_date BETWEEN pws.week_start_date AND pws.week_end_date
  WHERE EXISTS (
    SELECT 1 FROM public.roster_assignments ra
    WHERE ra.league_id = p_league_id AND ra.player_id::int = pws.player_id
  );
  -- Empty league / brand-new season fallback: use calendar derivation.
  IF v_effective_season IS NULL THEN
    v_effective_season := CASE WHEN EXTRACT(MONTH FROM NOW()) >= 10
                                THEN EXTRACT(YEAR FROM NOW())::int
                                ELSE EXTRACT(YEAR FROM NOW())::int - 1 END;
  END IF;

  FOREACH v_cat IN ARRAY p_categories LOOP
    v_higher_is_better := v_cat NOT IN ('gaa', 'goals_against');

    RETURN QUERY
    WITH team_stats AS (
      SELECT
        t.id AS tid,
        t.team_name AS tname,
        COALESCE(SUM(
          CASE v_cat
            WHEN 'goals' THEN pws.goals
            WHEN 'assists' THEN pws.assists
            WHEN 'points' THEN pws.goals + pws.assists
            WHEN 'plus_minus' THEN pws.plus_minus
            WHEN 'ppp' THEN pws.ppp
            WHEN 'shp' THEN pws.shp
            WHEN 'sog' THEN pws.shots_on_goal
            WHEN 'hits' THEN pws.hits
            WHEN 'blocks' THEN pws.blocks
            WHEN 'pim' THEN pws.pim
            WHEN 'wins' THEN pws.wins
            WHEN 'saves' THEN pws.saves
            WHEN 'shutouts' THEN pws.shutouts
            WHEN 'goals_against' THEN pws.goals_against
            WHEN 'gaa' THEN CASE WHEN pws.wins > 0 OR COALESCE(pws.goals_against, 0) > 0
                                  THEN pws.goals_against ELSE NULL END
            WHEN 'save_pct' THEN CASE WHEN pws.saves + pws.goals_against > 0
                                       THEN pws.saves::NUMERIC / (pws.saves + pws.goals_against)
                                       ELSE NULL END
            ELSE 0
          END
        ), 0) AS total_stat
      FROM public.teams t
      JOIN public.roster_assignments ra ON ra.team_id = t.id AND ra.league_id = p_league_id
      LEFT JOIN public.player_weekly_stats pws ON pws.player_id = ra.player_id::INT
        AND (p_through_week IS NULL OR pws.week_number <= p_through_week)
        AND CASE
          WHEN v_cat IN ('wins', 'saves', 'shutouts', 'goals_against', 'gaa', 'save_pct')
            THEN EXISTS (SELECT 1 FROM public.player_directory pd
                         WHERE pd.player_id = ra.player_id::INT
                           AND pd.position_code = 'G'
                           AND pd.season = v_effective_season)
          ELSE NOT EXISTS (SELECT 1 FROM public.player_directory pd
                           WHERE pd.player_id = ra.player_id::INT
                             AND pd.position_code = 'G'
                             AND pd.season = v_effective_season)
        END
      WHERE t.league_id = p_league_id
      GROUP BY t.id, t.team_name
    ),
    ranked AS (
      SELECT
        ts.tid,
        ts.tname,
        ts.total_stat,
        CASE v_higher_is_better
          WHEN true THEN RANK() OVER (ORDER BY ts.total_stat DESC)
          ELSE RANK() OVER (ORDER BY ts.total_stat ASC)
        END AS cat_rank
      FROM team_stats ts
    )
    SELECT
      r.tid,
      r.tname,
      v_cat,
      ROUND(r.total_stat, 3),
      r.cat_rank::INT,
      (v_num_teams + 1 - r.cat_rank)::INT
    FROM ranked r;
  END LOOP;

  RETURN;
END;
$roto$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.calculate_roto_standings(UUID, TEXT[], INT) TO authenticated;
```

**Verification post-apply.**
```sql
-- Repeat pre-apply check — expect false:
SELECT pg_get_functiondef('public.calculate_roto_standings(uuid, text[], int)'::regprocedure)
  ~ 'EXTRACT\(MONTH FROM NOW\(\)\) >= 10 AND' AS still_uses_wrong_pattern;
```
Behavioural probe (Sep 29 boundary): craft a synthetic goalie with a 2026
game_id row and confirm the standings don't drop the goalie's saves as
skater stats.

---

## M3 (optional, follow-up) — `process_pending_waivers_for_league(uuid)`

**Rationale.** The new server route
`POST /api/waivers/league/:leagueId/process-all` calls the GLOBAL
`process_all_pending_waivers()` and then filters the response — meaning a
commissioner clicking the button touches other leagues' pending claims too.
Idempotent on their side (no pending → no-op), but launch scope prefers no
cross-tenant side effect. A per-league mirror of the global function fixes
this cleanly.

This is optional for launch; the current route works. Ship after M1/M2 land
and beta feedback is in.

```sql
-- Mirror of process_all_pending_waivers() scoped to one league.
-- Function body: copy-paste from process_all_pending_waivers, replace
-- outer FOR loop over leagues with a single WHERE l.id = p_league_id
-- filter, drop the WHERE COALESCE(l.waiver_type,'rolling') <> 'faab'
-- filter (caller decides via route logic).
```

Not writing the full body here — Claude should compose from the existing
`process_all_pending_waivers` definition and confirm behavioural parity
with the D-04 approach (each per-league call byte-identical on any league
that would have been picked up by the global run).

---

## pg_cron registrations (Claude-owned)

Do NOT add these from the repo. Register after each system's drill passes.

### J1 — FAAB processor (separate job, isolated failure/history)

```sql
SELECT cron.schedule(
  'process-faab-waivers',           -- job name
  '15 3 * * *',                     -- 03:15 UTC daily (rolling runs at 03:00)
  $$SELECT public.process_all_faab_waivers()$$
);
```

**Offseason expected behaviour.** `process_all_faab_waivers()` iterates FAAB
leagues; if `waiver_claims` has no pending rows, each per-league RPC returns
zero rows. Green run with zero writes is the offseason norm — this is why
the anti-best-ball drill (see B5) exists.

### J2 — PPG standings materialiser (if we decide to precompute)

Not scheduling this — standings routes call the functions on demand and
`calculate_ppg_standings` reads `matchups.status='completed'` directly, so
cache-warming is optional. If beta latency shows PPG standings as slow, add
a nightly precompute in a follow-up PR.

### J3 — Roto standings materialiser (same)

Same as J2 — on-demand today, revisit if beta shows a hot spot.

### J4 — Weekly stats populator

```sql
SELECT cron.schedule(
  'populate-weekly-stats-monday',   -- job name
  '0 7 * * 1',                      -- Mondays 07:00 UTC = 00:00 MDT
  $$
  DO $$$$
  DECLARE
    v_week_start DATE;
    v_week_end DATE;
  BEGIN
    -- Compute LAST completed Sun-Sat week (fantasy convention per
    -- 20260216000000_shift_weeks_to_sunday_saturday.sql). Sunday = 0 in
    -- date_part('dow', ...).
    v_week_start := (CURRENT_DATE - date_part('dow', CURRENT_DATE)::int - 7)::date;
    v_week_end := (v_week_start + 6)::date;
    PERFORM public.populate_player_weekly_stats(
      -- Week number: (week_start - draft_completion) / 7 + 1
      -- Simpler for launch: use ISO week number as a stable identifier.
      EXTRACT(WEEK FROM v_week_start)::int,
      v_week_start,
      v_week_end
    );
  END
  $$$$;
  $$
);
```

**Offseason expected behaviour.** `populate_player_weekly_stats` aggregates
`player_game_stats` in the given date range. Offseason weeks have zero games
so it writes zero rows. Green.

**In-season daily catch-up (optional but recommended).**
```sql
SELECT cron.schedule(
  'populate-weekly-stats-daily',    -- catches late stat corrections mid-week
  '30 6 * * *',                     -- 06:30 UTC daily
  $$
  DO $$$$
  DECLARE
    v_week_start DATE;
    v_week_end DATE;
  BEGIN
    -- Recompute the CURRENT week (Sun-Sat containing today)
    v_week_start := (CURRENT_DATE - date_part('dow', CURRENT_DATE)::int)::date;
    v_week_end := (v_week_start + 6)::date;
    PERFORM public.populate_player_weekly_stats(
      EXTRACT(WEEK FROM v_week_start)::int,
      v_week_start,
      v_week_end
    );
  END
  $$$$;
  $$
);
```

`populate_player_weekly_stats` uses `ON CONFLICT` on
`(player_id, week_number, week_start_date, week_end_date)` (per its
definition in `20251222000000_create_player_weekly_stats_table.sql:57+`),
so re-running for the current week is idempotent — updates any changed
stat totals in place.
