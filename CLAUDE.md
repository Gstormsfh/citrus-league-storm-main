# Citrus Draft Performance Mandate

## Non-negotiable competitive requirements

Citrus's live draft experience MUST be competitive with Yahoo Fantasy and ESPN Fantasy on every dimension users perceive. This is not an optimization goal. It is a foundational design constraint equivalent to correctness.

### Hard performance targets

These targets define what "competitive" means. Any architecture, design, or implementation that cannot meet these targets is rejected by definition, regardless of how sophisticated, correct, or elegant it is.

- **Manual pick submission** (user clicks "draft player" → all participants see the pick): p95 ≤ 300ms, p99 ≤ 500ms
- **Autopick latency** (deadline expiry → pick committed and broadcast): p95 ≤ 1000ms, p99 ≤ 2000ms
- **Draft state load** (user enters draft room → fully rendered with current state): p95 ≤ 1500ms
- **Timer accuracy** (server-displayed countdown vs actual deadline): drift < 100ms across all clients
- **Pick-to-broadcast fanout** (server commits pick → all connected clients have updated UI): p95 ≤ 200ms
- **Reconnection recovery** (client WebSocket drops → reconnects → state resynced): p95 ≤ 2000ms

### Architectural implications

The performance targets above require specific architectural choices. Designs that conflict with these are rejected:

1. **Persistent stateful worker per active draft.** Drafts run in long-lived processes that hold state in memory for the duration of the draft. Stateless function-per-request architectures cannot meet sub-200ms broadcast fanout at scale.

2. **WebSocket transport for live drafts.** Manual picks, broadcasts, timer updates, and chat all flow through bidirectional WebSocket connections. HTTP polling and long-poll are insufficient for the broadcast targets above.

3. **In-memory candidate pool and pre-computed scoring per draft.** Autopick decisions consult cached state, not Postgres queries. A per-pick query of the player pool cannot meet sub-1s autopick latency.

4. **Postgres as durability and disaster recovery, not hot path.** The event log, projection tables, and pgmq scheduler remain as the source of truth and the safety net. They are not on the hot path for manual pick submission, broadcast fanout, or autopick scoring.

5. **WebSocket reconnection with state snapshot recovery.** Mobile network blips, page refreshes, and brief connection drops are normal user behavior. Clients must reconnect and resync within 2 seconds without losing draft progress.

### Design review checklist

Before any architectural change, design proposal, or new chunk plan is approved, it must explicitly answer:

1. Does this design meet every performance target listed above? Show the back-of-envelope calculation.
2. If not, which target does it fail and why? Is the failure acceptable given the alternative? (Default answer: no.)
3. Does this design support the architectural patterns in #1-5 above, or does it conflict with them?
4. If a chunk plan defers performance work to a later phase, does that later phase have a concrete plan and timeline, or is it "we'll figure it out"?

### Non-negotiables

The following are NOT acceptable framings, regardless of how persuasive the surrounding argument:

- "We can optimize this later" — for any user-perceived latency
- "It's only slow in the autopick path" — autopick IS user-perceived
- "Most users won't notice" — Yahoo/ESPN users will compare; we lose
- "It's competitive with v1" — v1 is not the bar; Yahoo/ESPN are
- "It's good enough for the demo" — there is no demo bar separate from the competitive bar
- "The architecture supports optimization later" — only counts if later is scheduled and bounded

### Recovery from prior decisions

The Phase 0-4 architecture solved correctness but did not solve competitive performance. The Phase 4.5 redesign (persistent worker + WebSocket transport + in-memory state) is required to bring the system to competitive parity before Phase 5 (UI) is built on top of it.

Phase 5 must NOT be built against the Phase 0-4 architecture alone. It must be built against the Phase 4.5-extended architecture, or it will require rework when performance gaps are discovered later.

This document is the source of truth on this. If a future plan contradicts it, this document wins.

---

# Citrus Fantasy Sports — Engineering Standards

## Project Overview

Citrus Fantasy Sports is a world-class NHL fantasy hockey platform powered by the most accurate projection system on earth (xG v3 with 31-feature model + proprietary pass context MOAT). We are building the industry standard for NHL fantasy.

**Stack:** React 18 + TypeScript + Vite | Hono API Server | Supabase (PostgreSQL + Auth + RLS) | Python data pipeline | Firebase Hosting

