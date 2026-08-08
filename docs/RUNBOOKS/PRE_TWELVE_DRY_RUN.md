# Pre-THE-TWELVE dry-run plan

**Purpose.** Rehearse the entire THE TWELVE flow with real infrastructure but a smaller headcount, so any lurking defect surfaces BEFORE 12 humans commit their evening to it. This is the last acceptance gate before the run.

**Companion doc.** Reads together with `docs/RUNBOOKS/THE_TWELVE_DRAFT_NIGHT.md`. Every phase in the runbook is exercised here at least once with a real commissioner-branch auth press (NO service-role bypass).

**Timing.** Run within 24 hours of THE TWELVE (fresh evidence).

---

## Participant plan

- **Minimum: 2 humans (Garrett + 1 volunteer).**
- Ideal: 4 humans (better browser-diversity coverage).
- Remaining slots (10 or 8): filled by harness-driven autopick-fallback teams.
- Rationale: 2 humans exercise the real WS/HTTP path per browser + real auth signing + real UI interaction. Autopick fills the rest so completion actually fires.

Draft config for the dry-run:
- Format: **snake**
- League size: **12** (matches THE TWELVE)
- Rounds: **12** (matches THE TWELVE) — full-scale dry run
- Pick clock: **30s** (matches THE TWELVE)
- **Do NOT abbreviate — dry-run must be full-scale to catch scale-dependent bugs.**

---

## Steps

### 1. Sanity checks (30 min before)

```powershell
# Engine image is the certified one
gcloud compute ssh citrus-draft-engine-staging `
  --zone=northamerica-northeast1-a --quiet `
  --command="sudo docker inspect citrus-draft-engine --format '{{.Config.Image}}'"
```
**Expected:** `northamerica-northeast1-docker.pkg.dev/citrus-fantasy-staging/citrus-draft-engine/draft-engine:0ecbe605-draft` (or newer if F27b-2 has since deployed).

```powershell
# Container has been up for at least a few minutes (rules out fresh-crash cold-start)
gcloud compute ssh citrus-draft-engine-staging `
  --zone=northamerica-northeast1-a --quiet `
  --command="sudo docker ps --filter name=citrus-draft-engine --format '{{.Status}}'"
```
**Expected:** `Up XX minutes` where XX >= 5.

```powershell
# Database is reachable
psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" -c "SELECT now(), version();"
```

### 2. League creation — real commissioner-branch auth press

**Critical: this MUST use Garrett's real Supabase auth token in the browser, not a service-role bypass.** This is the actual code path THE TWELVE exercises; a service-role shortcut here would validate a code path that doesn't get run under user load.

- Open a fresh browser tab, sign in as Garrett's user account.
- Go to the leagues UI, click "Create League".
- Fill in per Section Phase 1 of `THE_TWELVE_DRAFT_NIGHT.md` — use league name `DRY RUN <date>`.
- Verify the league appears in the leagues list.

### 3. Bake in the volunteer(s)

- Share the invite link with the 1-3 volunteers.
- They sign up + join. Verify with:
  ```powershell
  psql "$env:SUPABASE_DB_URL?client_encoding=UTF8" `
    -c "SELECT id, team_name, owner_id FROM public.teams WHERE league_id = '<DRY_RUN_LEAGUE_ID>' AND owner_id IS NOT NULL ORDER BY created_at;"
  ```
- 3-4 rows should have non-null `owner_id`. The remaining 8-9 teams stay owner_id=NULL — those get autopicked.

### 4. Ignition (real commissioner button press)

- Garrett clicks "Start Draft" in the commissioner UI.
- Verify per `THE_TWELVE_DRAFT_NIGHT.md` Phase 3 checks.

### 5. Drive the draft

- Real humans (Garrett + volunteers) pick their turns manually.
- Autopick fires for the empty-owner teams when their clock expires (should be immediate since no one's watching those).
- Draft completes in ~5-10 minutes real-wall-clock (mostly autopicks).

### 6. Post-run acceptance

**All must be green — no exceptions. Any red = HALT THE TWELVE + investigate.**

- [ ] `draft_status = 'completed'`
- [ ] `draft_state = 'completed'` (if N-2 migration is applied; else 'active' — cosmetic but log it)
- [ ] `pick_deadline = NULL`
- [ ] `draft_event_counter` count matches expected: 1 draft_started + 144 picks + 1 draft_completed = 146
- [ ] Every human's browser shows the "Draft complete" banner (per F28)
- [ ] Engine logs: zero `F20 'clock fired but draftStatus=completed'` warnings
- [ ] Engine logs: zero `autopick_failed` errors
- [ ] Engine logs: zero `draft_started_apply.skipped_stale_status` warnings (F27b-2 has cleared this)
- [ ] Engine logs: zero `bootstrap unknown event_type` warnings (F27b-1 has cleared this)
- [ ] Harness `ordering-violations: 0` (from N-1 fix in task #53) — if any harness runs were part of the dry-run
- [ ] Full replay of the draft events from disk reproduces the same picks in the same order (structural determinism check via bootstrapFullEventReplay — run `pg_dump --data-only -t public.draft_events` filtered by league_id, then load into a scratch DB and count/verify)

### 7. Post-dry-run

If ALL green: THE TWELVE is a go.

If ANY red: file finding in `docs/INSTRUMENT_LEDGER.md` under a new INS-XX or K-XX, delay THE TWELVE, investigate, re-run dry-run.

---

## Escalation

- Real defect surfaced: pause draft (see `THE_TWELVE_DRAFT_NIGHT.md` §6d), inform volunteers, root-cause, iterate.
- Infrastructure defect (engine crash, VM sick): escalate to VM restart (§6b of the runbook).
- Not-a-defect-but-slow: OK to proceed. THE TWELVE has more slack (2-hour window vs dry-run's 10-min).

---

**Sign-off criterion.** All Section 6 checkboxes green + at least one volunteer confirms "the experience felt smooth" (subjective UX signal). THE TWELVE gate opens on both.
