-- One output writer after publication, without a second store or a spoofable GUC.
-- This role has no login or application memberships. Only the existing, fixed-body
-- SECURITY DEFINER materializer executes with its identity.
CREATE ROLE citrus_canonical_projection_writer NOLOGIN NOINHERIT;
-- Supabase postgres has CREATEROLE, not SUPERUSER. Temporarily allow the
-- migration administrator to transfer ownership, then retain admin-only access.
GRANT citrus_canonical_projection_writer TO postgres WITH INHERIT FALSE, SET TRUE;
GRANT CREATE ON SCHEMA public TO citrus_canonical_projection_writer;
GRANT USAGE ON SCHEMA public TO citrus_canonical_projection_writer;
GRANT SELECT ON public.canonical_projection_runs,public.canonical_projection_players,public.canonical_projection_active,public.nhl_games TO citrus_canonical_projection_writer;
GRANT SELECT,INSERT,DELETE ON public.player_ros_projections,public.player_projected_stats TO citrus_canonical_projection_writer;
GRANT EXECUTE ON FUNCTION public.canonical_default_points(jsonb,boolean) TO citrus_canonical_projection_writer;
CREATE POLICY canonical_materializer_read ON public.canonical_projection_runs FOR SELECT TO citrus_canonical_projection_writer USING(true);
CREATE POLICY canonical_materializer_read ON public.canonical_projection_players FOR SELECT TO citrus_canonical_projection_writer USING(true);
CREATE POLICY canonical_materializer_read ON public.canonical_projection_active FOR SELECT TO citrus_canonical_projection_writer USING(true);
CREATE POLICY canonical_materializer_read ON public.nhl_games FOR SELECT TO citrus_canonical_projection_writer USING(true);
CREATE POLICY canonical_materializer_output ON public.player_ros_projections FOR ALL TO citrus_canonical_projection_writer USING(true) WITH CHECK(true);
CREATE POLICY canonical_materializer_output ON public.player_projected_stats FOR ALL TO citrus_canonical_projection_writer USING(true) WITH CHECK(true);
ALTER FUNCTION public.canonical_materialize_projection_run(uuid) OWNER TO citrus_canonical_projection_writer;
REVOKE CREATE ON SCHEMA public FROM citrus_canonical_projection_writer;
GRANT citrus_canonical_projection_writer TO postgres WITH INHERIT FALSE, SET FALSE;

CREATE FUNCTION public.canonical_guard_projection_write() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE s integer; seasons integer[]:=ARRAY[]::integer[];
BEGIN
 -- current_user follows the fixed SECURITY DEFINER materializer's owner, not
 -- session settings. No application/service role may SET ROLE to this owner.
 IF current_user='citrus_canonical_projection_writer' THEN
   IF TG_OP='DELETE' THEN RETURN OLD; ELSIF TG_OP='TRUNCATE' THEN RETURN NULL; ELSE RETURN NEW; END IF;
 END IF;
 IF TG_OP='TRUNCATE' THEN
   IF current_setting('transaction_isolation')<>'read committed' THEN
     RAISE EXCEPTION 'Canonical projection write boundary: retry noncanonical TRUNCATE at READ COMMITTED' USING ERRCODE='55000';
   END IF;
   SELECT array_agg(season ORDER BY season) INTO seasons FROM public.canonical_projection_active;
 ELSE
   IF TG_OP IN ('UPDATE','DELETE') THEN
     IF TG_TABLE_NAME='player_ros_projections' THEN seasons:=array_append(seasons,OLD.season);
     ELSIF OLD.projection_date>=current_date THEN seasons:=array_append(seasons,OLD.season); END IF;
   END IF;
   IF TG_OP IN ('UPDATE','INSERT') THEN
     IF TG_TABLE_NAME='player_ros_projections' THEN seasons:=array_append(seasons,NEW.season);
     ELSIF NEW.projection_date>=current_date THEN seasons:=array_append(seasons,NEW.season); END IF;
   END IF;
 END IF;
 FOR s IN SELECT DISTINCT x FROM unnest(seasons) x WHERE x IS NOT NULL ORDER BY x LOOP
   -- RR/serializable could retain a pre-activation snapshot after waiting on the
   -- lock. Reject explicitly rather than allow that stale-pointer bypass.
   IF current_setting('transaction_isolation')<>'read committed' THEN
     RAISE EXCEPTION 'Canonical projection write boundary: retry noncanonical forecast write at READ COMMITTED' USING ERRCODE='55000';
   END IF;
   PERFORM pg_advisory_xact_lock(724811,s);
   IF EXISTS(SELECT 1 FROM public.canonical_projection_active WHERE season=s) THEN
     RAISE EXCEPTION 'Canonical projection write boundary: % % season % requires canonical materialization',TG_TABLE_NAME,TG_OP,s USING ERRCODE='55000';
   END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSIF TG_OP='TRUNCATE' THEN RETURN NULL; ELSE RETURN NEW; END IF;
END $$;
REVOKE ALL ON FUNCTION public.canonical_guard_projection_write() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER canonical_projection_write_boundary BEFORE INSERT OR UPDATE OR DELETE ON public.player_ros_projections FOR EACH ROW EXECUTE FUNCTION public.canonical_guard_projection_write();
CREATE TRIGGER canonical_projection_write_boundary BEFORE INSERT OR UPDATE OR DELETE ON public.player_projected_stats FOR EACH ROW EXECUTE FUNCTION public.canonical_guard_projection_write();
CREATE TRIGGER canonical_projection_truncate_boundary BEFORE TRUNCATE ON public.player_ros_projections FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_guard_projection_write();
CREATE TRIGGER canonical_projection_truncate_boundary BEFORE TRUNCATE ON public.player_projected_stats FOR EACH STATEMENT EXECUTE FUNCTION public.canonical_guard_projection_write();
