-- Additive service-only transport for a full-body archive compare-and-set.
-- No prior RPC existed in the read-only preflight; abort any definition drift.
-- Backup: captures/2026-09-06_archive_boxscore_rpc_preflight.json confirms no old RPC.
-- Rollback: DROP FUNCTION public.citrus_fill_archive_boxscore(bigint,date,jsonb,text,timestamptz,jsonb); -- only this new RPC
-- This does not authenticate source content or recompute a Python canonical hash.
-- timestamptz has already normalized its input: callers must require explicit offsets.
DO $patch$
DECLARE
  signature text := 'public.citrus_fill_archive_boxscore(bigint,date,jsonb,text,timestamptz,jsonb)';
  definition text := $definition$CREATE OR REPLACE FUNCTION public.citrus_fill_archive_boxscore(p_game_id bigint, p_game_date date, p_expected_raw jsonb, p_expected_sha256 text, p_expected_fetched_at timestamp with time zone, p_boxscore jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  payload jsonb;
  side text;
  season_start bigint;
  affected bigint;
BEGIN
  season_start := p_game_id / 1000000;
  IF p_game_id IS NULL OR length(p_game_id::text) <> 10
     OR season_start NOT BETWEEN 1900 AND 9998
     OR (p_game_id / 10000) % 100 NOT IN (2,3) OR p_game_id % 10000 = 0
     OR p_game_date IS NULL OR NOT isfinite(p_game_date)
     OR p_game_date > (statement_timestamp() AT TIME ZONE 'UTC')::date
     OR extract(year FROM p_game_date) NOT IN (season_start, season_start + 1)
     OR p_expected_fetched_at IS NULL OR NOT isfinite(p_expected_fetched_at)
     OR p_expected_fetched_at > statement_timestamp()
     OR (p_expected_fetched_at AT TIME ZONE 'UTC')::date < p_game_date
     OR p_expected_sha256 IS NULL OR p_expected_sha256 !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'Invalid archive fill identity or provenance'; END IF;
  FOREACH payload IN ARRAY ARRAY[p_expected_raw,p_boxscore] LOOP
    IF jsonb_typeof(payload) IS DISTINCT FROM 'object'
       OR payload->'id' IS DISTINCT FROM to_jsonb(p_game_id)
       OR payload->>'id' IS DISTINCT FROM p_game_id::text
       OR payload->'gameDate' IS DISTINCT FROM to_jsonb(to_char(p_game_date,'YYYY-MM-DD'))
       OR payload->'season' IS DISTINCT FROM to_jsonb(season_start * 10000 + season_start + 1)
       OR payload->>'season' IS DISTINCT FROM (season_start * 10000 + season_start + 1)::text
       OR payload->'gameType' IS DISTINCT FROM to_jsonb((p_game_id / 10000) % 100)
       OR payload->>'gameType' IS DISTINCT FROM ((p_game_id / 10000) % 100)::text
       OR coalesce(payload->>'gameState','') NOT IN ('OFF','FINAL')
    THEN RAISE EXCEPTION 'Invalid archive fill payload identity'; END IF;
    FOREACH side IN ARRAY ARRAY['homeTeam','awayTeam'] LOOP
      IF jsonb_typeof(payload->side) IS DISTINCT FROM 'object'
         OR jsonb_typeof(payload->side->'id') IS DISTINCT FROM 'number'
         OR coalesce(payload->side->>'id','') !~ '^[1-9][0-9]*$'
      THEN RAISE EXCEPTION 'Invalid archive fill team identity'; END IF;
    END LOOP;
    IF payload->'homeTeam'->'id' = payload->'awayTeam'->'id'
    THEN RAISE EXCEPTION 'Invalid archive fill distinct teams'; END IF;
  END LOOP;
  IF p_expected_raw->'homeTeam'->'id' <> p_boxscore->'homeTeam'->'id'
     OR p_expected_raw->'awayTeam'->'id' <> p_boxscore->'awayTeam'->'id'
  THEN RAISE EXCEPTION 'Invalid archive fill matching teams'; END IF;
  IF jsonb_typeof(p_expected_raw->'plays') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'Invalid archive fill plays'; END IF;
  IF jsonb_array_length(p_expected_raw->'plays') = 0 OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_expected_raw->'plays') play
    WHERE jsonb_typeof(play) <> 'object' OR play = '{}'::jsonb)
  THEN RAISE EXCEPTION 'Invalid archive fill plays'; END IF;
  FOREACH side IN ARRAY ARRAY['homeTeam','awayTeam'] LOOP
    IF jsonb_typeof(p_boxscore->'playerByGameStats'->side) IS DISTINCT FROM 'object'
       OR p_boxscore->'playerByGameStats'->side = '{}'::jsonb
    THEN RAISE EXCEPTION 'Invalid archive fill player stats'; END IF;
  END LOOP;
  UPDATE public.raw_nhl_data
  SET boxscore_json = p_boxscore
  WHERE game_id = p_game_id AND game_date = p_game_date
    AND raw_json = p_expected_raw AND content_sha256 = p_expected_sha256
    AND fetched_at = p_expected_fetched_at
    AND source_url = 'https://api-web.nhle.com/v1/gamecenter/' || p_game_id::text || '/play-by-play'
    AND boxscore_json IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected = 1;
END;
$function$
$definition$;
BEGIN
  IF to_regprocedure(signature) IS NOT NULL THEN
    IF pg_get_functiondef(to_regprocedure(signature)) IS DISTINCT FROM definition THEN
      RAISE EXCEPTION 'Archive fill RPC definition drift: %', signature;
    END IF;
  ELSE
    EXECUTE definition;
  END IF;
  REVOKE ALL ON FUNCTION public.citrus_fill_archive_boxscore(bigint,date,jsonb,text,timestamptz,jsonb) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.citrus_fill_archive_boxscore(bigint,date,jsonb,text,timestamptz,jsonb) TO service_role;
END;
$patch$;
