# Recovery Strategy

> Principled rules for choosing Citrus's recovery posture as the
> product matures. Pre-launch we run on free-tier daily backups; PITR
> upgrades when user state crosses a clear capability gate.
>
> **Author:** R7-5 revision (2026-05-06)

---

## 1. Current posture (pre-launch)

| Mechanism | Daily snapshots, 7-day retention (Supabase free tier) |
|---|---|
| **RTO (Recovery Time Objective)** | ~24h — bounded by the daily snapshot interval plus restore wall-clock |
| **RPO (Recovery Point Objective)** | Up to 24h of writes lost depending on incident timing relative to last snapshot |
| **Cost** | $0/month |
| **Restore granularity** | Whole-database, all-or-nothing per snapshot |
| **Cross-project restore** | Not available on free tier — restore is destructive to the source project |

This is the **right posture for a pre-launch product** because:

- There are no paying users whose data can't be reproduced.
- Existing stateful artifacts (raw_shots, player_game_stats, model
  outputs) are derivable by re-running the ingestion + projection
  pipelines from NHL/MoneyPuck source data.
- Data loss = pipeline rework, not user-impacting harm.
- Spending $100/mo on PITR before that's true is premature
  optimization.

The verification runbook for this posture is at
`docs/RUNBOOKS/BACKUP_RESTORE_VERIFICATION.md`.

---

## 2. Target posture (at launch)

| Mechanism | Daily snapshots + PITR (Supabase Pro add-on) |
|---|---|
| **RTO** | ~minutes for fresh data, ~hours for full schema restore |
| **RPO** | Seconds (per-second WAL granularity within the PITR window) |
| **Cost** | ~$100/month for the PITR add-on (verify against current Supabase pricing) |
| **Restore granularity** | Per-second within ~7-day PITR window; daily snapshots beyond that |
| **Cross-project restore** | Available — can restore into a new project for non-destructive verification |

This is the **right posture for a product with real users** because:

- User-created state (drafted teams, league settings, transaction
  history, accounts) cannot be reproduced from external sources.
- A bad migration, runaway delete, or accidental DROP without PITR
  costs up to 24 hours of user data — unacceptable for paid users.
- $100/mo is a rounding error against paid-tier revenue and against
  the cost of a single user-trust-breaking incident.

---

## 3. Trigger rules (when to upgrade)

PITR is enabled **before** any of these become true. Whichever fires
first.

### Trigger A — first paid user

The moment Citrus charges a user, that user's data must be recoverable
to fine-grained precision. Daily snapshots no longer cut it.

### Trigger B — first user-created data we can't reproduce

User-created state with no external source of truth includes:

- Completed drafts (specific player order, manager-side decisions)
- Season-long league settings configured by commissioners
- Transaction ledgers (waiver claims, trades, drops, adds)
- Personal team names, branding, custom rules
- Comments, chat, notifications

The **first** time someone creates one of these on prod and it would
hurt to lose, PITR upgrades. Even if they're not paying yet — losing a
fully-drafted league is a user-trust-breaking event we don't recover
from.

### Trigger C — any deploy or migration that touches production user
tables

When we start running migrations against `leagues`, `team_lineups`,
`draft_picks`, `transaction_ledger`, or any user-write surface where a
bad migration could lose state, PITR enabled is a precondition for the
deploy. The cost of the upgrade is trivial against the cost of a botched
migration with no per-second restore.

### Trigger D — Web Summit (or any equivalent demo / launch event)

If Citrus is being demoed to investors or media, prod data integrity is
a brand statement. PITR enabled before the event = standard
enterprise-readiness posture.

---

## 4. Decision matrix

| Condition | Posture |
|---|---|
| No paying users, no irreproducible user state | Pre-launch (free tier daily) |
| Any of triggers A, B, C, or D | Target (Pro + PITR) |

When the posture changes:

1. Enable PITR in the Supabase dashboard.
2. Update `docs/RUNBOOKS/BACKUP_RESTORE_VERIFICATION.md` § 6 to add a
   PITR variant of the restore procedure (the existing procedure stays
   as the daily-snapshot fallback).
3. Run the verification test against the new mechanism — either
   restore-into-new-project or PITR-into-staging — to prove the new
   path works.
4. Append a row to the verification log (§ 10 of the runbook).

---

## 5. What this is NOT

- **Not a data-replication strategy.** Cross-region replication, hot
  standbys, multi-region writes — all out of scope. Supabase's
  region-level reliability is what we depend on.
- **Not an external-backup strategy.** A separate `pg_dump` to S3 on a
  cron is a Phase 2 concern. Supabase's PITR + daily snapshots together
  are sufficient up through several thousand active users.
- **Not a per-table audit policy.** That's `transaction_ledger` and
  `audit_log`'s job, not the recovery posture's.

---

## 6. Open questions to revisit at launch

- Has Supabase introduced a free-tier alternative to PITR (e.g., better
  daily-snapshot granularity)? Re-check pricing before committing.
- Are there CitrusFantasySports-specific compliance reqs (especially
  around financial info if entry fees / payouts launch) that require
  longer retention? If yes, that's a separate decision tree.
- Is staging configured to match the prod recovery posture? Mismatch
  means staging-only verification doesn't fully prove the prod path
  works.
