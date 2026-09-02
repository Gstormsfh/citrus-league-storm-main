# Draft engine — Cloud Monitoring as code

Alert policies, log-based metrics and the Mandate dashboard for the draft
engine on `citrus-draft-engine-prod` (project `citrus-fantasy-prod`, zone
`northamerica-northeast1-a`). Everything here is applied by one gcloud-only
script; there is no Terraform and no state file (chunk 11g.10 sub-step 10d,
`docs/PHASE_4_5_PRODUCTIONIZATION_PLAN.md` §6.3). Process audit 2026-09-01
§B-8 / §B-9 / §D-8 / §D-9 is the spec.

Before this directory existed nobody was paged when `watchdog_ok` stopped or
when the VM's startup script died at `docker pull` (2026-09-01: an ungated
Cloud Shell block pointed the VM at a tag that was never pushed; the previous
container kept serving via `--restart=always` and nothing outside the VM
noticed).

## Files

| File | Kind | Purpose |
|---|---|---|
| `metric-watchdog-ok.json` | log-based counter | one count per `event_subscription.watchdog_ok` line (engine emits one every 60 s) |
| `metric-engine-errors.json` | log-based counter | one count per `severity: ERROR` structured line, label `event` |
| `metric-pick-total-ms.json` | log-based DISTRIBUTION | `pick.processed.totalMs`, label `wasAutopick` |
| `metric-pick-rpc-ms.json` | log-based DISTRIBUTION | `pick.processed.rpcMs` (submit_pick_v2 round trip) |
| `metric-pick-broadcast-ms.json` | log-based DISTRIBUTION | `pick.processed.broadcastMs` (uWS publish; duplicates excluded) |
| `metric-external-event-notify-to-broadcast-ms.json` | log-based DISTRIBUTION | `external_event.applied.notifyToBroadcastMs`, label `eventType` — the server-side half of every manual pick today (HTTP route → RPC → NOTIFY → engine broadcast) |
| `alert-watchdog-absent.json` | alert policy | watchdog metric absent for 15 min → e-mail (CRITICAL) |
| `alert-engine-errors.json` | alert policy | 3+ ERROR lines in any 5-minute window → e-mail (ERROR) |
| `alert-startup-failed.json` | log-based alert policy | any `citrus-startup-failed` entry → e-mail (CRITICAL) |
| `dashboard-draft-mandate.json` | dashboard | "Citrus Draft Mandate": p50/p95/p99 charts with the Mandate limits drawn as reference lines, watchdog + error panels, raw fingerprint / startup-failure log panel |
| `apply-monitoring.sh` | script | idempotent create-or-update of all of the above + the e-mail channel; `--dry-run` |

The emitters: `event_subscription.watchdog_ok` (`server/src/draft/eventSubscription.ts`),
`deployment.fingerprint` (`server/src/draft/index.ts`), `pick.processed`
(`server/src/draft/LobbyManager.ts`), all through
`packages/shared/src/utils/structuredLogger.ts`; `citrus-startup-failed` from
the ERR/EXIT trap in `infra/gce/draft-engine-startup.sh`.

## The log shape, and which filter form is live

The engine prints one JSON object per line: `{"severity":"INFO","time":"...","event":"pick.processed",...}`
(no whitespace — `JSON.stringify`). The container runs with Docker's
`--log-driver=gcplogs` (startup script Step 6). **gcplogs does not parse the
line.** Every entry lands as

```
logName      projects/citrus-fantasy-prod/logs/gcplogs-docker-driver
resource     gce_instance
severity     DEFAULT                                   <- never ERROR, whatever the line says
jsonPayload  { container: { name, id, imageName, metadata: { app: "citrus-draft-engine", environment: "production" } },
               instance:  { name, id, zone },
               message:   "{\"severity\":\"INFO\",\"event\":\"deployment.fingerprint\",...}" }   <- a STRING
```

(observed in prod on 2026-09-01; it is also what moby's
`daemon/logger/gcplogs/gcplogging.go` builds: `dockerLogEntry{Instance, Container, Message string}`
with no severity). Consequences, baked into every filter here:

