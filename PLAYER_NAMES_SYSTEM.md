# Player Names System - Replacing Staging File Dependencies

## Overview

This system replaces dependency on staging files (`staging_2025_skaters`, `staging_2025_goalies`) with our own internal player name database populated from NHL API scrapes.

---

## ✅ Components Created

### 1. Database Table: `player_names`
**Migration**: `supabase/migrations/20250113000000_create_player_names_table.sql`

- Stores player and goalie names from our own NHL API scrapes
- Primary key: `player_id` (NHL player ID)
- Fields: `full_name`, `first_name`, `last_name`, `position`, `team`, `jersey_number`, `is_active`, `headshot_url`
- Fast indexed lookups by `player_id`

### 2. Population Script: `populate_player_names_from_api.py`
**Purpose**: Initial bulk population of player names

- Fetches unique player IDs from `raw_shots` (shooters and goalies)
- Fetches names from NHL API (`https://api-web.nhle.com/v1/player/{id}/landing`)
- Stores in `player_names` table
- Handles rate limiting and errors gracefully

**Usage**:
```bash
python populate_player_names_from_api.py
```

### 3. Real-Time Name Fetching: `data_acquisition.py` (Updated)
**Purpose**: Populate names during data scraping

- When processing shots, checks `player_names` table first (fast lookup)
- If not found, fetches from NHL API and stores for future use
- Updates both `goalie_name` and `player_name` fields in `raw_shots`

**Changes Made**:
- Line ~1554: Added goalie name lookup and API fallback
- Line ~992: Added shooter name lookup and API fallback

### 4. Fast Lookup Service: `PlayerNameService.ts`
**Purpose**: TypeScript service for app-side name lookups

- In-memory cache (5-minute TTL)
- Fast lookups by `player_id`
- Batch lookups for multiple players
- Auto-refreshes cache when expired

**Usage**:
```typescript
import { getPlayerName, getPlayerNameRecord } from '@/services/PlayerNameService';

// Get name by ID
const name = await getPlayerName(8478402); // "Connor McDavid"

// Get full record
const player = await getPlayerNameRecord(8478402);
// { player_id: 8478402, full_name: "Connor McDavid", position: "C", team: "EDM", ... }
```

---

## 🚀 Implementation Steps

### Step 1: Apply Database Migration
```bash
# Apply the migration in Supabase dashboard or via CLI
supabase/migrations/20250113000000_create_player_names_table.sql
```

### Step 2: Initial Population (Optional but Recommended)
```bash
# Populate names for all players in raw_shots
python populate_player_names_from_api.py
```

This will:
- Find all unique player IDs from `raw_shots`
- Fetch names from NHL API
- Store in `player_names` table
- Show progress and summary

### Step 3: Future Data Scraping
When running `data_acquisition.py`:
- Names are automatically fetched and stored during processing
- Fast lookups from `player_names` table (no API calls needed for known players)
- API fallback for new players

### Step 4: Update App Services (Next Step)
Update `PlayerService.ts` to use `player_names` table instead of staging files:
- Replace `staging_2025_skaters` queries with `player_names` + stats from other sources
- Replace `staging_2025_goalies` queries with `player_names` + GSAx data

---

## 📊 Data Flow

```
NHL API (api-web.nhle.com)
    ↓
data_acquisition.py (during scraping)
    ↓
player_names table (fast lookup cache)
    ↓
raw_shots table (goalie_name, player_name fields)
    ↓
PlayerNameService.ts (app-side lookups)
    ↓
App UI (displays player names)
```

---

## 🔍 Name Lookup Strategy

### Priority Order:
1. **`player_names` table** (fastest, no API calls)
2. **NHL API** (fallback for new players)
3. **Store in `player_names`** (for future lookups)

### Performance:
- Table lookup: ~1-5ms
- API fetch: ~200-500ms
- Cache hit: <1ms

---

## 📝 Next Steps

1. ✅ Create `player_names` table
2. ✅ Create population script
3. ✅ Update `data_acquisition.py`
4. ✅ Create `PlayerNameService.ts`
5. ⏳ Update `PlayerService.ts` to use `player_names` instead of staging files
6. ⏳ Test end-to-end name lookups
7. ⏳ Remove staging file dependencies from app

---

## 🧪 Testing

### Test Name Lookup:
```python
# Python
from supabase import create_client
supabase = create_client(url, key)
response = supabase.table('player_names').select('*').eq('player_id', 8478402).execute()
print(response.data)  # Should show Connor McDavid
```

### Test in App:
```typescript
import { getPlayerName } from '@/services/PlayerNameService';
const name = await getPlayerName(8478402);
console.log(name); // "Connor McDavid"
```

---

## 📈 Benefits

1. **No Staging File Dependencies**: All names come from our own scrapes
2. **Real-Time Updates**: Names populated during data scraping
3. **Fast Lookups**: Indexed table with in-memory cache
4. **API Fallback**: Handles new players automatically
5. **Consistent Data**: Single source of truth for player names

---

## ⚠️ Notes

- Rate limiting: API calls are rate-limited (0.2s delay)
- Error handling: Failures don't break data scraping
- Cache: 5-minute TTL for app-side cache
- Migration: Must be applied before using the system

---

## 🎯 Goal

**Replace all staging file dependencies with our own internal player name database.**

This system ensures we have full control over player names and can update them in real-time as we scrape data.

