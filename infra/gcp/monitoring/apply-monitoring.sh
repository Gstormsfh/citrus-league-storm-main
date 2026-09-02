#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# Citrus draft engine — Cloud Monitoring apply script (gcloud only)
# ─────────────────────────────────────────────────────────────────────
#
# Creates or updates, idempotently and in dependency order:
#   1. one e-mail notification channel (found by display name, created
#      from --email if missing)
#   2. the log-based metrics   infra/gcp/monitoring/metric-*.json
#   3. the alert policies       infra/gcp/monitoring/alert-*.json
#   4. the dashboard            infra/gcp/monitoring/dashboard-*.json
#
# Everything is matched by NAME (metrics) or DISPLAY NAME (policies,
# dashboards, channel), so re-running after editing a JSON file updates
# the live object in place instead of duplicating it. No Terraform, no
# state file — per docs/PHASE_4_5_PRODUCTIONIZATION_PLAN.md §6.3 ("native
# gcloud, all in one uniform place").
#
# Usage (Cloud Shell, from the repo root or anywhere):
#   bash infra/gcp/monitoring/apply-monitoring.sh --email ops@example.com
#   bash infra/gcp/monitoring/apply-monitoring.sh --email ops@example.com --dry-run
#   bash infra/gcp/monitoring/apply-monitoring.sh --project citrus-fantasy-staging --email ...
#
# Flags:
#   --project ID         GCP project (default: citrus-fantasy-prod, or $PROJECT_ID)
#   --email ADDRESS      e-mail for the notification channel; only required
#                        the first time (when no channel named --channel-name
#                        exists yet)
#   --channel-name NAME  display name of the channel (default: "Citrus ops email")
#   --dry-run            look everything up, validate filters, print the plan,
#                        change nothing
#   --skip-filter-check  do not pre-validate log filters with `gcloud logging read`
#   -h | --help
#
# Placeholders inside the JSON files are filled here before apply:
#   ${PROJECT_ID}             -> --project
#   ${NOTIFICATION_CHANNEL}   -> projects/<id>/notificationChannels/<num>
#
# Needs: gcloud (alpha component for policies/channels — preinstalled in
# Cloud Shell), python3 (only for reading fields out of the JSON files;
# gcloud itself needs it, so it is always there). Permissions:
# roles/monitoring.editor + roles/logging.configWriter on the project.
#
# After the first apply, ALSO re-apply the startup script metadata once so
# the VM starts shipping `citrus-startup-failed` (see README "What remains
# manual"). Verify with the smoke tests in README "How to test".

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PROJECT_ID="${PROJECT_ID:-citrus-fantasy-prod}"
ALERT_EMAIL="${ALERT_EMAIL:-}"
CHANNEL_DISPLAY_NAME="Citrus ops email"
DRY_RUN=false
SKIP_FILTER_CHECK=false

# Dependency order matters: policies reference metrics by type.
METRIC_FILES=(
  "metric-watchdog-ok.json"
  "metric-engine-errors.json"
  "metric-pick-total-ms.json"
  "metric-pick-rpc-ms.json"
  "metric-pick-broadcast-ms.json"
  "metric-external-event-notify-to-broadcast-ms.json"
)
POLICY_FILES=(
  "alert-watchdog-absent.json"
  "alert-engine-errors.json"
  "alert-startup-failed.json"
)
DASHBOARD_FILES=(
  "dashboard-draft-mandate.json"
)

usage() {
  # Print the header comment block (everything above `set -euo pipefail`).
  sed -n '2,/^set -euo pipefail/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'
}

log()  { printf '[apply-monitoring] %s\n' "$*"; }
plan() { printf '[apply-monitoring] %s %s\n' "$([ "${DRY_RUN}" = true ] && echo 'DRY-RUN would' || echo '->')" "$*"; }
die()  { printf '[apply-monitoring] ERROR: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --project)       PROJECT_ID="$2"; shift 2 ;;
    --project=*)     PROJECT_ID="${1#*=}"; shift ;;
    --email)         ALERT_EMAIL="$2"; shift 2 ;;
    --email=*)       ALERT_EMAIL="${1#*=}"; shift ;;
    --channel-name)  CHANNEL_DISPLAY_NAME="$2"; shift 2 ;;
    --channel-name=*) CHANNEL_DISPLAY_NAME="${1#*=}"; shift ;;
    --dry-run)       DRY_RUN=true; shift ;;
    --skip-filter-check) SKIP_FILTER_CHECK=true; shift ;;
    -h|--help)       usage; exit 0 ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
done

command -v gcloud >/dev/null 2>&1 || die "gcloud not found on PATH"
if ! gcloud alpha monitoring policies --help >/dev/null 2>&1; then
  die "the gcloud alpha component is missing (needed for 'gcloud alpha monitoring policies/channels'). In Cloud Shell it is preinstalled; elsewhere run: gcloud components install alpha"