* **Live form (expected to match today):** `jsonPayload.message:"\"event\":\"deployment.fingerprint\""`
  and `jsonPayload.container.metadata.app="citrus-draft-engine"`. The `:` (has)
  operator is a substring match on the raw line; the escaped quotes make it
  key-exact.
* **Parsed form (matches only if the agent ever changes):** `jsonPayload.event="deployment.fingerprint"`,
  `labels.app="citrus-draft-engine"`, `severity>=ERROR`. Every filter ORs both
  forms so a future switch to the Ops Agent with JSON parsing needs no edit
  here — except the three DISTRIBUTION metrics, whose `valueExtractor` can
  only be one expression and is `REGEXP_EXTRACT(jsonPayload.message, ...)`;
  switch them to `EXTRACT(jsonPayload.totalMs)` etc. on that day.
* `severity>=ERROR` alone matches **nothing** today; the ERROR metric's live
  clause is `jsonPayload.message:"\"severity\":\"ERROR\""`.
* The filter in `docs/DEPLOY_PROTOCOL_F26_F27.md` §4b and
  `docs/RUNBOOKS/SUNDAY_EXECUTION_BLOCKS.md` (`jsonPayload.message="deployment.fingerprint"`,
  exact equality) matches nothing, and the audit's proposed
  `jsonPayload.event="deployment.fingerprint"` matches nothing either under
  gcplogs. The working one-liner is:

  ```bash
  gcloud logging read '(jsonPayload.container.metadata.app="citrus-draft-engine") AND jsonPayload.message:"\"event\":\"deployment.fingerprint\""' \
    --project=citrus-fantasy-prod --limit=1 --order=desc --format='value(jsonPayload.message)'
  ```

## The alerts

### `Citrus draft engine: watchdog_ok absent for 15 min` (CRITICAL)

* **Means.** No `event_subscription.watchdog_ok` line for 15 minutes (15 missed
  60-second probes). The watchdog is the engine's only *active* liveness
  signal — it proves the process, the LISTEN/NOTIFY connection and the log
  pipeline are all alive. Silence = engine/container down, VM off or stuck
  mid-converge, subscription dead in a `watchdog_failed` reconnect loop, or
  Cloud Logging not receiving container logs.
* **Do.** `curl -s -o /dev/null -w '%{http_code}\n' https://draft.citrusfantasysports.com/`
  (404 = engine up). Then `docs/RUNBOOKS/draft-engine-v2-operations.md`:
  §2.1 *Engine appears down* if the process is gone; §2.13 *LISTEN/NOTIFY
  failure* + §5.2 *PgBouncer-pooled URL gotcha* if it is up but the
  subscription is looping. Also check for a startup-failure entry (next
  alert): a failed `docker pull` leaves the *old* container running.
* **Tuning.** `duration` in `alert-watchdog-absent.json` (900 s). Do not go
  below 300 s — one missed probe plus ingestion lag is normal.
* **Caveat.** A metric-absence condition only judges a series that has
  existed; the first `watchdog_ok` after apply "primes" it (~60 s after the
  engine is up). Until then the policy is silent, not broken.

### `Citrus draft engine: ERROR log rate (3+ in 5 min)` (ERROR)

* **Means.** Three or more `severity: ERROR` structured lines from the engine
  container inside one 5-minute window. A healthy engine logs zero — every
  `structuredLogger.error(...)` in `server/src/draft/` is a real failure
  (RPC failure, subscription fetch/apply failure, snapshot build failure,
  orphan-scan failure, uWS listen failure). The threshold is 3, not 1, so a
  single retried blip on a Supabase hiccup does not e-mail at 3 am; the
  16-hour `connect ECONNREFUSED` loop of 2026-08-19 trips it within one
  window.
* **Do.** Pull the lines (the `event` field names the failing path):
  ```bash
  gcloud logging read '(jsonPayload.container.metadata.app="citrus-draft-engine") AND jsonPayload.message:"\"severity\":\"ERROR\""' \
    --project=citrus-fantasy-prod --freshness=30m --limit=50 --order=desc --format='value(jsonPayload.message)'
  ```
  Then the runbook by event family: `event_subscription.*` → §2.13 / §5;
  `snapshot.*` → §6; `registry.*` / `uws.*` → §2.1; pick-path RPC errors →
  §2.2 / §2.3; `autopick.*` → §2.5. Deployed in the last hour? Compare the
  `deployment.fingerprint` and read `docs/RUNBOOKS/draft-engine-v2-rollback-playbook.md`.
