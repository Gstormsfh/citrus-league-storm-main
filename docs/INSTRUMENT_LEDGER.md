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
