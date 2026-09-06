CREATE OR REPLACE FUNCTION public.citrus_fit_xg_v5_era(p_k numeric DEFAULT 60, p_exclude_seasons integer[] DEFAULT '{}'::integer[])
 RETURNS TABLE(out_season integer, out_is_rebound boolean, out_n bigint, out_goals bigint, out_expected numeric, out_mult numeric)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_pn bigint; v_pg bigint; v_pe numeric; v_pm numeric;
begin
  if (select count(*) from public.xg_v5_fit_rows f where f.season is null) > 0 then
    raise exception 'xg_v5_fit_rows has rows without a season. Truncate it and re-run citrus_fit_moat_rows until remaining = 0.';
  end if;
  if (select count(*) from public.xg_v5_fit_rows f where f.game_type is null) > 0 then
    raise exception 'xg_v5_fit_rows has rows without a game_type. Truncate it and re-run citrus_fit_moat_rows until remaining = 0.';
  end if;
  if (select count(*) from public.xg_v5_shape) = 0 then
    raise exception 'xg_v5_shape is empty. Run citrus_fit_xg_v5_shape() before the era layer - the era layer normalises what the shape layer produces.';
  end if;

  -- every fit row carried through base -> moat -> shape, once, reused by both fits
  create temporary table _scored on commit drop as
  select f.season, f.is_rebound, f.game_type, f.is_goal,
         (f.base * coalesce(m.mult, 1.0) * coalesce(sh.mult, 1.0)) as pred
  from public.xg_v5_fit_rows f
  left join public.xg_v5_moat m on m.bucket = f.bucket
  left join public.xg_v5_shape sh
         on not coalesce(f.is_empty_net, false)
        and round(f.base * coalesce(m.mult, 1.0), 8) >  sh.lo
        and round(f.base * coalesce(m.mult, 1.0), 8) <= sh.hi;

  -- ---- regular season: per season x rebound, then rescaled so each season's
  -- ---- expected goals equal that season's actual goals, exactly.
  create temporary table _agg on commit drop as
  select s.season, s.is_rebound,
         count(*)::bigint                          as n,
         count(*) filter (where s.is_goal)::bigint as goals,
         sum(s.pred)                               as expected
  from _scored s
  where s.game_type = 2
    and not (s.season = any(coalesce(p_exclude_seasons, '{}'::integer[])))
  group by 1,2;

  create temporary table _raw on commit drop as
  select a.*, (a.goals + p_k) / nullif(a.expected + p_k, 0) as mult_raw from _agg a;

  create temporary table _scaled on commit drop as
  select r.*,
         (select sum(x.goals) from _raw x where x.season = r.season)
         / nullif((select sum(x.expected * x.mult_raw) from _raw x where x.season = r.season), 0)
           as season_scale
  from _raw r;

  delete from public.xg_v5_era;
  insert into public.xg_v5_era (season, is_rebound, n, goals, expected, mult)
  select s.season, s.is_rebound, s.n::integer, s.goals::integer,
         round(s.expected, 4), round(s.mult_raw * s.season_scale, 6)
  from _scaled s;

  -- ---- playoffs: one pooled residual on top of the regular-season chain.
  -- Not per season (its spread is smaller than its own noise) and not per
  -- rebound (354-598 shots a season). One number, measured, applied.
  select count(*)::bigint,
         count(*) filter (where s.is_goal)::bigint,
         sum(s.pred * coalesce(e.mult, 1.0))
    into v_pn, v_pg, v_pe
  from _scored s
  left join public.xg_v5_era e on e.season = s.season and e.is_rebound = s.is_rebound
  where s.game_type = 3;

  if coalesce(v_pn, 0) > 0 and coalesce(v_pe, 0) > 0 then
    v_pm := (v_pg + p_k) / (v_pe + p_k);
    delete from public.xg_v5_playoff;
    insert into public.xg_v5_playoff (id, n, goals, expected, mult)
    values (1, v_pn::integer, v_pg::integer, round(v_pe, 4), round(v_pm, 6));
  end if;

  return query select e.season, e.is_rebound, e.n::bigint, e.goals::bigint, e.expected, e.mult
  from public.xg_v5_era e order by e.season, e.is_rebound;
end;
$function$
