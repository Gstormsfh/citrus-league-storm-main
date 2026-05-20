#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# Citrus Draft Engine — Staging deploy pre-flight assertions
# Phase 4.5 chunk 11g.10 sub-step 10b
# ─────────────────────────────────────────────────────────────────────
#
# Fail-loud pre-flight checks. Called by:
#   - infra/gce/draft-engine-startup.sh on every VM boot.
#   - Manual deploy operator before `gcloud compute instances create`.
#   - CI deploy pipeline (when wired post-10b).
#
# Every assertion exits non-zero with a descriptive message on failure.
# The startup script aborts on any failure rather than starting a
# half-broken container.
#
# Required env vars at call time:
#   SUPABASE_DB_URL          — direct primary URL, NOT pooled.
#   SUPABASE_JWT_SECRET      — JWT signing/verification secret.
#   SUPABASE_SERVICE_ROLE_KEY — admin client key.
#   SUPABASE_ANON_KEY        — auth-middleware client key (admin endpoints).
#   SUPABASE_URL             — public Supabase hostname (e.g.
#                              https://jjgspcpvqaiitloglxbb.supabase.co).
#
# Optional:
#   IMAGE_URI                — full Docker image URI. If set, checked
#                              for non-empty.
#   EXPECTED_IMAGE_SHA       — image SHA the deploy expects. If set
#                              alongside IMAGE_URI, must match.

set -euo pipefail

echo "=== staging-deploy-checks: starting at $(date -u +%FT%TZ) ==="

# ── Helper: fail-loud ───────────────────────────────────────────────
fail() {
  echo "FATAL: $1" >&2
  exit 1
}

# ── Check 1: required secrets present ───────────────────────────────
[ -n "${SUPABASE_DB_URL:-}" ] || fail "SUPABASE_DB_URL is empty or unset"
[ -n "${SUPABASE_JWT_SECRET:-}" ] || fail "SUPABASE_JWT_SECRET is empty or unset"
[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] || fail "SUPABASE_SERVICE_ROLE_KEY is empty or unset"
[ -n "${SUPABASE_ANON_KEY:-}" ] || fail "SUPABASE_ANON_KEY is empty or unset"
[ -n "${SUPABASE_URL:-}" ] || fail "SUPABASE_URL is empty or unset"

echo "✓ All required secrets present"

# ── Check 2: SUPABASE_DB_URL is direct (not pooled) — KI-E010 ───────
# PgBouncer-pooled URLs drop LISTEN frames silently. The chunk
# 11g.7-7e LISTEN/NOTIFY path requires a direct primary connection on
# port 5432. Refuse to start otherwise.
if [[ "${SUPABASE_DB_URL}" == *"pooler.supabase.com"* ]]; then
  fail "SUPABASE_DB_URL host contains 'pooler.supabase.com' — pooled URL detected. KI-E010: pooled URLs drop LISTEN frames silently. Use direct primary URL (db.<project>.supabase.co:5432)."
fi
if [[ "${SUPABASE_DB_URL}" == *"pgbouncer"* ]]; then
  fail "SUPABASE_DB_URL contains 'pgbouncer' — pooled URL detected. KI-E010: pooled URLs drop LISTEN frames silently. Use direct primary URL."
fi
if [[ "${SUPABASE_DB_URL}" == *":6543/"* ]] || [[ "${SUPABASE_DB_URL}" == *":6543"* && "${SUPABASE_DB_URL}" != *":65432"* && "${SUPABASE_DB_URL}" != *":6543[0-9]"* ]]; then
  # 6543 is Supabase's pooler port. 5432 is the direct port.
  fail "SUPABASE_DB_URL contains port 6543 — pooled URL detected. KI-E010: pooled URLs drop LISTEN frames silently. Use direct primary URL on port 5432."
fi

echo "✓ SUPABASE_DB_URL is direct (no pooled-URL markers detected)"

# ── Check 3: SUPABASE_URL has expected pattern ──────────────────────
if [[ ! "${SUPABASE_URL}" =~ ^https://[a-z0-9]+\.supabase\.co$ ]]; then
  fail "SUPABASE_URL '$SUPABASE_URL' doesn't match expected pattern https://<project>.supabase.co"
fi

echo "✓ SUPABASE_URL pattern is valid"

# ── Check 4: image expectations (if provided) ───────────────────────
if [ -n "${IMAGE_URI:-}" ] && [ -n "${EXPECTED_IMAGE_SHA:-}" ]; then
  # IMAGE_URI typically ends with `:<tag>` or `@sha256:<digest>`.
  # If the operator provided an EXPECTED_IMAGE_SHA, the URI's tag or
  # digest segment must contain it.
  if [[ "${IMAGE_URI}" != *"${EXPECTED_IMAGE_SHA}"* ]]; then
    fail "IMAGE_URI '$IMAGE_URI' doesn't contain expected SHA '$EXPECTED_IMAGE_SHA'. Refusing to start with mismatched image."
  fi
  echo "✓ Image SHA matches expectation"
fi

# ── Check 5: required VM metadata keys (if running on GCE) ──────────
# Only assert these when we detect we're running on GCE (the metadata
# server endpoint resolves). For local-developer runs, skip.
if curl -sf --max-time 1 -H "Metadata-Flavor: Google" \
    "http://metadata.google.internal/computeMetadata/v1/" >/dev/null 2>&1; then
  for key in project-id image-tag; do
    value="$(curl -s -H "Metadata-Flavor: Google" \
      "http://metadata.google.internal/computeMetadata/v1/instance/attributes/${key}" 2>/dev/null || true)"
    if [ -z "$value" ]; then
      fail "GCE instance metadata key '$key' is missing. Required for traceable deploys."
    fi
  done
  echo "✓ GCE instance metadata keys present"
else
  echo "⏭ Skipping GCE metadata check (not running on GCE metadata-server)"
fi

echo "=== staging-deploy-checks: PASSED at $(date -u +%FT%TZ) ==="
exit 0
