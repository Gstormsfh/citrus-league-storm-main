#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# Citrus draft-night pre-flight (read-only; safe to run any time)
# ─────────────────────────────────────────────────────────────────────
#
# Runs every infrastructure check in docs/RUNBOOKS/PRE_DRAFT_CHECKLIST.md
# "T-60 minutes" that a machine can run, and prints PASS/FAIL per line
# with the evidence. Exit 1 on any FAIL. Nothing here changes anything.
#
# Born from 2026-09-16: every draft room in production was down for two
# days because the API's new Cloud Run service had no SUPABASE_JWT_SECRET,
# and the checklist's own commands were still pointed at the OLD region,
# so a person following it would have seen a healthy service that no
# longer took traffic.
#
# Usage:
#   bash scripts/ops/draft-preflight.sh                # production
#   bash scripts/ops/draft-preflight.sh --skip-gcloud  # only the public checks (no gcloud needed)
#
# Needs: curl, jq, python3; gcloud authenticated on citrus-fantasy-prod
# for the Cloud Run / VM / freeze-gate checks.
set -uo pipefail

PROJECT_ID="${PROJECT_ID:-citrus-fantasy-prod}"
API_REGION="${API_REGION:-northamerica-northeast1}"
API_HOST="${API_HOST:-citrusfantasysports.com}"
ENGINE_HOST="${ENGINE_HOST:-draft.citrusfantasysports.com}"
ENGINE_VM="${ENGINE_VM:-citrus-draft-engine-prod}"
ENGINE_ZONE="${ENGINE_ZONE:-northamerica-northeast1-a}"
SKIP_GCLOUD=false
[ "${1:-}" = "--skip-gcloud" ] && SKIP_GCLOUD=true

FAILS=0
pass() { printf 'PASS  %-46s %s\n' "$1" "${2:-}"; }
fail() { printf 'FAIL  %-46s %s\n' "$1" "${2:-}"; FAILS=$((FAILS + 1)); }
warn() { printf 'WARN  %-46s %s\n' "$1" "${2:-}"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "missing tool: $1"; exit 2; }; }
need curl; need jq; need python3

echo "== Citrus draft pre-flight  $(date -u +%Y-%m-%dT%H:%M:%SZ)  project=${PROJECT_ID} region=${API_REGION}"

# ── 1. API health from the public edge, and the two secrets it proves ──
body="$(curl -s --max-time 10 "https://${API_HOST}/api/health" || true)"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://${API_HOST}/api/health" || echo 000)"
if [ "${code}" = "200" ]; then pass "API /api/health via ${API_HOST}" "HTTP 200"; else fail "API /api/health via ${API_HOST}" "HTTP ${code}"; fi
for k in database draftToken scheduledTrigger circuitBreaker; do
  v="$(printf '%s' "${body}" | jq -r ".checks.${k} // \"missing\"" 2>/dev/null || echo missing)"
  case "${k}" in
    draftToken) why="NO draft room can connect: the API cannot sign draft tokens" ;;
    scheduledTrigger) why="waivers, roster lock and sweeps are refused" ;;
    *) why="" ;;
  esac
  if [ "${v}" = "ok" ]; then pass "  checks.${k}" "ok"; else fail "  checks.${k}" "${v}  ${why}"; fi
done

# ── 2. Engine reachable from the internet (404 + uWS body is the alive signal) ──
ecode="$(curl -s -o /tmp/preflight-engine.$$ -w '%{http_code}' --max-time 10 "https://${ENGINE_HOST}/" || echo 000)"
if [ "${ecode}" = "404" ] && grep -q uWebSockets /tmp/preflight-engine.$$ 2>/dev/null; then
  pass "Engine edge https://${ENGINE_HOST}/" "404 from uWebSockets"
else
  fail "Engine edge https://${ENGINE_HOST}/" "HTTP ${ecode}, body: $(head -c 80 /tmp/preflight-engine.$$ 2>/dev/null | tr '\n' ' ')"
fi
rm -f /tmp/preflight-engine.$$

# ── 3. TLS certificate on the engine has > 14 days left ──
exp="$(echo | openssl s_client -servername "${ENGINE_HOST}" -connect "${ENGINE_HOST}:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || true)"
if [ -n "${exp}" ]; then
  days="$(python3 - "${exp}" <<'PY'
import sys, datetime
from email.utils import parsedate_to_datetime
s = sys.argv[1].strip()
try:
    d = datetime.datetime.strptime(s, "%b %d %H:%M:%S %Y %Z")
except ValueError:
    d = parsedate_to_datetime(s)
