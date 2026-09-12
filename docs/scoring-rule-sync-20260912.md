# Scoring rule synchronization review

Read-only inspection of the deployed `sync_scoring_settings_to_rules()` and its `AFTER INSERT OR UPDATE OF scoring_settings` trigger confirmed two active code defects: explicit NULL settings return without restoring defaults, and omitted category keys never replace previous multipliers. Consequently a commissioner can remove a category or reset settings while effective rule rows retain old weights. The sampled Test night 9th league currently agrees for goals, goals against, hits, saves and shots; this is not evidence that this league already experienced the update bug. The previous decimal-regex suspicion was a tooling escaping issue, not a newly asserted defect.

The prepared migration `20260912073440_scoring_rules_replace_removed_keys.sql` writes every catalog category. A configured document uses finite JSON numeric values, with missing or nonnumeric categories disabled at zero. An explicit SQL/JSON NULL document restores catalog defaults. Zero, negative and fractional values survive. It also reconciles existing derived rule rows when eventually executed. No league settings, actual game statistics, or earned score ledger is rewritten by this migration; any separately cached historical scores would still require an explicit recomputation policy after rollout.

The existing league mutation authorization/RLS remains the authorization boundary; this trigger follows a successfully authorized league write. No new public mutation endpoint or table is introduced. The derived rule write uses the same normalization semantics as `projectionSettings`; point calculations remain in existing scorers.

Local proof uses real PostgreSQL/PGlite:

```sh
node --test data-pipeline/tests/sql/scoring_rules_sync.test.mjs
```

Four tests cover existing drift reconciliation, key removal, null reset versus empty configuration, zero/negative/decimal/exponent values and invalid numeric strings. No production mutation, migration or deployment was performed.
