#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# Citrus Draft Engine — GCE startup script (chunk 11g.2 step 4)
# ─────────────────────────────────────────────────────────────────────
#
# Runs as root on first boot of a Debian-based GCE VM. Provisions
# Docker, pulls the draft-engine image from Artifact Registry, and
# runs the container with secrets injected from GCP Secret Manager.
#
# Replaces the deprecated `gcloud compute instances create-with-container`
# / `--container-image` flag pattern (see docs/PHASE_4_5_GCE_PLATFORM_NOTES.md
# §11 Gotchas, finding 1 — Google deprecated that path during the
# chunk 11g.2.0 spike).
#
# Parameterization
# ────────────────
# Configuration variables at the top default to staging. Override
# per-VM via GCE instance metadata when launching the VM:
#
#   gcloud compute instances create <vm-name> \
#     --metadata=project-id=citrus-fantasy-prod,image-tag=v1.2.3 \
#     --metadata-from-file=startup-script=infra/gce/draft-engine-startup.sh
#
# Metadata keys map to the script variables below (lowercased,
# hyphenated). If a key is absent, the staging default applies.
#
# Idempotency
# ───────────
# This script is safe to re-run — GCE re-executes startup scripts on
# every VM creation. Each operation is no-op-on-second-run:
#   - apt-get install: idempotent (no-op if installed)
#   - gcloud auth configure-docker: idempotent (overwrites helpers entry)
#   - docker pull: idempotent (re-pulls only if remote SHA changed)
#   - docker rm -f: succeeds whether container exists or not
#   - docker run: with the rm above, effectively replaces the container
#
# Logging
# ───────
# Two distinct log streams. Don't conflate them.
#
# 1. Startup-script log: this script's own output goes to
#    /var/log/citrus-startup.log via the `exec >> ... 2>&1` redirect
#    below. View on the VM: sudo tail -f /var/log/citrus-startup.log
#
# 2. Container log: the running draft-engine's stdout/stderr ships
#    to Cloud Logging via Docker's gcplogs log driver, configured on
#    the `docker run` invocation in step 6. Query from your laptop:
#      gcloud logging read 'labels.app="citrus-draft-engine"' \
#        --project=citrus-fantasy-staging --limit=20 --order=desc
#
# The chunk 11g.2.0 spike's `--metadata=google-logging-enabled=true`
# pattern was insufficient on Debian VMs (it works on Container-
# Optimized OS where Docker is integrated with the OS logging
# pipeline; Debian needs an explicit log driver). Chunk 11g.2 step 5
# surfaced the gap; the gcplogs driver in step 6 fixes it without
# requiring an Ops Agent install.
#
# Security note on the JWT secret
# ───────────────────────────────
# `docker run -e SUPABASE_JWT_SECRET=...` makes the value visible in
# `docker inspect` and the process command line. For Day 1 single-VM,
# this is acceptable (the VM's only user is root and the only service
# is the draft engine). Future hardening: write the secret to a
# tmpfs-backed file and bind-mount it, or use a sidecar that reads
# Secret Manager on each run.
#
# IAM requirement
# ───────────────
# The VM's service account (default Compute Engine SA, or a dedicated
# one specified at instance create time) needs:
#   - roles/artifactregistry.reader on the Artifact Registry repo
#   - roles/secretmanager.secretAccessor on the SUPABASE_JWT_SECRET
#   - roles/logging.logWriter for stdout/stderr -> Cloud Logging

set -euo pipefail
exec >> /var/log/citrus-startup.log 2>&1

echo "=== citrus-draft-engine startup script start: $(date -u +%FT%TZ) ==="

# ── Read metadata-or-default ────────────────────────────────────────
# Helper: returns metadata value if present, empty string otherwise.
metadata_get() {
  local key="$1"
  curl -s --fail -H "Metadata-Flavor: Google" \
    "http://metadata.google.internal/computeMetadata/v1/instance/attributes/${key}" \
    2>/dev/null || true
}

PROJECT_ID="$(metadata_get project-id)"
PROJECT_ID="${PROJECT_ID:-citrus-fantasy-staging}"

ENVIRONMENT="$(metadata_get environment)"
ENVIRONMENT="${ENVIRONMENT:-staging}"

ARTIFACT_REGISTRY_HOST="$(metadata_get artifact-registry-host)"
ARTIFACT_REGISTRY_HOST="${ARTIFACT_REGISTRY_HOST:-northamerica-northeast1-docker.pkg.dev}"

IMAGE_REPO="$(metadata_get image-repo)"
IMAGE_REPO="${IMAGE_REPO:-citrus-draft-engine/draft-engine}"

IMAGE_TAG="$(metadata_get image-tag)"
IMAGE_TAG="${IMAGE_TAG:-latest}"