print(int((d - datetime.datetime.utcnow()).total_seconds() // 86400))
PY
)"
  if [ "${days}" -gt 14 ]; then pass "Engine TLS certificate" "${days} days left"; else fail "Engine TLS certificate" "${days} days left (Caddy should renew at 30; check its logs)"; fi
else
  warn "Engine TLS certificate" "could not read expiry (openssl missing?)"
fi

# ── 4. Web app serves and its CSP allows the engine socket ──
csp="$(curl -sI --max-time 10 "https://${API_HOST}/" | tr -d '\r' | grep -i '^content-security-policy:' || true)"
if printf '%s' "${csp}" | grep -q "wss://${ENGINE_HOST}"; then pass "CSP connect-src allows wss://${ENGINE_HOST}" ""; else fail "CSP connect-src allows wss://${ENGINE_HOST}" "browser would refuse the socket"; fi

if [ "${SKIP_GCLOUD}" = true ]; then
  echo "== gcloud checks skipped (--skip-gcloud)"
else
  need gcloud
  # ── 5. Cloud Run: right region, scaling, secrets mounted, latest ready == serving ──
  svc="$(gcloud run services describe citrus-api --region="${API_REGION}" --project="${PROJECT_ID}" --format=json 2>/dev/null || echo '{}')"
  if [ "$(printf '%s' "${svc}" | jq -r '.metadata.name // empty')" = "citrus-api" ]; then
    pass "Cloud Run citrus-api exists in ${API_REGION}" ""
    ann="$(printf '%s' "${svc}" | jq -r '.spec.template.metadata.annotations')"
    minS="$(printf '%s' "${ann}" | jq -r '."autoscaling.knative.dev/minScale" // "unset"')"
    maxS="$(printf '%s' "${ann}" | jq -r '."autoscaling.knative.dev/maxScale" // "unset"')"
    thr="$(printf '%s' "${ann}" | jq -r '."run.googleapis.com/cpu-throttling" // "unset"')"
    mem="$(printf '%s' "${svc}" | jq -r '.spec.template.spec.containers[0].resources.limits.memory // "unset"')"
    cpu="$(printf '%s' "${svc}" | jq -r '.spec.template.spec.containers[0].resources.limits.cpu // "unset"')"
    if [ "${minS}" = "1" ] && [ "${maxS}" = "10" ] && [ "${thr}" = "false" ] && [ "${mem}" = "2Gi" ] && [ "${cpu}" = "2" ]; then
      pass "  scaling minScale=1 maxScale=10 throttling=off 2Gi/2cpu" ""
    else
      fail "  scaling" "minScale=${minS} maxScale=${maxS} throttling=${thr} mem=${mem} cpu=${cpu} (April-10 disaster values are 512Mi/3/0)"
    fi
    for k in SUPABASE_JWT_SECRET SCHEDULED_TRIGGER_SECRET DRAFT_WS_HOST DRAFT_WS_PORT SUPABASE_SERVICE_ROLE_KEY; do
      if printf '%s' "${svc}" | jq -e --arg k "${k}" '.spec.template.spec.containers[0].env[]? | select(.name == $k)' >/dev/null; then
        pass "  env ${k} declared on the service" ""
      else
        fail "  env ${k} declared on the service" "missing: the 2026-09-16 outage shape"
      fi
    done
    wsh="$(printf '%s' "${svc}" | jq -r '.spec.template.spec.containers[0].env[]? | select(.name=="DRAFT_WS_HOST") | .value // empty')"
    [ "${wsh}" = "${ENGINE_HOST}" ] && pass "  DRAFT_WS_HOST value" "${wsh}" || fail "  DRAFT_WS_HOST value" "'${wsh}' (browsers would be sent to the wrong engine; localhost if empty)"
    lc="$(printf '%s' "${svc}" | jq -r '.status.latestCreatedRevisionName')"; lr="$(printf '%s' "${svc}" | jq -r '.status.latestReadyRevisionName')"; sv="$(printf '%s' "${svc}" | jq -r '.status.traffic[0].revisionName')"
    if [ "${lc}" = "${lr}" ] && [ "${lr}" = "${sv}" ]; then pass "  serving == latest ready == latest created" "${sv}"; else fail "  revision state" "created=${lc} ready=${lr} serving=${sv} (a revision that never became ready is sitting there)"; fi
  else
    fail "Cloud Run citrus-api exists in ${API_REGION}" "describe returned nothing; are you authenticated on ${PROJECT_ID}?"
  fi

  # ── 6. Firebase routes /api/** to THIS region (a stale rewrite sends traffic to a service nobody deploys) ──
  fbregion="$(python3 -c 'import json,sys; f=json.load(open(sys.argv[1])); h=f["hosting"] if isinstance(f["hosting"],dict) else f["hosting"][0]; print(next((r["run"]["region"] for r in h["rewrites"] if r.get("source")=="/api/**"),""))' "$(dirname "$0")/../../firebase.json" 2>/dev/null || true)"
  [ "${fbregion}" = "${API_REGION}" ] && pass "firebase.json /api/** -> ${API_REGION}" "" || fail "firebase.json /api/** region" "'${fbregion}' (expected ${API_REGION})"

  # ── 7. Engine VM: running, will auto-restart, live-migrates on host maintenance ──
  vm="$(gcloud compute instances describe "${ENGINE_VM}" --zone="${ENGINE_ZONE}" --project="${PROJECT_ID}" --format=json 2>/dev/null || echo '{}')"
  st="$(printf '%s' "${vm}" | jq -r '.status // "unknown"')"
  [ "${st}" = "RUNNING" ] && pass "Engine VM ${ENGINE_VM} status" "RUNNING" || fail "Engine VM ${ENGINE_VM} status" "${st}"
  ar="$(printf '%s' "${vm}" | jq -r '.scheduling.automaticRestart // "unknown"')"; hm="$(printf '%s' "${vm}" | jq -r '.scheduling.onHostMaintenance // "unknown"')"
  [ "${ar}" = "true" ] && pass "  automaticRestart" "true" || fail "  automaticRestart" "${ar} (a host crash would leave the engine down until a human notices)"
  [ "${hm}" = "MIGRATE" ] && pass "  onHostMaintenance" "MIGRATE" || fail "  onHostMaintenance" "${hm} (TERMINATE means Google maintenance kills every live draft)"
  ip="$(printf '%s' "${vm}" | jq -r '.networkInterfaces[0].accessConfigs[0].natIP // empty')"
  dns="$(python3 -c 'import socket,sys; print(",".join(sorted({a[4][0] for a in socket.getaddrinfo(sys.argv[1],443)})))' "${ENGINE_HOST}" 2>/dev/null || true)"
  [ -n "${ip}" ] && [ "${dns}" = "${ip}" ] && pass "  DNS ${ENGINE_HOST} -> VM IP" "${ip}" || fail "  DNS ${ENGINE_HOST} -> VM IP" "dns=${dns} vm=${ip}"

  # ── 8. Engine heard itself in the last 5 minutes (LISTEN/NOTIFY watchdog) and the deploy fingerprint is known ──
  wd="$(gcloud logging read '(jsonPayload.container.metadata.app="citrus-draft-engine") AND jsonPayload.message:"event_subscription.watchdog_ok"' --project="${PROJECT_ID}" --freshness=5m --limit=1 --format='value(timestamp)' 2>/dev/null || true)"
  [ -n "${wd}" ] && pass "Engine watchdog_ok within 5 min" "${wd}" || fail "Engine watchdog_ok within 5 min" "none: LISTEN/NOTIFY dead or engine down; ignitions would never reach the engine"
  fp="$(gcloud logging read '(jsonPayload.container.metadata.app="citrus-draft-engine") AND jsonPayload.message:"deployment.fingerprint"' --project="${PROJECT_ID}" --freshness=30d --limit=1 --format='value(timestamp,jsonPayload.message)' 2>/dev/null | head -c 300 || true)"
  [ -n "${fp}" ] && pass "Engine deployment.fingerprint seen (last boot)" "$(printf '%s' "${fp}" | cut -c1-19)" || warn "Engine deployment.fingerprint" "none in 30 days of logs"

  # ── 9. Draft canary succeeded in the last 10 minutes ──
  cn="$(gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="citrus-api" AND jsonPayload.event="draft_canary.ok"' --project="${PROJECT_ID}" --freshness=10m --limit=1 --format='value(timestamp,jsonPayload.latencyMs)' 2>/dev/null || true)"
  [ -n "${cn}" ] && pass "Draft canary ok within 10 min (API token accepted by engine)" "${cn}" || fail "Draft canary ok within 10 min" "none: either unconfigured (draft_canary.disabled in the boot log) or the join path is broken"

  # ── 10. Nobody is mid-draft right now (deploy freeze gate view) ──
  # Read-only; uses the same RPC the deploy gate uses. Needs the service key via gcloud secret access.
  if key="$(gcloud secrets versions access latest --secret=SUPABASE_SERVICE_ROLE_KEY --project="${PROJECT_ID}" 2>/dev/null)" && [ -n "${key}" ]; then
    url="$(gcloud secrets versions access latest --secret=SUPABASE_URL --project="${PROJECT_ID}" 2>/dev/null || true)"
    if [ -n "${url}" ]; then
      gate="$(curl -s --max-time 10 -X POST "${url}/rest/v1/rpc/draft_freeze_blockers" -H "apikey: ${key}" -H "Authorization: Bearer ${key}" -H "Content-Type: application/json" -d '{}' || echo '[]')"
      n="$(printf '%s' "${gate}" | jq 'length' 2>/dev/null || echo '?')"
      if [ "${n}" = "0" ]; then pass "Freeze gate: no live or imminent drafts" ""; else warn "Freeze gate: ${n} league(s) live or imminent" "$(printf '%s' "${gate}" | jq -r '.[] | "\(.league_name): \(.reason)"' 2>/dev/null | head -5 | tr '\n' ';')"; fi
      flag="$(curl -s --max-time 10 "${url}/rest/v1/system_flags?flag_name=eq.no_new_drafts&select=flag_value" -H "apikey: ${key}" -H "Authorization: Bearer ${key}" | jq -r '.[0].flag_value // "absent"' 2>/dev/null || echo '?')"
      [ "${flag}" = "false" ] || [ "${flag}" = "absent" ] && pass "system_flags.no_new_drafts" "${flag}" || fail "system_flags.no_new_drafts" "${flag} (new drafts are kill-switched)"
    fi
  else
    warn "Freeze gate / kill switch" "skipped: cannot read SUPABASE_SERVICE_ROLE_KEY from Secret Manager"
  fi
fi

echo "== ${FAILS} FAIL(s)"
[ "${FAILS}" -eq 0 ]
