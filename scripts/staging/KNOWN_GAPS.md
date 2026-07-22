# Staging — Known Gaps Ledger

## Purpose

This is the running human-triaged record of every schema, data, or behavior
gap discovered between the **staging** Supabase project (`jjgspcpvqaiitloglxbb`)
and **production**. Each entry captures the discovery context, the source
migrations involved, an explanation for why staging diverged, the
resolution path (or rationale for accepting the divergence), and the
follow-up trail. Entries land here when a real bootstrap-time silent skip
or operational drift is identified — not for routine work-in-progress.

The ledger is a forensic + decision record, not a change log. Use commit
history for the *what*; use this file for the *why*, the *how we know
it's safe*, and the *what we should still revisit*.

## How to use this file

- **Discovery**: `scripts/staging/audit-cross-schema-ddl.mjs` is the
  programmatic auditor. Re-run it whenever a meaningful batch of
  migrations lands or a new staging-vs-prod incident surfaces; the
  output is a JSON report you can diff against prior runs.
- **Triage**: this file is the human-readable companion. The auditor
  finds raw matches; this file records which matches were real, which
  were dismissed, what was patched, and what was deliberately left
  alone. Every audit run that surfaces a new finding should produce
  one entry here with a date.
- **Sections**:
  - **Active findings** — open items that need action but haven't been
    fixed yet. Empty when staging is in sync.
  - **Resolved findings** — patched gaps, kept for institutional
    memory so a future operator doesn't repeat the diagnosis.
  - **Accepted divergences** — known differences that are NOT being
    fixed, with rationale and any conditional re-evaluation triggers.
  - **Followup tickets** — work that was scoped out of the immediate
    fix but tracked here so it doesn't get lost.

## Active findings

### 2026-04-29 — playoff series/bracket tables empty on staging

- **Discovery**: created a Stanley Cup Bracket league via `/create-league`
  on staging, but the bracket UI showed zero series available to pick.
  Diagnosed via read-only Supabase queries — `nhl_games` has 24 rows
  with `game_type='playoff'` and `playoff_round IS NOT NULL`, but
  every one has `series_id IS NULL`. Bracket UI almost certainly
  renders by joining `nhl_games` against a `playoff_series` table on
  `series_id`, so an empty join target = nothing to display.
- **Scope of empty tables** — 9 of 10 playoff-related tables are empty:
    nhl_playoff_seeds       0
    nhl_playoff_series      0
    player_playoff_stats    0
    playoff_bracket_picks   0
    playoff_brackets        0
    playoff_confidence_picks 0
    playoff_pool_standings  0
    playoff_seeds           0
    playoff_series          0
  Only `playoff_roster_picks` has data (2 rows, from manual testing).
- **Notable: dual-table pattern** — there are TWO `*series` tables
  (`nhl_playoff_series` 16 cols vs `playoff_series` 22 cols) and TWO
  `*seeds` tables (`nhl_playoff_seeds` 13 cols vs `playoff_seeds` 10
  cols). Likely the `nhl_*` tables hold upstream-canonical NHL data
  (series identity, seeding) while the unprefixed tables hold league/
  user-side state (per-league bracket structure, picks-against-series).
  Worth confirming the FK direction on each before writing any loader.
  This naming is brittle — consider documenting it (or renaming one
  side) post-Web-Summit.
- **Why staging missed it** — the `prod_data_inserts_clean.sql` dump
  used by `05-load-reference-data.mjs` only contains `nhl_teams` and
  `nhl_games` rows (and a deprecated `players` table). It was generated
  before playoffs started in prod, OR it was scoped to skip playoff
  tables at dump time. Either way, none of the playoff-series tables
  were ever populated in staging.
- **Suggested resolution path (post-Web-Summit / TBD)**:
  1. Generate a fresh dump from prod that includes the nine empty
     playoff tables — focus on `nhl_playoff_series` and `nhl_playoff_seeds`
     as the canonical upstream tables; the remaining tables populate
     organically as users interact with the pool features.
  2. Add a new loader script `scripts/staging/08-load-playoff-data.mjs`
     using the same PostgREST upsert pattern as `05-load-reference-data.mjs`.
  3. Extend `06-verify-staging-ready.mjs` to add row-count thresholds
     for `nhl_playoff_series` and `nhl_playoff_seeds`.
  4. Re-test the bracket / confidence pool / roster pool flows on
     staging end-to-end.
