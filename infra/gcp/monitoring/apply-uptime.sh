#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# Citrus — edge uptime checks + paging, as code (gcloud only)
# ─────────────────────────────────────────────────────────────────────
#
# Why this exists (2026-09-16). The API was moved to a new Cloud Run
# service without SUPABASE_JWT_SECRET. Every draft room in production sat
# on "Reconnecting..." for two days. Every alert this repo had was green:
# the engine's watchdog was fine (the engine WAS fine), Cloud Run was
# fine, the deploy was fine. Nothing watched the product from the outside,
# and the one signal that existed (e-mail) is not paging.
#
# This script creates or updates, idempotently, matched by DISPLAY NAME:
#   1. an SMS notification channel (--sms +1XXXXXXXXXX; the script then
#      asks Google to text a verification code — see "SMS verification"
#      below) and re-uses the e-mail channel apply-monitoring.sh created
#   2. three Cloud Monitoring uptime checks, every 60 s from 3 regions:
#        "Citrus API health: draft token"      GET citrusfantasysports.com/api/health
#                                              2xx AND $.checks.draftToken == "ok"
#        "Citrus API health: scheduled trigger" same URL, $.checks.scheduledTrigger == "ok"
#        "Citrus draft engine edge"            GET draft.citrusfantasysports.com/
#                                              404 AND body contains "uWebSockets"
#   3. one alert policy per check (alert-uptime-*.json), CRITICAL for the
#      two that take drafts down, wired to BOTH channels
#   3b. the draft canary's log-based metric (citrus_draft_canary_ok) and
#      its two policies: absent for 15 min (CRITICAL), any failure (ERROR).
#      The canary itself lives in the API (server/src/canary/draftCanary.ts)
#      and needs DRAFT_CANARY_LEAGUE_ID / DRAFT_CANARY_USER_ID on the
#      serving revision (production-deploy.yml env_vars).
#   3c. an API 5xx-rate policy (alert-api-5xx.json): the server has no
#      error tracker, so Cloud Run's own request metric is the signal.
#   4. attaches the SMS channel to the three engine policies
#      apply-monitoring.sh owns (watchdog absent, engine errors, startup
#      failed) so those page too
#
# The two /api/health checks depend on the health route reporting
# `checks.draftToken` and `checks.scheduledTrigger` (server/src/app.ts).
# Until that is deployed they FAIL, which is correct: the API cannot prove
# its secrets yet.
#
# Usage (from a machine with gcloud authenticated as a project owner):
#   bash infra/gcp/monitoring/apply-uptime.sh --sms +15875550123
#   bash infra/gcp/monitoring/apply-uptime.sh --sms +15875550123 --dry-run
#   bash infra/gcp/monitoring/apply-uptime.sh --sms-verify 123456     # after the text arrives
#   bash infra/gcp/monitoring/apply-uptime.sh --sms-send-code          # text didn't arrive: send another
#
# Flags:
#   --project ID       GCP project (default: citrus-fantasy-prod)
#   --sms +E164        phone number for the SMS channel; only needed the
#                      first time (channel matched by display name after)
#   --sms-verify CODE  submit the 6-digit verification code Google texted
#   --sms-send-code    (re)send the verification code to the existing channel
#   --dry-run          look everything up, print the plan, change nothing
#   -h | --help
#
# SMS verification: an SMS channel receives NOTHING until verified.
# Creating a channel through the API does NOT send a code by itself (the
# console does that for you); this script calls sendVerificationCode right
# after creating the channel, Google texts a 6-digit code, and you run the
# script again with --sms-verify CODE. gcloud (583.0.0) has no
# `channels verify` or `send-verification-code` command, so those two
# calls go straight to the Monitoring REST API with your gcloud
# credentials (`gcloud auth print-access-token`). `gcloud alpha monitoring
# channels describe` shows verificationStatus: VERIFIED when done. The
# script refuses to attach an unverified channel to a policy, so an
# unverified channel cannot silently absorb alerts.
#
# Needs: gcloud with the alpha component (policies/channels), a gcloud
# recent enough to have `gcloud monitoring uptime` (2024+), curl, python3.
# Permissions: roles/monitoring.editor on the project.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ID="${PROJECT_ID:-citrus-fantasy-prod}"
MONITORING_API="${MONITORING_API:-https://monitoring.googleapis.com/v3}"  # overridable for tests
SMS_NUMBER=""
SMS_VERIFY_CODE=""
SMS_SEND_CODE=false
DRY_RUN=false
EMAIL_CHANNEL_DISPLAY_NAME="Citrus ops email"
SMS_CHANNEL_DISPLAY_NAME="Citrus ops SMS"

