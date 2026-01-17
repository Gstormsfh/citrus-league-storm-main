# Player ID Type Standardization (Future Work)

## Current State (Inconsistent)

Player IDs are stored as different types across tables:

| Table | Column | Type | Example |
|-------|--------|------|---------|
| `draft_picks` | `player_id` | TEXT | "8478402" |
| `players` | `id` | INTEGER | 8478402 |
| `player_directory` | `player_id` | INTEGER | 8478402 |
| `team_lineups` | `starters/bench/ir` | JSONB[INTEGER] | [8478402, 8477934] |
| `fantasy_daily_rosters` | `player_id` | INTEGER | 8478402 |

**Problem:** Requires constant casting (`::INTEGER`, `::TEXT`) which causes:
- SQL errors (uuid = integer, text = integer)
- Performance overhead
- Code complexity
- Risk of type mismatch bugs

---

## Target State (Consistent)

**Goal:** All player IDs should be INTEGER (NHL player IDs are always integers)

| Table | Column | Target Type |
|-------|--------|-------------|
| `draft_picks` | `player_id` | INTEGER |
| `players` | `id` | INTEGER |
| `team_lineups` | `starters/bench/ir` | JSONB[INTEGER] |
| `fantasy_daily_rosters` | `player_id` | INTEGER |

**Note:** `players.id` is actually a database UUID, NOT the NHL player ID. This table might need a separate `nhl_player_id INTEGER` column.

---

## Migration Strategy (NOT IMPLEMENTED YET)

### Why Not Implemented Now

After the TRUNCATE catastrophe on Jan 15, 2026, we're being extremely cautious. Type conversions are HIGH RISK and could cause:
- Foreign key violations
- Data corruption
- Application breakage
- More emergency restorations

**Decision:** Document for future, implement after thorough testing.

### Safe Implementation Path

When ready to implement:

#### Step 1: Create Backup
```sql
SELECT backup_team_lineups('before_type_standardization', 'Safety backup before player_id type changes');
```

#### Step 2: Add New Columns (Non-destructive)
```sql
-- Don't drop old columns yet, add new ones
ALTER TABLE draft_picks ADD COLUMN player_id_int INTEGER;

-- Populate new columns
UPDATE draft_picks SET player_id_int = player_id::INTEGER;
```

#### Step 3: Validate Data
```sql
-- Verify no data loss
SELECT COUNT(*) FROM draft_picks WHERE player_id_int IS NULL;
-- Should be 0

-- Verify matching
SELECT COUNT(*) FROM draft_picks WHERE player_id::INTEGER != player_id_int;
-- Should be 0
```

#### Step 4: Update Application Code
- Change all queries to use new `player_id_int` column
- Update TypeScript types
- Test thoroughly

#### Step 5: Rename Columns (After verification)
```sql
-- Only after app is using new columns successfully
ALTER TABLE draft_picks DROP COLUMN player_id;
ALTER TABLE draft_picks RENAME COLUMN player_id_int TO player_id;
```

#### Step 6: Update Foreign Keys
```sql
-- Update constraints to reference new INTEGER columns
```

---

## Workaround (Current)

Since type standardization is HIGH RISK, we use explicit casts everywhere:

```sql
-- When querying draft_picks (TEXT) for players (INTEGER)
SELECT * FROM draft_picks dp
JOIN players p ON p.id = dp.player_id::INTEGER;

-- When inserting from team_lineups (JSONB[INTEGER]) to fantasy_daily_rosters (INTEGER)
INSERT INTO fantasy_daily_rosters (player_id, ...)
SELECT (jsonb_array_elements_text(tl.starters)::integer), ...
FROM team_lineups tl;
```

**This works but is not ideal.**

---

## Testing Requirements

Before implementing type standardization:

### Test Database Setup
1. Clone production schema to test database
2. Create representative test data
3. Apply type conversion migration
4. Verify all queries still work
5. Test all application features
6. Rollback and repeat

### Validation Queries
```sql
-- 1. No NULL player IDs after conversion
SELECT 'draft_picks' as table_name, COUNT(*) as null_count
FROM draft_picks WHERE player_id IS NULL
UNION ALL
SELECT 'fantasy_daily_rosters', COUNT(*)
FROM fantasy_daily_rosters WHERE player_id IS NULL;
-- Should all be 0

-- 2. All joins still work
SELECT COUNT(*) FROM draft_picks dp
JOIN players p ON p.id = dp.player_id;
-- Should match row count in draft_picks

-- 3. No orphaned records
SELECT COUNT(*) FROM team_lineups tl
WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements_text(tl.starters) as player_id
  WHERE NOT EXISTS (
    SELECT 1 FROM players p WHERE p.id = player_id::INTEGER
  )
);
-- Should be 0
```

---

## Impact Analysis

### Tables Affected
- `draft_picks` (PRIMARY - ownership)
- `team_lineups` (current rosters)
- `fantasy_daily_rosters` (historical snapshots)
- All joins between these tables

### Application Code Affected
- `LeagueService.ts` - All lineup queries
- `MatchupService.ts` - Roster loading
- `DraftService.ts` - Draft picks
- `RosterService.ts` - Roster operations

### Risk Level: CATASTROPHIC

If done incorrectly, could:
- Break all roster functionality
- Lose player ownership data
- Corrupt historical records
- Require complete rebuild from scratch

---

## Decision

**DEFERRED TO FUTURE SPRINT**

Current workaround (explicit casts) is:
- ✅ Functional
- ✅ Safe
- ⚠️ Not elegant
- ⚠️ Performance overhead

Benefits of standardization:
- ✅ Cleaner code
- ✅ Better performance
- ✅ Fewer casting errors

**Risk vs Reward:** Not worth it right now given recent data loss incidents.

**Recommendation:** Implement in 2-3 months after system stabilizes.

---

## Monitoring

Current type inconsistencies to watch for:

```sql
-- Query that tracks casting errors
SELECT 
  schemaname,
  tablename,
  attname,
  typname
FROM pg_stats s
JOIN pg_attribute a ON a.attname = s.attname
JOIN pg_type t ON t.oid = a.atttypid
WHERE attname LIKE '%player_id%'
  AND schemaname = 'public'
ORDER BY tablename, attname;
```

Run monthly to track if types are causing issues.

---

**Status:** DOCUMENTED - NOT IMPLEMENTED  
**Priority:** LOW (after system stabilization)  
**Risk:** CATASTROPHIC if done incorrectly  
**Timeline:** Q2 2026 earliest
