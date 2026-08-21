-- 2026-08-20 — grant EXECUTE on the v2 draft RPC surface to `authenticated`.
--
-- WHY: the first real commissioner Start press in production failed with
--   permission denied for function start_draft_v2   (postgres log 05:17:15Z)
-- surfaced to the user as `illegal_state reason:unexpected` (the start
-- route's discriminator list only knows the RPC's own taxonomy, so a
-- permission error fell through to 'unexpected').
--
-- The API's front door calls these RPCs with createUserClient(userToken)
-- (anon key + user JWT -> PostgREST role `authenticated`), but every v2
-- function carried only {postgres, service_role} in its ACL, and no
-- migration anywhere ever granted EXECUTE on them. Staging had the
-- identical gap; its 139 drafts ran through service-role harness paths,
-- which is why the landmine stayed buried until tonight's proving draft.
--
-- Applied directly to BOTH prod (iezwazccqqrhrjupxzvf) and staging
-- (jjgspcpvqaiitloglxbb) on 2026-08-20 via MCP apply_migration; this file
-- makes the repo the source of truth for any future environment.
--
-- SAFETY: every one of these is SECURITY DEFINER with its own internal
-- authorization gates (start_draft_v2 requires p_actor kind='commissioner'
-- and the route stacks commissionerMiddleware in front; submit_pick_v2
-- enforces on-clock/ownership/idempotency inside the function). Granting
-- EXECUTE to authenticated is the intended front-door design, not a
-- widening of authority.

GRANT EXECUTE ON FUNCTION public.start_draft_v2(p_league_id uuid, p_actor jsonb, p_idempotency_key uuid, p_correlation_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_pick_v2(p_league_id uuid, p_team_id uuid, p_player_id integer, p_round integer, p_pick_number integer, p_session_id uuid, p_idempotency_key uuid, p_payload_hash text, p_actor jsonb, p_correlation_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nominate_player_v2(p_league_id uuid, p_team_id uuid, p_player_id text, p_player_name text, p_opening_bid numeric, p_session_id uuid, p_idempotency_key uuid, p_payload_hash text, p_actor jsonb, p_correlation_id uuid, p_clock_seconds integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.place_bid_v2(p_league_id uuid, p_team_id uuid, p_nomination_id uuid, p_bid_amount numeric, p_session_id uuid, p_idempotency_key uuid, p_payload_hash text, p_actor jsonb, p_correlation_id uuid, p_anti_snipe_threshold_seconds integer, p_anti_snipe_extension_seconds integer, p_min_bid_increment_tiers jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_nomination_v2(p_league_id uuid, p_nomination_id uuid, p_idempotency_key uuid, p_payload_hash text, p_actor jsonb, p_correlation_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auction_pause_v2(p_league_id uuid, p_actor jsonb, p_reason text, p_idempotency_key uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auction_resume_v2(p_league_id uuid, p_actor jsonb, p_idempotency_key uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.auction_nomination_skip_v2(p_league_id uuid, p_team_id uuid, p_actor jsonb, p_reason text, p_idempotency_key uuid) TO authenticated;