- **Status**: not blocking Phase 1 frontend primitive fixes (those
  don't depend on playoff data). Blocks any further QA of the playoff
  pool flows themselves.

## Resolved findings

### 2026-04-29 — handle_new_user trigger missing on auth.users

- **Discovery**: 400 on `POST /api/leagues` with FK violation
  `leagues_commissioner_id_fkey`. Root caused to a missing
  `on_auth_user_created` trigger that should auto-create
  `public.profiles` rows on signup. Without it, a row in `auth.users`
  has no companion row in `public.profiles`, so any FK pointing at
  `profiles` (e.g. `leagues.commissioner_id`) blows up with `23503`
  for newly-signed-up users.
- **Source migrations**:
  - `supabase/migrations/20250101000000_create_profiles_table.sql`
    (original function + trigger)
  - `supabase/migrations/20260331000000_fix_handle_new_user_search_path.sql`
    (latest hardened function form)
- **Why staging missed it**: the staging bootstrap script
  (`01-mark-migrations-applied.sql`) marks all 276 prod migrations as
  applied in `supabase_migrations.schema_migrations`, under the
  assumption that a prod schema dump was applied to staging
  beforehand. Schema dumps don't reliably capture cross-schema DDL —
  DDL that lives in `public` but targets the managed `auth` schema.
  The metadata claims this migration ran, but the actual trigger DDL
  was silently lost during the dump → apply step. The trigger never
  landed on staging.
- **Resolution**: applied `07-fix-missing-auth-trigger.sql`
  (idempotent: `CREATE OR REPLACE FUNCTION` for the latest hardened
  body + `DROP TRIGGER IF EXISTS` / `CREATE TRIGGER` for the
  binding). Verified via `pg_trigger` query — one row returned with
  `tgenabled='O'`. Backfilled four existing `public.profiles` rows
  for users that signed up before the trigger existed
  (`c4489220-de65-44c5-8236-677916f6d09c` plus three others).
  Verified end-to-end: signup → create-league now works.
- **Audit follow-up**: ran `audit-cross-schema-ddl.mjs` to find any
  cousins. Result: **7 total findings, 1 fixed (this trigger),
  4 verified already-installed extensions (`pg_cron`, `pg_net`,
  `pgmq`, `pg_stat_statements`), 2 dismissed as false positives
  (runtime `DELETE FROM auth.users` inside `SECURITY DEFINER`
  function bodies — those are runtime queries, not deploy-time
  cross-schema DDL; the function definitions themselves live in
  `public` and survive a schema dump).**

## Accepted divergences

### 2026-04-29 — pg_cron installed in pg_catalog instead of extensions schema

- **Migration says**: `CREATE EXTENSION pg_cron WITH SCHEMA extensions`
  (in `supabase/migrations/20260208400000_supabase_pro_upgrade.sql:32`).
- **Staging has**: `pg_cron` registered in `pg_catalog` (verified via
  `SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON
  e.extnamespace = n.oid WHERE e.extname = 'pg_cron'`).
- **Why accepted**: Supabase Pro pre-installs `pg_cron` at the
  platform level. The `WITH SCHEMA extensions` directive in our
  migration is effectively a no-op when the platform has already
  installed the extension elsewhere. The *callable surface* —
  `cron.schedule`, `cron.unschedule`, `cron.job`, etc. — lives in a
  dedicated `cron` schema regardless of where `pg_extension` itself
  records the extension's home. App code that calls
  `cron.schedule(...)` works identically in either layout.
  `ALTER EXTENSION pg_cron SET SCHEMA extensions` typically requires
  elevated permissions Supabase doesn't grant the `postgres` role
  and risks destabilizing managed cron jobs with zero functional
  benefit.
- **Likely also true in prod** — both projects are Supabase Pro
  with the same managed default. Worth re-verifying next time we
  have read access to a prod schema dump or `pg_extension` query.
  If prod ever lands `pg_cron` in `extensions`, revisit this
  decision.

## Followup tickets (post-Web-Summit)

### Bootstrap script silent-skip antipattern

`01-mark-migrations-applied.sql` and `04-load-stats-data.mjs` both share
a pattern of completing successfully when they have actually skipped
real work — the migration-marker assumes a prior dump+apply that may
have dropped DDL, and the stats loader uses plain POST without
`on_conflict` (re-runs 409 silently per-batch instead of upserting).
This is the structural cause of tonight's incident.

Two paths to consider:

- **Path 3 hybrid**: replace the schema-dump + mark-applied bootstrap
  with `supabase db push --include-all` from the migrations tree
  itself, with idempotent migrations. Replays the actual DDL each
  time, eliminating the silent-skip class entirely. Cost: requires
  every migration to be safely re-runnable, which tonight's audit
  suggests they roughly are but not formally guaranteed.
- **Minimum viable fix**: add fail-loud guards to the existing
  scripts. `01-mark-migrations-applied.sql` should refuse to run if
  any expected cross-schema object (e.g., `on_auth_user_created` on
  `auth.users`) is absent; `04-load-stats-data.mjs` should switch
  to PostgREST upsert (the same pattern `05-load-reference-data.mjs`
  uses) so re-runs are no-ops instead of failures.

Either path is post-Web-Summit work. Decision can wait.

### Audit cousins on prod

`audit-cross-schema-ddl.mjs` runs against the *git tree*, not the
running database, so its findings apply equally to whatever was
deployed against prod. Today's audit confirmed prod is fine for the
specific items tonight surfaced (because prod ran the migrations
historically, not via dump + mark-applied). Re-run the audit after
any major migration batch lands so we don't accumulate a similar
surprise on the prod side that gets exposed during a future restore.

### Add `chunk_*.sql` files to `.gitignore`

The seven `chunk_*.sql` files in the repo root are currently
untracked but not git-ignored. They sum to roughly 98 MB of
prod-data dumps. A future operator could `git add .` and accidentally
commit them. Add the pattern to `.gitignore` to make that footgun
impossible.

### Pipeline scripts in scripts/utilities/ have no automation — silent staleness pattern

Discovered 2026-05-04 during Phase 0 data audit for the player
dashboards project: the scripts that populate the analytical layer
(goalie_gar, goalie_gsax, goalie_rebound_control, player_directory,
player_gar_components, player_talent_metrics, league_averages,
player_weekly_stats) live in `scripts/utilities/` — completely
outside the documented `data-pipeline/` directory and with **zero
automation pointing at them**. No GitHub workflow, no cron, no
orchestrator script, no Makefile.

Staleness as of audit:
- `goalie_gar`: 5 months stale (last update 2025-12-18)
- `goalie_gsax`: 4 months stale (last update 2026-01-04)
- `player_directory`: 17 days stale (last update 2026-04-17)
- `player_ros_projections`: 15 days stale (last update 2026-04-19)
- `player_projected_stats`: 7 days stale (last update 2026-04-27)

The schema exists, the data is real, the scripts work — but no one
runs them, and there's no alerting when they go stale. This is the
**5th silent-failure pattern** found in the last 60 days, joining:
1. Cron `continue-on-error: true` masking 14-day failures (Path C/D)
2. `sync_playoff_results.py` cascade docstring lie (Path B)
3. Migration application asymmetry (May 1 propagation trigger)
4. stormy-chat edge function legacy bundle BOOT_ERROR (May 2)
5. **This one** — scripts/utilities orphan automation gap

Common shape across all 5: *a system that supposedly does X has
stopped doing X, with no alert, for an unknown duration.*

**Followup work** (deferred to post-Web-Summit):
- Add a nightly GitHub workflow that runs each script in dependency
  order with explicit env override for prod project ref. Wire to
  the existing `nightly_job_runs` ledger so failures surface.
- Diagnose `nightly_job_runs.completed_at < started_at` timestamp
  inversion — recorder bug, ~5-line fix.
- Diagnose `pipeline-deadman` alert path (returned `alerted: false`
  on May 2 despite reporting staleness).
- Higher-level audit: identify ANY system in the codebase whose
  output could be silently stale, document its expected freshness,
  and add monitoring. Treat as "what else might be silently
  broken?" sweep ticket. Web Summit-quality reliability requires it.

**Web Summit workaround**: For the May 11 player-dashboards launch,
re-run scripts manually one-time via a fresh `.venv-pipeline` with
pinned requirements + per-invocation env override pointing at prod
project ref `iezwazccqqrhrjupxzvf`. This is what's happening on
2026-05-04 → 2026-05-05.

### Stormy edge function on legacy CDN-fetch deployment format — boot-error vulnerability

Discovered 2026-05-02 ~04:07 MT during prod verification of the v2
ship: `stormy-chat` edge function returned BOOT_ERROR (HTTP 503) on
every invocation. Garrett reported "fails to send a request to edge
function" when trying the chat bubble on prod.

Root cause: legacy deployment format that fetched dependencies
(`https://deno.land/std@0.168.0/http/server.ts`,
`https://esm.sh/@supabase/supabase-js@2`) on every cold start. When
those CDNs respond slowly, return bad JS, or have any availability
hiccup from the Supabase edge region (us-west-2), the function's Deno
isolate fails to boot before reaching even the OPTIONS handler.

Sibling edge functions (`demo-matchup-cache`, `pipeline-deadman`)
were unaffected — both ship with `ezbr_sha256` self-contained
eszip bundles and don't touch external CDNs at cold-start. Only
`stormy-chat` (last deployed 2026-04-16, before Supabase CLI
defaulted to eszip bundling) was on the legacy format.

The bug was **latent** — Stormy was already broken before tonight's
v2 deploy. We caught it during prod verification only because Garrett
specifically tested the chat bubble. Without the verification walk,
this would have stayed silent for users until reported.

Fix: re-deployed `stormy-chat` from unchanged source via
`supabase functions deploy stormy-chat --project-ref iezwazccqqrhrjupxzvf`.
Newer Supabase CLI bundled all dependencies into self-contained
eszip (version 29, `ezbr_sha256: e4ac7946...`). OPTIONS preflight
went from `503 BOOT_ERROR` → `200 OK` immediately after.

**Followup work**:
- Audit ALL remaining edge functions for legacy CDN-fetch deployment
  format. Any function without `ezbr_sha256` set is at risk. Re-deploy
  each from current source to migrate.
- Add `stormy-chat` OPTIONS preflight to `production-deploy.yml`
  post-deploy health checks. Currently the workflow only checks
  `https://citrusfantasysports.com/` returning 200 — doesn't catch
  edge function failures. A simple `curl -X OPTIONS` against
  stormy-chat with origin header should be added.
- Consider general edge function uptime monitoring — Supabase status
  alerts, Sentry edge integration, or a periodic synthetic check.
- Monthly synthetic Stormy chat as a canary (real POST with auth
  token, expecting valid response). Catches the NEXT class of failure
  beyond bootability (rate limits, Anthropic outages, schema drift on
  `stormy_chat_log` table).
- Pattern recognition: this is the third silent-failure pattern
  surfaced in the Citrus stack in the last 60 days (cron continue-on-
  error, sync_playoff_results docstring lie, edge-function legacy
  bundle). All share the same shape: a system that supposedly does X
  has been failing to do X for an unknown duration without alerting.
  Worth a higher-level audit pass for "what other things might be
  silently broken?" — Web Summit-quality reliability requires it.

### Migration application asymmetry — verify ALL targeted environments after apply

On 2026-05-01 the playoff winner propagation trigger migration
(`20260501120000_add_playoff_winner_propagation_trigger`) was applied
to staging via Supabase MCP but the corresponding prod application
either failed silently or was never attempted, despite the commit
message of `ee6f441` claiming both environments were updated.

The asymmetry was not detected for ~14 hours. During that window,
prod's R2 series rows had `high_seed_team_id` and `low_seed_team_id`
NULL despite seven R1 finals having known winners (slots 1, 3, 4, 5,
6, 7, 8 — including VGK in slot 7 which Garrett mentally noted as
"propagated correctly" but was actually NULL on prod). All 9 prod
bracket-pickem leagues + confidence pools + the public
`/nhl/playoffs` page rendered R2 with blank/TBD teams during this
window.

Discovered during 2026-05-02 pre-ship rollback runbook prep when
sanity-checking trigger presence on prod (`SELECT COUNT(*) FROM
pg_trigger WHERE tgname = 'trg_propagate_playoff_winner'` returned 0).
Trigger was applied via MCP at apply time and immediately propagated
all 7 R1 winners into their R2 children via the migration's idempotent
backfill UPDATEs (lines 73-89).

**Lesson**: when applying migrations via MCP across multiple
environments, verify each environment independently afterward with at
least three checks:
1. `information_schema.triggers` (or routines / tables / etc.)
   contains the new object on every targeted env
2. `supabase_migrations.schema_migrations` has the version row on
   every targeted env
3. A behavioral query confirms the migration actually did its job
   (e.g., did the backfill UPDATE do anything; does the trigger fire
   when expected)

Do not trust silent success. The act of running `apply_migration`
returns `{success: true}` without confirming the destination was the
project you intended.

**Followup work**:
- Build a small CLI helper `scripts/verify-migration-applied.mjs
  <project-ref> <migration-name>` that runs the three checks above
  and exits non-zero on any failure. Standardize across staging-deploy
  and production-deploy operator runbooks. Queue post-Web-Summit.
- Add a "after every multi-env MCP apply, run verify on each env"
  reminder to OPERATIONS.md.
- Note the version-stamp drift: the file `20260501120000_add_playoff_winner_propagation_trigger.sql`
  was logged in prod's `schema_migrations` as version `20260502080320`
  (apply timestamp) instead of the file's filename version. This is
  cosmetic but means future env bootstraps that compare versions
  between filesystem and DB will see false-mismatch on prod
  specifically. Either rename the file post-fact (destructive on
  staging where the original version is logged) or accept the
  divergence with a note. **Accepting the divergence** — the migration
  name matches; only the version stamp differs.

### Layout debt — rail widths declared per-page across 17 consumers

Tonight's rail-widening change required touching **14 files** for a single
visual decision (right rail 260→280 lg / 280→340 xl). The grid template
column declarations are duplicated as literal strings across consumer
pages: 11 share an identical `lg:grid-cols-[200px_1fr_260px]
xl:grid-cols-[220px_1fr_280px]`, plus 3 unique variants (PlayoffBracket,
Roster, DraftRoom).

Right architectural fix: extract a shared layout component, e.g.

```tsx
<ThreeColumnPage
  leftRail={<TeamIntel />}
  rightRail={<LeagueNotifications leagueId={...} />}
>
  {mainContent}
</ThreeColumnPage>
```

…with a single `tailwind.config.ts` token for rail widths (e.g.
`width.left-rail` and `width.right-rail`) so future tweaks are
one-line changes. Or at minimum a CSS variable on `<html>` driving the
grid template via `[--right-rail-w:280px] xl:[--right-rail-w:340px]`
combined with a custom `lg:grid-cols-[...var(--right-rail-w)...]`
arbitrary value.

Lower priority than current visual fixes; queue for after Phase 1
settles. The width-change commit (the worked example) is a useful
reference point for why this matters — every future rail width tweak
costs 14+ file edits and a sed-with-scope-leak risk like the one
caught tonight (PoolPlayoffRoster.tsx had a coincidentally-matching
grid pattern that sed touched until I noticed it didn't mount
LeagueNotifications).

Also worth noting: a second sub-bug surfaced — sed pattern matching is
substring-based, so any page using a similar grid template for an
unrelated layout gets caught up. A shared layout component eliminates
that hazard entirely.

### Generalized double-opacity Tailwind class sweep

The earlier sweep (commit `ac3cc2e`) targeted only two specific
prefix patterns: `text-white/X/Y` and `border-pastel-sage/X/Y`. While
restyling `apps/web/src/components/StormyChatBubble.tsx` for v2 dark
mode, a third variant of the same bug class surfaced:
`backdrop-blur-sm/50` (lines 293 and 351 — `backdrop-blur-sm` is a
valid Tailwind utility but `/50` is a stale opacity-modifier suffix
that Tailwind doesn't accept on backdrop filters; the entire class
is silently dropped).

The bug shape is "any Tailwind class with a `/[0-9]+/[0-9]+` pattern
in it" — could include other prefixes we haven't seen (e.g.,
`bg-pastel-orange/X/Y`, `ring-pastel-sage/X/Y`, future variants). The
right next sweep is a *generalized* regex match: `(\w+(?:-[a-z-]+)*)/[0-9]+/[0-9]+`
across `apps/web/src/**/*.{tsx,ts}` to catch every variant.

