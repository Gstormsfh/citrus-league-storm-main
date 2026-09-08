-- Citrus Game Day Suite — foundation: themes, the puzzle log, plays and the
-- cross-game points ledger.
--
-- THE SHAPE OF THE THING. Puzzles are generated ahead of time by scheduled
-- Python jobs and served to phones as immutable dated JSON from a CDN. None
-- of the tables below sit on that read path; a burst of thousands of
-- concurrent sessions fetches a cached file and touches Postgres only when
-- somebody finishes a game. That is deliberate, and it is why the artifact
-- is not stored here.
--
-- WHY THE ANSWER LIVES IN THE DATABASE ANYWAY. The client grades its own
-- guesses offline (see packages/shared/src/types/gameDay.ts), which is what
-- buys the zero-server burst path. If the client also reported its own
-- score, the points ledger would be a wish list: anyone could POST a perfect
-- run without playing. `game_day_puzzle_log` keeps the answer service-role
-- only, and `game_day_submit_daily_player` re-grades the submitted guesses
-- against it. The client says what it guessed; the server decides what
-- happened. There is no client-writable path into the ledger at all.

begin;

-- ─────────────────────────────────────────────────────────────────────────
-- Themes
-- ─────────────────────────────────────────────────────────────────────────
--
-- The suite never hardcodes a palette, a wordmark or a prize rule; it reads
-- one of these rows. The default is neutral Citrus.
--
-- TEAM THEMES ARE GATED AT THE DATABASE, not in the client bundle. A row
-- with requires_feature_flag = true is invisible to anon and to ordinary
-- authenticated users, so a public build cannot reach one even if a client
-- bug asks for it by key. Turning a team theme on is a deliberate act by
-- someone holding the service role, not a query string.

