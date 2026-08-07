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

### INS-6 — STEP 4a syntax error: psql client-side interpolation skipped inside dollar-quoted DO bodies

**Field record (2026-08-05, morning apply attempt).** Garrett re-ran the
apply. STEP 0 hash pin PASS, STEP 2 migration PASS, STEP 3 all 12
markers + negative marker PASS (INS-5 fix confirmed on live evidence).
STEP 4a errored with `syntax error at or near ":"` and the entire
transaction rolled back. Architect verified full rollback: live md5
still `e849568e2f8cc35eb437c51b1732c91f`, 0 new history rows, 0 orphan
large objects (the `\lo_import` insert into `pg_largeobject` rolled
back with the txn — the transactional wrap earned its keep).

**Root cause.** `psql`'s client-side variable interpolation (`:'name'`,
`:name`) is SKIPPED inside dollar-quoted string literals — including
`DO $tag$ ... $tag$` blocks. The parser treats the entire dollar-quoted
body as literal-until-close-tag, so client-side substitution never runs
against its contents. The literal `:'oid_10c2b2'` reached the server
verbatim; the leading `:` surfaced as a syntax error at the first token
of the DO body's SQL. INS-5's dry-run harness tested regex LOGIC against
the migration file text; it did not exercise the psql → plpgsql PIPES
that carry data between the top-level script and the DO block. **The
plumbing was never rehearsed pre-run.**

**Instrument.** `scripts/proof/apply-f24-rebase.local.sql`, STEPS 4a/4b/4c
`DO $tag$ ... $tag$` blocks. Also — implicitly — the INS-5 dry-run
harness, whose scope did not cover psql-server data flow.

**Failure mode.** `false-green` (of the paired dry-run harness — it
reported 14/14 PASS on regex logic while the DO-body plumbing it never
tested was broken) → cascading `hard-error` at runtime (STEP 4a
transaction-aborting syntax error). The rollback semantics of the
transactional wrap prevented any side-effect leak, so the net risk was
time only.

**Fix (committed 2026-08-05).** Bridge psql-space to plpgsql-space via
transaction-local GUC at all three import sites:

```sql
\lo_import 'supabase/migrations/<file>.sql'
\set oid_<tag> :LASTOID
SELECT set_config('vars.oid_<tag>', :'oid_<tag>', true) AS bridged_oid_<tag>;

DO $<tag>$
DECLARE
  v_oid oid := current_setting('vars.oid_<tag>')::oid;
BEGIN
  v_body := convert_from(lo_get(v_oid), 'UTF8');
  ...
END
$<tag>$;

SELECT lo_unlink(:'oid_<tag>'::oid);  -- top-level: psql interpolation OK
```

`set_config(name, value, is_local)` with `is_local=true` writes a
transaction-scoped GUC that dies at COMMIT or ROLLBACK. No cross-session
leak. No orphan on retry. `current_setting(name)::oid` inside the DO
block is pure SQL — no psql substitution needed, no client-server
protocol dependency.

Top-level `lo_unlink(:'oid_<tag>'::oid)` unchanged: psql interpolation
DOES happen at top level, and the LO cleanup runs after the DO block
succeeds (rollback path is covered by the transaction wrap).

**Mandatory 30-second rehearsal (introduced with this fix).**
`scripts/proof/rehearse-lo-bridge.local.sql` — standalone paste
Garrett runs BEFORE re-invoking the full apply. Proves the bridge on
the real connection with zero state risk:

```
BEGIN
  \lo_import  <any small file>
  set_config bridge
  DO block: current_setting → lo_get → RAISE NOTICE 'bridge ok, N bytes'
ROLLBACK
```

Expected terminal output: `NOTICE:  bridge ok, <N> bytes` followed by
`ROLLBACK`. If instead `ERROR:  syntax error at or near ":"`, the
bridge is broken and the full apply MUST NOT be re-invoked.

**Credit.** The apply script's transactional wrap refused safely at the
runtime error: full rollback, zero side effects, live state unchanged.
That's the correct failure mode for a mutation script that hits an
unexpected error mid-flight. The apply-script's rollback discipline is
what let INS-6 stay a time cost, not a data cost.

**Meta-lesson: test the plumbing, not just the logic.** INS-5's dry-run
tested regex correctness against static file text — a valid check, but
not a comprehensive one. Every future direct-apply script that carries
data across process/protocol boundaries (psql client ↔ postgres server,
here) MUST have a paired rehearsal that exercises the pipes at each
boundary. Rehearsals run BEFORE any mutation and MUST be side-effect-
free (BEGIN → operations → ROLLBACK). The dry-run mandate now has two
tiers:

