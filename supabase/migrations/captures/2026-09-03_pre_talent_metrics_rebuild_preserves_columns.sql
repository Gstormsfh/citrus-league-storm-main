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

  delete from player_talent_metrics where season = p_season;

  insert into player_talent_metrics (season, player_id, xg_per_60, xg_rating,
                                     roster_status, is_ir_eligible,
                                     updated_at, last_updated)
  select p_season, m.player_id, m.xg_per_60,
         case when m.toi_minutes < 200 then null
              when m.xg_per_60 <  0.30 then 'Low'
              when m.xg_per_60 <  0.60 then 'Below Avg'
              when m.xg_per_60 <  0.90 then 'Average'
              when m.xg_per_60 <  1.20 then 'Above Avg'
              else 'Elite' end,
         (select t.roster_status from player_talent_metrics t
           where t.player_id = m.player_id order by t.season desc limit 1),
         coalesce((select t.is_ir_eligible from player_talent_metrics t
                    where t.player_id = m.player_id order by t.season desc limit 1), false),
         now(), now()          -- last_updated is what the freshness SLA watches
    from _tm m;

  get diagnostics v_rows = row_count;
  select count(*) filter (where xg_rating is not null),
         count(*) filter (where xg_rating is null)
    into v_rated, v_floor
    from player_talent_metrics where season = p_season;
  return query select v_rows, v_rated, v_floor;
end;
$function$