## Architecture

- **Web Frontend:** React SPA with Vite, shadcn/ui, Tailwind CSS, React Router, React Query, Zustand (`apps/web/`)
- **API Server:** Hono (TypeScript) with JWT auth middleware, per-request Supabase clients (`server/`)
- **Shared Packages:** Types, constants, and utilities shared between web and server (`packages/shared/`)
- **Database:** Supabase PostgreSQL with Row Level Security on ALL tables
- **Data Pipeline:** Python scripts with 100-IP proxy rotation for NHL API data (`data-pipeline/`)
- **Projections:** XGBoost xG v3 model (31 features, Bayesian shrinkage, contextual adjustments)
- **AI Assistant:** Stormy (Claude Sonnet via API server → Supabase Edge Function)
- **Hosting:** Firebase Hosting with CDN, PWA support, security headers

## Monorepo Structure

```
citrus-league-storm-main/
├── apps/web/                   # React SPA (Vite)
│   ├── src/
│   │   ├── api/                # API client layer (calls server, NOT Supabase directly)
│   │   ├── components/         # React components by feature domain
│   │   ├── contexts/           # React contexts (AuthContext, LeagueContext)
│   │   ├── hooks/              # Custom React hooks
│   │   ├── integrations/       # Supabase client (for auth + realtime only)
│   │   ├── pages/              # Route-level page components
│   │   ├── services/           # Legacy service layer (migrating to API client)
│   │   ├── stores/             # Zustand stores
│   │   ├── types/              # TypeScript type definitions
│   │   └── utils/              # Pure utility functions + tests
│   ├── vite.config.ts
│   └── package.json            # @citrus/web
├── server/                     # Hono API server
│   ├── src/
│   │   ├── routes/             # HTTP route handlers (leagues, players, matchups, etc.)
│   │   ├── middleware/         # Auth, membership, admin middleware
│   │   ├── services/           # Server-side service classes (DI Supabase client)
│   │   ├── lib/                # Supabase client factories
│   │   ├── app.ts              # Hono app setup + middleware
│   │   └── index.ts            # Server entry point
│   └── package.json            # @citrus/server
├── packages/shared/            # Shared types & utilities
│   ├── src/
│   │   ├── types/              # League types, scoring types
│   │   ├── constants/          # Season constants, query columns
│   │   └── utils/              # ScoringCalculator, timezone, logger
│   └── package.json            # @citrus/shared
├── data-pipeline/              # Python data pipeline
│   ├── acquisition/            # NHL API data fetching
│   ├── projections/            # xG model, daily projections
│   ├── scoring/                # Matchup score calculation
│   ├── monitoring/             # Health checks, freshness checks
│   ├── utils/                  # proxy_manager, citrus_request, supabase_rest
│   ├── debug/                  # One-off fix/check scripts
│   ├── models/                 # XGBoost model files (.joblib)
│   └── requirements.txt
├── supabase/                   # Database migrations + edge functions
│   ├── functions/
│   └── migrations/
└── package.json                # Root workspace config
```

## Code Standards

### TypeScript / React (apps/web)
- All new code must be TypeScript (no `any` types in new code)
- Use the path alias `@/` for imports (maps to `apps/web/src/`)
- Use `@citrus/shared` for shared types, constants, and utilities
- New data fetching should use the API client (`@/api/`) instead of Supabase directly
- Existing services in `@/services/` are being incrementally migrated to API client
- Components go in `src/components/` organized by feature domain
- Use React Query for server state, Zustand for client state, Context for auth/league
- Lazy-load pages with `lazyWithErrorHandling()` wrapper in App.tsx
- Use shadcn/ui components from `src/components/ui/` — do not install new UI libraries

### API Server (server/)
- All routes go through auth middleware (JWT validation via Supabase)
- League routes also go through membership middleware
- Services receive the Supabase client as a constructor parameter (dependency injection)
- Use `createUserClient(token)` for user-scoped queries (preserves RLS)
- Use `supabaseAdmin` only for admin operations and background jobs
- Import shared types from `@citrus/shared`

