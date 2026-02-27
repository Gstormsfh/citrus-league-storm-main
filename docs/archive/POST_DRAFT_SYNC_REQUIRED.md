# ⚠️ POST-DRAFT SYNC REQUIRED

## IMMEDIATELY After Draft Completes

Run this SQL query in Supabase SQL Editor:

```sql
-- Get your league ID first:
SELECT id, name FROM leagues;

-- Then run sync (replace the UUID):
SELECT sync_roster_assignments_for_league('YOUR-LEAGUE-ID-HERE');
```

## Why This Is Needed

- Draft populates `draft_picks` ✅
- Roster system needs `roster_assignments` ❌
- This sync function copies from draft_picks → roster_assignments ✅

## Expected Output

```json
{
  "success": true,
  "players_synced": 240,
  "message": "Successfully synced..."
}
```

## After Running Sync

1. Hard refresh browser (Ctrl+Shift+R)
2. Go to Roster page
3. Verify all players appear
4. Check console: `dbPlayers count after filter: [NUMBER]` (not 0!)

## If You Forget This Step

Your roster will show 0 players! Just run the sync command and refresh.

---

**THIS IS CRITICAL - DON'T SKIP IT!**
