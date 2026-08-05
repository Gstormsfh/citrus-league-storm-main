# Citrus — Instrument Ledger

> **Purpose.** Track defects in the *instruments* — the harnesses,
> scripts, guards, and check-emitters that exist to observe the system.
> These are distinct from KIs (which track defects in the system itself)
> and from spec/architectural decisions. When a check lies — false-red
> OR false-green — it degrades every future signal that reads through
> that check. The ledger keeps the pattern visible so the next author
> can learn from prior instrument failure modes.
>
> **Hard rule.** Every instrument-family finding gets an INS-NNN entry
> here, with credit. If the instrument refused safely (Type II — false
> alarm), CALL THAT OUT — the correct failure mode of a check is to
> raise, not to swallow. The lesson is in the mechanism, not the outcome.
>
> **Lifecycle.** Append-only. Do not delete resolved entries — resolution
> is annotated inline. Instrument-defect patterns repeat; the ledger is
> the compounded institutional memory.

## Schema

| Column | Meaning |
|---|---|
| **ID** | `INS-NNN`, monotonically assigned within this ledger. |
| **Instrument** | The harness / script / check-emitter / guard that failed. |
| **Failure mode** | `false-red` (Type II — refused a correct signal) or `false-green` (Type I — passed a wrong signal). Also: `dropped-signal` (observation reached the instrument but was not reported). |
| **Fix** | What the fix was, or where it lives. |
| **Credit** | For false-reds specifically: acknowledgement that the check refused safely. Type II errors are the correct failure mode for pre-execution guards; the code deserves credit for not letting a wrong-signal apply proceed. |

## Cross-references (pre-ledger findings, folded in by reference)

The findings below predate this ledger; they lived in the 11g.10 ship
report and inline code comments. Recorded here for continuity so the
instrument-family pattern is visible in one place.

| Legacy tag | Where documented | Class |
|---|---|---|
| **F7** | `scripts/proof/draft-harness.mjs:374, 581` (inline) | Harness setter/callback confusion — `onEvent(cb)` was documented as a subscriber but implemented as a setter, silently dropping all but the last handler. Fixed in place. |
| **F13** | `docs/SHIP_REPORT_PHASE_4_5_11g_10.md` §"F13 — BOTH HALVES CLOSED" | NDJSON append-stream flush integrity on SIGINT — the "aborted" header + partial summary were written correctly, proving the flush ran. Fix: append-stream + fault flush + pg error survival. |
| **F18** | `docs/SHIP_REPORT_PHASE_4_5_11g_10.md` §"F18-family observation" | SIGINT abort-path summary reports `Samples captured: 0` despite N delivered observations shown live. Counter reads a different accumulator than the one populated during normal run. Instrument-reporting bug (not fault-flush-integrity). Fix folds into F18 summary-generator work; not blocking. |

---

## Registry

### INS-4 — STEP 0 pre-apply guard: whole-body regex false-red on `'pick_deadline'` literal

**Field record (2026-08-05, ~23:15 MT).** The F24-rebase apply script's
STEP 0 sanity check (`scripts/proof/apply-f24-rebase.local.sql`) refused
the apply with the message *"live body already has batch-2 markers.
Either the rebase already applied, or the base state is not the F25-broken
20260805023419."* Architect investigated with an independent
`pg_get_functiondef` read and adjudicated the guard as a false-red: the
live body was verified UNCHANGED (payload window extracted showed 7
fields, no `pick_deadline`; the literal `'pick_deadline'` appeared 9×
elsewhere in the body — including both `RETURN jsonb_build_object(...)`
envelopes, since the RPC's return contract always carries a
`pick_deadline` field regardless of what the pick EVENT payload carries).
The guard was matching in the wrong region.

**Instrument.** `scripts/proof/apply-f24-rebase.local.sql`, STEP 0
`DO $sanity$ ... $sanity$` block.

**Failure mode.** `false-red`. The guard refused to run a correct apply
because a whole-body regex search for `'pick_deadline',\s*v_new_deadline`
matched the final RETURN's envelope key (which uses the same variable),
not the pick payload construction the guard was written to check.

**Fix (committed 2026-08-05, morning-apply gated per midnight rule).**
Two-tier redesign in the same file:

1. **Primary gate now a hash pin.** `md5(pg_get_functiondef(oid))` of
   `public.submit_pick_v2` must equal the architect's independent
   capture `e849568e2f8cc35eb437c51b1732c91f` (2026-08-05 23:00 MT).
   Bit-exact identity check; cannot be fooled by literal-substring
   matches anywhere in the body.
2. **Marker checks become windowed diagnostics.** Instead of whole-body
   regex, each marker extracts a `substring(body, position(<anchor>),
   <len>)` scoped to the syntactic region it claims to check. Payload
   markers run against a 520-char window starting at
   `v_payload := jsonb_build_object`; INSERT markers against a 400-char
   window at `INSERT INTO public.draft_events`; completion-branch
   markers against a 1200-char window at `v_total_picks > 0`; on-clock
   filter against a 400-char window at `SELECT team_order INTO
   v_team_order`; completion SUM filter against a 200-char window at
   `SELECT COALESCE(SUM(jsonb_array_length`. If any window is empty
   (position()=0), its markers read false — a missing region is
   correctly a failing check.
3. **STEP 3 post-apply verification mirrored.** Same windowed technique
   applied to every post-apply marker check, so no post-apply green
   can be produced by a distant literal that happens to sit outside
   the region it's claimed to represent.

