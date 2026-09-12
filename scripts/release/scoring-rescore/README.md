# Atomic scoring rescore companion

Operator-only SQL, not an application RPC. No permanent helper tables or grants. Compose in one transaction and one session:

1. `BEGIN ISOLATION LEVEL REPEATABLE READ;`
2. `capture.sql`
3. Exact unchanged `supabase/migrations/20260912073440_scoring_rules_replace_removed_keys.sql`
4. `rescore.sql`
5. Review affirmative counts and captured affected IDs; export private snapshots if required.
6. `COMMIT;` only for the reviewed release; use `ROLLBACK;` for rehearsal or any failed assertion.

The capture obtains table locks before comparing catalog-derived rules against saved JSON. SQL/JSON null means catalog defaults; omitted keys mean zero. Existing league IDs are selected from data. Source JSON and format/category settings are fingerprinted and checked after migration. The rules migration still reconciles every league's derived rows; rescoring and line rebuilding target only captured affected leagues and their already-started matchups. Future matchups remain untouched. Any failed/duplicate/missing RPC result, changed source, rules mismatch, or calibration failure aborts the transaction.

Private temporary snapshots retain all pre-cutover league/rule rows and affected started matchup/line rows. Transaction rollback restores these and the trigger definition exactly. They drop on commit. After a successful commit, **retain the repaired trigger, normalized rules, corrected matchup totals and rebuilt lines when rolling back API/web traffic**. Do not replay old score snapshots as part of an application rollback: that would restore known drift and could overwrite subsequent legitimate scoring. No actual NHL stat or historical roster facts are mutated by these companions.

This disposition is compatible with the pinned prior API commit `6aef8ab7d5f4657245284377b53acbc915dc6d82`: `server/src/services/MatchupService.ts` already calls `calculate_daily_matchup_scores_v2` (1329/1336), `persist_matchup_lines` (1366), and `update_all_matchup_scores` (776). Their argument/result contracts are unchanged. The actual exported database functions in the full-schema rehearsal already consume `get_effective_scoring_rules`; the repair changes derived multipliers to match unchanged saved settings, without adding required client fields. Default, zero, negative and category cases pass those existing functions. Thus app traffic rollback does not require a scoring data rollback. Build 18's separately documented display/cache limitations remain; this is a source/contract compatibility review plus actual-function local execution, not a deployed rollback or device test.

If the scoring repair itself is later found incorrect, stop and diagnose it as a separate data incident. This release does not authorize unconditional post-commit restoration. A data reversal would require a fresh guarded transaction with expected source/output fingerprints and a plan for intervening results. The normal app rollback intentionally retains corrected scoring.

Points calibration calls the existing verifier after rebuilding lines. Category calibration independently sums category winners/ties from the existing category RPC; the points verifier is never applied to category leagues. The local PGlite fixture executes the real migration, update RPC, and points verifier with controlled scorer/persist/category stand-ins. It verifies scope, zero/negative/default rules, category result, rollback and failure guards; it does not validate production RPC implementations or performance. Root's full-schema rehearsal is the integration check.

Run `node scripts/release/scoring-rescore/test.mjs` from the repository root. No network or credentials are used.