API_HOST="citrusfantasysports.com"
ENGINE_HOST="draft.citrusfantasysports.com"
REGIONS="usa-oregon,usa-iowa,usa-virginia"

# display name | policy file | host | path | matcher spec
# matcher spec: json:<path>  (2xx + JSON path == "ok")  or  body404:<substring> (404 + body contains)
CHECKS=(
  "Citrus API health: draft token|alert-uptime-api-draft-token.json|${API_HOST}|/api/health|json:\$.checks.draftToken"
  "Citrus API health: scheduled trigger|alert-uptime-api-scheduled-trigger.json|${API_HOST}|/api/health|json:\$.checks.scheduledTrigger"
  "Citrus draft engine edge|alert-uptime-engine-edge.json|${ENGINE_HOST}|/|body404:uWebSockets"
)

# Policies apply-monitoring.sh owns; the SMS channel is appended to them.
ENGINE_POLICY_DISPLAY_NAMES=(
  "Citrus draft engine: watchdog_ok absent for 15 min"
  "Citrus draft engine: ERROR log rate (3+ in 5 min)"
  "Citrus draft engine: VM startup script failed"
)

usage() { sed -n '2,/^set -euo pipefail/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; }
log()  { printf '[apply-uptime] %s\n' "$*"; }
plan() { printf '[apply-uptime] %s %s\n' "$([ "${DRY_RUN}" = true ] && echo 'DRY-RUN would' || echo '->')" "$*"; }
die()  { printf '[apply-uptime] ERROR: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --project)     PROJECT_ID="$2"; shift 2 ;;
    --project=*)   PROJECT_ID="${1#*=}"; shift ;;
    --sms)         SMS_NUMBER="$2"; shift 2 ;;
    --sms=*)       SMS_NUMBER="${1#*=}"; shift ;;
    --sms-verify)  SMS_VERIFY_CODE="$2"; shift 2 ;;
    --sms-verify=*) SMS_VERIFY_CODE="${1#*=}"; shift ;;
    --sms-send-code) SMS_SEND_CODE=true; shift ;;
    --dry-run)     DRY_RUN=true; shift ;;
    -h|--help)     usage; exit 0 ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
done

command -v gcloud >/dev/null 2>&1 || die "gcloud not found on PATH"
command -v python3 >/dev/null 2>&1 || die "python3 not found on PATH"
command -v curl >/dev/null 2>&1 || die "curl not found on PATH"
# Catch the placeholders from the docs before they reach the API.
# (glob matches, not regex intervals: macOS bash 3.2 must run this)
case "${SMS_NUMBER}" in
  "") ;;
  +[1-9]*) [[ "${SMS_NUMBER#+}" != *[!0-9]* && ${#SMS_NUMBER} -ge 9 && ${#SMS_NUMBER} -le 16 ]] || die "--sms wants a real E.164 number like +15875550123, got: ${SMS_NUMBER}" ;;
  *) die "--sms wants a real E.164 number like +15875550123, got: ${SMS_NUMBER}" ;;
esac
case "${SMS_VERIFY_CODE}" in
  "") ;;
  [0-9][0-9][0-9][0-9][0-9][0-9]) ;;
  *) die "--sms-verify wants the 6-digit code from the text, got: ${SMS_VERIFY_CODE}" ;;
