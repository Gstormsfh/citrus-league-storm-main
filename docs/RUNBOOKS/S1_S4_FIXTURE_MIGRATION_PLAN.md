# S1-S4 legacy fixture migration plan

**Purpose.** Move the S1-S4 perf scenarios (draft-harness performance runs) off the retired flip-era fixture-12 (`WHITELISTED_LEAGUE_ID` = `993c9219…`) and onto F27-native ignited leagues. Then define the conditions under which the legacy fallback in `draft-harness.mjs` can be deleted.

**Author.** Terminal, 2026-08-08 unattended-day P10.
**Status.** PLAN + PARTIAL EXECUTION — updated 2026-08-09 T16 (Entry 13 night queue).
- **DONE:** `--rounds=N` support in `fixture-12-f27-native.local.mjs` (verified at lines 83-84; defaults to 1 for lifecycle-rig backward-compat, accepts N for S1-S4 scale). Task #59 candidate CLOSED — no separate task needed.
- **DONE:** Legacy fallback in `draft-harness.mjs` now carries a HARD REMOVAL DATE of **2026-08-24** in the WARN message (T16 architect Entry 13 2026-08-09), gated on the 5 conditions in §3 all being true.
- **DEFERRED:** Full migration of each launch script + fallback deletion + legacy `fixture-12.mjs` + `set-draft-status.local.mjs` removal — owner (Garrett) executes post-ratification + post-freeze.

---

## Background

Pre-F27, the draft-harness ran perf scenarios (S1-S5) against `WHITELISTED_LEAGUE_ID = 993c9219-…` — a fixture league whose state was managed by the flip-era scripts (`set-draft-status.local.mjs` + `fixture-12.mjs`). The flip-era regime hand-set `draft_status='in_progress'` + `draft_state='active'` + `pick_deadline='<future>'` outside the ignition path.

Post-F27 (start_draft_v2 RPC + F27b-1 bootstrap replay fix + F26 completion path), the correct way to reach in_progress is via the ignition RPC. `fixture-12-f27-native.local.mjs` implements this; `fixture-12.mjs` (legacy) is deprecated per architect ruling 2026-08-07.

**Current state of harness/rig consumers of the fixture:**
- `lifecycle-acceptance-f27.local.mjs` — F27-native mode (uses `fixture-12-f27-native.local.mjs`, sets `F27_NATIVE_LEAGUE_ID` env for harness).
- `draft-harness.mjs` at lines 47-67 — reads `F27_NATIVE_LEAGUE_ID` if set, ELSE falls back to `WHITELISTED_LEAGUE_ID` (imported from `fixture-12.mjs`). Fallback logs a WARN.
- S1-S4 perf scenarios via `scenario=S1|S2|S3|S4` on the harness — currently take the fallback path (no F27_NATIVE_LEAGUE_ID set by their launch scripts).

**Goal.** Every scenario (S1-S5) uses an F27-native league. Fallback path deleted.

---

## Migration path

### Step 1 — audit current S1-S4 launch scripts

Locate the scripts that spawn draft-harness for perf runs.

```powershell
Get-ChildItem scripts/proof -File -Recurse | Select-String -Pattern 'draft-harness.mjs --scenario=' -List | Select-Object Path
```

Expected files (verify current state):
- `scripts/proof/live-proof.mjs` (S1 primary use)
- Any dedicated S2/S3/S4 driver scripts
- `scripts/proof/lifecycle-acceptance-f27.local.mjs` (already F27-native via env override)

### Step 2 — per-scenario adapter

Each launch script needs:
1. Create/reset an F27-native fixture: `fixture-12-f27-native.local.mjs --reset --execute && --execute`
2. Read the fresh league UUID from `scripts/proof/fixture-12-f27-native-state.local.json`
3. Set `F27_NATIVE_LEAGUE_ID` env before spawning the harness

For S1-S4 specifically, ROUNDS matters:
- S1 default ROUNDS=3 (36 picks) — F27-native league must be created with 3 rounds
- S2/S3 default ROUNDS=3 — same
- S4 default ROUNDS=3 + IDLE_MINUTES=30 (long-running scenario) — same

Fixture-12-f27-native currently creates a 1-round league (matches the lifecycle rig). Needs a `--rounds=N` flag to support S1-S4 scale. **CODE CHANGE NEEDED — task #59 candidate.**

### Step 3 — legacy fallback retirement conditions

