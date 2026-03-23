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

## 9. Key Business Logic

1. **ScoringCalculator** (`packages/shared/src/utils/scoring.ts`) — Single source of truth for converting NHL stats into fantasy points. Supports league-specific scoring overrides. Default: G=3, A=2, PPP=1, SHP=2, SOG=0.4, BLK=0.5, HIT=0.2, PIM=0.5, W=4, SO=3, SV=0.2, GA=-1.

2. **MatchupService** (`server/src/services/MatchupService.ts`) — Calculates weekly head-to-head matchup scores by aggregating daily player stats against league scoring settings. Powers the core fantasy experience.

3. **DraftService** (`server/src/services/DraftService.ts`) — Manages live snake/linear/auction drafts with pick timers, auto-pick fallback, and atomic draft completion that creates rosters from picks.

4. **WaiverService** (`server/src/services/WaiverService.ts`) — Processes waiver claims with FAAB (Free Agent Acquisition Budget) bidding or priority-based processing. Claims are batched and resolved in priority order.

5. **xG Projection Pipeline** (`data-pipeline/projections/`) — Runs nightly: fetches latest NHL data, applies the 31-feature XGBoost model with Bayesian shrinkage and contextual adjustments (matchup difficulty, rest, home/away), writes projections to `player_projected_stats`.

6. **LeagueMembershipService** (`server/src/services/LeagueMembershipService.ts`) — Authorization gate: verifies a user belongs to a league before any league data access. Used by `membershipMiddleware` on all league routes.

7. **LineupService** (`server/src/services/LineupService.ts`) — Manages daily roster lineups with game-lock enforcement (players lock at puck drop). Maintains `fantasy_daily_rosters` snapshots.

8. **TradeService** (`server/src/services/TradeService.ts`) — Handles trade proposals, counteroffers, acceptance with commissioner veto window. All transactions logged to `transaction_ledger`.

9. **Data Acquisition** (`data-pipeline/acquisition/data_acquisition.py`) — Ingests live NHL stats via `citrus_request()` (proxy-rotated HTTP client using 100-IP Webshare pool). Populates `raw_nhl_data` and `players` tables.

10. **PlayoffService** (`server/src/services/PlayoffService.ts`) — Manages fantasy playoff brackets — seeding from regular season standings, matchup generation, and advancement logic.

## 10. Known Gaps / Tech Debt

1. **Legacy service layer migration** — `apps/web/src/services/` (32 files) still contains direct Supabase calls. Being incrementally migrated to `apps/web/src/api/` client that goes through the Hono server. Dual paths create confusion about which to use.

2. **Duplicate scoring logic** — `ScoringCalculator` exists in both `packages/shared/src/utils/scoring.ts` (canonical) and `apps/web/src/utils/scoringUtils.ts` (legacy). The web copy should be removed once migration is complete.

3. **245 migrations** — The migration history is very large with many iterative fixes (e.g., 14 migrations just for RLS recursion fixes in Jan 2025). Consider squashing into a baseline migration for new environments.

4. **No staging environment** — `.env.example` shows only dev/prod. No mention of a staging Supabase project or staging Cloud Run service for pre-production testing.

5. **Pipeline observability** — Data pipeline runs in a standalone Docker container with a basic health check server on `:8888`. No centralized logging aggregation or alerting integration beyond custom scripts in `monitoring/`.

6. **Test coverage gaps** — Frontend services under `apps/web/src/services/` have a `__tests__` directory but coverage target is only stated for `utils/` and `services/`. Server tests exist but coverage is [NEEDS CLARIFICATION].

7. **Shared package has no runtime deps** — `@citrus/shared` exports raw `.ts` files (no build step). This works with tsx but means the server Dockerfile must maintain a symlink hack (`ln -s ../../packages/shared node_modules/@citrus/shared`).

8. **Rate limiting is in-memory** — `standardRateLimit` (300/min) and `strictRateLimit` (10/min) use LRU-bounded in-memory stores. Will not work correctly if Cloud Run scales to multiple instances.

9. **Hardcoded CORS origins** — Production CORS origins are hardcoded in `server/src/app.ts`. Adding new domains requires a code change and redeploy.

10. **Data pipeline single point of failure** — The pipeline runs as a single Docker container. No redundancy, auto-scaling, or dead-letter queue for failed ingestion jobs.
