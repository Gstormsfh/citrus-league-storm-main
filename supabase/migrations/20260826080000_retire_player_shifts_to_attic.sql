-- ─────────────────────────────────────────────────────────────────────────────
-- player_shifts leaves public.
--
-- WHAT IT WAS
--   Not shift data. calculate_player_toi.py built it by inferring a "shift"
--   from the events a player appeared in — a hit, a faceoff, a shot — and
--   treating the gap between the first and last such event as time on the ice.
--   That is not what a shift is, and the numbers said so from the beginning:
--
--     4.0%      of player-games within thirty seconds of the NHL's own game log
--               (player_shifts_official, from the real shift charts: 99.64%)
--     19,688    "shifts" longer than five minutes
--     4.8%      exact duplicates of another row, each one double-counting a man
--     PK ≈ 2×PP league-wide, when the two are the same events counted from
--               opposite benches and must come out near 1.19
--
--   It stopped being written on 2026-01-04 and covers only 2024-25 and 2025-26.
--   Nine seasons of real charts now sit in player_shifts_official.
--
-- WHY MOVED AND NOT DROPPED
--   Moving is reversible and costs nothing but a catalog entry — the 132 MB
--   stays on disk either way until someone decides otherwise, and with the
--   volume confirmed at 12 GB there is no reason to force that decision
--   tonight. What matters is that it stops being reachable.
--
--   Which the move accomplishes on its own: PostgREST exposes public, so a
--   table in attic is off the API regardless of the RLS policy that used to
--   let any authenticated user read it. That policy — "Authenticated users can
--   read player shifts" — is the reason this could not simply be left alone.
--   A wrong table with a public read grant is a wrong number waiting for a
--   frontend to find it.
--
-- CHECKED BEFORE MOVING
--   No foreign keys in either direction. No triggers. No view. The single
--   occurrence of the bare name in any function is inside a COMMENT in
--   citrus_data_invariants describing what went wrong. Nothing in src/,
--   nothing in supabase/functions/, and in data-pipeline and scripts only
--   comments and one classification script's string list.
--
-- BRINGING IT BACK
--   alter table attic.player_shifts set schema public;
--   -- and then ask why.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.player_shifts set schema attic;

comment on table attic.player_shifts is
  'RETIRED 2026-08-26. Event-participation inference, not shifts: 4.0% agreement '
  'with the NHL game log where the real charts get 99.64%. Superseded by '
  'public.player_shifts_official. Kept for forensics only — do not read it.';
