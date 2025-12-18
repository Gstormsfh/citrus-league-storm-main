# Backend Integration Guide

## Overview
This fantasy sports application (CitrusSports) is a fully-functional frontend with mock data. All pages are complete and ready for backend integration. This guide outlines the structure and data requirements for implementing the backend.

## Technology Stack
- **Frontend**: React, TypeScript, Tailwind CSS, Vite
- **Backend**: Supabase (already connected)
- **Database**: PostgreSQL (via Supabase)
- **Authentication**: Supabase Auth
- **Real-time**: Supabase Realtime subscriptions

## Project Structure

```
src/
├── components/           # Reusable UI components
│   ├── ui/              # Shadcn UI components
│   ├── draft/           # Draft-specific components
│   ├── gm-office/       # GM Office components
│   └── matchup/         # Matchup view components
├── pages/               # Main application pages
├── hooks/               # Custom React hooks
├── lib/                 # Utility functions
└── integrations/
    └── supabase/        # Supabase client setup
```

## Pages & Data Requirements

### 1. Landing Page (`/`)
**File**: `src/pages/Index.tsx`
**Purpose**: Marketing/home page with hero, features, testimonials, CTA
**Backend Needs**: 
- None (static content)
- Optional: CMS for dynamic content management

### 2. Profile (`/profile`)
**File**: `src/pages/Profile.tsx`
**Purpose**: User profile management
**Current Mock Data**:
```typescript
{
  name: string,
  email: string,
  joinDate: string,
  teamName: string,
  leagueName: string,
  stats: {
    seasonRecord: { wins: number, losses: number },
    totalPoints: number,
    averagePoints: number,
    playoffAppearances: number
  },
  achievements: Array<{ title: string, description: string, date: string, icon: string }>
}
```

**Required Database Tables**:
- `profiles` (user_id, name, email, team_name, league_name, join_date)
- `season_stats` (user_id, season, wins, losses, total_points, avg_points, playoff_appearances)
- `achievements` (id, user_id, title, description, date, icon_name, earned_at)

### 3. Roster Management (`/roster`)
**File**: `src/pages/Roster.tsx`
**Purpose**: View and manage team lineup
**Current Mock Data**:
```typescript
{
  position: string,      // QB, RB, WR, TE, K, DST
  name: string,
  team: string,         // NFL team abbreviation
  opponent: string,     // Matchup info
  projectedPoints: number,
  status: 'starter' | 'bench',
  isLocked: boolean     // Game started
}
```

**Required Database Tables**:
- `rosters` (id, user_id, season, week)
- `roster_players` (roster_id, player_id, position_slot, is_starter)
- `players` (id, name, nfl_team, position, projected_points, bye_week)
- `matchups` (week, nfl_team_id, opponent_id, game_time)

**Key Features to Implement**:
- Drag-and-drop player positioning
- Lock players when games start
- Real-time score updates during games

### 4. GM Office (`/gm-office`)
**File**: `src/pages/GMOffice.tsx`
**Purpose**: Command center with team stats, news, analysis
**Current Mock Data**:
```typescript
{
  stats: {
    currentRank: number,
    weeklyPoints: number,
    projectedWin: number,
    rosterHealth: number
  },
  recentActivity: Array<{ type: 'add' | 'drop' | 'trade', player: string, date: string }>,
  teamNews: Array<{ title: string, date: string, description: string, impact: 'positive' | 'negative' | 'neutral' }>,
  transactions: Array<{ team: string, type: string, player: string, date: string }>
}
```

**Required Database Tables**:
- `weekly_stats` (user_id, week, rank, points, projected_win)
- `roster_transactions` (user_id, type, player_id, timestamp)
- `league_transactions` (league_id, team_id, type, player_id, timestamp)
- `player_news` (player_id, title, description, impact, published_at)

### 5. Draft Room (`/draft`)
**File**: `src/pages/DraftRoom.tsx`
**Purpose**: Live fantasy draft interface
**Current Mock Data**:
```typescript
{
  draftSettings: {
    format: 'snake' | 'linear',
    pickTimeLimit: number,     // seconds
    totalRounds: number,
    teamsCount: number
  },
  teams: Array<{
    id: number,
    name: string,
    owner: string,
    pickOrder: number
  }>,
  draftPicks: Array<{
    round: number,
    pick: number,
    team: string,
    player: string,
    position: string,
    timestamp: Date
  }>,
  availablePlayers: Array<{ /* same as roster players */ }>
}
```

**Required Database Tables**:
- `draft_settings` (league_id, format, pick_time_limit, total_rounds, draft_date)
- `draft_picks` (draft_id, round, pick, team_id, player_id, timestamp)
- `draft_board` (draft_id, status, current_round, current_pick, current_team_id)

**Key Features to Implement**:
- Real-time draft updates (Supabase Realtime)
- Auto-pick functionality with timer
- Draft history tracking
- Snake draft pick order calculation

