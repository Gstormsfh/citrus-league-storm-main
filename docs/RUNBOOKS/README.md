# Citrus Draft Engine — Operational Runbooks

> Operational documentation for the Phase 4.5 persistent Node draft engine.
> Audience: solo on-call (today: Garrett); future on-call rotation.
> Authority: these runbooks document the **post-11g.9 architecture**.

---

## ⚠ Legacy-path warning (read first)

> If any operational instruction below references `pgmq`, `draft_generation`,
> `generation_bumped`, `draft_deadline_sweep`, or `draft-autopick` **outside a
> historical section of `draft-engine-v2-known-issues.md`**, that's a bug
> — these surfaces were permanently removed in chunk 11g.9
> (`DROP EXTENSION pgmq CASCADE`, **irreversible**). Do not reach for them
> during an incident; they do not exist. File a doc-fix issue.

The persistent in-server engine (chunks 11g.0–11g.9) carries the full hot
path and recovery path. There is no legacy fallback. Recovery is via
event-log replay + snapshot+delta bootstrap (chunk 11g.7-7c); cross-process
signaling is via Postgres LISTEN/NOTIFY (chunk 11g.7-7e). Anything else
is muscle memory from a runtime that no longer exists.

---

## When to read which

| If you're … | Read |
|---|---|
| On-call during an active draft incident | [`draft-engine-v2-operations.md`](./draft-engine-v2-operations.md) — start at §1 triage tree |
| Standing up staging or running pre-deploy validation | [`draft-engine-v2-staging-preflight.md`](./draft-engine-v2-staging-preflight.md) |
| Investigating a recurring or previously-documented issue | [`draft-engine-v2-known-issues.md`](./draft-engine-v2-known-issues.md) |
| Deciding whether and how to roll back | [`draft-engine-v2-rollback-playbook.md`](./draft-engine-v2-rollback-playbook.md) |
| Deploying the engine to production (the gated `Deploy Engine` workflow, approval, rollback pin, one-time setup) | [`ENGINE_DEPLOY.md`](./ENGINE_DEPLOY.md) |
| Recovering from roster / data-pipeline data loss (NOT a draft incident) | [`../EMERGENCY_RUNBOOK.md`](../EMERGENCY_RUNBOOK.md) |
| Landing a bundle from Claude as a PR (which terminal, the one line, what each failure means) | [`DELIVERY.md`](./DELIVERY.md) |

The boundary between draft-engine runbooks and `EMERGENCY_RUNBOOK.md` is
load-bearing. **Draft-engine runbooks** cover the live draft hot path:
pick submission, broadcast fanout, autopick, reconnect, snapshot persistence,
LISTEN/NOTIFY, auction state machine. **`EMERGENCY_RUNBOOK.md`** covers
roster / lineup / `team_lineups` / `fantasy_daily_rosters` data-loss recovery
— a different system with different invariants, different SQL surfaces,
different on-call paths. Don't conflate them under pressure.

---

## On-call rotation

Today's state: **solo on-call (Garrett).** No paging rotation, no escalation
path beyond "wake Garrett." Decision-time targets in the rollback playbook
(§F) assume this.

Future state (placeholder for when team grows): primary on-call + escalation
chain + paging integration. Reserved for the rotation framework when it
exists; no commitment yet.

---

## Conventions across these runbooks

- **Time-to-action first.** Every section answers "what do I do RIGHT NOW"
  before "why." The "why" is in CLAUDE.md (Mandate + architectural patterns)
  and the ADRs (`../adr/ADR-00{1,2,3,4}-*.md`).
- **Concrete commands.** No "consider doing X." If a step is a command,
  the command is in the doc. If a step is a decision, the decision tree
  is in the doc.
- **No restated Mandate numbers.** Performance targets live in CLAUDE.md
  `# Citrus Draft Performance Mandate` § "Hard performance targets" — one
  source of truth. Runbook sections that reference a target link, never
  duplicate.
- **TODO markers.** Sections requiring data that doesn't yet exist (e.g.,
  healthy-baseline numbers before chunk 11g.10 sub-step 10c) carry
  `TODO(10b/10c/10d): populate from staging measurement` markers. Better
  honest placeholder than guessed number.
- **Append-only for incident history.** `draft-engine-v2-known-issues.md`
  preserves old KIs as audit trail even after resolution. Mark RESOLVED
  in place; do not delete.

---

## Cross-references

- `../../CLAUDE.md` § "Citrus Draft Performance Mandate" — performance targets, binding architectural patterns, non-negotiables.
- `../adr/ADR-001-persistent-node-draft-engine.md` — persistent engine architecture (Cloud Run → GCE supersession).
- `../adr/ADR-002-auction-state-machine.md` — auction state machine, anti-snipe, auto-nominate, commissioner override.
- `../adr/ADR-003-co-manager-authorization-model.md` — co-manager auth (Phase B/C; not yet shipped in production at time of writing).
- `../adr/ADR-004-persistent-engine-authorization-model.md` — engine-as-trusted-executor model + §6 audit logging contract.
- `../PHASE_4_5_PRODUCTIONIZATION_PLAN.md` — chunk 11g.10 sub-step decomposition; 10e is the runbook-rewrite + rollback playbook.
- `../PHASE_4_5_ARCHITECTURE.md` — canonical Phase 4.5 architecture reference.
- `../PHASE_4_5_PROJECT_PLAN.md` — Decision Log; entries dated 2026-05-19 cover the 10e ship.