Lower priority than current visual fixes — we'll catch the surfaced
instances inline as we restyle each component. Queue the generalized
sweep for after Phase 1 component fixes settle.

### v1 marketing pages may show dark stripes below content on tall viewports

The 2026-05-02 Option E fix changed html/body bg in index.css from
cream (`#D4E8B8`) to dark (`#0F1F15`) to eliminate the boot-flash.
Marketing pages (Index, About, Pricing, Careers) compose their
content from cream-bg sections (HeroSection, FeaturesSection,
Footer) that fill the viewport, so the body bg rarely shows. Edge
cases: very short content pages (NotFound, Privacy, Terms with
limited content) on tall viewports may show a dark stripe at the
bottom. Fix when each page gets its v2 migration: add
`bg-[#D4E8B8] min-h-screen` wrapper or migrate the page to v2 dark.
Currently no user-accessible v1 marketing pages are demo-critical
for Web Summit (playoff suite is the demo target), so deferring
until post-Web-Summit migration.

### Team brand colors with poor dark-theme contrast — selective secondary-color fallback

6 NHL teams (CAR, OTT, SJS, WPG, FLA, MIN) have both primary AND
secondary brand colors that fail WCAG AA (3:1) contrast against the
v2 pastel-surface bg. The 2026-05-02 universal `ring-white/20` fix
raises all chip edge perception ~10% but doesn't fully solve these 6
specific teams. Post-Web-Summit option: implement a tier-2 fallback
that uses a custom v2 chip color (e.g., team-color-tinted-with-cream-
overlay or pastel-cream backdrop tile) ONLY for these 6 teams. Don't
pre-emptively add complexity — apply only if visual feedback during
Web Summit demos suggests these specific teams read as broken.

