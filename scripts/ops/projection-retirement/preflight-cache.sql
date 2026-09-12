-- Read-only. Catalog dependencies alone do not prove absence of external clients.
SELECT count(*) AS rows,
 md5(coalesce(string_agg(row_to_json(t)::text,'' ORDER BY cache_id),'')) AS content_md5,
 min(calculation_timestamp) AS oldest,max(calculation_timestamp) AS newest
FROM public.projection_cache t;
SELECT pg_describe_object(d.classid,d.objid,d.objsubid) AS dependent,d.deptype
FROM pg_depend d WHERE d.refobjid='public.projection_cache'::regclass;
SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),md5(p.prosrc)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND p.prokind IN ('f','p')
AND p.prosrc ILIKE '%projection_cache%';
SELECT jobid,jobname,schedule,active,md5(command) AS command_md5
FROM cron.job WHERE command ILIKE '%projection_cache%'
 OR command ILIKE '%rebuild_ros_projections%' OR command ILIKE '%rebuild_player_projected_stats%';
