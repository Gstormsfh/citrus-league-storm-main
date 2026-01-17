# 🎯 FIX TUESDAY (Jan 13) ONLY

## What This Does
- **ONLY touches Tuesday Jan 13** (leaves Monday alone!)
- Deletes any corrupt/partial data for Jan 13
- Restores fresh data from `team_lineups`
- Shows counts for all three days (Mon, Tue, Wed) for verification

## Run This

```bash
supabase db push
```

This will apply: **`20260114000003_restore_tuesday_jan13_ONLY.sql`**

## Expected Output

You should see:
```
✅ TUESDAY JAN 13 RESTORATION COMPLETE

Monday Jan 12:    ~255 entries (untouched)
Tuesday Jan 13:   ~257 entries (RESTORED)
Wednesday Jan 14: XXX entries (current state)

✅ SUCCESS: Tuesday Jan 13 has 257 entries!
```

## Why This Will Work

1. **Deletes ONLY Jan 13** - Won't touch your working Monday data
2. **No ON CONFLICT** - Forces complete restoration
3. **Uses DELETE first** - Clears any partial/corrupt data
4. **Fresh INSERT** - Pulls current lineups from team_lineups

## If It Shows 0 Entries

If Tuesday still shows 0 entries, run this diagnostic:

```sql
-- Check if there's a matchup for this week
SELECT id, week_number, week_start_date, week_end_date, status, team1_id, team2_id
FROM matchups
WHERE week_start_date <= '2026-01-13' 
  AND week_end_date >= '2026-01-13'
ORDER BY created_at;

-- Check if team_lineups has data
SELECT team_id, league_id, 
       jsonb_array_length(starters) as starter_count,
       jsonb_array_length(bench) as bench_count
FROM team_lineups
LIMIT 10;
```

The issue would be:
- No matchups for this week, OR
- team_lineups is empty

---

**This is focused and should definitely work! 🎯**