### PoolPlayoff* pages skip DarkLayout while other pool pages use it

PoolSurvivor, PoolPickem, PoolConfidence (non-playoff), and
NHLPlayoffBracket all wrap their pages in `<DarkLayout>`. The 4
PoolPlayoff* pages (Bracket, Confidence, Hub, Roster) use a bare
`<>` fragment with `<Navbar />` + a manually-styled wrapper div
instead. The loading-state bg fix (2026-05-02) added
`bg-pastel-surface` to the manual wrapper to match what DarkLayout
would have provided. Architectural consistency cleanup
post-Web-Summit: refactor the 4 PoolPlayoff* pages to use
DarkLayout, removing the manual wrapper duplication.

### Save button color consolidation across playoff pool family

PoolPlayoffBracket and PoolPlayoffRoster currently use sage save
buttons (matching v1 "sage = positive action" semantics). The global
v2 system treats orange as the primary action color (StormyChatBubble
send, CTAs across homepage). Sage is also used semantically for
"correct outcome" on bracket cards post-deadline, creating
overloading. Decision deferred — should be a single scoped change
across PoolPlayoffBracket, PoolPlayoffConfidence, PoolPlayoffRoster
save buttons together, not piecemeal. Queue post-Web-Summit.

### LoadingScreen.tsx legacy mascot PNGs — assets deletable post-fix

