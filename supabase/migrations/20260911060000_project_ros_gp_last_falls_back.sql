-- ============================================================================
-- project_ros(): stop treating "did not play last season" as "played zero
-- games", for players who ARE on this season's roster
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
--
-- (a) WHAT CHANGED
--   public.project_ros(integer) is REPLACED. Two expressions in the `agg`
--   CTE gain a fallback, and the fallback is gated on current-season roster
--   membership. Nothing else changes: the weighting, the shrinkage priors,
--   the age multiplier, the means, the rate columns and the
--   `raw_gp >= 1` filter are all byte-identical.
--
--     before:  gp_last  = max(gp  where season = p_season-1)   -- else 0
--              ggp_last = max(ggp where season = p_season-1)   -- else 0
--
--     after:   if the player played in p_season-1, unchanged.
--              else if he appears in player_directory for p_season,
--                   use his most recent season with games played.
--              else 0, exactly as before.
--
-- (b) WHY
--   VERIFIED ON PRODUCTION 2026-09-11, read-only.
--
--   exp_gp is
--     round(((gp_last + 0.25*0.80*82) / (82 + 0.25*82)) * game_count)
--   so gp_last = 0 yields round(16.4/102.5 * 84) = 13 games. A player who
--   missed all of last season and returns is projected for THIRTEEN games
--   of an 84-game season, and every consumer that multiplies a per-game
--   rate by exp_gp inherits that. On a draft board he is worth about a
--   sixth of what he should be.
--
--   The defect is conceptual: absence is being read as a measurement.
--   "Did not appear" is missing data, not an observed zero, and the
--   shrinkage prior is swamped because the denominator still carries the
--   full 82-game weight against it.
--
--   THE SCOPE MATTERS MORE THAN THE FIX. Of 1,361 players in the pool, 298
--   have gp_last = 0 and 73 of those played 40+ games in their most recent
--   season. The obvious fix -- fall back for all 73 -- is WRONG: only 6 of
--   the 73 appear in player_directory for 2026. The other 67 are retired,
--   in Europe, or in the AHL, and lifting them to ~75 projected games would
--   put 67 phantom players onto the draft board at inflated value. That is
--   a worse bug than the one being fixed, and it is why the fallback is
--   gated on roster membership rather than applied to everyone.
--
--   Live cohort: 6 players.
--
--   ACCEPTED IMPRECISION, stated so nobody has to rediscover it: a player
--   returning from a lost season is projected at his last healthy games
--   total, with no staleness discount. That is optimistic -- a realistic
--   return is nearer 70 than 81. It is deliberately left alone because the
--   residual error is ~14%, against the ~500% error it replaces, and a
--   discount curve is a modelling decision that deserves its own data,
--   not a 1 a.m. guess four days before drafts.
--
-- (c) WHO / WORKSTREAM
--   Claude (cloud session 01J7JBu263Ld1ucRRiRxJ2to), directed by Garrett
--   Storms, 2026-09-11, audit cleanup item 14.
--
-- Reversibility: CREATE OR REPLACE from the prior definition, captured via
--   pg_get_functiondef this session (the two `max(case when season =
--   p_season-1 ...)` expressions restored verbatim).
-- Idempotent: CREATE OR REPLACE. A second apply is a no-op.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.project_ros(p_season integer)
 RETURNS TABLE(player_id integer, is_goalie boolean, position_code text, age integer, exp_gp integer, exp_starts integer, r_goal numeric, r_a numeric, r_sog numeric, r_blk numeric, r_ppp numeric, r_shp numeric, r_hits numeric, r_pim numeric, r_pm numeric, r_wins numeric, r_saves numeric, r_so numeric, r_ga numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with hist as (
    select pgs.player_id,
           substring(pgs.game_id::text,1,4)::int as season,
           bool_or(pgs.is_goalie) as is_goalie,
           count(*)::numeric gp,
           sum(pgs.nhl_goals)::numeric g,           sum(pgs.nhl_assists)::numeric a,
           sum(pgs.nhl_shots_on_goal)::numeric sog, sum(pgs.nhl_blocks)::numeric blk,
           sum(pgs.nhl_ppp)::numeric ppp,           sum(pgs.nhl_shp)::numeric shp,
           sum(pgs.nhl_hits)::numeric hits,         sum(pgs.nhl_pim)::numeric pim,
           sum(pgs.nhl_plus_minus)::numeric pm,
           sum(pgs.nhl_wins)::numeric wins,         sum(pgs.nhl_saves)::numeric saves,
           sum(pgs.nhl_shutouts)::numeric so,
           sum(coalesce(pgs.nhl_goals_against,0))::numeric ga,
           sum(coalesce(pgs.goalie_gp,0))::numeric ggp
      from player_game_stats pgs
     where substring(pgs.game_id::text,5,2) = '02'
       and substring(pgs.game_id::text,1,4)::int between p_season-3 and p_season
     group by 1,2
  ),
  xg as (select player_id, season, sum(xg)::numeric xg from player_xg_season
          where game_type='regular' group by 1,2),
  w as (select h.*, coalesce(x.xg,0)::numeric xg,
              (case p_season-h.season
                 when 0 then 15.0   -- measured; see header
                 when 1 then 5.0 when 2 then 3.0 else 2.0 end)::numeric wt
         from hist h left join xg x on x.player_id=h.player_id and x.season=h.season),
  -- GP FALLBACK (2026-09-11): on this season's roster? Only then may a
  -- missing prior season fall back to the last one actually played.
  cur as (select distinct pd.player_id from player_directory pd where pd.season = p_season),
  agg as (
    select player_id, bool_or(is_goalie) is_goalie,
           sum(wt*gp) wgp, sum(wt*g) wg, sum(wt*xg) wxg, sum(wt*a) wa,
           sum(wt*sog) wsog, sum(wt*blk) wblk, sum(wt*ppp) wppp, sum(wt*shp) wshp,
           sum(wt*hits) whits, sum(wt*pim) wpim, sum(wt*pm) wpm,
           sum(wt*wins) wwins, sum(wt*saves) wsaves, sum(wt*so) wso,
           sum(wt*ga) wga, sum(wt*ggp) wggp,
           sum(gp) raw_gp,
           max(case when season = p_season-1 then gp else 0 end) gp_prev,
           max(case when season = p_season-1 then ggp else 0 end) ggp_prev,
           (array_agg(gp  order by season desc) filter (where gp  > 0))[1] gp_recent,
           (array_agg(ggp order by season desc) filter (where ggp > 0))[1] ggp_recent
      from w group by 1),
  bd as (select distinct on (player_id) player_id, birthdate
           from player_directory where birthdate is not null order by player_id, season desc),
  grp as (
    select a.*,
           case when a.gp_prev > 0 then a.gp_prev
                when c.player_id is not null then coalesce(a.gp_recent, 0)
                else 0 end as gp_last,
           case when a.ggp_prev > 0 then a.ggp_prev
                when c.player_id is not null then coalesce(a.ggp_recent, 0)
                else 0 end as ggp_last,
           coalesce((select pd.position_code from player_directory pd
                      where pd.player_id=a.player_id order by pd.season desc limit 1),
                    case when a.is_goalie then 'G' else 'C' end) as position_code,
           extract(year from age(make_date(p_season,10,1), bd.birthdate))::int as age
      from agg a
      left join bd on bd.player_id=a.player_id
      left join cur c on c.player_id=a.player_id),
  grp2 as (
    select g.*, case when g.is_goalie then 'G'
                     when g.position_code='D' then 'D' else 'F' end as pos_group,
           case when g.is_goalie then 1.00
                else public.get_age_multiplier(g.age) end as am
      from grp g),
  means as (
    select pos_group,
           sum(0.30*wg + 0.70*wxg)/nullif(sum(wgp),0) m_goal,
           sum(wa)/nullif(sum(wgp),0) m_a,     sum(wsog)/nullif(sum(wgp),0) m_sog,
           sum(wblk)/nullif(sum(wgp),0) m_blk, sum(wppp)/nullif(sum(wgp),0) m_ppp,
           sum(wshp)/nullif(sum(wgp),0) m_shp, sum(whits)/nullif(sum(wgp),0) m_hits,
           sum(wpim)/nullif(sum(wgp),0) m_pim, sum(wpm)/nullif(sum(wgp),0) m_pm,
           sum(wwins)/nullif(sum(wggp),0) m_wins,
           sum(wsaves)/nullif(sum(wggp),0) m_saves,
           sum(wso)/nullif(sum(wggp),0) m_so,
           sum(wga)/nullif(sum(wggp),0) m_ga
      from grp2 where raw_gp >= 20 group by 1)
  select g.player_id, g.is_goalie, g.position_code, g.age,
         least(public.get_season_game_count(p_season), greatest(0,
           round(((g.gp_last + 0.25*0.80*82)/(82.0 + 0.25*82)) * public.get_season_game_count(p_season))))::int,
         least(public.get_season_game_count(p_season), greatest(0,
           round(((g.ggp_last + 0.25*0.45*82)/(82.0 + 0.25*82)) * public.get_season_game_count(p_season))))::int,
         (((0.30*g.wg + 0.70*g.wxg) + 20*m.m_goal)/(g.wgp+20) * g.am)::numeric,
         ((g.wa    +  10*m.m_a)   /(g.wgp+10)  * g.am)::numeric,
         ((g.wsog  +  10*m.m_sog) /(g.wgp+10)  * g.am)::numeric,
         ((g.wblk  +  15*m.m_blk) /(g.wgp+15)  * g.am)::numeric,
         ((g.wppp  +  10*m.m_ppp) /(g.wgp+10)  * g.am)::numeric,
         ((g.wshp  +  10*m.m_shp) /(g.wgp+10)  * g.am)::numeric,
         ((g.whits +   8*m.m_hits)/(g.wgp+8)   * g.am)::numeric,
         ((g.wpim  +  20*m.m_pim) /(g.wgp+20)  * g.am)::numeric,
         ((g.wpm   + 150*m.m_pm)  /(g.wgp+150) * g.am)::numeric,
         ((g.wwins  + 10*coalesce(m.m_wins,0)) /(g.wggp+10))::numeric,
         ((g.wsaves + 10*coalesce(m.m_saves,0))/(g.wggp+10))::numeric,
         ((g.wso    + 10*coalesce(m.m_so,0))   /(g.wggp+10))::numeric,
         ((g.wga    + 10*coalesce(m.m_ga,0))   /(g.wggp+10))::numeric
    from grp2 g join means m on m.pos_group=g.pos_group
   where g.raw_gp >= 1;
$function$;

COMMIT;
