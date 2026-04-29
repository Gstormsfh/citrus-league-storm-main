# Staging environment runbook

End-to-end operator guide for bringing up Citrus on the staging Supabase, then
running through the full Citrus 2.0 review (sign up → create league → draft →
set lineup → walk every migrated page).

## What you'll have when you're done

- Staging Supabase populated with all reference data (NHL teams, schedule, the
  full player directory + projections + season stats)
- A real account on staging with at least one real league you control
- A league you can navigate end-to-end in a browser to validate every Citrus 2.0
  migrated page against real data — no demo-mode fallbacks, no prod risk

Total time: **~10 min of script execution + 15 min of click-through testing.**

---

## Prerequisites

1. `.env.staging` in the repo root with at least:
   ```
   VITE_SUPABASE_URL=https://YOUR-STAGING-PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR-STAGING-ANON-KEY
   ```
2. Staging Supabase service role JWT exported in your shell:
   ```powershell
   $env:STAGING_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIs..."
   ```
   Get the key from the staging project dashboard:
   `https://supabase.com/dashboard/project/<staging-project-ref>/settings/api-keys`
3. The repo's untracked SQL dumps must exist at the repo root (these are not
   checked in — they're produced by `pg_dump --inserts` against prod):
   - `prod_data_inserts_clean.sql` (nhl_teams + nhl_games + players)
   - `chunk_player_directory.sql`, `chunk_player_season_stats.sql`,
     `chunk_player_projected_stats.sql`, `chunk_player_ros_projections.sql`,
     `chunk_player_talent_metrics.sql`, `chunk_goalie_gsax_primary.sql`

   If these are missing, regenerate them from prod with `pg_dump`. They contain
   read-only reference data only — never league/team/draft/user data.

---

## Step 1 — Mark prod migrations as applied (one-time)

Marks all prod migration timestamps as already applied on staging so
`supabase db push` works cleanly for any *new* migrations after this point.

**SQL Editor (easiest):**
1. Open `https://supabase.com/dashboard/project/<staging-project-ref>/sql/new`
2. Paste the entire contents of `01-mark-migrations-applied.sql`
3. Click **Run**

Verify:
```sql
SELECT COUNT(*) FROM supabase_migrations.schema_migrations;
-- Expected: 276 (or whatever the count is in 01-mark-migrations-applied.sql)
```

Idempotent — safe to re-run.

## Step 2 — GCP + GitHub secrets (one-time)

See `02-create-gcp-secrets.md` and `03-setup-ci-secrets.md`. Only required for
auto-deploy via the staging-deploy workflow. If you're just running web locally
against staging Supabase, you can skip steps 2 and 3.

## Step 3 — Load player stats reference data

```bash
node scripts/staging/04-load-stats-data.mjs
```

This batch-inserts all six `chunk_*.sql` files via PostgREST:
- `player_directory` (~800 rows — players, positions, headshots metadata)
- `player_season_stats` (~700 rows — current-season totals)
- `player_projected_stats` (~800 rows — projection model outputs; **largest, ~97 MB SQL**)
- `player_ros_projections` (~700 rows — rest-of-season totals)
- `player_talent_metrics` (~700 rows — advanced metrics)
- `goalie_gsax_primary` (~50 rows — goalie expected goals saved above expected)

Run time on a good connection: 3-8 minutes (the projection chunk dominates).

> ⚠️ This loader uses plain POST without `on_conflict`. Re-running it on a
> populated staging will 409. If you need to re-run, TRUNCATE the affected
> tables first in the Supabase SQL Editor.

## Step 4 — Load NHL teams + schedule reference data

```bash
node scripts/staging/05-load-reference-data.mjs
```

Loads from `prod_data_inserts_clean.sql`:
- `nhl_teams` (32 rows — team_id, name, abbreviation, city)
- `nhl_games` (~1,300 rows — current-season schedule, scores, B2B markers)

> ✅ This loader uses PostgREST upsert (`Prefer: resolution=merge-duplicates`)
> on each table's primary key. Idempotent — safe to re-run.

To load just one of the two tables:
```bash
node scripts/staging/05-load-reference-data.mjs nhl_teams
node scripts/staging/05-load-reference-data.mjs nhl_games
```

## Step 5 — Verify staging is ready

```bash
node scripts/staging/06-verify-staging-ready.mjs
```

Hits each of the 8 reference tables, reports row counts, fails loudly with
`fix:` and `blocks:` hints if anything is below the expected minimum. Read-only —
does not touch any league/team/draft/user data.

Expected output on success:
```
  ✓  nhl_teams                          32 rows
  ✓  nhl_games                        1336 rows
  ✓  player_directory                   805 rows
  ✓  player_season_stats                732 rows
  ✓  player_projected_stats             805 rows
  ✓  player_ros_projections             732 rows
  ✓  player_talent_metrics              732 rows
  ✓  goalie_gsax_primary                 47 rows

✓  All 8 reference tables look healthy.
```

If anything fails, the script prints the exact loader command to fix it.

---

## Step 6 — Run the app against staging

Two options. Pick one.

