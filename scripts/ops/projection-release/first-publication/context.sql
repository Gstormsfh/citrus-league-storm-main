-- Session-local helpers only. No permanent state or alternative scoring path.
CREATE FUNCTION pg_temp.canonical_recovery_schema() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
 'database',current_database(),'system_identifier',(SELECT system_identifier::text FROM pg_control_system()),
 'server_version',current_setting('server_version_num'),
 'tables',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
 'columns',(SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY conname) FROM pg_constraint WHERE conrelid=c.oid),
 'triggers',(SELECT jsonb_agg(pg_get_triggerdef(oid) ORDER BY tgname) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal),
 'policies',(SELECT jsonb_agg(jsonb_build_array(polname,polcmd,polroles::text,pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid)) ORDER BY polname) FROM pg_policy WHERE polrelid=c.oid)) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('canonical_projection_active','canonical_projection_runs','canonical_projection_players','player_ros_projections','player_projected_stats')),
 'functions',(SELECT md5(string_agg(pg_get_functiondef(p.oid)||pg_get_userbyid(p.proowner)||coalesce(p.proacl::text,''),'' ORDER BY p.proname,p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'canonical_%' AND p.prokind='f'));
$$;
CREATE FUNCTION pg_temp.canonical_recovery_hashes(s integer,d date) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
 'active',(SELECT jsonb_build_object('count',count(*),'md5',md5(coalesce(string_agg(row_to_json(a)::text,'' ORDER BY season),''))) FROM public.canonical_projection_active a),
 'ros',(SELECT jsonb_build_object('count',count(*),'md5',md5(coalesce(string_agg(row_to_json(r)::text,'' ORDER BY player_id),''))) FROM public.player_ros_projections r),
 'daily',(SELECT jsonb_build_object('count',count(*),'md5',md5(coalesce(string_agg(row_to_json(x)::text,'' ORDER BY projection_id),''))) FROM public.player_projected_stats x WHERE season=s AND projection_date>=d));
$$;
