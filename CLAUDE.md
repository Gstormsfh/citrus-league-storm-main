# Citrus Fantasy Sports — Engineering Standards

## Project Overview

Citrus Fantasy Sports is a world-class NHL fantasy hockey platform powered by the most accurate projection system on earth (xG v3 with 31-feature model + proprietary pass context MOAT). We are building the industry standard for NHL fantasy.

**Stack:** React 18 + TypeScript + Vite | Supabase (PostgreSQL + Auth + RLS) | Python data pipeline | Firebase Hosting

## Architecture

- **Frontend:** React SPA with Vite, shadcn/ui, Tailwind CSS, React Router, React Query, Zustand
- **Backend:** Supabase (PostgreSQL with Row Level Security on ALL tables)
- **Data Pipeline:** Python scripts with 100-IP proxy rotation for NHL API data
- **Projections:** XGBoost xG v3 model (31 features, Bayesian shrinkage, contextual adjustments)
- **AI Assistant:** Stormy (Claude Sonnet via Supabase Edge Function)
- **Hosting:** Firebase Hosting with CDN, PWA support, security headers

## Code Standards

### TypeScript / React
- All new code must be TypeScript (no `any` types in new code)
- Use the path alias `@/` for imports (maps to `src/`)
- Components go in `src/components/` organized by feature domain
- Services go in `src/services/` — all Supabase calls go through service classes, never direct from components
- Use React Query for server state, Zustand for client state, Context for auth/league
- Lazy-load pages with `lazyWithErrorHandling()` wrapper in App.tsx
- Use shadcn/ui components from `src/components/ui/` — do not install new UI libraries

### Database / Supabase
- RLS must be enabled on every new table — no exceptions
- All SECURITY DEFINER functions must include `SET search_path = public`
- All mutations must verify `auth.uid()` server-side (never trust client-provided user IDs)
- Use the `transaction_ledger` table to audit all roster/trade/waiver transactions
- League membership must be verified via `LeagueMembershipService` before any league data access
- Migration files go in `supabase/migrations/` with timestamp prefix format: `YYYYMMDDHHMMSS_description.sql`

### Python / Data Pipeline
- All NHL API calls go through `citrus_request()` (handles proxy rotation, retries, circuit breaker)
- Database access uses `SupabaseRest` client with service role key
- Fantasy scoring uses official NHL.com stats (`nhl_*` columns), not PBP-derived columns
- Projections use `CACHE_VERSION` — bump it when model or data sources change
- All scripts must handle graceful shutdown (SIGINT/SIGTERM)

### Scoring
- `ScoringCalculator` in `src/utils/scoringUtils.ts` is the single source of truth for all scoring
- Default scoring: Goals 3, Assists 2, PPP 1, SHP 2, SOG 0.4, BLK 0.5, HIT 0.2, PIM 0.5, W 4, SO 3, SV 0.2, GA -1
- League-specific scoring is stored in `leagues.scoring_settings` JSONB
- Never hardcode scoring values in components — always use `ScoringCalculator`

### League Types
- Defined in `src/types/leagueTypes.ts` — the exhaustive type system
- 4 league types: `fantasy`, `pickem`, `survivor`, `confidence-pool`
- 6 scoring formats: `h2h-points`, `h2h-categories`, `roto`, `total-points`, `best-ball`, `points-per-game`
- 5 draft types: `snake`, `linear`, `auction`, `autopick`, `offline`
- All league settings stored in `leagues.settings` JSONB column (type: `LeagueSettings`)

## Testing Requirements

- **Every new service method** must have a corresponding test in `src/utils/__tests__/` or `src/services/__tests__/`
- **Every bug fix** must include a regression test
- Tests use Vitest with jsdom environment
- Run tests: `npx vitest run`
- Test coverage target: `src/utils/**` and `src/services/**`
- Mock Supabase calls in service tests — do not hit real database

## Security Checklist (for every PR)

- [ ] No hardcoded secrets, API keys, or credentials
- [ ] RLS enabled on any new tables
- [ ] `auth.uid()` verified server-side for mutations
- [ ] `SET search_path = public` on SECURITY DEFINER functions
- [ ] League membership verified before league data access
- [ ] No `SELECT *` in production queries — use explicit column lists via `COLUMNS` util
- [ ] Audit logging via `AuditService` for security-relevant events

## File Organization

```
src/
├── components/          # React components by feature domain
│   ├── ui/              # shadcn/ui primitives (do not modify)
│   ├── draft/           # Draft room components
│   ├── matchup/         # Matchup display components
│   ├── roster/          # Roster management components
│   ├── gm-office/       # GM Office components
│   └── armchair-gm/     # Cap simulator components
├── contexts/            # React contexts (AuthContext, LeagueContext)
├── hooks/               # Custom React hooks
├── integrations/        # Supabase and Firebase client setup
├── pages/               # Route-level page components
├── services/            # Business logic and API layer
├── stores/              # Zustand stores
├── types/               # TypeScript type definitions
└── utils/               # Pure utility functions
    └── __tests__/       # Unit tests (Vitest)
```

## Key Constants

- Current season: defined in `src/utils/seasonConstants.ts` (`CURRENT_SEASON`)
- Demo league ID: defined in `src/services/DemoLeagueService.ts` (`DEMO_LEAGUE_ID`)
- Fantasy weeks run Sunday through Saturday
- Timezone: Mountain Time (MST/MDT) — use `src/utils/timezoneUtils.ts`

## Common Commands

```bash
npm run dev          # Start dev server (Vite)
npm run build        # Production build
npx vitest run       # Run tests
npx vitest --watch   # Watch mode tests
npm run lint         # ESLint
npm run deploy       # Build + Firebase deploy
```

## What NOT to Do

- Do not bypass RLS with service role key from the frontend
- Do not add new npm dependencies without justification
- Do not modify `src/components/ui/` files (shadcn managed)
- Do not hardcode player IDs, team IDs, or league IDs
- Do not use `console.log` in production code — use `logger` from `src/utils/logger.ts`
- Do not create new database tables without RLS policies
- Do not skip writing tests for new service methods
