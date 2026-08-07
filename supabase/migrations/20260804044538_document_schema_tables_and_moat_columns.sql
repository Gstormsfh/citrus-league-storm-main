-- 0D-ORG-4: Make the schema self-describing.
--
-- APPLIED: prod 20260804044538 / staging (same name, relaxed gate). Authoritative record.
--
-- Purely additive: COMMENT ON only. No data, structure, grants or policies are touched.
-- Before this migration 29 of 85 tables carried a comment. This documents the remaining 49
-- live tables and gives the Phase 0c moat columns their provenance in the database itself,
-- so the meaning travels with the data instead of living only in docs/ and this chat.
--
-- Where two tables have confusable names the comment says explicitly which is which -- that
-- disambiguation is the point, not decoration.
--
-- VERIFIED ON PROD AFTER APPLY: 79/79 live tables documented; 62 raw_shots columns
--   annotated, including all 17 Phase 0c moat and companion fields.

-- ============ Identity, membership, league core ============
COMMENT ON TABLE public.profiles IS
  'One row per authenticated user. Contains PII (first_name, last_name, phone, Email, location) — read access is league-scoped via the "League members can view each other profiles" policy backed by shares_league_with(). is_admin gates the /api/admin/* routes.';
COMMENT ON TABLE public.leagues IS
  'Fantasy league configuration. settings (jsonb) holds scoring and roster rules; waiver_type drives which waiver engine applies (rolling / reverse_standings / faab). Demo league 750f4e1a-92ae-44cf-a798-2f3e06d0d5c9 is publicly readable by design.';
COMMENT ON TABLE public.teams IS
  'A fantasy roster within a league. owner_id NULL means an AI-managed team, which is why roster paths that look teams up by owner_id must handle NULL explicitly.';
COMMENT ON TABLE public.join_code_attempts IS
  'Audit trail of league join-code attempts, successful and failed, with IP and user agent. Abuse/brute-force forensics for leagues.join_code.';

-- ============ Draft ============
COMMENT ON TABLE public.draft_order IS
  'Per-round pick order for a draft session. deleted_at supports soft reset without destroying history.';
COMMENT ON TABLE public.draft_picks IS
  'Completed draft selections. draft_session_id scopes a run so a league can be re-drafted; deleted_at soft-deletes a reset session rather than erasing it.';
COMMENT ON TABLE public.player_autopick_rankings IS
  'Per-team autopick preference list used when a manager is absent or the clock expires. Quiet outside draft season.';

-- ============ Roster and transactions ============
COMMENT ON TABLE public.transaction_ledger IS
  'Append-only record of roster adds and drops. source distinguishes origin ("Roster Tab", "Waiver Processing", …). Written by process_roster_move().';
COMMENT ON TABLE public.player_waiver_status IS
  'Tracks players sitting on waivers after a drop. cleared_at is stamped once the waiver period (leagues.waiver_period_hours, default 48) elapses.';
COMMENT ON TABLE public.waiver_claims IS
  'Pending and resolved waiver claims. Processed nightly by pg_cron job "process-pending-waivers" (0 3 * * *) via process_all_pending_waivers(); status moves pending -> successful/failed with failure_reason.';
COMMENT ON TABLE public.waiver_priority IS
  'Rolling waiver priority order per team. Rotated after a successful claim in rolling leagues.';
COMMENT ON TABLE public.faab_budgets IS
  'Free-agent acquisition budget per team for FAAB leagues. NOTE: no pg_cron job is currently registered for process_all_faab_waivers(), so FAAB waivers do not process automatically.';
COMMENT ON TABLE public.trade_offers IS
  'Proposed trades between two teams. offered_player_ids / requested_player_ids are id arrays, not join tables.';
COMMENT ON TABLE public.trade_votes IS
  'League-vote trade review ballots. Expired reviews are resolved by pg_cron job "process-trade-reviews" (*/15 * * * *).';
COMMENT ON TABLE public.trade_history IS
  'Executed trades, retained after the originating trade_offer is resolved.';
COMMENT ON TABLE public.keeper_designations IS
  'Players designated as keepers into the next season, with the round/penalty cost of keeping them. Quiet outside the keeper window.';

-- ============ Matchups and scoring ============
COMMENT ON TABLE public.matchups IS
  'Weekly head-to-head pairings and their scores. Auto-completed and rescored by database functions rather than the application.';
COMMENT ON TABLE public.matchup_scoring_snapshots IS
  'Immutable copy of a league scoring ruleset captured at matchup creation, so historical matchups keep scoring under the rules in force at the time even if the league later changes settings.';
COMMENT ON TABLE public.league_scoring_audit IS
  'Change log of league scoring settings: who changed them, old and new jsonb.';

-- ============ Fantasy playoffs (league brackets) ============
COMMENT ON TABLE public.playoff_brackets IS
  'FANTASY league playoff bracket configuration. Not NHL playoffs — see nhl_playoff_series for the real thing.';