esac
gcloud alpha monitoring policies --help >/dev/null 2>&1 || die "gcloud alpha component missing: gcloud components install alpha"
gcloud monitoring uptime --help >/dev/null 2>&1 || die "this gcloud has no 'gcloud monitoring uptime' (update: gcloud components update)"
ACTIVE_ACCOUNT="$(gcloud config get-value account 2>/dev/null || true)"
[ -n "${ACTIVE_ACCOUNT}" ] || die "no active gcloud account (run: gcloud auth login)"
WORK="$(mktemp -d)"; trap 'rm -rf "${WORK}"' EXIT
log "project=${PROJECT_ID} account=${ACTIVE_ACCOUNT} dry_run=${DRY_RUN}"

# ── Monitoring REST helper ───────────────────────────────────────────
# gcloud exposes create/list/describe/update/delete for channels but not
# the two verification RPCs, so those go to the API directly.
monitoring_post() { # monitoring_post RESOURCE:VERB JSON_BODY -> response body; dies on non-2xx
  local token out code
  token="$(gcloud auth print-access-token 2>/dev/null)" || die "gcloud auth print-access-token failed (run: gcloud auth login)"
  out="$(curl -sS -X POST \
    -H "Authorization: Bearer ${token}" \
    -H "x-goog-user-project: ${PROJECT_ID}" \
    -H "Content-Type: application/json" \
    -d "$2" -w '\n%{http_code}' "${MONITORING_API}/$1")" || die "curl to monitoring.googleapis.com failed"
  code="${out##*$'\n'}"; out="${out%$'\n'*}"
  case "${code}" in
    2*) printf '%s' "${out}" ;;
    *)  die "POST $1 -> HTTP ${code}: ${out}" ;;
  esac
}

sms_send_code() { # asks Google to text the verification code to SMS_CHANNEL
  plan "send SMS verification code via channel ${SMS_CHANNEL##*/}"
  if [ "${DRY_RUN}" != true ]; then
    monitoring_post "${SMS_CHANNEL}:sendVerificationCode" '{}' >/dev/null
    log "   code sent. When the text arrives:  bash infra/gcp/monitoring/apply-uptime.sh --sms-verify <code>"
  fi
}

channel_by_name() { # channel_by_name DISPLAY TYPE -> name or empty
  gcloud alpha monitoring channels list --project="${PROJECT_ID}" \
    --filter="displayName=\"$1\" AND type=\"$2\"" --format='value(name)' 2>/dev/null | head -n1 || true
}

# ── 1. channels ──────────────────────────────────────────────────────
EMAIL_CHANNEL="$(channel_by_name "${EMAIL_CHANNEL_DISPLAY_NAME}" email)"
[ -n "${EMAIL_CHANNEL}" ] && log "e-mail channel: ${EMAIL_CHANNEL}" || log "e-mail channel: none named \"${EMAIL_CHANNEL_DISPLAY_NAME}\" (run apply-monitoring.sh --email first; continuing with SMS only)"

SMS_CHANNEL="$(channel_by_name "${SMS_CHANNEL_DISPLAY_NAME}" sms)"
if [ -z "${SMS_CHANNEL}" ]; then
  if [ -z "${SMS_NUMBER}" ]; then
    [ "${DRY_RUN}" = true ] || die "no SMS channel named \"${SMS_CHANNEL_DISPLAY_NAME}\"; pass --sms +1XXXXXXXXXX to create it"
    plan "create SMS channel \"${SMS_CHANNEL_DISPLAY_NAME}\" (no --sms given)"
  else
    plan "create SMS channel \"${SMS_CHANNEL_DISPLAY_NAME}\" -> ${SMS_NUMBER}"
    if [ "${DRY_RUN}" != true ]; then
      SMS_CHANNEL="$(gcloud alpha monitoring channels create --project="${PROJECT_ID}" \
        --display-name="${SMS_CHANNEL_DISPLAY_NAME}" \
        --description="Citrus on-call phone (managed by infra/gcp/monitoring/apply-uptime.sh)" \
        --type=sms --channel-labels="number=${SMS_NUMBER}" --format='value(name)')"
      [ -n "${SMS_CHANNEL}" ] || die "SMS channel create returned no name"
      log "   created ${SMS_CHANNEL} -> ${SMS_NUMBER}"
      sms_send_code
    fi
  fi