* **Tuning.** `thresholdValue` (2 → "more than 2") and `alignmentPeriod`
  (300 s) in `alert-engine-errors.json`.

### `Citrus draft engine: VM startup script failed` (CRITICAL)

* **Means.** `infra/gce/draft-engine-startup.sh` exited non-zero on the VM and
  the ERR/EXIT trap shipped a `citrus-startup-failed` entry
  (`jsonPayload.exitStatus`, `line`, unexpanded `command`, `logTail`,
  `imageUri`, `vm`). Typical cause: `image-tag` metadata points at a tag that
  was never pushed → `docker pull` fails at Step 4 → `--restart=always` keeps
  the **previous** container serving old code while looking alive. Secret
  Manager access failures (Step 3 `FATAL`) and Caddy/Docker failures land
  here too.
* **Do.** Read the entry, confirm what is actually running (fingerprint
  one-liner above vs. the VM's `image-sha` metadata), then
  `docs/DEPLOY_PROTOCOL_F26_F27.md` §4b (retag → metadata revert → reset) /
  rollback playbook Scenario 2 for a bad image, or runbook §2.1 + §5.2 for a
  secret problem. Never `reset` mid-draft (§4d daylight rule).
* **Only after the metadata is re-applied.** The trap runs on the VM only
  once the `startup-script` metadata is refreshed from this repo — see
  *What remains manual*. Successful converges and idempotent skips write
  nothing to this log; it is silent by design.

## The dashboard

`Citrus Draft Mandate`: autopick `totalMs` p50/p95/p99 with the 1000 ms /
2000 ms Mandate lines; manual-pick NOTIFY→broadcast (`external_event.applied`,
`eventType=pick`) with the 200 ms fanout line and the 300 ms end-to-end line
for reference; `broadcastMs` with the 200 ms fanout line; `rpcMs` with the
runbook's 200 ms guidance line; an engine-path manual-pick chart
(`wasAutopick=false`) that stays empty until the WS-direct submit
optimisation (10c-2) ships — today `pick.processed` fires only for
engine-authored autopicks, and every manual pick goes HTTP route → RPC →
NOTIFY → engine; watchdog and ERROR panels with their alert thresholds; and a
raw log panel for `deployment.fingerprint`, `watchdog_failed` and
`citrus-startup-failed`. Percentiles are `ALIGN_DELTA` + `REDUCE_PERCENTILE_*`
over the distribution metrics (bucket bounds sit exactly on the Mandate
thresholds so the estimate is sharp where it matters).

Not on the board, because nothing emits them yet: timer drift, draft state
load, reconnection recovery (CLAUDE.md targets without a structured-log
event). Autopick deadline→commit latency derived from `draft_events` is the
weekly scorecard (`.github/workflows/draft-scorecard.yml` →
`data-pipeline/monitoring/draft_latency_scorecard.py` →
`draft_latency_scorecard` view), not Cloud Monitoring.

## Apply (Cloud Shell, ~2 minutes)

```bash
cd ~/citrus-league-storm-main && git pull   # or wherever the repo is checked out
bash infra/gcp/monitoring/apply-monitoring.sh --project citrus-fantasy-prod --email <ops address> --dry-run
bash infra/gcp/monitoring/apply-monitoring.sh --project citrus-fantasy-prod --email <ops address>
```

`--email` is only needed the first time (it creates the "Citrus ops email"
channel; afterwards the channel is found by display name). Re-running after
editing any JSON updates the live object in place: metrics by name, policies
and the dashboard by display name. `--dry-run` still runs the read-only
lookups and pre-validates every log filter with `gcloud logging read`, so a
syntax error surfaces before anything is created. Needs
`roles/monitoring.editor` + `roles/logging.configWriter` (the founder's owner
account has both).

## How to test

1. **Filters match real lines** (run before trusting any policy):
   ```bash
   gcloud logging read "$(python3 -c 'import json;print(json.load(open("infra/gcp/monitoring/metric-watchdog-ok.json"))["filter"])')" \
     --project=citrus-fantasy-prod --freshness=10m --limit=3 --format='value(timestamp,jsonPayload.message)'
   ```
   Expect ~1 line per minute. Same recipe with `metric-pick-total-ms.json`
   during/after a draft.
2. **ERROR alert end to end** (fake lines in the gcplogs shape; three of them
   inside five minutes):
   ```bash
   for i in 1 2 3; do
     gcloud logging write gcplogs-docker-driver \
       '{"container":{"name":"/smoke-test","metadata":{"app":"citrus-draft-engine","environment":"smoke-test"}},"message":"{\"severity\":\"ERROR\",\"time\":\"2026-01-01T00:00:00.000Z\",\"event\":\"ops.alert_smoke_test\",\"note\":\"delete me\"}"}' \
       --payload-type=json --project=citrus-fantasy-prod
   done
   ```
   The e-mail arrives within ~5–10 minutes (log-based metric ingestion +
   the 300 s window). The lines carry `environment=smoke-test` so they are
   easy to exclude in queries later.
3. **Startup-failure alert:**
   ```bash
   gcloud logging write citrus-startup-failed \
     '{"event":"startup.failed","exitStatus":1,"line":"smoke","command":"smoke test from infra/gcp/monitoring/README.md","logTail":"n/a","vm":"cloud-shell","imageUri":"n/a"}' \
     --payload-type=json --severity=ERROR --project=citrus-fantasy-prod
   ```
   One e-mail within a few minutes (rate-limited to one per 5 minutes).
4. **Watchdog absence** cannot be faked from Cloud Shell. Verify the metric
   has data (step 1) and, on staging, `docker stop citrus-draft-engine` for
   16 minutes to see the CRITICAL e-mail, then `docker start` — 10d's own
   pass criterion ("kill staging engine and verify the alert lands").
5. **The VM trap** after re-applying the metadata: set `image-tag` to a tag
   that does not exist on a *staging* VM, `reset`, and expect a
   `citrus-startup-failed` entry with `command":"docker pull ...`; restore
   the tag and `reset` again.

## What remains manual (and why)

* **Running `apply-monitoring.sh`** — needs an account with monitoring/logging
  write on the prod project; Claude's sessions cannot run gcloud against
  prod (audit §F, prod mutation stays behind a human).
* **Re-applying the startup script** so the trap reaches the VM:
  ```bash
  gcloud compute instances add-metadata citrus-draft-engine-prod \
    --zone=northamerica-northeast1-a --project=citrus-fantasy-prod \
    --metadata-from-file=startup-script=infra/gce/draft-engine-startup.sh
  ```
  Takes effect on the next converge (reset/boot); pick a daylight window
  with no draft in progress. The script is byte-for-byte the repo file, so
  the deploy protocol's "verify, pin, record" applies.
* **The notification address.** The audit recommends a dedicated ops mailbox
  and enabling the Gmail connector scoped to it so Claude can read the alert
  e-mails; that is a Garrett decision.
* **Verifying the filters against live entries once** (test step 1). The
  filter forms were written from the entry shape observed on 2026-09-01 and
  the gcplogs source; if a field name differs on the live project, edit the
  JSON and re-run the script — nothing else changes.

## Limits worth knowing

* Log-based metrics only see entries ingested after the metric exists; there
  is no backfill, so the dashboard starts empty and fills from the next draft.
* A log-based metric's label cardinality counts against Cloud Monitoring's
  active-series quota; `event` (error metric) is bounded by the engine's
  taxonomy (runbook §8.2), `wasAutopick` has two values, `environment` two.
  No per-lobby labels on purpose.
* Distribution values are regex-extracted integers; `totalMs`/`rpcMs`/`broadcastMs`
  are `Date.now()` differences in the engine, so nothing is lost.
* `pick.processed` is emitted for picks that go through the engine's action
  queue — today only engine-authored autopicks (`LobbyManager.ts`
  `autopickAction`). Manual picks submitted over the HTTP route
  (`server/src/routes/draftV2Pick.ts`) reach the engine as external events
  and are measured by `external_event.applied.notifyToBroadcastMs` (NOTIFY
  receipt → broadcast; excludes the HTTP hop and the RPC itself). The
  `wasAutopick=false` series stay empty until WS-direct submit ships.