1. **Logic dry-run** — regex/marker checks against static input
   (INS-5's `dryrun-apply-f24-rebase-checks.local.mjs`).
2. **Plumbing rehearsal** — end-to-end pipe exercise on the real
   connection, wrapped in ROLLBACK (INS-6's `rehearse-lo-bridge.local.sql`).

Both are required for any pre-execution sanity check that reaches into
a live system.

**Recurring pattern noted.** Two direct-apply mistakes on the same file
(INS-4 evidence-window regex, INS-5 window-overflow + contiguous-pattern
kill, INS-6 psql/plpgsql interpolation boundary) all trace to the same
root: authoring an instrument without exercising it end-to-end against
its real target before wiring it into a mutation path. The transactional
wrap has caught every one so far; the wrap is doing load-bearing work
that the instrument authoring is not.

### INS-7 — psql -f apply on Windows: client_encoding default mangles non-ASCII source bytes

**Field record (2026-08-05, F24 rebase apply, post-INS-6 successful
run).** After INS-6's bridge patch, the full apply completed clean.
STEP 5 PASS, COMMIT reached. Architect's post-apply verification
recorded a new md5 pin for the live body:
`0936f891d707da231446d440b452197f`. History-vs-live containment
verified TRUE after ASCII normalization — the divergence between the
stored `statements[1]` bytes (byte-exact from `\lo_import`) and the
live `pg_get_functiondef` output is mojibake only: 132 non-ASCII file
chars expanded to 353 stored chars (×3 signature), located in
comments and the D8 `RAISE WARNING` literal. Comment content and
warning-message content are cosmetic; behavior is identical to a
UTF-8-clean apply.

**Instrument.** `psql -f` invocation itself, not any single script.
On Windows / PowerShell environments, psql's default `client_encoding`
resolves to `WIN1252` (or platform equivalent), which mangles UTF-8
source bytes on the wire. The migration source file is UTF-8 clean
(em-dashes, box-drawing, Unicode quotes all correct); the STORED
function body is not.

**Failure mode.** `dropped-signal` on the wire — bytes leave the
client correctly and arrive at the server transformed. Cosmetic
divergence class: no behavior changed, no data loss, no correctness
impact. Detection required an independent md5 comparison against a
same-day capture made under a different encoding regime.

**Fix.** No remediation pass on existing mojibake (architect ruling
2026-08-05: "mojibake endemic in corpus, no remediation pass"). Rule
3 added to `docs/MIGRATION_SAFETY_GUIDE.md`: every future `psql -f`
apply MUST force `client_encoding=UTF8` via connection string
(`?client_encoding=UTF8`) or first-statement `SET client_encoding TO
'UTF8'`. The rule makes wire encoding an explicit invariant of the
apply protocol.

**Rationale for not remediating.** A re-apply to correct the mojibake
would change the live body, invalidating the new md5 pin and
requiring architect re-ratification with no user-visible benefit.
The comments are for humans reading the source file (which is clean);
the D8 WARNING message would be less pretty in `pg_stat_activity` if
it ever fires (unreachable in normal preflight — see D8 architect
ruling). Cost > benefit.

**Credit.** The `\lo_import` + `lo_get` + `convert_from(bytea, 'UTF8')`
round-trip in STEP 4 preserved the SOURCE bytes correctly in the
history rows — history-vs-live divergence exists ONLY because the
`\i migration.sql` path re-ran the file through the wire's mangled
client encoding while STEP 4's LO path bypassed it. The bytea LO
path was doing the right thing all along; the diagnostic exposed
that STEP 2's `\i` was the encoding weak point.

**Meta-lesson: wire encoding is invisible until it isn't.** Every
data channel between processes has an encoding contract. The default
is not the specification. Explicit enforcement at every apply site
is cheap; discovery through diff is not. Apply-site encoding joins
`ON_ERROR_STOP` and transactional wrapping as the standing enforcement
triad for any direct-apply script that mutates production state.

**Standing pin table (updated 2026-08-06 post-SL-1b).**

| Function | Live md5 | Captured | Retired pins |
|---|---|---|---|
| `public.submit_pick_v2(uuid,uuid,int,int,int,uuid,uuid,text,jsonb,uuid)` | `0936f891d707da231446d440b452197f` | 2026-08-05 post-F24-apply | `e849568e2f8cc35eb437c51b1732c91f` (F25-broken, 2026-08-05 23:00 MT) |
| `public.auto_fix_integrity_issues()` | `d0a54ca8925c9a8604781294a4b5631a` | 2026-08-06 post-SL-1b v2 | `0bd6c0f8cfbc9b9b3f970b52009bfbd2` (SL-1 v1, 2026-08-05); pre-SL-1 `35802d12f8e20d97912fb9e6ced45cc7` |

Any future direct-apply script that supersedes one of these functions
must STEP 0 pin against the live value (or a same-day recapture, if
the world has moved). Retired pins are recorded for the audit trail
and to help diagnose future "wrong DB targeted" cases.

### INS-8 — Read-only gcloud interrogation prompted API-enable and got a yes; API silently activated on prod

**Field record (2026-08-06, SL-1 prod-reset gate Checks A–F).** During
the prod-reset inventory (`gcloud functions list --project=citrus-fantasy-prod`,
Check D), the interrogation prompted "API [cloudfunctions.googleapis.com]
not enabled on project [citrus-fantasy-prod]. Would you like to enable
and retry? (y/N)". Garrett — reading it as an interrogation prerequisite
rather than a state change — answered yes. The API activated on prod
as a side effect of what was billed as a *read-only check*. Garrett
is reversing (`gcloud services disable cloudfunctions.googleapis.com
--project=citrus-fantasy-prod --force`); no service was ever deployed
to the API.

**Instrument.** `gcloud <service> list` family, when run against a
project where the underlying API has not been enabled. gcloud's default
UX is interactive-yes-friendly — the prompt reads like a prerequisite,
not a mutation.

**Failure mode.** `Type III` — instrument did what it was told, but
the interrogation had a side effect the operator did not intend. The
prompt was answered honestly ("yes, I want the interrogation to
complete") without recognizing the state change hidden inside the
prompt's phrasing. Adjacent to `dropped-signal` in reverse: the signal
that this was a mutation, not a read, arrived too subtly.

**Fix (standing cookbook rule, ships this commit).** All read-only
gcloud interrogation commands in Season-Loop scripts and README §2.1
MUST include `--quiet` (or `-q`). With `--quiet`, gcloud interprets
any prompt as an aborted operation instead of assuming a yes. The
prompt "API not enabled — enable?" would then fail with a clear
non-zero exit rather than silently activating the API.

README §2.1 revised in this commit to add `--quiet` to every gcloud
call. Same rule applies to the Check A–F guides — any future
regeneration of those hand-off blocks must include `--quiet` on every
gcloud invocation that is not itself a deliberate mutation.

**Credit.** Garrett noticed within seconds and initiated the reversal.
Standing rule now makes the class impossible to hit accidentally.

**Meta-lesson: instrument sanitization must include not just what the
instrument *reads*, but what it *asks* of its operator.** A prompt
seen by a human is part of the instrument's surface area; a prompt
that changes state on yes is a mutation vector wearing an interrogation
mask. Standing enforcement pattern:

- Any read-only check command in a runbook or paste block: `--quiet`.
- Any read-only check that requires enabling something to complete:
  document the pre-enable step SEPARATELY, gated on operator
  intention, with a paired disable-after-check.
- Rehearsal harnesses (INS-6): must exercise read-only checks against
  their intended target, including the "not yet enabled" case, to
  surface the prompt at rehearsal time rather than at real-run time.

### INS-9 — Prod-secret naming divergence between README §2.1 CREATE and GCE startup script default

**Field record (2026-08-06, name reconciliation before Step 1b runs).**
The README §2.1 CREATE block as originally committed (commit
`a29fc677`) created the prod secret as `SUPABASE_DB_URL` (uppercase,
underscore). The GCE startup script `infra/gce/draft-engine-startup.sh:117`
reads secret name `${SECRET_DB_URL_NAME:-supabase-db-url}` (lowercase,
hyphen) when the VM metadata `secret-db-url-name` is unset. A prod
draft-engine VM deployed today would look for `supabase-db-url` and
find nothing (or find whatever future secret was created under that
canonical name), while direct-apply sessions loaded from the
`SUPABASE_DB_URL` uppercase-form secret. **The runbook itself was the
instrument that diverged from the running code's expectation.**

**Instrument.** README §2.1 CREATE block, `scripts/proof/README.md`.

**Failure mode.** `false-green` (at write time) — the block worked for
its intended use case (loading the env var for direct-apply this
week), which meant no failing signal on first use. Would have surfaced
as a broken prod GCE bootstrap the first time a prod engine VM was
spun up — potentially months later, with no obvious lineage back to
this authorship error.

**Fix (this commit).** README §2.1 CREATE + LOADER blocks use
`supabase-db-url` throughout. Prerequisite check filter changed from
`name~SUPABASE_DB_URL$` to `name:supabase-db-url`. New "Naming
convention" paragraph at the top of §2.1 makes the constraint explicit
and points at the GCE startup script line that pins the default.

**Credit.** Architect caught the divergence in review of the prod-
reset gate hand-off, before Garrett ran Step 1b against the prod
project. Zero mutations landed under the wrong name.

**Meta-lesson: authoritative naming lives in the code that reads it,
not in the docs that describe it.** When a runbook prescribes a secret
name / env var / URL that another component will later consume, the
runbook is downstream of the consumer's expectation. Standing pattern
for future runbook additions:

- Any doc that prescribes a name a runtime component will read: cite
  the exact file + line where that component reads it, and derive the
  prescribed name from that citation.
- Any secret/config-name divergence between doc and code is
  reportable as an instrument bug — the doc is an instrument for
  operator action; incorrect instructions are the same class as an
  incorrect regex.

### INS-10 — SL-1 v1: crash removed but repair authored wrong (jsonb_build_array wrapper); STEP 3 markers passed a wrong-shape post-repair

**Field record (2026-08-06, SL-1 v1 acceptance).** SL-1 v1 (migration
`20260805200000_sl1_auto_fix_uuid_cast.sql`, applied 2026-08-05)
eliminated the 22P02 crash — STEP 3's negative markers held
(`dp.player_id::INTEGER` absent), function invocation completed
without exception, sensor arm re-emitted rows. But the repair itself
was WRONG: the UPDATE wrapped the jsonb_agg subquery in
`jsonb_build_array(...)`, producing `bench = [[21 uuids]]` (a
single-element outer array whose element is the inner UUID array).
Architect read live prod bench directly on 2026-08-06 to diagnose:
all 10 demo-league teams shaped `[[uuids]]`, `jsonb_array_length=1`,
`?` operator blind to nested elements. `missing_players_check` stayed
at 210 after v1's manual invoke. Fix continued to KI-036 as SL-1b v2
(migration `20260806100000`).

**Instrument.** v1 apply script's STEP 3 marker set —
`scripts/proof/apply-sl1-auto-fix.local.sql`. Also the paired
`dryrun-apply-f24-rebase-checks.local.mjs` style dry-run (though for
SL-1 v1 no dedicated dry-run was built — the F24-descended pattern
was reused for the harness but no v1-specific dry-run harness gated
authorship).

**Failure mode.** `false-green` — the marker set was well-scoped to
"crash site gone + ::text casts present" and confirmed both. It did
not check the SHAPE of the resulting bench array, because that would
require post-invoke data verification, not just post-apply function-
body verification. The class boundary between "crash removed" and
"repair correct" was invisible to the instrument.

**Fix (this commit).** SL-1b v2 replaces the UPDATE's
`bench = bench || jsonb_build_array(<jsonb_agg>)` with
`bench = bench || COALESCE(<jsonb_agg>, '[]'::jsonb)` — direct
concatenation. STEP 3 for v2 (in
`scripts/proof/apply-sl1b-auto-fix-v2.local.sql`) adds two new
positive markers (`bench = bench || COALESCE(` present in UPDATE
window; `'[]'::jsonb` fallback present) and one new negative marker
(`jsonb_build_array` absent from UPDATE window). Paired dry-run
harness `scripts/proof/dryrun-apply-sl1b-checks.local.mjs` validates
14/14 against the migration file body before the apply runs.

**Credit.** Architect's independent prod read caught the v1 shape
error within 24 hours of the apply. The `jsonb_build_array` wrapper
compiled and ran without error; STEP 3 accepted it; sensor arm
accepted the returned rows without exception. The wrong shape was
invisible to every automated check until architect looked at the
data directly. **Data-shape verification MUST be part of any repair
that mutates data structure**, not just function-body verification.

**Meta-lesson: syntactic correctness ≠ semantic correctness. A
CREATE OR REPLACE that compiles + a repair that runs + sensors that
re-emit ≠ a repair that WORKED.** Standing pattern for any future
data-mutating repair function:

1. **Post-apply STEP 3** verifies the function BODY (marker set).
2. **Post-invoke assertion** verifies the DATA SHAPE the function
   produced. Query the affected rows and assert against the intended
   shape (jsonb_array_length ranges, jsonb_typeof of first element,
   etc.). If a data-shape assertion is impossible without knowing
   the exact shape in advance, treat the repair as EXPLORATORY and
   run it against a staged copy first.
3. **Pre-registered acceptance** — architect specified SL-1b's
   forks (A vs B on the count-check) BEFORE the invoke ran. Fork B
   is not a v2 failure; it's information. Design the forks up front
   so post-invoke observations are adjudicated against a plan, not
   improvised.

For SL-1b specifically, the post-invoke assertions live in:
- `sl1-post-heal-verify.local.sql` Q3 Amendment A hard assert (no
  dupes + count matches per healed team). Shape-agnostic — passes
  for both v1's [[uuids]] AND v2's [uuids] IF the count matches. v1
  count DIDN'T match (1 vs 21) because `jsonb_array_length` returned
  1, so Amendment A would have caught v1 too — had architect not
  read prod first, ladder step 5 would have surfaced it.
- `unwrap-sl1b-demo-league.local.sql` pre-scan + post-scan bracket
  the shape check before the unwrap runs. Data-shape verification
  moved to the front of the ladder for v2.

**Recurring pattern noted.** The transactional wrap has caught
INS-4, INS-5, INS-6 as safe rollbacks; INS-7 was cosmetic;
INS-8 was a Type III side effect; INS-9 was doc-vs-code naming;
**INS-10 is the first "code did what was written; what was written
was wrong" defect in this campaign** — outside the reach of any
transactional wrap or code-body verifier. Only data-shape assertion
would have caught it earlier.

### INS-11 — pg_cron mutation as direct DML on `cron.job` refused with permission denied (seventh consecutive atomic refusal)

**Field record (2026-08-06 evening, KI-041 reply-migration apply).**
The reply migration `20260806200000_reenable_auto_fix_after_sl1b_v2.sql`
v1 attempted to re-enable cron job 4 via:

```sql
UPDATE cron.job SET active = true WHERE jobid = 4;
```

Refused at migration line 116 with `permission denied for table job`.
Root cause verified against 0F-OPS-3's own statements: Supabase's
`postgres` role has SELECT on `cron.job` but does NOT have
UPDATE/INSERT/DELETE. The disable side (0F-OPS-3) had used
`PERFORM cron.alter_job(job_id := <id>, active := false)` after a
by-name lookup (jobname 'auto-fix-integrity') and post-verify SELECT
gate. The reply migration inherited the wrong mechanic from the
harness pattern, which pre-dates the pg_cron surface.

**Instrument.** `supabase/migrations/20260806200000_reenable_auto_fix_after_sl1b_v2.sql`
v1 (line 116); `scripts/proof/apply-reenable-auto-fix.local.sql` v1
STEP 0/3 (which hardcoded `jobid = 4` — also incorrect for jobname-
based conventions across environments).

**Failure mode.** `hard-error` at runtime → full transactional
rollback → seventh consecutive atomic refusal caught by the
transactional wrap. Zero residue: STEP 0 hash pin still valid,
auto_fix live md5 unchanged, no history row written, no cron state
touched. Same pin valid for the re-run.

**Fix (this commit).** Migration v2 mirrors 0F-OPS-3's mechanic
exactly:

- Lookup `jobid` by `jobname = 'auto-fix-integrity'` (no hardcoded jobid).
- Guard: refuse if jobname missing OR command doesn't match auto_fix pattern.
- `PERFORM cron.alter_job(job_id := v_jobid, active := true)` inside a DO block.
- Post-verify SELECT active — SELECT is permitted for the postgres role.
- Apply harness STEP 0/3 updated to jobname lookup; capture filename
  updated to `..._pre_reenable_cron_job_auto_fix_integrity.json`.
- Dry-run harness gains two new comment-stripped-corpus checks:
  `no_direct_cron_dml` and `zero_sql_updates_anywhere`, both counting to zero.

**Rule-writing outcome.** Added to `docs/MIGRATION_SAFETY_GUIDE.md`
as Rule 5: all pg_cron mutations on Supabase go through the API
(`cron.alter_job` / `cron.schedule` / `cron.unschedule`), never
direct table DML. Full concrete pattern included in the rule text.

**Credit.** Standing rule — always use the sanctioned API for
extension-managed state on Supabase — now codified for pg_cron
specifically. Same principle likely applies to other Supabase-
managed schemas (`storage`, `auth`, `graphql_public`, `realtime`,
`vault`, `pgmq`); future encounters with permission-denied on their
tables should reach for the extension API first.

**Meta-lesson: managed platforms partition their schemas into
"readable" and "mutable-via-API." A `SELECT` that works is not
proof that the corresponding `UPDATE` will. Test mutations against
staging OR consult the extension's API surface before assuming
direct DML is permitted.** Standing pattern:

- When authoring a mutation on any schema owned by an installed
  extension (`cron`, `storage`, `auth`, etc.), first check the
  extension's documented API for the equivalent operation.
- If none is found or the operation is genuinely intended as raw
  DML, the migration header MUST document why — otherwise future
  authors default to the API pattern.
- Dry-run harnesses for pg_cron-mutating migrations MUST include a
  `no_direct_cron_dml` counter as a standing negative marker.

**Standing pin note.** STEP 0 hash pin
`d0a54ca8925c9a8604781294a4b5631a` for `auto_fix_integrity_issues`
remains valid across the v1→v2 patch — the reply migration touches
cron state only, not the function body.

**Refusal count.** INS-11 is the seventh consecutive atomic refusal
caught by the transactional wrap this campaign (INS-4 STEP 0 regex,
INS-5 STEP 3 windowing × 4, INS-6 psql/plpgsql interpolation,
INS-11 pg_cron DML permission). Every one arrived as an eager error
inside a rollback-safe transaction; no state leaked; each surfaced
its own class of instrument defect for the ledger. The wrap
continues to do load-bearing work that no other mechanism replaces.

### INS-12 — F27 lifecycle rig preflight refused on fixture-12's flip-era vestige (shakedown iteration #1, as forecast)

**Field record (2026-08-06 STEP 5 first-run attempt).** Garrett ran
`scripts/proof/lifecycle-acceptance-f27.local.mjs --mode=lifecycle`
per the deploy sequence. Rig's preflight raised at
`preflightNotStarted()` because `draft_status='completed'` (residual
from STEP 4's smoke where F24 completion path fired). Manual three-
column un-arm applied by Garrett (`draft_status='not_started'`,
`draft_state='not_started'`, `pick_deadline=NULL`) restored the
honest commissioner-start pre-state; rig re-run cleared preflight.

**Instrument.** `scripts/proof/fixture-12.mjs` — both `--reset` and
`--execute` paths, plus the rig's `preflightNotStarted()` interaction
with them.

**Failure mode.** `false-red` — rig preflight refused a correct
CONFIGURATION-authored setup because the fixture scaffold's semantics
pre-date F27. Neither the crime nor the intent:

- **fixture-12 `--reset`** doesn't touch `draft_status`. Reset was
  authored pre-F24 (chunk 11g.10 sub-step 10c-2) when the completion
  path didn't flip status — so reset saw no need to restore it.
  Post-F24, status can persist as `'completed'` across cleanup and
  the next setup misses it.
- **fixture-12 `--execute`** pre-arms `draft_state='active'` and
  `pick_deadline=<computed>` per flip-script-era semantics (draft
  ignition was done by ops, not by an RPC — the fixture had to
  synthesize the started state so the harness could start driving
  picks immediately). Post-F27, that pre-arm CONFLICTS with the
  honest "not_started" shape start_draft_v2 requires as pre-state.

**Fix (this session, per architect).** Garrett applied the manual
three-column un-arm as a one-off; rig proceeded. Fix documented but
NOT applied to fixture-12.mjs in this session — architect ruled it
DURABLE-DOCKET, post-F27-close. This session's job is F27 close, not
scaffold retirement of the flip-era pattern.

**Durable fix (task #50, post-F27-close):**
- `fixture-12.mjs --reset`: restore `draft_status='not_started'`
  alongside the existing column restorations.
- `fixture-12.mjs --execute`: introduce an `--f27-native` flag that
  does NOT pre-arm `draft_state` or `pick_deadline` — genuine
  `not_started` shape. `start_draft_v2` performs ignition. When the
  flag is standard-adopted, the pre-arm block retires entirely.
- The flip-era vestige exits alongside the break-glass renaming of
  `set-draft-status.local.mjs` (F27 §9 already staged).

**Credit.** Rig preflight refused SAFELY — architect's shakedown
pre-agreement (2026-08-06 GO expedite message) forecast this class of
finding: "rig-orchestration stumbles are INS-class tuning, one
iteration expected, not F-class findings." Prediction was exact:
one iteration, INS-class, not F-class. Rig's `preflightNotStarted()`
does its job — it refused an inconsistent pre-state that would have
made downstream assertions ambiguous.

**Meta-lesson: scaffold-vs-feature semantic drift.** Long-lived
scaffolds (fixture-12) accrete assumptions from the era they were
authored. When a feature (F27) changes the surface those scaffolds
target (commissioner-start via RPC instead of ops-flip), the
scaffold's pre-arming becomes anachronistic. Two mitigations for
future features that change scaffold-adjacent surfaces:

1. **Ship the scaffold update in the same PR as the feature.** The
   fixture-12 retirement of pre-arm should have landed with F27,
   not deferred to task #50. Deferring means the next rig-authoring
   pass will trip the same class again.
2. **Rig preflight is the safety net when #1 slips.** Every new
   feature that changes pre-state semantics MUST include a
   preflight assertion in its rig — the rig's refusal-with-clear-
   error IS the discipline that catches the missed scaffold update.
   F27's `preflightNotStarted()` did exactly this on first-run.

### INS-13 — F27 lifecycle rig assert-C matcher blind to wire envelope (shakedown iteration #2, ENGINE ACQUITTED)

**Field record (2026-08-06 STEP 5 second-run attempt, post-INS-12 un-arm).**
After INS-12's manual un-arm cleared preflight, the rig proceeded
to `ASSERT C — observer received draft_started frame` and
FAILED with `observer received draft_started frame within 3s`
timing out. **Engine ACQUITTED** by architect's log-based
verification: Cloud Logging at `2026-08-06T00:09:46.972Z` shows
`external_event.applied seq=1 event_type=draft_started
broadcasted=true notifyToBroadcastMs=42 lobbySize=1` — the observer
was connected, the frame reached the wire, F26+F27's broadcast path
worked correctly. The rig's matcher was reading the wrong shape.

**Instrument.** `scripts/proof/lifecycle-acceptance-f27.local.mjs`
assert-C matcher (both `--mode=lifecycle` and its C-mandatory
sibling; `--mode=zero-client` had the same collection pattern but
didn't rely on the matcher).

**Failure mode.** `false-red` on the correct wire event. Rig
mistakenly nested the matcher: assumed `observerFrames[i].frame`
was the parsed message envelope, but per `lib/ws-client.mjs:274-280`
the onEvent callback delivers `{ seq, frame, receivedAt }` where
`frame = { ts, iso, raw, parsed }` and the parsed envelope is
`{ v, type:'event', seq, timestamp, correlationId, payload:
<BufferedDraftEvent> }`. Correct access path: `evt.frame.parsed
.payload.kind`. The rig was reaching for `frame.payload.kind`
one nesting-level too shallow.

**Fix (this session, committed with this ledger entry).** Rig now
normalizes into an `observerEvents` array where each entry is
`{ receivedAt, seq, kind, parsedMsg }`. `kind` is lifted from
`parsedMsg.payload.kind` for O(1) matching in assert-C /
assert-C-mandatory. Same pattern applied to `lateJoinEvents` in
`--mode=zero-client` for consistency.

**Debug-dump addition.** Per architect: "while in there, add a
debug line dumping the first 3 raw frames received so the next
envelope mismatch self-diagnoses." Implemented via `DEBUG_FIRST_N=3`
counter — first three frames each print `[debug frame #N] seq=X
kind=Y envelope=<full JSON>`. Steady-state emits nothing. Next
envelope-shape drift is diagnosed immediately from the debug line
without needing to add ad-hoc logging mid-run.

**Credit.** Engine acquitted on evidence. Rig matcher fix is a
one-file, three-block patch — same INS-class as INS-12 (shakedown
iteration, forecast, not F-class). Architect's pre-agreement
called this exactly: rig-orchestration stumbles on first-run
against a new feature surface. Standing pattern reinforced.

**Meta-lesson: read the actual wire envelope, don't guess.** When
an observing client's on-callback shape is defined in a library,
open the library and read the exact delivery shape BEFORE authoring
the matcher. Guessing based on the server-side broadcast shape
misses the client-side wrapping the library adds. Standing
prescription: any rig that consumes `lib/ws-client`'s onEvent MUST
log its first 3 raw frames until the envelope is known-stable —
one line of code, saves an iteration every time the envelope
shifts.

## Post-INS-13 findings docket (architect run notes, 2026-08-06 STEP 5)

Three findings from the STEP 5 second-run (post-INS-12 un-arm,
pre-INS-13 fix). Not INS entries themselves — behavioral observations
+ one KI candidate — but recorded here for the run's archaeological
completeness.

### Finding (a) — Pre-start join path VERIFIED WORKING

The rig's observer connect happens BEFORE `start_draft_v2` fires
(architect condition Q2 scoped: "commissioner-with-zero-clients"
was the design case, but the observer-pre-ignition case had been
documented as v1-rare). This run PROVES the pre-start join path:

- Harness observer bypasses the discovery HTTP endpoint (which
  refuses pre-start joins with 409 DRAFT_NOT_CONNECTABLE per
  `packages/shared/league.ts:561`) by connecting directly to the
  WS upgrade endpoint using a self-signed JWT.
- Engine's uWS upgrade handler builds the lobby via
  `LobbyRegistry.getOrCreate(lobbyId, leagueId)` on first WS join,
  regardless of `draft_status`.
- Lobby served the snapshot for a `draft_status='not_started'`
  league (proves bootstrap-mode works for pre-ignition state).
- Live ignition (`start_draft_v2` firing seq 1 via NOTIFY/LISTEN)
  applied cleanly through the engine's external-apply path;
  `broadcasted:true` at log 00:09:46.972.

**Documentation update.** `docs/DESIGN_F27_start_draft_v2.md` §3
Q2 scoping note ("v1-rare") is upgraded to "TESTED BEHAVIOR" as
of this run. Pre-start join via harness (not via discovery) is
demonstrated end-to-end. Discovery-gated real-browser pre-start
joins remain refused by design (server-side guard is intact); the
harness's bypass is a testing-only mechanism.

### Finding (b) — Pre-rig ritual until INS-12 durable fix lands

Until task #50 (INS-12 durable fix) ships, every rig invocation
that follows a prior run's completion (or any completed-status
state) MUST include the three-column un-arm:

```
UPDATE public.leagues
   SET draft_status = 'not_started',
       draft_state  = 'not_started',
       pick_deadline = NULL
 WHERE id = '993c9219-ecbf-4e4e-9fb0-e9837e1bded3';
```

Ritual sequence: reset → setup → un-arm → rig. The un-arm step
recurs after EVERY run until fixture-12 gains --f27-native mode.
Documented in ritual note; not a durable fix — a manual patch
across the INS-12 gap.

### Finding (c) — Stale-tab generation-mismatch resync (KI candidate)

**Observed.** During the STEP 5 run window, a real browser client
(NOT the rig harness — an unrelated stale tab from an operator's
earlier session) reconnected 1 second post-ignition. Client
attempted resync with `sinceSeq=12` (from its snapshot of a
PREVIOUS draft generation). Fresh-generation draft returned
`deltaCount=0` (no matching events for that seq range in the new
generation), then rescued the client by delivering a fresh snapshot.

**Behavior:** correct-by-fallback — snapshot serves as the recovery
path when resync misses. But the RESYNC ATTEMPT was blind to the
generation mismatch. `generation_bumped` event type exists in the
event catalog (per KI-009 close notes, `20260512000000_remove_pgmq_infrastructure.sql`
removed it from the writer paths but the event_type CHECK enum
still lists it as of that migration's date). Unused today; would
be the sanctioned signal for a client to invalidate its local
cursor on generation-boundary.

**Docket:** KI candidate — "client resync should carry a generation
token, not just seq". Register when appropriate; not blocking F27
close. See KI-042 pattern (standing constraint) for the format.
The `generation_bumped` event type sitting in the catalog unused
is adjacent to KI-009's simplification decision (pgmq removal
included generation-bump removal from writer paths); revisit
whether to re-add for client-cursor discipline or delete from the
CHECK enum entirely.

### Note on the abandoned draft

Architect: "The abandoned draft is self-completing on perfect
cadence — let it finish, free F24+F26 soak." Understood; no
intervention. F24 completion path + F26 broadcast path both getting
their first live-production soak on this draft. Recorded as
positive-signal observation, not a defect.

### INS-14 — Run #2 stale-cursor duplicate-skip (in-memory lobby immortality + rewound DB)

**Field record (2026-08-07 05:36:58.106Z, log adjudicated by architect ~23:48 MT).**
Rig run #2 attempted ignition on the same 993c9219 league that run #1
had completed on. Engine log:
```
external_event.duplicate_skipped seq:1 lastAppliedSeq:14 reason:seq_at_or_below_cursor
```
Fresh seq=1 draft_started NOTIFY arrived; in-memory cursor was still 14
from run #1's completion; guard at `LobbyManager.ts:5541` treated the
event as duplicate → dropped without apply. No broadcast, no status
flip, no timer arm. Explains run #2's assert-C silence AND the 27-min
stall (top-of-file docket entry from architect run notes 2026-08-06
STEP 5 covered this observationally; INS-14 codifies mechanism).

**Instrument.** `server/src/draft/LobbyManager.ts:5541-5549` —
`processExternalEvent`'s duplicate-skip guard. Pure in-memory check
(no DB cross-check).

**Failure mode.** `dropped-signal` — legitimate NOTIFY silently skipped
because in-memory cursor was stale relative to a rewound DB (fixture
reset dropped seqs 2-14; wrote fresh seq 1; engine memory carried
cursor 14 from the completed run).

**Why in-memory lobby survived across runs (CORRECTED per architect
addendum 2026-08-07 AM connection-ledger forensics).** ORIGINAL DRAFT
of this section pointed at the rig's socket-cleanup bug as the root
cause of lobby immortality. **That was WRONG.** Connection-ledger
evidence shows:
- **Smoke lobby WAS reaped** between 23:27Z and 00:09Z Aug 6-7. Reap
  path proven — the smoke's 12 harness clients closed cleanly to
  connectionCount=0 and the idle-reap scanner did its job. (Confirmed
  inference: run #1's seq-1 applied fresh with broadcast + flip + arm,
  which is impossible against cursor 37 from the smoke — the lobby
  had to have been reaped and reconstructed.)
- **The connection that kept the run #1 lobby immortal was a REAL
  USER** (`c4489220` — browser tab connected 00:09:48Z, never closed).
  Legitimate live client. Engine behavior CORRECT — reap-exempt while
  connectionCount ≥ 1 is the intended semantics.
- The rig's own observer socket DID close (observer died at assert C
  in ~5s per rig log, BEFORE harness spawn). Rig cleanup was NOT the
  causal chain here.
- **Fixture reset dropped DB seqs 2-14, wrote fresh seq 1.** Run #2's
  duplicate-skip against the real-user-preserved cursor 14 stands as
  the mechanism.

**INS-13-follow-up (rig cleanup) fix is still correct as prophylactic**
— any future rig invocation should not depend on graceful WS closes,
and the Amendment 2 machinery ensures rig-authored sockets close on
every exit path. But it's not the "why the lobby survived" answer.

**Fix (this session, author-only).** Rig redesign (see file header of
`scripts/proof/lifecycle-acceptance-f27.local.mjs`):
- Amendment 1: fresh-league-per-run via `fixture-12-f27-native.local.mjs`
  (new file, task #50 durable fix ratified BLOCKING by architect).
  Every rig invocation targets a NEW league UUID with cursor 0.
- Amendment 2: `await connectDraftClient(...)`; observer IS the handle;
  real `handle.close()` in cleanup finally + on every assert-failure
  exit path (global `openObservers` set + `cleanupObservers()` helper).
  Kills the lingering-socket source of lobby immortality.

**Engine fix — DEFERRED (F27b parked, not authorized).** Architect
safety caution recorded 2026-08-07 00:05: naive stale-cursor
reconciliation (`seq===1 && cursor>0 → wipe`) is REDELIVERY-UNSAFE —
a redelivered old seq-1 NOTIFY would wipe a live lobby. Any future
engine self-heal must cross-check DB max(seq) or event_id/payload_hash
before honoring a reset. Ledgered here as a documented no-fly zone
for future authors.

**Meta-lesson.** In-memory cursor + DB rewind is a foot-gun class:
- If tests / rigs / operators can reset the DB while the engine holds
  in-memory state, any stateful in-memory index (cursor, snapshot,
  ring buffer) can silently diverge from the DB and drop legitimate
  traffic.
- The fix is either (a) test isolation via fresh identifiers so the
  in-memory state never carries over (this session's choice) or (b)
  engine-side reset detection with a safety cross-check (deferred).

### INS-15 — Persistence-writer chimera (lastAppliedSeq from DB + draftStatus from memory)

**Field record (2026-08-07 05:37:16Z).** `snapshot.persistence.written`
log for league 993c9219 recorded `{lastAppliedSeq: 14 → 1, draftStatus:
'completed'}` — an impossible pair, persisted as fact. Any future
bootstrap from this snapshot would resurrect status=completed with
cursor=1; subsequent seq ≤14 events hit the same seq_at_or_below_cursor
duplicate-skip guard as INS-14.

**Instrument.** `server/src/draft/LobbyManager.ts:2499-2578` —
`processSnapshot()`. Line 2526: `lastAppliedSeq` sourced from DB via
`findMaxEventSeq()`. Line 2567: `draftStatus` sourced from
`this.draftStatus` (engine memory). No cross-validation before
`writeSnapshot()` at line 2562.

**Failure mode.** `chimera-write` — two fields from two sources of
truth, no consistency check. Under normal operation the sources agree
(engine state converges to DB via NOTIFY+apply). Under corrupted
in-memory state (INS-14 root), sources diverge and the chimera lands.

**Fix.** Not authorized (F27b parked). Recorded as a companion to
INS-14. When engine hardening ships:
- `processSnapshot` should ASSERT `this.lastAppliedSeq === findMaxEventSeq()`
  before writing; on mismatch, EMIT WARN + REFUSE the write.
- Alternative: source `draftStatus` from DB alongside `lastAppliedSeq`
  (both from the same read snapshot).

**Retired league 993c9219** carries the poisoned snapshot row as
evidence per architect ruling. Never reuse. Any future engine
hardening PR that adds bootstrap validation should treat 993c9219's
snapshot as a canary — the code SHOULD refuse to bootstrap from it.

### INS-13-follow-up — Rig-cleanup socket-leak (root of INS-14's lobby immortality)

**Field record.** Prior rig had `const observer = connectDraftClient(...)`
(no await) at line 295. `observer` was a Promise, not a handle.
`observer.close?.()` at line 449 was undefined-then-noop. WS never
closed on rig exit.

**Fix (this session, author-only).** New rig (Amendment 2):
- `const primaryObs = await openObserver(...)` — awaits the handle
  through a wrapper `openObserver()` helper.
- Global `openObservers` Set + `cleanupObservers()` helper.
- Real `handle.close()` in `finally` block + on every assert-failure
  exit via `fail()` helper (which calls `cleanupObservers()` before
  `process.exit(1)`).
- Documented in file header + Amendment 2 comment blocks.

**Docketed here** as a follow-up to INS-13 because the same day-of
recovery (2026-08-06) surfaced two related rig bugs (matcher shape +
socket cleanup) but only the matcher was patched in that iteration.
The cleanup fix rides this session's redesign.

### Amendment 7 rig — STEP 6 REDEFINED (abandoned-mid-draft)

**Architect ruling 2026-08-07 00:05.** Rider 2's original "zero-client
start" evolves. The new STEP 6 scenario:
1. Ignite via `start_draft_v2`.
2. One harness client connects → lobby created via
   `LobbyRegistry.getOrCreate` → bootstrap applies `draft_started` →
   arm timer.
3. Client disconnects CLEANLY (rig calls `handle.close()`).
4. Engine autopicks the entire draft ALONE — in_progress lobbies are
   reap-exempt (M1d: `LobbyRegistry.ts:788-794`), so the lobby
   survives post-disconnect. Autopick cascade drives to completion.
5. Assert DB completion + `draft_completed` event + engine autopick
   log lines (verified out-of-band via docker logs over SSH).

**UPGRADE per architect addendum 2026-08-07 AM.** Zero-client autopick
capability was **observed in vivo** during run #1: observer died at
assert C in ~5s BEFORE the harness could spawn; the 12 picks to seq
14 that landed 00:10-00:16Z were **the engine's autopick cascade**
(timer → handleClockExpired → autopick × 12 → F24 emitter → F26
teardown, fully autonomous). Amendment 7's rig is now **confirmation,
not exploration** — the mechanism is already proven; the rig
re-witnesses it in controlled conditions with pre-registered asserts.

Nobody-ever-joined case (NOTIFY arrives, no lobby exists) is F23 —
`LobbyRegistry.ts` needs a DB-side scan for vanished lobbies. Out of
F26/F27 scope; task #20 tracks.

**Note: bootstrap-arming is load-bearing in this design.** Post-
ignition first-join must arm from a possibly-past deadline (if wait
before join exceeded pick_time). F20 identity/wallclock guards
(`LobbyManager.ts:4179+`) own the immediate-fire case. Acceptance
must watch for those log lines.

### Findings from the connection-ledger forensics (architect addendum 2026-08-07 AM)

Recorded here for the campaign record — not INS entries themselves,
but material observations that reshape the tonight-of narrative:

1. **Reap path PROVEN.** Smoke lobby got reaped between 23:27Z and
   00:09Z. `LobbyRegistry.scanIdleLobbies` (10-min idle, 3-min scan)
   does its job when connections truly drop to zero + status ∈
   {not_started, completed, cancelled}. This closes an open
   observability question — reap was documented but not previously
   witnessed in operational logs.
2. **F23 empirical priority strengthened.** Overnight DB verdict:
   fixture league untouched for 9.5 hours — seq 1, in_progress,
   expired deadline. NO sweeper exists anywhere in the system that
   would catch this. F27 brief Q2 (which assumed scanClockLiveness
   covered this class) is FORMALLY CORRECTED — scanner is live-
   in-progress-lobbies only, not registry-blind stalls. F23 (task
   #20) is now the natural inheritor with concrete evidence.
3. **Zero-client autopick capability observed in vivo.** Run #1's
   12-pick cascade AFTER observer death is direct evidence. F24
   emitter + F26 teardown both fire under fully-autonomous
   conditions. THE TWELVE has an even stronger safety net than
   originally scoped — if all 12 human clients drop mid-draft,
   engine still completes the draft on schedule.
4. **F27b "socket-liveness purge" DOWNGRADED.** Original F27b
   parked-list item envisioned a scanner that force-purges zombie
   sockets after heartbeat-timeout × 3. Not needed absent evidence
   of true dead-socket lingering. The one immortal connection this
   session was a REAL user's browser tab (legitimate live client);
   engine reap-exempt behavior for in_progress + connectionCount≥1
   was correct. Item removed from F27b parked list.
5. **F27b guard-refusal WARN log (freebie item 2) STAYS.** Even in
   a REAL-user scenario where the guard would legitimately refuse
   during bootstrap-replay against an already-in-progress lobby,
   the WARN log is useful observability — it distinguishes
   "expected replay skip" from "stale-status ignition failure."
   Landed in this session's commit for next-engine-deploy ride.