### 6. Matchup View (`/matchup`)
**File**: `src/pages/Matchup.tsx`
**Purpose**: Head-to-head matchup display
**Current Mock Data**:
```typescript
{
  myTeam: Array<{ player: string, position: string, points: number, status: 'playing' | 'bye' | 'injured' }>,
  opponentTeam: Array<{ /* same structure */ }>,
  scores: {
    myScore: number,
    opponentScore: number
  },
  dailyPoints: Array<{ day: string, myPoints: number, oppPoints: number }>,
  liveUpdates: Array<{ time: string, player: string, event: string, points: number }>
}
```

**Required Database Tables**:
- `matchups` (id, league_id, week, team1_id, team2_id, team1_score, team2_score, status)
- `player_performances` (player_id, week, game_id, points, stats_json, last_updated)
- `scoring_events` (matchup_id, player_id, event_type, points, timestamp)

**Key Features to Implement**:
- Real-time score updates during games
- Live play-by-play events
- Daily point accumulation tracking

### 7. Standings (`/standings`)
**File**: `src/pages/Standings.tsx`
**Purpose**: League rankings and statistics
**Current Mock Data**:
```typescript
{
  teams: Array<{
    id: number,
    name: string,
    owner: string,
    record: { wins: number, losses: number },
    points: number,
    streak: string    // e.g., "W4", "L2"
  }>
}
```

**Required Database Tables**:
- `league_standings` (league_id, season, team_id, wins, losses, points_for, points_against)
- `weekly_results` (week, team_id, points, opponent_id, result)

### 8. Free Agents (`/free-agents`)
**File**: `src/pages/FreeAgents.tsx`
**Purpose**: Browse and add available players
**Current Mock Data**:
```typescript
{
  players: Array<{
    id: number,
    name: string,
    position: string,
    team: string,
    opponent: string,
    projectedPoints: number,
    stats: object,    // Position-specific stats
    trend: 'up' | 'down' | 'neutral',
    rostered: number  // % rostered in leagues
  }>
}
```

**Required Database Tables**:
- `players` (comprehensive player database)
- `player_stats` (player_id, season, week, stat_type, value)
- `roster_ownership` (player_id, rostered_percentage, updated_at)
- `waiver_claims` (user_id, player_id, priority, status, timestamp)

### 9. Team Settings (`/team-settings`)
**File**: `src/pages/TeamSettings.tsx`
**Purpose**: Customize team info and preferences
**Current Mock Data**:
```typescript
{
  teamName: string,
  teamAbbreviation: string,
  teamDescription: string,
  teamLogo: string,
  primaryColor: string,
  secondaryColor: string,
  notifications: {
    email: boolean,
    push: boolean,
    tradealerts: boolean,
    scoreUpdates: boolean
  }
}
```

**Required Database Tables**:
- `team_settings` (user_id, team_name, abbreviation, description, logo_url, primary_color, secondary_color)
- `notification_preferences` (user_id, email_enabled, push_enabled, trade_alerts, score_updates)

### 10. News (`/news`)
**File**: `src/pages/News.tsx`
**Purpose**: Fantasy sports news and analysis
**Current Mock Data**:
- News articles
- Analysis pieces
- Injury reports
- Strategy guides
- Trade recommendations

**Required Database Tables**:
- `news_articles` (id, title, content, category, author, published_at, featured)
- `player_injuries` (player_id, injury_type, severity, status, updated_at)
- `trade_analysis` (player1_id, player2_id, analysis, recommendation, created_at)

### 11. Blog (`/blog`)
**File**: `src/pages/Blog.tsx`
**Purpose**: Fantasy sports blog with categories and search
**Required Database Tables**:
- `blog_posts` (id, title, excerpt, content, image_url, category, author, tags, published_at)
- `blog_categories` (id, name, slug)

### 12. Guides (`/guides`)
**File**: `src/pages/Guides.tsx`
**Purpose**: Strategy guides by skill level
**Required Database Tables**:
- `strategy_guides` (id, title, description, difficulty_level, content, icon, created_at)

### 13. Podcasts (`/podcasts`)
**File**: `src/pages/Podcasts.tsx`
**Purpose**: Podcast episodes listing
**Required Database Tables**:
- `podcast_episodes` (id, title, description, audio_url, cover_image, duration, published_at, featured)

### 14. Contact (`/contact`)
**File**: `src/pages/Contact.tsx`
**Purpose**: Contact form
**Required Database Tables**:
- `contact_submissions` (id, name, email, subject, message, submitted_at, status)

## Authentication Flow

### Required Implementation:
1. **Sign Up / Sign In**
   - Email/password authentication
   - OAuth (Google, Apple, etc.)
   - Email verification

2. **Protected Routes**
   - All pages except Index, Blog, Guides, Podcasts, Contact should require authentication
   - Redirect to login if not authenticated

3. **Profile Creation**
   - After sign-up, prompt for team name and league selection
   - Create initial profile and team settings

### Suggested Auth Component Structure:
```typescript
// src/components/Auth/SignIn.tsx
// src/components/Auth/SignUp.tsx
// src/components/Auth/ProtectedRoute.tsx
// src/hooks/useAuth.tsx
```