**A. Local dev pointed at staging Supabase (fastest iteration):**
```bash
cd apps/web
cp ../../.env.staging .env
npm run dev    # web on :8080
```
In a second terminal:
```bash
cd server
npm run dev    # API on :3001
```
Open `http://localhost:8080`.

**B. Deployed staging (proves the deploy pipeline works too):**
Push the branch and let `.github/workflows/staging-deploy.yml` build + deploy.
Open `https://<staging-firebase-host>` after deploy completes.

---

## Step 7 — End-to-end click-through

Sign up with a fresh email (any address — staging auth is isolated from prod).
Firebase auth auto-creates a `profiles` row on first login.

### A. Create a league

1. Navigate to `/create-league`.
2. Fill in: name, scoring (default Citrus settings), team count (12),
   draft type (snake works fastest for E2E), draft date (any).
3. Submit. The frontend calls `POST /api/leagues` which writes a `leagues` row
   plus auto-creates your commissioner `teams` row.
4. You should be redirected to `/league/<your-league-id>` (LeagueDashboard).
   **Citrus 2.0 check #1**: Stormy "League pulse" in the rail; dark forest bg;
   pastel-orange initials avatar in the team header.

### B. Invite + join (optional, for matchup testing)

If you want a real matchup, use a second browser/incognito to create another
account, then accept the invite from the first account. With only your team,
matchups will pair you against an empty bench but the visuals still work.

### C. Start the draft + make picks

1. As commissioner, navigate to `/draft-room`.
2. Click **Start Draft** — calls `POST /api/draft/league/:leagueId/start`
   (route confirmed at `server/src/routes/draft.ts:211`).
3. Make your first 3 picks from the player pool.
   **Citrus 2.0 check #2**: dark Tabs row, pastel-orange "Pick On The Clock"
   highlight cards, mascot-led mobile rail tile.
4. (Snake draft: each pick auto-rotates to next team. With one team, you'll
   pick all rounds yourself, which is fine for visual testing.)

### D. Set a lineup

1. Navigate to `/roster` or click your team avatar.
2. Drag a player from bench to a starter slot. Auto-saves to `team_lineups`.
3. Click **Auto Lineup** to test the projection-based path.
   **Citrus 2.0 check #3**: dark Team Header card, pastel-orange Auto Lineup
   button, "Team pulse" rail tile with real W-L from your league.

### E. Walk every Citrus 2.0 page

| URL | What to confirm |
|---|---|
| `/league/<id>` | LeagueDashboard — Stormy rail tile, pastel-orange Your Squad card |
| `/league/<id>/playoffs` | PlayoffBracket — Stormy "Cup chase" tile, championship CardHeader fixed |
| `/roster` | Roster — dark Team Header, dark Tabs, "Team pulse" + "Lineup tips" rail |
| `/matchup` | Matchup — dark scoreboard, no cream-yellow blur orbs |
| `/draft-room` | DraftRoom — dark sticky header, "Pick On The Clock" pastel-orange |
| `/free-agents` | FreeAgents — Stormy "Pickup priority" rail tile |
| `/waiver-wire` | WaiverWire — **bespoke Kiwi-FAAB pose** in FAAB Budget card (FAAB leagues only) |
| `/schedule-manager` | ScheduleManager — Pineapple icon on Back-to-Back Watch |
| `/team-analytics` | TeamAnalytics — Lemon "Tape doesn't lie" tile |
| `/gm-office` | GMOffice — Stormy chat tile preview |
| `/standings` | Standings — "Standings legend" rail tile |
| `/trade-analyzer` | TradeAnalyzer — "Trade tips" rail tile |
| `/team/<other-team-id>` | OtherTeam — "Scouting tips" rail tile |
| `/admin` | Admin — text-white/55 muted text on dark cards |

---

## Troubleshooting

| Symptom | Likely fix |
|---|---|
| `node 04-load-stats-data.mjs` 409s | Tables already populated — TRUNCATE in SQL Editor or skip |
| `node 05-load-reference-data.mjs` 401 | `STAGING_SERVICE_ROLE_KEY` not set in shell |
| `node 06-verify…` fails on `player_*` | Run step 3 |
| `node 06-verify…` fails on `nhl_*` | Run step 4 |
| Roster page renders empty after league creation | Run step 3 — players don't load without `player_directory` |
| ScheduleManager shows "No games loaded yet" | Run step 4 — `nhl_games` is empty |
| Matchup page errors on `home_team_id` | Same — `nhl_games` empty |
| Draft start fails 403 | You're not the league commissioner — only commissioner can start |
| `/create-league` 500s | Check server logs: most likely missing `nhl_teams` (FK lookup) — run step 4 |

## Re-running

All loaders + the verify script are idempotent (with the caveat noted in step 3
about `04-load-stats-data.mjs` and the `on_conflict` decision). Safe to re-run
on a fresh staging project, or after a TRUNCATE if you need to reset.

## What this runbook does NOT cover

- Auto-deploy via `staging-deploy.yml` (see workflow file directly)
- GCP + GitHub secrets bootstrap (see `02-create-gcp-secrets.md`,
  `03-setup-ci-secrets.md`)
- Production environment — never run any of these scripts against prod. They
  upsert reference data which is already correct on prod, but the scripts have
  no production guard. Operator must read `.env.staging` carefully.
