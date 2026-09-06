# Archive writer preservation and REST proof

The changed legacy fetcher remains local. It reads only exact requested manifest
games with checked pagination, validates final PBP/boxscore identity and pairing,
and records affirmative expected/actual health. Missing or malformed observations
cannot become success merely because another season-wide row count is large.
Original PBP timestamps and processed state are preserved on replay. Existing
source revisions and any non-NULL boxscore evidence are never overwritten.

Fifty-six focused Python tests pass, including timestamp/calendar provenance,
malformed or failed endpoint responses, wrong identities, partial reads, replay,
missing RPC, source corrections, conditional-update no-ops and explicit failure
health. These tests use synthetic HTTP/REST responses and do not establish actual
transport behavior by themselves.

Actual transport testing first proved that placing a whole PBP JSON document in
the update URL fails at realistic payload size. The replacement migration
`20260906050736_fill_archive_boxscore_compare_and_set.sql` adds only a service-
role EXECUTE / SECURITY INVOKER RPC. It compares stored game/date/raw JSON/hash/
fetch timestamp/official URL inside one conditional UPDATE, accepts only a NULL
stored boxscore, and changes only `boxscore_json`. Expected payloads are passed in
the POST body. A stale comparison returns false; invalid arguments raise before
mutation. DateStyle-independent validation preserves the supplied game date.
The client must require an explicit timezone before PostgreSQL coerces its
timestamp, and the Python semantic hash is matched, not reinterpreted as a jsonb
or HTTP-byte digest. Sixty-five isolated SQL checks pass, including service-only
permissions, large arguments, rollback and exact other-column preservation.

The real `fetcher.run` / `SupabaseRest` → localhost gateway → PostgREST 14.12 →
PostgreSQL 17.6 path passes seven phases on synthetic rows with captured
production column identities/types: new insert, unchanged replay, missing-box
fill, full-sized PBP fill, interleaved PBP correction, duplicate insert conflict,
and withholding a later source correction. The test retains all unrelated row
fields and checks the final health audit after every run. The correction and
insertion hooks make actual separate REST calls between the initial read and
guarded write; these are interleavings, not overlapping backend lock witnesses.
See `analytics-local-archive-rest-20260906.json` for repeat runs and cleanup.

Earlier fixture-only failures were retained as limitations, not counted as
passing proof: an internal-only Docker network exposed no host port, the initial
readiness check mistook initdb's temporary server for the final TCP server, and
the image-version command omitted its executable. Each fixture was cleaned up.
The gateway uses explicit localhost port bindings as documented by
[Docker Desktop](https://docs.docker.com/desktop/features/networking/networking-how-tos/).
No Docker setting, unrelated container or image was changed/removed.

Deployment ordering is mandatory: validate/roll out the additive RPC before
enabling missing-box fills in this Python writer. Without it, the job explicitly
fails; it never falls back to a weaker unconditional update. Rollback removes
only this newly added RPC, after disabling the dependent writer. The same-day
read-only preflight captures the existing unique game ID, column types, enabled
RLS, absent RPC and absence of noninternal triggers. No production/staging
function was created and no hosted archive row was changed.

This legacy table still cannot preserve independently timestamped boxscore
observations or corrected source revisions; those need the separate immutable
archive/publication path. Structural pair health is not full shot/statistical
adjudication, a historical as-of guarantee, source-rights confirmation or model
quality. All MoneyPuck files remain excluded from new training.