else
  log "SMS channel: ${SMS_CHANNEL}"
  [ "${SMS_SEND_CODE}" = true ] && sms_send_code
fi

if [ -n "${SMS_VERIFY_CODE}" ] && [ -n "${SMS_CHANNEL}" ] && [ "${DRY_RUN}" != true ]; then
  plan "verify SMS channel with code ${SMS_VERIFY_CODE}"
  resp="$(monitoring_post "${SMS_CHANNEL}:verify" "{\"code\":\"${SMS_VERIFY_CODE}\"}")"
  vs="$(printf '%s' "${resp}" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("verificationStatus",""))' 2>/dev/null || true)"
  [ "${vs}" = "VERIFIED" ] || die "verify did not return VERIFIED (got: ${vs:-<none>}): ${resp}"
  log "   verified"
  SMS_JUST_VERIFIED=true
fi

SMS_VERIFIED=false
if [ "${SMS_JUST_VERIFIED:-false}" = true ]; then
  SMS_VERIFIED=true  # the verify response said so; no need to re-read
elif [ -n "${SMS_CHANNEL}" ]; then  # read-only; fine in dry-run
  vs="$(gcloud alpha monitoring channels describe "${SMS_CHANNEL}" --project="${PROJECT_ID}" --format='value(verificationStatus)' 2>/dev/null || true)"
  if [ "${vs}" = "VERIFIED" ]; then SMS_VERIFIED=true; else log "   SMS channel is ${vs:-UNVERIFIED}: it will NOT be attached to policies until verified (--sms-verify CODE; --sms-send-code if the text never came)"; fi
fi

CHANNELS_JSON="$(python3 - "${EMAIL_CHANNEL}" "$([ "${SMS_VERIFIED}" = true ] && echo "${SMS_CHANNEL}" || echo "")" <<'PY'
import json, sys
print(json.dumps([c for c in sys.argv[1:] if c]))
PY
)"
[ "${CHANNELS_JSON}" != "[]" ] || { [ "${DRY_RUN}" = true ] || die "no notification channel available; nothing would page. Create the e-mail channel (apply-monitoring.sh) or verify the SMS channel first."; }
log "policies will notify: ${CHANNELS_JSON}"

# ── 2. uptime checks ─────────────────────────────────────────────────
uptime_name_by_display() { # -> projects/P/uptimeCheckConfigs/ID or empty
  gcloud monitoring uptime list-configs --project="${PROJECT_ID}" \
    --filter="displayName=\"$1\"" --format='value(name)' 2>/dev/null | head -n1 || true
}