COMMENT ON TABLE public.playoff_seeds IS
  'FANTASY playoff seeding for a bracket, derived from regular-season record. Distinct from nhl_playoff_seeds, which holds real NHL seeding.';
COMMENT ON TABLE public.playoff_series IS
  'FANTASY playoff series within a bracket. Winner propagation to the next round is trigger-driven. Distinct from nhl_playoff_series.';

-- ============ Pools (season-long side games) ============
COMMENT ON TABLE public.pool_picks IS
  'Weekly pick-em selections against the spread. Participants are also team owners in the same league — the profiles league-scoped read policy relies on that coupling.';
COMMENT ON TABLE public.confidence_picks IS
  'Confidence-pool picks: each weekly pick carries a confidence_points weight. Quiet outside season.';
COMMENT ON TABLE public.survivor_selections IS
  'Survivor/eliminator pool picks. eliminated_at stamps the week a player was knocked out.';

-- ============ NHL playoff pools ============
COMMENT ON TABLE public.playoff_bracket_picks IS
  'NHL playoff bracket predictions, one pick per series slot, locked at locked_at.';
COMMENT ON TABLE public.playoff_confidence_picks IS
  'NHL playoff series picks weighted by confidence_value.';
COMMENT ON TABLE public.playoff_roster_picks IS
  'NHL playoff fantasy roster selections by position slot.';
COMMENT ON TABLE public.playoff_pool_standings IS
  'Materialised leaderboard for NHL playoff pools. Refreshed by scoring RPCs rather than maintained transactionally.';

-- ============ Auction draft ============
COMMENT ON TABLE public.auction_nominations IS
  'Players nominated in an auction draft, with running high bid. Quiet outside auction drafts.';
COMMENT ON TABLE public.auction_bids IS
  'Individual bids against an auction nomination.';
COMMENT ON TABLE public.auction_budgets IS
  'Per-team auction budget and spend tracking.';

-- ============ NHL reference data (source of truth: NHL API) ============
COMMENT ON TABLE public.nhl_teams IS
  'NHL franchise reference: id, name, abbreviation, city. Join key for team_abbrev across stats tables.';
COMMENT ON TABLE public.nhl_games IS
  'NHL game schedule and results, including Vegas odds columns. Source of truth for game_date used by scoring.';
COMMENT ON TABLE public.nhl_playoff_seeds IS
  'REAL NHL playoff seeding by conference/division. Distinct from playoff_seeds, which is fantasy-league bracket seeding.';
COMMENT ON TABLE public.nhl_playoff_series IS
  'REAL NHL playoff series with bracket slot wiring (parent_slot_a/b). Distinct from playoff_series, which is fantasy.';
COMMENT ON TABLE public.nhl_pipeline_meta IS
  'Key/last_refresh watermarks for pipeline freshness checks. Four rows.';

-- ============ Player stats and projections ============
COMMENT ON TABLE public.players IS
  'LEGACY player table, superseded by player_directory (which serves ~468M reads to this table''s ~19K). Repo migration 20260505200000_drop_legacy_public_players_table.sql drops it but has never been applied to this database. Retained only because one inbound FK and several function bodies still reference it — resolve those before dropping.';
COMMENT ON TABLE public.player_playoff_stats IS
  'Aggregated NHL playoff statistics per player and season, used for playoff pool scoring.';
COMMENT ON TABLE public.player_ros_projections IS
  'Rest-of-season projections per player: games_remaining plus projected counting stats. The richest projection table (27 columns); prefer it over the legacy projections table.';
COMMENT ON TABLE public.projections IS
  'LEGACY thin projection table (7 columns, per game_id/player_id). Superseded by player_projected_stats and player_ros_projections. Retained pending call-site cleanup — do not build new consumers on it.';
COMMENT ON TABLE public.team_stats IS
  'Team-level rate stats per season (goals against average, save percentage, shots for/against). Written by data-pipeline/acquisition/populate_team_stats.py and read by nightly_projection_batch.py, both as service_role.';
COMMENT ON TABLE public.raw_player_stats IS
  'MoneyPuck-derived per-player expected-goals metrics. WRITE-ONLY IN PRACTICE: written by data-pipeline/acquisition/data_acquisition.py:4302,4324 but read by nothing in the application (9 lifetime reads). Also note the camelCase "playerId" column, which breaks the snake_case convention used everywhere else.';

-- ============ Operations, telemetry, growth ============
COMMENT ON TABLE public.integrity_check_results IS
  'Output of the data-integrity cron (job 3, every 6h) and auto-fix cron (job 4, daily). Operational telemetry only — no business data. Retained 90 days by the audit-log-retention job.';
COMMENT ON TABLE public.auto_recovery_log IS
  'Record of automated roster-recovery runs: what triggered them, teams affected, players restored, and whether the recovery succeeded.';
COMMENT ON TABLE public.nightly_job_runs IS
  'Per-run status of nightly batch jobs. Primary place to check whether last night''s pipeline actually completed.';
