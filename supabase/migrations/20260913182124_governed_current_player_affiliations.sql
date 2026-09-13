-- Current NHL affiliation is independent of fantasy ownership, injury status,
-- historical statistics and the club used by an immutable projection scenario.
-- Corrections are append-only evidence events. A later reviewed event supersedes
-- an earlier one; an undated/stale roster-feed observation cannot erase it.
CREATE TABLE public.player_affiliation_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 season integer NOT NULL CHECK (season BETWEEN 2000 AND 2100),
 player_id integer NOT NULL CHECK (player_id > 0),
 status text NOT NULL CHECK (status IN ('affiliated','free_agent','retired','non_nhl','unknown')),
 team_abbrev text,
 organization text,
 feed_team_at_review text,
 authority text NOT NULL CHECK (authority IN ('official_transaction','official_roster','reviewed_unknown','owner_override')),
 effective_on date NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 source_urls jsonb NOT NULL CHECK (jsonb_typeof(source_urls)='array' AND jsonb_array_length(source_urls)>0),
 reason text NOT NULL CHECK (length(trim(reason))>0),
 recorded_by text NOT NULL CHECK (length(trim(recorded_by))>0),
 supersedes uuid,
 UNIQUE(season,player_id,id),
 FOREIGN KEY(season,player_id,supersedes) REFERENCES public.player_affiliation_events(season,player_id,id),
 CHECK ((status='affiliated' AND team_abbrev IS NOT NULL AND team_abbrev ~ '^[A-Z]{2,3}$') OR (status<>'affiliated' AND team_abbrev IS NULL))
);
CREATE INDEX player_affiliation_events_current_idx ON public.player_affiliation_events(season,player_id,sequence DESC);
ALTER TABLE public.player_affiliation_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY player_affiliation_evidence_read ON public.player_affiliation_events FOR SELECT TO authenticated USING(true);
REVOKE ALL ON public.player_affiliation_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.player_affiliation_events TO authenticated;
GRANT SELECT,INSERT ON public.player_affiliation_events TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.player_affiliation_events_sequence_seq TO service_role;
COMMENT ON TABLE public.player_affiliation_events IS 'Append-only reviewed current club/lifecycle evidence. Service-side ingestion only; no client mutation. Never changes fantasy roster membership, injury eligibility or projection values. Record a new superseding event for a correction.';

CREATE VIEW public.player_current_directory WITH(security_invoker=true) AS
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
 e.organization,e.source_urls,e.reason
 FROM identities i
 LEFT JOIN public.player_directory d ON d.season=i.season AND d.player_id=i.player_id
 LEFT JOIN LATERAL (SELECT x.* FROM public.player_directory x WHERE x.player_id=i.player_id AND x.season<i.season ORDER BY x.season DESC LIMIT 1) h ON true
 LEFT JOIN public.canonical_published_players p ON p.season=i.season AND p.player_id=i.player_id::text
 LEFT JOIN evidence e ON e.season=i.season AND e.player_id=i.player_id
)
SELECT identity.*,r.payload->>'team' AS projection_team,
 jsonb_build_object('status',r.affiliation_status,'team',r.current_team,'authority',r.affiliation_authority,
 'as_of',r.affiliation_as_of,'recorded_at',r.affiliation_recorded_at,'event_id',r.affiliation_event_id,
 'organization',r.organization,'source_urls',coalesce(r.source_urls,'[]'::jsonb),'reason',r.reason) AS current_affiliation
FROM resolved r
CROSS JOIN LATERAL jsonb_populate_record(NULL::public.player_directory,
 coalesce(to_jsonb(r.current_row),to_jsonb(r.historical_row),'{}'::jsonb) ||
 jsonb_build_object('season',r.season,'player_id',r.player_id,
 'full_name',coalesce((r.current_row).full_name,(r.historical_row).full_name,r.payload->>'name'),
 'position_code',coalesce((r.current_row).position_code,(r.historical_row).position_code,r.payload->>'position'),
 'is_goalie',coalesce((r.current_row).is_goalie,(r.historical_row).is_goalie,(r.payload->>'is_goalie')::boolean),
 'team_abbrev',r.current_team)) identity;
GRANT SELECT ON public.player_current_directory TO authenticated,service_role;
COMMENT ON VIEW public.player_current_directory IS 'Single current-identity read path. Filter by projection/current roster season; statistics still use their own historical season. Explicit reviewed affiliation events override raw current roster-feed identity. Projection team remains separately visible. Historical identity fallback never carries an old club into current affiliation.';