# Plain indexed array, parallel to CHECKS: macOS ships bash 3.2, which has
# no associative arrays, and this script is meant to run from a laptop.
CHECK_IDS=()
for i in "${!CHECKS[@]}"; do
  spec="${CHECKS[$i]}"
  IFS='|' read -r display policy host path matcher <<<"${spec}"
  # `uptime create` and `uptime update` take different flags (checked
  # against gcloud 585): the monitored resource and protocol are fixed at
  # creation, and update spells lists as --set-regions / --set-status-*.
  args=("--path=${path}" --period=1 --timeout=10 --port=443 --validate-ssl=true)
  create_args=(--resource-type=uptime-url "--resource-labels=host=${host},project_id=${PROJECT_ID}"
               --protocol=https "--regions=${REGIONS}")
  update_args=("--set-regions=${REGIONS}")
  case "${matcher}" in
    json:*)
      # For JSONPath matchers the expected content is parsed as a JSON
      # value, so a string must carry its own double quotes ("ok", not ok);
      # the API rejects the bare form with "Unable to parse 'required_content'".
      args+=(--matcher-type=matches-json-path '--matcher-content="ok"'
             "--json-path=${matcher#json:}" --json-path-matcher-type=exact-match)
      create_args+=(--status-classes=2xx); update_args+=(--set-status-classes=2xx) ;;
    body404:*)
      args+=(--matcher-type=contains-string "--matcher-content=${matcher#body404:}")
      create_args+=(--status-codes=404); update_args+=(--set-status-codes=404) ;;
    *) die "bad matcher spec: ${matcher}" ;;
  esac
  existing="$(uptime_name_by_display "${display}")"
  if [ -n "${existing}" ]; then
    plan "update uptime check \"${display}\" (${existing##*/})"
    if [ "${DRY_RUN}" != true ]; then
      gcloud monitoring uptime update "${existing##*/}" --project="${PROJECT_ID}" "${update_args[@]}" "${args[@]}" >/dev/null
    fi
    CHECK_IDS[$i]="${existing##*/}"
  else
    plan "create uptime check \"${display}\": https://${host}${path} [${matcher}]"
    if [ "${DRY_RUN}" != true ]; then
      created="$(gcloud monitoring uptime create "${display}" --project="${PROJECT_ID}" "${create_args[@]}" "${args[@]}" --format='value(name)')"
      [ -n "${created}" ] || die "uptime create returned no name for \"${display}\""
      log "   created ${created}"
      CHECK_IDS[$i]="${created##*/}"
    else
      CHECK_IDS[$i]="DRY-RUN"
    fi
  fi
done

# ── 3. alert policies for the checks ─────────────────────────────────
policy_by_display() {
  gcloud alpha monitoring policies list --project="${PROJECT_ID}" \
    --filter="displayName=\"$1\"" --format='value(name)' 2>/dev/null | head -n1 || true
}

for i in "${!CHECKS[@]}"; do
  spec="${CHECKS[$i]}"
  IFS='|' read -r display policy host path matcher <<<"${spec}"
  src="${HERE}/${policy}"; [ -f "${src}" ] || die "missing ${src}"
  check_id="${CHECK_IDS[$i]}"
  python3 - "${src}" "${WORK}/${policy}" "${check_id}" "${CHANNELS_JSON}" <<'PY'
import sys
src, dst, check_id, channels = sys.argv[1:5]
body = open(src, encoding="utf-8").read()
body = body.replace("${CHECK_ID}", check_id).replace("${NOTIFICATION_CHANNELS}", channels)
if "${" in body:
    sys.exit("unfilled placeholder in " + src)
open(dst, "w", encoding="utf-8").write(body)
PY
  pdisplay="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["displayName"])' "${WORK}/${policy}")"
  existing="$(policy_by_display "${pdisplay}")"
  if [ -n "${existing}" ]; then
    plan "update alert policy \"${pdisplay}\" (${existing##*/})"
    [ "${DRY_RUN}" = true ] || gcloud alpha monitoring policies update "${existing}" --policy-from-file="${WORK}/${policy}" --project="${PROJECT_ID}" >/dev/null
  else
    plan "create alert policy \"${pdisplay}\" (${policy})"
    [ "${DRY_RUN}" = true ] || gcloud alpha monitoring policies create --policy-from-file="${WORK}/${policy}" --project="${PROJECT_ID}" >/dev/null
  fi
done