The draft-harness fallback logic at lines 63-70:
```javascript
const F27_NATIVE_LEAGUE_ID = process.env.F27_NATIVE_LEAGUE_ID;
const WHITELISTED_LEAGUE_ID = F27_NATIVE_LEAGUE_ID ?? LEGACY_LEAGUE_ID;
if (!F27_NATIVE_LEAGUE_ID) {
  console.warn(
    `⚠ draft-harness: F27_NATIVE_LEAGUE_ID not set; falling back to LEGACY league ${LEGACY_LEAGUE_ID} — this league is RETIRED per architect ruling 2026-08-07 00:05. Set F27_NATIVE_LEAGUE_ID env for F27-native rigs.`,
  );
}
```

**Conditions ALL must be true before deleting the fallback:**

1. Every launch script (S1-S5) sets `F27_NATIVE_LEAGUE_ID` in the spawn env.
2. `fixture-12-f27-native.local.mjs` supports `--rounds=N` for the S1-S4 scale requirement.
3. Zero test files (`scripts/proof/results/*.summary.txt`) generated in the last 7 days reference the legacy `993c9219…` league in their metadata.
4. Legacy `scripts/proof/set-draft-status.local.mjs` deletion (task #50 durable fix / INS-12 close-out) is committed.
5. Architect ratifies the fallback deletion.

**When conditions hold, the deletion diff is:**
- Remove the `?? LEGACY_LEAGUE_ID` fallback and the WARN block at draft-harness.mjs:63-70.
- Remove the legacy `LEGACY_LEAGUE_ID` import at draft-harness.mjs:47 (from `fixture-12.mjs`).
- Delete `scripts/proof/fixture-12.mjs` (legacy fixture creator — replaced by fixture-12-f27-native).
- Delete `scripts/proof/set-draft-status.local.mjs` (flip-era script — retired).
- Update any docs that reference the legacy fixture (`docs/RUNBOOKS/*` grep for `WHITELISTED_LEAGUE_ID`, `fixture-12.mjs`, `set-draft-status`).

### Step 4 — post-deletion verification

Re-run each scenario (S1, S2, S3, S4 + lifecycle rig) with the new fallback-free harness. Zero WARN logs about legacy fallback. Fresh F27-native leagues per run.

---

## Risks + mitigations

- **Risk: S4's 30-minute idle window on a 30s pick clock.** F27-native league gets its first pick_deadline set by start_draft_v2. If the S4 scenario spends 30 idle minutes doing nothing, the first pick expires and autopick fires. Existing S4 code handles this via WS+pg heartbeats; the harness assumes it's driving picks throughout. Post-migration, S4 needs to be re-verified against the new ignition timing.
- **Mitigation:** dedicated S4 dry-run post-migration; adjust IDLE_MINUTES if needed. Docket task #60 candidate.

- **Risk: `--rounds=N` addition to fixture-12-f27-native could regress the lifecycle rig.** The current F27-native fixture defaults to 1 round; lifecycle rig assumes this.
- **Mitigation:** default `--rounds=1` preserved; explicit `--rounds=3` only for S1-S4 callers. No lifecycle rig regression.

- **Risk: legacy 993c9219 league might still exist on staging DB post-migration.** Fallback deletion prevents accidental reuse, but the DB row lingers.
- **Mitigation:** post-deletion, run a one-off `UPDATE public.leagues SET name = 'RETIRED — LEGACY FLIP-ERA' WHERE id = '993c9219…'` for operator-clarity. Not urgent; deletion of the fallback code path is the sufficient step.

---

## Timeline

- **Today (2026-08-08):** plan authored (this doc). No code changes.
- **Post-F27b-2 close (task #55):** revisit — F27b-2 fix landing simplifies the harness ordering-violation false-positive class (task #53) and validates the F27-native fixture regime end-to-end.
- **Pre-freeze Aug 17:** if conditions 1-4 clear, propose the fallback-deletion diff for architect ratification.
- **Post-THE-TWELVE:** if THE TWELVE surfaces any regime issue, revisit the migration cadence.

---

## Task-list impact

- Task #50 (INS-12 durable fix — fixture-12 F27-native mode) is DEPENDENCY for this plan's Step 3 condition #4.
- New task #59 candidate: fixture-12-f27-native `--rounds=N` flag.
- New task #60 candidate: S4 30-min idle re-verification post-migration.
- Task #52 (draft-harness --pause-after=N) is INDEPENDENT — that feature works on both fixtures.

---

**Sign-off.** Plan document only. Architect ratifies deletion of the fallback + associated legacy files at their discretion, gated on the four conditions above.
