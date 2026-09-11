-- ============================================================================
-- project_rookies(season): expected value for a player with no NHL history,
-- including the probability he never plays a game
-- ============================================================================
-- PROD_CHANGE_LEDGER Rule 1 rationale block.
--
-- (a) WHAT CHANGED
--   NEW public.project_rookies(integer). Same column shape as
--   public.project_ros(integer) so the pipeline can UNION them. Nothing
--   existing is modified.
--
-- (b) THE PROBLEM
--   320 players on 2026 NHL rosters have no row in player_ros_projections;
--   302 have never played an NHL regular-season game. project_ros filters
--   `raw_gp >= 1`, so it can never produce a rookie. The rookie class
--   arrives on the draft board blank.
--
-- (c) THE TRAP THIS FUNCTION EXISTS TO AVOID
--   player_directory is built from /v1/roster/{team}/current
--   (scripts/utilities/populate_player_directory.py). In September that is
--   the CAMP roster: 1,310 players across 32 teams, 40.9 per team, against
--   an NHL active roster of 23. Final cuts land ~29 September. Drafts open
--   15 September. So on draft day the board carries roughly 18 extra
--   players per team who will not be in the NHL, and a naive projection
--   hands every one of them a full season.
--
--   Measured, because the first two versions of this function got it wrong:
--   of the 430 players in the 2025 camp directory who had never played an
--   NHL game, only 99 debuted that season. THE MEDIAN CAMP ROOKIE PLAYS
--   ZERO GAMES. An earlier draft of this file projected a top-5 forward at
--   76 games and 50 points. The truth for that cohort is 24 games.
--
-- (d) THE MODEL
--   expected season = P(plays at all) x games | plays x rate | plays
--
--   The first two terms are folded into one UNCONDITIONAL games figure,
--   measured directly on the only transition the data contains: who was in
--   the 2025 camp directory with no NHL history, and what did they actually
--   play in 2025.
--
--     draft slot     in camp   debuted   %      exp games (incl. zeros)
--     top 15            30        21    70.0%        23.9
--     rest of rd 1      31        13    41.9%        10.9
--     round 2+ / UD    369        92    24.9%         4.3
--
--   Pooled to slot only. The per-position split is too thin to trust --
--   defence top-15 reads 37.1 games off n=9 against 18.2 for forwards off
--   n=21, which is noise, and pooling the two returns exactly the 23.9
--   above. Round 2, round 3+ and undrafted are pooled for the same reason:
--   raw, round 2 (2.8) came in BELOW round 3+ (5.2) because round 3+
--   carries older AHL callups who are readier.
--
--   RATES are conditional on playing and come from a separate, larger
--   measurement: debut-season production of the 942 players whose first
--   NHL game falls in 2017-2025, bucketed by draft slot and position
--   (player_game_stats, 441,999 regular-season rows). Median, not mean --
--   one Matthews drags a bucket's mean far past a typical top pick.
--   Isotonic on goals, assists, PPP and SOG so a worse slot can never
--   score higher. HITS, BLOCKS and PIM are deliberately NOT smoothed:
--   forwards' hits per game rise from 0.700 at top-5 to 1.234 at round 4+,
--   which is a real role effect -- late picks are checkers -- not noise.
--
--   Goalies get one pooled rate prior. Draft slot does not predict rookie
--   goalie rates (0.458 / 0.414 / 0.333 wins per start by round), and the
--   per-bucket table produced a 1.000 win rate off n=3 -- one goalie, one
--   start, one win. Pooling all 85 goalie debuts gives 0.406 W, 25.00 SV,
--   2.576 GA per start, a backup's line, which is what a rookie goalie is.
--   Their unconditional starts are ~1.5, so exp_starts is 2, not 6.
--
--   Shutouts, SHP and plus-minus use pooled MEANS: their medians are
--   structurally zero and shipping a zero would delete the category.
--
-- (e) WHAT THIS CANNOT DO, STATED PLAINLY
--   The unconditional games term rests on ONE season transition (2025 camp
--   to 2025 play, 430 players). player_directory only spans 2025-2026, so
--   there is no second transition to check it against. It is thin, and it
--   is still far better than the alternative: the conditional-on-debut
--   figures an earlier version used, which overstated by three to six times
--   because they silently excluded everyone who never made it.
--
--   It also knows nothing a scout knows -- no junior scoring, no camp
--   performance, no depth chart. A top-15 forward gets 24 games and about
--   12 points. Some of them will score 60. The function's job is to put
--   the rookie class in roughly the right place on a 300-player board, not
--   to pick which 18-year-old breaks out.
--
--   REFRESH AFTER FINAL CUTS. Re-running populate_player_directory.py once
--   rosters are set (~29 Sep) removes most of the camp padding at source,
--   and is worth more than any modelling change in here.
--
-- (f) WHO / WORKSTREAM
--   Claude (cloud session 01J7JBu263Ld1ucRRiRxJ2to), directed by Garrett
--   Storms, 2026-09-11. Third version; the first two are described above
--   as the errors they were.
--
-- (e) RE-BANDED 2026-09-11 ON RE-AUDIT -- the top bucket was calibrated on
--     picks 1-5 and applied to pick 15
--
--   The first draft of this file carried three rate rows per position group,
--   keyed on the same three slots as `opportunity`. Re-measuring found its
--   slot-1 row is byte-identical to the picks 1-5 medians and its slot-2 row
--   to the picks 16-31 medians. So "top 15" was being paid at the picks-1-5
--   rate. Every top-15 skater therefore projected to the SAME number -- for
--   2026 that was seven forwards tied at 143.7 fantasy points, which is both
--   wrong for picks 6-15 and unreadable on a board that sorts by projection.
--
--   OPPORTUNITY AND RATE HAVE DIFFERENT SAMPLE SIZES AND NOW HAVE DIFFERENT
--   BANDING. This is the whole point and it is why they look inconsistent.
--
--     Opportunity (games) can only be measured on a CAMP cohort -- everyone
--     who was rostered, including those who never played -- and that needs a
--     player_directory snapshot. The directory holds 2025 and 2026 only, so
--     there is exactly ONE cohort. Finer bands give n=8..11 and the band
--     means are not monotonic (picks 6-10 -> 12.5 GP, picks 11-15 -> 32.1).
--     Three buckets is the honest resolution. Unchanged.
--
--     Rate (production per game) is conditional on playing, so it can be
--     measured on nine seasons of debuts, n=39..125 per cell. Median P/GP is
--     monotonic across all seven bands: .634 .455 .431 .360 .315 .288 .260.
--     That signal is real and the three-bucket version was discarding it.
--
--   SURVIVORSHIP, AND WHY IT DOES NOT INVALIDATE THIS. Draft position lives
--   in player_directory.career, which covers 2025-2026 only, so a 2018
--   debutant who washed out by 2022 has no draft position and drops out of
--   the rate cohort (933 of 2,179 debutants survive). That bias preferentially
--   deletes BUSTS among late picks, which ATTENUATES the draft-position
--   gradient. A gradient that survives it is a lower bound, not an artefact.
--
--   ISOTONIC ON SCORING STATS ONLY. G, A, SOG and PPP are pooled-adjacent-
--   violators fitted (weighted by n) to be non-increasing in draft position;
--   the adjustments are small and only ever merge adjacent bands. Blocks,
--   hits and PIM are left RAW and are deliberately not monotone: a fourth-
--   line rookie hits more than a first-line one, and forcing that curve down
--   would be imposing a belief the data contradicts.
--
--   SOURCE QUERY (run against production 2026-09-11, read-only) -- debut =
--   min season with a regular-season game; rates are that season's medians,
--   UNFILTERED by games played, so a three-game call-up counts:
--
--     with debut as (select player_id,
--            min(substring(game_id::text,1,4)::int) s
--            from player_game_stats
--            where substring(game_id::text,5,2)='02' group by 1)
--     ... join player_directory for (career->'draft'->>'overall')
--     ... group by position group and the seven bands below.
--
--   AGE WAS MEASURED AND REJECTED (2026-09-11). The re-banded board puts
--   Tyler Boucher -- 10th overall in 2021, age 23, never stuck -- level with
--   Viggo Bjorck, 18 and taken 8th last June. That looks wrong to a hockey
--   eye, so it was tested twice and the intuition failed both times:
--
--     CONDITIONAL (debut-season production by debut age, 2017-2025): round-one
--     debutants aged 23+ post the HIGHEST median P/GP of any age band, .561
--     against .349 for the 19-and-unders. That is survivorship -- a first
--     rounder who finally debuts at 23 did so by becoming good enough, and
--     the ones who never did are not in the table. Same finding the original
--     years-to-debut check made, reached from the other direction.
--
--     UNCONDITIONAL (2025 camp cohort, zeros included, so no survivorship):
--     round-2+ camp players aged 23+ played 51%% of the time for 10.3 mean
--     games, against 13%% and 2.7 games for the under-20s. Undrafted 23+ beat
--     undrafted under-20s the same way. There is a plain mechanism: a
--     23-year-old in an NHL camp is on an earned NHL contract, while a
--     19-year-old is on an entry-level deal and goes back to junior.
--
--     And for Boucher's own cell -- round one, 23+ -- the single camp cohort
--     holds ZERO players. No evidence exists either way.
--
--   So no age term. Applying one would mean overriding two measurements with
--   a hockey feeling, which is the failure this file already exists to avoid.
--
--   WHAT THIS DOES NOT FIX. Picks 1-5 still share one number, as do two
--   players taken 10th. That is honest: nothing in this database
--   distinguishes them. The real fix is pre-NHL production -- junior, AHL and
--   European scoring, which the NHL landing endpoint already returns under
--   seasonTotals and which populate_player_directory.py currently discards --
--   plus directory backfill for 2017-2024 to get eight camp cohorts instead
--   of one. Both are post-launch work, in that order.
--
-- Reversibility: DROP FUNCTION IF EXISTS public.project_rookies(integer);
-- Idempotent: CREATE OR REPLACE.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.project_rookies(p_season integer)
 RETURNS TABLE(player_id integer, is_goalie boolean, position_code text, age integer,
               exp_gp integer, exp_starts integer,
               r_goal numeric, r_a numeric, r_sog numeric, r_blk numeric, r_ppp numeric,
               r_shp numeric, r_hits numeric, r_pim numeric, r_pm numeric,
               r_wins numeric, r_saves numeric, r_so numeric, r_ga numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with scale as (select public.get_season_game_count(p_season)::numeric / 82.0 k),
  -- UNCONDITIONAL games: measured on the 2025 camp cohort, zeros included.
  opportunity(slot, gp, starts) as (values
    (1, 23.9, 0.0),   -- top 15
    (2, 10.9, 0.0),   -- rest of round 1
    (3,  4.3, 1.5)    -- round 2+, undrafted; starts term is goalies only
  ),
  -- CONDITIONAL rates: debut-season medians, 2017-2025 debuts, by SEVEN draft
  -- bands rather than the three opportunity slots. See header (b) for why the
  -- two are banded differently and for the source query.
  rate(pos_group, band, g, a, sog, blk, ppp, hits, pim) as (values
    ('F',1, 0.2703, 0.3871, 2.3050, 0.4150, 0.1636, 0.7000, 0.3290),
    ('F',2, 0.1772, 0.2778, 2.0830, 0.3330, 0.1231, 0.5080, 0.3240),
    ('F',3, 0.1538, 0.2185, 1.6050, 0.3920, 0.0385, 0.8890, 0.3290),
    ('F',4, 0.1429, 0.2185, 1.5710, 0.3780, 0.0287, 0.9440, 0.2890),
    ('F',5, 0.1027, 0.1428, 1.3330, 0.4180, 0.0000, 0.9760, 0.2500),
    ('F',6, 0.1027, 0.1428, 1.1790, 0.4430, 0.0000, 1.0000, 0.2780),
    ('F',7, 0.1027, 0.1067, 1.0000, 0.3700, 0.0000, 1.2380, 0.2860),
    ('D',1, 0.1098, 0.3333, 1.7140, 1.3540, 0.0999, 1.0250, 0.4440),
    ('D',2, 0.0838, 0.2470, 1.3400, 1.1110, 0.0999, 1.1260, 0.4960),
    ('D',3, 0.0732, 0.2286, 1.2441, 1.2650, 0.0294, 1.0000, 0.4180),
    ('D',4, 0.0450, 0.1865, 1.2441, 1.0000, 0.0169, 0.9840, 0.3140),
    ('D',5, 0.0328, 0.1707, 1.0983, 1.1040, 0.0000, 1.1710, 0.3750),
    ('D',6, 0.0000, 0.1707, 1.0983, 1.0990, 0.0000, 0.9380, 0.2180),
    ('D',7, 0.0000, 0.1250, 1.0000, 1.0000, 0.0000, 1.0000, 0.3230)
  ),
  cand as (
    select pd.player_id, pd.position_code, pd.is_goalie, pd.birthdate,
           (pd.career->'draft'->>'overall')::int overall
    from player_directory pd
    where pd.season = p_season
      -- COMPLEMENTARY TO project_ros (2026-09-11). The exclusion is "no games
      -- in project_ros's OWN four-season window", not "never played an NHL
      -- game". With the stricter rule, 18 players in the 2026 directory fell
      -- through both functions -- veterans whose last NHL game predates the
      -- window (Gambrell, Hajek, Formenton, Wolanin) -- and got no projection
      -- at all. This rule makes the two exactly complementary: verified on
      -- 2026, overlap 0 and gap 0 across all 1,310 directory rows.
      -- It is also the right answer on the merits: a player with no NHL game
      -- in four years is, for projection purposes, in the same position as a
      -- rookie -- an unknown competing for a roster spot -- and the camp
      -- cohort prior describes him better than silence does.
      and not exists (select 1 from player_game_stats pgs
                      where pgs.player_id = pd.player_id
                        and substring(pgs.game_id::text,5,2) = '02'
                        and substring(pgs.game_id::text,1,4)::int
                            between p_season - 3 and p_season)
  ),
  b as (
    select c.*,
      case when c.is_goalie or c.position_code='G' then 'G'
           when c.position_code='D' then 'D' else 'F' end pos_group,
      -- OPPORTUNITY slot: three buckets, because that is all the one camp
      -- cohort supports (n=8..11 per finer band, and non-monotonic).
      case when c.overall is null then 3
           when c.overall <= 15 then 1
           when c.overall <= 31 then 2
           else 3 end slot,
      -- RATE band: seven, because nine seasons of debuts do support it.
      case when c.overall is null then 7
           when c.overall <=   5 then 1
           when c.overall <=  10 then 2
           when c.overall <=  15 then 3
           when c.overall <=  31 then 4
           when c.overall <=  62 then 5
           when c.overall <= 100 then 6
           else 7 end rate_band
    from cand c
  )
  select
    b.player_id,
    (b.pos_group='G') as is_goalie,
    coalesce(b.position_code, case when b.pos_group='G' then 'G' else 'C' end),
    extract(year from age(make_date(p_season,10,1), b.birthdate))::int,
    greatest(0, round(o.gp * s.k))::int as exp_gp,
    case when b.pos_group='G' then greatest(0, round(o.starts * s.k))::int else 0 end as exp_starts,
    coalesce(r.g,   0)::numeric, coalesce(r.a,   0)::numeric,
    coalesce(r.sog, 0)::numeric, coalesce(r.blk, 0)::numeric,
    coalesce(r.ppp, 0)::numeric,
    case when b.pos_group='G' then 0.0004::numeric
         when b.pos_group='D' then 0.0040::numeric else 0.0082::numeric end,
    coalesce(r.hits,0)::numeric, coalesce(r.pim, 0)::numeric,
    case when b.pos_group='G' then 0::numeric
         when b.pos_group='D' then -0.0232::numeric else -0.0185::numeric end,
    case when b.pos_group='G' then 0.406::numeric  else 0::numeric end,
    case when b.pos_group='G' then 25.00::numeric  else 0::numeric end,
    case when b.pos_group='G' then 0.0574::numeric else 0::numeric end,
    case when b.pos_group='G' then 2.576::numeric  else 0::numeric end
  from b
  cross join scale s
  join opportunity o on o.slot = b.slot
  left join rate r on r.pos_group = b.pos_group and r.band = b.rate_band;
$function$;

-- GRANTS (corrected 2026-09-11 on re-audit). The first draft of this file
-- granted EXECUTE to authenticated and anon. That is strictly looser than
-- its sibling project_ros, which 20260901150000 locked to service_role
-- alone, and it contradicts 20260911053000 in this same batch -- a file
-- whose entire purpose is revoking `authenticated` from SECURITY DEFINER
-- functions, because PostgREST publishes every grantable function at
-- /rest/v1/rpc/<name>. project_rookies has no caller outside
-- rebuild_ros_projections, which runs as service_role. Matching project_ros.
REVOKE ALL ON FUNCTION public.project_rookies(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_rookies(integer) TO service_role;

COMMIT;
