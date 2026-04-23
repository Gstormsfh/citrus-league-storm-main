# Staging bootstrap scripts

Run order for first-time staging environment setup (AFTER prod schema has been dumped and applied):

## 1. `01-mark-migrations-applied.sql`

Marks all 276 prod migrations as already applied on staging so `supabase db push` works cleanly
for future migrations.

**How to run:**

Option A — Supabase SQL Editor (easiest):
1. Open https://supabase.com/dashboard/project/jjgspcpvqaiitloglxbb/sql/new
2. Paste the entire contents of `01-mark-migrations-applied.sql`
3. Click **Run**

Option B — psql:
```powershell
psql -h db.jjgspcpvqaiitloglxbb.supabase.co -U postgres -d postgres -W -f scripts/staging/01-mark-migrations-applied.sql
```

After running, verify with:
```sql
SELECT COUNT(*) FROM supabase_migrations.schema_migrations;
-- Expected: 276
```

## Re-running

All scripts here are idempotent (`ON CONFLICT DO NOTHING`). Safe to re-run.