fi
ACTIVE_ACCOUNT="$(gcloud config get-value account 2>/dev/null || true)"
[ -n "${ACTIVE_ACCOUNT}" ] || die "no active gcloud account (run: gcloud auth login)"
PYTHON_BIN="$(command -v python3 || true)"

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

log "project=${PROJECT_ID} account=${ACTIVE_ACCOUNT} dry_run=${DRY_RUN}"

# ── helpers ──────────────────────────────────────────────────────────
json_field() {
  # json_field FILE KEY  -> prints the top-level string field KEY
  local file="$1" key="$2"
  if [ -n "${PYTHON_BIN}" ]; then
    "${PYTHON_BIN}" - "${file}" "${key}" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh:
    print(json.load(fh)[sys.argv[2]])
PY
  else
    # Fallback: first `"KEY": "value"` line. Good enough for name/displayName,
    # which are plain strings on their own line in every file here.
    grep -m1 -E "^[[:space:]]*\"${key}\"[[:space:]]*:" "${file}" \
      | sed -E 's/^[^:]*:[[:space:]]*"(.*)",?[[:space:]]*$/\1/'
  fi
}

render() {
  # render SRC DST — fill the placeholders. `|` is the sed delimiter; the
  # channel name contains `/` and never `|`.
  sed -e "s|\${PROJECT_ID}|${PROJECT_ID}|g" \
      -e "s|\${NOTIFICATION_CHANNEL}|${CHANNEL}|g" "$1" > "$2"
  if grep -q '\${[A-Z_]*}' "$2"; then
    die "unfilled placeholder left in $(basename "$1"): $(grep -o '\${[A-Z_]*}' "$2" | sort -u | tr '\n' ' ')"
  fi
}

check_filter() {
  # check_filter LABEL FILTER — a filter with a syntax error is rejected by
  # `gcloud logging read` immediately, which is a much friendlier failure
  # than the same error out of `metrics create`. Read-only, safe in dry-run.
  local label="$1" filter="$2"
  if [ "${SKIP_FILTER_CHECK}" = true ]; then
    return 0
  fi
  if gcloud logging read "${filter}" --project="${PROJECT_ID}" --limit=1 --freshness=10m \
       --format='value(timestamp)' >/dev/null 2>"${WORK}/filter.err"; then
    log "   filter ok: ${label}"
  else
    printf '%s\n' "$(cat "${WORK}/filter.err")" >&2
    die "Cloud Logging rejected the filter in ${label} (see above)"
  fi
}

# ── 1. notification channel ──────────────────────────────────────────
log "notification channel: looking up \"${CHANNEL_DISPLAY_NAME}\" (type=email)"
CHANNEL="$(gcloud alpha monitoring channels list --project="${PROJECT_ID}" \
  --filter="displayName=\"${CHANNEL_DISPLAY_NAME}\" AND type=\"email\"" \
  --format='value(name)' 2>/dev/null | head -n1 || true)"
if [ -n "${CHANNEL}" ]; then
  log "   found ${CHANNEL}"
  if [ -n "${ALERT_EMAIL}" ]; then
    EXISTING_EMAIL="$(gcloud alpha monitoring channels describe "${CHANNEL}" --project="${PROJECT_ID}" \
      --format='value(labels.email_address)' 2>/dev/null || true)"
    if [ -n "${EXISTING_EMAIL}" ] && [ "${EXISTING_EMAIL}" != "${ALERT_EMAIL}" ]; then
      log "   NOTE: channel delivers to ${EXISTING_EMAIL}, not --email ${ALERT_EMAIL}; not changing it (delete the channel in the console to re-create)"
    fi
  fi
else
  if [ -z "${ALERT_EMAIL}" ] && [ "${DRY_RUN}" != true ]; then
    die "no e-mail channel named \"${CHANNEL_DISPLAY_NAME}\" exists in ${PROJECT_ID}; pass --email ADDRESS to create it"
  fi
  plan "create e-mail channel \"${CHANNEL_DISPLAY_NAME}\" -> ${ALERT_EMAIL:-<--email not given>}"
  if [ "${DRY_RUN}" = true ]; then
    CHANNEL="projects/${PROJECT_ID}/notificationChannels/DRY-RUN"
  else
    CHANNEL="$(gcloud alpha monitoring channels create --project="${PROJECT_ID}" \
      --display-name="${CHANNEL_DISPLAY_NAME}" \
      --description="Citrus draft-engine alert e-mail (managed by infra/gcp/monitoring/apply-monitoring.sh)" \
      --type=email --channel-labels="email_address=${ALERT_EMAIL}" \
      --format='value(name)')"
    [ -n "${CHANNEL}" ] || die "channel create returned no name"
    log "   created ${CHANNEL} (the address gets a verification e-mail — nothing to click for e-mail channels, but check spam once)"
  fi
fi

