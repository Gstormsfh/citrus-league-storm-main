-- Retire a reviewed primary override without deleting history or pinning the
-- observed feed position as another manual override. No data events seeded.
ALTER TABLE public.player_position_events
 ADD COLUMN event_action text NOT NULL DEFAULT 'set_primary'
 CHECK (event_action IN ('set_primary','restore_feed'));
ALTER TABLE public.player_position_events
 ADD CONSTRAINT restored_position_requires_predecessor
 CHECK (event_action <> 'restore_feed' OR supersedes IS NOT NULL);
COMMENT ON COLUMN public.player_position_events.event_action IS
 'set_primary applies an explicit reviewed primary; restore_feed supersedes a prior event and returns identity to normal NHL feed resolution. position_code records the observed baseline for the audit only on restore_feed.';

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
  SELECT CASE WHEN x.event_action='restore_feed' THEN NULL ELSE x.position_code END AS position_code FROM public.player_position_events x
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