# ── 3b. the in-process draft canary: log-based metric + two policies ─
# server/src/canary/draftCanary.ts logs draft_canary.ok every 5 min per
# API instance. Absence of ok pages CRITICAL; any failed pages ERROR.
CANARY_METRIC_FILE="metric-draft-canary-ok.json"
CANARY_POLICY_FILES=("alert-draft-canary-absent.json" "alert-draft-canary-failed.json" "alert-api-5xx.json")
src="${HERE}/${CANARY_METRIC_FILE}"; [ -f "${src}" ] || die "missing ${src}"
mname="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["name"])' "${src}")"
if gcloud logging metrics describe "${mname}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  plan "update log-based metric ${mname}"
  [ "${DRY_RUN}" = true ] || gcloud logging metrics update "${mname}" --config-from-file="${src}" --project="${PROJECT_ID}" >/dev/null
else
  plan "create log-based metric ${mname}"
  [ "${DRY_RUN}" = true ] || gcloud logging metrics create "${mname}" --config-from-file="${src}" --project="${PROJECT_ID}" >/dev/null
fi
for policy in "${CANARY_POLICY_FILES[@]}"; do
  src="${HERE}/${policy}"; [ -f "${src}" ] || die "missing ${src}"
  python3 - "${src}" "${WORK}/${policy}" "${CHANNELS_JSON}" <<'PY'
import sys
src, dst, channels = sys.argv[1:4]
body = open(src, encoding="utf-8").read().replace("${NOTIFICATION_CHANNELS}", channels)
if "${" in body:
    sys.exit("unfilled placeholder in " + src)
open(dst, "w", encoding="utf-8").write(body)
PY
  pdisplay="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["displayName"])' "${WORK}/${policy}")"
  existing="$(policy_by_display "${pdisplay}")"
  if [ -n "${existing}" ]; then
    plan "update alert policy \"${pdisplay}\" (${existing##*/})"
    [ "${DRY_RUN}" = true ] || gcloud alpha monitoring policies update "${existing}" --policy-from-file="${WORK}/${policy}" --project="${PROJECT_ID}" >/dev/null
  else
    plan "create alert policy \"${pdisplay}\" (${policy})"
    [ "${DRY_RUN}" = true ] || gcloud alpha monitoring policies create --policy-from-file="${WORK}/${policy}" --project="${PROJECT_ID}" >/dev/null
  fi
done

# ── 4. page on the engine policies too ───────────────────────────────
if [ "${SMS_VERIFIED}" = true ]; then
  for pdisplay in "${ENGINE_POLICY_DISPLAY_NAMES[@]}"; do
    existing="$(policy_by_display "${pdisplay}")"
    if [ -z "${existing}" ]; then log "engine policy \"${pdisplay}\" not found (run apply-monitoring.sh first); skipping"; continue; fi
    has="$(gcloud alpha monitoring policies describe "${existing}" --project="${PROJECT_ID}" --format='value(notificationChannels)' 2>/dev/null || true)"
    if [[ "${has}" == *"${SMS_CHANNEL}"* ]]; then log "engine policy \"${pdisplay}\" already pages"; continue; fi
    plan "attach SMS channel to \"${pdisplay}\""
    [ "${DRY_RUN}" = true ] || gcloud alpha monitoring policies update "${existing}" --add-notification-channels="${SMS_CHANNEL}" --project="${PROJECT_ID}" >/dev/null
  done
else
  log "SMS channel not verified yet; engine policies keep e-mail only for now"
fi

log "done."
[ "${DRY_RUN}" = true ] && log "dry-run: nothing was changed."
cat <<EOF2
Verify (read-only):
  gcloud monitoring uptime list-configs --project=${PROJECT_ID} --format='table(displayName,name.basename(),period)'
  gcloud alpha monitoring policies list --project=${PROJECT_ID} --filter='userLabels.managed-by="apply-uptime-sh"' --format='table(displayName,enabled,notificationChannels)'
The two /api/health checks stay red until the health route that reports
checks.draftToken / checks.scheduledTrigger is the serving revision.
EOF2