# ── 2. log-based metrics ─────────────────────────────────────────────
for f in "${METRIC_FILES[@]}"; do
  src="${HERE}/${f}"
  [ -f "${src}" ] || die "missing ${src}"
  name="$(json_field "${src}" name)"
  [ -n "${name}" ] || die "no \"name\" in ${f}"
  render "${src}" "${WORK}/${f}"
  if [ -n "${PYTHON_BIN}" ]; then
    check_filter "${f}" "$(json_field "${WORK}/${f}" filter)"
  fi
  if gcloud logging metrics describe "${name}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    plan "update log-based metric ${name} (${f})"
    if [ "${DRY_RUN}" != true ]; then
      gcloud logging metrics update "${name}" --config-from-file="${WORK}/${f}" --project="${PROJECT_ID}" >/dev/null
      log "   updated logging.googleapis.com/user/${name}"
    fi
  else
    plan "create log-based metric ${name} (${f})"
    if [ "${DRY_RUN}" != true ]; then
      gcloud logging metrics create "${name}" --config-from-file="${WORK}/${f}" --project="${PROJECT_ID}" >/dev/null
      log "   created logging.googleapis.com/user/${name}"
    fi
  fi
done

# ── 3. alert policies ────────────────────────────────────────────────
for f in "${POLICY_FILES[@]}"; do
  src="${HERE}/${f}"
  [ -f "${src}" ] || die "missing ${src}"
  display="$(json_field "${src}" displayName)"
  [ -n "${display}" ] || die "no \"displayName\" in ${f}"
  render "${src}" "${WORK}/${f}"
  existing="$(gcloud alpha monitoring policies list --project="${PROJECT_ID}" \
    --filter="displayName=\"${display}\"" --format='value(name)' 2>/dev/null | head -n1 || true)"
  if [ -n "${existing}" ]; then
    plan "update alert policy \"${display}\" (${existing##*/}, ${f})"
    if [ "${DRY_RUN}" != true ]; then
      gcloud alpha monitoring policies update "${existing}" --policy-from-file="${WORK}/${f}" \
        --project="${PROJECT_ID}" >/dev/null
      log "   updated ${existing}"
    fi
  else
    plan "create alert policy \"${display}\" (${f})"
    if [ "${DRY_RUN}" != true ]; then
      created="$(gcloud alpha monitoring policies create --policy-from-file="${WORK}/${f}" \
        --project="${PROJECT_ID}" --format='value(name)')"
      log "   created ${created:-<name not returned>}"
    fi
  fi
done

# ── 4. dashboards ────────────────────────────────────────────────────
for f in "${DASHBOARD_FILES[@]}"; do
  src="${HERE}/${f}"
  [ -f "${src}" ] || die "missing ${src}"
  display="$(json_field "${src}" displayName)"
  [ -n "${display}" ] || die "no \"displayName\" in ${f}"
  render "${src}" "${WORK}/${f}"
  existing="$(gcloud monitoring dashboards list --project="${PROJECT_ID}" \
    --filter="displayName=\"${display}\"" --format='value(name)' 2>/dev/null | head -n1 || true)"
  if [ -n "${existing}" ]; then
    plan "update dashboard \"${display}\" (${existing##*/}, ${f})"
    if [ "${DRY_RUN}" != true ]; then
      gcloud monitoring dashboards update "${existing}" --config-from-file="${WORK}/${f}" \
        --project="${PROJECT_ID}" >/dev/null
      log "   updated ${existing}"
      log "   https://console.cloud.google.com/monitoring/dashboards/builder/${existing##*/}?project=${PROJECT_ID}"
    fi
  else
    plan "create dashboard \"${display}\" (${f})"
    if [ "${DRY_RUN}" != true ]; then
      created="$(gcloud monitoring dashboards create --config-from-file="${WORK}/${f}" \
        --project="${PROJECT_ID}" --format='value(name)')"
      log "   created ${created:-<name not returned>}"
      [ -n "${created}" ] && log "   https://console.cloud.google.com/monitoring/dashboards/builder/${created##*/}?project=${PROJECT_ID}"
    fi
  fi
done

# ── 5. what is still manual ──────────────────────────────────────────
log "done."
if [ "${DRY_RUN}" = true ]; then
  log "dry-run: nothing was changed."
fi
cat <<EOF

Next (manual, once — see infra/gcp/monitoring/README.md):
  1. The VM only ships 'citrus-startup-failed' after the startup script in
     instance metadata is refreshed from the repo:
       gcloud compute instances add-metadata citrus-draft-engine-prod \\
         --zone=northamerica-northeast1-a --project=${PROJECT_ID} \\
         --metadata-from-file=startup-script=infra/gce/draft-engine-startup.sh
     (takes effect on the next converge; do it outside a live draft).
  2. Smoke-test the alert path with a fake ERROR (README "How to test").
  3. The watchdog-absent policy only starts judging once the metric has seen
     its first watchdog_ok line (~60 s after the engine is up).
EOF
