#!/usr/bin/env bash
# ── Citrus API — Cloud Run Deploy Script ────────────────────────────
# First-time setup and manual deployment for the citrus-api service.
#
# Prerequisites:
#   - gcloud CLI installed and authenticated
#   - Docker installed and running
#   - Project: citrus-fantasy-sports
#   - Artifact Registry repo: citrus-api (us-central1)
#
# Usage:
#   ./ops/cloudrun/deploy.sh              # Deploy with :latest tag
#   ./ops/cloudrun/deploy.sh abc123       # Deploy with specific tag (e.g., git SHA)
# ────────────────────────────────────────────────────────────────────

set -euo pipefail

PROJECT_ID="citrus-fantasy-sports"
REGION="us-central1"
SERVICE="citrus-api"
REGISTRY="us-central1-docker.pkg.dev/${PROJECT_ID}/citrus-api"
IMAGE_TAG="${1:-latest}"
IMAGE="${REGISTRY}/server:${IMAGE_TAG}"

echo "═══════════════════════════════════════════════════════════"
echo "  Citrus API — Cloud Run Deployment"
echo "  Project:  ${PROJECT_ID}"
echo "  Region:   ${REGION}"
echo "  Service:  ${SERVICE}"
echo "  Image:    ${IMAGE}"
echo "═══════════════════════════════════════════════════════════"

# ── Step 1: Verify gcloud auth ─────────────────────────────────────
echo ""
echo "▸ Verifying gcloud authentication..."
gcloud auth print-identity-token > /dev/null 2>&1 || {
  echo "✗ Not authenticated. Run: gcloud auth login"
  exit 1
}
echo "  ✓ Authenticated as $(gcloud config get-value account 2>/dev/null)"

# ── Step 2: Set project ────────────────────────────────────────────
echo ""
echo "▸ Setting project to ${PROJECT_ID}..."
gcloud config set project "${PROJECT_ID}" --quiet
echo "  ✓ Project set"

# ── Step 3: Configure Docker for Artifact Registry ─────────────────
echo ""
echo "▸ Configuring Docker for Artifact Registry..."
gcloud auth configure-docker us-central1-docker.pkg.dev --quiet
echo "  ✓ Docker configured"

# ── Step 4: Build Docker image ─────────────────────────────────────
echo ""
echo "▸ Building Docker image..."
docker build -t "${IMAGE}" -f Dockerfile .
echo "  ✓ Image built: ${IMAGE}"

# ── Step 5: Push to Artifact Registry ──────────────────────────────
echo ""
echo "▸ Pushing image to Artifact Registry..."
docker push "${IMAGE}"
echo "  ✓ Image pushed"

# ── Step 6: Deploy to Cloud Run ────────────────────────────────────
echo ""
echo "▸ Deploying to Cloud Run..."
echo "  (Using env vars from gcloud secrets or inline values)"
echo ""

# Check if secrets exist in Secret Manager
SECRETS_EXIST=true
for secret in SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY; do
  if ! gcloud secrets describe "${secret}" --project="${PROJECT_ID}" > /dev/null 2>&1; then
    SECRETS_EXIST=false
    echo "  ⚠ Secret '${secret}' not found in Secret Manager"
  fi
done

if [ "${SECRETS_EXIST}" = true ]; then
  echo "  Using secrets from Secret Manager..."
  gcloud run deploy "${SERVICE}" \
    --image="${IMAGE}" \
    --region="${REGION}" \
    --platform=managed \
    --allow-unauthenticated \
    --memory=512Mi \
    --cpu=1 \
    --min-instances=0 \
    --max-instances=3 \
    --concurrency=80 \
    --timeout=60s \
    --set-env-vars="NODE_ENV=production,PORT=8080" \
    --set-secrets="SUPABASE_URL=SUPABASE_URL:latest,SUPABASE_ANON_KEY=SUPABASE_ANON_KEY:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest" \
    --quiet
else
  echo ""
  echo "  ⚠ Secrets not found in Secret Manager."
  echo "  You can either:"
  echo "    1) Create secrets first:"
  echo "       echo -n 'YOUR_VALUE' | gcloud secrets create SUPABASE_URL --data-file=-"
  echo "       echo -n 'YOUR_VALUE' | gcloud secrets create SUPABASE_ANON_KEY --data-file=-"
  echo "       echo -n 'YOUR_VALUE' | gcloud secrets create SUPABASE_SERVICE_ROLE_KEY --data-file=-"
  echo "       Then re-run this script."
  echo ""
  echo "    2) Deploy with inline env vars (less secure, ok for first test):"
  echo "       gcloud run deploy ${SERVICE} \\"
  echo "         --image=${IMAGE} \\"
  echo "         --region=${REGION} \\"
  echo "         --platform=managed \\"
  echo "         --allow-unauthenticated \\"
  echo "         --memory=512Mi --cpu=1 \\"
  echo "         --min-instances=0 --max-instances=3 \\"
  echo "         --concurrency=80 --timeout=60s \\"
  echo "         --set-env-vars='NODE_ENV=production,PORT=8080,SUPABASE_URL=<url>,SUPABASE_ANON_KEY=<key>,SUPABASE_SERVICE_ROLE_KEY=<key>'"
  exit 1
fi

# ── Step 7: Health check ──────────────────────────────────────────
echo ""
echo "▸ Running health check..."
SERVICE_URL=$(gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --format='value(status.url)' 2>/dev/null) || true

if [ -n "${SERVICE_URL}" ]; then
  echo "  Service URL: ${SERVICE_URL}"
  sleep 5
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}/api/health" --max-time 10) || true
  if [ "${HTTP_STATUS}" = "200" ]; then
    echo "  ✓ Health check passed (HTTP ${HTTP_STATUS})"
  else
    echo "  ⚠ Health check returned HTTP ${HTTP_STATUS}"
    echo "  Check logs: gcloud run services logs read ${SERVICE} --region=${REGION} --limit=50"
  fi
else
  echo "  ⚠ Could not determine service URL"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Deployment complete!"
echo ""
echo "  Service URL:  ${SERVICE_URL:-unknown}"
echo "  Health:       ${SERVICE_URL:-}/api/health"
echo "  Logs:         gcloud run services logs read ${SERVICE} --region=${REGION}"
echo ""
echo "  Firebase Hosting rewrites /api/* → this Cloud Run service."
echo "  Production URL: https://citrusfantasysports.com/api/health"
echo "═══════════════════════════════════════════════════════════"