IMAGE_URI="${ARTIFACT_REGISTRY_HOST}/${PROJECT_ID}/${IMAGE_REPO}:${IMAGE_TAG}"

# Secret naming follows the GCP Secret Manager convention used by chunk
# 11g.10 sub-step 10b — separate Secret Manager entries per role:
#   - supabase-jwt-secret       (chunk 11g.1, existing)
#   - supabase-db-url           (NEW — required by 11g.7-7e LISTEN/NOTIFY)
#   - supabase-service-role-key (NEW — required by getSupabaseAdmin())
# Metadata override on a per-VM basis is supported but the defaults
# match the standard provisioning shape.
SECRET_JWT_NAME="$(metadata_get secret-jwt-name)"
SECRET_JWT_NAME="${SECRET_JWT_NAME:-supabase-jwt-secret}"

SECRET_DB_URL_NAME="$(metadata_get secret-db-url-name)"
SECRET_DB_URL_NAME="${SECRET_DB_URL_NAME:-supabase-db-url}"

SECRET_SERVICE_ROLE_NAME="$(metadata_get secret-service-role-name)"
SECRET_SERVICE_ROLE_NAME="${SECRET_SERVICE_ROLE_NAME:-supabase-service-role-key}"

# SUPABASE_ANON_KEY — required by authMiddleware in the engine-process
# Hono server (chunk 11g.10 sub-step 10b admin-endpoint relocation).
# Cryptographically public (exposed in Vite bundle on the frontend),
# but tracked in Secret Manager for consistency with the other Supabase
# env vars.
SECRET_ANON_KEY_NAME="$(metadata_get secret-anon-key-name)"
SECRET_ANON_KEY_NAME="${SECRET_ANON_KEY_NAME:-supabase-anon-key}"

# Public Supabase hostname (not secret — embedded in build, but
# can be overridden per environment via metadata).
SUPABASE_URL_VALUE="$(metadata_get supabase-url)"
SUPABASE_URL_VALUE="${SUPABASE_URL_VALUE:-https://jjgspcpvqaiitloglxbb.supabase.co}"

# IMAGE_SHA + COMMIT_SHA for the deployment-fingerprint log emitted at
# engine startup (chunk 11g.10 sub-step 10b). Both optional — defaults
# to "unset" in the fingerprint log if not provided. Production deploys
# should always set image-sha from the CI pipeline.
IMAGE_SHA_META="$(metadata_get image-sha)"
COMMIT_SHA_META="$(metadata_get commit-sha)"

CONTAINER_NAME="$(metadata_get container-name)"
CONTAINER_NAME="${CONTAINER_NAME:-citrus-draft-engine}"

HONO_HOST_PORT="$(metadata_get hono-host-port)"
HONO_HOST_PORT="${HONO_HOST_PORT:-3001}"

DRAFT_WS_HOST_PORT="$(metadata_get draft-ws-host-port)"
DRAFT_WS_HOST_PORT="${DRAFT_WS_HOST_PORT:-3002}"

echo "Configuration:"
echo "  PROJECT_ID=${PROJECT_ID}"
echo "  ENVIRONMENT=${ENVIRONMENT}"
echo "  IMAGE_URI=${IMAGE_URI}"
echo "  SECRET_JWT_NAME=${SECRET_JWT_NAME}"
echo "  SECRET_DB_URL_NAME=${SECRET_DB_URL_NAME}"
echo "  SECRET_SERVICE_ROLE_NAME=${SECRET_SERVICE_ROLE_NAME}"
echo "  SECRET_ANON_KEY_NAME=${SECRET_ANON_KEY_NAME}"
echo "  SUPABASE_URL_VALUE=${SUPABASE_URL_VALUE}"
echo "  CONTAINER_NAME=${CONTAINER_NAME}"
echo "  HONO_HOST_PORT=${HONO_HOST_PORT} (-> container 3001)"
echo "  DRAFT_WS_HOST_PORT=${DRAFT_WS_HOST_PORT} (-> container 3002)"
echo "  IMAGE_SHA_META=${IMAGE_SHA_META:-<unset>}"
echo "  COMMIT_SHA_META=${COMMIT_SHA_META:-<unset>}"

# ── Step 1: Install Docker ──────────────────────────────────────────
# Debian's docker.io package + systemd integration. apt-get install is
# idempotent. Other deps: ca-certificates for TLS to Artifact Registry,
# curl already present (we used it above for metadata).
echo "Installing Docker..."
apt-get update
apt-get install -y --no-install-recommends docker.io ca-certificates
systemctl enable --now docker

# ── Step 2: Configure gcloud Docker auth ────────────────────────────
# Lets `docker pull` against Artifact Registry use the VM's service
# account credentials (no separate key file needed).
echo "Configuring gcloud Docker auth for ${ARTIFACT_REGISTRY_HOST}..."
gcloud auth configure-docker "${ARTIFACT_REGISTRY_HOST}" --quiet

