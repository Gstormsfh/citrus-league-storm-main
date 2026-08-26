-- ─────────────────────────────────────────────────────────────────────────────
-- citrus_game_rosters — sweater number to player id, for the HTML shift reports.
--
-- api.nhle.com/stats/rest/en/shiftcharts has a hole. Asked for game 2024021235
-- it returns 21 bytes — an empty array. Asked for 2024021234, the game beside
-- it, it returns 272,827 bytes. Both were played in April 2025, both final. The
-- hole covers 1,295 games: the tail of the 2024-25 regular season, EVERY
-- playoff game in 2024-25 and 2025-26, and most of the 2025-26 season.
--
-- The NHL's own HTML shift reports have all of them —
--     www.nhl.com/scores/htmlreports/20242025/TV021235.HTM   201,366 bytes
-- — TV for the visitor, TH for the home side. That is the source the JSON feed
-- is generated from, and the format has not changed since 2007.
--
-- But those reports identify a skater by sweater number and surname, not by
-- player id: "4 GOSTISBEHERE, SHAYNE". raw_nhl_data.rosterSpots already carries
-- the mapping for every one of the missing games, so this resolves it with no
-- extra network — and in one call per batch, rather than shipping 200 KB of
-- play-by-play JSON per game to the client just to read forty fields out of it.
--
-- is_home matters: it disambiguates two players wearing the same number in the
-- same game, which is common.
--
-- VALIDATED before anything was written. Parsed TV021235.HTM and compared
-- per-player time on ice against player_game_stats.nhl_toi_seconds for all
-- nineteen dressed Carolina players — nineteen of nineteen agree EXACTLY, to
-- the second, the goalie's 3,596 included. The JSON path reconciles at 99.74%
-- league-wide; this one is 100.00% on that game.
--
-- Read by data-pipeline/acquisition/backfill_shifts_html.py.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.citrus_game_rosters(p_games integer[])
returns table(game_id integer, player_id integer, sweater_number integer,
              team_id integer, is_home boolean, last_name text)
language sql stable security invoker
set search_path = public, pg_temp
as $fn$
  select r.game_id,
         (s->>'playerId')::integer,
         (s->>'sweaterNumber')::integer,
         (s->>'teamId')::integer,
         (s->>'teamId')::integer = coalesce(
           (r.raw_json->'homeTeam'->>'id')::integer,
           (select t.home_id from public.game_teams t where t.game_id = r.game_id)),
         (s->'lastName'->>'default')
  from public.raw_nhl_data r,
       lateral jsonb_array_elements(r.raw_json->'rosterSpots') s
  where r.game_id = any(p_games)
    and s->>'playerId' is not null
    and s->>'sweaterNumber' is not null
$fn$;

comment on function public.citrus_game_rosters(integer[]) is
  'Sweater number to player id per game, from raw_nhl_data.rosterSpots. Exists so the HTML shift-report reader can resolve "4 GOSTISBEHERE, SHAYNE" to 8476906 without fetching anything.';

grant execute on function public.citrus_game_rosters(integer[]) to service_role;
