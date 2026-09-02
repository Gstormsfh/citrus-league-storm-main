# Citrus Fantasy Sports — Engineering Reference

## 1. System Overview

Citrus Fantasy Sports is an NHL fantasy hockey platform featuring multiple league formats (head-to-head, best ball, pick'em, survivor, confidence pools), a live draft room, weekly matchup scoring, waiver wire, trade system, and an AI assistant ("Stormy"). The platform is powered by a proprietary expected goals (xG v3) projection model built on XGBoost with 31 features, giving it a data-driven competitive edge over other fantasy hockey products. The system ingests live NHL data via a Python pipeline with 100-IP proxy rotation, processes it through ML models, and serves projections and scores through a TypeScript API to a React SPA.

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui (Radix), React Router v6 |
| State Management | React Query (server state), Zustand (client state), React Context (auth/league) |
| API Server | Hono (TypeScript), Node.js 20, tsx runtime |
| Database | Supabase (PostgreSQL), Row Level Security on all tables |
| Auth | Supabase Auth (JWT), verified server-side via middleware |
| Data Pipeline | Python 3, XGBoost, scikit-learn, pandas, APScheduler |
| ML Models | XGBoost (xG, xA, rebound models), joblib serialization |
| Hosting | Firebase Hosting (SPA + CDN), Google Cloud Run (API server), Docker (pipeline) |
| CI/CD | GitHub Actions (4 workflows: ci, main, deploy-preview, production-deploy) |
| Edge Functions | Supabase Edge Functions (Stormy chat, demo cache, fetch-spreads) |
| Monitoring | Sentry (frontend errors), Prometheus-compatible metrics endpoint, custom health checks |
| Other | Firebase Analytics, Google AdSense, Webshare proxy rotation, PWA support |

## 3. Directory Structure

```
citrus-league-storm-main/
├── apps/web/                    # React SPA (Vite, port 8080)
│   └── src/
│       ├── api/                 # API client layer (calls Hono server)
│       ├── components/          # UI components by feature domain
│       ├── contexts/            # AuthContext, LeagueContext
│       ├── hooks/               # Custom React hooks
│       ├── integrations/        # Supabase client (auth + realtime only)
│       ├── pages/               # 41 route-level page components
│       ├── services/            # Legacy service layer (migrating to api/)
│       ├── stores/              # Zustand stores (notifications)
│       ├── types/               # TypeScript type definitions
│       └── utils/               # Pure utility functions
├── server/                      # Hono API server (Cloud Run, port 3001/8080)
│   └── src/
│       ├── routes/              # 18 route modules
│       ├── middleware/           # auth, membership, rateLimit, metrics, cache
│       ├── services/            # 17 service classes (DI pattern)
│       └── lib/                 # Supabase client factories, circuit breaker, errors
├── packages/shared/             # Shared types, constants, utilities (@citrus/shared)
│   └── src/
│       ├── types/               # League types, scoring types
│       ├── constants/           # Season, column definitions
│       └── utils/               # ScoringCalculator, timezone, logger
├── data-pipeline/               # Python data pipeline (Docker, port 8888)
│   ├── acquisition/             # NHL API data fetching (11 scripts)
│   ├── projections/             # xG model, daily/nightly projection runs
│   ├── scoring/                 # Matchup score calculation, PBP processing
│   ├── monitoring/              # Health checks, freshness, alerting
│   ├── models/                  # XGBoost .joblib model files
│   ├── utils/                   # proxy_manager, citrus_request, supabase_rest
│   └── tests/                   # Pipeline tests
├── supabase/                    # 245 migrations + 3 edge functions
│   ├── migrations/              # Timestamped SQL migration files
│   └── functions/               # stormy-chat, demo-matchup-cache, fetch-spreads
├── .github/workflows/           # CI/CD: ci, main, deploy-preview, production-deploy
├── scripts/                     # Admin SQL scripts, data import utilities
├── data/                        # Training data CSVs (shots, GAR, schedules)
├── docs/                        # Architecture docs, postmortems, runbooks
└── ops/                         # Cloud Run config, Windows service scripts
```

## 4. Data Architecture

### Core Tables

| Table | Purpose | Key Relationships |
|-------|---------|-------------------|
| `profiles` | User accounts (extends Supabase auth.users) | 1:many → teams, leagues |
| `leagues` | League configuration, settings (JSONB), scoring | commissioner_id → profiles |
| `teams` | Fantasy teams (one per user per league) | league_id → leagues, owner_id → profiles |
| `players` | NHL player roster + season stats (skaters + goalies) | Public read, pipeline-written |
| `player_projected_stats` | Daily/ROS projections from xG model | player_id → players |
| `fantasy_daily_rosters` | Daily lineup snapshots (which players started) | team_id → teams |
| `fantasy_matchup_lines` | Weekly H2H matchup pairings | league_id → leagues |
| `player_weekly_stats` | Aggregated weekly scoring stats | Used for matchup scoring |
| `draft_picks` / `draft_sessions` | Draft history and live draft state | league_id → leagues |
| `waiver_claims` | Waiver wire claims (FAAB or priority) | team_id → teams |
| `trade_offers` | Trade proposals between teams | league_id → leagues |
| `transaction_ledger` | Audit log of all roster transactions | team_id → teams |
| `raw_nhl_data` | Raw NHL API data (games, shifts, PBP) | Pipeline staging |
| `projection_cache` | Cached projection results with versioning | player_id → players |
| `player_talent_metrics` | Shooting talent, xG rates per player | player_id → players |
| `goalie_gsax` / `goalie_gar` | Goalie advanced metrics | player_id → players |
| `team_standings_cache` | Cached league standings for performance | league_id → leagues |
| `matchup_simulations` | Monte Carlo matchup simulation results | matchup_id → matchup_lines |

### Key Patterns
- **RLS on every table** — enforced at the Postgres level, not just application
- **JSONB settings** — `leagues.settings` and `leagues.scoring_settings` store flexible config
- **Pipeline writes via service role** — Python pipeline uses `SUPABASE_SERVICE_ROLE_KEY`
- **245 migrations** — schema has evolved significantly; earliest 2024-03, latest 2026-03

## 5. API Layer

### Auth Flow
1. Frontend authenticates via Supabase Auth (email/password or OAuth)
2. JWT token attached to all API requests as `Authorization: Bearer <token>`
3. `authMiddleware` validates token via Supabase `getUser()`, sets `userId` on context
4. `membershipMiddleware` verifies user belongs to the requested league
5. Services receive a user-scoped Supabase client (`createUserClient(token)`) preserving RLS

### Route Map (`/api/...`)

| Route | Methods | Auth | Purpose |
|-------|---------|------|---------|
| `/health` | GET | None | Server + DB health check |
| `/metrics` | GET | None | Prometheus + JSON metrics |
| `/leagues` | CRUD | Auth + Membership | League management, settings, standings |
| `/players` | GET | Auth | Player search, stats, projections |
| `/matchups` | GET/POST | Auth + Membership | Weekly matchup scores, simulation |
| `/draft` | CRUD | Auth + Membership | Live draft, picks, auto-draft |
| `/rosters` | GET/POST/PUT | Auth + Membership | Lineup setting, roster management |
| `/trades` | CRUD | Auth + Membership | Trade proposals, acceptance, veto |
| `/waivers` | CRUD | Auth + Membership | Waiver claims, FAAB bids |
| `/schedule` | GET | Auth | NHL schedule data |
| `/stormy` | POST | Auth (strict rate limit) | AI assistant chat |
| `/admin` | CRUD | Auth (admin only) | Admin operations |
| `/auction` | CRUD | Auth + Membership | Auction draft management |
| `/keepers` | CRUD | Auth + Membership | Keeper league selections |
| `/playoffs` | GET/POST | Auth + Membership | Playoff bracket management |
| `/bestball` | GET | Auth + Membership | Best ball scoring |
| `/pools` | CRUD | Auth + Membership | Pick'em, survivor, confidence pools |
| `/account` | GET/PUT | Auth | User profile, preferences |
| `/public` | GET | None | Public league data |

### Middleware Stack (applied in order)
1. `requestId` — unique request identifier
2. `honoLogger` — request logging
3. `secureHeaders` — HSTS, X-Frame-Options, etc.
4. `cors` — origin whitelist (prod + dev)
5. `requestContext` + `metrics` — structured logging, latency tracking
6. `cacheControl` — ETag support for GET responses
7. `standardRateLimit` — 300 req/min per IP
8. `strictRateLimit` — 10 req/min per IP (Stormy only)

## 6. ML Models

All models live in `data-pipeline/models/` as `.joblib` files, trained offline and loaded at runtime.

| Model | File | Predicts | Inputs | Output |
|-------|------|----------|--------|--------|
| **xG v3** | `xg_model.joblib` | Goal probability per shot | 31 features: shot distance, angle, type, rebound, rush, strength state, shooter talent | Float [0,1] probability |
| **xG MoneyPuck v2** | `xg_model_moneypuck_v2.joblib` | Goal probability (MoneyPuck-aligned) | MoneyPuck-compatible feature set | Float [0,1] probability |
| **xA (Expected Assists)** | `xa_model.joblib` | Assist probability per pass | Pass origin/destination zones, game state | Float [0,1] probability |
| **Rebound Model** | `rebound_model.joblib` | Rebound probability after shot | Shot location, type, goalie position | Float [0,1] probability |
| **Shot Type Calibration** | `xg_shot_type_calibration.joblib` | xG calibration by shot type | Shot type category | Calibration multiplier |
| **Player Shooting Talent** | `player_shooting_talent.joblib` | Player-level shooting talent | Historical shooting data, Bayesian shrinkage | Talent rating scalar |

### Projection Pipeline Flow
1. `data_acquisition.py` → Fetches live NHL stats via proxy-rotated API calls
2. `build_player_season_stats.py` → Aggregates player season stats
3. `calculate_daily_projections.py` → Applies xG model + contextual adjustments (matchup difficulty, rest days, home/away)
4. `nightly_projection_batch.py` → Batch updates all player projections
5. `fantasy_projection_pipeline.py` → Converts raw projections to fantasy point projections
6. `calculate_matchup_scores.py` → Scores weekly fantasy matchups from actual stats

### Feature Encoders
- `shot_type_encoder.joblib` — Shot type categorical encoding
- `last_event_category_encoder_v2.joblib` — Previous event encoding
- `pass_zone_encoder.joblib` — Ice zone encoding for pass-based features

## 7. Frontend Architecture

### Routing (41 pages, lazy-loaded via `lazyWithErrorHandling()`)

**Public:** Index, About, Features, Pricing, Blog, News, Podcasts, Guides, Careers, Contact, Privacy, Terms, Waitlist
**Auth:** Auth, AuthCallback, VerifyEmail, ResetPassword, ProfileSetup
**League:** LeagueDashboard, CreateLeague, Standings, ScheduleManager, PlayoffBracket, Settings
**Team:** Roster, FreeAgents, WaiverWire, TradeAnalyzer, GMOffice, TeamAnalytics, OtherTeam, DraftRoom
**Fantasy:** Matchup, ArmchairGM (projections/analysis), StormyAssistant (AI chat)
**Pools:** PoolPickem, PoolSurvivor, PoolConfidence
**Account:** Profile, Admin
**Other:** BestBall (best ball scoring view)

### Component Organization (`apps/web/src/components/`)
- **Feature domains:** `draft/`, `matchup/`, `roster/`, `gm-office/`, `armchair-gm/`, `auth/`, `mobile/`, `icons/`
- **Layout:** `Navbar`, `Footer`, `MobileBottomNav`, `CitrusBackground`
- **Shared:** `ErrorBoundary`, `LoadingScreen`, `ProtectedRoute`, `ScrollToTop`
- **UI primitives:** `ui/` (shadcn/ui — do not modify directly)

### State Management
| Layer | Tool | Purpose |
|-------|------|---------|
| Server state | React Query (`@tanstack/react-query`) | All API data fetching, caching, invalidation |
| Client state | Zustand | Notification store |
| Auth state | `AuthContext` | Current user, session, login/logout |
| League state | `LeagueContext` | Active league selection, team membership |

### API Client (`apps/web/src/api/`)
Mirror of server routes — 18 modules (`leagues.ts`, `players.ts`, `matchups.ts`, etc.) plus shared `client.ts` that attaches JWT from AuthContext. New code should use this; legacy `services/` layer is being migrated.

## 8. Infrastructure & Deployment

### Hosting Architecture
```
                    ┌─────────────────────┐
                    │   Firebase Hosting   │
                    │   (CDN + SPA)        │
                    │   apps/web/dist      │
                    └────────┬────────────┘
                             │ /api/** rewrite
                    ┌────────▼────────────┐
                    │   Google Cloud Run   │
                    │   citrus-api         │
                    │   (Hono server)      │
                    │   us-central1        │
                    └────────┬────────────┘
                             │
                    ┌────────▼────────────┐
                    │   Supabase           │
                    │   PostgreSQL + Auth  │
                    │   + Edge Functions   │
                    └─────────────────────┘

  ┌──────────────────────┐
  │  Data Pipeline        │
  │  Docker container     │
  │  (APScheduler cron)   │
  │  Health: :8888        │
  │  Memory limit: 2GB    │
  └───────────┬──────────┘
              │ service_role_key
              ▼
         Supabase REST API
```

### CI/CD (GitHub Actions)
| Workflow | Trigger | Actions |
|----------|---------|---------|
| `ci.yml` | PR to main | Lint, typecheck, test (web + server) |
| `main.yml` | Push to main | Build + deploy preview |
| `deploy-preview.yml` | PR | Firebase preview channel deploy |
| `production-deploy.yml` | Release/manual | Build → Firebase deploy + Cloud Run deploy |

### Environment Variables
See `.env.example` — key groups:
- **Supabase:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **Proxy:** `CITRUS_PROXY_USERNAME`, `CITRUS_PROXY_PASSWORD`, `CITRUS_PROXY_API_URL`
- **Firebase:** `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MEASUREMENT_ID`
- **API:** `VITE_API_URL` (empty in dev/prod — handled by Vite proxy / Firebase rewrite)
- **Monitoring:** `VITE_SENTRY_DSN`
- **Ads:** `VITE_ADSENSE_PUBLISHER_ID`

### Local Development
```bash
npm run dev          # Web on :8080 (Vite proxies /api to :3001)
npm run dev:server   # API on :3001
npm run dev:all      # Both concurrently
# Pipeline: cd data-pipeline && docker-compose up
```

## 9. End-to-End Data Flow

### How an NHL goal becomes fantasy points on screen

```
┌─────────────────────────────────────────────────────────────────────────┐
│  1. NHL API (api.nhle.com)                                             │
│     Live game feed with play-by-play events                            │
└──────────────────────┬──────────────────────────────────────────────────┘
                       │ citrus_request() via 100-IP proxy rotation
                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  2. Data Pipeline (data_scraping_service.py)                           │
│     Live sync every 5-10s during games                                 │
│     Writes to: players (nhl_* columns), raw_nhl_data                   │
└──────────────────────┬──────────────────────────────────────────────────┘
                       │ service_role_key → Supabase REST API
                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  3. Supabase PostgreSQL                                                │
│     players, player_weekly_stats, fantasy_daily_rosters                 │
└──────────────────────┬──────────────────────────────────────────────────┘
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
┌──────────────────────┐  ┌──────────────────────────────────────────────┐
│  4a. Scoring Pipeline │  │  4b. Projection Pipeline                    │
│  calculate_matchup_   │  │  Daily: run_daily_projections.py            │
│  scores.py            │  │  Nightly (2AM ET): nightly_projection_      │
│  Pre-calculates all   │  │  batch.py (6-phase ROS projections)         │
│  fantasy points per   │  │  Writes to: player_projected_stats,         │
│  player per matchup   │  │  projection_cache, ros_projections           │
│  Writes to:           │  └──────────────────────────────────────────────┘
│  fantasy_matchup_     │
│  lines                │
└──────────┬────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  5. Hono API Server (server/)                                          │
│     MatchupService reads pre-calculated lines via RLS                  │
│     JWT auth → membership check → user-scoped Supabase client          │
└──────────────────────┬──────────────────────────────────────────────────┘
                       │ JSON over HTTPS
                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  6. React Frontend (apps/web/)                                         │
│     API client attaches JWT, auto-refreshes before 5-min expiry        │
│     ScoringCalculator applies league-specific scoring on display       │
│     React Query caches + invalidates server state                      │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key insight:** The Python pipeline does all heavy computation (scraping, scoring, projections). The API server reads pre-computed data through RLS. The frontend displays results with league-specific scoring adjustments via `ScoringCalculator`.

### Operational Schedule

| Time | Process | What happens |
|------|---------|-------------|
| **Continuous** | `data_scraping_service.py` | Live game sync every 5-10s via 100-IP proxy rotation |
| **Continuous** | Health check server (:8888) | Exposes pipeline health: `healthy` (<10min stale) → `degraded` (10-30min) → `unhealthy` (>30min) |
| **Midnight MT** | `fetch_nhl_stats_from_landing.py` | Nightly PPP/SHP stats sync from NHL.com landing pages |
| **Midnight MT** | `reconcile_player_stats.py` | Audit and fix player stat discrepancies |
| **Post-midnight** | `calculate_matchup_scores.py` | Refresh pre-calculated matchup lines for all active leagues |
| **Morning** | `run_daily_projections.py` | Daily player projections (multiprocessing, 600+ players) |
| **2 AM ET** | `nightly_projection_batch.py` | Full ROS batch: 6 phases, ~15,000 projections, 15-30 min runtime |

### Auth Flow (request lifecycle)

```
Browser → API Client (client.ts)
  1. Gets JWT from Supabase auth session
  2. Checks expiry, auto-refreshes if <5 min remaining (locked to prevent stampede)
  3. Attaches Authorization: Bearer <token>
     ↓
Hono Server → authMiddleware (auth.ts)
  4. Extracts token from Authorization header
  5. Validates via supabase.auth.getUser(token) — never trusts client user IDs
  6. Sets userId + userToken on request context
  7. membershipMiddleware verifies league access
     ↓
Service Layer
  8. createUserClient(token) creates user-scoped Supabase client
  9. All queries go through RLS — user can only see data they're authorized for
```

## 10. Key Business Logic

1. **ScoringCalculator** (`packages/shared/src/utils/scoring.ts`) — Single source of truth for converting NHL stats into fantasy points. Supports league-specific scoring overrides. The default weights (industry-standard, Yahoo-aligned since 2026-09-01) live in `packages/shared/src/constants/scoringDefaults.json` and are published as a generated table in [`docs/generated/SCORING_DEFAULTS.md`](./docs/generated/SCORING_DEFAULTS.md) — the Python pipeline's copy is generated from the same JSON by `npm run gen:scoring`.

2. **MatchupService** (`server/src/services/MatchupService.ts`) — Calculates weekly head-to-head matchup scores by aggregating daily player stats against league scoring settings. Powers the core fantasy experience.

3. **DraftService** (`server/src/services/DraftService.ts`) — Manages live snake/linear/auction drafts with pick timers, auto-pick fallback, and atomic draft completion that creates rosters from picks.

4. **WaiverService** (`server/src/services/WaiverService.ts`) — Processes waiver claims with FAAB (Free Agent Acquisition Budget) bidding or priority-based processing. Claims are batched and resolved in priority order.

5. **xG Projection Pipeline** (`data-pipeline/projections/`) — Runs nightly: fetches latest NHL data, applies the 31-feature XGBoost model with Bayesian shrinkage and contextual adjustments (matchup difficulty, rest, home/away), writes projections to `player_projected_stats`.

6. **LeagueMembershipService** (`server/src/services/LeagueMembershipService.ts`) — Authorization gate: verifies a user belongs to a league before any league data access. Used by `membershipMiddleware` on all league routes.

7. **LineupService** (`server/src/services/LineupService.ts`) — Manages daily roster lineups with game-lock enforcement (players lock at puck drop). Maintains `fantasy_daily_rosters` snapshots.

8. **TradeService** (`server/src/services/TradeService.ts`) — Handles trade proposals, counteroffers, acceptance with commissioner veto window. All transactions logged to `transaction_ledger`.

9. **Data Acquisition** (`data-pipeline/acquisition/data_acquisition.py`) — Ingests live NHL stats via `citrus_request()` (proxy-rotated HTTP client using 100-IP Webshare pool). Populates `raw_nhl_data` and `players` tables.

10. **PlayoffService** (`server/src/services/PlayoffService.ts`) — Manages fantasy playoff brackets — seeding from regular season standings, matchup generation, and advancement logic.

## 11. API Migration Status (Audit: 2026-03-23)

The frontend is **~95% migrated** to the API-first architecture. All data operations route through the Hono API server except for one service file. Auth and realtime operations correctly remain client-side.

### Fully Compliant
- **All components** (`apps/web/src/components/`) — zero direct Supabase imports
- **All pages** — use API client or AuthContext (no direct DB calls)
- **All 18 API client modules** (`apps/web/src/api/`) — properly route through Hono
- **LeagueContext** — uses API client for data, Supabase only for `auth.onAuthStateChange()`

### Acceptable Client-Side Supabase Usage (by design)

| File | What it does | Why it's correct |
|------|-------------|-----------------|
| `AuthContext.tsx` | signIn, signUp, signOut, resetPassword, OAuth | Auth lifecycle is inherently client-side |
| `AuthCallback.tsx` | OAuth/email verification callback | PKCE flow must be client-side |
| `UserAccountService.ts` | `auth.updateUser()` for password changes | Auth operation |
| `StormyService.ts` | `auth.getUser()` + edge function invoke | Edge functions are client-invoked |
| `DraftService.ts` | `removeChannel()` realtime cleanup | Realtime subscriptions are client-side |
| `NotificationService.ts` | `.channel()` realtime subscription | Realtime subscriptions are client-side |
| `usePlayerNews.ts` | `.channel()` realtime subscription | Realtime subscriptions are client-side |

### Needs Migration

| File | What it does | Fix Required |
|------|-------------|-------------|
| **`DemoLeagueService.ts`** | Direct INSERT/DELETE on `leagues`, `teams`, `draft_picks`, `draft_order`, `matchups`, `team_lineups` (lines 122–732) | Create `POST /api/admin/demo-league/initialize` and `DELETE /api/admin/demo-league` server routes |

## 12. Known Gaps / Tech Debt

1. **`DemoLeagueService.ts` bypasses API** — The only frontend file making direct database writes. Needs dedicated admin API routes (see Section 10).

2. **Duplicate scoring logic** — `ScoringCalculator` exists in both `packages/shared/src/utils/scoring.ts` (canonical) and `apps/web/src/utils/scoringUtils.ts` (legacy). The web copy should be removed.

3. **245 migrations with no baseline squash** — Many iterative fixes (e.g., 14 migrations just for RLS recursion). New environments must replay all 245. Consider squashing into a baseline.

4. **No staging environment** — `.env.example` shows only dev/prod. No staging Supabase project or staging Cloud Run service for pre-production testing.

5. **Pipeline observability** — Data pipeline runs in a standalone Docker container with a basic health check on `:8888`. No centralized logging aggregation or alerting integration.

6. **Test coverage gaps** — Coverage targets stated for `utils/` and `services/` but actual server-side coverage is unclear. No coverage thresholds enforced in CI.

7. **Shared package symlink hack** — `@citrus/shared` exports raw `.ts` files (no build step). Server Dockerfile must maintain `ln -s ../../packages/shared node_modules/@citrus/shared`.

8. **In-memory rate limiting** — `standardRateLimit` (300/min) and `strictRateLimit` (10/min) use LRU-bounded in-memory stores. Will not distribute correctly if Cloud Run scales to multiple instances.

9. **Hardcoded CORS origins** — Production CORS origins are hardcoded in `server/src/app.ts`. Adding new domains requires a code change and redeploy.

10. **Data pipeline single point of failure** — Runs as a single Docker container. No redundancy, auto-scaling, or dead-letter queue for failed ingestion jobs.

11. **Legacy `services/` folder size** — 32 files remain in `apps/web/src/services/`. While most now delegate to the API client, several still contain significant business logic that duplicates server-side services. These should be thinned to pure API wrappers or removed.

12. **No functional-correctness gate on migrations** — CI does not run new RPCs against staging-shape data and assert invariants on the output. A migration that compiles cleanly, references real columns, and produces structurally valid rows can still write semantically wrong values to production. The future automated migration validation gate (see §13 P3) **must run each new/altered function against staging data and check declared invariants**, not just validate DDL or syntax.

   **Canonical test case for the validation gate (2026-05-12 incident):** commit 76e5468 introduced an `aggregate_player_playoff_stats[_live]` RPC that summed `primary_assists + secondary_assists` (PBP-extractor columns, populated by a lagging job) instead of `nhl_assists` (live-scraped from NHL.com). All 17 other stats correctly used `COALESCE(nhl_*, unprefixed)`; only assists slipped because `player_game_stats` has no plain `assists` column to fall back to. The RPC compiled, applied, ran without error, and silently produced `assists = 0` for every player across 3+ weeks of playoff data. A compile-check or DDL-only gate would have rubber-stamped it. A functional gate executing the RPC against staging playoff rows and asserting `SUM(goals) + SUM(assists) = SUM(points)` would have caught it before deploy. Fix migration: `20260512120000_fix_playoff_aggregate_assists_use_nhl_col.sql`.

13. **Status: SHIPPED in #269 (2026-05-19). Stability fixed in PR #278 (2026-06-02)** — the original implementation had an un-paginated `player_game_stats` query that produced false-positive failures from 2026-05-20 through 2026-06-02 (13 days, ~every hourly run) because PostgREST capped the response at 1000 rows while the table held 2680+. Paginated via limit/offset; alerter is now signal not noise. **[PRE-WEB SUMMIT] Reconciliation alerter for missed game scrapes** — Hourly cron job: `SELECT game_id FROM nhl_games WHERE status='final' AND game_type='playoff' AND season=2025 AND game_id NOT IN (SELECT DISTINCT game_id FROM player_game_stats);` — alert (Slack/email/PagerDuty/whatever channel oncall watches) if it returns anything. Catches the next silent scrape miss within 1 hour instead of 9–17 days.

   **Canonical test case (2026-05-12 incident):** 5 playoff games on series-transition dates (3 R1 G4 closeouts on 2026-04-25, 2 R2 G1 openers on 2026-05-02/03) had `status='final'` in `nhl_games` but ZERO `player_game_stats` rows for weeks. No alert fired. User noticed via stale stats on the playoff pool page. This query, run hourly, would have fired the same evening as the first miss. Scope to `playoff` initially; extend to regular season after demo. Smallest possible intervention; no infra rewrites required.

14. **Status: SHIPPED in #269 (2026-05-19).** **[PRE-WEB SUMMIT] Widen `data_scraping_service` catch-up window from 24h to 7d** — `data-pipeline/acquisition/data_scraping_service.py:797-821` only looks back one day. If a day gets deferred via the "live games being polled, defer catch-up" branch at line 817-818, it rolls off the window after 24h and is never re-attempted. Change the lookback to iterate the last 7 days. One-line fix; the structural Cloud Run Jobs migration (item 6 of the DevOps backlog) supersedes this post-Web Summit but the one-line widening closes the silent-failure surface for the demo window without waiting for the rewrite.

   **Verification after widening:** the audit query from item 13 above should return empty on subsequent runs — proves the catch-up actually re-attempts deferred days. Use the same idempotent backfill primitive (`fetch_game_boxscore` + `update_player_game_stats_nhl_columns` from `scrape_per_game_nhl_stats.py`) the 2026-05-12 incident used.

   **2026-05-12 incident closure:** Items 13 and 14 — the recurring-failure surface motivating both — are closed by PR #269 (2026-05-19). The mid-incident silent-miss pattern (playoff games stuck at `status='final'` with no `player_game_stats` for 9–17 days) is now bounded by a 7-day catch-up window (item 14, self-heals deferred days within a week) plus a 1-hour detection SLO (item 13, hourly cron alerts via GHA email + optional Slack/PagerDuty through the existing `AlertManager`). The §12.13 alert path was verified end-to-end via `workflow_dispatch -f force_fail=true` immediately post-merge; failure email + GitHub mobile push both confirmed delivered. Item 12 (functional-correctness gate on migrations) remains open as P3 — the originating bug in 76e5468 would still ship today.

15. **[PRE-2026-06-02] GitHub Actions deprecation sweep** — Node.js 20 sunsets on GitHub Actions runners 2026-06-02. The deprecation warning surfaced in the PR #269 test-fire run flagged `actions/checkout@v4` and `actions/setup-python@v5` as Node-20-based; both are reused across the repo's workflows. Scope: all workflows under `.github/workflows/` — bump `actions/checkout` and `actions/setup-python` to the latest stable majors (verify at ticket pickup time). Pre-condition: confirm no breaking changes between major versions via release notes + a green CI run on a throwaway branch. Estimate: ~30 min including CI verification. Filed from the PR #269 test-fire output; non-blocking for current reliability work, but is blocking on 2026-06-02.

16. **Status: SHIPPED in #275 (2026-05-20).** **[PRE-R3-G2] Investigate `TEAM_ID_MAP` FK warning in self-heal logs** — On 2026-05-19 21:47, the `data_scraping_service` log surfaced `[SELF-HEAL] Ingest reported success but query still empty. Likely an FK reject on a team_id not in TEAM_ID_MAP`. The upserts visibly succeeded (R3 games landed in `nhl_games` and were verified during the PR #269 R3 ingestion check), so the warning may be a stale post-write check. But the alternative — `TEAM_ID_MAP` is missing entries and rows are being silently dropped for some teams — would be a meaningful data-quality issue. **Action:** review `TEAM_ID_MAP` completeness against the four R3 teams (Eastern: 12 vs 8; Western: 21 vs 54) and against active 2025 season rosters generally, then either backfill missing entries or fix the warning to not fire when the ingest actually succeeded. Not blocking R3 G1 (2026-05-20) since the rows we'd expect are present; should be cleared before R3 G2 (2026-05-22) so we're not running a noisy log into the Conference Final stretch.

17. **[POST-WEBSUMMIT] Ops/Windows scraper deployment is undocumented and was non-functional** — The 2026-05-19 session surfaced that the canonical install path (`ops/windows/install_data_scraping_service.ps1` → `run_data_scraping_service.ps1` → `CitrusDataScrapingService` scheduled task) has been broken since `data_scraping_service.py` moved into `data-pipeline/acquisition/`. The actual production daemon has been running via Cursor (an IDE process) with the correct path baked into the launch command for ~24 days, masking the failure. This is a serious reliability gap: a developer machine reboot, Cursor crash, or any IDE-process interruption silently takes down the entire data pipeline with no boot-time fallback. The path bug itself was fixed in PR #271 (2026-05-19), but the broader concern — that the canonical deployment path was never verified end-to-end and there's no runbook describing how to bring the daemon up cleanly — remains open. Item 6 of the DevOps backlog (Cloud Run Jobs migration) supersedes this long-term by removing the Windows host dependency entirely, but until that ships the canonical Windows path needs to actually work. **Action:** after PR #271 merges, verify `install_data_scraping_service.ps1` installs the scheduled task correctly end-to-end on a clean state, then power-cycle / Cursor-close test to confirm the scheduled task actually carries the daemon. Document the install + recovery procedure in a runbook under `docs/RUNBOOKS/`. Tagged `[POST-WEBSUMMIT]` because the immediate path bug is already fixed; this is the durable verification + documentation work that's part of Item 6 prep.

18. **[POST-2026-06-02-CHECK] Bump `actions/upload-artifact` + `actions/download-artifact` v4 → v5** — Both are part of the Node 20 deprecation cohort (same publisher and vintage as the actions bumped in §12.15 / PR #273), but v3→v4 of the artifact actions had real breaking API changes (single-artifact-per-upload, name-uniqueness behavior). The v4→v5 changelog needs to be reviewed before bumping — explicitly excluded from the §12.15 sweep to keep that PR low-risk and explicitly verifiable. Affected files at filing time: `staging-deploy.yml` (1× upload at line 67, 1× download at line 180), `production-deploy.yml` (1× upload at line 99, 1× download at line 257). **Action:** read the actions/upload-artifact and actions/download-artifact v4→v5 release notes for breaking changes; if clean, bump in a small PR with a staging-deploy verification run before merging. If breaking, document the migration steps. Tagged `[POST-2026-06-02-CHECK]` because the runner forces Node-24 default on 2026-06-02 but doesn't remove Node 20 until 2026-09-16 — these artifact actions on Node 20 will keep working under the temporary `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION=true` escape hatch until then if needed. Estimate: 30 min including changelog review + verification run.

19. **[PRE-NEXT-SEASON] `player_season_stats` nightly aggregate failing for 65+ hours** — Observed 2026-05-20 ~17:09 MT: `data_scraping_service.py` emits `CRITICAL [STALE DATA ALERT]` every 30-60s cycle. `player_season_stats.updated_at = 2026-05-18T06:02:04.373899+00:00` — 65h+ stale at observation time, 2-3x over the daemon's 24h freshness threshold. Likely cause: `main.yml` workflow (cron `0 7 * * *`, runs `nightly_projection_batch.py --season 2025`) is either failing silently or the script is succeeding without updating the target table.

    **Investigation steps:**
    1. `gh run list --workflow=main.yml --limit 14` — check failure pattern over the last two weeks
    2. If runs are succeeding: read `nightly_projection_batch.py` to find what writes `player_season_stats`, verify the write actually happens (it may be silently no-oping or writing under a different code path)
    3. If runs are failing: read the failure log, identify root cause

    **Downstream impact (also part of the investigation):**
    - Stormy season-long context responses — verify which `player_season_stats` fields it reads
    - xG model retraining cadence — verify source dependencies
    - Any season-long projection logic in the web app

    Tagged `[PRE-NEXT-SEASON]` because the playoff path doesn't depend on `player_season_stats` (it uses `aggregate_player_playoff_stats_live` against `player_game_stats`), so this isn't playoff-affecting. Should not drift past end-of-playoffs.

20. **[POST-2026-06-09-CHECK] GHA cron throttling — validate whether it self-resolves now that §12.13 alerter is green** — Observed during the 2026-06-02 Cup Final readiness check: both `playoff-reconciliation.yml` (cron `0 * * * *`, hourly) and `playoff-sync.yml` (cron `*/15 * * * *`, every 15 min) were firing at roughly every 4-5 hours instead of their scheduled cadence. Sample windows captured at observation time: reconciliation last 10 runs spanned ~70 hours across 10 firings (vs the cron's expected 10 firings in 10 hours); playoff-sync last 10 runs spanned ~37 hours (vs expected 2.5 hours). **Hypothesis:** GitHub Actions deprioritizes consistently-failing scheduled workflows, and the 13-day false-positive failure pattern from the un-paginated §12.13 reconciler (fixed in PR #278, 2026-06-02) had spillover throttling effect on the sibling `playoff-sync.yml` schedule in the same repo. **Action:** re-pull `gh run list --workflow={playoff-reconciliation,playoff-sync}.yml --limit 30` on or after 2026-06-09 (≥7 days of green reconciliation runs). If both workflows have returned to nominal cadence (hourly and ~15min respectively), close as "validated, root cause was the failing alerter." If throttling persists, investigate further — could be GitHub's general scheduled-workflow timing variance (officially allowed to exceed an hour), repo activity heuristics, or runner contention. Not playoff-affecting (playoff-sync still hits the DB multiple times per day; daemon carries the live path); purely an operational-cadence concern.

## 13. Action Items / TODOs

### P0 — Before next release
- [ ] Migrate `DemoLeagueService.ts` direct DB writes to admin API routes (`POST/DELETE /api/admin/demo-league`)
- [ ] Delete duplicate `apps/web/src/utils/scoringUtils.ts` — ensure all imports use `@citrus/shared` `ScoringCalculator`

### P1 — Next sprint
- [ ] Audit and thin `apps/web/src/services/` — remove files that are pure pass-throughs to `api/` modules, consolidate any remaining business logic server-side
- [ ] Add test coverage thresholds to CI (`ci.yml`) — fail builds below target
- [ ] Add a staging environment (Supabase project + Cloud Run service) for pre-production validation
- [ ] Move CORS origins to environment variable (`ALLOWED_ORIGINS`) instead of hardcoded list

### P2 — Near-term improvements
- [ ] Squash migrations into a baseline for clean environment setup (keep individual migrations for incremental apply)
- [ ] Replace in-memory rate limiting with Redis or Cloud Run-compatible distributed store
- [ ] Build `@citrus/shared` to JS instead of exporting raw `.ts` — eliminates Dockerfile symlink hack
- [ ] Add structured logging/alerting for data pipeline (forward to Cloud Logging or Datadog)
- [ ] Add pipeline redundancy — at minimum a health-based restart policy, ideally Cloud Run Jobs or a task queue

### P3 — Long-term
- [ ] Pipeline dead-letter queue for failed NHL API ingestion jobs
- [ ] Automated migration validation in CI (currently manual via `scripts/validate-migration.ts`)
- [ ] Evaluate moving Stormy edge function to Hono API server for unified auth/rate-limiting
- [ ] PWA offline support audit — verify service worker cache strategy is production-ready
