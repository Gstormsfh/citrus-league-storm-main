-- Reviewed current skater primary corrections. Raw feed observations remain
-- intact; the current-directory view applies the latest effective review.
-- No seed data, eligibility grants, roster changes or projection writes.
CREATE TABLE public.player_position_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 season integer NOT NULL CHECK (season BETWEEN 2000 AND 2100),
 player_id integer NOT NULL CHECK (player_id > 0),
 position_code text NOT NULL CHECK (position_code IN ('C','LW','RW','D')),
 feed_position_at_review text NOT NULL,
 effective_on date NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 source_urls jsonb NOT NULL CHECK (jsonb_typeof(source_urls)='array' AND jsonb_array_length(source_urls)>0),
 reason text NOT NULL CHECK (length(trim(reason))>0),
 recorded_by text NOT NULL CHECK (length(trim(recorded_by))>0),
 supersedes uuid,
 UNIQUE(season,player_id,id),
 FOREIGN KEY(season,player_id,supersedes) REFERENCES public.player_position_events(season,player_id,id)
);
CREATE INDEX player_position_events_current_idx ON public.player_position_events(season,player_id,sequence DESC);
ALTER TABLE public.player_position_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY player_position_evidence_read ON public.player_position_events FOR SELECT TO authenticated USING(true);
REVOKE ALL ON public.player_position_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.player_position_events TO authenticated;
GRANT SELECT,INSERT ON public.player_position_events TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.player_position_events_sequence_seq TO service_role;
COMMENT ON TABLE public.player_position_events IS 'Append-only reviewed skater primary identity evidence. No client writes. Supersede a review with a new event; ingestion cannot overwrite it. Does not grant secondary eligibility or change goalie family, projections, injury policy or fantasy membership.';

CREATE OR REPLACE VIEW public.player_current_directory WITH(security_invoker=true) AS
WITH seasons AS (
 SELECT DISTINCT season FROM public.player_directory
 UNION SELECT season FROM public.canonical_projection_active
), identities AS (
 -- Keep known identities, including prospects missing from the current feed
 -- and historical players still held by a fantasy team. Old teams are NOT
 -- carried forward as current affiliation.
 SELECT s.season,d.player_id FROM seasons s JOIN public.player_directory d ON d.season<=s.season
 UNION SELECT season,player_id::integer FROM public.canonical_published_players
), evidence AS (
 SELECT DISTINCT ON(season,player_id) * FROM public.player_affiliation_events
 ORDER BY season,player_id,sequence DESC
), resolved AS (
 SELECT i.season,i.player_id,d AS current_row,h AS historical_row,p.payload,
 e.id AS affiliation_event_id,e.recorded_at AS affiliation_recorded_at,
 CASE WHEN e.id IS NOT NULL THEN e.team_abbrev ELSE d.team_abbrev END AS current_team,
 CASE WHEN e.id IS NOT NULL THEN e.status WHEN d.team_abbrev IS NOT NULL THEN 'affiliated' ELSE 'unknown' END AS affiliation_status,
 CASE WHEN e.id IS NOT NULL THEN e.authority WHEN d.team_abbrev IS NOT NULL THEN 'nhl_roster_feed' ELSE 'unknown' END AS affiliation_authority,
 CASE WHEN e.id IS NOT NULL THEN e.effective_on ELSE NULL::date END AS affiliation_as_of,
 e.organization,e.source_urls,e.reason,pe.position_code AS reviewed_position
 FROM identities i
 LEFT JOIN public.player_directory d ON d.season=i.season AND d.player_id=i.player_id
 LEFT JOIN LATERAL (SELECT x.* FROM public.player_directory x WHERE x.player_id=i.player_id AND x.season<i.season ORDER BY x.season DESC LIMIT 1) h ON true
 LEFT JOIN public.canonical_published_players p ON p.season=i.season AND p.player_id=i.player_id::text
 LEFT JOIN evidence e ON e.season=i.season AND e.player_id=i.player_id
 LEFT JOIN LATERAL (
  SELECT x.position_code FROM public.player_position_events x
  WHERE x.season=i.season AND x.player_id=i.player_id AND x.effective_on<=CURRENT_DATE
  ORDER BY x.sequence DESC LIMIT 1
 ) pe ON coalesce(d.is_goalie,h.is_goalie,(p.payload->>'is_goalie')::boolean,false)=false
  AND coalesce(d.position_code,h.position_code,p.payload->>'position','')<>'G'
)
SELECT r.season,r.player_id,identity.full_name,identity.team_abbrev,identity.position_code,identity.is_goalie,identity.jersey_number,identity.headshot_url,identity.shoots_catches,identity.created_at,identity.updated_at,identity.height_in,identity.weight_lb,identity.birthdate,identity.nationality,identity.college_team,identity.prior_team,identity.bio_summary,identity.notes,identity.source_last_fetched_at,identity.eligible_positions,identity.career,identity.career_fetched_at,r.payload->>'team' AS projection_team,
 jsonb_build_object('status',r.affiliation_status,'team',r.current_team,'authority',r.affiliation_authority,
 'as_of',r.affiliation_as_of,'recorded_at',r.affiliation_recorded_at,'event_id',r.affiliation_event_id,
 'organization',r.organization,'source_urls',coalesce(r.source_urls,'[]'::jsonb),'reason',r.reason) AS current_affiliation
FROM resolved r
CROSS JOIN LATERAL jsonb_populate_record(NULL::public.player_directory,
 coalesce(to_jsonb(r.current_row),to_jsonb(r.historical_row),'{}'::jsonb) ||
 jsonb_build_object('season',r.season,'player_id',r.player_id,
 'full_name',coalesce((r.current_row).full_name,(r.historical_row).full_name,r.payload->>'name'),
 'position_code',coalesce(r.reviewed_position,(r.current_row).position_code,(r.historical_row).position_code,r.payload->>'position'),
 'is_goalie',coalesce((r.current_row).is_goalie,(r.historical_row).is_goalie,(r.payload->>'is_goalie')::boolean),
 'team_abbrev',r.current_team)) identity;
GRANT SELECT ON public.player_current_directory TO authenticated,service_role;
COMMENT ON VIEW public.player_current_directory IS 'Single current-identity read path. Filter by projection/current roster season; statistics still use their own historical season. Reviewed affiliation and skater primary-position events override raw current roster-feed identity; raw observations remain intact. Secondary eligibility is unchanged. Projection team remains separately visible. Historical identity fallback never carries an old club into current affiliation.';