The 4 Gemini-generated mascot PNGs (`Gemini_Generated_Image_Kiwi.png`,
`_Lemon.png`, `_Narwhal.png`, `_Pineapple.png`) under
`apps/web/src/assets/images/` became dead assets after the 2026-05-02
LoadingScreen redesign (Option A — CSS spinner instead of mascot
rotation). Confirmed only LoadingScreen.tsx imported them. Safe to
delete in a separate cleanup pass post-Web-Summit.

### Shared <TeamPickButton> component — dedup PoolPlayoffBracket and PoolPlayoffConfidence team rows

The team-row JSX (~50 lines) is duplicated inline between
`PoolPlayoffBracket.tsx` and `PoolPlayoffConfidence.tsx`. The
2026-05-01 contrast fix had to apply the same set of changes to
both. A shared `<TeamPickButton>` component would eliminate the
drift risk. Out of scope for the contrast fix; queue post-Web-Summit.

### Commissioner deadline UX — warn on late deadlines

With deadline-only locking (Phase 1F-bis: full-bracket pre-deadline =
nothing locked), commissioners can technically set a lock deadline
after some R1 series have already finalized — which means users
picking late see actual outcomes when making picks. This isn't
enforced as wrong (industry standard treats deadline as
authoritative), but the create-league flow should warn commissioners
when their proposed deadline is later than any of the R1 series
start times in `nhl_playoff_series`. Suggested copy:

  "Heads up: 3 series have already started by your selected
  deadline. Picks for those series will be made with full
  information. This is allowed but unusual. Continue?"