COMMENT ON TABLE public.pipeline_runs IS
  'Data-pipeline execution records: service_name, row counts ingested, and error text on failure.';
COMMENT ON TABLE public.notifications IS
  'In-app user notifications. Generated by triggers on transactions rather than by the application layer.';
COMMENT ON TABLE public.stormy_chat_log IS
  'Usage log for the Stormy AI assistant: user, tokens_used, and a truncated message_preview. Written by the stormy-chat edge function.';
COMMENT ON TABLE public.waitlist IS
  'Public pre-launch email signups. Deliberately accepts anonymous INSERT — this is the one table anon can write to, and it is unbounded, so rate limiting belongs at the application edge.';

-- ============ Phase 0c moat columns on raw_shots ============
COMMENT ON COLUMN public.raw_shots.has_pass_before_shot IS
  'Phase 0c moat feature. TRUE when a pass was reconstructed immediately before this shot from the NHL play-by-play event stream. NULL means genuinely unknown, not false — bounded honest-NULL is intended.';
COMMENT ON COLUMN public.raw_shots.passer_id IS
  'Phase 0c. NHL player id of the passer on the reconstructed pre-shot pass.';
COMMENT ON COLUMN public.raw_shots.pass_x IS
  'Phase 0c. Pass origin x in NHL RAW rink coordinates. NOT arena-adjusted — matching against MoneyPuck adjusted coordinates was the cause of the arena-adjust ambiguity storm and is fixed at commit 7c4b7026.';
COMMENT ON COLUMN public.raw_shots.pass_y IS
  'Phase 0c. Pass origin y in NHL RAW rink coordinates. See pass_x on the raw-vs-adjusted distinction.';
COMMENT ON COLUMN public.raw_shots.pass_angle IS
  'Phase 0c. Angle of the pass relative to the attacking net.';
COMMENT ON COLUMN public.raw_shots.pass_zone IS
  'Phase 0c. Textual zone the pass originated from; pass_zone_encoded is its numeric encoding for modelling.';
COMMENT ON COLUMN public.raw_shots.pass_zone_encoded IS
  'Phase 0c. Numeric encoding of pass_zone for model input.';
COMMENT ON COLUMN public.raw_shots.pass_lateral_distance IS
  'Phase 0c. Lateral (cross-ice) distance covered by the pass — the raw driver of goalie displacement.';
COMMENT ON COLUMN public.raw_shots.pass_to_net_distance IS
  'Phase 0c. Distance from pass origin to the net.';
COMMENT ON COLUMN public.raw_shots.pass_quality_score IS
  'Phase 0c moat feature. Composite quality of the pre-shot pass.';
COMMENT ON COLUMN public.raw_shots.pass_immediacy_score IS
  'Phase 0c moat feature. How immediately the shot followed the pass — lower elapsed time means less goalie reset opportunity.';
COMMENT ON COLUMN public.raw_shots.goalie_movement_score IS
  'Phase 0c moat feature. Estimated goalie lateral displacement forced by the pre-shot pass. The core of the pass-context moat.';
COMMENT ON COLUMN public.raw_shots.time_before_shot IS
  'Phase 0c. Elapsed time from pass to shot. INTEGER SECONDS — not milliseconds, and not fractional.';
COMMENT ON COLUMN public.raw_shots.normalized_lateral_distance IS
  'Phase 0c. pass_lateral_distance normalised for rink geometry.';
COMMENT ON COLUMN public.raw_shots.zone_relative_distance IS
  'Phase 0c. Pass distance expressed relative to the originating zone.';
COMMENT ON COLUMN public.raw_shots.event_id IS
  'Phase 0c companion. NHL play-by-play event id this shot was matched to. Valid only within its own provenance lineage — do not join across providers.';
COMMENT ON COLUMN public.raw_shots.sort_order IS
  'Phase 0c companion. NHL play-by-play sort order, used to sequence events within a game when game-seconds tie.';

DO $gate$
DECLARE v_documented int; v_total int; v_moat int;
BEGIN
  SELECT count(*) FILTER (WHERE obj_description(c.oid,'pg_class') IS NOT NULL), count(*)
    INTO v_documented, v_total
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND c.relname NOT LIKE '\_deprecated\_%';

  SELECT count(*) INTO v_moat
  FROM information_schema.columns k
  WHERE k.table_schema='public' AND k.table_name='raw_shots'
    AND col_description('public.raw_shots'::regclass, k.ordinal_position::int) IS NOT NULL;

  IF v_documented <> v_total THEN
    RAISE EXCEPTION 'GATE1 FAIL: only %/% live tables documented', v_documented, v_total;
  END IF;
  IF v_moat < 17 THEN
    RAISE EXCEPTION 'GATE2 FAIL: only % raw_shots columns documented, expected >= 17', v_moat;
  END IF;

  RAISE NOTICE '0D-ORG-4 OK: %/% live tables documented, % raw_shots columns annotated',
    v_documented, v_total, v_moat;
END
$gate$;
