-- 2026-09-05: career totals on the player directory.
--
-- The writeups say what a player did last season and project the next one;
-- they had nothing to say about the career, so a 40-year-old with 897 goals
-- read like any other veteran. `career` holds the NHL landing endpoint's
-- regular-season career totals, the draft, the NHL season count and the
-- trophies, as one small JSON document per player; `career_fetched_at`
-- lets the refresh script take the stale rows first.
--
-- Written by scripts/utilities/populate_career_totals.py (weekly workflow
-- refresh-career-totals.yml). Read by GET /api/players/directory.
-- No RLS change: player_directory keeps its existing policies.

begin;

alter table public.player_directory
  add column if not exists career jsonb,
  add column if not exists career_fetched_at timestamptz;

comment on column public.player_directory.career is
  'NHL landing endpoint career summary: {gp, goals, assists, points, wins, shutouts, seasons, draft:{year,round,overall,team}, awards:[{name,count}]}. Regular season only.';

create index if not exists player_directory_career_fetched_idx
  on public.player_directory (career_fetched_at nulls first);

commit;