Soft warning, not a hard block. Lower priority; queue for after
Phase 1 visual rollout.

### Finalized series cards — visual disambiguation

When a series is final and the user has not made a pick, the card
currently shows the actual NHL winner with team-color emphasis (the
same visual as "my pick is X"). Result: users assume they picked
when they didn't. Need a clear "Your pick:" indicator separate from
the displayed winner. Surface during the broader bracket visual
sweep (the team-row contrast diagnostic from 2026-05-01). Not
blocking the deadline-only spec change.

### Path C — playoff-sync cron silently broken since April 17

`nhl_pipeline_meta.last_refresh` for `playoff_series` and
`playoff_seeds` keys = `2026-04-17 13:51:07+00` on prod, ~14 days
stale at the time of the 2026-05-01 propagation-trigger work.
`sync_playoff_results.py` (Step 3 in `.github/workflows/playoff-sync.yml`)
hasn't successfully completed since R1 began.

The workflow's `continue-on-error: true` on Step 3 means failures
don't surface anywhere — no Slack alert, no GitHub email, nothing.
The only telemetry is the freshness timestamp, which we never
check in monitoring. Failures during the most active part of the
playoffs accumulated for two weeks before being noticed (only
because the propagation trigger work surfaced the staleness).

Need:
- Workflow-level monitoring: Slack alert on `playoff_series`
  freshness > 24h, OR a CI-level freshness check that fails the
  build if data is stale during expected playoff window.
- Remove or scope the `continue-on-error` after the explicit Step
  3 failure mode is understood. Right now we don't even know what
  the cron is failing on — could be NHL API change, Supabase auth
  expiry, network, anything.