create table if not exists public.game_day_themes (
  key                   text primary key,
  label                 text not null,
  is_default            boolean not null default false,
  requires_feature_flag boolean not null default true,
  -- Design tokens: {"surface":"#0F1F15","accent":"#FF6B1A", ...}. Read by
  -- the theme provider and written onto CSS custom properties.
  palette               jsonb not null default '{}'::jsonb,
  -- {"logo_url":...,"wordmark":...,"mascot_url":...}
  brand                 jsonb not null default '{}'::jsonb,
  -- Per-surface strings. Keyed by game, plus a "shared" bag.
  copy                  jsonb not null default '{}'::jsonb,
  -- {"enabled":false,"claim_threshold":0,"terms_url":null, ...}
  prize_rules           jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Exactly one default, enforced rather than hoped for.
create unique index if not exists game_day_themes_one_default
  on public.game_day_themes (is_default) where is_default;

alter table public.game_day_themes enable row level security;

-- The only rows a public build can see. No write policy exists, so themes
-- are service-role authored.
drop policy if exists "Public can read unflagged game day themes" on public.game_day_themes;
create policy "Public can read unflagged game day themes"
  on public.game_day_themes for select
  using (requires_feature_flag = false);

comment on table public.game_day_themes is
  'Game Day Suite theme records: palette, brand, copy and prize rules. Rows with requires_feature_flag = true are unreadable outside the service role, which is what keeps team themes out of a public build.';

-- ─────────────────────────────────────────────────────────────────────────
-- Puzzle log — what the generator emitted, and the answer it emitted
-- ─────────────────────────────────────────────────────────────────────────
--
-- RLS on with NO policies: service role only, the same posture as
-- ops_ci_runs. Two jobs: it is the answer key the scoring RPC grades
-- against, and it is the no-repeat memory the generator consults so the
-- same player is not the answer twice in a season.

create table if not exists public.game_day_puzzle_log (
  game              text not null,
  puzzle_date       date not null,
  puzzle_id         text not null,
  schema_version    integer not null,
  generator_version text not null,
  difficulty_score  numeric not null,
  difficulty_band   text not null,
  max_attempts      integer not null default 6,
  -- Game-specific. For daily_player: {"player_id": 8471675}.
  answer_key        jsonb not null,
  artifact_path     text,
  artifact_sha256   text,
  emitted_at        timestamptz not null default now(),
  primary key (game, puzzle_date)
);

create index if not exists game_day_puzzle_log_game_date_idx
  on public.game_day_puzzle_log (game, puzzle_date desc);

alter table public.game_day_puzzle_log enable row level security;

comment on table public.game_day_puzzle_log is
  'One row per emitted puzzle, holding the answer key. Service role only (RLS on, zero policies) — a readable row here would spoil every puzzle and let anyone forge a perfect score.';

-- ─────────────────────────────────────────────────────────────────────────
-- Plays — one row per user per game per day
-- ─────────────────────────────────────────────────────────────────────────
--
-- user_id is an auth.users id, and for most players that is an ANONYMOUS
-- user (auth.users.is_anonymous = true). Upgrading to a real account at
-- prize claim uses linkIdentity, which keeps the same id, so nothing below
-- ever has to be migrated from one identity to another.

create table if not exists public.game_day_plays (
  user_id      uuid not null references auth.users(id) on delete cascade,
  game         text not null,
  puzzle_date  date not null,
  puzzle_id    text not null,
  outcome      text not null check (outcome in ('won', 'lost')),
  attempts     integer not null check (attempts >= 0),
  points       integer not null default 0,
  -- Server-verified detail: the guess sequence as submitted.
  detail       jsonb not null default '{}'::jsonb,
  completed_at timestamptz not null default now(),
  primary key (user_id, game, puzzle_date)
);

create index if not exists game_day_plays_user_completed_idx
  on public.game_day_plays (user_id, completed_at desc);

alter table public.game_day_plays enable row level security;

drop policy if exists "Users read their own game day plays" on public.game_day_plays;
create policy "Users read their own game day plays"
  on public.game_day_plays for select
  using (auth.uid() = user_id);

-- Deliberately no INSERT/UPDATE/DELETE policy. Rows arrive only through
-- game_day_submit_daily_player, which grades before it writes.

comment on table public.game_day_plays is
  'One completed puzzle per user per game per day. Written only by the SECURITY DEFINER submit functions; users can read their own rows and write none.';

-- ─────────────────────────────────────────────────────────────────────────
-- Points ledger — one cross-game total
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.game_day_points_ledger (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  game        text not null,
  puzzle_date date,
  reason      text not null,
  points      integer not null,
  created_at  timestamptz not null default now()
);

create index if not exists game_day_points_ledger_user_idx
  on public.game_day_points_ledger (user_id, created_at desc);

alter table public.game_day_points_ledger enable row level security;

drop policy if exists "Users read their own game day points" on public.game_day_points_ledger;
create policy "Users read their own game day points"
  on public.game_day_points_ledger for select
  using (auth.uid() = user_id);

comment on table public.game_day_points_ledger is
  'Append-only cross-game points. No client write path exists: every row is minted by a SECURITY DEFINER submit function after it has re-graded the play.';

-- ─────────────────────────────────────────────────────────────────────────
-- Scoring
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.game_day_score_for(
  p_outcome text,
  p_attempts integer,
  p_max_attempts integer,
  p_difficulty_band text
) returns integer
language sql
immutable
set search_path = public
as $$
  -- A loss still pays a little: showing up every day is the habit the suite
  -- is trying to build, and a zero teaches people to stop on a bad day.
  select case
    when p_outcome <> 'won' then 10
    else greatest(
      20,
      100 - (greatest(p_attempts, 1) - 1)
            * (80 / greatest(p_max_attempts - 1, 1))
    ) * case p_difficulty_band
          when 'brutal' then 2.0
          when 'hard'   then 1.5
          when 'medium' then 1.25
          else 1.0
        end
  end::integer;
$$;

comment on function public.game_day_score_for(text, integer, integer, text) is
  'Points for one completed Game Day puzzle. Pure and immutable so the value can be recomputed and audited from the play row alone.';

-- ─────────────────────────────────────────────────────────────────────────
-- Submit — the only way a play or a point comes into existence
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.game_day_submit_daily_player(
  p_puzzle_date date,
  p_guesses integer[]
) returns table (
  outcome text,
  attempts integer,
  points integer,
  total_points bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id     uuid := auth.uid();
  v_log         public.game_day_puzzle_log%rowtype;
  v_answer_id   integer;
  v_max_attempts integer;
  v_attempts    integer;
  v_outcome     text;
  v_points      integer;
  v_existing    public.game_day_plays%rowtype;
begin
  if v_user_id is null then
    raise exception 'Sign in — even anonymously — before submitting a result'
      using errcode = '28000';
  end if;

  if p_guesses is null or array_length(p_guesses, 1) is null then
    raise exception 'A submission needs at least one guess' using errcode = '22023';
  end if;

  select * into v_log
  from public.game_day_puzzle_log
  where game = 'daily_player' and puzzle_date = p_puzzle_date;

  if not found then
    raise exception 'No daily player puzzle was emitted for %', p_puzzle_date
      using errcode = 'P0002';
  end if;

  -- One submission per user per day. Returning the existing row rather than
  -- raising keeps a double-tap on a flaky mobile connection idempotent
  -- instead of showing an error for a game the player already finished.
  select * into v_existing
  from public.game_day_plays
  where user_id = v_user_id and game = 'daily_player' and puzzle_date = p_puzzle_date;

  if found then
    return query
      select v_existing.outcome, v_existing.attempts, v_existing.points,
             coalesce(sum(l.points), 0)::bigint
      from public.game_day_points_ledger l
      where l.user_id = v_user_id;
    return;
  end if;

  v_max_attempts := v_log.max_attempts;
  if array_length(p_guesses, 1) > v_max_attempts then
    raise exception 'A daily player run is at most % guesses', v_max_attempts
      using errcode = '22023';
  end if;

  v_answer_id := (v_log.answer_key ->> 'player_id')::integer;
  v_attempts := array_length(p_guesses, 1);

  -- Re-grade. The client's claim about how it did is not consulted: a run
  -- is a win only if the answer is the LAST id submitted, and only if it
  -- appears nowhere earlier (which would mean the client kept guessing
  -- after solving, i.e. a fabricated sequence).
  if p_guesses[v_attempts] = v_answer_id
     and array_position(p_guesses[1:v_attempts - 1], v_answer_id) is null then
    v_outcome := 'won';
  else
    v_outcome := 'lost';
    if array_position(p_guesses, v_answer_id) is not null then
      raise exception 'Guess sequence contradicts itself' using errcode = '22023';
    end if;
    if v_attempts < v_max_attempts then
      raise exception 'A loss means all % guesses were used', v_max_attempts
        using errcode = '22023';
    end if;
  end if;

  v_points := public.game_day_score_for(
    v_outcome, v_attempts, v_max_attempts, v_log.difficulty_band
  );

  insert into public.game_day_plays (
    user_id, game, puzzle_date, puzzle_id, outcome, attempts, points, detail
  ) values (
    v_user_id, 'daily_player', p_puzzle_date, v_log.puzzle_id,
    v_outcome, v_attempts, v_points, jsonb_build_object('guesses', p_guesses)
  );

  insert into public.game_day_points_ledger (
    user_id, game, puzzle_date, reason, points
  ) values (
    v_user_id, 'daily_player', p_puzzle_date, v_outcome, v_points
  );

  return query
    select v_outcome, v_attempts, v_points,
           coalesce(sum(l.points), 0)::bigint
    from public.game_day_points_ledger l
    where l.user_id = v_user_id;
end;
$$;

revoke all on function public.game_day_submit_daily_player(date, integer[]) from public;
grant execute on function public.game_day_submit_daily_player(date, integer[]) to authenticated;

comment on function public.game_day_submit_daily_player(date, integer[]) is
  'Grades a submitted guess sequence against game_day_puzzle_log and writes the play plus its ledger row. The client never asserts its own result. Idempotent per user per day.';

-- ─────────────────────────────────────────────────────────────────────────
-- The default theme — neutral Citrus, readable by a public build
-- ─────────────────────────────────────────────────────────────────────────
--
-- Palette values are the shipped design tokens from docs/DESIGN_DIRECTION.md
-- (page #0F1F15, card #1A2A20, cream #FFF8F0, sage #84A57D, laser #FF6B1A,
-- and the one legal on-orange #581E00).

insert into public.game_day_themes (
  key, label, is_default, requires_feature_flag, palette, brand, copy, prize_rules
) values (
  'citrus',
  'Citrus',
  true,
  false,
  jsonb_build_object(
    'surface',      '#0F1F15',
    'surfaceTile',  '#1A2A20',
    'text',         '#FFF8F0',
    'textMuted',    'rgba(255,248,240,0.55)',
    'accent',       '#FF6B1A',
    'accentSoft',   '#FF9F66',
    'onAccent',     '#581E00',
    'success',      '#84A57D',
    'successSoft',  '#C8DCC4',
    'near',         '#FFB591',
    'border',       'rgba(255,255,255,0.08)'
  ),
  jsonb_build_object(
    'wordmark',   'Citrus Game Day',
    'logo_url',   null,
    'mascot_url', null
  ),
  jsonb_build_object(
    'shared', jsonb_build_object(
      'suite_title', 'Game Day',
      'suite_tagline', 'A new one every morning.'
    ),
    'daily_player', jsonb_build_object(
      'title', 'Daily Player',
      'tagline', 'Six guesses. One skater.',
      'win', 'Got him.',
      'loss', 'Tomorrow, then.'
    )
  ),
  jsonb_build_object(
    'enabled', false,
    'claim_threshold', 0,
    'terms_url', null
  )
)
on conflict (key) do nothing;

commit;
