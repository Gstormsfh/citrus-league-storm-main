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
# All output goes to /var/log/citrus-startup.log for debugging.
# View on the VM with: sudo tail -f /var/log/citrus-startup.log
# Stream from your laptop: gcloud compute ssh <vm-name> -- \
#   sudo tail -f /var/log/citrus-startup.log
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

ARTIFACT_REGISTRY_HOST="$(metadata_get artifact-registry-host)"
ARTIFACT_REGISTRY_HOST="${ARTIFACT_REGISTRY_HOST:-northamerica-northeast1-docker.pkg.dev}"

IMAGE_REPO="$(metadata_get image-repo)"
IMAGE_REPO="${IMAGE_REPO:-citrus-draft-engine/draft-engine}"

IMAGE_TAG="$(metadata_get image-tag)"
IMAGE_TAG="${IMAGE_TAG:-latest}"

IMAGE_URI="${ARTIFACT_REGISTRY_HOST}/${PROJECT_ID}/${IMAGE_REPO}:${IMAGE_TAG}"

SECRET_NAME="$(metadata_get secret-name)"
SECRET_NAME="${SECRET_NAME:-SUPABASE_JWT_SECRET}"

CONTAINER_NAME="$(metadata_get container-name)"
CONTAINER_NAME="${CONTAINER_NAME:-citrus-draft-engine}"

HONO_HOST_PORT="$(metadata_get hono-host-port)"
HONO_HOST_PORT="${HONO_HOST_PORT:-3001}"

DRAFT_WS_HOST_PORT="$(metadata_get draft-ws-host-port)"
DRAFT_WS_HOST_PORT="${DRAFT_WS_HOST_PORT:-3002}"

echo "Configuration:"
echo "  PROJECT_ID=${PROJECT_ID}"
echo "  IMAGE_URI=${IMAGE_URI}"
echo "  SECRET_NAME=${SECRET_NAME}"
echo "  CONTAINER_NAME=${CONTAINER_NAME}"
echo "  HONO_HOST_PORT=${HONO_HOST_PORT} (-> container 3001)"
echo "  DRAFT_WS_HOST_PORT=${DRAFT_WS_HOST_PORT} (-> container 3002)"

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

# ── Step 3: Read SUPABASE_JWT_SECRET from Secret Manager ────────────
# VM's service account needs roles/secretmanager.secretAccessor on the
# secret. Failure here is fatal — the application can't issue or
# verify draft tokens without it.
echo "Reading ${SECRET_NAME} from Secret Manager (project ${PROJECT_ID})..."
SUPABASE_JWT_SECRET="$(gcloud secrets versions access latest \
  --secret="${SECRET_NAME}" \
  --project="${PROJECT_ID}")"
if [ -z "${SUPABASE_JWT_SECRET}" ]; then
  echo "FATAL: ${SECRET_NAME} is empty or not accessible"
  exit 1
fi
echo "Secret loaded (length ${#SUPABASE_JWT_SECRET})"

# ── Step 4: Pull image from Artifact Registry ───────────────────────
# Re-pulls if the remote SHA differs from the local cache.
echo "Pulling ${IMAGE_URI}..."
docker pull "${IMAGE_URI}"

# ── Step 5: Stop + remove any existing container with the same name ─
# Idempotent: succeeds whether the container exists or not.
echo "Removing any existing ${CONTAINER_NAME} container..."
docker rm -f "${CONTAINER_NAME}" 2>/dev/null || true

# ── Step 6: Run the new container ───────────────────────────────────
# --restart=always: container restarts on crash and on VM reboot.
# -p host:container: maps the configurable host ports to the
#   container's fixed 3001/3002 (set by ENV in the Dockerfile).
# -e SUPABASE_JWT_SECRET: injects the secret read in step 3.
echo "Starting ${CONTAINER_NAME}..."
docker run -d \
  --name "${CONTAINER_NAME}" \
  --restart=always \
  -p "${HONO_HOST_PORT}:3001" \
  -p "${DRAFT_WS_HOST_PORT}:3002" \
  -e SUPABASE_JWT_SECRET="${SUPABASE_JWT_SECRET}" \
  -e PORT=3001 \
  -e DRAFT_WS_PORT=3002 \
  "${IMAGE_URI}"

echo "=== citrus-draft-engine startup script complete: $(date -u +%FT%TZ) ==="