CRITICAL pre-Web-Summit infrastructure debt — same root-cause
class as the propagation bug itself (silent failure of automated
pipelines we depend on). The trigger we shipped on 2026-05-01
keeps the data correct regardless of cron state, but the cron
still needs to be fixed for everything else it does (game→series
linking, win counts, pick scoring RPCs).

### Path B — sync_playoff_results.py cascade logic doesn't actually cascade

The script's docstring (line 8-9) claims:
"4. Cascade winners into next-round series (R1 winners populate R2)"

The implementation at `sync_series_state_from_bracket()` lines
132-138 only populates `high_seed_team_id` / `low_seed_team_id`
from the NHL bracket API response (`s.get('topSeedTeam')`,
`s.get('bottomSeedTeam')`). There is no code that says "for each
newly-finalized series, find the child via parent_slot_a/b and
write winner_team_id into the appropriate seed slot."

Now that the DB trigger handles cascade reliably (migration
20260501120000_add_playoff_winner_propagation_trigger.sql), this
script needs to be rewritten OR have its docstring corrected to
remove the false claim. Lower priority since the trigger is the
source-of-truth. But the gap between docstring and reality is
exactly the kind of dead-reckoning that breeds 14-day silent
failures (see Path C above).

### Path D — audit all GitHub Actions workflows for `continue-on-error: true`

Each `continue-on-error: true` flag is a potential silent-failure
hiding spot. Today's investigation surfaced one in
`playoff-sync.yml` Step 3 that masked a 14-day cron failure;
others may be doing the same in workflows we haven't checked
(`production-deploy.yml`, `staging-deploy.yml`, `ci.yml`,
`deploy-preview.yml`, `rls-audit.yml`, `main.yml`).

Action: grep `continue-on-error: true` across `.github/workflows/`
and surface every instance. For each, either:
- Document why the failure is genuinely tolerable (and add a
  monitoring/alerting compensating control), OR
- Remove the flag so the failure surfaces loudly.

Should land before Web Summit. The 14-day cron silence pattern can
recur in any workflow with this antipattern.

### Playoff-pools route — additional locking issues to scope separately

Surfaced during the 2026-05-01 fix for full-bracket "Save failed" on
`POST /api/playoff-pools/bracket-pickem/picks` (real users in 2026
prod's "Office Hockey Pool" full-bracket leagues were hitting it
post-R1-start). The pickMode-aware lock fix landed; these adjacent
issues are NOT bundled into that fix and should be tracked:

1. `lockedSeries` query has no season filter — pulls all non-pending
   series across all seasons. Today only 2025 series exist; in
   2026+ this will over-lock cross-season. Either add a season
   filter (requires storing the league's target season explicitly,
   which `leagues.settings` doesn't currently do for bracket
   pickem) or scope `nhl_playoff_series` writes to current season
   only via the data pipeline.

2. Confidence picks route (`POST /confidence/picks`) has NO lock
   check at all. A user can "save" confidence picks against
   finalized series silently — same shape as the bracket pickem
   bug but worse (no error, just silent acceptance). Defer to a
   focused fix when confidence pools see real production traffic.

3. `GET /:leagueId/picks` doesn't filter by season either. Same
   issue as (1) — defer with the season-filter ticket.

All three are below threshold for active-incident fix but should
land before the next playoff cycle.

### Staging playoff-data freshness — manual sync required

`scripts/staging/08-copy-prod-playoff-data.sql` copies prod's
`nhl_playoff_seeds`, `nhl_playoff_series`, and `nhl_pipeline_meta` to
staging at execution time. Idempotent (DELETE-before-INSERT). Re-run
periodically during active playoffs to refresh staging data,
especially before any visual QA pass on bracket/confidence pool
pages. Long-term: a periodic Supabase function or cron job could
automate this, but manual re-run is sufficient for now.

### Phase 1E playoff-pool Card sweeps — unverifiable on staging until prod data arrives

Phase 1E (commit landed 2026-04-30) included per-callsite `bg-*` token
swaps across `PoolPlayoffBracket.tsx`, `PoolPlayoffConfidence.tsx`, and
`PoolPlayoffHub.tsx` — converting hardcoded light-theme classes
(`bg-white`, `bg-red-50/X`, `bg-green-50/X`) to v2 vocabulary
(`bg-white/5 ring-1 ring-white/10`, `bg-red-400/10 ring-red-400/30`,
`bg-pastel-sage/15 ring-pastel-sage/40`). These callsites are gated
on series data — locked / live / correct / wrong states require
populated `nhl_playoff_seeds` and `nhl_playoff_series` rows, which are
empty on staging (per the 2026-04-29 active finding).

