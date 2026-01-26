# Citrus Fantasy Sports - Engineer Onboarding Guide

**Welcome to the Citrus Fantasy Sports development team!**

This document will get you up to speed on the codebase, architecture, and development workflow. By the end of this guide, you'll understand how the entire system works and be ready to contribute.

---

## 📚 Table of Contents

1. [Project Overview](#project-overview)
2. [Tech Stack](#tech-stack)
3. [Architecture Overview](#architecture-overview)
4. [Getting Started - Local Development](#getting-started---local-development)
5. [Database Schema & RLS](#database-schema--rls)
6. [Frontend Architecture](#frontend-architecture)
7. [Backend Data Pipeline](#backend-data-pipeline)
8. [Key Subsystems Explained](#key-subsystems-explained)
9. [Development Workflow](#development-workflow)
10. [Common Tasks & How-Tos](#common-tasks--how-tos)
11. [Troubleshooting](#troubleshooting)
12. [Resources & Links](#resources--links)

---

## 🎯 Project Overview

**What We're Building:**
Citrus Fantasy Sports is a **next-generation fantasy hockey platform** designed to compete with Yahoo Fantasy and ESPN. We provide:

- **Real-time NHL data**: Live stats updated every 30 seconds during games
- **Advanced analytics**: Expected Goals (xG), Expected Assists (xA), Goals Above Replacement (GAR), Goalie Saves Above Expected (GSAx)
- **Live draft rooms**: Real-time snake drafts with auto-pick functionality
- **Smart projections**: Machine learning-powered player projections using XGBoost models
- **Custom league settings**: Commissioner controls scoring, waiver systems, roster sizes
- **Waiver wire**: Rolling/FAAB/Reverse standings systems with concurrent processing
- **Trade analyzer**: Multi-player trade proposals with projection impact analysis

**Our Competitive Advantages:**
1. **Better Data**: We scrape NHL API directly (not delayed feeds)
2. **Better Analytics**: xG/xA models trained on MoneyPuck data
3. **Better UX**: Modern React UI with drag-and-drop, real-time updates
4. **Better Performance**: Optimized caching reduces egress by 88%

**Target Users:**
Hardcore fantasy hockey players in Canada who want deeper analytics and faster updates than Yahoo/ESPN provide.

**Current Status:**
- ✅ MVP complete (draft, roster management, matchups, waivers)
- ✅ Advanced analytics integrated (xG, xA, GAR, GSAx)
- ✅ Data recovery system (auto-rollback for corruption)
- 🚧 Security hardening (rate limiting, CAPTCHA, DDoS protection)
- 🚧 Performance optimization (egress reduction, query optimization)

---

## 🛠️ Tech Stack

### Frontend
- **Framework**: React 18.3 + TypeScript 5.5
- **Build Tool**: Vite 5.4
- **Styling**: Tailwind CSS 3.4 + Radix UI + shadcn/ui components
- **Routing**: React Router DOM 6.26
- **State Management**:
  - React Context (AuthContext, LeagueContext)
  - Zustand (notifications)
  - TanStack React Query 5.56 (data fetching/caching)
- **Forms**: React Hook Form + Zod validation
- **Drag & Drop**: @dnd-kit
- **Charts**: Recharts 2.12

### Backend & Database
- **Database**: PostgreSQL 15 (via Supabase)
- **Auth**: Supabase Auth (email/password + OAuth)
- **Real-time**: Supabase Channels (WebSocket subscriptions)
- **API**: Direct Supabase client calls (no separate REST API)
- **Edge Functions**: Supabase Functions (stormy-chat AI assistant)

### Data Pipeline
- **Language**: Python 3.11
- **Scheduler**: Windows Task Scheduler + PowerShell scripts
- **HTTP**: `requests` library with 100 rotating proxy IPs
- **Data Processing**: `pandas` for transformations
- **Database Access**: `psycopg2` for direct PostgreSQL queries
- **ML Models**: XGBoost (`joblib` serialized models)

### Hosting & Deployment
- **Frontend**: Firebase Hosting (https://citrus-fantasy-sports.web.app)
- **Database**: Supabase Cloud (`iezwazccqqrhrjupxzvf.supabase.co`)
- **Data Pipeline**: Windows server (scheduled tasks)

---

## 🏗️ Architecture Overview

### High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          USERS                                   │
│                     (Web Browsers)                               │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   FIREBASE HOSTING                               │
│            (Static Assets + SPA Routing)                         │
│         https://citrus-fantasy-sports.web.app                    │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                  REACT FRONTEND (Vite)                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Auth Context │  │League Context│  │ React Query  │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         └──────────────────┴──────────────────┘                 │
│                            │                                     │
│  ┌──────────────────────────────────────────────────┐           │
│  │          SERVICE LAYER (TypeScript)              │           │
│  │  PlayerService │ MatchupService │ DraftService   │           │
│  │  RosterService │ WaiverService  │ TradeService   │           │
│  └──────────────────────┬───────────────────────────┘           │
└─────────────────────────┼───────────────────────────────────────┘
                          │
                          ▼ (JWT in Authorization header)
┌─────────────────────────────────────────────────────────────────┐
│                    SUPABASE (Backend)                            │
│  ┌───────────────────────────────────────────────────┐          │
│  │            SUPABASE AUTH (JWT)                    │          │
│  │  - Email/Password login                           │          │
│  │  - OAuth (Google, Apple)                          │          │
│  │  - Session management                             │          │
│  └───────────────────────┬───────────────────────────┘          │
│                          │                                       │
│  ┌───────────────────────▼───────────────────────────┐          │
│  │      POSTGRESQL DATABASE (45+ tables)             │          │
│  │  ┌──────────────────────────────────────────────┐ │          │
│  │  │   ROW LEVEL SECURITY (RLS) POLICIES          │ │          │
│  │  │   - League isolation by league_id            │ │          │
│  │  │   - User data filtered by auth.uid()         │ │          │
│  │  │   - Commissioner privileges                  │ │          │
│  │  └──────────────────────────────────────────────┘ │          │
│  │                                                    │          │
│  │  Core Tables:                                     │          │
│  │  - profiles, leagues, teams                      │          │
│  │  - players, player_game_stats, player_season_stats│         │
│  │  - projections, player_projected_stats            │          │
│  │  - matchups, fantasy_matchup_lines                │          │
│  │  - draft_picks, waiver_claims                     │          │
│  │  - team_lineups, roster_transactions              │          │
│  └────────────────────────┬──────────────────────────┘          │
│                           │                                      │
│  ┌────────────────────────▼──────────────────────────┐          │
│  │        SUPABASE REALTIME (WebSockets)             │          │
│  │  - Draft room updates                             │          │
│  │  - Live score updates                             │          │
│  └───────────────────────────────────────────────────┘          │
└─────────────────────────┬───────────────────────────────────────┘
                          ▲
                          │ (Direct DB inserts)
┌─────────────────────────┴───────────────────────────────────────┐
│              PYTHON DATA PIPELINE                                │
│  ┌──────────────────────────────────────────────────┐           │
│  │   data_scraping_service.py (24/7 Windows Service)│           │
│  │   - Fetches NHL API every 30s-5min               │           │
│  │   - 100 rotating proxy IPs                       │           │
│  │   - Stores in raw_nhl_data, player_game_stats    │           │
│  └────────────────────┬─────────────────────────────┘           │
│                       │                                          │
│  ┌────────────────────▼─────────────────────────────┐           │
│  │   Nightly Jobs (Windows Task Scheduler)          │           │
│  │   - fetch_nhl_stats_from_landing.py (12 AM MT)   │           │
│  │   - fantasy_projection_pipeline.py (6 AM MT)     │           │
│  │   - calculate_matchup_scores.py (11 PM MT)       │           │
│  │   - process_waivers.py (3 AM local time)         │           │
│  └───────────────────────────────────────────────────┘          │
│                       ▲                                          │
│                       │                                          │
│  ┌────────────────────┴─────────────────────────────┐           │
│  │         NHL API (api-web.nhle.com)                │           │
│  │   - Play-by-play data                             │           │
│  │   - Boxscore stats                                │           │
│  │   - Schedule                                      │           │
│  └───────────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow Summary

**1. Data Collection (NHL → Database)**
```
NHL API → Python Scripts → raw_nhl_data → player_game_stats → player_season_stats
```

**2. Projections (Database → ML Models → Database)**
```
player_season_stats + xG models → fantasy_projection_pipeline.py → projections table
```

**3. Scoring (Database → Python → Database)**
```
player_game_stats + scoring_settings → calculate_matchup_scores.py → matchups table
```

**4. UI Display (Database → React)**
```
Supabase Database → React Query Cache → Service Layer → React Components → User
```

---

## 🚀 Getting Started - Local Development

### Prerequisites

1. **Node.js 18+** (for frontend)
2. **Python 3.11+** (for data pipeline)
3. **Git** (version control)
4. **Supabase CLI** (optional, for local database)

### Step 1: Clone the Repository

```bash
git clone https://github.com/Gstormsfh/citrus-league-storm-main.git
cd citrus-league-storm-main
```

### Step 2: Install Frontend Dependencies

```bash
npm install
```

This installs all React dependencies from `package.json`.

### Step 3: Set Up Environment Variables

Create a `.env` file in the root directory:

```bash
# Supabase Configuration
VITE_SUPABASE_URL=https://iezwazccqqrhrjupxzvf.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Firebase Configuration (optional, only needed for deployment)
VITE_FIREBASE_API_KEY=...
```

**Where to find these:**
- Supabase URL/Key: Supabase Dashboard → Settings → API
- Firebase config: Firebase Console → Project Settings

### Step 4: Run the Development Server

```bash
npm run dev
```

This starts Vite dev server at **http://localhost:8080**.

**Hot Module Replacement (HMR) is enabled** - changes to code auto-refresh the browser.

### Step 5: Set Up Python Environment (Optional - Only if Working on Data Pipeline)

```bash
# Create virtual environment
python -m venv venv

# Activate (Windows)
venv\Scripts\activate

# Activate (Mac/Linux)
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

**Key Python Packages:**
- `requests` - HTTP calls to NHL API
- `pandas` - Data manipulation
- `psycopg2` - PostgreSQL database access
- `APScheduler` - Job scheduling
- `xgboost` - ML models for xG/xA
- `joblib` - Model serialization

### Step 6: Access the Database (Supabase Dashboard)

1. Go to: https://supabase.com/dashboard/project/iezwazccqqrhrjupxzvf
2. Navigate to **Table Editor** to browse data
3. Navigate to **SQL Editor** to run queries
4. Navigate to **Database** → **Roles** to see RLS policies

**You can also connect directly via PostgreSQL:**
```bash
psql "postgresql://postgres:[PASSWORD]@db.iezwazccqqrhrjupxzvf.supabase.co:5432/postgres"
```

---

## 🗄️ Database Schema & RLS

### Core Tables (Must Know)

#### **User & League Tables**

**`profiles`** - User profile data
```sql
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ
);
```
- **RLS**: Users can only read/update their own profile
- **Trigger**: Auto-created when new user signs up

**`leagues`** - Fantasy league configuration
```sql
CREATE TABLE leagues (
  id UUID PRIMARY KEY,
  name TEXT,
  commissioner_id UUID REFERENCES profiles(id),
  status TEXT, -- 'setup', 'drafting', 'active', 'completed'
  scoring_settings JSONB, -- Custom scoring rules
  waiver_system TEXT, -- 'rolling', 'faab', 'reverse_standings'
  roster_size INTEGER,
  created_at TIMESTAMPTZ
);
```
- **RLS**: Users can only view leagues they're members of
- **Commissioner**: Has admin rights (update settings, force waiver runs)

**`teams`** - Fantasy teams within leagues
```sql
CREATE TABLE teams (
  id UUID PRIMARY KEY,
  league_id UUID REFERENCES leagues(id),
  owner_id UUID REFERENCES profiles(id),
  team_name TEXT,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  ties INTEGER DEFAULT 0
);
```
- **RLS**: Users can only view/update their own teams
- **League Isolation**: Enforced via `league_id`

#### **Player Data Tables**

**`players`** - NHL player master list
```sql
CREATE TABLE players (
  id UUID PRIMARY KEY,
  nhl_id INTEGER UNIQUE, -- Official NHL player ID
  name TEXT,
  team_id INTEGER, -- Current NHL team
  position_code TEXT, -- 'C', 'LW', 'RW', 'D', 'G'
  active BOOLEAN
);
```
- **RLS**: Public read (no restrictions)
- **Updated**: When new players enter NHL

**`player_game_stats`** - Per-game statistics
```sql
CREATE TABLE player_game_stats (
  id UUID PRIMARY KEY,
  player_id UUID REFERENCES players(id),
  game_id TEXT,
  game_date DATE,

  -- Parsed from Play-by-Play (fallback)
  goals INTEGER,
  assists INTEGER,
  shots INTEGER,
  blocks INTEGER,
  hits INTEGER,
  pim INTEGER,

  -- From NHL Landing API (source of truth)
  nhl_goals INTEGER,
  nhl_assists INTEGER,
  nhl_power_play_points INTEGER,
  nhl_short_handed_points INTEGER,
  nhl_shots INTEGER,
  nhl_blocks INTEGER,
  nhl_hits INTEGER,
  nhl_pim INTEGER,

  toi_seconds INTEGER
);
```
- **Dual-column design**: Falls back to PBP parsing if NHL API data missing
- **Query pattern**: `COALESCE(nhl_goals, goals, 0)` for reliability
- **Updated**: Every 30 seconds during games

**`player_season_stats`** - Season totals (SOURCE OF TRUTH)
```sql
CREATE TABLE player_season_stats (
  id UUID PRIMARY KEY,
  player_id UUID REFERENCES players(id),
  season_id TEXT, -- '2024-2025'
  games_played INTEGER,
  goals INTEGER,
  assists INTEGER,
  points INTEGER,
  power_play_points INTEGER,
  short_handed_points INTEGER,
  shots INTEGER,
  blocks INTEGER,
  hits INTEGER,
  pim INTEGER,
  plus_minus INTEGER
);
```
- **Updated**: Weekly aggregation from `player_game_stats`
- **Used for**: Player cards, season leaders, projections

#### **Projection Tables**

**`projections`** - Daily player projections (default scoring)
```sql
CREATE TABLE projections (
  id UUID PRIMARY KEY,
  player_id UUID REFERENCES players(id),
  projected_points_default_scoring NUMERIC,
  proj_goals NUMERIC,
  proj_assists NUMERIC,
  proj_ppp NUMERIC,
  proj_shots NUMERIC,
  proj_blocks NUMERIC,
  proj_hits NUMERIC,
  proj_pim NUMERIC,
  last_updated TIMESTAMPTZ
);
```
- **Updated**: Daily at 6 AM MT
- **Algorithm**: Bayesian regression + xG/xA + QoC adjustments

**`player_projected_stats`** - League-specific projections
```sql
CREATE TABLE player_projected_stats (
  id UUID PRIMARY KEY,
  player_id UUID REFERENCES players(id),
  league_id UUID REFERENCES leagues(id),
  total_projected_points NUMERIC, -- With league's scoring settings
  proj_goals NUMERIC,
  proj_assists NUMERIC,
  -- ... (same physical stats as projections table)
  projection_date DATE
);
```
- **Different from `projections`**: Applies league-specific scoring multipliers
- **Used for**: Trade analyzer, lineup optimizer

#### **Matchup Tables**

**`matchups`** - Weekly head-to-head matchups
```sql
CREATE TABLE matchups (
  id UUID PRIMARY KEY,
  league_id UUID REFERENCES leagues(id),
  week_number INTEGER,
  week_start DATE, -- Monday
  week_end DATE, -- Sunday
  team1_id UUID REFERENCES teams(id),
  team2_id UUID REFERENCES teams(id),
  team1_score NUMERIC,
  team2_score NUMERIC,
  winner_id UUID REFERENCES teams(id),
  last_calculated TIMESTAMPTZ
);
```
- **Updated**: Nightly at 11 PM MT
- **Scores**: Aggregated from active players only

**`fantasy_daily_rosters`** - Daily roster snapshots
```sql
CREATE TABLE fantasy_daily_rosters (
  id UUID PRIMARY KEY,
  team_id UUID REFERENCES teams(id),
  roster_date DATE,
  player_id UUID REFERENCES players(id),
  slot_type TEXT, -- 'active' or 'bench'
  slot_index INTEGER
);
```
- **Purpose**: Records which players were active each day (for scoring)
- **Created**: When user sets lineup before games start
- **Used by**: `calculate_matchup_scores.py` to filter active players

#### **Draft Tables**

**`draft_picks`** - All draft selections
```sql
CREATE TABLE draft_picks (
  id UUID PRIMARY KEY,
  league_id UUID REFERENCES leagues(id),
  team_id UUID REFERENCES teams(id),
  player_id UUID REFERENCES players(id),
  pick_number INTEGER,
  timestamp TIMESTAMPTZ
);
```
- **Indexed**: On `league_id` and `pick_number`
- **Real-time**: Broadcasts to all users in draft room via Supabase channels

**`draft_order`** - Snake draft order
```sql
CREATE TABLE draft_order (
  id UUID PRIMARY KEY,
  league_id UUID REFERENCES leagues(id),
  pick_number INTEGER,
  team_id UUID REFERENCES teams(id)
);
```
- **Generated**: When commissioner starts draft
- **Pattern**: Round 1 forward, Round 2 reverse, Round 3 forward...

#### **Roster Management Tables**

**`team_lineups`** - Current roster state
```sql
CREATE TABLE team_lineups (
  id UUID PRIMARY KEY,
  team_id UUID REFERENCES teams(id),
  player_id UUID REFERENCES players(id),
  slot_type TEXT, -- 'active', 'bench', 'ir'
  slot_index INTEGER, -- Position in lineup
  UNIQUE(team_id, player_id)
);
```
- **RLS**: Users can only modify their own team's lineup
- **Game Lock**: Changes blocked if player's game has started

**`roster_transactions`** - Transaction history
```sql
CREATE TABLE roster_transactions (
  id UUID PRIMARY KEY,
  team_id UUID REFERENCES teams(id),
  transaction_type TEXT, -- 'draft', 'waiver', 'trade', 'add', 'drop'
  player_id_added UUID,
  player_id_dropped UUID,
  timestamp TIMESTAMPTZ
);
```
- **Audit log**: Records all roster changes

#### **Waiver Tables**

**`waiver_claims`** - Submitted waiver claims
```sql
CREATE TABLE waiver_claims (
  id UUID PRIMARY KEY,
  league_id UUID REFERENCES leagues(id),
  team_id UUID REFERENCES teams(id),
  player_id_add UUID REFERENCES players(id),
  player_id_drop UUID REFERENCES players(id),
  status TEXT, -- 'pending', 'approved', 'rejected'
  priority INTEGER, -- User's priority at time of submission
  submitted_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ
);
```
- **Processed**: Nightly at 3 AM local time
- **Advisory Locks**: Prevents concurrent processing

**`waiver_priority`** - Team waiver order
```sql
CREATE TABLE waiver_priority (
  id UUID PRIMARY KEY,
  league_id UUID REFERENCES leagues(id),
  team_id UUID REFERENCES teams(id),
  priority INTEGER, -- 1 = highest priority
  UNIQUE(league_id, team_id)
);
```
- **Rolling System**: Team moves to end after successful claim
- **Reverse Standings**: Updated weekly based on win/loss record

#### **Advanced Stats Tables**

**`raw_shots`** - Shot-level data for xG calculations
```sql
CREATE TABLE raw_shots (
  id UUID PRIMARY KEY,
  game_id TEXT,
  player_id UUID,
  shot_type TEXT, -- 'wrist', 'slap', 'snap', 'backhand', 'tip', 'deflection'
  x_coord NUMERIC, -- Rink coordinates
  y_coord NUMERIC,
  shot_distance NUMERIC, -- Feet from net
  shot_angle NUMERIC, -- Degrees from center
  strength_state TEXT, -- 'EV', 'PP', 'SH'
  is_goal BOOLEAN,
  expected_goal NUMERIC, -- xG from ML model
  timestamp TIMESTAMPTZ
);
```
- **Source**: Parsed from NHL play-by-play API
- **xG Calculation**: `calculate_xg.py` runs XGBoost model on features

**`player_talent_metrics`** - Aggregated xG/xA
```sql
CREATE TABLE player_talent_metrics (
  id UUID PRIMARY KEY,
  player_id UUID REFERENCES players(id),
  season_id TEXT,
  total_xg NUMERIC,
  total_xa NUMERIC,
  sh_percent_above_expected NUMERIC, -- Shooting talent
  total_ixg NUMERIC, -- Individual xG (unassisted shots)
  primary_assist_rate NUMERIC
);
```
- **Updated**: Every 6 hours
- **Used for**: Projections, trade analyzer

**`goalie_gsax`** - Goalie Saves Above Expected
```sql
CREATE TABLE goalie_gsax (
  id UUID PRIMARY KEY,
  goalie_id UUID REFERENCES players(id),
  season_id TEXT,
  total_gsax NUMERIC, -- Sum of (actual save - expected save)
  gsax_per_60 NUMERIC, -- Per 60 minutes
  shots_faced INTEGER,
  saves INTEGER,
  save_percent NUMERIC
);
```
- **Calculation**: For each shot, `GSAx += (1 - xG)` if saved, else `GSAx -= xG`
- **Used for**: Goalie projections

### Row Level Security (RLS) Policies

**What is RLS?**
Row Level Security is a PostgreSQL feature that filters database queries **automatically** based on the authenticated user. It's our primary security mechanism.

**How it works:**
1. User logs in → Supabase issues JWT with `user_id`
2. User makes query → JWT sent in `Authorization` header
3. PostgreSQL extracts `user_id` from JWT via `auth.uid()`
4. RLS policy filters rows: `WHERE owner_id = auth.uid()`
5. User only sees their data

**Example RLS Policy:**

```sql
-- Users can only view their own teams
CREATE POLICY "Users can view their own teams"
ON teams FOR SELECT
USING (owner_id = auth.uid());

-- Users can view leagues they're members of
CREATE POLICY "Users can view their leagues"
ON leagues FOR SELECT
USING (
  id IN (
    SELECT league_id FROM teams WHERE owner_id = auth.uid()
  )
);

-- Commissioners can update league settings
CREATE POLICY "Commissioners can update their league"
ON leagues FOR UPDATE
USING (commissioner_id = auth.uid());
```

**Important Functions:**

```sql
-- Check if user owns a team in a league
CREATE FUNCTION user_owns_team_in_league_simple(p_league_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM teams
    WHERE league_id = p_league_id AND owner_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if user is commissioner of a league
CREATE FUNCTION is_commissioner_of_league(p_league_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM leagues
    WHERE id = p_league_id AND commissioner_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Where RLS is Defined:**
All RLS policies are in migrations:
- `/supabase/migrations/*_comprehensive_league_rls_fix.sql`
- `/supabase/migrations/*_add_rls_policies.sql`

**Testing RLS:**
```sql
-- Impersonate a user (in SQL editor)
SET request.jwt.claim.sub = 'user-uuid-here';

-- Now all queries will be filtered as if you're that user
SELECT * FROM teams; -- Only shows teams owned by user-uuid-here
```

---

## 🎨 Frontend Architecture

### Folder Structure

```
/src
├── components/          # Reusable UI components
│   ├── ui/             # shadcn/ui primitives (buttons, dialogs, etc.)
│   ├── auth/           # Login, signup, password strength
│   ├── draft/          # Draft board, draft controls
│   ├── roster/         # Lineup editor, player cards
│   ├── matchup/        # Matchup display, daily breakdown
│   └── icons/          # Custom icon components
│
├── pages/              # Route components (35+ pages)
│   ├── Index.tsx       # Landing page
│   ├── Auth.tsx        # Login/signup
│   ├── Roster.tsx      # Main roster management page
│   ├── DraftRoom.tsx   # Live draft room
│   ├── Matchup.tsx     # Weekly matchup view
│   ├── FreeAgents.tsx  # Free agent search
│   ├── WaiverWire.tsx  # Waiver claims
│   └── ...
│
├── services/           # Business logic & API calls (17 services)
│   ├── LeagueService.ts
│   ├── DraftService.ts
│   ├── PlayerService.ts
│   ├── RosterCacheService.ts
│   ├── MatchupService.ts
│   └── ...
│
├── contexts/           # React contexts
│   ├── AuthContext.tsx      # User authentication state
│   └── LeagueContext.tsx    # Current league selection
│
├── stores/             # Zustand stores
│   └── notificationStore.ts # Toast notifications
│
├── hooks/              # Custom React hooks
│   ├── useAuth.ts
│   ├── useLeague.ts
│   └── usePlayerSearch.ts
│
├── integrations/supabase/  # Supabase client & types
│   ├── client.ts       # Supabase client singleton
│   └── types.ts        # Generated TypeScript types from DB schema
│
├── types/              # TypeScript type definitions
│   ├── database.ts     # Database table types
│   ├── league.ts       # League-related types
│   └── player.ts       # Player-related types
│
├── utils/              # Utility functions
│   ├── calculations.ts # Fantasy point calculations
│   ├── formatting.ts   # Date/number formatting
│   └── validation.ts   # Input validation
│
├── lib/                # Library configurations
│   └── react-query.ts  # React Query config
│
├── App.tsx             # Root component with routing
└── main.tsx            # Application entry point
```

### Key Patterns

#### **1. Service Layer Pattern**

All API calls go through TypeScript services, not directly from components.

**Why?**
- Centralized business logic
- Easier testing
- Consistent error handling
- Prevents code duplication

**Example:**

```typescript
// ❌ BAD - Direct Supabase call in component
function Roster() {
  const { data } = useQuery(['lineup'], async () => {
    const { data, error } = await supabase
      .from('team_lineups')
      .select('*')
      .eq('team_id', teamId);
    if (error) throw error;
    return data;
  });
}

// ✅ GOOD - Service layer
// /src/services/RosterService.ts
export class RosterService {
  static async getLineup(teamId: string) {
    const { data, error } = await supabase
      .from('team_lineups')
      .select('*')
      .eq('team_id', teamId);
    if (error) throw new Error(`Failed to load lineup: ${error.message}`);
    return data;
  }
}

// /src/pages/Roster.tsx
function Roster() {
  const { data } = useQuery(['lineup', teamId], () =>
    RosterService.getLineup(teamId)
  );
}
```

#### **2. React Query for Data Fetching**

We use TanStack React Query for **all** data fetching.

**Why?**
- Automatic caching (reduces Supabase egress by 88%)
- Automatic refetching
- Loading/error states
- Optimistic updates

**Configuration** (`/src/lib/react-query.ts`):
```typescript
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,  // 5 minutes - data is "fresh"
      cacheTime: 10 * 60 * 1000, // 10 minutes - cache retained
      refetchOnWindowFocus: false, // Don't refetch on tab focus
      retry: 1, // Retry failed requests once
    },
  },
});
```

**Example Usage:**

```typescript
// Fetch player stats
const { data: playerStats, isLoading, error } = useQuery(
  ['playerStats', playerId], // Cache key
  () => PlayerService.getPlayerStats(playerId),
  {
    staleTime: 30000, // Override: 30 seconds for live stats
  }
);

// Mutation (for writes)
const mutation = useMutation(
  (lineup) => RosterService.updateLineup(teamId, lineup),
  {
    onSuccess: () => {
      // Invalidate cache to refetch
      queryClient.invalidateQueries(['lineup', teamId]);
    },
  }
);
```

#### **3. Context Providers**

We use React Context for **global state** that doesn't change often.

**AuthContext** (`/src/contexts/AuthContext.tsx`)
Manages user authentication state.

```typescript
interface AuthContextType {
  user: Profile | null;
  session: Session | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  loading: boolean;
}

// Usage in components
const { user, signIn } = useAuth();
```

**LeagueContext** (`/src/contexts/LeagueContext.tsx`)
Manages current league selection.

```typescript
interface LeagueContextType {
  currentLeague: League | null;
  setCurrentLeague: (leagueId: string) => void;
  userLeagues: League[];
  loading: boolean;
}

// Usage in components
const { currentLeague, setCurrentLeague } = useLeague();
```

#### **4. Real-time Subscriptions**

For live updates (draft room, matchup scores), we use Supabase Realtime.

**Example: Draft Room**

```typescript
// /src/pages/DraftRoom.tsx
useEffect(() => {
  const channel = supabase
    .channel('draft-room')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'draft_picks',
        filter: `league_id=eq.${leagueId}`,
      },
      (payload) => {
        // New pick made → Update UI
        setDraftPicks((prev) => [...prev, payload.new]);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, [leagueId]);
```

#### **5. Protected Routes**

All routes except `/auth` and `/` are protected.

**Implementation** (`/src/App.tsx`):

```typescript
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) return <LoadingSpinner />;
  if (!user) return <Navigate to="/auth" />;

  return <>{children}</>;
}

// Usage
<Route
  path="/roster"
  element={
    <ProtectedRoute>
      <Roster />
    </ProtectedRoute>
  }
/>
```

---

## ⚙️ Backend Data Pipeline

### Python Scripts Overview

**All Python scripts are in the root directory.**

#### **1. data_scraping_service.py** (24/7 Service)

**Purpose**: Continuously fetches NHL data during games.

**How it works:**
1. Checks current time and game states
2. Sets polling interval:
   - LIVE games: 30 seconds
   - Intermission: 60 seconds
   - FINAL games: 30 minutes (then 2-hour cache)
   - No games: 5 minutes
3. Fetches play-by-play + boxscore from NHL API
4. Uses rotating proxy pool (100 IPs)
5. Stores in `raw_nhl_data` and `player_game_stats`

**Installation** (Windows):
```powershell
# Run as Administrator
.\ops\windows\install_data_scraping_service.ps1
```

**Files:**
- Script: `/data_scraping_service.py`
- Installer: `/ops/windows/install_data_scraping_service.ps1`
- Logs: `C:\ProgramData\CitrusScraping\logs\`

#### **2. fetch_nhl_stats_from_landing.py** (Nightly 12 AM MT)

**Purpose**: Fetch accurate PPP/SHP from NHL's landing endpoint.

**Why needed?**
Play-by-play parsing can miss assists on power-play goals. The landing endpoint is the source of truth.

**What it does:**
1. Fetches `/stats/rest/en/skater/summary` for all games
2. Updates `nhl_*` columns in `player_game_stats`
3. Validates against PBP parsing (flags discrepancies)

**Runs via Windows Task Scheduler:**
```powershell
.\ops\windows\run_fetch_landing.ps1
```

#### **3. fantasy_projection_pipeline.py** (Daily 6 AM MT)

**Purpose**: Calculate daily player projections.

**Algorithm:**
1. Load historical stats (60-day window)
2. Apply Bayesian regression (shrinks small samples)
3. Incorporate xG/xA from `player_talent_metrics`
4. Adjust for opponent quality (QoC)
5. Multiply by games in next 7 days
6. Store in `projections` table

**Key Functions:**
- `calculate_skater_projections()` - Goals, assists, shots, etc.
- `calculate_goalie_projections()` - Starts, wins, saves, shutouts
- `apply_opponent_adjustments()` - Boost vs weak teams, reduce vs strong

**Output:**
- `projections` table (default scoring)
- `player_projected_stats` table (league-specific scoring)

#### **4. calculate_matchup_scores.py** (Nightly 11 PM MT)

**Purpose**: Calculate weekly fantasy matchup scores.

**What it does:**
1. Find all active matchups (current week)
2. For each matchup:
   - Get active players for each day (from `fantasy_daily_rosters`)
   - Sum their stats (from `player_game_stats`)
   - Apply league scoring settings (from `leagues.scoring_settings`)
   - Calculate daily totals
   - Sum to get weekly totals
3. Update `matchups.team1_score` and `matchups.team2_score`
4. Determine winner

**Performance Note:**
This script has N+1 query issues (see audit report). We plan to optimize with batch queries.

#### **5. calculate_xg.py** (Every 6 Hours)

**Purpose**: Calculate Expected Goals (xG) for all shots.

**ML Model:**
XGBoost trained on MoneyPuck data (`/models/xg_model_moneypuck.joblib`)

**Features Used:**
- Shot distance (Euclidean from net)
- Shot angle (degrees from center)
- Shot type (wrist, slap, snap, backhand, tip, deflection)
- Strength state (EV, PP, SH)
- Rush shot (boolean)
- Rebound shot (boolean)
- Traffic (defender within 5ft)

**Output:**
- Updates `raw_shots.expected_goal`
- Aggregates to `player_talent_metrics.total_xg`

#### **6. calculate_goalie_gsax.py** (Every 6 Hours)

**Purpose**: Calculate Goalie Saves Above Expected.

**Algorithm:**
```python
for each shot against goalie:
    expected_save_probability = 1 - xG
    if goalie_saved_it:
        gsax += (1 - expected_save_probability)  # Positive
    else:
        gsax += (0 - expected_save_probability)  # Negative
```

**Output:**
- `goalie_gsax` table

#### **7. process_waivers.py** (Nightly 3 AM Local)

**Purpose**: Process all pending waiver claims.

**Concurrency Protection:**
- Uses PostgreSQL advisory locks (`pg_try_advisory_xact_lock`)
- Prevents multiple instances from running simultaneously

**Algorithm:**
1. For each league:
   - Acquire lock (skip if already locked)
   - Load all pending claims sorted by priority
   - For each claim (in order):
     - Check if player is still available
     - If yes: Execute claim (add/drop), update priority
     - If no: Reject claim
   - Release lock

**Waiver Systems:**
- **Rolling**: Priority rotates (successful claimer moves to end)
- **FAAB**: Blind bidding (highest bid wins)
- **Reverse Standings**: Worst team always has priority

---

## 🔑 Key Subsystems Explained

### 1. Authentication & League Isolation

**How Users are Isolated:**

We use **multi-layer security** to ensure users can ONLY see their own league's data:

**Layer 1: Database RLS**
PostgreSQL automatically filters queries:
```sql
-- This query only returns leagues where user is a member
SELECT * FROM leagues; -- RLS policy applies
```

**Layer 2: Frontend Validation**
Before any league operation:
```typescript
await LeagueMembershipService.requireMembership(leagueId, userId);
// Throws error if user not in league
```

**Layer 3: RPC Function Validation**
Database functions validate before executing:
```sql
CREATE FUNCTION calculate_daily_matchup_scores(p_league_id UUID)
AS $$
BEGIN
  IF NOT user_owns_team_in_league_simple(p_league_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  -- ... function logic
END;
$$;
```

**Membership Caching:**
To avoid repeated queries, we cache membership for 30 seconds:
```typescript
// /src/services/LeagueMembershipService.ts
const CACHE_TTL = 30000; // 30 seconds
```

**Cache Invalidation:**
When user switches leagues, we clear the cache:
```typescript
LeagueMembershipService.clearCache();
queryClient.invalidateQueries(['league', oldLeagueId]);
```

### 2. Draft System

**How Snake Draft Works:**

1. **Draft Order Generation:**
   ```
   Round 1: Team1, Team2, ..., Team12
   Round 2: Team12, Team11, ..., Team1 [REVERSED]
   Round 3: Team1, Team2, ..., Team12
   ...
   ```

2. **Stored in `draft_order` table:**
   ```
   Pick 1 → Team 5
   Pick 2 → Team 3
   Pick 3 → Team 11
   ...
   Pick 240 → Team 8
   ```

3. **Real-time Updates:**
   - User makes pick → `INSERT INTO draft_picks`
   - Supabase broadcasts to all users in room
   - UI updates immediately

4. **Auto-Pick:**
   - 90-second timer per pick
   - If expires: Select best available by projections
   - `ORDER BY total_projected_points DESC LIMIT 1`

### 3. Waiver Wire

**How Rolling Waivers Work:**

**Initial Priority:**
Reverse draft order (last pick gets priority 1)

**When Claim Succeeds:**
1. Team's priority changes to lowest (end of line)
2. All teams renumbered (1, 2, 3, ...)

**Example:**
```
Initial:
  Team A: Priority 1
  Team B: Priority 2
  Team C: Priority 3

Team A claims Player X (approved):
  Team B: Priority 1 (moved up)
  Team C: Priority 2 (moved up)
  Team A: Priority 3 (moved to end)
```

**Concurrent Claim Resolution:**

Multiple teams can claim the same player. Processing order:
1. Sort by priority (1 first)
2. For ties, sort by timestamp (earlier first)
3. First team gets player, rest are rejected

**Advisory Locks Prevent Race Conditions:**
```python
# Only one process can acquire lock
conn.execute("SELECT pg_try_advisory_xact_lock(hashtext(%s))", [league_id])
```

### 4. Game Lock

**Purpose**: Prevent lineup changes after a player's game starts.

**How it works:**

1. User drags player to new slot
2. **Before** saving, check: `GameLockService.isPlayerLocked(player_id)`
3. Query `nhl_games` for player's team:
   ```sql
   SELECT game_state, game_time FROM nhl_games
   WHERE game_date = today
     AND (home_team_id = player.team_id OR away_team_id = player.team_id)
   ```
4. Check game state:
   - `LIVE`, `FINAL`, `CRIT` → LOCKED
   - `FUT`, `PRE` → Check if `NOW() > game_time` → LOCKED
5. If locked: Show error, cancel drag operation
6. If not locked: Save lineup change

**Visual Indicator:**
Locked players have a 🔒 icon and grayed-out appearance.

### 5. Scoring System

**How Fantasy Points are Calculated:**

**Step 1: Load Scoring Settings (JSONB)**
```json
{
  "skater": {
    "goals": 3,
    "assists": 2,
    "power_play_points": 1,
    "shots_on_goal": 0.4,
    "blocks": 0.5,
    "hits": 0.2,
    "penalty_minutes": 0.5
  },
  "goalie": {
    "wins": 4,
    "saves": 0.2,
    "shutouts": 3,
    "goals_against": -1
  }
}
```

**Step 2: Get Active Players for Each Day**
```sql
SELECT player_id FROM fantasy_daily_rosters
WHERE team_id = ? AND roster_date = ? AND slot_type = 'active'
```

**Step 3: Sum Stats for Active Players**
```sql
SELECT
  COALESCE(nhl_goals, goals, 0) as final_goals,
  COALESCE(nhl_assists, assists, 0) as final_assists,
  ...
FROM player_game_stats
WHERE player_id IN (active_players) AND game_date = ?
```

**Step 4: Apply Scoring Multipliers**
```python
daily_points = (
    (final_goals * settings['skater']['goals']) +
    (final_assists * settings['skater']['assists']) +
    (final_ppp * settings['skater']['power_play_points']) +
    (final_shots * settings['skater']['shots_on_goal']) +
    (final_blocks * settings['skater']['blocks']) +
    (final_hits * settings['skater']['hits']) +
    (final_pim * settings['skater']['penalty_minutes'])
)
```

**Step 5: Sum All 7 Days**
```python
weekly_total = sum(daily_points for each day Mon-Sun)
```

**Step 6: Update Matchup**
```sql
UPDATE matchups SET
  team1_score = weekly_total_team1,
  team2_score = weekly_total_team2,
  winner_id = CASE
    WHEN team1_score > team2_score THEN team1_id
    ELSE team2_id
  END
WHERE id = matchup_id
```

---

## 🛠️ Development Workflow

### Making Changes

**1. Create a Feature Branch**
```bash
git checkout -b feature/your-feature-name
```

**2. Make Changes**
- Edit code in `/src` (frontend) or Python scripts (backend)
- Test locally with `npm run dev`

**3. Test Your Changes**
- **Frontend**: Check in browser (http://localhost:8080)
- **Backend**: Run Python script manually
  ```bash
  python data_acquisition.py --test
  ```

**4. Commit & Push**
```bash
git add .
git commit -m "Add feature: description"
git push origin feature/your-feature-name
```

**5. Create Pull Request**
- Go to GitHub repository
- Click "Compare & pull request"
- Fill out PR template
- Request review from team

### Database Migrations

**When to create a migration:**
- Adding new tables
- Adding columns to existing tables
- Changing column types
- Adding RLS policies
- Creating database functions

**How to create a migration:**

1. **Via Supabase Dashboard:**
   - Go to SQL Editor
   - Write SQL
   - Click "Run"
   - Dashboard auto-creates migration file

2. **Via Supabase CLI:**
   ```bash
   supabase migration new add_new_table
   # Edit the created file in /supabase/migrations/
   ```

**Migration Naming Convention:**
```
YYYYMMDDHHMMSS_description.sql
```
Example: `20260126120000_add_trade_veto_table.sql`

**Example Migration:**

```sql
-- Add trade veto functionality

-- Create table
CREATE TABLE trade_vetoes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trade_id UUID REFERENCES trade_offers(id),
  user_id UUID REFERENCES profiles(id),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add RLS
ALTER TABLE trade_vetoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view vetoes in their league"
ON trade_vetoes FOR SELECT
USING (
  trade_id IN (
    SELECT id FROM trade_offers WHERE league_id IN (
      SELECT league_id FROM teams WHERE owner_id = auth.uid()
    )
  )
);

-- Add index
CREATE INDEX idx_trade_vetoes_trade_id ON trade_vetoes(trade_id);
```

**Running Migrations:**

Migrations run automatically when pushed to Supabase, but you can run manually:

```bash
supabase db push
```

### Testing

**Frontend Testing:**
1. Open http://localhost:8080
2. Test user flows (login, draft, roster, matchup)
3. Check browser console for errors (F12)
4. Test in Chrome, Firefox, Safari

**Backend Testing:**

**Python Scripts:**
```bash
# Test data scraping
python data_scraping_service.py --dry-run

# Test projections
python fantasy_projection_pipeline.py --league-id <uuid>

# Test matchup scoring
python calculate_matchup_scores.py --week 1
```

**Database Testing:**
```sql
-- Test RLS (impersonate user)
SET request.jwt.claim.sub = 'user-uuid';
SELECT * FROM teams; -- Should only show user's teams
```

**Edge Cases to Test:**
- Empty states (no players, no leagues)
- Game lock edge cases (game just started)
- Concurrent waiver claims
- Large leagues (20+ teams)
- Mobile responsiveness

### Debugging

**Frontend Debugging:**

**React DevTools:**
1. Install React DevTools Chrome extension
2. Open DevTools (F12) → React tab
3. Inspect component state, props, context

**React Query DevTools:**
```typescript
// Already enabled in dev mode
// Shows all queries, cache status, refetch triggers
```

**Console Logging:**
```typescript
console.log('User:', user);
console.log('Current League:', currentLeague);
```

**Backend Debugging:**

**Python Logging:**
```python
import logging
logging.basicConfig(level=logging.DEBUG)

logger = logging.getLogger(__name__)
logger.debug(f"Fetching game {game_id}")
```

**Database Logging:**
```sql
-- Enable query logging (Supabase Dashboard → Settings → Database → Query Logging)
-- View logs in Dashboard → Logs
```

**Common Issues:**

**Issue**: "Access denied" errors
**Solution**: Check RLS policies, verify user is in league

**Issue**: Stale data in UI
**Solution**: Invalidate React Query cache
```typescript
queryClient.invalidateQueries(['key']);
```

**Issue**: "Player already drafted" in draft
**Solution**: Check for race condition, ensure proper row locking

**Issue**: Matchup scores not updating
**Solution**: Check if `calculate_matchup_scores.py` ran, check logs

---

## 📝 Common Tasks & How-Tos

### Adding a New Stat Category

**Example: Add "faceoff wins" to scoring**

**1. Update Database Schema:**

Create migration: `supabase/migrations/YYYYMMDDHHMMSS_add_faceoff_wins.sql`

```sql
-- Add column to player_game_stats
ALTER TABLE player_game_stats
ADD COLUMN faceoff_wins INTEGER DEFAULT 0;

-- Add column to player_season_stats
ALTER TABLE player_season_stats
ADD COLUMN faceoff_wins INTEGER DEFAULT 0;

-- Add to projections
ALTER TABLE projections
ADD COLUMN proj_faceoff_wins NUMERIC DEFAULT 0;
```

**2. Update Data Collection Script:**

Edit `data_acquisition.py`:
```python
def parse_boxscore(boxscore_json):
    # ... existing code
    faceoff_wins = player_data.get('faceoffWins', 0)

    # Store in player_game_stats
    db.insert('player_game_stats', {
        'player_id': player_id,
        'faceoff_wins': faceoff_wins,
        # ... other columns
    })
```

**3. Update Projection Pipeline:**

Edit `fantasy_projection_pipeline.py`:
```python
def calculate_skater_projections(player_id):
    # ... existing code
    proj_faceoff_wins = (total_faceoff_wins / games_played) * games_next_7_days

    return {
        # ... other projections
        'proj_faceoff_wins': proj_faceoff_wins
    }
```

**4. Update Scoring Calculation:**

Edit `calculate_matchup_scores.py`:
```python
scoring_settings = league['scoring_settings']
faceoff_wins_points = scoring_settings['skater'].get('faceoff_wins', 0)

daily_points = (
    # ... existing calculations
    (faceoff_wins * faceoff_wins_points)
)
```

**5. Update Frontend Types:**

Regenerate types from database:
```bash
supabase gen types typescript --project-id iezwazccqqrhrjupxzvf > src/integrations/supabase/types.ts
```

**6. Update UI:**

Add to scoring settings form (`/src/pages/GmOffice.tsx`):
```tsx
<Input
  label="Faceoff Wins"
  type="number"
  step="0.1"
  value={scoringSettings.skater.faceoff_wins}
  onChange={(e) => updateScoringSetting('skater', 'faceoff_wins', e.target.value)}
/>
```

**7. Deploy:**
```bash
# Frontend
npm run build
npm run deploy

# Backend: Python scripts auto-pick up changes on next run
```

### Adding a New Page

**Example: Add "Team Comparison" page**

**1. Create Component:**

Create `/src/pages/TeamComparison.tsx`:
```tsx
import { useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

export default function TeamComparison() {
  const { team1Id, team2Id } = useParams();
  const { user } = useAuth();

  // Fetch team data
  const { data: team1 } = useQuery(['team', team1Id], () =>
    TeamService.getTeam(team1Id)
  );

  const { data: team2 } = useQuery(['team', team2Id], () =>
    TeamService.getTeam(team2Id)
  );

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Team Comparison</h1>
      {/* Comparison UI */}
    </div>
  );
}
```

**2. Add Route:**

Edit `/src/App.tsx`:
```tsx
import TeamComparison from './pages/TeamComparison';

// Inside <Routes>
<Route
  path="/team-comparison/:team1Id/:team2Id"
  element={
    <ProtectedRoute>
      <TeamComparison />
    </ProtectedRoute>
  }
/>
```

**3. Add Navigation Link:**

Edit `/src/components/Navigation.tsx`:
```tsx
<Link to={`/team-comparison/${myTeamId}/${opponentTeamId}`}>
  Compare Teams
</Link>
```

**4. Test:**
```bash
npm run dev
# Navigate to http://localhost:8080/team-comparison/uuid1/uuid2
```

### Running Data Pipeline Manually

**Full Pipeline (All Steps):**
```bash
# 1. Scrape NHL data
python data_acquisition.py

# 2. Fetch landing stats (PPP/SHP)
python fetch_nhl_stats_from_landing.py

# 3. Build season stats
python build_player_season_stats.py

# 4. Calculate xG
python calculate_xg.py

# 5. Calculate GSAx
python calculate_goalie_gsax.py

# 6. Calculate projections
python fantasy_projection_pipeline.py

# 7. Calculate matchup scores
python calculate_matchup_scores.py
```

**Individual Steps:**

**Fetch single game:**
```bash
python data_acquisition.py --game-id 2024020123
```

**Recalculate projections for one league:**
```bash
python fantasy_projection_pipeline.py --league-id <uuid>
```

**Recalculate matchup scores for one week:**
```bash
python calculate_matchup_scores.py --week 15
```

---

## 🐛 Troubleshooting

### Common Errors

**Error: "Row Level Security policy violation"**

**Cause:** User trying to access data they don't own.

**Debug:**
1. Check if user is logged in: `console.log(user)`
2. Check if user is in league: Query `teams` table
3. Verify RLS policy exists: Supabase Dashboard → Database → Policies
4. Test RLS: Impersonate user in SQL editor
   ```sql
   SET request.jwt.claim.sub = 'user-uuid';
   SELECT * FROM teams; -- What does user see?
   ```

**Fix:**
- If user should have access: Fix RLS policy
- If user shouldn't have access: Fix frontend validation

---

**Error: "Player already drafted"**

**Cause:** Race condition in draft (two users picked same player simultaneously).

**Debug:**
1. Check `draft_picks` table for duplicate `player_id`
2. Check if row locking is working:
   ```sql
   SELECT * FROM draft_picks
   WHERE league_id = ? AND player_id = ?
   FOR UPDATE SKIP LOCKED;
   ```

**Fix:**
- Ensure `UNIQUE(league_id, player_id)` constraint exists
- Add transaction locking in DraftService

---

**Error: "Stale data in UI"**

**Cause:** React Query cache not invalidated after mutation.

**Debug:**
1. Open React Query DevTools (bottom of page)
2. Check "Queries" tab → Find your query
3. Check "Data Updated At" timestamp
4. Check if "staleTime" has expired

**Fix:**
```typescript
const mutation = useMutation(updateFunction, {
  onSuccess: () => {
    queryClient.invalidateQueries(['key']); // Force refetch
  },
});
```

---

**Error: "NHL API rate limit exceeded"**

**Cause:** Too many requests to NHL API.

**Debug:**
1. Check proxy health: `python monitor_proxy_health.py`
2. Check circuit breaker status (logs)
3. Verify polling interval in `data_scraping_service.py`

**Fix:**
- Increase polling interval (30s → 60s)
- Add more proxy IPs to pool
- Implement exponential backoff

---

**Error: "Waiver claim processed twice"**

**Cause:** Concurrent processing without advisory lock.

**Debug:**
1. Check if multiple instances of `process_waivers.py` are running
2. Check advisory lock acquisition:
   ```sql
   SELECT * FROM pg_locks WHERE locktype = 'advisory';
   ```

**Fix:**
- Ensure only one scheduled task runs
- Verify advisory lock in code:
  ```python
  lock_acquired = conn.execute(
      "SELECT pg_try_advisory_xact_lock(hashtext(%s))",
      [league_id]
  ).scalar()
  if not lock_acquired:
      return  # Skip, another process is running
  ```

---

### Performance Issues

**Issue: Slow query performance**

**Debug:**
1. Enable query logging (Supabase Dashboard)
2. Find slow query in logs
3. Run `EXPLAIN ANALYZE`:
   ```sql
   EXPLAIN ANALYZE
   SELECT * FROM player_game_stats WHERE player_id = ?;
   ```

**Common Fixes:**
- Add index: `CREATE INDEX idx_player_game_stats_player_id ON player_game_stats(player_id)`
- Use joins instead of N+1 queries
- Add pagination: `LIMIT 50 OFFSET 0`

---

**Issue: High egress costs**

**Causes:**
- Too many Supabase queries
- Large payloads
- No caching

**Debug:**
1. Check Supabase Dashboard → Settings → Usage
2. Identify top queries by data transferred
3. Check React Query cache hit rate (DevTools)

**Fixes:**
- Increase React Query `staleTime`
- Use `select()` to fetch only needed columns:
  ```typescript
  .select('id, name, goals, assists') // Not .select('*')
  ```
- Enable frontend caching (already done)
- Reduce polling frequency

---

## 📚 Resources & Links

### Official Documentation

- **React**: https://react.dev
- **TypeScript**: https://www.typescriptlang.org/docs
- **Supabase**: https://supabase.com/docs
- **React Query**: https://tanstack.com/query/latest/docs/react/overview
- **Tailwind CSS**: https://tailwindcss.com/docs
- **Vite**: https://vitejs.dev/guide

### Our Documentation

- **System Flowcharts**: `/docs/SYSTEM_FLOWCHARTS.md`
- **xG Pipeline**: `/docs/README_XG_PIPELINE.md`
- **Operations Guide**: `/OPERATIONS.md`
- **Start Here**: `/START_HERE.md`

### Internal Resources

- **Supabase Dashboard**: https://supabase.com/dashboard/project/iezwazccqqrhrjupxzvf
- **Firebase Console**: https://console.firebase.google.com/project/citrus-fantasy-sports
- **GitHub Repository**: https://github.com/Gstormsfh/citrus-league-storm-main
- **Production App**: https://citrus-fantasy-sports.web.app

### Helpful Tools

- **React DevTools**: Chrome extension for debugging React
- **PostgreSQL Client**: TablePlus, DBeaver, or pgAdmin
- **API Testing**: Postman or Insomnia
- **JSON Viewer**: Chrome extension for pretty-printing JSON

---

## 🎓 Learning Path for New Engineers

### Week 1: Orientation
- [ ] Read this document end-to-end
- [ ] Set up local development environment
- [ ] Run the app locally, create test account
- [ ] Explore Supabase dashboard (tables, RLS policies)
- [ ] Read `/docs/SYSTEM_FLOWCHARTS.md`

### Week 2: Frontend Deep Dive
- [ ] Understand React component structure
- [ ] Trace data flow: Click button → API call → UI update
- [ ] Read service layer files (`/src/services/`)
- [ ] Make a small UI change (e.g., add a button)
- [ ] Understand AuthContext and LeagueContext

### Week 3: Backend Deep Dive
- [ ] Run Python data pipeline manually
- [ ] Trace data flow: NHL API → Database → UI
- [ ] Understand xG calculation (`calculate_xg.py`)
- [ ] Understand matchup scoring (`calculate_matchup_scores.py`)
- [ ] Read database migration files

### Week 4: Security & Performance
- [ ] Study RLS policies (`comprehensive_league_rls_fix.sql`)
- [ ] Test RLS by impersonating users
- [ ] Understand React Query caching strategy
- [ ] Profile query performance (EXPLAIN ANALYZE)
- [ ] Understand concurrency control (advisory locks)

### Week 5: Feature Development
- [ ] Pick a small feature from backlog
- [ ] Design the implementation (frontend + backend)
- [ ] Write code, test locally
- [ ] Create PR, get code review
- [ ] Deploy to production

---

## 🚀 You're Ready!

You now have a comprehensive understanding of the Citrus Fantasy Sports codebase. Here's a quick recap:

**Frontend:**
- React + TypeScript + Vite
- Service layer pattern
- React Query for caching
- Context for global state
- Real-time subscriptions

**Backend:**
- Supabase (PostgreSQL + Auth + Realtime)
- Python data pipeline (24/7 scraping)
- XGBoost ML models for xG/xA
- Advisory locks for concurrency
- RLS for security

**Data Flow:**
- NHL API → Python → Database → React Query → UI
- Projections: Historical stats + xG + Bayesian regression
- Scoring: Active players + stats + league settings
- Security: RLS + frontend validation + RPC validation

**Key Files to Bookmark:**
- `/src/App.tsx` - Routing
- `/src/services/` - All API calls
- `/supabase/migrations/` - Database schema
- `data_scraping_service.py` - NHL data collection
- `fantasy_projection_pipeline.py` - Projections
- `calculate_matchup_scores.py` - Fantasy scoring

**Next Steps:**
1. Set up your local environment
2. Make a test change (add a console.log, change a button color)
3. Pick a small bug or feature to work on
4. Ask questions in team chat
5. Read the codebase daily

**Welcome to the team! Let's build the best fantasy hockey platform in Canada.** 🏒🔥