### Database / Supabase
- RLS must be enabled on every new table — no exceptions
- All SECURITY DEFINER functions must include `SET search_path = public`
- All mutations must verify `auth.uid()` server-side (never trust client-provided user IDs)
- Use the `transaction_ledger` table to audit all roster/trade/waiver transactions
- League membership must be verified via `LeagueMembershipService` before any league data access
- Migration files go in `supabase/migrations/` with timestamp prefix format: `YYYYMMDDHHMMSS_description.sql`

### Python / Data Pipeline (data-pipeline/)
- All NHL API calls go through `citrus_request()` in `data_pipeline.utils.citrus_request`
- Database access uses `SupabaseRest` client with service role key (`data_pipeline.utils.supabase_rest`)
- Fantasy scoring uses official NHL.com stats (`nhl_*` columns), not PBP-derived columns
- Projections use `CACHE_VERSION` — bump it when model or data sources change
- All scripts must handle graceful shutdown (SIGINT/SIGTERM)
- Import path: `from data_pipeline.utils.citrus_request import citrus_request`

### Scoring
- `ScoringCalculator` in `packages/shared/src/utils/scoring.ts` is the single source of truth
- Also available in web at `apps/web/src/utils/scoringUtils.ts` (will be removed once migration is complete)
- Default scoring: Goals 3, Assists 2, PPP 1, SHP 2, SOG 0.4, BLK 0.5, HIT 0.2, PIM 0.5, W 4, SO 3, SV 0.2, GA -1
- League-specific scoring is stored in `leagues.scoring_settings` JSONB
- Never hardcode scoring values in components — always use `ScoringCalculator`

### League Types
- Defined in `packages/shared/src/types/league.ts` (canonical) and `apps/web/src/types/leagueTypes.ts` (legacy)
- 4 league types: `fantasy`, `pickem`, `survivor`, `confidence-pool`
- 6 scoring formats: `h2h-points`, `h2h-categories`, `roto`, `total-points`, `best-ball`, `points-per-game`
- 5 draft types: `snake`, `linear`, `auction`, `autopick`, `offline`
- All league settings stored in `leagues.settings` JSONB column (type: `LeagueSettings`)

## Testing Requirements

- **Every new service method** must have a corresponding test
- **Every bug fix** must include a regression test
- Tests use Vitest with jsdom environment
- Run tests: `npm run test` (from root or apps/web)
- Test coverage target: `apps/web/src/utils/**` and `apps/web/src/services/**`
- Mock Supabase calls in service tests — do not hit real database

## Security Checklist (for every PR)

- [ ] No hardcoded secrets, API keys, or credentials
- [ ] RLS enabled on any new tables
- [ ] `auth.uid()` verified server-side for mutations
- [ ] `SET search_path = public` on SECURITY DEFINER functions
- [ ] League membership verified before league data access
- [ ] No `SELECT *` in production queries — use explicit column lists via `COLUMNS` util
- [ ] Audit logging via `AuditService` for security-relevant events
- [ ] API routes use authMiddleware and membershipMiddleware where appropriate

## Key Constants

- Current season: defined in `packages/shared/src/constants/season.ts` (`CURRENT_SEASON`)
- Demo league ID: defined in `apps/web/src/services/DemoLeagueService.ts` (`DEMO_LEAGUE_ID`)
- Fantasy weeks run Sunday through Saturday
- Timezone: Mountain Time (MST/MDT) — use `packages/shared/src/utils/timezone.ts`

## Common Commands

```bash
# Root workspace commands
npm run dev              # Start web dev server (Vite on port 8080)
npm run dev:server       # Start API server (Hono on port 3001)
npm run dev:all          # Start both web + API
npm run build            # Build shared + web
npm run build:server     # Build shared + server
npm run test             # Run web tests
npm run test:server      # Run server tests

# From apps/web/
npx vitest run           # Run tests
npx vitest --watch       # Watch mode tests

# From server/
npm run dev              # Start with tsx watch
```

## What NOT to Do

- Do not bypass RLS with service role key from the frontend
- Do not add new npm dependencies without justification
- Do not modify `apps/web/src/components/ui/` files (shadcn managed)
- Do not hardcode player IDs, team IDs, or league IDs
- Do not use `console.log` in production code — use `logger` from `@citrus/shared`
- Do not create new database tables without RLS policies
- Do not skip writing tests for new service methods
- Do not call Supabase directly from new frontend code — use the API client (`@/api/`)