# ── Step 3: Read secrets from Secret Manager ─────────────────────────
# VM's service account needs roles/secretmanager.secretAccessor on each
# secret. Failure on any secret is fatal — the application can't run
# without all three. The 11g.10-10b expansion added supabase-db-url
# (for chunk 11g.7-7e LISTEN/NOTIFY) and supabase-service-role-key
# (for getSupabaseAdmin() in chunk 11g.4+).
echo "Reading ${SECRET_JWT_NAME} from Secret Manager (project ${PROJECT_ID})..."
SUPABASE_JWT_SECRET="$(gcloud secrets versions access latest \
  --secret="${SECRET_JWT_NAME}" \
  --project="${PROJECT_ID}")"
if [ -z "${SUPABASE_JWT_SECRET}" ]; then
  echo "FATAL: ${SECRET_JWT_NAME} is empty or not accessible"
  exit 1
fi
echo "  loaded (length ${#SUPABASE_JWT_SECRET})"

echo "Reading ${SECRET_DB_URL_NAME} from Secret Manager..."
SUPABASE_DB_URL="$(gcloud secrets versions access latest \
  --secret="${SECRET_DB_URL_NAME}" \
  --project="${PROJECT_ID}")"
if [ -z "${SUPABASE_DB_URL}" ]; then
  echo "FATAL: ${SECRET_DB_URL_NAME} is empty or not accessible. Chunk 11g.7-7e LISTEN/NOTIFY requires SUPABASE_DB_URL."
  exit 1
fi
echo "  loaded (length ${#SUPABASE_DB_URL})"

echo "Reading ${SECRET_SERVICE_ROLE_NAME} from Secret Manager..."
SUPABASE_SERVICE_ROLE_KEY="$(gcloud secrets versions access latest \
  --secret="${SECRET_SERVICE_ROLE_NAME}" \
  --project="${PROJECT_ID}")"
if [ -z "${SUPABASE_SERVICE_ROLE_KEY}" ]; then
  echo "FATAL: ${SECRET_SERVICE_ROLE_NAME} is empty or not accessible. getSupabaseAdmin() requires SUPABASE_SERVICE_ROLE_KEY."
  exit 1
fi
echo "  loaded (length ${#SUPABASE_SERVICE_ROLE_KEY})"

echo "Reading ${SECRET_ANON_KEY_NAME} from Secret Manager..."
SUPABASE_ANON_KEY="$(gcloud secrets versions access latest \
  --secret="${SECRET_ANON_KEY_NAME}" \
  --project="${PROJECT_ID}")"
if [ -z "${SUPABASE_ANON_KEY}" ]; then
  echo "FATAL: ${SECRET_ANON_KEY_NAME} is empty or not accessible. authMiddleware (admin endpoints) requires SUPABASE_ANON_KEY."
  exit 1
fi
echo "  loaded (length ${#SUPABASE_ANON_KEY})"

# ── Step 3b: Pre-flight assertions ───────────────────────────────────
# Fail-loud on misconfigurations BEFORE attempting to start the
# container. Most important: block pooled SUPABASE_DB_URL patterns
# (KI-E010 — pgbouncer drops LISTEN frames silently).
#
# Sourced from the repo via the published image OR via a baked-in copy.
# For Day 1: the script lives at /opt/citrus/staging-deploy-checks.sh
# on the VM if pre-copied; otherwise we inline the critical pooled-URL
# check below as a minimum-viable safety net.
echo "Running pre-flight assertions..."
if [ -x "/opt/citrus/staging-deploy-checks.sh" ]; then
  SUPABASE_DB_URL="${SUPABASE_DB_URL}" \
  SUPABASE_JWT_SECRET="${SUPABASE_JWT_SECRET}" \
  SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY}" \
  SUPABASE_URL="${SUPABASE_URL_VALUE}" \
  IMAGE_URI="${IMAGE_URI}" \
  EXPECTED_IMAGE_SHA="${IMAGE_SHA_META}" \
  /opt/citrus/staging-deploy-checks.sh
else
  # Minimum-viable inline check — pooled-URL block (KI-E010).
  if [[ "${SUPABASE_DB_URL}" == *"pooler.supabase.com"* ]] || \
     [[ "${SUPABASE_DB_URL}" == *"pgbouncer"* ]] || \
     [[ "${SUPABASE_DB_URL}" == *":6543"* ]]; then
    echo "FATAL: SUPABASE_DB_URL matches pooled-connection pattern. KI-E010: pooled URLs drop LISTEN frames silently. Use direct primary URL (db.<project>.supabase.co:5432)." >&2
    exit 1
  fi
  echo "  inline pre-flight pooled-URL check passed (full pre-flight script not installed at /opt/citrus/staging-deploy-checks.sh)"