**Credit.** The guard refused safely. Type II (false alarm) is the
correct failure mode for a pre-execution sanity check on a mutation
against production data — a Type I error (false green, wrong apply
proceeds) would have been catastrophic. The instrument's *decision to
refuse* was right; its *evidence for refusing* was wrong. Fix improves
evidence quality, preserves the refuse-first posture.

**Lesson for future guards.**
- Whole-body regex on function bodies is inadequate whenever a literal
  can legitimately appear in multiple syntactic regions.
- Prefer hash-pin (`md5(pg_get_functiondef(oid))`) as the primary gate.
  It cannot lie in either direction — bit-identical or not, no
  interpretation.
- Reserve marker checks for post-apply diagnostics that describe WHERE
  the difference lives. Window every check to the region it claims.
- Position-based windowing (`substring(body, position(<anchor>), <len>)`)
  fails-safe: if the anchor is missing, the window is empty and every
  marker in that window reads false. Do not rely on a "region contains
  the literal" positive as "the literal is in the region" — those are
  the same statement only when the window is non-empty.

### INS-5 — STEP 3 windowed diagnostics: four false-reds on primary evidence (overflow + contiguous-pattern kill)

**Field record (2026-08-05).** After INS-4's STEP 0 patch, the same apply
script's STEP 3 post-apply verification failed FOUR of its 12 marker
checks on the correctly-applied rebase body. Architect adjudicated all
four as instrument false-reds after reading the migration file regions
directly. The 1200-char `completion_window` (anchored at `v_total_picks > 0`)
proved too tight for markers that live deep in the completion branch,
AND one marker's regex required a contiguous multi-line pattern that
`pg_get_functiondef` splits across lines.

**Per-marker mechanism** (all present, all misdetected):

| Marker | Failure mechanism | Fix mechanism |
|---|---|---|
| `v_has_deadline_before_validate` | Windowed logic depended on `pos(validate_draft_event_payload)` for the ordering assertion, but the semantics of the check ("deadline computed before payload built") reduces to a simpler pair. | Body-wide position math: `0 < position('v_new_deadline :=') < position('v_payload := jsonb_build_object')`. DECLARE has `v_new_deadline timestamptz;` (no `:=`), so the `:=` fragment tags only the assignment. Both anchors are unique in body. |
| `v_has_status_completed_deadline_null` | The `draft_status = 'completed', pick_deadline = NULL` UPDATE sits ~40 comment-lines past the `v_total_picks > 0` anchor. That's ~1500 chars, past the 1200-char window. Window overflow. | Body-wide, self-anchored, whitespace-tolerant: `draft_status\s*=\s*'completed'\s*,\s*pick_deadline\s*=\s*NULL`. No other UPDATE in the body has this shape; body-wide is safe. |
| `v_has_sha256_hash` | Source is `encode(\n      sha256(convert_to(v_completion_payload::text, 'UTF8')),\n      'hex'\n    )`. Original regex included `encode(` but the newline between `encode(` and `sha256(` broke the contiguous match. Contiguous-pattern kill. | Anchor to the single-line portion: `sha256\(convert_to\(v_completion_payload`. `v_completion_payload` is unique to the completion branch; body-wide safe. |
| `v_has_return_pick_deadline_null` | Same window overflow class as the UPDATE marker — the branch RETURN sits at the bottom of the branch, past the 1200-char window boundary. | Body-wide, self-anchored: `'pick_deadline',\s*NULL`. The other RETURN uses `v_new_deadline`, the duplicate-retry RETURN uses `v_current_dl`. Only the completion branch produces the literal `'pick_deadline', NULL` sequence. |

**Instrument.** `scripts/proof/apply-f24-rebase.local.sql`, STEP 3
`DO $verify$ ... $verify$` block. Migration file body ratified by
architect as-read — untouched by this fix.

**Failure mode.** `false-red` × 4. All four markers refused a correctly-
applied rebase.

**Fix (committed 2026-08-05).** Per-marker replacements per architect
spec (table above). Windowing kept only where the marker string is
inherently ambiguous (bare `'pick_deadline'`, bare `deleted_at IS NULL`,
bare `'pick', 2,`).

**Mandatory dry-run gate (introduced with this fix).** Before Garrett
re-applies the rebase, every STEP 3 marker regex + the negative marker
MUST be validated against the migration file's own text. Mechanism:
`scripts/proof/dryrun-apply-f24-rebase-checks.local.mjs` reads the file,
extracts the plpgsql body, and runs a JS-regex equivalent of each check
in the SQL harness. Expected-vs-actual table printed; non-zero exit if
any row disagrees. The instrument gets tested before it points at the
database again.

Dry-run result (recorded 2026-08-05): **14/14 PASS.** Positions confirmed:
`v_payload := ...` at char 7302, `INSERT INTO draft_events` at char 8828,
`v_total_picks > 0` at char 11009. UPDATE marker at ~char 12500 (~1500
chars past the completion anchor — confirms window-overflow diagnosis).

**Credit.** All four checks refused safely. The failure was in the
evidence-collection technique (positional windows), not in the refuse-
first posture. Fix improves evidence quality, preserves refusal
discipline.

**Principle established (architect 2026-08-05).** *Self-anchored unique
strings with `\s*` tolerance beat positional windows.* Keep windows only
where the marker string is inherently ambiguous. Never rely on a
positional window to reach a marker deep in a branch — the window is
brittle by design, and the marker's own uniqueness is the more durable
constraint.

**Meta-lesson: test the instrument first.** Every future guard/check
against a runtime target MUST have a paired dry-run harness that runs
against a known-good static input (source file, canned fixture, prior
capture). If the harness can't be constructed, the check isn't ready.
The dry-run mandate is now standing practice for any pre-execution
sanity check.