Visual verification of these specific state transitions is therefore
deferred to production, where 2026 NHL playoff seeds populate within
days (league pick deadline shows 4d 6h at commit time). If anything
renders incorrectly once prod data arrives, hotfix from prod
observation. Risk is genuinely small — same v2 token vocabulary used
successfully across 50+ components in Phase 1A–1D. Same-shape swaps,
same surface tokens, same ring/bg semantics.

### Vite dev-server selective staleness — eject the long-running process when you smell it

Twice in the 2026-04-30 staging-setup session a long-running Vite dev
process (24h+ uptime) silently ignored a watcher event for one or
two specific recently-edited files while serving fresh source for
other files in the same edit batch. Symptoms: `curl
http://localhost:8080/src/path/to/file.tsx` returns the OLD
transformed source while the disk has the NEW source, AND
`git diff path/to/file.tsx` shows the intended changes, AND
`npm run build` (which reads disk directly, bypasses dev server)
succeeds with the new source. Browser then renders v1 styling on
pages whose imports were "missed" by Vite.

Diagnostic order:
1. `Read` the disk file — confirm new content present
2. `git diff` — confirm working tree matches intent
3. `curl http://localhost:8080/src/<path>` and grep for new tokens
   vs old tokens
4. If disk has new + curl returns old: Vite cache stale, restart

Remediation:
1. `Stop-Process -Id <pid> -Force` (the node listening on 8080)
2. `Remove-Item -Recurse -Force apps/web/node_modules/.vite,
   apps/web/dist`
3. `cd apps/web && npm run dev` (background)
4. Wait for "Local: http://localhost:8080/" stdout
5. Re-curl the affected file to confirm new tokens served

First occurrence: PID 19072 → 37632 (during GlowCard alignment work).
Second occurrence: PID 37632 → 17720 (during Phase 1E Card
tokenization). Both fully resolved by the kill+clear+restart sequence.
Suspected cause: chokidar watcher fatigue after the dev process
accumulates many file events over a multi-day uptime — the watcher
silently drops events instead of crashing. No upstream fix known;
operational guidance is "restart Vite when smelled."

If this happens a third time, consider adding a `pretest` script
that touches a sentinel file and curls it back to detect staleness
proactively, OR documenting a max-uptime convention (eject Vite at
24h regardless of symptoms).

### ArmchairGM v2 migration — strip MockDraftSimulator Card pins

When the ArmchairGM page migrates from v1 cream to v2 dark, strip the
five `// PINNED: v1 surface preserved until ArmchairGM page migrates to v2`
comments + the `bg-white/80 ring-1 ring-citrus-sage/30 border-0
shadow-varsity text-citrus-forest` overrides from
`apps/web/src/components/armchair-gm/MockDraftSimulator.tsx`. They were
added in Phase 1E (shadcn Card global tokenization) to preserve the
v1 visual on the still-v1 ArmchairGM parent page until that page is
itself migrated. Once ArmchairGM is v2, the bare `<Card>` will inherit
the v2 default surface and these explicit pins become redundant clutter.

### Visual v1 holdouts found during walkthrough 2026-04-30

- Loading screen on playoff pool pages still v1 styled (suspected
  shared loading skeleton component)
- PoolPlayoffRoster.tsx page (the user-facing roster pick UI for
  playoff-roster-pool format) still v1 styled

Both queued for next visual-fix batch after the functional triage of
issues 3 (bracket/confidence pool error rendering) and 4 (NHL Bracket
tab empty) completes.

### Staging QA tooling — admin league factory

Currently staging QA is limited to whichever league formats exist in
the database. Tonight's rail-widening for Roster/DraftRoom couldn't be
visually verified because no roster-format league exists on staging.
Right tool: a staging-only admin page (or SQL helper script) that
creates leagues across all formats (roster/H2H/dynasty/points/playoff/
survivor/pickem) on demand with parametric knobs (size, draft state,
week number, populated data). Useful for: visual QA across formats,
demoing different product surfaces (Web Summit), debugging user
reports against reproducible league shapes. Estimate: 2-4 hours of
work, scoped after Phase 1 visual rollout settles. Note: 'staging-only'
means feature-flagged or env-gated, never deployed to prod.

Deferred from 2026-04-30 staging-setup session. Decision: Web Summit
demo is playoff-format only, season-long pages won't see real traffic
until October fantasy launch, off-season prod QA window in July is
sufficient. Build admin tooling post-Web-Summit when there's room for
proper feature-flag and parametric scope.

---

*Last updated: 2026-04-30*