fi

# ── Step 4: Pull image from Artifact Registry ───────────────────────
# Re-pulls only if the remote SHA differs from the local cache (Docker
# handles this automatically). Idempotency: safe to re-run on every
# VM startup; cached layers skip download.
echo "Pulling ${IMAGE_URI}..."
docker pull "${IMAGE_URI}"

# Capture the local image's digest for the idempotency check below.
LOCAL_IMAGE_DIGEST="$(docker image inspect --format='{{index .RepoDigests 0}}' "${IMAGE_URI}" 2>/dev/null || echo "")"

# ── Step 4b: Idempotency check — skip restart if container is already
# running on the current image ───────────────────────────────────────
# Re-running this script (VM reboot, manual re-trigger) should not
# disrupt a healthy container unless the image actually changed. If a
# container with the same name is running on the same image digest,
# log + skip the restart.
RUNNING_CONTAINER_ID="$(docker ps -q --filter "name=^/${CONTAINER_NAME}$" --filter "status=running" 2>/dev/null || echo "")"
if [ -n "${RUNNING_CONTAINER_ID}" ]; then
  RUNNING_IMAGE_DIGEST="$(docker inspect --format='{{.Image}}' "${RUNNING_CONTAINER_ID}" 2>/dev/null || echo "")"
  CURRENT_IMAGE_DIGEST="$(docker image inspect --format='{{.Id}}' "${IMAGE_URI}" 2>/dev/null || echo "")"
  if [ -n "${RUNNING_IMAGE_DIGEST}" ] && [ -n "${CURRENT_IMAGE_DIGEST}" ] && \
     [ "${RUNNING_IMAGE_DIGEST}" = "${CURRENT_IMAGE_DIGEST}" ]; then
    echo "Container ${CONTAINER_NAME} already running on current image digest. Skipping restart (idempotency)."
    echo "=== citrus-draft-engine startup script complete (idempotent skip): $(date -u +%FT%TZ) ==="
    exit 0
  fi
  echo "Container ${CONTAINER_NAME} is running but on a different image. Replacing..."
fi

# ── Step 5: Stop + remove any existing container with the same name ─
# Idempotent: succeeds whether the container exists or not.
echo "Removing any existing ${CONTAINER_NAME} container..."
docker rm -f "${CONTAINER_NAME}" 2>/dev/null || true

# ── Step 6: Run the new container ───────────────────────────────────
# --restart=always: container restarts on crash and on VM reboot.
# --log-driver=gcplogs: stream container stdout/stderr directly to
#   Cloud Logging via the VM's metadata-server credentials. No agent
#   install needed; requires roles/logging.logWriter on the VM
#   service account (already in the IAM block at the top of this
#   script). Replaces the chunk 11g.2.0 spike's incorrect-on-Debian
#   `--metadata=google-logging-enabled=true` assumption — see the
#   "Logging" header section above for the full narrative.
# --log-opt gcp-project: directs logs to ${PROJECT_ID}.
# --log-opt labels: tells the gcplogs driver to forward the named
#   Docker labels as Cloud Logging labels.
# --label app, --label environment: the labels themselves. Used for
#   filtering in Cloud Logging, e.g.
#     gcloud logging read 'labels.app="citrus-draft-engine"
#                          AND labels.environment="${ENVIRONMENT}"'
# -p host:container: maps the configurable host ports to the
#   container's fixed 3001/3002 (set by ENV in the Dockerfile).
# -e SUPABASE_JWT_SECRET: injects the secret read in step 3.
echo "Starting ${CONTAINER_NAME}..."
docker run -d \
  --name "${CONTAINER_NAME}" \
  --restart=always \
  --log-driver=gcplogs \
  --log-opt gcp-project="${PROJECT_ID}" \
  --log-opt labels=app,environment \
  --label app=citrus-draft-engine \
  --label environment="${ENVIRONMENT}" \
  -p "${HONO_HOST_PORT}:3001" \
  -p "${DRAFT_WS_HOST_PORT}:3002" \
  -e SUPABASE_JWT_SECRET="${SUPABASE_JWT_SECRET}" \
  -e SUPABASE_DB_URL="${SUPABASE_DB_URL}" \
  -e SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY}" \
  -e SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY}" \
  -e SUPABASE_URL="${SUPABASE_URL_VALUE}" \
  -e IMAGE_SHA="${IMAGE_SHA_META}" \
  -e COMMIT_SHA="${COMMIT_SHA_META}" \
  -e NODE_ENV=production \
  -e PORT=3001 \
  -e DRAFT_WS_PORT=3002 \
  "${IMAGE_URI}"

echo "=== citrus-draft-engine startup script complete: $(date -u +%FT%TZ) ==="