## Database Schema Priority

### Phase 1 - Core Functionality:
1. Authentication & Profiles
2. Players database
3. Rosters & lineup management
4. Matchups & scoring

### Phase 2 - Enhanced Features:
5. Draft functionality
6. Free agency & waivers
7. Transactions & trades
8. Standings & statistics

### Phase 3 - Content & Engagement:
9. News & articles
10. Notifications system
11. Social features (comments, forums)

## Real-Time Features (Supabase Realtime)

### Critical Real-Time Subscriptions:
1. **Live Scoring** (`player_performances` table)
   - Subscribe to score updates during games
   - Update matchup totals in real-time

2. **Draft Room** (`draft_picks` table)
   - Broadcast picks to all participants
   - Update available players list

3. **Transactions** (`roster_transactions` table)
   - Notify league of waiver claims
   - Alert users of trade proposals

### Implementation Example:
```typescript
// Subscribe to live score updates
const subscription = supabase
  .channel('player_scores')
  .on('postgres_changes', 
    { event: 'UPDATE', schema: 'public', table: 'player_performances' },
    (payload) => {
      // Update UI with new scores
    }
  )
  .subscribe();
```

## API Endpoints Needed

### External Data Sources:
1. **NFL Stats API** - Live game data and player statistics
2. **Injury Reports** - Player health status
3. **Projections** - Weekly player projections
4. **Team Schedules** - NFL game schedules

### Suggested Integration:
- Create Supabase Edge Functions to fetch and cache external data
- Update player stats periodically (every 5-10 minutes during games)
- Store projections weekly for performance

## Scoring System

### Default Scoring Rules (Configurable):
```typescript
{
  passing: {
    yards: 0.04,      // per yard
    touchdowns: 4,
    interceptions: -2
  },
  rushing: {
    yards: 0.1,
    touchdowns: 6
  },
  receiving: {
    receptions: 0.5,  // PPR
    yards: 0.1,
    touchdowns: 6
  },
  kicking: {
    fieldGoal: 3,
    extraPoint: 1
  },
  defense: {
    sack: 1,
    interception: 2,
    fumbleRecovery: 2,
    touchdown: 6,
    pointsAllowed: [10, 7, 4, 1, 0, -1, -4]  // Tiered by points
  }
}
```

**Required Tables**:
- `scoring_settings` (league_id, scoring_type, custom_rules_json)

## Security Considerations

### Row Level Security (RLS) Policies:
1. **Profiles**: Users can only read/update their own profile
2. **Rosters**: Users can only modify their own roster
3. **Matchups**: Users can view their league's matchups
4. **Draft**: Participants can only draft for their own team
5. **Transactions**: Users can only create transactions for their team

### Example RLS Policy:
```sql
-- Users can only update their own roster
CREATE POLICY "Users can update own roster" ON rosters
  FOR UPDATE USING (auth.uid() = user_id);
```

## Environment Variables

Required in `.env`:
```bash
# Already configured
SUPABASE_URL=https://iezwazccqqrhrjupxzvf.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_key_here

# To be added for external APIs
VITE_NFL_API_KEY=your_api_key
VITE_STATS_API_URL=https://api.example.com
```

## Testing Checklist

Before going live:
- [ ] User registration and authentication flow
- [ ] Profile creation and editing
- [ ] Roster CRUD operations
- [ ] Draft functionality with multiple users
- [ ] Real-time score updates
- [ ] Waiver claim processing
- [ ] Trade proposals and acceptance
- [ ] Weekly matchup generation
- [ ] Standings calculation
- [ ] Notification delivery
- [ ] Mobile responsiveness
- [ ] Performance under load (100+ concurrent users)

## Deployment Notes

### Frontend (Already Deployed):
- Hosted on Firebase Hosting
- Deploy with: `npm run deploy`
- Live URL: https://citrus-fantasy-sports.web.app

### Backend Setup:
1. Configure Supabase project
2. Run migrations for database schema
3. Set up RLS policies
4. Deploy Edge Functions for external API integrations
5. Configure Supabase Auth providers
6. Set up scheduled jobs (cron) for:
   - Weekly matchup generation
   - Waiver processing
   - Stats updates during game days

## Next Steps

1. **Start with Authentication**
   - Implement Supabase Auth
   - Create protected route wrapper
   - Build login/signup UI

2. **Core Database Schema**
   - Design and create primary tables
   - Set up RLS policies
   - Seed with sample data

3. **Connect One Page at a Time**
   - Replace mock data with real queries
   - Test CRUD operations
   - Verify real-time features

4. **External Integrations**
   - Set up NFL stats API
   - Create Edge Functions for data fetching
   - Implement caching strategy

## Resources

- **Supabase Docs**: https://supabase.com/docs
- **React Query (for data fetching)**: https://tanstack.com/query/latest
- **Supabase Realtime**: https://supabase.com/docs/guides/realtime

## Questions?

Reach out if you need clarification on any component or data structure. The frontend is fully functional with mock data, so you can test the UX while building out the backend.

Good luck! 🚀
